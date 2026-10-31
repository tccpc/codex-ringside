'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DEFAULT_APP = '/Applications/ChatGPT.app';
const MIN_NODE_MAJOR = 22;

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

// Always this client's own CLI: a PATH install can lag behind what the desktop app expects.
function resolveCodexBin(appPath = DEFAULT_APP) {
  const found = [
    `${appPath}/Contents/Resources/codex-cli/bin/codex`,
    `${appPath}/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`,
    `${appPath}/Contents/Resources/codex`
  ].find(isExecutable);
  if (!found) throw new Error(`找不到 ${appPath} 内置的 Codex CLI`);
  return found;
}

function nodeMajor(file) {
  try {
    const version = execFileSync(file, ['--version'], { encoding: 'utf8', timeout: 5000 });
    return Number(version.match(/^v(\d+)/)?.[1]);
  } catch {
    return 0;
  }
}

// Prefer a stable symlink: Homebrew's real path contains the version and vanishes on upgrade.
function resolveNode() {
  const found = ['/opt/homebrew/bin/node', '/usr/local/bin/node', process.execPath]
    .find(file => isExecutable(file) && nodeMajor(file) >= MIN_NODE_MAJOR);
  if (!found) throw new Error(`需要 Node.js ${MIN_NODE_MAJOR} 或更高版本`);
  return found;
}

function authFile() {
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json');
}

module.exports = { DEFAULT_APP, MIN_NODE_MAJOR, authFile, isExecutable, resolveCodexBin, resolveNode };
