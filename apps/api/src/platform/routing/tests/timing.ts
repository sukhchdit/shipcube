/**
 * Test helpers for "answers within X" checks under host load (W0-FLAKE, PR #53 code review R1-m1). Shared by the api and
 * worker suites. Never imported by production code.
 *
 * What these helpers are for: telling "the deadline fired" from "the call hung" on an overloaded host. They do NOT pin the
 * magnitude of a deadline: that is pinned deterministically (a constant against its AC value, and a spy on
 * `AbortSignal.timeout` asserting the configured value). They also do not police CPU-bound work, ReDoS or scaling:
 * synchronous work in the measured operation blocks the heartbeat, so it is subtracted as if the host had stolen it
 * (the heartbeat cannot tell the two apart). Use `performance.now()` directly for those checks, never `timeOperation`.
 */

/** Per-test Jest budget of the suites that make real loopback requests: a hang detector, never a latency target. */
export const LOOPBACK_TEST_TIMEOUT_MS = 180_000;

/**
 * Upper-bound slack of the "answers within X" timing checks. A lower bound (the deadline really elapsed) stays exact; an
 * upper bound only has to tell "the deadline fired" from "the call hung or ran to a far longer limit" (tens of seconds).
 */
export const HOST_LOAD_SLACK_MS = 20_000;

/** Heartbeat period of {@link timeOperation}. */
export const HEARTBEAT_TICK_MS = 20;
/**
 * A tick later than its schedule by up to this much is timer jitter (Windows coalesces a 20 ms interval to about 31 ms),
 * not a stall: it is not subtracted. Only a lateness above it counts as time the process was not running.
 */
export const HEARTBEAT_JITTER_MS = 50;

/**
 * The part of a heartbeat tick's lateness that counts as a stall: nothing up to and including {@link HEARTBEAT_JITTER_MS}
 * (timer jitter), the whole lateness above it. Pure, so the threshold is tested deterministically (PR #53 R2-m1).
 */
export function stallBooked(lateMs: number): number {
  return lateMs > HEARTBEAT_JITTER_MS ? lateMs : 0;
}

/**
 * Measures how long `operation` took and how much of that the host stole. A heartbeat timer notes every tick that fires
 * later than scheduled by more than {@link HEARTBEAT_JITTER_MS}; the sum of that lateness is time this process did not run
 * (host load, GC, a suspended process) OR was blocked by its own synchronous work. `ms` is the raw elapsed time, so a
 * lower bound ("the deadline really elapsed") stays exact; `workMs` is `ms` minus those stalls. For an asynchronous wait
 * (timers, sockets) a hang cannot hide in `workMs`, because the heartbeat keeps arriving on time. Synchronous blocking in
 * `operation` is subtracted, so a bound on `workMs` does not police CPU-bound regressions.
 */
export async function timeOperation<T>(
  operation: () => Promise<T>,
): Promise<{ readonly value: T; readonly ms: number; readonly workMs: number }> {
  const started = performance.now();
  let last = started;
  let stalledMs = 0;
  const book = (now: number): void => {
    stalledMs += stallBooked(now - last - HEARTBEAT_TICK_MS);
    last = now;
  };
  const heartbeat = setInterval(() => book(performance.now()), HEARTBEAT_TICK_MS);
  try {
    const value = await operation();
    const now = performance.now();
    book(now);
    return { value, ms: now - started, workMs: Math.max(0, now - started - stalledMs) };
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Records every `AbortSignal.timeout(ms)` made while it is installed and calls through, so a test can pin the magnitude of
 * a deadline deterministically (the configured value reaches the timer) instead of by a wall-clock bound that a loaded host
 * forces to be loose (PR #53 code review R1-M1/R1-M2, PR30-SEC-01, AT-US-012-03). Always `restore()` in a `finally`.
 */
export function recordAbortTimeouts(): { readonly calls: readonly number[]; restore(): void } {
  const original = AbortSignal.timeout;
  const calls: number[] = [];
  AbortSignal.timeout = (ms: number): AbortSignal => {
    calls.push(ms);
    return original.call(AbortSignal, ms);
  };
  return {
    calls,
    restore: () => {
      AbortSignal.timeout = original;
    },
  };
}

// The outbox over a test catalogue (TASK-043; code review m5, PR043-SEC-03): served from this `./testing` subpath, the
// one test export prune-dist removes and the image preflight skips, so no second pruned export exists.
export { createTestOutbox } from '../../outbox/tests/test-outbox.js';
