'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const launchd = require('./launchd.cjs');
const installer = require('./install.cjs');
const { inspectBundle } = require('./standalone.cjs');

const run = promisify(execFile);
const REPOSITORY = 'tccpc/codex-ringside';
const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const CHECK_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
const SCAN_MS = 60000;
const STATE_FILE = 'update-state.json';

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function writeJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
}

function readState(root) {
  try { return readJson(path.join(root, STATE_FILE)) ?? {}; }
  catch { return {}; } // A damaged diagnostic file must not disable updates forever.
}

function installation(root) {
  const file = path.join(root, 'settings.json');
  const settings = readJson(file);
  const pkg = readJson(path.join(root, 'package.json'));
  if (!settings || pkg?.name !== 'codex-ringside') throw Error('尚未安装，请先运行 install');
  const stat = fs.statSync(file);
  return { settings, version: pkg.version, stamp: `${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}` };
}

function versionParts(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) throw Error(`无效的版本号：${value}`);
  return { numbers: match.slice(1, 4).map(BigInt), prerelease: !!match[4] };
}

// The remote channel only accepts stable versions; a matching stable beats its RC.
function isNewer(latest, current) {
  const a = versionParts(latest);
  const b = versionParts(current);
  if (a.prerelease) return false;
  for (let i = 0; i < 3; i++) {
    if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] > b.numbers[i];
  }
  return b.prerelease;
}

async function curl(url, destination, signal) {
  const args = ['--fail', '--location', '--silent', '--show-error', '--retry', '2',
    '--connect-timeout', '20', '--max-time', destination ? '600' : '30',
    '--max-filesize', String(destination ? 256 * 1024 * 1024 : 1024 * 1024),
    '--proto', '=https', '--proto-redir', '=https', '--user-agent', 'codex-ringside-updater'];
  if (destination) args.push('--output', destination);
  else args.push('--header', 'Accept: application/vnd.github+json');
  args.push(url);
  try {
    const { stdout } = await run('/usr/bin/curl', args, {
      encoding: 'utf8', timeout: destination ? 1900000 : 120000, maxBuffer: 1024 * 1024, signal
    });
    return stdout;
  } catch (error) {
    throw Error(`更新下载失败，请检查网络或稍后重试（${error.code ?? 'timeout'}）`);
  }
}

async function fetchRelease(signal) {
  return JSON.parse(await curl(RELEASE_API, undefined, signal));
}

function releaseInfo(release, arch = process.arch) {
  if (release?.draft || release?.prerelease) return null;
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release?.tag_name ?? '')) {
    throw Error('远程发行版不是有效的正式版本');
  }
  if (!['arm64', 'x64'].includes(arch)) throw Error('不支持的芯片架构');
  const version = release.tag_name.slice(1);
  const asset = `codex-ringside-v${version}-darwin-${arch}.tar.gz`;
  const base = `https://github.com/${REPOSITORY}/releases/download/v${version}`;
  return { version, asset, base, assets: release.assets };
}

function checksum(manifest, asset) {
  const matches = manifest.split(/\r?\n/).map(line => /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line))
    .filter(match => match?.[2] === asset);
  if (matches.length !== 1) throw Error('发行版缺少唯一的安装包 SHA-256 校验值');
  return matches[0][1].toLowerCase();
}

async function digest(file) {
  const hash = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

async function extractBundle(archive, work, signal) {
  const options = { encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, signal };
  const { stdout: names } = await run('/usr/bin/tar', ['-tzf', archive], options);
  const { stdout: entries } = await run('/usr/bin/tar', ['-tvzf', archive], options);
  const safePath = name => name.startsWith('codex-ringside/')
    && !name.includes('\\') && !name.split('/').some(part => part === '..' || part === '.');
  if (!names.trim() || !names.trimEnd().split('\n').every(safePath)
    || !entries.trimEnd().split('\n').every(line => /^[-d]/.test(line))) {
    throw Error('安装包包含不安全的路径或链接');
  }
  await run('/usr/bin/tar', ['-xzf', archive, '--no-same-owner', '--no-same-permissions', '-C', work], options);
  return path.join(work, 'codex-ringside');
}

async function prepareBundle(release, work, { download = curl, inspect = inspectBundle, signal } = {}) {
  for (const name of [release.asset, 'SHA256SUMS.txt']) {
    if (!release.assets?.some(asset => asset.name === name && asset.state === 'uploaded')) {
      throw Error(`发行版缺少安装文件：${name}`);
    }
  }
  const sums = path.join(work, 'SHA256SUMS.txt');
  const archive = path.join(work, release.asset);
  await download(`${release.base}/SHA256SUMS.txt`, sums, signal);
  const expected = checksum(fs.readFileSync(sums, 'utf8'), release.asset);
  await download(`${release.base}/${release.asset}`, archive, signal);
  if (await digest(archive) !== expected) throw Error('安装包 SHA-256 校验失败，未更改现有安装');
  const payload = await extractBundle(archive, work, signal);
  const pkg = readJson(path.join(payload, 'package.json'));
  if (pkg?.name !== 'codex-ringside' || pkg.version !== release.version) throw Error('安装包版本不匹配');
  const bundle = inspect(payload);
  if (!bundle || bundle.version !== release.version) throw Error('安装包缺少有效的独立运行时');
  return payload;
}

function updateStatus(root = launchd.paths.installDir) {
  const installed = installation(root);
  return { ...readState(root), enabled: installed.settings.autoUpdate !== false,
    currentVersion: installed.version, source: RELEASE_API, checkIntervalHours: 6 };
}

async function setAutoUpdate(enabled, root = launchd.paths.installDir) {
  await installer.withLock({ installDir: root }, async () => {
    const { settings } = installation(root);
    writeJson(path.join(root, 'settings.json'), { ...settings, autoUpdate: enabled });
    if (enabled) writeJson(path.join(root, STATE_FILE), { ...readState(root), nextCheckAt: 0 });
  });
}

async function runUpdate({ root = launchd.paths.installDir, automatic = false, checkOnly = false,
  getRelease = fetchRelease, prepare = prepareBundle, install = installer.install, now = Date.now, signal } = {}) {
  // A separate lock keeps manual checks and automatic downloads from running together.
  return installer.withLock({ installDir: `${root}.update` }, async () => {
    const initial = installation(root);
    const beforeInstall = () => {
      signal?.throwIfAborted();
      const current = installation(root);
      if (current.stamp !== initial.stamp || current.version !== initial.version
        || (automatic && current.settings.autoUpdate === false)) {
        throw Error('安装或更新设置已变化，取消本次更新');
      }
    };
    const saved = readState(root);
    if (automatic && (initial.settings.autoUpdate === false || (!isDue(saved, now()) && saved.status !== 'scheduled'))) {
      return { status: 'skipped', currentVersion: initial.version };
    }
    let state = { ...readState(root), status: 'checking', lastAttemptAt: now(),
      nextCheckAt: now() + RETRY_MS, error: null, attemptId: crypto.randomUUID() };
    const save = patch => {
      state = { ...state, ...patch };
      // Never recreate an uninstalled root.
      if (fs.existsSync(path.join(root, 'settings.json'))) writeJson(path.join(root, STATE_FILE), state);
    };
    save({});
    let work;
    try {
      const release = releaseInfo(await getRelease(signal));
      beforeInstall();
      save({ lastCheckedAt: now(), latestVersion: release?.version ?? null });
      if (!release || !isNewer(release.version, initial.version)) {
        save({ status: 'up-to-date', nextCheckAt: now() + CHECK_MS });
      } else if (checkOnly) {
        save({ status: 'available', nextCheckAt: now() });
      } else {
        save({ status: 'downloading' });
        work = fs.mkdtempSync(path.join(os.tmpdir(), 'ringside-update-'));
        const payload = await prepare(release, work, { signal });
        beforeInstall();
        save({ status: 'installing' });
        const result = await install({ repoRoot: payload, env: {}, beforeInstall });
        save({ status: 'updated', installedVersion: release.version, updatedAt: now(),
          backup: result.backup, nextCheckAt: now() + CHECK_MS });
      }
      return state;
    } catch (error) {
      if (readState(root).attemptId === state.attemptId) {
        save({ status: 'failed', error: error.message, nextCheckAt: now() + RETRY_MS });
      }
      throw error;
    } finally {
      if (work) fs.rmSync(work, { recursive: true, force: true });
    }
  });
}

function isDue(state, now = Date.now()) {
  // Clamp future timestamps so a clock correction cannot suppress updates indefinitely.
  return !Number.isFinite(state.nextCheckAt) || state.nextCheckAt <= now || state.nextCheckAt > now + CHECK_MS;
}

async function scheduleUpdate({ root = launchd.paths.installDir, node = process.execPath,
  logDir = launchd.paths.logDir, services = launchd, now = Date.now } = {}) {
  const current = installation(root);
  if (current.settings.autoUpdate === false || !isDue(readState(root), now())) return false;
  return installer.withLock({ installDir: root }, async () => {
    if (installation(root).settings.autoUpdate === false || !isDue(readState(root), now())) return false;
    // Do not bootout a worker that is still downloading or completing a rollback.
    if (/\bpid = \d+/.test(services.printJob(launchd.UPDATE_LABEL) ?? '')) return false;
    await services.bootout(launchd.UPDATE_LABEL);
    const file = path.join(root, `${launchd.UPDATE_LABEL}.plist`);
    const state = { ...readState(root), status: 'scheduled', nextCheckAt: now() + RETRY_MS, error: null };
    writeJson(path.join(root, STATE_FILE), state);
    try {
      services.writePlist(launchd.updateConfig({ node, installDir: root, logDir }), file);
      services.bootstrap(file);
    } catch (error) {
      writeJson(path.join(root, STATE_FILE), { ...state, status: 'failed', error: error.message });
      throw error;
    }
    return true;
  });
}

function startAutoUpdater({ root, signal, log }) {
  let running = false;
  const tick = async () => {
    if (running || signal.aborted) return;
    running = true;
    try { await scheduleUpdate({ root }); }
    catch (error) { log(`update: ${error.message}`); }
    finally { running = false; }
  };
  // Let installation finish its readiness check before launching the first update job.
  const timer = setInterval(tick, SCAN_MS);
  signal.addEventListener('abort', () => clearInterval(timer), { once: true });
}

module.exports = { CHECK_MS, RETRY_MS, RELEASE_API, isNewer, isDue, checksum, releaseInfo,
  extractBundle, prepareBundle, runUpdate, updateStatus, setAutoUpdate, scheduleUpdate, startAutoUpdater };

if (require.main === module) {
  const abort = new AbortController();
  const stop = () => abort.abort(Error('更新已取消'));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  runUpdate({ automatic: process.argv.includes('--auto'), signal: abort.signal }).then(result => {
    console.log(`[${new Date().toISOString()}] update: ${result.status}`);
  }).catch(error => {
    console.error(`[${new Date().toISOString()}] update: ${error.message}`);
    process.exitCode = 1;
  });
}
