import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { createManualClock, FIXED_NOW, installFakeClock, withFakeClock } from './fake-clock.js';

afterEach(() => {
  jest.useRealTimers();
});

describe('[NFR-QUAL-006] createManualClock', () => {
  it('starts at the fixed instant, hands out copies and only moves when told', () => {
    const clock = createManualClock();
    expect(clock.now().toISOString()).toBe('2026-01-15T12:00:00.000Z');
    clock.now().setFullYear(1999);
    expect(clock.nowMs()).toBe(FIXED_NOW.getTime());
    expect(clock.advance(1_500).getTime()).toBe(FIXED_NOW.getTime() + 1_500);
    expect(clock.set('2027-05-06T07:08:09.000Z').toISOString()).toBe('2027-05-06T07:08:09.000Z');
  });

  it('rejects negative or non-finite advances and invalid instants', () => {
    const clock = createManualClock(0);
    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(() => clock.advance(Number.NaN)).toThrow(RangeError);
    expect(() => clock.set('not a date')).toThrow(RangeError);
    expect(() => createManualClock(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('[NFR-QUAL-006] installFakeClock', () => {
  it('pins Date.now to the start instant and does not move on its own', async () => {
    const clock = installFakeClock();
    try {
      expect(Date.now()).toBe(FIXED_NOW.getTime());
      await Promise.resolve();
      expect(clock.nowMs()).toBe(FIXED_NOW.getTime());
    } finally {
      clock.uninstall();
    }
  });

  it('advance() moves Date.now without firing timers; advanceTimers() fires them in order, including after awaits', async () => {
    const clock = installFakeClock({ start: '2026-06-01T00:00:00.000Z' });
    try {
      const fired: string[] = [];
      setTimeout(() => fired.push('a'), 100);
      setTimeout(() => {
        void Promise.resolve().then(() => fired.push('c'));
      }, 300);
      setTimeout(() => fired.push('b'), 200);
      clock.advance(150);
      expect(fired).toEqual([]);
      await clock.advanceTimers(500);
      expect(fired).toEqual(['a', 'b', 'c']);
      expect(clock.now().toISOString()).toBe('2026-06-01T00:00:00.650Z');
    } finally {
      clock.uninstall();
    }
  });

  it('uninstall restores real timers and is idempotent', () => {
    const clock = installFakeClock({ start: 0 });
    expect(Date.now()).toBe(0);
    clock.uninstall();
    clock.uninstall();
    expect(Date.now()).toBeGreaterThan(FIXED_NOW.getTime());
  });

  it('withFakeClock restores real timers even when the callback throws', async () => {
    await expect(
      withFakeClock(() => {
        expect(Date.now()).toBe(FIXED_NOW.getTime());
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(Date.now()).toBeGreaterThan(FIXED_NOW.getTime());
    await expect(withFakeClock((clock) => clock.advance(1_000).getTime())).resolves.toBe(FIXED_NOW.getTime() + 1_000);
  });
});
