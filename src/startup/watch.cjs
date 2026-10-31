'use strict';
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const readline = require('node:readline');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { CDP_PORT } = require('../cdp.cjs');
const { StartupController } = require('./controller.cjs');

const run = promisify(execFile);

function portInUse(port = CDP_PORT) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = value => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => done(true));
    socket.once('error', error => done(error.code !== 'ECONNREFUSED'));
    socket.setTimeout(350, () => done(true));
  });
}

function readState(file) {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Number.isFinite(state.lastAttemptAt ?? 0) ? state : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function startWatcher({ root, settings, log }) {
  const bridgePath = path.join(root, 'bridge');
  const stateFile = path.join(root, 'state.json');
  const abort = new AbortController();
  let state = readState(stateFile);

  const native = async (action, ...args) => {
    const { stdout } = await run(bridgePath, [action, settings.app, ...args.map(String)], {
      timeout: 35000, maxBuffer: 65536, signal: abort.signal
    });
    return JSON.parse(stdout);
  };

  const adapter = {
    snapshot: () => native('snapshot'),
    quit: (app, stamp) => native('quit', app.pid, app.key, stamp),
    launch: () => native('launch', CDP_PORT),
    show: (app, stamp, frontmost) => native('show', app.pid, app.key, stamp, frontmost),
    portInUse,
    async record(event, details = {}) {
      state = { ...state, ...details, event, updatedAt: Date.now() };
      const temp = `${stateFile}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temp, stateFile);
      log(`startup: ${event}`);
    }
  };

  const controller = new StartupController(adapter, {
    lastAttemptAt: state.lastAttemptAt || 0,
    allowClientRestart: settings.allowClientRestart
  });

  let stopped = false;
  let queued = false;
  let pumping = false;
  let pendingTimer;

  async function pump() {
    queued = true;
    if (pumping || stopped) return;
    pumping = true;
    clearTimeout(pendingTimer);
    try {
      while (queued && !stopped) {
        queued = false;
        await controller.tick();
      }
    } finally {
      pumping = false;
      if (controller.pendingLaunch && !stopped) pendingTimer = setTimeout(pump, 300);
    }
  }

  // NSWorkspace notifications, so nothing spawns native processes while Codex is idle.
  const observer = spawn(bridgePath, ['watch', settings.app], { stdio: ['ignore', 'pipe', 'ignore'] });
  const lines = readline.createInterface({ input: observer.stdout });
  lines.on('line', () => pump());

  const stop = () => {
    if (stopped) return;
    stopped = true;
    controller.stop();
    clearTimeout(pendingTimer);
    abort.abort();
    observer.kill('SIGTERM');
  };

  // launchd restarts the whole agent, and the fresh baseline keeps that restart harmless.
  const exited = new Promise(resolve => {
    observer.once('error', resolve);
    observer.once('exit', resolve);
  }).then(() => {
    if (!stopped) throw new Error('bridge watcher exited');
  });

  return { stop, exited };
}

module.exports = { portInUse, readState, startWatcher };
