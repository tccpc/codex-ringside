'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { install, uninstall } = require('../src/install.cjs');
const { agentConfig, plistXml } = require('../src/launchd.cjs');

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
}

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ringside-install-'));
  roots.push(root);
  const location = name => ({ installDir: path.join(root, name), logDir: path.join(root, 'logs', name), plist: path.join(root, 'agents', `${name}.plist`), label: name });
  const current = location('new');
  const legacy = location('old');
  const active = new Set();
  const events = [];
  const options = {
    current, legacy, backupRoot: path.join(root, 'backups'), trashRoot: path.join(root, 'trash'), env: {},
    preflight: settings => ({ app: settings.app, node: '/node' }),
    compile: (_repo, stage) => { events.push('compile'); write(path.join(stage, 'bridge'), 'compiled'); },
    waitReady: async () => { events.push('ready'); },
    services: {
      agentConfig,
      printJob: label => active.has(label),
      bootout: async label => { events.push(`stop:${label}`); active.delete(label); },
      writePlist: (config, file) => write(file, plistXml(config)),
      bootstrap: file => {
        const label = file === current.plist ? current.label : legacy.label;
        events.push(`start:${label}`); active.add(label);
      }
    }
  };
  function seed(location, { observe = false, image, transparency = 37 } = {}) {
    write(path.join(location.installDir, 'settings.json'), { app: '/Applications/Custom.app', allowClientRestart: !observe });
    write(path.join(location.installDir, 'background.json'), { source: image ? 'image' : 'glass', image: image ?? null, transparency });
    write(path.join(location.installDir, 'background', 'cached.jpg'), 'image');
    write(path.join(location.installDir, 'state.json'), { lastAttemptAt: 12345, event: 'old-event' });
    write(path.join(location.installDir, 'old-code.cjs'), 'old code');
    write(path.join(location.logDir, 'agent.log'), 'old log');
    write(location.plist, 'old plist');
    active.add(location.label);
  }
  return { root, current, legacy, active, events, options, seed };
}

test('a fresh install applies the bundled picture and preset using a permanent local path', async () => {
  const h = harness();
  await install(h.options);
  const image = path.join(h.current.installDir, 'user-images/default-background.png');
  assert.deepEqual(json(path.join(h.current.installDir, 'background.json')), {
    source: 'image', image, transparency: 0, blur: 0, zoom: 134, x: 0, y: 0,
    brightness: 100, contrast: 100, saturation: 100, layout: 'cover', crop: null
  });
  assert.deepEqual(fs.readFileSync(image), fs.readFileSync(path.join(__dirname, '../src/presets/wallpaper.png')));
});

test('reinstall preserves the installed picture and edits even when the bundled preset changes', async () => {
  const h = harness();
  await install(h.options);
  const file = path.join(h.current.installDir, 'background.json');
  const original = json(file);
  const picture = fs.readFileSync(original.image);
  const changedBundle = { ...h.options, compile: (_repo, stage) => {
    write(path.join(stage, 'bridge'), 'compiled');
    write(path.join(stage, 'src/presets/wallpaper.png'), 'a different bundled picture');
    write(path.join(stage, 'src/presets/default-background.json'), { source: 'image', image: 'wallpaper.png', zoom: 200 });
  } };
  await install(changedBundle);
  assert.deepEqual(json(file), original);
  assert.deepEqual(fs.readFileSync(original.image), picture);
  const edited = { ...original, transparency: 37, blur: 12, zoom: 175, x: 23, y: 68,
    brightness: 85, contrast: 115, saturation: 70, layout: 'contain', crop: { x: 0.1, y: 0.2, w: 0.7, h: 0.6 } };
  write(file, edited);
  await install(changedBundle);
  assert.deepEqual(json(file), edited);
  assert.deepEqual(fs.readFileSync(edited.image), picture);
});

for (const location of ['current', 'legacy']) {
  test(`an existing ${location} install without background settings keeps its implicit default`, async () => {
    const h = harness(); h.seed(h[location]);
    fs.rmSync(path.join(h[location].installDir, 'background.json'));
    await install(h.options);
    await install(h.options);
    assert.equal(fs.existsSync(path.join(h.current.installDir, 'background.json')), false);
    assert.equal(fs.existsSync(path.join(h.current.installDir, 'user-images/default-background.png')), false);
  });
}

for (const source of ['default', 'wallpaper', 'glass']) {
  test(`reinstall preserves the user's explicit ${source} source`, async () => {
    const h = harness(); h.seed(h.current);
    const file = path.join(h.current.installDir, 'background.json');
    const config = { source, image: null, transparency: 61, blur: 9 };
    write(file, config);
    await install(h.options);
    assert.deepEqual(json(file), config);
  });
}

test('current background settings survive even without a settings.json', async () => {
  const h = harness(); h.seed(h.legacy);
  const file = path.join(h.current.installDir, 'background.json');
  const config = { source: 'default', transparency: 82 };
  write(file, config);
  await install(h.options);
  assert.deepEqual(json(file), config);
});

test('a missing bundled picture fails a fresh install before stopping services', async () => {
  const h = harness();
  await assert.rejects(install({ ...h.options, compile: (_repo, stage) => {
    fs.rmSync(path.join(stage, 'src/presets/wallpaper.png'));
  } }), /ENOENT/);
  assert.deepEqual(h.events, []);
  assert.equal(fs.existsSync(h.current.installDir), false);
});

test('a failed fresh install rolls back and a retry still applies the preset', async () => {
  const h = harness();
  await assert.rejects(install({ ...h.options, waitReady: () => { throw Error('not ready'); } }), /not ready/);
  assert.equal(fs.existsSync(h.current.installDir), false);
  assert.equal(h.active.size, 0);
  await install(h.options);
  assert.equal(json(path.join(h.current.installDir, 'background.json')).source, 'image');
});

test('migration preserves settings, images and cooldown and retires the old service', async () => {
  const h = harness();
  const image = path.join(h.legacy.installDir, 'picture.png');
  h.seed(h.legacy, { observe: true, image }); write(image, 'original image');
  const result = await install(h.options);
  const config = json(path.join(h.current.installDir, 'background.json'));
  assert.equal(fs.readFileSync(config.image, 'utf8'), 'original image');
  assert.ok(config.image.startsWith(h.current.installDir));
  assert.equal(config.transparency, 37);
  assert.deepEqual(result.settings, { app: '/Applications/Custom.app', allowClientRestart: false, autoUpdate: true });
  assert.deepEqual(json(path.join(h.current.installDir, 'state.json')), { lastAttemptAt: 12345 });
  assert.deepEqual([...h.active], ['new']);
  assert.ok(h.events.indexOf('compile') < h.events.indexOf('stop:old'));
  assert.equal(fs.existsSync(h.legacy.installDir), false);
  assert.equal(fs.existsSync(h.legacy.plist), false);
  assert.equal(fs.readFileSync(path.join(result.backup, '1/installDir/picture.png'), 'utf8'), 'original image');
  for (const name of ['LICENSE', 'NOTICE', 'bridge']) assert.ok(fs.existsSync(path.join(h.current.installDir, name)));
});

test('compile failure leaves the running installation untouched', async () => {
  const h = harness(); h.seed(h.legacy);
  await assert.rejects(install({ ...h.options, compile: () => { throw Error('compiler unavailable'); } }), /compiler unavailable/);
  assert.deepEqual([...h.active], ['old']);
  assert.deepEqual(h.events, []);
  assert.equal(fs.readFileSync(h.legacy.plist, 'utf8'), 'old plist');
  assert.equal(fs.existsSync(h.current.installDir), false);
});

test('bootstrap failure restores the old files, plist and running state', async () => {
  const h = harness(); h.seed(h.legacy);
  const original = h.options.services.bootstrap;
  h.options.services.bootstrap = file => { if (file === h.current.plist) throw Error('bootstrap refused'); original(file); };
  await assert.rejects(install(h.options), /bootstrap refused/);
  assert.deepEqual([...h.active], ['old']);
  assert.equal(fs.readFileSync(h.legacy.plist, 'utf8'), 'old plist');
  assert.equal(fs.existsSync(h.current.installDir), false);
});

test('readiness failure restores an existing Ringside installation', async () => {
  const h = harness(); h.seed(h.current, { observe: true });
  await assert.rejects(install({ ...h.options, waitReady: () => { throw Error('watcher timeout'); } }), /watcher timeout/);
  assert.deepEqual([...h.active], ['new']);
  assert.equal(fs.readFileSync(path.join(h.current.installDir, 'old-code.cjs'), 'utf8'), 'old code');
  assert.equal(fs.readFileSync(h.current.plist, 'utf8'), 'old plist');
  assert.equal(json(path.join(h.current.installDir, 'settings.json')).allowClientRestart, false);
});

test('new settings win when both installations exist, including repeated installation', async () => {
  const h = harness(); h.seed(h.legacy, { transparency: 5 }); h.seed(h.current, { observe: true, transparency: 81 });
  await install(h.options);
  await install(h.options);
  assert.equal(json(path.join(h.current.installDir, 'background.json')).transparency, 81);
  assert.equal(json(path.join(h.current.installDir, 'settings.json')).allowClientRestart, false);
  assert.deepEqual([...h.active], ['new']);
});

test('explicit new app variable wins over the legacy variable and saved app', async () => {
  const h = harness(); h.seed(h.legacy);
  const result = await install({ ...h.options, observe: true, env: { CODEX_RINGSIDE_APP: '/new.app', CODEX_PLUS_APP: '/old.app' } });
  assert.deepEqual(result.settings, { app: '/new.app', allowClientRestart: false, autoUpdate: true });
});

test('legacy app variable remains usable on a fresh install', async () => {
  const h = harness();
  const result = await install({ ...h.options, env: { CODEX_PLUS_APP: '/old.app' } });
  assert.deepEqual(result.settings, { app: '/old.app', allowClientRestart: true, autoUpdate: true });
});

test('rollback does not start a service that was stopped before installation', async () => {
  const h = harness(); h.seed(h.legacy); h.active.clear();
  await assert.rejects(install({ ...h.options, waitReady: () => { throw Error('not ready'); } }), /not ready/);
  assert.equal(h.active.size, 0);
  assert.ok(fs.existsSync(h.legacy.plist));
});

test('corrupt settings fail before stopping services', async () => {
  const h = harness(); h.seed(h.legacy); write(path.join(h.legacy.installDir, 'settings.json'), '{');
  await assert.rejects(install(h.options), /无法读取设置/);
  assert.deepEqual([...h.active], ['old']);
  assert.deepEqual(h.events, []);
});

test('uninstall moves both installations to distinct trash entries and is repeatable', async () => {
  const h = harness(); h.seed(h.current); h.seed(h.legacy);
  const trash = await uninstall(h.options);
  assert.equal(fs.readdirSync(trash).length, 6);
  assert.equal(h.active.size, 0);
  for (const location of [h.current, h.legacy]) assert.equal(fs.existsSync(location.installDir), false);
  assert.equal(await uninstall(h.options), null);
});

test('a partially failed uninstall puts moved files back and restarts the original jobs', async t => {
  const h = harness(); h.seed(h.current);
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (from === h.current.logDir) throw Error('cannot move logs');
    return rename(from, to);
  });
  await assert.rejects(uninstall(h.options), /cannot move logs/);
  assert.ok(fs.existsSync(h.current.installDir));
  assert.ok(fs.existsSync(h.current.plist));
  assert.deepEqual([...h.active], ['new']);
});

test('concurrent operations are rejected without disturbing the running operation', async () => {
  const h = harness();
  let resume;
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const pending = install({ ...h.options, compile: async () => { entered(); await new Promise(resolve => { resume = resolve; }); } });
  await ready;
  await assert.rejects(uninstall(h.options), /另一个安装或卸载任务/);
  resume(); await pending;
  assert.deepEqual([...h.active], ['new']);
});

test('CLI help and version work without an installed host or compiler', () => {
  const cli = path.resolve(__dirname, '../bin/codex-ringside.cjs');
  const env = { ...process.env, CODEX_RINGSIDE_APP: '/missing-host.app' };
  assert.match(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env }), /codex-ringside/);
  assert.equal(execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8', env }).trim(), require('../package.json').version);
});

test('automatic update settings and diagnostic history survive reinstall', async () => {
  const h = harness(); h.seed(h.current, { observe: true });
  const settings = path.join(h.current.installDir, 'settings.json');
  write(settings, { ...json(settings), autoUpdate: false });
  write(path.join(h.current.installDir, 'update-state.json'), { lastCheckedAt: 1234, nextCheckAt: 5678 });
  await install(h.options);
  assert.equal(json(settings).autoUpdate, false);
  assert.deepEqual(json(path.join(h.current.installDir, 'update-state.json')), { lastCheckedAt: 1234, nextCheckAt: 5678 });
});

test('stale automatic updates fail under the install lock before stopping services', async () => {
  const h = harness(); h.seed(h.current);
  await assert.rejects(install({ ...h.options, beforeInstall: () => { throw Error('stale installation'); } }), /stale installation/);
  assert.deepEqual(h.events, []);
  assert.deepEqual([...h.active], ['new']);
});

test('uninstall stops the independent updater before moving installed files', async () => {
  const h = harness(); h.seed(h.current);
  h.active.add('com.codexringside.update');
  await uninstall(h.options);
  assert.equal(h.events[0], 'stop:com.codexringside.update');
  assert.equal(h.active.size, 0);
});
