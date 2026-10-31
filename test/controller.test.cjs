'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { StartupController } = require('../src/startup/controller.cjs');

const NOW = 1_000_000;
const app = (overrides = {}) => ({
  key: 'new', pid: 42, launchedAt: NOW - 2000, finishedLaunching: true, argumentsKnown: true, debugPort: null, ...overrides
});
const snapshot = (apps, overrides = {}) => ({ apps, frontmostPid: 42, inputIdleMs: 5000, inputStamp: 7, ...overrides });

// `script` feeds successive snapshots; the last one repeats.
function harness(script, options = {}, adapterOverrides = {}) {
  const calls = [];
  const events = [];
  const queue = [...script];
  const clock = { now: NOW };
  const adapter = {
    snapshot: async () => (queue.length > 1 ? queue.shift() : queue[0]),
    portInUse: async () => false,
    quit: async () => { calls.push('quit'); return { accepted: true }; },
    launch: async () => { calls.push('launch'); return { launched: true, key: 'debug', pid: 43 }; },
    show: async () => { calls.push('show'); return { shown: true }; },
    record: async event => { events.push(event); },
    ...adapterOverrides
  };
  const controller = new StartupController(adapter, {
    now: () => clock.now,
    sleep: async ms => { clock.now += ms; },
    ...options
  });
  return { adapter, calls, clock, controller, events };
}

async function baselined(script, options, adapterOverrides) {
  const context = harness([snapshot([]), ...script], options, adapterOverrides);
  await context.controller.tick();
  await context.controller.tick();
  return context;
}

const eligible = [snapshot([app()]), snapshot([]), snapshot([]), snapshot([app({ key: 'debug', pid: 43, debugPort: 39222 })], { frontmostPid: 1 })];

test('an eligible launch is swapped once and shown', async () => {
  const { calls, events } = await baselined([
    snapshot([app()]),
    snapshot([], { frontmostPid: 1 }),
    snapshot([], { frontmostPid: 1 }),
    snapshot([app({ key: 'debug', pid: 43, debugPort: 39222 })], { frontmostPid: 1 })
  ]);
  assert.deepEqual(calls, ['quit', 'launch', 'show']);
  assert.deepEqual(events, ['watching', 'attempt', 'reopened']);
});

test('apps already running at startup are never touched', async () => {
  const context = harness([snapshot([app()])]);
  await context.controller.tick();
  await context.controller.tick();
  assert.deepEqual(context.calls, []);
  assert.deepEqual(context.events, ['watching']);
});

test('observe mode never quits anything', async () => {
  const { calls, events } = await baselined(eligible, { allowClientRestart: false });
  assert.deepEqual(calls, []);
  assert.ok(events.every(event => event === 'observing'));
});

test('a process that already has a debug port is left alone', async () => {
  const { calls } = await baselined([snapshot([app({ debugPort: 39222 })])]);
  assert.deepEqual(calls, []);
});

test('unknown process arguments are left alone', async () => {
  const { calls } = await baselined([snapshot([app({ argumentsKnown: false })])]);
  assert.deepEqual(calls, []);
});

test('multiple instances are left alone', async () => {
  const { calls } = await baselined([snapshot([app(), app({ key: 'other', pid: 50 })])]);
  assert.deepEqual(calls, []);
});

test('a launch older than eight seconds is skipped', async () => {
  const { calls, events } = await baselined([snapshot([app({ launchedAt: NOW - 8001 })])]);
  assert.deepEqual(calls, []);
  assert.equal(events.at(-1), 'skipped-active-or-background');
});

test('user input since launch skips the handoff', async () => {
  const { calls, events } = await baselined([snapshot([app()], { inputIdleMs: 500 })]);
  assert.deepEqual(calls, []);
  assert.equal(events.at(-1), 'skipped-active-or-background');
});

test('a launch still in progress is retried, not rejected', async () => {
  const { calls, controller } = await baselined([snapshot([app({ finishedLaunching: false })])]);
  assert.deepEqual(calls, []);
  assert.equal(controller.pendingLaunch, true);
  assert.equal(controller.seen.has('new'), false);
});

test('a background launch waits for the app to come forward', async () => {
  const { calls, controller } = await baselined([snapshot([app()], { frontmostPid: 1 })]);
  assert.deepEqual(calls, []);
  assert.equal(controller.pendingLaunch, true);
});

test('a rejected process is not revisited', async () => {
  const { calls, controller } = await baselined([snapshot([app()], { inputIdleMs: 500 })]);
  await controller.tick();
  assert.deepEqual(calls, []);
});

test('the cooldown blocks a second attempt', async () => {
  const { calls, events } = await baselined([snapshot([app()])], { lastAttemptAt: NOW - 1000 });
  assert.deepEqual(calls, []);
  assert.equal(events.at(-1), 'skipped-cooldown');
});

test('a busy port blocks the handoff', async () => {
  const { calls, events } = await baselined([snapshot([app()])], {}, { portInUse: async () => true });
  assert.deepEqual(calls, []);
  assert.equal(events.at(-1), 'port-in-use');
});

test('the receipt is written before the quit request', async () => {
  const order = [];
  await baselined(eligible, {}, {
    record: async event => { order.push(event); },
    quit: async () => { order.push('quit'); return { accepted: false }; }
  });
  assert.ok(order.indexOf('attempt') < order.indexOf('quit'));
});

test('a failed receipt means no quit', async () => {
  const { calls, events } = await baselined([snapshot([app()])], {}, {
    record: async event => {
      if (event === 'attempt') throw new Error('disk full');
    }
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(events, []);
});

test('a refused quit stops there', async () => {
  const { calls, events } = await baselined([snapshot([app()])], {}, {
    quit: async () => ({ accepted: false })
  });
  assert.deepEqual(calls, []);
  assert.equal(events.at(-1), 'quit-refused');
});

test('a quit that never completes gives up without launching', async () => {
  const { calls, events } = await baselined([snapshot([app()])]);
  assert.deepEqual(calls, ['quit']);
  assert.equal(events.at(-1), 'quit-timeout');
});

test('another instance appearing during the wait cancels the handoff', async () => {
  const { calls, events } = await baselined([snapshot([app()]), snapshot([app(), app({ key: 'other', pid: 50 })])]);
  assert.deepEqual(calls, ['quit']);
  assert.equal(events.at(-1), 'another-instance-started');
});

test('an app reopened by the user before our launch cancels it', async () => {
  const { calls, events } = await baselined([snapshot([app()]), snapshot([]), snapshot([app({ key: 'mine', pid: 60 })])]);
  assert.deepEqual(calls, ['quit']);
  assert.equal(events.at(-1), 'reopen-canceled');
});

test('input during the handoff still reopens but does not steal focus', async () => {
  const { calls, events } = await baselined([
    snapshot([app()]),
    snapshot([], { inputStamp: 8 }),
    snapshot([], { inputStamp: 8 }),
    snapshot([app({ key: 'debug', pid: 43, debugPort: 39222 })], { inputStamp: 8 })
  ]);
  assert.deepEqual(calls, ['quit', 'launch']);
  assert.equal(events.at(-1), 'reopened');
});

test('the reopened process is not handed off again', async () => {
  const context = await baselined([
    snapshot([app()]),
    snapshot([], { frontmostPid: 1 }),
    snapshot([], { frontmostPid: 1 }),
    snapshot([app({ key: 'debug', pid: 43 })], { frontmostPid: 1 })
  ]);
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit', 'launch', 'show']);
});

test('errors are recorded and do not stop later ticks', async () => {
  let broken = true;
  const events = [];
  const controller = new StartupController({
    snapshot: async () => {
      if (broken) throw new Error('bridge failed');
      return snapshot([]);
    },
    record: async event => { events.push(event); }
  });
  await controller.tick();
  broken = false;
  await controller.tick();
  assert.deepEqual(events, ['error', 'watching']);
});
