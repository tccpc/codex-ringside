'use strict';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const MAX_LAUNCH_AGE_MS = 8000;
const QUIT_TIMEOUT_MS = 10000;

// Decides whether a freshly opened Codex may be swapped for one with the debugging port.
// All side effects go through `adapter`, so every guard below is testable without a real app.
class StartupController {
  constructor(adapter, { now = Date.now, sleep = delay, lastAttemptAt = 0, cooldownMs = 120000, allowClientRestart = true } = {}) {
    Object.assign(this, { adapter, now, sleep, lastAttemptAt, cooldownMs });
    this.allowClientRestart = allowClientRestart === true;
    this.seen = new Set();
    this.baselined = false;
    this.busy = false;
    this.stopped = false;
    this.pendingLaunch = false;
  }

  stop() {
    this.stopped = true;
  }

  remember(apps) {
    for (const app of apps) this.seen.add(app.key);
  }

  async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    this.pendingLaunch = false;
    try {
      await this.evaluate();
    } catch (error) {
      await this.adapter.record('error', { message: error.message }).catch(() => {});
    } finally {
      this.busy = false;
    }
  }

  async evaluate() {
    const snapshot = await this.adapter.snapshot();
    if (!this.allowClientRestart) {
      this.seen = new Set(snapshot.apps.map(app => app.key));
      this.baselined = true;
      await this.adapter.record('observing', { existingApps: snapshot.apps.length });
      return;
    }
    // Anything already running when we start is somebody's work session: never touch it.
    if (!this.baselined) {
      this.remember(snapshot.apps);
      this.baselined = true;
      await this.adapter.record('watching', { existingApps: snapshot.apps.length });
      return;
    }

    const fresh = snapshot.apps.filter(app => !this.seen.has(app.key));
    if (this.seen.size > 256) this.seen = new Set(snapshot.apps.map(app => app.key));
    if (fresh.length !== 1 || snapshot.apps.length !== 1) {
      this.remember(snapshot.apps);
      return;
    }

    const app = fresh[0];
    const age = this.now() - app.launchedAt;
    if (!app.argumentsKnown || app.debugPort !== null) {
      this.seen.add(app.key);
      return;
    }
    const untouched = age >= 0 && age <= MAX_LAUNCH_AGE_MS && snapshot.inputIdleMs >= age;
    // Never interrupt a partially initialized app; look again shortly.
    if (untouched && (!app.finishedLaunching || snapshot.frontmostPid !== app.pid)) {
      this.pendingLaunch = true;
      return;
    }

    // Remember rejected candidates too, so a running window is never revisited later.
    this.seen.add(app.key);
    if (!untouched || snapshot.frontmostPid !== app.pid) {
      await this.adapter.record('skipped-active-or-background');
      return;
    }
    if (this.lastAttemptAt && this.now() - this.lastAttemptAt < this.cooldownMs) {
      await this.adapter.record('skipped-cooldown');
      return;
    }
    if (await this.adapter.portInUse()) {
      await this.adapter.record('port-in-use');
      return;
    }
    await this.handoff(app, snapshot);
  }

  async handoff(app, snapshot) {
    if (this.stopped) return;
    // The receipt must be durable before quitting, so a crash here cannot become a restart loop.
    this.lastAttemptAt = this.now();
    await this.adapter.record('attempt', { lastAttemptAt: this.lastAttemptAt, processKey: app.key });
    if (this.stopped) return;

    const quit = await this.adapter.quit(app, snapshot.inputStamp);
    if (!quit.accepted) {
      await this.adapter.record('quit-refused');
      return;
    }

    const absent = await this.waitForExit(app);
    if (!absent) return;

    await this.sleep(250);
    const beforeLaunch = await this.adapter.snapshot();
    if (this.stopped || beforeLaunch.apps.length) {
      this.remember(beforeLaunch.apps);
      await this.adapter.record('reopen-canceled');
      return;
    }

    // Past a successful quit, input only suppresses focus; the app itself is always reopened.
    const opened = await this.adapter.launch();
    if (!opened.launched) {
      await this.adapter.record('launch-failed');
      return;
    }
    if (opened.key) this.seen.add(opened.key);
    if (this.stopped) return;

    const beforeShow = await this.adapter.snapshot();
    this.remember(beforeShow.apps);
    const undisturbed = absent.inputStamp === snapshot.inputStamp
      && beforeLaunch.inputStamp === snapshot.inputStamp
      && beforeShow.inputStamp === snapshot.inputStamp
      && beforeShow.frontmostPid === beforeLaunch.frontmostPid
      && !beforeShow.apps.some(current => current.key !== opened.key);
    const shown = undisturbed && !this.stopped
      ? await this.adapter.show(opened, snapshot.inputStamp, beforeLaunch.frontmostPid)
      : { shown: false };
    await this.adapter.record('reopened', { shown: !!shown.shown, processKey: opened.key });
  }

  async waitForExit(app) {
    const deadline = this.now() + QUIT_TIMEOUT_MS;
    while (!this.stopped && this.now() < deadline) {
      await this.sleep(200);
      const current = await this.adapter.snapshot();
      if (current.apps.some(other => other.key !== app.key)) {
        this.remember(current.apps);
        await this.adapter.record('another-instance-started');
        return null;
      }
      if (current.apps.length === 0) return current;
    }
    if (!this.stopped) await this.adapter.record('quit-timeout');
    return null;
  }
}

module.exports = { StartupController };
