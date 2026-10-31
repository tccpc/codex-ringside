'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const repository = 'tccpc/codex-ringside';
const pkg = require('../package.json');
const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const integrity = data => `sha512-${crypto.createHash('sha512').update(data).digest('base64')}`;

function validateRelease() {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) throw Error('Invalid release version');
  if (process.env.GITHUB_REPOSITORY !== repository || process.env.GITHUB_REF !== `refs/tags/v${pkg.version}`) throw Error('Release requires the matching tag in the canonical repository');
  const head = run('git', ['rev-parse', 'HEAD']);
  if (run('git', ['rev-parse', `refs/tags/v${pkg.version}^{commit}`]) !== head) throw Error('Tag does not point to HEAD');
  run('git', ['merge-base', '--is-ancestor', head, 'origin/main']);
  if (run('git', ['status', '--porcelain'])) throw Error('Release worktree must be clean');
  return head;
}

function pack() {
  fs.mkdirSync(dist, { recursive: true });
  const bundles = ['arm64', 'x64'].map(arch => `codex-ringside-v${pkg.version}-darwin-${arch}.tar.gz`);
  for (const file of bundles) if (!fs.existsSync(path.join(dist, file))) throw Error(`Build the standalone bundle first: ${file}`);
  fs.copyFileSync(path.join(root, 'install.sh'), path.join(dist, 'install.sh'));
  const [packed] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', dist]));
  const bytes = fs.readFileSync(path.join(dist, packed.filename));
  const manifest = { filename: packed.filename, version: pkg.version, integrity: integrity(bytes), sha256: sha256(bytes), commit: run('git', ['rev-parse', 'HEAD']) };
  manifest.assets = Object.fromEntries([manifest.filename, ...bundles, 'install.sh'].map(file => [file, sha256(fs.readFileSync(path.join(dist, file)))]));
  fs.writeFileSync(path.join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), Object.entries(manifest.assets).map(([file, sum]) => `${sum}  ${file}\n`).join(''));
  fs.writeFileSync(path.join(dist, 'RELEASE_NOTES.md'), `Codex Ringside ${pkg.version}

Unofficial macOS add-on for usage rings and custom backgrounds in the Codex sidebar.

One-command install for macOS 13+ (Apple Silicon and Intel). Includes private Node ${require('./node-runtime.json').version} and a precompiled helper; no Node, npm, Homebrew or Xcode tools need to be installed by the user. Requires a compatible signed-in desktop app.

\`\`\`bash
curl -fsSL https://github.com/${repository}/releases/download/v${pkg.version}/install.sh | /bin/bash -s -- --version ${pkg.version}
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" status
\`\`\`

Existing Ringside and Codex Plus settings are preserved with a local backup. Installation checks the release SHA-256, preserves observe mode and rolls back on failure. Save your work before manually reopening the desktop app if the rings do not appear.

Automatic updates are enabled by default. Ringside checks stable GitHub releases every six hours, verifies and installs newer bundles, and restarts its own background agent while the desktop client stays open. Failed updates roll back and retry after one hour. Use \`codex-ringside update\` to update now, \`update --check\` to check, or \`update --disable\` to turn automatic updates off. Existing 0.1.x installations need one manual upgrade to receive this feature.

The local debugging port grants local software access to the desktop renderer. Never expose or forward port 39222. Internal host interfaces can change.

中文：一键安装自带专用 Node 和预编译 helper，无需安装开发工具。支持 macOS 13+ 的 Apple Silicon 和 Intel；保留旧版设置并备份，失败时回滚。

自动更新默认开启：每 6 小时检查正式版，下载校验后自动升级并重启插件后台，客户端保持运行。更新失败自动回滚，一小时后重试。0.1.x 用户先执行一次上方安装命令，之后即可自动更新。

[English guide](https://github.com/${repository}#readme) · [中文说明](https://github.com/${repository}/blob/main/README.zh-CN.md) · [Security](https://github.com/${repository}/blob/main/SECURITY.md)

Assets include both standalone bundles, install.sh, and the npm source tarball. SHA256SUMS.txt covers all four assets. Standalone bundles include readable JavaScript, Swift source, Node and its license. npm/source installation still requires Node.js 22+ and Xcode Command Line Tools.
`);
  console.log(`Prepared ${manifest.filename}`);
  return manifest;
}

function readManifest() {
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
  if (manifest.version !== pkg.version || manifest.filename !== `codex-ringside-${pkg.version}.tgz`) throw Error('Manifest does not match this version');
  const bytes = fs.readFileSync(path.join(dist, manifest.filename));
  if (integrity(bytes) !== manifest.integrity || sha256(bytes) !== manifest.sha256) throw Error('Release artifact integrity mismatch');
  if (manifest.commit !== run('git', ['rev-parse', 'HEAD'])) throw Error('Artifact belongs to another commit');
  const expected = [manifest.filename, ...['arm64', 'x64'].map(arch => `codex-ringside-v${pkg.version}-darwin-${arch}.tar.gz`), 'install.sh'];
  if (JSON.stringify(Object.keys(manifest.assets ?? {}).sort()) !== JSON.stringify(expected.sort())) throw Error('Missing release assets');
  for (const [file, sum] of Object.entries(manifest.assets)) {
    if (sha256(fs.readFileSync(path.join(dist, file))) !== sum) throw Error(`Release asset integrity mismatch: ${file}`);
  }
  if (fs.readFileSync(path.join(dist, 'SHA256SUMS.txt'), 'utf8') !== Object.entries(manifest.assets).map(([file, sum]) => `${sum}  ${file}\n`).join('')) throw Error('Release checksums differ from the manifest');
  return manifest;
}

async function registryVersion() {
  const response = await fetch(`https://registry.npmjs.org/codex-ringside/${pkg.version}`, { signal: AbortSignal.timeout(30000) });
  if (response.status === 404) return null;
  if (!response.ok) throw Error(`Registry lookup failed: ${response.status}`);
  return response.json();
}

async function publish() {
  validateRelease();
  const manifest = readManifest();
  const existing = await registryVersion();
  if (existing) {
    if (existing.dist?.integrity !== manifest.integrity) throw Error('Published version has different bytes; publish a new version instead');
    console.log('Identical version already published; resuming release');
  } else {
    const output = run('npm', ['publish', path.join(dist, manifest.filename), '--access', 'public', '--tag', pkg.version.includes('-') ? 'next' : 'latest', '--provenance']);
    console.log(output);
  }
  // New packages can remain in npm's processing queue for several minutes after upload.
  console.log('Waiting for npm processing, immutable version and provenance');
  for (let i = 0; i < 60; i++) {
    const remote = await registryVersion();
    if (remote && remote.dist?.integrity !== manifest.integrity) throw Error('Registry integrity differs from the uploaded artifact');
    if (remote?.dist?.integrity === manifest.integrity && remote.dist.attestations?.url) return;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw Error('Published integrity/provenance is not visible yet; rerun this release');
}

async function github() {
  const commit = validateRelease();
  const manifest = readManifest();
  const remote = await registryVersion();
  if (remote?.dist?.integrity !== manifest.integrity || !remote.dist.attestations?.url) throw Error('npm release has not been verified');
  const tag = `v${pkg.version}`;
  const files = [...Object.keys(manifest.assets), 'SHA256SUMS.txt'];
  const releases = JSON.parse(run('gh', ['api', `repos/${repository}/releases?per_page=100`]));
  let release = releases.find(item => item.tag_name === tag);
  if (!release) {
    const args = ['release', 'create', tag, '--repo', repository, '--verify-tag', '--target', commit, '--draft', '--title', tag, '--notes-file', path.join(dist, 'RELEASE_NOTES.md'), ...files.map(file => path.join(dist, file))];
    if (pkg.version.includes('-')) args.push('--prerelease');
    run('gh', args);
    release = { draft: true };
  } else {
    for (const file of files) {
      if (!release.assets.some(asset => asset.name === file)) {
        run('gh', ['release', 'upload', tag, path.join(dist, file), '--repo', repository]);
        continue;
      }
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ringside-release-'));
      try {
        run('gh', ['release', 'download', tag, '--repo', repository, '--pattern', file, '--dir', temp]);
        if (sha256(fs.readFileSync(path.join(temp, file))) !== sha256(fs.readFileSync(path.join(dist, file)))) throw Error(`Existing release asset differs: ${file}`);
      } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    }
  }
  if (release.draft) run('gh', ['release', 'edit', tag, '--repo', repository, '--draft=false', ...(pkg.version.includes('-') ? [] : ['--latest'])]);
  console.log(`https://github.com/${repository}/releases/tag/${tag}`);
}

async function main() {
  const command = process.argv[2];
  if (command === 'pack') pack();
  else if (command === 'prepare') { validateRelease(); pack(); }
  else if (command === 'publish') await publish();
  else if (command === 'github') await github();
  else throw Error('Usage: node scripts/release.cjs <pack|prepare|publish|github>');
}
module.exports = { integrity, sha256, readManifest, validateRelease };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
