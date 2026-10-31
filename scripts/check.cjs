'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const files = ['src', 'bin', 'test', 'scripts'].flatMap(dir => walk(path.join(root, dir))).filter(file => /\.(cjs|js)$/.test(file));
for (const file of files) {
  // This fixture is a browser ES module inside a CommonJS package.
  if (file.endsWith('app-shared-fixture.js')) execFileSync(process.execPath, ['--input-type=module', '--check'], { input: fs.readFileSync(file) });
  else execFileSync(process.execPath, ['--check', file]);
}
execFileSync('/bin/bash', ['-n', path.join(root, 'install.sh')]);
execFileSync('/bin/sh', ['-n', path.join(root, 'bin/codex-ringside')]);
console.log(`Syntax OK: ${files.length} JavaScript files and 2 shell scripts`);
