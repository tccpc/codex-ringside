#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { BackgroundStore, parseBackgroundArgs } = require('../src/background.cjs');
const { CDP_PORT, CdpSession, isMainWindow, listTargets } = require('../src/cdp.cjs');
const launchd = require('../src/launchd.cjs');
const installer = require('../src/install.cjs');
const { version } = require('../package.json');

const { installDir } = launchd.paths;
const settingsFile = path.join(installDir, 'settings.json');
const stateFile = path.join(installDir, 'state.json');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

async function install({ observe }) {
  const result = await installer.install({ observe });
  console.log('安装完成，后台任务已启动。');
  console.log(result.settings.allowClientRestart
    ? '如果圆环还没出现：保存工作后用 ⌘Q 退出 Codex，再点原图标打开。'
    : '当前为观察模式：不会重启 Codex。');
  console.log(`原安装备份：${result.backup}`);
}

// Reachable only if Codex is running with the port; without it there is no card to remove.
async function removeCard() {
  try {
    const targets = (await listTargets(CDP_PORT, 1000)).filter(isMainWindow);
    await Promise.all(targets.map(async target => {
      const session = new CdpSession(target);
      await session.connect();
      await session.evaluate('window.__codexRingsideCard?.destroy(); window.__codexRingsideBackground?.destroy(); window.__codexPlusCard?.destroy(); window.__codexPlusBackground?.destroy()');
      session.close();
    }));
  } catch {
    // Nothing is listening, so nothing is injected.
  }
}

async function uninstall() {
  const trash = await installer.uninstall({ removeUi: removeCard });
  console.log(trash ? `已卸载，文件已移到废纸篓：${path.basename(trash)}` : '没有发现已安装的文件。');
  console.log('Codex 本身未改动。下次从原图标打开时恢复原来的启动方式。');
}

async function cardStatus() {
  try {
    const targets = await listTargets(CDP_PORT, 1000);
    const main = targets.filter(isMainWindow);
    const windows = await Promise.all(main.map(async target => {
      const session = new CdpSession(target);
      await session.connect();
      const { result } = await session.evaluate(
        '({ card: window.__codexRingsideCard?.status() ?? null, background: window.__codexRingsideBackground?.status() ?? null })'
      );
      session.close();
      return { url: target.url, ...result.value };
    }));
    return { port: 'open', targets: targets.length, windows };
  } catch {
    return { port: 'closed', targets: 0, windows: [] };
  }
}

function listeners() {
  try {
    return execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${CDP_PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
      .trim().split('\n').slice(1)
      .map(line => line.trim().split(/\s+/).slice(-2, -1)[0]);
  } catch {
    return [];
  }
}

async function status() {
  const job = launchd.printJob();
  const state = readJson(stateFile);
  console.log(JSON.stringify({
    agent: job ? job.match(/state = (\S+)/)?.[1] ?? 'loaded' : 'not installed',
    settings: readJson(settingsFile),
    background: new BackgroundStore({ root: installDir }).config,
    startup: state && { event: state.event, updatedAt: new Date(state.updatedAt).toISOString() },
    listenAddresses: listeners(),
    cdp: await cardStatus()
  }, null, 2));
}

// Only writes the file: the agent applies it on its next scan, the same way as a panel change.
async function background(args) {
  if (!fs.existsSync(settingsFile)) throw new Error('尚未安装，请先运行 install');
  const store = new BackgroundStore({ root: installDir });
  if (args.length === 0) {
    console.log(JSON.stringify(store.config, null, 2));
    return;
  }
  const config = await store.commit(parseBackgroundArgs(args));
  console.log(`背景来源：${config.source}，5 秒内生效。`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--version' || command === '-v') { console.log(version); return; }
  if (command === 'install') {
    const unknown = args.filter(arg => arg !== '--observe');
    if (unknown.length) throw new Error(`未知参数：${unknown.join(' ')}`);
    await install({ observe: args.includes('--observe') ? true : undefined });
  }
  else if (command === 'uninstall') await uninstall();
  else if (command === 'status') await status();
  else if (command === 'background') await background(args);
  else {
    console.log('用法：codex-ringside <install [--observe] | uninstall | status | background [来源] [选项]>');
    console.log('背景来源：default | image <图片路径> | wallpaper | glass');
    console.log('背景效果：--transparency <0-100> --blur <0-60>');
    console.log('图片调整：--layout <cover|contain|stretch|center|tile> --zoom <10-400> --x <0-100> --y <0-100>');
    console.log('          --crop <左,上,宽,高|none> --brightness <0-200> --contrast <0-200> --saturation <0-200>');
    process.exitCode = !command || ['--help', '-h', 'help'].includes(command) ? 0 : 1;
  }
}

main().catch(error => {
  console.error(`错误：${error.message}`);
  process.exitCode = 1;
});
