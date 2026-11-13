/**
 * Fake-clock helpers (TEST-STRATEGY §10.1 rule 7, §11 rule 6; T-QA-03).
 *
 * Two layers, so a test uses the lightest one that is enough:
 *  - {@link createManualClock}: a plain injectable clock (`now(): Date`) for services that take a clock dependency.
 *    No timers are faked; the test moves time by hand. Works in any project.
 *  - {@link useFakeClock} (the default for timers): Jest modern fake timers (`@sinonjs/fake-timers`) pinned to a fixed
 *    instant, installed before and ALWAYS removed after every test of the describe block, also when the test throws,
 *    for code that reads `Date.now()` or schedules timers (token lifetimes, retry back-off, idle timeouts).
 *    {@link withFakeClock} does the same around one callback; {@link installFakeClock} is the manual primitive.
 *
 * The default instant is a fixed constant, never the wall clock, so a rerun sees the same time (flake < 1 %).
 */
import { afterEach, beforeEach, jest } from '@jest/globals';

/** 2026-01-15T12:00:00.000Z: a fixed, mid-year-neutral instant used when a test does not care. */
export const FIXED_NOW = new Date('2026-01-15T12:00:00.000Z');

export interface ManualClock {
  /** The injectable `now` (a fresh Date each call, so callers cannot mutate the clock). */
  now(): Date;
  /** Epoch milliseconds. */
  nowMs(): number;
  /** Moves the clock forward (never backwards: use {@link ManualClock.set} for that). */
  advance(ms: number): Date;
  /** Sets the clock to an absolute instant. */
  set(to: Date | number | string): Date;
}

function toMs(value: Date | number | string): number {
  const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) throw new RangeError('clock: not a valid instant');
  return ms;
}

/** A clock the test moves by hand; starts at `start` (default {@link FIXED_NOW}). */
export function createManualClock(start: Date | number | string = FIXED_NOW): ManualClock {
  let current = toMs(start);
  return {
    now: () => new Date(current),
    nowMs: () => current,
    advance(ms) {
      if (!Number.isFinite(ms) || ms < 0) throw new RangeError('clock.advance: ms must be a finite number >= 0');
      current += ms;
      return new Date(current);
    },
    set(to) {
      current = toMs(to);
      return new Date(current);
    },
  };
}

export interface InstalledFakeClock extends ManualClock {
  /** Runs timers due within `ms` and moves `Date.now()` with them (async-safe: also flushes promise callbacks between timers). */
  advanceTimers(ms: number): Promise<void>;
  /** Restores real timers. Idempotent. */
  uninstall(): void;
}

export interface FakeClockOptions {
  readonly start?: Date | number | string;
  /** Leave `process.nextTick` / `queueMicrotask` real (default true: Testcontainers and pg need them). */
  readonly keepNextTick?: boolean;
}

/**
 * Installs Jest modern fake timers at `start`. Manual primitive: the caller must `uninstall()` even when the test fails,
 * otherwise later hooks (a Testcontainers `afterAll`) run under fake timers; prefer {@link useFakeClock} or
 * {@link withFakeClock}. `performance` is faked too, so elapsed-time measurements follow the fake clock.
 */
export function installFakeClock(options: FakeClockOptions = {}): InstalledFakeClock {
  const start = toMs(options.start ?? FIXED_NOW);
  jest.useFakeTimers({
    now: start,
    doNotFake: options.keepNextTick === false ? [] : ['nextTick', 'queueMicrotask'],
  });
  return {
    now: () => new Date(Date.now()),
    nowMs: () => Date.now(),
    advance(ms) {
      jest.setSystemTime(Date.now() + ms);
      return new Date(Date.now());
    },
    set(to) {
      jest.setSystemTime(toMs(to));
      return new Date(Date.now());
    },
    advanceTimers: (ms) => jest.advanceTimersByTimeAsync(ms),
    uninstall: () => {
      jest.useRealTimers();
    },
  };
}

/** Runs `fn` under a fake clock and always restores real timers. */
export async function withFakeClock<T>(fn: (clock: InstalledFakeClock) => Promise<T> | T, options: FakeClockOptions = {}): Promise<T> {
  const clock = installFakeClock(options);
  try {
    return await fn(clock);
  } finally {
    clock.uninstall();
  }
}

/** Hook registrars of {@link useFakeClock} (Jest's by default; injectable so the restore guarantee can be tested). */
export interface FakeClockHooks {
  readonly beforeEach: (fn: () => void) => void;
  readonly afterEach: (fn: () => void) => void;
}

/**
 * Describe-level fake clock: installs before every test of the enclosing block and restores real timers after it,
 * whether the test passed or threw (PR #34 R1-m7). Returns the accessor of the current test's clock.
 *
 *   const clock = useFakeClock();
 *   it('expires', () => { clock().advance(60_000); ... });
 */
export function useFakeClock(options: FakeClockOptions = {}, hooks: FakeClockHooks = { beforeEach, afterEach }): () => InstalledFakeClock {
  let current: InstalledFakeClock | undefined;
  hooks.beforeEach(() => {
    current = installFakeClock(options);
  });
  hooks.afterEach(() => {
    current = undefined;
    jest.useRealTimers();
  });
  return () => {
    if (current === undefined) throw new Error('useFakeClock: the clock exists only while a test of the block runs');
    return current;
  };
}
