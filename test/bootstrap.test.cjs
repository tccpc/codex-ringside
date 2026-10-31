'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../install.sh');

function runBootstrap({ arch = 'arm64', translated = false, corrupt = false, missing = false, downloadFail = false, platform = 'Darwin', major = 13, args = [] } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ringside shell '));
  try {
    const payload = path.join(temp, 'codex-ringside');
    fs.mkdirSync(path.join(payload, 'runtime'), { recursive: true });
    fs.writeFileSync(path.join(payload, 'runtime/node'), '#!/bin/sh\nif [ "$2" = --version ]; then echo 1.2.3; else printf "%s\\n" "$@" > "$TEST_RECORD"; fi\n', { mode: 0o755 });
    fs.writeFileSync(path.join(payload, 'bridge'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const target = translated || arch === 'arm64' ? 'arm64' : 'x64';
    const name = `codex-ringside-v1.2.3-darwin-${target}.tar.gz`;
    execFileSync('/usr/bin/tar', ['-czf', path.join(temp, name), '-C', temp, 'codex-ringside']);
    const sum = crypto.createHash('sha256').update(fs.readFileSync(path.join(temp, name))).digest('hex');
    fs.writeFileSync(path.join(temp, 'SHA256SUMS.txt'), missing ? '' : `${corrupt ? '0'.repeat(64) : sum}  ${name}\n`);
    fs.mkdirSync(path.join(temp, 'tmp'));
    const harness = `
uname() { if [ "$1" = -s ]; then printf '%s' "$TEST_PLATFORM"; else printf '%s' "$TEST_ARCH"; fi; }
sysctl() { printf '%s' "$TEST_TRANSLATED"; }
sw_vers() { printf '%s.0' "$TEST_MAJOR"; }
id() { echo 501; }
curl() {
  local url='' out=''
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --output) out="$2"; shift 2 ;;
      https://*) url="$1"; shift ;;
      *) shift ;;
    esac
  done
  [ "$TEST_FAIL" = false ] || return 22
  printf '%s\\n' "$url" >> "$TEST_REQUESTS"
  if [[ "$url" = */latest ]]; then printf 'https://github.com/tccpc/codex-ringside/releases/tag/v1.2.3';
  else cp "$TEST_ASSETS/\${url##*/}" "$out"; fi
}
export -f uname sysctl sw_vers id curl
exec /bin/bash "$@"
`;
    const result = spawnSync('/bin/bash', ['-c', harness, 'bootstrap-test', script, ...args], {
      encoding: 'utf8', timeout: 15000,
      env: { ...process.env, TMPDIR: path.join(temp, 'tmp'), TEST_ASSETS: temp, TEST_RECORD: path.join(temp, 'record'), TEST_REQUESTS: path.join(temp, 'requests'), TEST_PLATFORM: platform, TEST_ARCH: arch, TEST_TRANSLATED: translated ? '1' : '0', TEST_MAJOR: String(major), TEST_FAIL: String(downloadFail) }
    });
    return { ...result, record: fs.existsSync(path.join(temp, 'record')) ? fs.readFileSync(path.join(temp, 'record'), 'utf8') : '', requests: fs.existsSync(path.join(temp, 'requests')) ? fs.readFileSync(path.join(temp, 'requests'), 'utf8') : '', leftovers: fs.readdirSync(path.join(temp, 'tmp')) };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

for (const options of [{ arch: 'arm64' }, { arch: 'x86_64' }, { arch: 'x86_64', translated: true }]) {
  test(`bootstrap chooses the right native bundle: ${JSON.stringify(options)}`, () => {
    const r = runBootstrap({ ...options, args: ['--observe'] });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.record, /\ninstall\n--observe\n$/);
    assert.deepEqual(r.leftovers, []);
    assert.equal(r.requests.split('/releases/tag/').length, 1);
  });
}
test('pinned version bypasses latest lookup', () => {
  const r = runBootstrap({ args: ['--version', '1.2.3'] });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.requests.includes('/latest'));
  assert.match(r.requests, /download\/v1\.2\.3/);
});
for (const options of [{ corrupt: true }, { missing: true }, { downloadFail: true }, { platform: 'Linux' }, { major: 12 }, { args: ['--version', '../../bad'] }]) {
  test(`bootstrap fails before installation: ${JSON.stringify(options)}`, () => {
    const r = runBootstrap(options);
    assert.notEqual(r.status, 0);
    assert.equal(r.record, '');
    assert.deepEqual(r.leftovers, [], r.stderr);
  });
}
