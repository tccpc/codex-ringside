'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// A manifest is only shipped in a release bundle, never in the npm source package.
function inspectBundle(root) {
  const file = path.join(root, 'standalone.json');
  if (!fs.existsSync(file)) return null;
  const info = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (info.format !== 1 || info.platform !== process.platform || info.arch !== process.arch
    || info.version !== JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version) {
    throw new Error('一键安装包的平台、架构或版本不匹配，请重新下载');
  }
  const node = path.join(root, 'runtime/node');
  const version = execFileSync(node, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();
  if (version !== `v${info.nodeVersion}` || Number(info.nodeVersion.split('.')[0]) < 22) throw new Error('安装包内 Node 版本不匹配');
  // A side-effect-free command confirms the helper can load on this macOS version.
  const helper = JSON.parse(execFileSync(path.join(root, 'bridge'), ['version'], { encoding: 'utf8', timeout: 10000 }));
  if (helper.protocol !== 1) throw new Error('安装包内 helper 版本不匹配');
  return info;
}

function copyBundle(root, stage) {
  fs.cpSync(path.join(root, 'runtime'), path.join(stage, 'runtime'), { recursive: true });
  for (const name of ['bridge', 'standalone.json']) fs.copyFileSync(path.join(root, name), path.join(stage, name));
  fs.chmodSync(path.join(stage, 'bridge'), 0o755);
}

module.exports = { inspectBundle, copyBundle };
