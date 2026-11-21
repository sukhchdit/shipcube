/**
 * The store breaker (R1-m4, S4; ADR-0016 amendment 12 item 7; D-ARCH-177; rulings B3; TASK-041 part 041-B): open on a
 * store failure, fail fast for the cool-down, one probe, shared by the limiter and the denial budget.
 */
import { performance } from 'node:perf_hooks';

import { describe, expect, it } from '@jest/globals';

import { BREAKER_COOLDOWN_MS, createStoreBreaker } from './breaker.js';
import { createDenialBudget } from './denial-budget.js';
import { createRateLimiter } from './limiter.js';
import { createValkeyStore, RateLimitStoreError, STORE_TIMEOUT_MS } from './store.js';
import { FakeValkey } from './tests/fake-valkey.js';

const rule = { name: 'public:ip', key: '203.0.113.7', limit: 120, windowMs: 60_000 };
const OPEN = { onStoreFailure: 'fail-open', scope: 'rate-limit' } as const;

/** A controllable call: each `call()` returns a promise the test settles. */
function deferredCalls() {
  const pending: { resolve: (value: number) => void; reject: (error: unknown) => void }[] = [];
  return {
    pending,
    call: () =>
      new Promise<number>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  };
}

describe('[B3] [ADR-0016 am. 12 item 7] the store breaker', () => {
  it('stays closed on success and opens on a RateLimitStoreError; while open no call reaches the store', async () => {
    const clock = { now: 0 };
    const breaker = createStoreBreaker({ now: () => clock.now });
    let calls = 0;
    expect(await breaker.run(() => Promise.resolve(++calls))).toBe(1);
    expect(breaker.state()).toBe('closed');
    await expect(breaker.run(() => Promise.reject(new RateLimitStoreError('timeout')))).rejects.toMatchObject({ reason: 'timeout' });
    expect(breaker.state()).toBe('open');
    clock.now += BREAKER_COOLDOWN_MS - 1;
    await expect(breaker.run(() => Promise.resolve(++calls))).rejects.toMatchObject({ name: 'RateLimitStoreError', reason: 'unavailable' });
    expect(calls).toBe(1);
  });

  it('an error that is not a store failure does not open it', async () => {
    const breaker = createStoreBreaker({ now: () => 0 });
    await expect(breaker.run(() => Promise.reject(new TypeError('bug')))).rejects.toBeInstanceOf(TypeError);
    expect(breaker.state()).toBe('closed');
  });

  it('after the cool-down exactly one probe goes through; the others fail fast while it is in flight; success closes', async () => {
    const clock = { now: 0 };
    const breaker = createStoreBreaker({ now: () => clock.now });
    await expect(breaker.run(() => Promise.reject(new RateLimitStoreError('unavailable')))).rejects.toBeInstanceOf(RateLimitStoreError);
    clock.now += BREAKER_COOLDOWN_MS;
    const store = deferredCalls();
    const probe = breaker.run(store.call);
    expect(breaker.state()).toBe('probing');
    await expect(breaker.run(store.call)).rejects.toMatchObject({ reason: 'unavailable' });
    await expect(breaker.run(store.call)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(store.pending).toHaveLength(1);
    store.pending[0]?.resolve(7);
    expect(await probe).toBe(7);
    expect(breaker.state()).toBe('closed');
    expect(await breaker.run(() => Promise.resolve(8))).toBe(8);
  });

  it('a failed probe opens it for another cool-down', async () => {
    const clock = { now: 0 };
    const breaker = createStoreBreaker({ now: () => clock.now });
    await expect(breaker.run(() => Promise.reject(new RateLimitStoreError('timeout')))).rejects.toBeInstanceOf(RateLimitStoreError);
    clock.now += BREAKER_COOLDOWN_MS;
    await expect(breaker.run(() => Promise.reject(new Error('probe failed')))).rejects.toThrow('probe failed');
    expect(breaker.state()).toBe('open');
    clock.now += BREAKER_COOLDOWN_MS - 1;
    await expect(breaker.run(() => Promise.resolve(1))).rejects.toMatchObject({ reason: 'unavailable' });
    clock.now += 1;
    expect(await breaker.run(() => Promise.resolve(2))).toBe(2);
  });

  it('a late success of a call that started before the breaker opened does not close it', async () => {
    const breaker = createStoreBreaker({ now: () => 0 });
    const store = deferredCalls();
    const slow = breaker.run(store.call);
    await expect(breaker.run(() => Promise.reject(new RateLimitStoreError('timeout')))).rejects.toBeInstanceOf(RateLimitStoreError);
    store.pending[0]?.resolve(1);
    expect(await slow).toBe(1);
    expect(breaker.state()).toBe('open');
  });

  it('[B3] with a hanging store the first call waits the 250 ms bound, each of the next 20 returns in under 5 ms, and after the cool-down one probe is sent', async () => {
    const valkey = new FakeValkey();
    valkey.hang = true;
    const clock = { now: 0 };
    const breaker = createStoreBreaker({ now: () => clock.now });
    const outages: string[] = [];
    const limiter = createRateLimiter({
      store: createValkeyStore(valkey, { breaker }),
      onStoreUnavailable: (scope) => outages.push(scope),
    });
    const started = performance.now();
    expect(await limiter.consume([rule], OPEN)).toEqual({ allowed: true, reading: undefined });
    expect(performance.now() - started).toBeGreaterThanOrEqual(STORE_TIMEOUT_MS - 5);
    for (let call = 0; call < 20; call += 1) {
      const at = performance.now();
      expect(await limiter.consume([rule], OPEN)).toEqual({ allowed: true, reading: undefined });
      expect(performance.now() - at).toBeLessThan(5);
    }
    expect(valkey.calls).toBe(1);
    expect(outages).toHaveLength(21);
    clock.now += BREAKER_COOLDOWN_MS;
    valkey.hang = false;
    await Promise.all([limiter.consume([rule], OPEN), limiter.consume([rule], OPEN), limiter.consume([rule], OPEN)]);
    expect(valkey.calls).toBe(2);
    expect(breaker.state()).toBe('closed');
  });

  it('[B3] a malformed reply opens it too (the reply check runs inside the guarded call)', async () => {
    const breaker = createStoreBreaker({ now: () => 0 });
    let calls = 0;
    const store = createValkeyStore(
      {
        eval: () => {
          calls += 1;
          return Promise.resolve('OK');
        },
      },
      { breaker },
    );
    await expect(store.hit('rl:x', 60_000)).rejects.toMatchObject({ reason: 'malformed-reply' });
    await expect(store.peek('rl:x', 60_000)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(calls).toBe(1);
  });

  it('[B3] a failure of the limiter makes the denial budget skip the store: one breaker per process', async () => {
    const valkey = new FakeValkey();
    const breaker = createStoreBreaker({ now: () => valkey.time });
    const limiter = createRateLimiter({ store: createValkeyStore(valkey, { breaker }), onStoreUnavailable: () => undefined });
    const outages: string[] = [];
    const budget = createDenialBudget({
      threshold: 2,
      valkey,
      breaker,
      now: () => valkey.time,
      onStoreUnavailable: (scope) => outages.push(scope),
    });
    valkey.failure = new Error('connect ECONNREFUSED valkey.internal:6379');
    await limiter.consume([rule], OPEN);
    valkey.failure = undefined;
    const before = valkey.calls;
    const verdict = await budget.take({ orgId: 'system', actorId: 'a', credential: 'session', authenticated: true });
    expect(verdict.kind).toBe('individual');
    expect(valkey.calls).toBe(before);
    expect(outages).toEqual(['authz-denial']);
    // After the cool-down the probe reaches Valkey again.
    valkey.time += BREAKER_COOLDOWN_MS;
    await budget.take({ orgId: 'system', actorId: 'a', credential: 'session', authenticated: true });
    expect(valkey.calls).toBe(before + 1);
  });

  it('a malformed denial-budget reply is a store failure (it opens the shared breaker and falls back)', async () => {
    const breaker = createStoreBreaker({ now: () => 0 });
    const outages: string[] = [];
    const budget = createDenialBudget({
      threshold: 1,
      valkey: { eval: () => Promise.resolve(['x']) },
      breaker,
      onStoreUnavailable: (scope) => outages.push(scope),
    });
    expect((await budget.take({ orgId: '', actorId: '', credential: 'signature', authenticated: false })).kind).toBe('individual');
    expect(breaker.state()).toBe('open');
    expect(outages).toEqual(['authz-denial']);
  });
});
