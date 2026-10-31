'use strict';
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { mergeResponse } = require('./limits.cjs');

// Minimal JSON-RPC client for `codex app-server` over stdio. Only ever asks for rate limits.
class AppServerClient extends EventEmitter {
  constructor({ command, args = ['app-server'], version = '0', requestTimeoutMs = 15000 }) {
    super();
    Object.assign(this, { command, args, version, requestTimeoutMs });
    this.child = null;
    this.lines = null;
    this.pending = new Map();
    this.serial = 0;
    this.rateLimits = null;
  }

  async start() {
    if (this.child) return;
    const child = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    this.child = child;
    const fail = error => {
      if (this.child !== child) return;
      this.stop();
      this.emit('server-exit', error);
    };
    child.once('error', fail);
    child.once('exit', code => fail(new Error(`App Server exited (${code})`)));
    child.stdin.on('error', fail);
    child.stderr.resume(); // Drain it: the stream can carry account details, so it is never logged.
    this.lines = readline.createInterface({ input: child.stdout });
    this.lines.on('line', line => this.handleLine(line));
    await this.request('initialize', {
      clientInfo: { name: 'codex_ringside', title: 'Codex Ringside', version: this.version }
    });
    this.child?.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
    await this.refresh();
  }

  handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (!message || typeof message !== 'object') return;
    const request = this.pending.get(message.id);
    if (request) {
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message || 'App Server request failed'));
      else request.resolve(message.result);
    } else if (message.method === 'account/rateLimits/updated') {
      this.rateLimits = mergeResponse(this.rateLimits, message.params);
      this.emit('rate-limits', this.rateLimits);
    }
  }

  request(method, params) {
    if (!this.child?.stdin.writable) return Promise.reject(new Error('App Server is not running'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const body = JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) });
      this.child.stdin.write(`${body}\n`, error => {
        if (error && this.pending.delete(id)) {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  async refresh() {
    this.rateLimits = mergeResponse(null, await this.request('account/rateLimits/read'));
    this.emit('rate-limits', this.rateLimits);
    return this.rateLimits;
  }

  stop() {
    const child = this.child;
    this.child = null;
    this.lines?.close();
    this.lines = null;
    if (child && !child.killed) child.kill();
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error('App Server stopped'));
    }
    this.pending.clear();
  }
}

module.exports = { AppServerClient };
