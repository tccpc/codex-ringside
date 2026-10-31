'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const launchd = require('./launchd.cjs');
const { DEFAULT_APP, isExecutable, resolveCodexBin, resolveNode } = require('./resolve.cjs');

const SWIFTC = '/usr/bin/swiftc';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const defaults = {
  repoRoot: path.resolve(__dirname, '..'),
  current: { ...launchd.paths, label: launchd.LABEL },
  legacy: { ...launchd.legacyPaths, label: launchd.LEGACY_LABEL },
  backupRoot: path.join(os.homedir(), 'Library/Application Support/CodexRingside Backups'),
  trashRoot: path.join(os.homedir(), '.Trash'),
  services: launchd
};

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`无法读取设置：${file}`, { cause: error });
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

function preflight(settings) {
  if (process.platform !== 'darwin') throw new Error('只支持 macOS');
  const app = fs.realpathSync(settings.app);
  resolveCodexBin(app);
  if (!isExecutable(SWIFTC)) throw new Error('需要 Xcode Command Line Tools：xcode-select --install');
  return { app, node: resolveNode() };
}

function compile(repoRoot, stage) {
  execFileSync(SWIFTC, ['-O', '-swift-version', '5', path.join(repoRoot, 'native/bridge.swift'), '-o', path.join(stage, 'bridge')], {
    stdio: ['ignore', 'ignore', 'inherit'], timeout: 180000
  });
}

async function waitReady(current, startedAt) {
  for (let i = 0; i < 100; i++) {
    const state = readJson(path.join(current.installDir, 'state.json'));
    if (['watching', 'observing'].includes(state?.event) && state.updatedAt >= startedAt) return;
    await sleep(100);
  }
  throw new Error(`后台任务未就绪，请查看 ${path.join(current.logDir, 'agent.err.log')}`);
}

function copyIfPresent(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.cpSync(source, destination, { recursive: true, preserveTimestamps: true });
}

function capture(locations, backup) {
  return locations.flatMap((location, index) => ['installDir', 'logDir', 'plist'].map(key => {
    const source = location[key];
    const destination = path.join(backup, String(index), key);
    const exists = fs.existsSync(source);
    if (exists) copyIfPresent(source, destination);
    return { source, destination, exists };
  }));
}

// Serializes install/uninstall. A dead install process leaves a recoverable lock, not a permanent block.
async function withLock(current, action) {
  const file = `${current.installDir}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let fd;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fd = fs.openSync(file, 'wx', 0o600); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(fs.readFileSync(file, 'utf8'));
      if (!Number.isInteger(pid) || pid <= 0) throw new Error(`安装锁无效，请检查：${file}`);
      try { process.kill(pid, 0); }
      catch (failure) {
        if (failure.code === 'ESRCH') { fs.rmSync(file); continue; }
        throw failure;
      }
      throw new Error('另一个安装或卸载任务正在运行');
    }
  }
  if (fd === undefined) throw new Error('无法取得安装锁');
  fs.writeFileSync(fd, String(process.pid));
  try { return await action(); }
  finally { fs.closeSync(fd); fs.rmSync(file, { force: true }); }
}

function selectSettings(current, legacy, env, observe) {
  const saved = readJson(path.join(current.installDir, 'settings.json'))
    ?? readJson(path.join(legacy.installDir, 'settings.json')) ?? {};
  return {
    app: env.CODEX_RINGSIDE_APP || env.CODEX_PLUS_APP || saved.app || DEFAULT_APP,
    allowClientRestart: observe === undefined ? saved.allowClientRestart !== false : !observe
  };
}

function copyUserData(source, stage, destination) {
  for (const name of ['background.json', 'background', 'user-images']) {
    copyIfPresent(path.join(source, name), path.join(stage, name));
  }
  const file = path.join(stage, 'background.json');
  const config = readJson(file);
  // An image stored inside the old managed directory must survive that directory being archived.
  if (typeof config?.image === 'string') {
    const relative = path.relative(source, config.image);
    if (relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) {
      const name = path.join('user-images', `imported${path.extname(config.image)}`);
      copyIfPresent(config.image, path.join(stage, name));
      config.image = path.join(destination, name);
      writeJson(file, config);
    }
  }
}

async function install(options = {}) {
  const { current, legacy, backupRoot, repoRoot, services } = { ...defaults, ...options };
  return withLock(current, async () => {
    const settings = selectSettings(current, legacy, options.env ?? process.env, options.observe);
    const checked = await (options.preflight ?? preflight)(settings);
    settings.app = checked.app;
    const stage = fs.mkdtempSync(`${current.installDir}.staging-`);
    const locations = [current, legacy];
    let backup;
    let snapshots;
    let running;
    let touched = false;
    try {
      fs.cpSync(path.join(repoRoot, 'src'), path.join(stage, 'src'), { recursive: true });
      for (const name of ['package.json', 'LICENSE', 'NOTICE']) fs.copyFileSync(path.join(repoRoot, name), path.join(stage, name));
      await (options.compile ?? compile)(repoRoot, stage);
      fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
      backup = fs.mkdtempSync(path.join(backupRoot, 'install-'));
      snapshots = capture(locations, backup);
      running = locations.map(location => !!services.printJob(location.label));
      writeJson(path.join(backup, 'receipt.json'), { locations, running, createdAt: new Date().toISOString() });
      touched = true;
      for (const location of locations) await services.bootout(location.label);

      // Copy after stopping writers. Existing Ringside data takes precedence over legacy data.
      const dataRoot = fs.existsSync(path.join(current.installDir, 'settings.json')) ? current.installDir : legacy.installDir;
      copyUserData(dataRoot, stage, current.installDir);
      const cooldown = Math.max(...locations.map(location => {
        const value = readJson(path.join(location.installDir, 'state.json'))?.lastAttemptAt;
        return Number.isFinite(value) ? value : 0;
      }));
      writeJson(path.join(stage, 'settings.json'), settings);
      writeJson(path.join(stage, 'state.json'), { lastAttemptAt: cooldown });
      fs.rmSync(current.installDir, { recursive: true, force: true });
      fs.renameSync(stage, current.installDir);
      fs.mkdirSync(current.logDir, { recursive: true, mode: 0o700 });
      services.writePlist(services.agentConfig({ ...current, node: checked.node }), current.plist);
      const startedAt = Date.now();
      services.bootstrap(current.plist);
      await (options.waitReady ?? waitReady)(current, startedAt);
      for (const key of ['installDir', 'logDir', 'plist']) fs.rmSync(legacy[key], { recursive: true, force: true });
      return { backup, settings };
    } catch (error) {
      const failures = [];
      if (touched) {
        for (const location of locations) {
          try { await services.bootout(location.label); } catch (failure) { failures.push(failure); }
        }
        // Never replace files underneath a job we could not stop.
        if (locations.some(location => services.printJob(location.label))) {
          throw new Error(`安装失败，后台任务无法停止；备份保留在 ${backup}。原因：${error.message}`, { cause: error });
        }
        for (const item of snapshots) {
          try {
            fs.rmSync(item.source, { recursive: true, force: true });
            if (item.exists) copyIfPresent(item.destination, item.source);
          } catch (failure) { failures.push(failure); }
        }
        for (let i = 0; i < locations.length; i++) {
          if (running[i]) {
            try { services.bootstrap(locations[i].plist); } catch (failure) { failures.push(failure); }
          }
        }
      }
      throw new Error(`${error.message}${touched ? `；已尝试恢复原安装，备份：${backup}` : ''}${failures.length ? `；恢复失败：${failures.map(f => f.message).join(' / ')}` : ''}`, { cause: error });
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
    }
  });
}

async function uninstall(options = {}) {
  const { current, legacy, trashRoot, services } = { ...defaults, ...options };
  return withLock(current, async () => {
    const locations = [current, legacy];
    const running = locations.map(location => !!services.printJob(location.label));
    const items = locations.flatMap((location, i) => launchd.trashItems(location)
      .filter(([file]) => fs.existsSync(file)).map(([file, name]) => [file, `${i ? 'CodexPlus' : 'CodexRingside'}-${name}`]));
    if (!items.length && !running.some(Boolean)) return null;
    fs.mkdirSync(trashRoot, { recursive: true, mode: 0o700 });
    const trash = fs.mkdtempSync(path.join(trashRoot, 'CodexRingside-'));
    const moved = [];
    try {
      for (const location of locations) await services.bootout(location.label);
      await options.removeUi?.();
      for (const [file, name] of items) {
        const destination = path.join(trash, name);
        fs.renameSync(file, destination);
        moved.push([file, destination]);
      }
      return trash;
    } catch (error) {
      for (const [file, destination] of moved.reverse()) fs.renameSync(destination, file);
      for (let i = 0; i < locations.length; i++) if (running[i] && !services.printJob(locations[i].label)) services.bootstrap(locations[i].plist);
      throw error;
    }
  });
}

module.exports = { install, uninstall, selectSettings };
