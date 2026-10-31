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
  const [packed] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', dist]));
  const bytes = fs.readFileSync(path.join(dist, packed.filename));
  const manifest = { filename: packed.filename, version: pkg.version, integrity: integrity(bytes), sha256: sha256(bytes), commit: run('git', ['rev-parse', 'HEAD']) };
  fs.writeFileSync(path.join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), `${manifest.sha256}  ${manifest.filename}\n`);
  fs.writeFileSync(path.join(dist, 'RELEASE_NOTES.md'), `Codex Ringside ${pkg.version}\n\nUnofficial macOS add-on for usage rings and custom backgrounds in the Codex sidebar.\n\nRequires Node.js 22+, Xcode Command Line Tools and a compatible desktop app.\n\n\`\`\`bash\nnpx codex-ringside@${pkg.version} install\nnpx codex-ringside@${pkg.version} status\n\`\`\`\n\nExisting Codex Plus settings are migrated with a local backup. The installer preserves observe mode and rolls back on failure. Save your work before manually reopening the desktop app if the rings do not appear.\n\nThe local debugging port grants local software access to the desktop renderer. Never expose or forward port 39222. Internal host interfaces can change.\n\n中文：侧栏额度圆环与背景设置插件；旧版 Codex Plus 自动迁移并备份。需要 Node.js 22+ 和 Xcode 命令行工具。\n\n[English guide](https://github.com/${repository}#readme) · [中文说明](https://github.com/${repository}/blob/main/README.zh-CN.md) · [Security](https://github.com/${repository}/blob/main/SECURITY.md)\n\nThe attached npm tarball includes readable JavaScript, Swift source and license notices. Verify it with \`shasum -a 256 -c SHA256SUMS.txt\`; install globally with \`npm install -g ./${manifest.filename}\`, then run \`codex-ringside install\`.\n`);
  console.log(`Prepared ${manifest.filename}`);
  return manifest;
}

function readManifest() {
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
  if (manifest.version !== pkg.version || manifest.filename !== `codex-ringside-${pkg.version}.tgz`) throw Error('Manifest does not match this version');
  const bytes = fs.readFileSync(path.join(dist, manifest.filename));
  if (integrity(bytes) !== manifest.integrity || sha256(bytes) !== manifest.sha256) throw Error('Release artifact integrity mismatch');
  if (manifest.commit !== run('git', ['rev-parse', 'HEAD'])) throw Error('Artifact belongs to another commit');
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
  const files = [manifest.filename, 'SHA256SUMS.txt'];
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
