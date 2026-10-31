'use strict';
const fs = require('node:fs');
const path = require('node:path');

const CDP_PORT = 39222;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const PANEL_BINDING = '__codexRingsideSend';

// The endpoint can run code inside Codex, so never follow a target to anywhere but this machine.
function assertLoopback(url, port = CDP_PORT) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'ws:' || !LOOPBACK_HOSTS.has(parsed.hostname) || Number(parsed.port) !== port) {
    throw new Error(`CDP must use a loopback WebSocket on port ${port}`);
  }
  return parsed;
}

function isMainWindow(target) {
  if (target?.type !== 'page' || typeof target.webSocketDebuggerUrl !== 'string') return false;
  try {
    const url = new URL(target.url || '');
    return url.protocol === 'app:' && !/overlay|detached/i.test(decodeURIComponent(url.pathname + url.search + url.hash));
  } catch {
    return false;
  }
}

function buildBootstrapScript() {
  const [card, background] = ['card.js', 'background.js'].map(name => fs.readFileSync(path.join(__dirname, name), 'utf8'));
  return `(() => {\nwindow.__codexPlusCard?.destroy?.();\nwindow.__codexPlusBackground?.destroy?.();\n${card}\n${background}\ninstallCodexRingsideCard();\ninstallCodexRingsideBackground();\n})()`;
}

const updateExpression = value => `window.__codexRingsideCard?.update(${JSON.stringify(value)})`;
const backgroundCall = (method, ...args) => `window.__codexRingsideBackground?.${method}(${args.map(arg => JSON.stringify(arg)).join(', ')})`;

async function listTargets(port = CDP_PORT, timeoutMs = 3000) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error('CDP unavailable');
  return response.json();
}

class CdpSession {
  constructor(target, port = CDP_PORT) {
    this.target = target;
    this.port = port;
    this.pending = new Map();
    this.serial = 0;
    this.socket = null;
    this.onBinding = null;
  }

  async connect() {
    const ws = new WebSocket(assertLoopback(this.target.webSocketDebuggerUrl, this.port));
    this.socket = ws;
    ws.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message?.method === 'Runtime.bindingCalled') this.onBinding?.(message.params);
      const request = this.pending.get(message?.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error || message.result?.exceptionDetails) request.reject(new Error('CDP evaluation failed'));
      else request.resolve(message.result);
    });
    ws.addEventListener('close', () => this.rejectPending());
    ws.addEventListener('error', () => this.rejectPending());
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('CDP handshake timed out'));
      }, 4000);
      const finish = fn => {
        clearTimeout(timer);
        fn();
      };
      ws.addEventListener('open', () => finish(resolve), { once: true });
      ws.addEventListener('error', () => finish(() => reject(new Error('CDP unavailable'))), { once: true });
      ws.addEventListener('close', () => finish(() => reject(new Error('CDP closed'))), { once: true });
    });
    await this.request('Runtime.enable');
  }

  request(method, params = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP disconnected'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CDP request timed out'));
      }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  evaluate(expression) {
    return this.request('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  }

  rejectPending() {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('CDP disconnected'));
    }
    this.pending.clear();
  }

  close() {
    this.rejectPending();
    this.socket?.close();
    this.socket = null;
  }
}

// Keeps one session per main window; a scan installs the card and replays the latest value.
class RendererInjector {
  constructor({ port = CDP_PORT } = {}) {
    this.port = port;
    this.sessions = new Map();
    this.currentValue = null;
    this.background = null;
    this.onPanelMessage = null;
    this.scanning = false;
    this.stopped = false;
  }

  async connectSession(session) {
    session.onBinding = ({ name, payload }) => {
      if (name === PANEL_BINDING) this.onPanelMessage?.(payload);
    };
    await session.connect();
    await session.request('Runtime.addBinding', { name: PANEL_BINDING });
  }

  // Images travel once: a window that already has one only needs the new settings.
  async syncBackground(session) {
    if (!this.background) return;
    const { payload, files } = this.background;
    const { result } = await session.evaluate(backgroundCall('state'));
    const state = result.value;
    if (!state || state.key === payload.key) return;
    for (const [id, file] of Object.entries(files)) {
      if (!state.images.includes(id)) await session.evaluate(backgroundCall('addImage', id, fs.readFileSync(file, 'base64')));
    }
    await session.evaluate(backgroundCall('apply', payload));
  }

  async scan() {
    if (this.scanning || this.stopped) return;
    this.scanning = true;
    try {
      const pages = (await listTargets(this.port)).filter(isMainWindow);
      const live = new Set(pages.map(target => target.id));
      for (const [id, session] of this.sessions) {
        if (!live.has(id)) {
          session.close();
          this.sessions.delete(id);
        }
      }
      const script = buildBootstrapScript();
      await Promise.all(pages.map(async target => {
        const existing = this.sessions.get(target.id);
        const session = existing ?? new CdpSession(target, this.port);
        try {
          if (!existing) await this.connectSession(session);
          await session.evaluate(script);
          if (this.currentValue) await session.evaluate(updateExpression(this.currentValue));
          await this.syncBackground(session);
          if (this.stopped) {
            session.close();
            return;
          }
          this.sessions.set(target.id, session);
        } catch {
          session.close();
          this.sessions.delete(target.id);
        }
      }));
    } finally {
      this.scanning = false;
    }
  }

  clearSessions() {
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
  }

  async eachSession(action) {
    await Promise.all([...this.sessions].map(async ([id, session]) => {
      try {
        await action(session);
      } catch {
        session.close();
        this.sessions.delete(id);
      }
    }));
  }

  async update(value) {
    this.currentValue = value;
    await this.eachSession(session => session.evaluate(updateExpression(value)));
  }

  async setBackground(background) {
    this.background = background;
    await this.eachSession(session => this.syncBackground(session));
  }

  async notifyBackground(message) {
    await this.eachSession(session => session.evaluate(backgroundCall('notify', message)));
  }

  stop() {
    this.stopped = true;
    this.clearSessions();
  }
}

module.exports = { CDP_PORT, CdpSession, RendererInjector, assertLoopback, buildBootstrapScript, isMainWindow, listTargets };
