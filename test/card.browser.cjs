'use strict';
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

let browser, server, page, origin;
before(async () => {
  const root = path.resolve(__dirname, '..');
  server = http.createServer((request, response) => {
    const file = path.resolve(root, `.${new URL(request.url, 'http://localhost').pathname}`);
    if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(`${origin}/test/fixtures/card.html`);
  await page.waitForFunction(() => window.__codexRingsideCard?.status().replacesNative);
});
afterEach(async () => { await page?.close(); });

const status = () => page.evaluate(() => window.__codexRingsideCard.status());
const hover = async () => {
  await page.mouse.move(200, 10);
  await page.locator('#native-usage').hover();
  await page.locator('#codex-ringside-tooltip').waitFor({ state: 'visible' });
};

test('left click opens the original background panel without opening the native pointerdown menu', async () => {
  assert.equal((await status()).placed, true);
  assert.equal(await page.locator('#codex-ringside-card').count(), 1);
  assert.equal(await page.locator('#native-usage > [data-transition-phase]').isVisible(), false);
  assert.equal(await page.locator('#codex-ringside-card [role="meter"]').count(), 2);
  await page.locator('#native-usage').click();
  assert.equal(await page.locator('#native-menu').isVisible(), false);
  assert.equal(await page.locator('#codex-ringside-panel').isVisible(), true);
  assert.equal(await page.locator('#codex-ringside-tooltip').isVisible(), false);
  assert.equal(await page.locator('#codex-ringside-panel').getByRole('radio', { name: '图片', exact: true }).isVisible(), true);
  assert.equal(await page.evaluate(() => window.nativeOpens), 0);
  await page.locator('#native-usage').click();
  assert.equal(await page.locator('#codex-ringside-panel').isVisible(), false);
  assert.equal(await page.evaluate(() => window.nativeOpens), 0);
});

test('the separate usage action and ArrowDown preserve the native menu and manage-usage action', async () => {
  await hover();
  await page.locator('#codex-ringside-tooltip').getByRole('button', { name: '用量菜单' }).click();
  assert.equal(await page.locator('#native-menu').isVisible(), true);
  assert.equal(await page.locator('#codex-ringside-panel').isVisible(), false);
  assert.equal(await page.evaluate(() => window.nativeOpens), 1);
  await page.locator('#manage-usage').click();
  assert.equal(await page.evaluate(() => window.managedUsage), true);
  await page.locator('#native-usage').focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#native-menu').isVisible(), true);
  assert.equal(await page.evaluate(() => window.nativeOpens), 2);
});

test('Enter, Space and accessible click all open background settings without duplicate toggles', async () => {
  for (const key of ['Enter', 'Space']) {
    await page.locator('#native-usage').focus();
    await page.keyboard.press(key);
    assert.equal(await page.locator('#codex-ringside-panel').isVisible(), true);
    assert.equal(await page.locator('#native-menu').isVisible(), false);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#codex-ringside-panel').isVisible(), false);
  }
  await page.locator('#native-usage').evaluate(button => button.click());
  assert.equal(await page.locator('#codex-ringside-panel').isVisible(), true);
  assert.equal(await page.evaluate(() => window.nativeOpens), 0);
});

test('hover shows plan, balance, reset time and reset cards; settings stay clickable across the gap', async () => {
  await page.evaluate(() => window.setState('single'));
  await hover();
  const detail = await page.locator('#codex-ringside-tooltip').innerText();
  for (const text of ['Pro 套餐', '20%', '11/5 07:54 重置', '12,346', '重置卡：3 张可用']) assert.ok(detail.includes(text), text);
  await page.locator('#codex-ringside-tooltip').getByRole('button', { name: '背景设置' }).hover();
  await page.waitForTimeout(220);
  await page.locator('#codex-ringside-tooltip').getByRole('button', { name: '背景设置' }).click();
  assert.equal(await page.locator('#codex-ringside-panel').isVisible(), true);
  assert.equal(await page.locator('#codex-ringside-tooltip').isVisible(), false);
  assert.equal(await page.evaluate(() => window.nativeOpens), 0);
});

test('right click and Shift+F10 open background settings without opening the native menu', async () => {
  await page.locator('#native-usage').click({ button: 'right' });
  assert.equal(await page.locator('#codex-ringside-panel').isVisible(), true);
  await page.keyboard.press('Escape');
  await page.locator('#native-usage').focus();
  await page.keyboard.press('Shift+F10');
  assert.equal(await page.locator('#codex-ringside-panel').isVisible(), true);
  assert.equal(await page.evaluate(() => window.nativeOpens), 0);
});

test('React trigger replacement, rail remount and fallback do not leave duplicate cards', async () => {
  await page.evaluate(() => {
    const previous = document.getElementById('native-usage');
    const next = document.createElement('button');
    next.id = 'native-usage';
    next.setAttribute('aria-label', 'Usage');
    next.setAttribute('aria-haspopup', 'menu');
    next.innerHTML = '<span>◆</span>';
    window.wireNativeUsage(next);
    previous.replaceWith(next);
  });
  await page.waitForFunction(() => document.getElementById('native-usage').contains(document.getElementById('codex-ringside-card')));
  await page.locator('#native-usage').click();
  assert.equal(await page.locator('#codex-ringside-panel').isVisible(), true);
  assert.equal(await page.evaluate(() => window.nativeOpens), 0);
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.getElementById('native-usage').remove());
  await page.waitForFunction(() => window.__codexRingsideCard.status().placed && !window.__codexRingsideCard.status().replacesNative);
  await page.locator('#codex-ringside-card').click();
  assert.equal(await page.locator('#codex-ringside-panel').isVisible(), true);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const oldRail = document.querySelector('nav');
    const next = oldRail.cloneNode(true);
    next.querySelector('#codex-ringside-card').remove();
    next.querySelector('.footer').insertAdjacentHTML('afterbegin', '<button id="native-usage" aria-label="使用量" aria-haspopup="menu"><span>◆</span></button>');
    oldRail.replaceWith(next);
  });
  await page.waitForFunction(() => window.__codexRingsideCard.status().replacesNative);
  assert.equal((await status()).cardCount, 1);
});

test('localized usage indicator is recognized without replacing the profile menu', async () => {
  await page.evaluate(() => {
    document.getElementById('native-usage').setAttribute('aria-label', 'Utilisation');
    document.querySelector('.footer').insertAdjacentHTML('beforeend', '<button id="profile" aria-haspopup="menu" aria-label="Profile"><span>Avatar</span></button>');
    window.__codexRingsideCard.place();
  });
  assert.equal((await status()).replacesNative, true);
  assert.equal(await page.locator('#profile').getAttribute('data-codex-ringside-host'), null);
});

test('repeated injection is idempotent; destruction restores the original icon and native handlers', async () => {
  await page.evaluate(() => { installCodexRingsideCard(); installCodexRingsideCard(); });
  assert.equal((await status()).cardCount, 1);
  await page.evaluate(() => window.__codexRingsideCard.destroy());
  assert.equal(await page.locator('#codex-ringside-card, #codex-ringside-tooltip, #codex-ringside-style').count(), 0);
  assert.equal(await page.locator('#native-usage > span').isVisible(), true);
  assert.equal(await page.locator('#native-usage').getAttribute('data-codex-ringside-host'), null);
  await page.locator('#native-usage').click();
  assert.equal(await page.evaluate(() => window.nativeOpens), 1);
});

test('expired data clears credits and reset cards as well as the percentage', async () => {
  await page.evaluate(() => { window.setState('single'); window.__codexRingsideCard.update({ updatedAt: Date.now() - 151000 }); });
  await hover();
  const value = await status();
  assert.equal(value.stale, true);
  assert.equal(value.credits, null);
  assert.equal(value.rings[0].percent, null);
  const detail = await page.locator('#codex-ringside-tooltip').innerText();
  assert.ok(detail.includes('已过期'));
  assert.ok(!detail.includes('12,346') && !detail.includes('重置卡') && !detail.includes('Pro'));
});

test('credit-only and unlimited data are shown without inventing a percentage ring', async () => {
  for (const [state, label] of [['credits', '1,250'], ['unlimited', '不限额']]) {
    await page.evaluate(state => window.setState(state), state);
    assert.equal(await page.locator('#codex-ringside-card [role="meter"]').count(), 0);
    await hover();
    assert.ok((await page.locator('#codex-ringside-tooltip').innerText()).includes(label));
  }
});

test('tooltip fits a small viewport in both themes and Escape returns keyboard focus', async () => {
  await page.setViewportSize({ width: 320, height: 320 });
  for (const dark of [false, true]) {
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
    await hover();
    const rect = await page.locator('#codex-ringside-tooltip').boundingBox();
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 320 && rect.y + rect.height <= 320);
    await page.locator('#codex-ringside-tooltip').getByRole('button', { name: '背景设置' }).focus();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#codex-ringside-tooltip').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'native-usage');
  }
});
