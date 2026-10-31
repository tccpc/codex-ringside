'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ringside standalone '));
try {
  const archive = path.join(root, 'dist', `codex-ringside-v${pkg.version}-darwin-${process.arch}.tar.gz`);
  execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', temp]);
  const payload = path.join(temp, 'codex-ringside');
  const poison = path.join(temp, 'broken-tools');
  fs.mkdirSync(poison);
  for (const name of ['node', 'npm', 'npx', 'swiftc', 'xcrun', 'brew', 'git']) {
    fs.writeFileSync(path.join(poison, name), '#!/bin/sh\necho "Unexpected system tool: $0" >&2\nexit 99\n', { mode: 0o755 });
  }
  execFileSync(path.join(payload, 'runtime/node'), [path.join(root, 'test/standalone-smoke.cjs'), payload, temp], {
    stdio: 'inherit', timeout: 60000,
    env: { ...process.env, PATH: `${poison}:/usr/bin:/bin:/usr/sbin:/sbin`, DEVELOPER_DIR: '/nonexistent-developer-tools', NODE_OPTIONS: '', NODE_PATH: '' }
  });
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
