'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ringside-package-'));
try {
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp], { cwd: root, encoding: 'utf8' }));
  const names = new Set(pack.files.map(file => file.path));
  const allowed = /^(?:package\.json|README(?:\.zh-CN)?\.md|LICENSE|NOTICE|CHANGELOG\.md|bin\/codex-ringside\.cjs|native\/bridge\.swift|src\/(?:[\w-]+\/)*[\w-]+\.(?:cjs|js))$/;
  for (const name of names) assert.ok(allowed.test(name), `Unexpected published file: ${name}`);
  for (const name of ['package.json', 'README.md', 'README.zh-CN.md', 'LICENSE', 'NOTICE', 'CHANGELOG.md', 'bin/codex-ringside.cjs', 'native/bridge.swift', 'src/install.cjs', 'src/update.cjs', 'src/agent.cjs', 'src/card.js', 'src/background.js', 'src/startup/watch.cjs']) assert.ok(names.has(name), `Missing: ${name}`);
  execFileSync('tar', ['-xzf', path.join(temp, pack.filename), '-C', temp]);
  const unpacked = path.join(temp, 'package');
  const pkg = JSON.parse(fs.readFileSync(path.join(unpacked, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'codex-ringside');
  assert.ok(!pkg.private);
  for (const name of ['preinstall', 'install', 'postinstall', 'prepare']) assert.ok(!pkg.scripts[name], `Unexpected lifecycle hook: ${name}`);
  const cli = path.join(unpacked, pkg.bin['codex-ringside']);
  assert.ok(fs.statSync(cli).mode & 0o111, 'CLI must be executable');
  assert.equal(execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim(), pkg.version);
  assert.match(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }), /codex-ringside/);
  if (process.platform === 'darwin') {
    execFileSync('/usr/bin/swiftc', ['-O', '-swift-version', '5', path.join(unpacked, 'native/bridge.swift'), '-o', path.join(temp, 'bridge')], { stdio: 'inherit', timeout: 180000 });
  }
  console.log(`Package OK: ${pack.filename}, ${names.size} files, ${pack.size} bytes`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
