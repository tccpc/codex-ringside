'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { AppServerClient } = require('./app-server.cjs');
const { BackgroundStore, readScreens } = require('./background.cjs');
const { CDP_PORT, RendererInjector } = require('./cdp.cjs');
const { formatUsage, unavailable } = require('./limits.cjs');
const { authFile, resolveCodexBin } = require('./resolve.cjs');
const { version } = require('../package.json');

const SCAN_MS = 5000;
const POLL_MS = 60000;

const log = message => process.stdout.write(`[${new Date().toISOString()}] ${message}\n`);

// Only the timestamp is read. Account switchers such as Cockpit Tools rewrite this file.
function authStamp() {
  try {
    return fs.statSync(authFile()).mtimeMs;
  } catch {
    return null;
  }
}

async function runAgent({ appPath, root, signal }) {
  const injector = new RendererInjector({ port: CDP_PORT });
  injector.currentValue = { rings: [], message: '正在读取 Codex 剩余额度' };
  const background = new BackgroundStore({ root, readScreens: () => readScreens(root, appPath) });
  let backgroundWork = Promise.resolve();
  let client = null;
  let reading = false;
  let nextRead = 0;
  let failures = 0;
  let connected = false;
  let seenAuth = authStamp();
  let ticking = false;

  const dropClient = () => {
    const old = client;
    client = null;
    old?.stop();
  };
  const showUnavailable = () => injector.update(unavailable(injector.currentValue)).catch(() => {});

  async function scan() {
    try {
      await injector.scan();
      if (!connected && injector.sessions.size > 0) log('connected to Codex window');
      connected = injector.sessions.size > 0;
    } catch {
      connected = false;
      injector.clearSessions();
    }
    // No window to draw on means nothing to read: stop the app-server until Codex is back.
    if (injector.sessions.size === 0) {
      dropClient();
      nextRead = 0;
      injector.currentValue = unavailable(injector.currentValue);
    }
  }

  function checkAccount() {
    const stamp = authStamp();
    if (stamp === seenAuth) return;
    seenAuth = stamp;
    log('account file changed, reconnecting');
    dropClient();
    nextRead = 0;
  }

  function createClient() {
    const current = new AppServerClient({ command: resolveCodexBin(appPath), version });
    current.on('rate-limits', data => {
      if (client !== current) return;
      injector.update({ ...formatUsage(data), updatedAt: Date.now(), stale: false }).catch(() => {});
    });
    current.on('server-exit', () => {
      if (client !== current) return;
      client = null;
      nextRead = Date.now() + 10000;
      showUnavailable();
    });
    return current;
  }

  async function readUsage() {
    if (reading || Date.now() < nextRead || injector.sessions.size === 0) return;
    reading = true;
    try {
      if (client) {
        await client.refresh();
      } else {
        client = createClient();
        await client.start();
      }
      failures = 0;
      if (client) nextRead = Date.now() + POLL_MS;
    } catch {
      dropClient();
      failures++;
      nextRead = Date.now() + Math.min(POLL_MS, 10000 * failures);
      await showUnavailable();
    } finally {
      reading = false;
    }
  }

  // One job at a time: a panel change and a scan must not convert or prune images together.
  function queueBackground(job) {
    backgroundWork = backgroundWork
      .then(job)
      .then(next => next && injector.setBackground(next))
      .catch(error => log(`background: ${error.message}`));
  }

  injector.onPanelMessage = text => queueBackground(async () => {
    try {
      await background.commit(JSON.parse(text));
    } catch (error) {
      await injector.notifyBackground(error.message);
      return null;
    }
    return background.rebuild();
  });

  async function tick() {
    if (ticking || signal.aborted) return;
    ticking = true;
    try {
      await scan();
      checkAccount();
      readUsage().catch(() => {});
      if (injector.sessions.size > 0) queueBackground(() => background.refresh());
    } finally {
      ticking = false;
    }
  }

  const timer = setInterval(() => tick().catch(() => {}), SCAN_MS);
  signal.addEventListener('abort', () => {
    clearInterval(timer);
    dropClient();
    injector.stop();
  }, { once: true });
  await tick();
}

function loadSettings(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'));
}

async function main() {
  const { startWatcher } = require('./startup/watch.cjs');
  const root = path.resolve(__dirname, '..');
  const settings = loadSettings(root);
  const abort = new AbortController();
  log(`codex-ringside ${version} started`);

  const watcher = startWatcher({ root, settings, log });
  const shutdown = () => {
    abort.abort();
    watcher.stop();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await runAgent({ appPath: settings.app, root, signal: abort.signal });
  await watcher.exited;
}

module.exports = { loadSettings, runAgent };

if (require.main === module) {
  main().catch(error => {
    log(`fatal: ${error.message}`);
    process.exitCode = 1;
  });
}
