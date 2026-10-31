'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);

const SIPS = '/usr/bin/sips';
const MAX_EDGE = 3840;
const WALLPAPER_MS = 60000;
const MIN_CROP = 0.05;

const SOURCES = ['default', 'image', 'wallpaper', 'glass'];
const LAYOUTS = ['cover', 'contain', 'stretch', 'center', 'tile'];
const SCREEN_SOURCES = new Set(['wallpaper', 'glass']);
const PICTURE_SOURCES = new Set(['image', 'wallpaper']);
const INVISIBLE_TRANSPARENCY = 95;
// [min, max, default]
const NUMBERS = {
  transparency: [0, 100, 45],
  blur: [0, 60, 0],
  zoom: [10, 400, 100],
  x: [0, 100, 50],
  y: [0, 100, 30],
  brightness: [0, 200, 100],
  contrast: [0, 200, 100],
  saturation: [0, 200, 100]
};
// Everything that only makes sense for one picture, and so starts over with a new one.
// y sits above centre: a tall photo in a wide window keeps its subject, usually in the upper part.
const IMAGE_EDITS = { layout: 'cover', zoom: 100, x: 50, y: 30, crop: null, brightness: 100, contrast: 100, saturation: 100 };
const CONFIG_KEYS = ['source', 'image', 'transparency', 'blur', ...Object.keys(IMAGE_EDITS)];

const text = value => (typeof value === 'string' && value ? value : null);

function normalizeCrop(raw) {
  const values = [raw?.x, raw?.y, raw?.w, raw?.h];
  if (!values.every(Number.isFinite)) return null;
  const x = Math.min(1 - MIN_CROP, Math.max(0, raw.x));
  const y = Math.min(1 - MIN_CROP, Math.max(0, raw.y));
  const w = Math.min(1 - x, raw.w);
  const h = Math.min(1 - y, raw.h);
  if (w < MIN_CROP || h < MIN_CROP || (w === 1 && h === 1)) return null;
  const round = value => Math.round(value * 10000) / 10000;
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

function normalizeBackground(raw) {
  const image = text(raw?.image);
  const known = SOURCES.includes(raw?.source) && (raw.source !== 'image' || image);
  const numbers = Object.fromEntries(Object.entries(NUMBERS).map(([key, [min, max, fallback]]) => {
    const value = raw?.[key];
    return [key, Number.isFinite(value) ? Math.round(Math.min(max, Math.max(min, value))) : fallback];
  }));
  return {
    source: known ? raw.source : 'default',
    image,
    ...numbers,
    layout: LAYOUTS.includes(raw?.layout) ? raw.layout : 'cover',
    crop: normalizeCrop(raw?.crop)
  };
}

function parseNumber(flag, value) {
  const number = Number(value);
  if (value === '' || !Number.isFinite(number)) throw new Error(`${flag} 需要一个数字`);
  return number;
}

function parseCrop(value) {
  if (value === 'none') return null;
  const parts = value.split(',').map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) throw new Error('--crop 的格式是 左,上,宽,高（百分比）或 none');
  const [x, y, w, h] = parts.map(part => part / 100);
  return { x, y, w, h };
}

// Only what was asked for: anything left out keeps its saved value.
function parseBackgroundArgs(args) {
  const changes = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!flag.startsWith('--')) {
      positional.push(flag);
      continue;
    }
    const value = args[++i];
    const name = flag.slice(2);
    if (value === undefined) throw new Error(`${flag} 缺少参数`);
    if (Object.hasOwn(NUMBERS, name)) changes[name] = parseNumber(flag, value);
    else if (name === 'crop') changes.crop = parseCrop(value);
    else if (name === 'layout') {
      if (!LAYOUTS.includes(value)) throw new Error(`未知布局：${value}，可选 ${LAYOUTS.join(' / ')}`);
      changes.layout = value;
    } else throw new Error(`未知参数：${flag}`);
  }
  const [source, image, ...extra] = positional;
  if (source !== undefined && !SOURCES.includes(source)) throw new Error(`未知来源：${source}，可选 ${SOURCES.join(' / ')}`);
  const unexpected = [...(source === 'image' || image === undefined ? [] : [image]), ...extra];
  if (unexpected.length) throw new Error(`多余的参数：${unexpected.join(' ')}`);
  if (source) changes.source = source;
  if (source === 'image' && image) changes.image = path.resolve(image);
  return changes;
}

async function imageSize(source) {
  const { stdout } = await run(SIPS, ['-g', 'pixelWidth', '-g', 'pixelHeight', source], { timeout: 15000 });
  return [...stdout.matchAll(/pixel(?:Width|Height):\s*(\d+)/g)].map(match => Number(match[1]));
}

// Output is named after the source's identity, so an unchanged file is never converted twice.
async function prepareImage(source, dir) {
  let output;
  let temp;
  try {
    const { mtimeMs, size } = fs.statSync(source);
    const name = crypto.createHash('sha256').update(`${source}\0${mtimeMs}\0${size}`).digest('hex').slice(0, 16);
    output = path.join(dir, `${name}.jpg`);
    if (fs.existsSync(output)) return output;
    temp = `${output}.tmp`;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // sips -Z also enlarges, and a small picture should stay small.
    const resize = Math.max(...await imageSize(source)) > MAX_EDGE ? ['-Z', String(MAX_EDGE)] : [];
    await run(SIPS, ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', ...resize, source, '--out', temp], { timeout: 30000 });
    fs.renameSync(temp, output);
    return output;
  } catch {
    throw new Error(`无法读取图片：${source}`);
  } finally {
    if (temp) fs.rmSync(temp, { force: true });
  }
}

async function readScreens(root, app) {
  const { stdout } = await run(path.join(root, 'bridge'), ['wallpaper', app], { timeout: 10000, maxBuffer: 65536 });
  return JSON.parse(stdout).screens;
}

class BackgroundStore {
  constructor({ root, readScreens: screens = async () => [], prepare = prepareImage, now = Date.now }) {
    this.file = path.join(root, 'background.json');
    this.dir = path.join(root, 'background');
    this.readScreens = screens;
    this.prepare = prepare;
    this.now = now;
    this.seen = this.stamp();
    this.config = this.read();
    this.current = null;
    this.nextScreens = 0;
  }

  stamp() {
    try {
      return fs.statSync(this.file).mtimeMs;
    } catch {
      return null;
    }
  }

  read() {
    try {
      return normalizeBackground(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      return normalizeBackground(null);
    }
  }

  // Prepares before saving, so a bad file never replaces a working background.
  async commit(changes) {
    const allowed = Object.fromEntries(Object.entries(changes ?? {}).filter(([key]) => CONFIG_KEYS.includes(key)));
    const newImage = allowed.image && allowed.image !== this.config.image;
    const config = normalizeBackground({ ...this.config, ...(newImage ? IMAGE_EDITS : {}), ...allowed });
    if (allowed.source === 'image' && !config.image) throw new Error('请先选择图片');
    // A picture someone just chose has to show up, whatever the slider was left at.
    const newSource = PICTURE_SOURCES.has(allowed.source) && allowed.source !== this.config.source;
    if ((newImage || newSource) && allowed.transparency === undefined && config.transparency >= INVISIBLE_TRANSPARENCY) {
      config.transparency = NUMBERS.transparency[2];
    }
    if (newImage) await this.prepare(config.image, this.dir);
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, this.file);
    this.config = config;
    this.seen = this.stamp();
    return config;
  }

  async build() {
    const { config } = this;
    const files = {};
    const use = async source => {
      if (!source) return null;
      const file = await this.prepare(source, this.dir);
      const id = path.basename(file, '.jpg');
      files[id] = file;
      return id;
    };
    let image = null;
    const screens = [];
    let error = null;
    try {
      if (config.source === 'image') {
        image = await use(config.image);
      } else if (SCREEN_SOURCES.has(config.source)) {
        let found = [];
        try {
          found = await this.readScreens();
        } catch {
          // Reported below, the same as a screen with no wallpaper.
        }
        // One at a time: two screens usually share a wallpaper, and the second reuses the first's file.
        for (const screen of found) screens.push({ ...screen, image: await use(screen.image) });
        if (!screens.some(screen => screen.image)) error = '读不到桌面壁纸，可以改用自己的图片';
      }
    } catch (failure) {
      error = failure.message;
    }
    this.prune(files);
    const key = crypto.createHash('sha256').update(JSON.stringify({ config, image, screens, error })).digest('hex').slice(0, 16);
    return { payload: { key, config, image, screens, error }, files };
  }

  prune(files) {
    let names;
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return;
    }
    const keep = new Set(Object.keys(files).map(id => `${id}.jpg`));
    for (const name of names) {
      if (!keep.has(name)) fs.rmSync(path.join(this.dir, name), { force: true });
    }
  }

  // Resolves to the new background, or null when nothing the renderer sees has changed.
  async rebuild() {
    this.nextScreens = this.now() + WALLPAPER_MS;
    const next = await this.build();
    if (next.payload.key === this.current?.payload.key) return null;
    this.current = next;
    return next;
  }

  async refresh() {
    const stamp = this.stamp();
    const changed = stamp !== this.seen;
    const due = SCREEN_SOURCES.has(this.config.source) && this.now() >= this.nextScreens;
    if (!changed && !due && this.current) return null;
    if (changed) {
      this.seen = stamp;
      this.config = this.read();
    }
    return this.rebuild();
  }
}

module.exports = { BackgroundStore, IMAGE_EDITS, normalizeBackground, parseBackgroundArgs, prepareImage, readScreens };
