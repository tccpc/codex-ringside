'use strict';
// Pure helpers: turn an account/rateLimits/read response into what the card renders.

const FIVE_HOURS = 300;
const ONE_WEEK = 10080;
const ONE_MONTH = 43200;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasField = (value, key) => isRecord(value) && Object.hasOwn(value, key);
const validWindow = value => isRecord(value) && Number.isFinite(value.usedPercent);
const isCodexLimit = value => value?.limitId == null || value.limitId === 'codex';
const near = (minutes, target) => Math.abs((minutes ?? 0) - target) <= 1;

function remainingPercent(used) {
  return Math.max(0, Math.min(100, Math.round(100 - used)));
}

function tone(percent) {
  if (!Number.isFinite(percent)) return 'muted';
  if (percent < 10) return 'danger';
  return percent <= 50 ? 'warning' : 'normal';
}

function windowLabels(minutes) {
  if (near(minutes, FIVE_HOURS)) return { short: '5小时', long: '5 小时额度' };
  if (near(minutes, ONE_WEEK)) return { short: '周', long: '每周额度' };
  if (near(minutes, ONE_MONTH)) return { short: '月', long: '每月额度' };
  for (const [unit, label] of [[1440, '天'], [60, '小时']]) {
    if (minutes > 0 && minutes % unit === 0) {
      return { short: `${minutes / unit}${label}`, long: `${minutes / unit} ${label}额度` };
    }
  }
  return { short: '额度', long: '额度' };
}

function formatResetTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

function pickCodexSnapshot(response) {
  if (!isRecord(response)) return null;
  if (hasField(response.rateLimitsByLimitId, 'codex')) {
    const keyed = response.rateLimitsByLimitId.codex;
    return isRecord(keyed) && isCodexLimit(keyed) ? keyed : null;
  }
  if (hasField(response, 'rateLimits')) {
    return isRecord(response.rateLimits) && isCodexLimit(response.rateLimits) ? response.rateLimits : null;
  }
  return null;
}

function mergeWindow(current, patch) {
  if (patch === undefined) return current ?? null;
  if (!isRecord(patch)) return null;
  const sameWindow = current
    && (!Number.isFinite(patch.windowDurationMins) || current.windowDurationMins === patch.windowDurationMins);
  return sameWindow ? { ...current, ...patch } : { ...patch };
}

function mergeSnapshot(current, patch) {
  if (patch === undefined) return current ?? null;
  if (!isRecord(patch)) return null;
  // A plan change means a different account: nothing from the old windows applies.
  const base = current?.planType && patch.planType && current.planType !== patch.planType ? null : current;
  return {
    ...base,
    ...patch,
    primary: mergeWindow(base?.primary, patch.primary),
    secondary: mergeWindow(base?.secondary, patch.secondary)
  };
}

// account/rateLimits/updated carries deltas; a read is a full snapshot (pass current = null).
function mergeResponse(current, patch) {
  if (patch === undefined) return current ?? null;
  if (!isRecord(patch)) return null;
  const changedAccount = hasField(patch, 'accountId') && hasField(current, 'accountId')
    && patch.accountId !== current.accountId;
  const base = changedAccount ? {} : current ?? {};
  const merged = { ...base, ...patch };
  merged.rateLimits = base.rateLimits ?? null;
  if (isRecord(base.rateLimitsByLimitId)) merged.rateLimitsByLimitId = base.rateLimitsByLimitId;

  if (hasField(patch, 'rateLimits') && isCodexLimit(patch.rateLimits)) {
    merged.rateLimits = mergeSnapshot(base.rateLimits, patch.rateLimits);
    if (isRecord(base.rateLimitsByLimitId)) {
      merged.rateLimitsByLimitId = { ...base.rateLimitsByLimitId, codex: merged.rateLimits };
    }
  }

  if (hasField(patch, 'rateLimitsByLimitId')) {
    if (!isRecord(patch.rateLimitsByLimitId)) {
      merged.rateLimitsByLimitId = null;
      if (!hasField(patch, 'rateLimits')) merged.rateLimits = null;
    } else {
      const next = { ...merged.rateLimitsByLimitId };
      for (const [id, snapshot] of Object.entries(patch.rateLimitsByLimitId)) {
        const previous = base.rateLimitsByLimitId?.[id] ?? (id === 'codex' ? base.rateLimits : null);
        Object.defineProperty(next, id, {
          value: mergeSnapshot(previous, snapshot), enumerable: true, configurable: true, writable: true
        });
      }
      merged.rateLimitsByLimitId = next;
      if (hasField(next, 'codex')) merged.rateLimits = next.codex;
    }
  }
  return merged;
}

function formatUsage(response) {
  const snapshot = pickCodexSnapshot(response);
  const windows = [snapshot?.primary, snapshot?.secondary]
    .filter(validWindow)
    .sort((a, b) => (a.windowDurationMins ?? 0) - (b.windowDurationMins ?? 0));
  const rings = windows.map(window => {
    const labels = windowLabels(window.windowDurationMins);
    const percent = remainingPercent(window.usedPercent);
    return { label: labels.short, name: labels.long, percent, tone: tone(percent), resetsAt: formatResetTime(window.resetsAt) };
  });
  return {
    rings,
    message: rings.length ? null : '暂时无法读取 Codex 剩余额度',
    note: resetCreditsNote(response)
  };
}

function resetCreditsNote(response) {
  const count = Number(response?.rateLimitResetCredits?.availableCount);
  return Number.isFinite(count) && count > 0 ? `重置卡：${Math.floor(count)} 张可用` : null;
}

function unavailable(value, message = '暂时无法读取 Codex 剩余额度，正在重试') {
  return {
    ...value,
    message,
    stale: true,
    rings: (value?.rings ?? []).map(ring => ({ ...ring, percent: null, tone: 'muted', resetsAt: null }))
  };
}

module.exports = { formatResetTime, formatUsage, mergeResponse, pickCodexSnapshot, remainingPercent, tone, unavailable };
