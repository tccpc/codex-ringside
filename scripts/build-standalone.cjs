'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const runtime = require('./node-runtime.json');
const pkg = require('../package.json');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const run = (command, args, options = {}) => (execFileSync(command, args, { cwd: root, encoding: 'utf8', ...options }) ?? '').trim();

function assertSystemLibraries(file) {
  const links = run('/usr/bin/otool', ['-L', file]).split('\n').slice(1).map(line => line.trim().split(' ')[0]);
  for (const link of links) {
    if (!link.startsWith('/usr/lib/') && !link.startsWith('/System/Library/')) throw Error(`Non-system dependency in ${file}: ${link}`);
  }
}

function build(arch = process.arch) {
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(arch)) throw Error('Build on macOS for arm64 or x64');
  fs.mkdirSync(dist, { recursive: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ringside-bundle-'));
  try {
    const archiveName = `node-v${runtime.version}-darwin-${arch}.tar.gz`;
    const archive = path.join(temp, archiveName);
    run('/usr/bin/curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '3', '--connect-timeout', '20', '--max-time', '600', '--proto', '=https', '--proto-redir', '=https', `https://nodejs.org/dist/v${runtime.version}/${archiveName}`, '-o', archive], { stdio: 'inherit' });
    if (sha256(fs.readFileSync(archive)) !== runtime.sha256[arch]) throw Error('Official Node archive checksum mismatch');
    run('/usr/bin/tar', ['-xzf', archive, '-C', temp]);
    const nodeRoot = path.join(temp, `node-v${runtime.version}-darwin-${arch}`);
    const [packed] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp]));
    run('/usr/bin/tar', ['-xzf', path.join(temp, packed.filename), '-C', temp]);
    const payload = path.join(temp, 'codex-ringside');
    fs.renameSync(path.join(temp, 'package'), payload);
    fs.mkdirSync(path.join(payload, 'runtime'));
    fs.copyFileSync(path.join(nodeRoot, 'bin/node'), path.join(payload, 'runtime/node'));
    fs.copyFileSync(path.join(nodeRoot, 'LICENSE'), path.join(payload, 'runtime/LICENSE'));
    fs.copyFileSync(path.join(root, 'bin/codex-ringside'), path.join(payload, 'bin/codex-ringside'));
    fs.chmodSync(path.join(payload, 'bin/codex-ringside'), 0o755);
    const swiftArch = arch === 'x64' ? 'x86_64' : arch;
    run('/usr/bin/swiftc', ['-O', '-swift-version', '5', '-module-name', 'RingsideBridge', '-target', `${swiftArch}-apple-macos13.0`, path.join(payload, 'native/bridge.swift'), '-o', path.join(payload, 'bridge')], { stdio: 'inherit', timeout: 180000 });
    // Refuse an artifact that accidentally links to a runner's Homebrew or Xcode libraries.
    assertSystemLibraries(path.join(payload, 'runtime/node'));
    assertSystemLibraries(path.join(payload, 'bridge'));
    fs.writeFileSync(path.join(payload, 'standalone.json'), `${JSON.stringify({ format: 1, platform: 'darwin', arch, version: pkg.version, nodeVersion: runtime.version, minMacOS: '13.0' }, null, 2)}\n`);
    if (arch === process.arch) {
      if (run(path.join(payload, 'bin/codex-ringside'), ['--version'], { env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } }) !== pkg.version) throw Error('Bundled CLI smoke test failed');
      if (JSON.parse(run(path.join(payload, 'bridge'), ['version'])).protocol !== 1) throw Error('Helper smoke test failed');
    }
    const filename = `codex-ringside-v${pkg.version}-darwin-${arch}.tar.gz`;
    // Stable metadata makes re-packing the same binaries deterministic.
    const files = [];
    function normalize(dir) {
      for (const name of fs.readdirSync(dir).sort()) {
        const file = path.join(dir, name);
        if (fs.statSync(file).isDirectory()) normalize(file);
        fs.utimesSync(file, 0, 0);
        files.push(path.relative(temp, file));
      }
    }
    normalize(payload);
    run('/usr/bin/tar', ['--no-recursion', '--uid', '0', '--gid', '0', '--uname', 'root', '--gname', 'wheel', '-cf', path.join(temp, 'bundle.tar'), '-C', temp, '-T', '-'], { input: files.sort().join('\n') + '\n', env: { ...process.env, COPYFILE_DISABLE: '1' } });
    const compressed = execFileSync('/usr/bin/gzip', ['-n', '-c', path.join(temp, 'bundle.tar')], { maxBuffer: 200 * 1024 * 1024 });
    fs.writeFileSync(path.join(dist, filename), compressed);
    console.log(`Built ${filename} (${compressed.length} bytes)`);
    return filename;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

module.exports = { build, assertSystemLibraries };
if (require.main === module) {
  try { build(process.argv[2]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
