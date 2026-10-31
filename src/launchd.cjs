'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const LABEL = 'com.codexringside.agent';
const home = os.homedir();
const paths = {
  installDir: path.join(home, 'Library/Application Support/CodexRingside'),
  logDir: path.join(home, 'Library/Logs/CodexRingside'),
  plist: path.join(home, 'Library/LaunchAgents', `${LABEL}.plist`)
};
const LEGACY_LABEL = 'com.codexplus.agent';
const legacyPaths = {
  installDir: path.join(home, 'Library/Application Support/CodexPlus'),
  logDir: path.join(home, 'Library/Logs/CodexPlus'),
  plist: path.join(home, 'Library/LaunchAgents', `${LEGACY_LABEL}.plist`)
};
const domain = () => `gui/${process.getuid()}`;

// [installed path, name inside the Trash folder]. The two directories share a basename.
const trashItems = (locations = paths) => [
  [locations.installDir, 'Application Support'],
  [locations.logDir, 'Logs'],
  [locations.plist, path.basename(locations.plist)]
];

const escapeXml = value => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function xml(value) {
  if (typeof value === 'boolean') return value ? '<true/>' : '<false/>';
  if (typeof value === 'number') return `<integer>${value}</integer>`;
  if (Array.isArray(value)) return `<array>${value.map(xml).join('')}</array>`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, item]) => `<key>${escapeXml(key)}</key>${xml(item)}`);
    return `<dict>${entries.join('')}</dict>`;
  }
  return `<string>${escapeXml(value)}</string>`;
}

function plistXml(value) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
    + `<plist version="1.0">${xml(value)}</plist>\n`;
}

function agentConfig({ node, installDir = paths.installDir, logDir = paths.logDir, label = LABEL }) {
  return {
    Label: label,
    ProgramArguments: [node, path.join(installDir, 'src/agent.cjs')],
    RunAtLoad: true,
    KeepAlive: { SuccessfulExit: false },
    ThrottleInterval: 10,
    ProcessType: 'Background',
    StandardOutPath: path.join(logDir, 'agent.log'),
    StandardErrorPath: path.join(logDir, 'agent.err.log')
  };
}

const launchctl = (...args) => execFileSync('/bin/launchctl', args, {
  encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe']
});

function printJob(label = LABEL) {
  try {
    return launchctl('print', `${domain()}/${label}`);
  } catch {
    return null;
  }
}

function bootstrap(plist = paths.plist) {
  launchctl('bootstrap', domain(), plist);
}

async function bootout(label = LABEL) {
  if (!printJob(label)) return;
  launchctl('bootout', `${domain()}/${label}`);
  for (let i = 0; i < 50 && printJob(label); i++) await new Promise(resolve => setTimeout(resolve, 100));
  if (printJob(label)) throw new Error(`后台任务未退出：${label}`);
}

function writePlist(config, file = paths.plist) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, plistXml(config), { mode: 0o644 });
  execFileSync('/usr/bin/plutil', ['-lint', file], { stdio: 'ignore' });
}

module.exports = { LABEL, LEGACY_LABEL, legacyPaths, agentConfig, bootout, bootstrap, paths, plistXml, printJob, trashItems, writePlist };
