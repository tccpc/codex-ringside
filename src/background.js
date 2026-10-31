// Runs inside the Codex renderer. Must stay self-contained: cdp.cjs injects this file as text.
function installCodexRingsideBackground() {
  const VERSION = 12;
  const KEY = '__codexRingsideBackground';
  const ATTRIBUTE = 'data-ringside-background';
  const PAGE_LAYER = 'data-ringside-page-layer';
  const SWEEP_MS = 250;
  const SWEEP_POINTS = [0.25, 0.5, 0.75];
  const UNTOUCHED = '.xterm, pre, code, webview, iframe, canvas, video';
  const TRACK_MS = 100;
  const SEND_DELAY_MS = 300;
  const FALLBACK_BLUR = 40;
  const GLASS_FLOOR = 0.3;
  const MIN_CROP = 0.05;
  const INVISIBLE_TRANSPARENCY = 95;
  const ZOOM_RANGE = [10, 400];
  const FRAME_MAX = [290, 180];
  const THEMES = [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']];
  const THEME_SETTING = { key: 'appearanceTheme' };
  const SOURCES = [['default', '关闭'], ['image', '图片'], ['wallpaper', '壁纸'], ['glass', '毛玻璃']];
  const LAYOUTS = [['cover', '铺满'], ['contain', '适应'], ['stretch', '拉伸'], ['center', '居中'], ['tile', '平铺']];
  const IMAGE_EDITS = { layout: 'cover', zoom: 100, x: 50, y: 30, crop: null, brightness: 100, contrast: 100, saturation: 100 };
  const CORNERS = ['nw', 'ne', 'sw', 'se'];
  const SCREEN_SOURCES = new Set(['wallpaper', 'glass']);
  if (window[KEY]?.version === VERSION) {
    window[KEY].place();
    return;
  }
  window[KEY]?.destroy?.();

  const root = document.documentElement;
  const element = (className, text, tag = 'div') => {
    const node = document.createElement(tag);
    node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const button = (className, label, onClick) => {
    const node = element(className, label, 'button');
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const backdrop = element('');
  backdrop.id = 'codex-ringside-backdrop';
  backdrop.hidden = true;
  const base = element('ringside-backdrop-base');
  const picture = element('ringside-backdrop-image');
  backdrop.append(base, picture);

  const panel = element('');
  panel.id = 'codex-ringside-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Codex 背景设置');

  function segmented(label, options, onPick) {
    const group = element('ringside-segments');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', label);
    const buttons = new Map(options.map(([value, text]) => {
      const node = button('ringside-segment', text, () => onPick(value));
      node.setAttribute('role', 'radio');
      group.append(node);
      return [value, node];
    }));
    return { group, buttons };
  }

  function field(label, name, min, max, unit) {
    const wrapper = element('ringside-field', null, 'label');
    const input = element('', null, 'input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.setAttribute('aria-label', label);
    const output = element('ringside-field-value', null, 'span');
    input.addEventListener('input', () => adjust({ [name]: Number(input.value) }));
    wrapper.append(element('ringside-field-label', label, 'span'), input, output);
    return { wrapper, input, output, name, unit };
  }

  const themes = segmented('外观模式', THEMES, chooseTheme);
  const themeControls = element('ringside-group');
  themeControls.hidden = true;
  themeControls.append(element('ringside-panel-title', '外观'), themes.group);
  const sources = segmented('背景来源', SOURCES, chooseSource);
  const layouts = segmented('图片布局', LAYOUTS, layout => adjust({ layout, zoom: 100 }));

  const frame = element('ringside-frame');
  const framePicture = element('ringside-frame-image');
  const cropBox = element('ringside-crop');
  cropBox.hidden = true;
  cropBox.dataset.handle = 'move';
  cropBox.append(...CORNERS.map(corner => {
    const handle = element(`ringside-crop-handle ringside-crop-${corner}`);
    handle.dataset.handle = corner;
    return handle;
  }));
  frame.append(framePicture, cropBox);

  const editActions = element('ringside-actions');
  const replaceButton = button('ringside-action', '更换图片', () => fileInput.click());
  const cropButton = button('ringside-action', '裁剪', startCrop);
  const resetButton = button('ringside-action', '重置', () => adjust(IMAGE_EDITS));
  editActions.append(replaceButton, cropButton, resetButton);
  const cropActions = element('ringside-actions');
  cropActions.hidden = true;
  cropActions.append(
    button('ringside-action ringside-action-primary', '应用', () => finishCrop(cropDraft)),
    button('ringside-action', '匹配窗口', matchWindow),
    button('ringside-action', '不裁剪', () => finishCrop(null)),
    button('ringside-action', '取消', () => setCropping(false))
  );

  const zoomField = field('缩放', 'zoom', ZOOM_RANGE[0], ZOOM_RANGE[1], '%');
  const xField = field('水平', 'x', 0, 100, '%');
  const yField = field('垂直', 'y', 0, 100, '%');

  const transparencyField = field('透明度', 'transparency', 0, 100, '%');
  const blurField = field('模糊', 'blur', 0, 60, 'px');

  const toneFields = [field('亮度', 'brightness', 0, 200, '%'), field('对比度', 'contrast', 0, 200, '%'), field('饱和度', 'saturation', 0, 200, '%')];
  const tone = element('ringside-tone', null, 'details');
  tone.append(element('ringside-tone-title', '调色', 'summary'), ...toneFields.map(item => item.wrapper));

  const fields = [zoomField, xField, yField, transparencyField, blurField, ...toneFields];
  const imageControls = element('ringside-group');
  imageControls.append(frame, editActions, cropActions, layouts.group, zoomField.wrapper, xField.wrapper, yField.wrapper, tone);
  const effectControls = element('ringside-group');
  effectControls.append(transparencyField.wrapper, blurField.wrapper);

  const hint = element('ringside-hint');
  const fileInput = element('', null, 'input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.hidden = true;
  panel.append(themeControls, element('ringside-panel-title', '背景'), sources.group, imageControls, effectControls, hint, fileInput);

  const style = element('', null, 'style');
  style.id = 'codex-ringside-background-style';
  const panelDark = 'background: var(--color-surface-elevated-secondary, #2c2e2c); color: var(--color-text-primary, #edf0ed);';
  style.textContent = `
    html[${ATTRIBUTE}], html[${ATTRIBUTE}] body { background: transparent !important; }
    html[${ATTRIBUTE}] [data-app-shell-page-surface],
    html[${ATTRIBUTE}] [data-app-shell-main-surface],
    html[${ATTRIBUTE}] [data-app-shell-main-titlebar],
    html[${ATTRIBUTE}] [data-sidebar-navigation-root],
    /* Named here as well as marked by the sweep, so a new page is clear on its very first frame. */
    html[${ATTRIBUTE}] [data-app-shell-main-surface] [class~="electron:bg-surface"],
    html[${ATTRIBUTE}] [${PAGE_LAYER}] {
      background-color: transparent !important;
      --color-background-panel: color-mix(in srgb, var(--color-surface, #fff) 72%, transparent);
    }
    html[${ATTRIBUTE}] [data-app-shell-main-surface] [style*="--color-background-panel"] { backdrop-filter: blur(20px); }
    /* A clip-path stops backdrop-filter at this element, and the picture sits behind it. */
    html[${ATTRIBUTE}] [data-app-shell-main-surface] { clip-path: none !important; }
    html[${ATTRIBUTE}] [class*="_MainContentTopFade_"],
    html[${ATTRIBUTE}] [class*="_background_"][class*="_fade_"],
    html[${ATTRIBUTE}] [class*="_background_"][class*="_surface_"] { background: none !important; }
    #codex-ringside-backdrop { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; contain: strict; }
    #codex-ringside-backdrop[hidden], #codex-ringside-panel[hidden], #codex-ringside-panel [hidden] { display: none !important; }
    #codex-ringside-backdrop .ringside-backdrop-base { position: absolute; inset: 0; background: var(--color-surface, #fff); }
    html.electron-opaque #codex-ringside-backdrop .ringside-backdrop-base { opacity: 1 !important; }
    #codex-ringside-backdrop .ringside-backdrop-image { position: absolute; }
    html[${ATTRIBUTE}="glass"]:not(.electron-opaque) #codex-ringside-backdrop .ringside-backdrop-image { display: none; }
    #codex-ringside-panel {
      box-sizing: border-box; position: fixed; z-index: 2147483000; width: 320px; max-height: calc(100vh - 16px); overflow-y: auto; padding: 14px;
      display: flex; flex-direction: column; gap: 10px;
      border: 1px solid color-mix(in srgb, currentColor 12%, transparent); border-radius: 12px;
      background: var(--color-surface-elevated-secondary, #f8f8f7); color: var(--color-text-primary, #303630);
      box-shadow: 0 6px 24px #0003; -webkit-app-region: no-drag; user-select: none;
      font: 12px/1.5 -apple-system, BlinkMacSystemFont, sans-serif;
    }
    html.dark #codex-ringside-panel, html[data-theme="dark"] #codex-ringside-panel { ${panelDark} }
    @media (prefers-color-scheme: dark) {
      html:not(.light):not([data-theme="light"]) #codex-ringside-panel { ${panelDark} }
    }
    #codex-ringside-panel .ringside-panel-title { font-weight: 600; }
    #codex-ringside-panel .ringside-group { display: flex; flex-direction: column; gap: 8px; }
    #codex-ringside-panel button { font: inherit; color: inherit; cursor: pointer; }
    #codex-ringside-panel .ringside-segments {
      display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: color-mix(in srgb, currentColor 8%, transparent);
    }
    #codex-ringside-panel .ringside-segment { flex: 1; padding: 4px 0; border: 0; border-radius: 6px; background: transparent; white-space: nowrap; }
    #codex-ringside-panel .ringside-segment[aria-checked="true"] { background: var(--color-surface, #fff); font-weight: 600; box-shadow: 0 1px 2px #0002; }
    #codex-ringside-panel .ringside-frame {
      position: relative; flex: 0 0 auto; align-self: center; overflow: hidden; border-radius: 8px; cursor: grab; touch-action: none;
      background: color-mix(in srgb, currentColor 8%, transparent);
    }
    #codex-ringside-panel .ringside-frame:active { cursor: grabbing; }
    #codex-ringside-panel .ringside-frame-image { position: absolute; }
    #codex-ringside-panel .ringside-crop { position: absolute; box-sizing: border-box; border: 1px solid #fff; box-shadow: 0 0 0 999px #0009; cursor: move; }
    #codex-ringside-panel .ringside-crop-handle { position: absolute; width: 10px; height: 10px; border-radius: 2px; background: #fff; box-shadow: 0 0 2px #0008; }
    #codex-ringside-panel .ringside-crop-nw { left: -5px; top: -5px; cursor: nwse-resize; }
    #codex-ringside-panel .ringside-crop-ne { right: -5px; top: -5px; cursor: nesw-resize; }
    #codex-ringside-panel .ringside-crop-sw { left: -5px; bottom: -5px; cursor: nesw-resize; }
    #codex-ringside-panel .ringside-crop-se { right: -5px; bottom: -5px; cursor: nwse-resize; }
    #codex-ringside-panel .ringside-field { display: flex; align-items: center; gap: 8px; }
    #codex-ringside-panel .ringside-field-label { flex: 0 0 38px; opacity: .68; }
    #codex-ringside-panel .ringside-field input { flex: 1; min-width: 0; margin: 0; accent-color: currentColor; }
    #codex-ringside-panel .ringside-field-value { flex: 0 0 38px; text-align: right; font-variant-numeric: tabular-nums; }
    #codex-ringside-panel .ringside-actions { display: flex; gap: 6px; }
    #codex-ringside-panel .ringside-action {
      flex: 1; padding: 4px 6px; border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
      border-radius: 6px; background: transparent; white-space: nowrap;
    }
    #codex-ringside-panel .ringside-action-primary { background: var(--color-surface, #fff); border-color: currentColor; font-weight: 600; }
    #codex-ringside-panel .ringside-tone { display: flex; flex-direction: column; }
    #codex-ringside-panel .ringside-tone-title { cursor: pointer; opacity: .68; }
    #codex-ringside-panel .ringside-tone .ringside-field { margin-top: 6px; }
    #codex-ringside-panel button:focus-visible, #codex-ringside-panel input:focus-visible { outline: 1px solid currentColor; outline-offset: 1px; }
    #codex-ringside-panel .ringside-hint { opacity: .68; font-size: 11px; }
  `;

  let config = { source: 'default', image: null, transparency: 45, blur: 0, ...IMAGE_EDITS };
  let payload = null;
  let notice = null;
  let pending = null;
  let sendTimer = null;
  let trackTimer = null;
  let layout = null;
  let anchor = null;
  let cropping = false;
  let cropDraft = null;
  let cropped = null;
  let cropJob = null;
  let drag = null;
  let sweepTimer = null;
  let lastSweep = 0;
  let themeAccess = null;
  let theme = null;
  let disposed = false;
  const images = new Map();

  const hasImage = () => config.source === 'image' && images.has(payload?.image);
  const windowBox = (margin = 0) => ({ width: innerWidth + margin * 2, height: innerHeight + margin * 2 });

  function currentScreen() {
    const screens = payload?.screens ?? [];
    if (!SCREEN_SOURCES.has(config.source)) return null;
    const x = screenX + innerWidth / 2;
    const y = screenY + innerHeight / 2;
    return screens.find(s => x >= s.x && x < s.x + s.width && y >= s.y && y < s.y + s.height) ?? screens[0] ?? null;
  }

  // Cropping happens once on a canvas, so every layout below only ever sees a plain picture.
  function editedImage() {
    const original = images.get(payload?.image);
    const { crop } = config;
    if (!original || !crop) return original ?? null;
    const key = `${payload.image}:${crop.x},${crop.y},${crop.w},${crop.h}`;
    if (cropped?.key === key) return cropped;
    if (cropJob !== key) {
      cropJob = key;
      makeCrop(original, crop, key).catch(() => notify('裁剪失败'));
    }
    return cropped?.id === payload.image ? cropped : original;
  }

  async function makeCrop(original, crop, key) {
    const width = Math.max(1, Math.round(crop.w * original.width));
    const height = Math.max(1, Math.round(crop.h * original.height));
    const left = Math.round(crop.x * original.width);
    const top = Math.round(crop.y * original.height);
    const bitmap = await createImageBitmap(original.blob, left, top, width, height);
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    if (cropJob !== key || disposed) return;
    if (cropped) URL.revokeObjectURL(cropped.url);
    cropped = { key, id: payload.image, url: URL.createObjectURL(blob), width, height };
    render();
  }

  function clearCropped() {
    if (cropped) URL.revokeObjectURL(cropped.url);
    cropped = null;
    cropJob = null;
  }

  function placement(natural, box) {
    const zoom = config.zoom / 100;
    const scale = {
      cover: Math.max(box.width / natural.width, box.height / natural.height),
      contain: Math.min(box.width / natural.width, box.height / natural.height),
      center: 1 / devicePixelRatio,
      tile: 1 / devicePixelRatio
    }[config.layout];
    return {
      width: (scale ? natural.width * scale : box.width) * zoom,
      height: (scale ? natural.height * scale : box.height) * zoom,
      repeat: config.layout === 'tile' ? 'repeat' : 'no-repeat'
    };
  }

  function filters(blur) {
    const steps = blur ? [`blur(${blur}px)`] : [];
    if (config.source === 'image') {
      steps.push(`brightness(${config.brightness}%)`, `contrast(${config.contrast}%)`, `saturate(${config.saturation}%)`);
    }
    return steps.join(' ') || 'none';
  }

  const backgroundOf = (source, spot) => `background-image: url("${source.url}");`
    + ` background-size: ${spot.width}px ${spot.height}px;`
    + ` background-position: ${config.x}% ${config.y}%; background-repeat: ${spot.repeat};`;

  function layoutPicture() {
    const screen = currentScreen();
    const blur = config.source === 'glass' ? FALLBACK_BLUR : config.blur;
    // A blurred edge fades out, so keep it outside the window.
    const margin = blur * 2;
    const opacity = `opacity: ${1 - config.transparency / 100};`;
    let next;
    if (hasImage()) {
      const source = editedImage();
      next = `inset: ${-margin}px; ${backgroundOf(source, placement(source, windowBox(margin)))} ${opacity}`;
    } else {
      const source = images.get(screen?.image);
      const box = screen
        ? `left: 0; top: 0; width: ${screen.width + margin * 2}px; height: ${screen.height + margin * 2}px;`
          + ` transform: translate(${screen.x - screenX - margin}px, ${screen.y - screenY - margin}px);`
        : 'inset: 0;';
      const image = source ? `url("${source.url}")` : 'none';
      next = `${box} background: center / cover no-repeat ${image}; ${opacity}`;
    }
    next += ` filter: ${filters(blur)};`;
    if (next === layout) return;
    layout = next;
    picture.style.cssText = next;
  }

  function syncTracking() {
    const tracking = SCREEN_SOURCES.has(config.source) && (payload?.screens?.length ?? 0) > 0;
    if (tracking && trackTimer === null) {
      trackTimer = setInterval(() => {
        if (!document.hidden) layoutPicture();
      }, TRACK_MS);
    } else if (!tracking && trackTimer !== null) {
      clearInterval(trackTimer);
      trackTimer = null;
    }
  }

  // Every page paints its own full-size layer. Square corners and no border tell it from a card.
  function isPageLayer(node, area) {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.backgroundColor !== 'rgba(0, 0, 0, 0)'
      && style.borderRadius === '0px'
      && style.borderTopWidth === '0px'
      && rect.width >= area.width * 0.4
      && rect.height >= area.height * 0.6
      && !node.closest(UNTOUCHED);
  }

  function sweepPageLayers() {
    sweepTimer = null;
    lastSweep = performance.now();
    if (disposed || !root.hasAttribute(ATTRIBUTE)) return;
    const surface = [...document.querySelectorAll('[data-app-shell-main-surface]')]
      .find(node => node.getBoundingClientRect().width > 0);
    if (!surface) return;
    const area = surface.getBoundingClientRect();
    for (const share of SWEEP_POINTS) {
      for (const node of document.elementsFromPoint(area.x + area.width * share, area.y + area.height / 2)) {
        if (node !== surface && surface.contains(node) && !node.hasAttribute(PAGE_LAYER) && isPageLayer(node, area)) {
          node.setAttribute(PAGE_LAYER, '');
        }
      }
    }
  }

  // Observer callbacks run before the next paint, so sweeping at once beats the first frame.
  function scheduleSweep() {
    if (disposed || sweepTimer !== null) return;
    const wait = lastSweep + SWEEP_MS - performance.now();
    if (wait <= 0) sweepPageLayers();
    else sweepTimer = setTimeout(sweepPageLayers, wait);
  }

  function renderBackdrop() {
    const { source } = config;
    const screen = currentScreen();
    const active = source === 'glass' || hasImage() || (source === 'wallpaper' && images.has(screen?.image));
    if (active) root.setAttribute(ATTRIBUTE, source);
    else root.removeAttribute(ATTRIBUTE);
    backdrop.hidden = !active;
    // Over live glass the base is only a light veil; once Codex drops the glass the CSS makes it solid.
    base.style.opacity = String(source === 'glass' ? 1 - config.transparency / 100 : GLASS_FLOOR);
    layoutPicture();
    syncTracking();
    scheduleSweep();
  }

  function hintText() {
    if (notice) return notice;
    if (payload?.error) return payload.error;
    if (config.source !== 'glass' && config.source !== 'default' && config.transparency >= INVISIBLE_TRANSPARENCY) {
      return `透明度 ${config.transparency}%，图片几乎看不见，把滑块往回拉`;
    }
    if (config.source === 'glass') {
      return root.classList.contains('electron-opaque')
        ? '窗口失焦或过大，系统毛玻璃已暂停，暂用模糊壁纸代替'
        : '实时透出桌面和其他窗口';
    }
    if (config.source === 'wallpaper') return '显示桌面壁纸，看不到其他窗口';
    if (cropping) return '拖动方框选择保留的区域';
    return hasImage() ? '拖动预览调整位置，滚轮缩放' : '';
  }

  function renderFrame() {
    const width = Math.min(FRAME_MAX[0], FRAME_MAX[1] * innerWidth / innerHeight);
    const height = width * innerHeight / innerWidth;
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    cropBox.hidden = !cropping;
    if (cropping) {
      const original = images.get(payload.image);
      const area = cropArea(original, width, height);
      framePicture.style.cssText = `left: ${area.left}px; top: ${area.top}px; width: ${area.width}px; height: ${area.height}px;`
        + ` background: center / 100% 100% no-repeat url("${original.url}");`;
      Object.assign(cropBox.style, {
        left: `${area.left + cropDraft.x * area.width}px`,
        top: `${area.top + cropDraft.y * area.height}px`,
        width: `${cropDraft.w * area.width}px`,
        height: `${cropDraft.h * area.height}px`
      });
      return;
    }
    const source = editedImage();
    const ratio = width / innerWidth;
    const spot = placement(source, windowBox());
    framePicture.style.cssText = `inset: 0; ${backgroundOf(source, { ...spot, width: spot.width * ratio, height: spot.height * ratio })}`
      + ` filter: ${filters(config.blur * ratio)};`;
  }

  function renderPanel() {
    const { source } = config;
    themeControls.hidden = theme === null;
    for (const [name, node] of themes.buttons) node.setAttribute('aria-checked', String(name === theme));
    for (const [name, node] of sources.buttons) node.setAttribute('aria-checked', String(name === source));
    imageControls.hidden = !hasImage();
    effectControls.hidden = source === 'default';
    for (const [name, node] of layouts.buttons) node.setAttribute('aria-checked', String(name === config.layout));
    for (const item of fields) {
      item.input.value = String(config[item.name]);
      item.output.textContent = `${config[item.name]}${item.unit}`;
    }
    editActions.hidden = cropping;
    cropActions.hidden = !cropping;
    layouts.group.hidden = cropping;
    zoomField.wrapper.hidden = cropping;
    xField.wrapper.hidden = cropping;
    yField.wrapper.hidden = cropping;
    tone.hidden = cropping;
    blurField.wrapper.hidden = source === 'glass';
    hint.textContent = hintText();
    hint.hidden = !hint.textContent;
    if (hasImage()) renderFrame();
    positionPanel();
  }

  function render() {
    renderBackdrop();
    if (!panel.hidden) renderPanel();
  }

  function positionPanel() {
    if (panel.hidden || !anchor?.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.right + 12, innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(rect.bottom - panel.offsetHeight, innerHeight - panel.offsetHeight - 8))}px`;
  }

  function notify(message) {
    notice = message;
    if (!panel.hidden) renderPanel();
  }

  function post(changes) {
    notice = null;
    if (typeof window.__codexRingsideSend !== 'function') {
      notify('后台任务未连接');
      return;
    }
    window.__codexRingsideSend(JSON.stringify(changes));
  }

  function cancelPending() {
    clearTimeout(sendTimer);
    sendTimer = null;
    pending = null;
  }

  function flush() {
    const changes = pending;
    cancelPending();
    if (changes) post(changes);
  }

  // Edits preview at once. A new source waits for the agent, which has to load its image first.
  function adjust(changes) {
    config = { ...config, ...changes };
    pending = { ...pending, ...changes };
    render();
    clearTimeout(sendTimer);
    sendTimer = setTimeout(flush, SEND_DELAY_MS);
  }

  // Codex's own settings helpers, taken from the module it already loaded. A new connect-app-host
  // port would replace the one the app runs on. Export names change per build, so match on content,
  // and a build where the match is not exact simply shows no control.
  async function loadThemeAccess() {
    const script = document.querySelector('script[src*="/app-shared-"], link[href*="/app-shared-"]');
    if (!script) return null;
    const shared = await import(script.src || script.href);
    const source = helper => {
      try {
        return Function.prototype.toString.call(helper);
      } catch {
        return '';
      }
    };
    const helpers = call => Object.values(shared).filter(helper => typeof helper === 'function'
      && source(helper).includes('Settings are unavailable') && source(helper).includes(call));
    const reads = helpers('.read(');
    const writes = helpers('.write(');
    if (reads.length !== 1 || writes.length !== 1) return null;
    return { read: () => reads[0](THEME_SETTING), write: mode => writes[0](THEME_SETTING, mode) };
  }

  async function refreshTheme() {
    themeAccess ??= loadThemeAccess().catch(() => null);
    const access = await themeAccess;
    const mode = await access?.read().catch(() => null);
    theme = THEMES.some(([name]) => name === mode) ? mode : null;
    if (!panel.hidden) renderPanel();
  }

  async function chooseTheme(mode) {
    const previous = theme;
    theme = mode;
    notice = null;
    renderPanel();
    try {
      await (await themeAccess).write(mode);
    } catch {
      theme = previous;
      notify('无法切换外观模式');
    }
  }

  function chooseSource(source) {
    setCropping(false);
    if (source === 'image' && !config.image) {
      fileInput.click();
      return;
    }
    flush();
    post({ source });
  }

  function onFileChosen() {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    let image = null;
    try {
      image = window.electronBridge?.getPathForFile?.(file) ?? null;
    } catch {
      // Handled below, the same as a build without this bridge call.
    }
    if (!image) {
      notify('无法读取所选文件的路径');
      return;
    }
    setCropping(false);
    flush();
    post({ source: 'image', image });
  }

  function cropArea(original, width, height) {
    const scale = Math.min(width / original.width, height / original.height);
    const shownWidth = original.width * scale;
    const shownHeight = original.height * scale;
    return { left: (width - shownWidth) / 2, top: (height - shownHeight) / 2, width: shownWidth, height: shownHeight };
  }

  function setCropping(next) {
    cropping = next;
    cropDraft = next ? (config.crop ?? { x: 0, y: 0, w: 1, h: 1 }) : null;
    if (!panel.hidden) renderPanel();
  }

  function startCrop() {
    if (hasImage()) setCropping(true);
  }

  function finishCrop(crop) {
    setCropping(false);
    adjust({ crop });
  }

  // The largest window-shaped area, so 铺满 shows exactly what was framed.
  function matchWindow() {
    const original = images.get(payload.image);
    const pictureRatio = original.width / original.height;
    const windowRatio = innerWidth / innerHeight;
    const w = windowRatio < pictureRatio ? windowRatio / pictureRatio : 1;
    const h = windowRatio < pictureRatio ? 1 : pictureRatio / windowRatio;
    cropDraft = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
    renderPanel();
  }

  function dragCrop(dx, dy) {
    const { handle, start, area } = drag;
    const moveX = dx / area.width;
    const moveY = dy / area.height;
    if (handle === 'move') {
      cropDraft = { ...start, x: clamp(start.x + moveX, 0, 1 - start.w), y: clamp(start.y + moveY, 0, 1 - start.h) };
      return;
    }
    const right = start.x + start.w;
    const bottom = start.y + start.h;
    const left = handle.includes('w') ? clamp(start.x + moveX, 0, right - MIN_CROP) : start.x;
    const top = handle.includes('n') ? clamp(start.y + moveY, 0, bottom - MIN_CROP) : start.y;
    const nextRight = handle.includes('e') ? clamp(right + moveX, left + MIN_CROP, 1) : right;
    const nextBottom = handle.includes('s') ? clamp(bottom + moveY, top + MIN_CROP, 1) : bottom;
    cropDraft = { x: left, y: top, w: nextRight - left, h: nextBottom - top };
  }

  // background-position is a share of the free space, so the pixels dragged are divided by that space.
  function dragPan(dx, dy) {
    const { start, spot, ratio } = drag;
    const freeX = (innerWidth - spot.width) * ratio;
    const freeY = (innerHeight - spot.height) * ratio;
    adjust({
      x: Math.abs(freeX) < 1 ? start.x : Math.round(clamp(start.x + dx / freeX * 100, 0, 100)),
      y: Math.abs(freeY) < 1 ? start.y : Math.round(clamp(start.y + dy / freeY * 100, 0, 100))
    });
  }

  function onFramePointerDown(event) {
    if (!hasImage()) return;
    const origin = { pointerX: event.clientX, pointerY: event.clientY };
    if (cropping) {
      const handle = event.target.dataset?.handle;
      if (!handle) return;
      drag = { ...origin, handle, start: cropDraft, area: cropArea(images.get(payload.image), frame.clientWidth, frame.clientHeight) };
    } else {
      drag = { ...origin, start: { x: config.x, y: config.y }, spot: placement(editedImage(), windowBox()), ratio: frame.clientWidth / innerWidth };
    }
    frame.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onFramePointerMove(event) {
    if (!drag) return;
    const dx = event.clientX - drag.pointerX;
    const dy = event.clientY - drag.pointerY;
    if (!cropping) {
      dragPan(dx, dy);
      return;
    }
    dragCrop(dx, dy);
    renderFrame();
  }

  function onFrameWheel(event) {
    if (cropping || !hasImage()) return;
    event.preventDefault();
    adjust({ zoom: Math.round(clamp(config.zoom * (1 - event.deltaY / 500), ZOOM_RANGE[0], ZOOM_RANGE[1])) });
  }

  function closePanel({ returnFocus = false } = {}) {
    if (panel.hidden) return;
    flush();
    setCropping(false);
    panel.hidden = true;
    if (returnFocus) anchor?.focus();
  }

  function openPanel(target) {
    anchor = target;
    notice = null;
    panel.hidden = false;
    renderPanel();
    refreshTheme();
    sources.buttons.get(config.source)?.focus();
  }

  function place() {
    if (disposed || !document.body) return;
    if (!style.isConnected) (document.head ?? root).appendChild(style);
    if (!backdrop.isConnected) document.body.appendChild(backdrop);
    if (!panel.isConnected) document.body.appendChild(panel);
    render();
  }

  const onPointerDown = event => {
    if (!panel.contains(event.target) && !anchor?.contains(event.target)) closePanel();
  };
  const onKeyDown = event => {
    if (event.key !== 'Escape' || panel.hidden) return;
    if (cropping) setCropping(false);
    else closePanel({ returnFocus: true });
  };
  const onResize = () => {
    layoutPicture();
    scheduleSweep();
    if (!panel.hidden) renderPanel();
  };
  const endDrag = () => {
    drag = null;
  };
  // Codex flips this class when the window loses its native glass, and the hint describes that.
  const opaqueObserver = new MutationObserver(() => {
    if (!panel.hidden) renderPanel();
  });
  const pageObserver = new MutationObserver(scheduleSweep);

  fileInput.addEventListener('change', onFileChosen);
  frame.addEventListener('pointerdown', onFramePointerDown);
  frame.addEventListener('pointermove', onFramePointerMove);
  frame.addEventListener('pointerup', endDrag);
  frame.addEventListener('pointercancel', endDrag);
  frame.addEventListener('wheel', onFrameWheel, { passive: false });
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);
  opaqueObserver.observe(root, { attributes: true, attributeFilter: ['class'] });
  pageObserver.observe(root, { childList: true, subtree: true });

  window[KEY] = {
    version: VERSION,
    place,
    notify,
    togglePanel(target) {
      if (panel.hidden) openPanel(target);
      else closePanel({ returnFocus: true });
    },
    state() {
      return { key: payload?.key ?? null, images: [...images.keys()] };
    },
    async addImage(id, base64) {
      if (images.has(id)) return;
      const blob = new Blob([Uint8Array.from(atob(base64), character => character.charCodeAt(0))], { type: 'image/jpeg' });
      const bitmap = await createImageBitmap(blob);
      images.set(id, { blob, url: URL.createObjectURL(blob), width: bitmap.width, height: bitmap.height });
      bitmap.close();
    },
    apply(next) {
      payload = next;
      if (!pending) config = next.config;
      const used = new Set([next.image, ...next.screens.map(screen => screen.image)]);
      for (const [id, { url }] of images) {
        if (used.has(id)) continue;
        URL.revokeObjectURL(url);
        images.delete(id);
        if (cropped?.id === id) clearCropped();
      }
      render();
    },
    status() {
      return {
        version: VERSION,
        source: config.source,
        applied: root.hasAttribute(ATTRIBUTE),
        nativeGlass: !root.classList.contains('electron-opaque'),
        tracking: trackTimer !== null,
        error: payload?.error ?? null
      };
    },
    destroy() {
      disposed = true;
      cancelPending();
      clearInterval(trackTimer);
      clearTimeout(sweepTimer);
      opaqueObserver.disconnect();
      pageObserver.disconnect();
      for (const node of document.querySelectorAll(`[${PAGE_LAYER}]`)) node.removeAttribute(PAGE_LAYER);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      for (const { url } of images.values()) URL.revokeObjectURL(url);
      clearCropped();
      root.removeAttribute(ATTRIBUTE);
      backdrop.remove();
      panel.remove();
      style.remove();
      delete window[KEY];
    }
  };
  place();
}
