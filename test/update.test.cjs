'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { CHECK_MS, RETRY_MS, isNewer, isDue, releaseInfo, checksum, prepareBundle,
  runUpdate, updateStatus, setAutoUpdate, scheduleUpdate, startAutoUpdater } = require('../src/update.cjs');
const { UPDATE_LABEL, updateConfig } = require('../src/launchd.cjs');

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function temp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ringside update test '));
  roots.push(root);
  return root;
}
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
}
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function release(version = '0.3.0') {
  return { tag_name: `v${version}`, draft: false, prerelease: false, assets: [
    { name: `codex-ringside-v${version}-darwin-${process.arch}.tar.gz`, state: 'uploaded' },
    { name: 'SHA256SUMS.txt', state: 'uploaded' }
  ] };
}
function harness() {
  const directory = temp();
  const root = path.join(directory, 'installed');
  write(path.join(root, 'settings.json'), { app: '/Custom.app', allowClientRestart: false, autoUpdate: true });
  write(path.join(root, 'package.json'), { name: 'codex-ringside', version: '0.2.0' });
  const calls = [];
  const clock = { time: 1000000 };
  const options = {
    root, now: () => clock.time,
    getRelease: async () => { calls.push('check'); return release(); },
    prepare: async (_release, work) => { calls.push('prepare'); return work; },
    install: async options => {
      calls.push('install');
      assert.deepEqual(options.env, {});
      options.beforeInstall();
      write(path.join(root, 'package.json'), { name: 'codex-ringside', version: '0.3.0' });
      return { backup: '/test-backup' };
    }
  };
  return { directory, root, calls, options, clock, state: () => json(path.join(root, 'update-state.json')) };
}

test('stable version comparison is numeric, promotes RCs and never downgrades', () => {
  for (const [latest, current, expected] of [
    ['0.2.10', '0.2.9', true], ['0.3.0', '0.10.0', false], ['1.0.0', '0.99.99', true],
    ['0.2.0', '0.2.0', false], ['0.2.0', '0.2.0-rc.1', true], ['0.2.0-rc.2', '0.1.0', false],
    ['0.2.0', '0.2.0+local', false], ['0.2.0', '0.3.0-rc.1', false]
  ]) assert.equal(isNewer(latest, current), expected, `${latest} vs ${current}`);
  assert.throws(() => isNewer('latest', '0.2.0'), /版本号/);
});

test('only published stable releases and canonical download paths are accepted', () => {
  assert.equal(releaseInfo({ ...release(), prerelease: true }), null);
  assert.equal(releaseInfo({ ...release(), draft: true }), null);
  assert.throws(() => releaseInfo({ ...release(), tag_name: 'v../../bad' }), /正式版本/);
  const value = releaseInfo(release(), 'x64');
  assert.equal(value.base, 'https://github.com/tccpc/codex-ringside/releases/download/v0.3.0');
  assert.equal(value.asset, 'codex-ringside-v0.3.0-darwin-x64.tar.gz');
});

test('checksum selection rejects missing, malformed and ambiguous entries', () => {
  const hash = 'ab'.repeat(32);
  assert.equal(checksum(`${hash.toUpperCase()}  bundle.tar.gz\r\n`, 'bundle.tar.gz'), hash);
  assert.equal(checksum(`${hash} *bundle.tar.gz\n`, 'bundle.tar.gz'), hash);
  for (const text of ['', `${hash}  another.tar.gz`, `bad  bundle.tar.gz`, `${hash}  bundle.tar.gz\n${hash}  bundle.tar.gz`]) {
    assert.throws(() => checksum(text, 'bundle.tar.gz'), /SHA-256/);
  }
});

function archiveFixture({ corrupt = false, version = '0.3.0', symlink = false } = {}) {
  const directory = temp();
  const payload = path.join(directory, 'codex-ringside');
  const info = releaseInfo(release());
  write(path.join(payload, 'package.json'), { name: 'codex-ringside', version });
  if (symlink) fs.symlinkSync('/tmp', path.join(payload, 'outside'));
  const archive = path.join(directory, info.asset);
  execFileSync('/usr/bin/tar', ['-czf', archive, '-C', directory, 'codex-ringside']);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  const requests = [];
  const options = {
    download: async (url, destination) => {
      requests.push(url);
      if (url.endsWith('/SHA256SUMS.txt')) fs.writeFileSync(destination, `${corrupt ? '0'.repeat(64) : hash}  ${info.asset}\n`);
      else fs.copyFileSync(archive, destination);
    },
    inspect: () => ({ version })
  };
  return { directory, info, options, requests };
}

test('release archive is verified, extracted and version-checked before it can be installed', async () => {
  const h = archiveFixture();
  const work = temp();
  const payload = await prepareBundle(h.info, work, h.options);
  assert.equal(json(path.join(payload, 'package.json')).version, '0.3.0');
  assert.deepEqual(h.requests, [`${h.info.base}/SHA256SUMS.txt`, `${h.info.base}/${h.info.asset}`]);
});

for (const [options, pattern] of [
  [{ corrupt: true }, /SHA-256/], [{ version: '0.2.0' }, /版本不匹配/], [{ symlink: true }, /不安全/]
]) {
  test(`invalid archive cannot reach runtime execution: ${JSON.stringify(options)}`, async () => {
    const h = archiveFixture(options);
    await assert.rejects(prepareBundle(h.info, temp(), { ...h.options,
      inspect: () => assert.fail('invalid archive executed') }), pattern);
  });
}

test('a partially published release cannot download or execute an archive', async () => {
  const info = releaseInfo({ ...release(), assets: [] });
  await assert.rejects(prepareBundle(info, temp(), {
    download: () => assert.fail('downloaded incomplete release')
  }), /缺少安装文件/);
});

test('automatic updates honor the saved switch and interval across agent restarts', async () => {
  const h = harness();
  await setAutoUpdate(false, h.root);
  assert.equal((await runUpdate({ ...h.options, automatic: true })).status, 'skipped');
  assert.deepEqual(h.calls, []);
  await setAutoUpdate(true, h.root);
  await runUpdate({ ...h.options, automatic: true });
  assert.deepEqual(h.calls, ['check', 'prepare', 'install']);
  assert.equal(h.state().status, 'updated');
  assert.equal(h.state().nextCheckAt, h.clock.time + CHECK_MS);
  assert.equal(updateStatus(h.root).currentVersion, '0.3.0');
  assert.equal((await runUpdate({ ...h.options, automatic: true })).status, 'skipped');
  assert.equal(h.calls.length, 3);
  assert.equal(json(path.join(h.root, 'settings.json')).allowClientRestart, false);
});

test('equal or older versions are not downloaded or reinstalled', async () => {
  for (const version of ['0.1.0', '0.2.0']) {
    const h = harness();
    const result = await runUpdate({ ...h.options, getRelease: async () => release(version) });
    assert.equal(result.status, 'up-to-date');
    assert.deepEqual(h.calls, []);
  }
});

test('check-only reports availability without installing, even when automatic updates are off', async () => {
  const h = harness();
  await setAutoUpdate(false, h.root);
  assert.equal((await runUpdate({ ...h.options, checkOnly: true })).status, 'available');
  assert.deepEqual(h.calls, ['check']);
  assert.equal(updateStatus(h.root).currentVersion, '0.2.0');
  assert.equal(updateStatus(h.root).enabled, false);
});

test('network failures are recorded and retried after one hour without touching installation', async () => {
  const h = harness();
  const options = { ...h.options, automatic: true, getRelease: async () => { throw Error('offline'); } };
  await assert.rejects(runUpdate(options), /offline/);
  assert.equal(h.state().status, 'failed');
  assert.equal(h.state().error, 'offline');
  assert.equal(h.state().nextCheckAt, h.clock.time + RETRY_MS);
  assert.equal((await runUpdate(options)).status, 'skipped');
  h.clock.time += RETRY_MS;
  await runUpdate({ ...h.options, automatic: true });
  assert.equal(h.state().status, 'updated');
});

test('install failure preserves version, records retry and removes downloaded temporary files', async () => {
  const h = harness();
  let work;
  await assert.rejects(runUpdate({ ...h.options,
    prepare: async (_release, directory) => { work = directory; return directory; },
    install: async () => { throw Error('readiness failed; rolled back'); }
  }), /rolled back/);
  assert.equal(updateStatus(h.root).currentVersion, '0.2.0');
  assert.equal(h.state().status, 'failed');
  assert.equal(fs.existsSync(work), false);
});

for (const operation of ['uninstall', 'reinstall', 'disable']) {
  test(`a concurrent ${operation} cancels the downloaded update before installation`, async () => {
    const h = harness();
    await assert.rejects(runUpdate({ ...h.options, automatic: true,
      prepare: async () => {
        if (operation === 'uninstall') fs.rmSync(h.root, { recursive: true });
        else if (operation === 'disable') await setAutoUpdate(false, h.root);
        else {
          const settings = path.join(h.root, 'settings.json');
          fs.renameSync(settings, `${settings}.old`);
          write(settings, json(`${settings}.old`));
        }
        return '/unused';
      }
    }), /尚未安装|取消本次更新/);
    assert.ok(!h.calls.includes('install'));
    if (operation === 'uninstall') assert.equal(fs.existsSync(h.root), false);
  });
}

test('the install-lock guard also rejects changes that happen after download completes', async () => {
  const h = harness();
  await assert.rejects(runUpdate({ ...h.options, automatic: true, install: async options => {
    await setAutoUpdate(false, h.root);
    options.beforeInstall();
    assert.fail('installed after updates were disabled');
  } }), /取消本次更新/);
});

test('manual and automatic workers serialize their checks and release their lock on failure', async () => {
  const h = harness();
  let resume;
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const pending = runUpdate({ ...h.options, getRelease: async () => {
    entered();
    await new Promise(resolve => { resume = resolve; });
    throw Error('offline');
  } });
  await ready;
  await assert.rejects(runUpdate(h.options), /另一个安装或卸载任务/);
  resume();
  await assert.rejects(pending, /offline/);
  await runUpdate(h.options);
  assert.equal(h.state().status, 'updated');
});

test('cancellation during preparation cleans up without installing', async () => {
  const h = harness();
  const abort = new AbortController();
  let work;
  await assert.rejects(runUpdate({ ...h.options, signal: abort.signal,
    prepare: async (_release, directory) => { work = directory; abort.abort(Error('cancelled')); return directory; }
  }), /cancelled/);
  assert.equal(fs.existsSync(work), false);
  assert.ok(!h.calls.includes('install'));
});

function schedulingHarness() {
  const h = harness();
  let job = null;
  const jobs = [];
  const options = { root: h.root, node: '/private/node', logDir: '/private/logs', now: h.options.now,
    services: {
      printJob: () => job,
      bootout: async label => { jobs.push(['stop', label]); job = null; },
      writePlist: (config, file) => { jobs.push(['config', config]); write(file, config); },
      bootstrap: file => { jobs.push(['start', file]); job = 'pid = 12345'; }
    }
  };
  return { ...h, jobs, scheduling: options, setJob: value => { job = value; } };
}

test('the updater uses an independent one-shot launchd job and retains scheduled work on restart', async () => {
  const h = schedulingHarness();
  assert.equal(await scheduleUpdate(h.scheduling), true);
  const config = h.jobs.find(item => item[0] === 'config')[1];
  assert.equal(config.Label, UPDATE_LABEL);
  assert.deepEqual(config.ProgramArguments, ['/private/node', path.join(h.root, 'src/update.cjs'), '--auto']);
  assert.equal(config.KeepAlive, undefined);
  assert.equal(config.RunAtLoad, true);
  assert.equal(await scheduleUpdate(h.scheduling), false);
  // The one-shot worker may run despite the retry deadline set by its scheduler.
  assert.equal((await runUpdate({ ...h.options, automatic: true })).status, 'updated');
  assert.equal(h.jobs.filter(item => item[0] === 'start').length, 1);
});

test('a running updater is never booted out by a restarted agent', async () => {
  const h = schedulingHarness();
  h.setJob('state = running\n pid = 12345\n');
  assert.equal(await scheduleUpdate(h.scheduling), false);
  assert.deepEqual(h.jobs, []);
});

test('a launch failure backs off instead of spawning once per scan', async () => {
  const h = schedulingHarness();
  h.scheduling.services.bootstrap = () => { throw Error('bootstrap refused'); };
  await assert.rejects(scheduleUpdate(h.scheduling), /bootstrap refused/);
  assert.equal(h.state().nextCheckAt, h.clock.time + RETRY_MS);
  assert.equal(await scheduleUpdate(h.scheduling), false);
});

test('disabled auto updates do not create launchd jobs', async () => {
  const h = schedulingHarness();
  await setAutoUpdate(false, h.root);
  assert.equal(await scheduleUpdate(h.scheduling), false);
  assert.deepEqual(h.jobs, []);
});

test('clock corrections and malformed state cannot postpone checks indefinitely', () => {
  assert.equal(isDue({}, 100), true);
  assert.equal(isDue({ nextCheckAt: 100 + CHECK_MS }, 100), false);
  assert.equal(isDue({ nextCheckAt: 101 + CHECK_MS }, 100), true);
  assert.equal(isDue({ nextCheckAt: 'broken' }, 100), true);
});

test('agent shutdown clears its update scheduler before the first check', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const abort = new AbortController();
  startAutoUpdater({ root: '/nonexistent-install', signal: abort.signal, log: () => assert.fail('timer survived shutdown') });
  abort.abort();
  t.mock.timers.tick(120000);
});

test('updater job does not inherit Node injection variables', () => {
  assert.deepEqual(updateConfig({ node: '/node' }).EnvironmentVariables, { NODE_OPTIONS: '', NODE_PATH: '' });
});
