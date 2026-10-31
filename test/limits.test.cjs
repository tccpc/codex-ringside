'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { formatUsage, mergeResponse, pickCodexSnapshot, tone, unavailable } = require('../src/limits.cjs');

const five = { usedPercent: 20, windowDurationMins: 300, resetsAt: 1793500000 };
const week = { usedPercent: 45, windowDurationMins: 10080, resetsAt: 1793900000 };

test('pro account with only a weekly window shows one ring', () => {
  const usage = formatUsage({ rateLimits: { limitId: 'codex', planType: 'pro', primary: week, secondary: null } });
  assert.equal(usage.rings.length, 1);
  assert.equal(usage.rings[0].label, '周');
  assert.equal(usage.rings[0].percent, 55);
  assert.equal(usage.message, null);
});

test('two valid windows show two rings on any plan, shortest first', () => {
  for (const planType of ['plus', 'pro', 'team']) {
    const usage = formatUsage({ rateLimits: { limitId: 'codex', planType, primary: week, secondary: five } });
    assert.deepEqual(usage.rings.map(ring => ring.label), ['5小时', '周']);
    assert.deepEqual(usage.rings.map(ring => ring.percent), [80, 55]);
  }
});

test('window durations match within one minute, like the native UI', () => {
  const usage = formatUsage({ rateLimits: { primary: { ...five, windowDurationMins: 299 }, secondary: { ...week, windowDurationMins: 10081 } } });
  assert.deepEqual(usage.rings.map(ring => ring.label), ['5小时', '周']);
});

test('the keyed codex bucket wins over the top-level snapshot', () => {
  const response = {
    rateLimits: { limitId: 'other', primary: five },
    rateLimitsByLimitId: { codex: { limitId: 'codex', primary: week }, other: { limitId: 'other', primary: five } }
  };
  assert.equal(pickCodexSnapshot(response).primary, week);
  assert.equal(pickCodexSnapshot({ rateLimits: { limitId: 'other', primary: five } }), null);
});

test('missing or malformed data produces a message and no rings', () => {
  for (const response of [null, {}, { rateLimits: null }, { rateLimits: { primary: { usedPercent: 'x' } } }]) {
    const usage = formatUsage(response);
    assert.deepEqual(usage.rings, []);
    assert.ok(usage.message);
  }
});

test('percent is clamped and tones follow the thresholds', () => {
  const usage = formatUsage({ rateLimits: { primary: { usedPercent: 130, windowDurationMins: 300 } } });
  assert.equal(usage.rings[0].percent, 0);
  assert.deepEqual([tone(null), tone(9), tone(10), tone(50), tone(51)], ['muted', 'danger', 'warning', 'warning', 'normal']);
});

test('reset credits become a tooltip note only when available', () => {
  assert.equal(formatUsage({ rateLimitResetCredits: { availableCount: 2 } }).note, '重置卡：2 张可用');
  assert.equal(formatUsage({ rateLimitResetCredits: { availableCount: 0 } }).note, null);
  assert.equal(formatUsage({}).note, null);
});

test('deltas merge into the current window', () => {
  const current = { accountId: 'a', rateLimits: { limitId: 'codex', primary: five, secondary: week } };
  const merged = mergeResponse(current, { rateLimits: { limitId: 'codex', primary: { usedPercent: 60 } } });
  assert.equal(merged.rateLimits.primary.usedPercent, 60);
  assert.equal(merged.rateLimits.primary.windowDurationMins, 300);
  assert.equal(merged.rateLimits.secondary, week);
});

test('a new window duration replaces the old window', () => {
  const current = { rateLimits: { primary: five } };
  const merged = mergeResponse(current, { rateLimits: { primary: { usedPercent: 1, windowDurationMins: 10080 } } });
  assert.equal(merged.rateLimits.primary.resetsAt, undefined);
});

test('nothing carries across an account change', () => {
  const current = { accountId: 'a', rateLimits: { limitId: 'codex', primary: five, secondary: week } };
  const merged = mergeResponse(current, { accountId: 'b', rateLimits: { limitId: 'codex', primary: { usedPercent: 5, windowDurationMins: 300 } } });
  assert.equal(merged.rateLimits.secondary, null);
  assert.equal(merged.rateLimits.primary.resetsAt, undefined);
});

test('a plan change drops the old windows', () => {
  const current = { rateLimits: { planType: 'plus', primary: five, secondary: week } };
  const merged = mergeResponse(current, { rateLimits: { planType: 'pro', primary: { usedPercent: 5, windowDurationMins: 300 } } });
  assert.equal(merged.rateLimits.secondary, null);
});

test('updates to the keyed codex bucket keep rateLimits in sync', () => {
  const current = { rateLimits: { primary: five }, rateLimitsByLimitId: { codex: { primary: five } } };
  const merged = mergeResponse(current, { rateLimitsByLimitId: { codex: { primary: { usedPercent: 70 } } } });
  assert.equal(merged.rateLimits.primary.usedPercent, 70);
  assert.equal(pickCodexSnapshot(merged).primary.usedPercent, 70);
});

test('a limit id of __proto__ cannot pollute objects', () => {
  const patch = JSON.parse('{"rateLimitsByLimitId":{"__proto__":{"primary":{"usedPercent":1}}}}');
  mergeResponse({ rateLimitsByLimitId: {} }, patch);
  assert.equal({}.primary, undefined);
});

test('unavailable keeps the ring layout but clears the numbers', () => {
  const value = unavailable({ rings: [{ label: '周', percent: 55, tone: 'normal', resetsAt: 'x' }] });
  assert.equal(value.stale, true);
  assert.deepEqual(value.rings, [{ label: '周', percent: null, tone: 'muted', resetsAt: null }]);
  assert.deepEqual(unavailable(null).rings, []);
});
