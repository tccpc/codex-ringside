'use strict';
// Executed using the Node from the actual release archive. No real services or host UI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const [payload, temp] = process.argv.slice(2);
const { install, uninstall } = require(path.join(payload, 'src/install.cjs'));
const { agentConfig } = require(path.join(payload, 'src/launchd.cjs'));
const { prepareBundle, runUpdate, updateStatus } = require(path.join(payload, 'src/update.cjs'));
const { version } = require(path.join(payload, 'package.json'));
let installedVersion = version;
const location = name => ({ installDir: path.join(temp, name), logDir: path.join(temp, `logs-${name}`), plist: path.join(temp, `${name}.plist`), label: name });
const current = location('Application Support');
const legacy = location('Legacy');
const host = path.join(temp, 'Test Host.app');
fs.mkdirSync(path.join(host, 'Contents/Resources'), { recursive: true });
fs.writeFileSync(path.join(host, 'Contents/Resources/codex'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
const running = new Set();
const options = {
  repoRoot: payload, current, legacy, backupRoot: path.join(temp, 'backups'), trashRoot: path.join(temp, 'trash'),
  env: { CODEX_RINGSIDE_APP: host }, observe: true,
  compile: () => { throw Error('Standalone installation attempted to compile'); },
  services: {
    agentConfig, printJob: label => running.has(label),
    bootout: async label => { running.delete(label); },
    writePlist: (config, file) => fs.writeFileSync(file, JSON.stringify(config)),
    bootstrap: () => { running.add(current.label); }
  },
  waitReady: () => {
    const config = JSON.parse(fs.readFileSync(current.plist));
    assert.equal(config.ProgramArguments[0], path.join(current.installDir, 'runtime/node'));
    assert.ok(!config.ProgramArguments[0].startsWith(payload));
    const launcher = path.join(current.installDir, 'bin/codex-ringside');
    assert.equal(execFileSync(launcher, ['--version'], { encoding: 'utf8' }).trim(), installedVersion);
  }
};

async function main() {
  await install(options);
  // Upgrade from the installed copy, with preserved settings and a failing watcher rollback.
  const background = path.join(current.installDir, 'background.json');
  fs.writeFileSync(background, JSON.stringify({ source: 'glass', transparency: 42 }));
  await install({ ...options, repoRoot: current.installDir });
  assert.equal(JSON.parse(fs.readFileSync(background)).transparency, 42);
  // A wrong-architecture or damaged bundle fails before a running installation is stopped.
  const metadataFile = path.join(payload, 'standalone.json');
  const metadata = fs.readFileSync(metadataFile, 'utf8');
  fs.writeFileSync(metadataFile, JSON.stringify({ ...JSON.parse(metadata), arch: 'wrong-arch' }));
  await assert.rejects(install(options), /架构或版本不匹配/);
  assert.ok(running.has(current.label));
  fs.writeFileSync(metadataFile, metadata);
  const bridge = path.join(payload, 'bridge');
  fs.renameSync(bridge, `${bridge}.saved`);
  await assert.rejects(install(options), /ENOENT/);
  assert.ok(running.has(current.label));
  fs.renameSync(`${bridge}.saved`, bridge);
  await assert.rejects(install({ ...options, waitReady: () => { throw Error('not ready'); } }), /not ready/);
  assert.equal(JSON.parse(fs.readFileSync(background)).transparency, 42);

  // Exercise the updater with a real release archive, real private Node/helper and a local fake CDN.
  const nextVersion = '999.0.0';
  const remote = path.join(temp, 'remote');
  const nextPayload = path.join(remote, 'codex-ringside');
  fs.cpSync(payload, nextPayload, { recursive: true });
  for (const name of ['package.json', 'standalone.json']) {
    const file = path.join(nextPayload, name);
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file)), version: nextVersion }));
  }
  const asset = `codex-ringside-v${nextVersion}-darwin-${process.arch}.tar.gz`;
  const archive = path.join(remote, asset);
  execFileSync('/usr/bin/tar', ['-czf', archive, '-C', remote, 'codex-ringside']);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(path.join(remote, 'SHA256SUMS.txt'), `${hash}  ${asset}\n`);
  const updateOptions = {
    root: current.installDir,
    getRelease: async () => ({ tag_name: `v${nextVersion}`, draft: false, prerelease: false,
      assets: [asset, 'SHA256SUMS.txt'].map(name => ({ name, state: 'uploaded' })) }),
    prepare: (release, work) => prepareBundle(release, work, {
      download: async (url, destination) => fs.copyFileSync(path.join(remote, url.split('/').pop()), destination)
    }),
    install: update => install({ ...options, ...update })
  };
  await assert.rejects(runUpdate({ ...updateOptions,
    install: update => install({ ...options, ...update, waitReady: () => { throw Error('update not ready'); } })
  }), /update not ready/);
  assert.equal(updateStatus(current.installDir).currentVersion, version);
  assert.equal(updateStatus(current.installDir).status, 'failed');
  assert.equal(JSON.parse(fs.readFileSync(background)).transparency, 42);
  installedVersion = nextVersion;
  assert.equal((await runUpdate(updateOptions)).status, 'updated');
  assert.equal(updateStatus(current.installDir).currentVersion, nextVersion);
  assert.equal(JSON.parse(fs.readFileSync(path.join(current.installDir, 'settings.json'))).allowClientRestart, false);
  assert.equal(JSON.parse(fs.readFileSync(background)).transparency, 42);
  assert.equal((await runUpdate({ ...updateOptions, automatic: true })).status, 'skipped');

  // The installed CLI still runs even after the downloaded extraction is removed.
  fs.rmSync(payload, { recursive: true });
  assert.equal(execFileSync(path.join(current.installDir, 'bin/codex-ringside'), ['--version'], { encoding: 'utf8' }).trim(), installedVersion);
  await uninstall(options);
  assert.equal(fs.existsSync(current.installDir), false);
  assert.equal(running.size, 0);
  console.log('Standalone OK: private Node, prebuilt helper, paths with spaces, verified updates, rollback and uninstall; no system compiler or Node');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
