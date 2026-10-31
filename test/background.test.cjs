'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { BackgroundStore, IMAGE_EDITS, normalizeBackground, parseBackgroundArgs } = require('../src/background.cjs');

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function harness(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-ringside-'));
  roots.push(root);
  const prepare = async (source, dir) => {
    if (source.includes('broken')) throw new Error(`无法读取图片：${source}`);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${path.basename(source)}.jpg`);
    fs.writeFileSync(file, source);
    return file;
  };
  const screen = { x: 0, y: 0, width: 1512, height: 982, image: '/wall/one' };
  const clock = { now: 1000 };
  const store = new BackgroundStore({
    root, prepare, now: () => clock.now, readScreens: async () => [screen, { ...screen, x: 1512 }], ...options
  });
  return { root, store, clock };
}

test('a config falls back to a source it can actually use', () => {
  assert.equal(normalizeBackground(null).source, 'default');
  assert.equal(normalizeBackground({ source: 'nonsense' }).source, 'default');
  assert.equal(normalizeBackground({ source: 'toString' }).source, 'default');
  assert.equal(normalizeBackground({ source: 'image' }).source, 'default');
  assert.equal(normalizeBackground({ source: 'image', image: '/a.png' }).source, 'image');
  assert.equal(normalizeBackground({ source: 'glass' }).source, 'glass');
});

test('a config from the old mode format reads as the default background', () => {
  const config = normalizeBackground({ mode: 'blur', tint: 54, blur: 40, image: '/a.png', wallpaper: '/a.png' });
  assert.equal(config.source, 'default');
  assert.equal(config.image, '/a.png');
  assert.equal(Object.hasOwn(config, 'wallpaper'), false);
});

test('numbers are clamped to whole values in range', () => {
  const config = normalizeBackground({ transparency: 140.4, blur: -3, zoom: 1, brightness: 999, x: 33.6 });
  assert.equal(config.transparency, 100);
  assert.equal(config.blur, 0);
  assert.equal(config.zoom, 10);
  assert.equal(config.brightness, 200);
  assert.equal(config.x, 34);
  assert.equal(normalizeBackground({ transparency: '12' }).transparency, 45);
});

test('an unknown layout falls back to cover', () => {
  assert.equal(normalizeBackground({ layout: 'contain' }).layout, 'contain');
  assert.equal(normalizeBackground({ layout: 'sideways' }).layout, 'cover');
});

test('a crop stays inside the picture and a useless one is dropped', () => {
  assert.deepEqual(normalizeBackground({ crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 } }).crop, { x: 0.1, y: 0.2, w: 0.5, h: 0.5 });
  assert.deepEqual(normalizeBackground({ crop: { x: 0.8, y: -1, w: 0.5, h: 0.5 } }).crop, { x: 0.8, y: 0, w: 0.2, h: 0.5 });
  assert.equal(normalizeBackground({ crop: { x: 0, y: 0, w: 1, h: 1 } }).crop, null);
  assert.equal(normalizeBackground({ crop: { x: 0, y: 0, w: 0.01, h: 1 } }).crop, null);
  assert.equal(normalizeBackground({ crop: { x: 'a', y: 0, w: 1, h: 1 } }).crop, null);
  assert.equal(normalizeBackground({ crop: null }).crop, null);
});

test('CLI arguments become only the changes that were asked for', () => {
  assert.deepEqual(parseBackgroundArgs(['glass']), { source: 'glass' });
  assert.deepEqual(parseBackgroundArgs(['--transparency', '40', '--blur', '6']), { transparency: 40, blur: 6 });
  assert.equal(parseBackgroundArgs(['image', 'a.png']).image, path.resolve('a.png'));
  assert.deepEqual(parseBackgroundArgs(['image']), { source: 'image' });
  assert.equal(parseBackgroundArgs(['image', '--zoom', '150', 'a.png']).zoom, 150);
  assert.equal(parseBackgroundArgs(['--layout', 'tile']).layout, 'tile');
  assert.deepEqual(parseBackgroundArgs(['--crop', '10,20,50,50']).crop, { x: 0.1, y: 0.2, w: 0.5, h: 0.5 });
  assert.equal(parseBackgroundArgs(['--crop', 'none']).crop, null);
});

test('bad CLI arguments are refused', () => {
  assert.throws(() => parseBackgroundArgs(['sparkles']), /未知来源/);
  assert.throws(() => parseBackgroundArgs(['glass', 'a.png']), /多余的参数：a\.png/);
  assert.throws(() => parseBackgroundArgs(['image', 'a.png', 'b.png']), /多余的参数：b\.png/);
  assert.throws(() => parseBackgroundArgs(['--blur']), /缺少参数/);
  assert.throws(() => parseBackgroundArgs(['--blur', 'lots']), /数字/);
  assert.throws(() => parseBackgroundArgs(['--opacity', '3']), /未知参数/);
  assert.throws(() => parseBackgroundArgs(['--layout', 'sideways']), /未知布局/);
  assert.throws(() => parseBackgroundArgs(['--crop', '1,2']), /--crop/);
});

test('a saved background survives a new store', async () => {
  const { root, store } = harness();
  await store.commit({ source: 'image', image: '/pictures/good', transparency: 42, layout: 'contain' });
  const reopened = new BackgroundStore({ root });
  assert.equal(reopened.config.source, 'image');
  assert.equal(reopened.config.transparency, 42);
  assert.equal(reopened.config.layout, 'contain');
});

test('a corrupt file reads as the default background', () => {
  const { root } = harness();
  fs.writeFileSync(path.join(root, 'background.json'), '{');
  assert.equal(new BackgroundStore({ root }).config.source, 'default');
});

test('effects stay when the source changes', async () => {
  const { store } = harness();
  await store.commit({ source: 'image', image: '/pictures/good', transparency: 70, blur: 12 });
  const config = await store.commit({ source: 'wallpaper' });
  assert.equal(config.transparency, 70);
  assert.equal(config.blur, 12);
  assert.equal(config.image, '/pictures/good');
});

test('a new picture starts over but keeps the effects', async () => {
  const { store } = harness();
  await store.commit({ source: 'image', image: '/pictures/one', transparency: 70, blur: 12 });
  await store.commit({ zoom: 200, x: 10, layout: 'tile', crop: { x: 0, y: 0, w: 0.5, h: 0.5 }, brightness: 150 });
  const config = await store.commit({ image: '/pictures/two' });
  for (const [key, value] of Object.entries(IMAGE_EDITS)) assert.deepEqual(config[key], value, key);
  assert.equal(config.transparency, 70);
  assert.equal(config.blur, 12);
});

test('a new picture does not stay hidden behind full transparency', async () => {
  const { store } = harness();
  await store.commit({ source: 'image', image: '/pictures/one', transparency: 100 });
  assert.equal((await store.commit({ image: '/pictures/two' })).transparency, 45);
});

test('switching to a picture source brings it back into view', async () => {
  const { store } = harness();
  await store.commit({ source: 'glass', transparency: 100 });
  assert.equal((await store.commit({ source: 'wallpaper' })).transparency, 45);
  await store.commit({ source: 'glass', transparency: 96 });
  await store.commit({ image: '/pictures/one', source: 'default' });
  assert.equal(store.config.transparency, 45);
});

test('a high transparency that still shows the picture is kept', async () => {
  const { store } = harness();
  await store.commit({ source: 'image', image: '/pictures/one', transparency: 94 });
  assert.equal((await store.commit({ image: '/pictures/two' })).transparency, 94);
});

test('an explicit transparency is always respected', async () => {
  const { store } = harness();
  await store.commit({ source: 'image', image: '/pictures/one', transparency: 100 });
  assert.equal(store.config.transparency, 100);
  assert.equal((await store.commit({ transparency: 100 })).transparency, 100);
  assert.equal((await store.commit({ image: '/pictures/two', transparency: 100 })).transparency, 100);
});

test('glass keeps full transparency', async () => {
  const { store } = harness();
  await store.commit({ source: 'wallpaper', transparency: 100 });
  assert.equal((await store.commit({ source: 'glass' })).transparency, 100);
});

test('edits sent with a new picture win over the reset', async () => {
  const { store } = harness();
  await store.commit({ source: 'image', image: '/pictures/one', zoom: 200 });
  const config = await store.commit({ image: '/pictures/two', zoom: 150 });
  assert.equal(config.zoom, 150);
});

test('sending the same picture again keeps its edits', async () => {
  const { store } = harness();
  await store.commit({ source: 'image', image: '/pictures/one', zoom: 200 });
  assert.equal((await store.commit({ image: '/pictures/one' })).zoom, 200);
});

test('choosing the image source without a picture is refused', async () => {
  const { store } = harness();
  await assert.rejects(store.commit({ source: 'image' }), /请先选择图片/);
  assert.equal(store.config.source, 'default');
});

test('a bad image leaves the working background alone', async () => {
  const { store } = harness();
  await store.commit({ source: 'image', image: '/pictures/good', zoom: 150 });
  await assert.rejects(store.commit({ image: '/pictures/broken' }), /无法读取图片/);
  assert.equal(store.config.image, '/pictures/good');
  assert.equal(store.read().zoom, 150);
});

test('only config fields can be set from a message', async () => {
  const { store } = harness();
  const message = JSON.parse('{"source":"glass","extra":"x","__proto__":{"transparency":3}}');
  const config = await store.commit(message);
  assert.equal(Object.hasOwn(config, 'extra'), false);
  assert.notEqual(config.transparency, 3);
});

test('the default source loads no images and reads no screens', async () => {
  let reads = 0;
  const { store } = harness({ readScreens: async () => { reads++; return []; } });
  const { payload, files } = await store.rebuild();
  assert.equal(payload.config.source, 'default');
  assert.deepEqual(files, {});
  assert.equal(reads, 0);
});

test('a picture fills the window and never reads the screens', async () => {
  let reads = 0;
  const { store } = harness({ readScreens: async () => { reads++; return []; } });
  await store.commit({ source: 'image', image: '/pictures/mine' });
  const { payload, files } = await store.rebuild();
  assert.equal(payload.image, 'mine');
  assert.deepEqual(payload.screens, []);
  assert.deepEqual(Object.keys(files), ['mine']);
  assert.equal(reads, 0);
});

test('two screens sharing a wallpaper share one image', async () => {
  const { store } = harness();
  await store.commit({ source: 'wallpaper' });
  const { payload, files } = await store.rebuild();
  assert.deepEqual(payload.screens.map(screen => screen.image), ['one', 'one']);
  assert.deepEqual(Object.keys(files), ['one']);
  assert.equal(payload.error, null);
});

test('a missing wallpaper is reported instead of hidden', async () => {
  const { store } = harness({ readScreens: async () => [{ x: 0, y: 0, width: 10, height: 10, image: null }] });
  await store.commit({ source: 'wallpaper' });
  assert.match((await store.rebuild()).payload.error, /壁纸/);
});

test('unreadable screens are reported instead of crashing the agent', async () => {
  const { store } = harness({ readScreens: async () => { throw new Error('no bridge'); } });
  await store.commit({ source: 'glass' });
  assert.match((await store.rebuild()).payload.error, /壁纸/);
});

test('a moved image is reported instead of crashing the agent', async () => {
  const { store } = harness();
  await store.commit({ source: 'image', image: '/pictures/good' });
  store.config = { ...store.config, image: '/pictures/broken' };
  const { payload } = await store.rebuild();
  assert.match(payload.error, /无法读取图片/);
  assert.equal(payload.image, null);
});

test('old images are cleaned up', async () => {
  const { store } = harness();
  await store.commit({ source: 'image', image: '/pictures/first' });
  await store.rebuild();
  assert.deepEqual(fs.readdirSync(store.dir), ['first.jpg']);
  await store.commit({ image: '/pictures/second' });
  const { payload } = await store.rebuild();
  assert.deepEqual(fs.readdirSync(store.dir), ['second.jpg']);
  assert.equal(payload.image, 'second');
});

test('refresh stays quiet until something changes', async () => {
  const { store, clock } = harness();
  assert.ok(await store.refresh());
  assert.equal(await store.refresh(), null);
  await store.commit({ source: 'wallpaper' });
  assert.ok(await store.rebuild());
  assert.equal(await store.refresh(), null);
  clock.now += 60000;
  assert.equal(await store.refresh(), null, 'the same wallpaper needs no update');
});

test('refresh notices a wallpaper change once the interval passes', async () => {
  let image = '/wall/one';
  const { store, clock } = harness({ readScreens: async () => [{ x: 0, y: 0, width: 10, height: 10, image }] });
  await store.commit({ source: 'wallpaper' });
  await store.rebuild();
  image = '/wall/two';
  assert.equal(await store.refresh(), null, 'not due yet');
  clock.now += 60000;
  assert.equal((await store.refresh()).payload.screens[0].image, 'two');
});

test('refresh picks up a file written by the CLI', async () => {
  const { root, store } = harness();
  await store.rebuild();
  const cli = new BackgroundStore({ root });
  await cli.commit({ source: 'glass', transparency: 11 });
  fs.utimesSync(cli.file, new Date(), new Date(Date.now() + 5000));
  const { payload } = await store.refresh();
  assert.equal(payload.config.transparency, 11);
});
