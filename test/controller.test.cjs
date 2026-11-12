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
  const records = [];
  const queue = [...script];
  const clock = { now: NOW };
  const adapter = {
    snapshot: async () => (queue.length > 1 ? queue.shift() : queue[0]),
    portInUse: async () => false,
    quit: async () => { calls.push('quit'); return { accepted: true }; },
    launch: async () => { calls.push('launch'); return { launched: true, key: 'debug', pid: 43 }; },
    show: async () => { calls.push('show'); return { shown: true }; },
    record: async (event, details) => { events.push(event); records.push({ event, ...details }); },
    ...adapterOverrides
  };
  const controller = new StartupController(adapter, {
    now: () => clock.now,
    sleep: async ms => { clock.now += ms; },
    ...options
  });
  return { adapter, calls, clock, controller, events, records };
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

test('a busy port defers the handoff while the old listener exits', async () => {
  const { calls, controller, records } = await baselined([snapshot([app()])], {}, { portInUse: async () => true });
  assert.deepEqual(calls, []);
  assert.equal(controller.pendingLaunch, true);
  assert.equal(records.at(-1).reason, 'port-in-use');
});

test('temporarily unavailable arguments are retried and the replacement is handed off once', async () => {
  const context = await baselined([snapshot([app({ argumentsKnown: false })]), ...eligible]);
  assert.equal(context.controller.pendingLaunch, true);
  assert.equal(context.records.at(-1).reason, 'arguments-unavailable');
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit', 'launch']);
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit', 'launch']);
});

test('a pending process revealed to have a debug port is left alone', async () => {
  const context = await baselined([
    snapshot([app({ argumentsKnown: false })]), snapshot([app({ debugPort: 39222 })])
  ]);
  await context.controller.tick();
  assert.deepEqual(context.calls, []);
  assert.equal(context.controller.pendingLaunch, false);
  assert.equal(context.controller.waiting.size, 0);
});

test('a short overlap with the old process does not permanently reject its replacement', async () => {
  const old = app({ key: 'old', pid: 41, launchedAt: NOW - 60000, debugPort: 39222 });
  const context = harness([snapshot([old]), snapshot([old, app()]), ...eligible]);
  await context.controller.tick();
  await context.controller.tick();
  assert.deepEqual(context.calls, []);
  assert.equal(context.controller.pendingLaunch, true);
  assert.equal(context.records.at(-1).reason, 'multiple-instances');
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit', 'launch']);
});

test('a listener left by the exiting client is retried until it releases the port', async () => {
  let busy = true;
  const context = await baselined([snapshot([app()]), ...eligible], {}, { portInUse: async () => busy });
  assert.deepEqual(context.calls, []);
  busy = false;
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit', 'launch']);
});

for (const pending of [
  { app: { finishedLaunching: false }, snapshot: {} },
  { app: {}, snapshot: { frontmostPid: 1 } },
  { app: { argumentsKnown: false }, snapshot: {} }
]) {
  test(`a launch discovered promptly can finish after eight seconds: ${JSON.stringify(pending)}`, async () => {
    const context = await baselined([
      snapshot([app(pending.app)], pending.snapshot),
      snapshot([app()], { inputIdleMs: 20000 }), ...eligible.slice(1)
    ]);
    context.clock.now += 10000;
    await context.controller.tick();
    assert.deepEqual(context.calls, ['quit', 'launch']);
  });
}

test('user input while waiting permanently rejects the candidate', async () => {
  const context = await baselined([
    snapshot([app({ finishedLaunching: false })]),
    snapshot([app()], { inputIdleMs: 100 }),
    snapshot([app()], { inputIdleMs: 30000 })
  ]);
  context.clock.now += 10000;
  await context.controller.tick();
  assert.equal(context.records.at(-1).reason, 'user-input');
  await context.controller.tick();
  assert.deepEqual(context.calls, []);
  assert.equal(context.controller.pendingLaunch, false);
});

test('waiting expires thirty seconds after launch, even with no input', async () => {
  const context = await baselined([
    snapshot([app({ finishedLaunching: false })]),
    snapshot([app()], { inputIdleMs: 60000 })
  ]);
  context.clock.now += 28001;
  await context.controller.tick();
  assert.equal(context.records.at(-1).reason, 'launch-window-expired');
  assert.equal(context.controller.pendingLaunch, false);
  await context.controller.tick();
  assert.deepEqual(context.calls, []);
});

test('a persistent port conflict times out without quitting', async () => {
  const context = await baselined([snapshot([app()], { inputIdleMs: 60000 })], {}, { portInUse: async () => true });
  context.clock.now += 28001;
  await context.controller.tick();
  assert.deepEqual(context.calls, []);
  assert.equal(context.controller.pendingLaunch, false);
  assert.equal(context.records.at(-1).reason, 'launch-window-expired');
});

test('persistent multiple instances time out without quitting either app', async () => {
  const context = await baselined([snapshot([app(), app({ key: 'other', pid: 50 })], { inputIdleMs: 60000 })]);
  context.clock.now += 28001;
  await context.controller.tick();
  assert.deepEqual(context.calls, []);
  assert.equal(context.controller.pendingLaunch, false);
});

test('waiting is cleared if the launching app exits on its own', async () => {
  const context = await baselined([snapshot([app({ finishedLaunching: false })]), snapshot([])]);
  await context.controller.tick();
  assert.equal(context.controller.pendingLaunch, false);
  assert.equal(context.controller.waiting.size, 0);
  assert.deepEqual(context.calls, []);
});

test('stopping the controller cancels a pending startup', async () => {
  const context = await baselined([snapshot([app({ finishedLaunching: false })]), ...eligible]);
  context.controller.stop();
  await context.controller.tick();
  assert.deepEqual(context.calls, []);
});

test('waiting diagnostics do not repeat on every poll', async () => {
  const context = await baselined([snapshot([app({ finishedLaunching: false })])]);
  await context.controller.tick();
  await context.controller.tick();
  assert.deepEqual(context.events, ['watching', 'waiting-for-launch']);
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
