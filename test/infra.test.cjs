'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { assertLoopback, buildBootstrapScript, isMainWindow } = require('../src/cdp.cjs');
const { LABEL, agentConfig, paths, plistXml, trashItems } = require('../src/launchd.cjs');

test('CDP only accepts loopback WebSockets on the expected port', () => {
  assert.doesNotThrow(() => assertLoopback('ws://127.0.0.1:39222/devtools/page/x'));
  assert.doesNotThrow(() => assertLoopback('ws://localhost:39222/devtools/page/x'));
  for (const url of [
    'ws://192.168.1.5:39222/x',
    'ws://evil.example:39222/x',
    'ws://127.0.0.1:9222/x',
    'wss://127.0.0.1:39222/x',
    'http://127.0.0.1:39222/x',
    'ws://127.0.0.1.evil.example:39222/x'
  ]) {
    assert.throws(() => assertLoopback(url), /loopback/, url);
  }
});

test('only app windows count as main windows', () => {
  const page = (url, extra = {}) => ({ type: 'page', url, webSocketDebuggerUrl: 'ws://127.0.0.1:39222/x', ...extra });
  assert.equal(isMainWindow(page('app://-/index.html?hostId=local')), true);
  assert.equal(isMainWindow(page('app://-/index.html?overlay=1')), false);
  assert.equal(isMainWindow(page('app://-/detached-window.html')), false);
  assert.equal(isMainWindow(page('https://example.com/')), false);
  assert.equal(isMainWindow(page('app://-/index.html', { type: 'webview' })), false);
  assert.equal(isMainWindow(page('app://-/index.html', { webSocketDebuggerUrl: undefined })), false);
  assert.equal(isMainWindow(page('not a url')), false);
});

test('the bootstrap script is valid JavaScript', () => {
  assert.doesNotThrow(() => new Function(buildBootstrapScript()));
});

test('uninstall gives every installed item its own name in the Trash', () => {
  const names = trashItems().map(([, name]) => name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(trashItems().map(([file]) => file), [paths.installDir, paths.logDir, paths.plist]);
});

test('the LaunchAgent restarts on failure and runs the installed copy', () => {
  const config = agentConfig({ node: '/opt/homebrew/bin/node', installDir: '/x/Code & Plus', logDir: '/logs' });
  assert.equal(config.Label, LABEL);
  assert.deepEqual(config.ProgramArguments, ['/opt/homebrew/bin/node', '/x/Code & Plus/src/agent.cjs']);
  assert.deepEqual(config.KeepAlive, { SuccessfulExit: false });
  const xml = plistXml(config);
  assert.ok(xml.includes('<string>/x/Code &amp; Plus/src/agent.cjs</string>'));
  assert.ok(xml.includes('<key>RunAtLoad</key><true/>'));
});
