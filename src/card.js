// Runs inside the Codex renderer. Must stay self-contained: cdp.cjs injects this file as text.
function installCodexRingsideCard() {
  const VERSION = 13;
  const KEY = '__codexRingsideCard';
  const STALE_AFTER_MS = 150000;
  const TICKS = 30;
  const TICK_COLORS = {
    normal: [[34, 211, 238], [52, 224, 130]],
    warning: [[250, 204, 21], [249, 115, 22]],
    danger: [[251, 146, 60], [239, 68, 68]]
  };
  if (window[KEY]?.version === VERSION) {
    window[KEY].place();
    return;
  }
  window[KEY]?.destroy?.();

  const card = document.createElement('div');
  card.id = 'codex-ringside-card';
  card.tabIndex = 0;
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', 'Codex 剩余额度');
  card.setAttribute('aria-describedby', 'codex-ringside-tooltip');
  card.setAttribute('aria-haspopup', 'dialog');

  const tooltip = document.createElement('div');
  tooltip.id = 'codex-ringside-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;

  const style = document.createElement('style');
  style.id = 'codex-ringside-style';
  const dark = `
    --ringside-track: #ffffff26; --ringside-text: #f2f4f2; --ringside-label: #b4b9b5;
  `;
  style.textContent = `
    #codex-ringside-card {
      --ringside-track: #dfe3e9; --ringside-text: #25313a; --ringside-label: #65737c;
      --ringside-hover: color-mix(in srgb, var(--ringside-text) 12%, transparent);
      box-sizing: border-box; width: 30px; flex: 0 0 auto; align-self: center; margin: 0 0 8px; padding: 0;
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      border-radius: 4px; outline: none;
      color: var(--ringside-text); background: transparent; cursor: pointer; user-select: none;
      -webkit-app-region: no-drag; font-family: inherit; font-variant-numeric: tabular-nums; line-height: 1;
      transition: background-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
    }
    /* The spread also grows the corners, so the outer radius is 4 + 3 = 7px; the width matches the rail buttons' 36px. */
    #codex-ringside-card:hover { background: var(--ringside-hover); box-shadow: 0 0 0 3px var(--ringside-hover); }
    #codex-ringside-card:active { transform: scale(.96); }
    @media (prefers-reduced-motion: reduce) { #codex-ringside-card { transition: none; } }
    html.dark #codex-ringside-card, html[data-theme="dark"] #codex-ringside-card { ${dark} }
    @media (prefers-color-scheme: dark) {
      html:not(.light):not([data-theme="light"]) #codex-ringside-card { ${dark} }
    }
    #codex-ringside-card[hidden], #codex-ringside-tooltip[hidden] { display: none !important; }
    #codex-ringside-card:focus-visible { outline: 1px solid var(--ringside-text); outline-offset: 2px; }
    #codex-ringside-card .ringside-meter { position: relative; flex: 0 0 auto; width: 30px; height: 30px; }
    #codex-ringside-card .ringside-meter[data-tone="normal"] { --ringside-glow: #34e08280; }
    #codex-ringside-card .ringside-meter[data-tone="warning"] { --ringside-glow: #f9731680; }
    #codex-ringside-card .ringside-meter[data-tone="danger"] { --ringside-glow: #ef444480; }
    #codex-ringside-card svg { display: block; width: 100%; height: 100%; overflow: visible; }
    #codex-ringside-card .ringside-track { fill: none; stroke: var(--ringside-track); stroke-width: 3.6; }
    #codex-ringside-card .ringside-ticks { stroke-width: 2.5; filter: drop-shadow(0 0 1.5px var(--ringside-glow, transparent)); }
    #codex-ringside-card .ringside-center {
      position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
    }
    #codex-ringside-card .ringside-number { font-size: 8px; line-height: 9px; font-weight: 600; letter-spacing: -.3px; white-space: nowrap; }
    #codex-ringside-card .ringside-label { font-size: 6.5px; line-height: 8px; color: var(--ringside-label); white-space: nowrap; }
    #codex-ringside-tooltip {
      box-sizing: border-box; position: fixed; z-index: 2147483000; min-width: 170px; max-width: min(320px, calc(100vw - 16px));
      padding: 12px 14px; border: 1px solid color-mix(in srgb, currentColor 12%, transparent); border-radius: 10px;
      background: var(--color-surface-elevated-secondary, #f8f8f7); color: var(--color-text-primary, #303630);
      box-shadow: 0 4px 18px #0002; pointer-events: none; -webkit-app-region: no-drag;
      font: 12px/1.5 -apple-system, BlinkMacSystemFont, sans-serif;
    }
    html.dark #codex-ringside-tooltip, html[data-theme="dark"] #codex-ringside-tooltip {
      background: var(--color-surface-elevated-secondary, #2c2e2c); color: var(--color-text-primary, #edf0ed);
    }
    @media (prefers-color-scheme: dark) {
      html:not(.light):not([data-theme="light"]) #codex-ringside-tooltip {
        background: var(--color-surface-elevated-secondary, #2c2e2c); color: var(--color-text-primary, #edf0ed);
      }
    }
    #codex-ringside-tooltip .ringside-title { font-weight: 600; }
    #codex-ringside-tooltip .ringside-sections { display: flex; gap: 20px; margin-top: 8px; }
    #codex-ringside-tooltip .ringside-section-percent { margin: 2px 0; font-size: 22px; line-height: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
    #codex-ringside-tooltip .ringside-dim { opacity: .68; font-size: 11px; white-space: nowrap; }
    #codex-ringside-tooltip .ringside-footer { margin-top: 10px; padding-top: 8px; border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent); }
  `;

  let value = { rings: [], message: '正在读取 Codex 剩余额度', note: null, stale: false, updatedAt: null };
  let rail = null;
  let placementTimer = null;
  let hoverTimer = null;
  let disposed = false;

  const element = (className, text) => {
    const node = document.createElement('div');
    node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const visible = node => {
    if (!node?.isConnected) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden';
  };
  const percentText = percent => (Number.isFinite(percent) ? `${percent}%` : '—');

  // Filled ticks run clockwise from 12 o'clock; the unused part of the circle stays a solid track.
  function ringSvg(percent, tone) {
    const filled = Number.isFinite(percent) && percent > 0 ? Math.max(1, Math.round(percent / 100 * TICKS)) : 0;
    const [from, to] = TICK_COLORS[tone] ?? TICK_COLORS.normal;
    const ticks = Array.from({ length: filled }, (_, index) => {
      const angle = ((index + 0.5) / TICKS) * 2 * Math.PI - Math.PI / 2;
      const point = radius => [Math.cos(angle), Math.sin(angle)].map(axis => (22 + radius * axis).toFixed(2));
      const [x1, y1] = point(17);
      const [x2, y2] = point(21.9);
      const progress = filled > 1 ? index / (filled - 1) : 0;
      const color = from.map((channel, i) => Math.round(channel + (to[i] - channel) * progress));
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgb(${color.join(',')})"/>`;
    }).join('');
    const used = (filled / TICKS) * 100;
    return '<svg viewBox="0 0 44 44" aria-hidden="true">'
      + `<circle class="ringside-track" cx="22" cy="22" r="19.5" pathLength="100" stroke-dasharray="${100 - used} 100"`
      + ` stroke-dashoffset="${-used}" transform="rotate(-90 22 22)"/><g class="ringside-ticks">${ticks}</g></svg>`;
  }

  function buildMeter(ring) {
    const meter = element('ringside-meter');
    meter.dataset.tone = ring.tone;
    meter.innerHTML = ringSvg(ring.percent, ring.tone);
    const center = element('ringside-center');
    // "100%" is too wide for the ring's inner circle; the tooltip still shows the full text.
    const number = ring.percent === 100 ? '100' : percentText(ring.percent);
    center.append(element('ringside-number', number), element('ringside-label', ring.label));
    meter.append(center);
    meter.setAttribute('role', 'meter');
    meter.setAttribute('aria-label', ring.name ?? ring.label);
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', '100');
    if (Number.isFinite(ring.percent)) meter.setAttribute('aria-valuenow', String(ring.percent));
    return meter;
  }

  function renderTooltip() {
    const sections = element('ringside-sections');
    for (const ring of value.rings ?? []) {
      const section = element('ringside-section');
      section.append(element('ringside-dim', ring.name ?? ring.label), element('ringside-section-percent', percentText(ring.percent)));
      if (ring.resetsAt) section.append(element('ringside-dim', `${ring.resetsAt} 重置`));
      sections.append(section);
    }
    const lines = [element('ringside-title', 'Codex 剩余额度')];
    if (sections.childElementCount) lines.push(sections);
    if (value.message) lines.push(element('ringside-dim', value.message));
    if (value.note) {
      const footer = element('ringside-dim ringside-footer', value.note);
      lines.push(footer);
    }
    tooltip.replaceChildren(...lines);
  }

  function render() {
    const rings = value.rings?.length ? value.rings : [{ label: '额度', name: '额度', percent: null, tone: 'muted' }];
    card.replaceChildren(...rings.map(buildMeter));
    renderTooltip();
    if (!tooltip.hidden) positionTooltip();
  }

  // A dead agent must not leave a healthy-looking number on screen.
  function expire() {
    if (disposed || value.stale || !Number.isFinite(value.updatedAt) || Date.now() - value.updatedAt < STALE_AFTER_MS) return;
    value = {
      ...value,
      stale: true,
      message: '额度数据已过期，正在等待重新连接',
      rings: (value.rings ?? []).map(ring => ({ ...ring, percent: null, tone: 'muted', resetsAt: null }))
    };
    render();
  }
  const freshnessTimer = setInterval(expire, 1000);

  const panelOpen = () => document.getElementById('codex-ringside-panel')?.hidden === false;
  function togglePanel() {
    hideTooltip();
    window.__codexRingsideBackground?.togglePanel(card);
  }

  function positionTooltip() {
    const rect = card.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(rect.right + 12, innerWidth - tooltip.offsetWidth - 8))}px`;
    const top = rect.top + rect.height / 2 - tooltip.offsetHeight / 2;
    tooltip.style.top = `${Math.max(8, Math.min(top, innerHeight - tooltip.offsetHeight - 8))}px`;
  }
  function hideTooltip() {
    clearTimeout(hoverTimer);
    hoverTimer = null;
    tooltip.hidden = true;
  }
  function showTooltip() {
    clearTimeout(hoverTimer);
    if (disposed || document.hidden || !visible(card) || panelOpen()) return;
    tooltip.hidden = false;
    positionTooltip();
  }
  function scheduleTooltip() {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(showTooltip, 350);
  }

  function place() {
    if (disposed || !document.body) return;
    if (!style.isConnected) (document.head ?? document.documentElement).appendChild(style);
    if (!tooltip.isConnected) document.body.appendChild(tooltip);
    const nextRail = [...document.querySelectorAll('nav[data-app-navigation-rail]')].find(visible) ?? null;
    if (rail !== nextRail) {
      if (rail) resizeObserver.unobserve(rail);
      rail = nextRail;
      if (rail) resizeObserver.observe(rail);
    }
    // Own a sibling just before the rail's footer; never move React-owned nodes.
    const footer = rail && [...rail.children]
      .filter(child => child !== card && visible(child) && getComputedStyle(child).position !== 'absolute')
      .at(-1);
    if (!footer) {
      card.hidden = true;
      hideTooltip();
      return;
    }
    card.hidden = false;
    if (card.parentElement !== rail || card.nextElementSibling !== footer) rail.insertBefore(card, footer);
    if (!tooltip.hidden) positionTooltip();
  }
  function schedulePlacement() {
    if (disposed || placementTimer !== null) return;
    placementTimer = setTimeout(() => {
      placementTimer = null;
      place();
    }, 100);
  }

  const ownNode = node => card.contains(node) || tooltip.contains(node) || node === style;
  const observer = new MutationObserver(records => {
    if (records.some(record => !ownNode(record.target))) schedulePlacement();
  });
  const resizeObserver = new ResizeObserver(schedulePlacement);
  const onKeyDown = event => {
    if (event.key === 'Escape') hideTooltip();
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    togglePanel();
  };

  observer.observe(document.documentElement, { childList: true, subtree: true });
  card.addEventListener('mouseenter', scheduleTooltip);
  card.addEventListener('mouseleave', hideTooltip);
  card.addEventListener('focus', showTooltip);
  card.addEventListener('blur', hideTooltip);
  card.addEventListener('keydown', onKeyDown);
  card.addEventListener('click', togglePanel);
  window.addEventListener('resize', schedulePlacement);
  document.addEventListener('visibilitychange', hideTooltip);

  window[KEY] = {
    version: VERSION,
    place,
    update(next) {
      value = { ...value, ...next };
      expire();
      render();
      place();
    },
    status() {
      return {
        version: VERSION,
        placed: card.parentElement === rail && !card.hidden && visible(card),
        rings: value.rings,
        message: value.message,
        stale: value.stale ?? false,
        updatedAt: value.updatedAt ?? null,
        cardCount: document.querySelectorAll('#codex-ringside-card').length
      };
    },
    destroy() {
      disposed = true;
      observer.disconnect();
      resizeObserver.disconnect();
      clearTimeout(placementTimer);
      clearInterval(freshnessTimer);
      hideTooltip();
      window.removeEventListener('resize', schedulePlacement);
      document.removeEventListener('visibilitychange', hideTooltip);
      card.remove();
      tooltip.remove();
      style.remove();
      delete window[KEY];
    }
  };
  render();
  place();
}
