/**
 * The in-flight half of the failed-authentication gate without HTTP (R1-M1 of the part-B review; D-TASK041-18;
 * TASK-041 part 041-B): the ledger, and the limiter's admission in the same step as the store reply. The HTTP side (a
 * parallel burst through createApp) is authn-failed.api.test.ts.
 */
import { describe, expect, it } from '@jest/globals';

import { createInFlightLedger } from './in-flight.js';
import { createRateLimiter, type RateRule } from './limiter.js';
import { AUTHN_FAILED_RULE } from './policy.js';
import { createMemoryStore, createValkeyStore } from './store.js';
import { FakeValkey } from './tests/fake-valkey.js';

const IP = '203.0.113.7';
const step: RateRule = { name: 'step0:credentialed', key: IP, limit: 6_000, windowMs: 60_000 };
const gate: RateRule = { name: AUTHN_FAILED_RULE, key: IP, limit: 3, windowMs: 60_000 };
const OPEN = { onStoreFailure: 'fail-open', scope: 'rate-limit' } as const;

describe('[R1-M1] [D-TASK041-18] the in-flight ledger', () => {
  it('admits while settled + held stays below the limit, one unit per holder, and frees the key with its last unit', () => {
    const ledger = createInFlightLedger();
    const [a, b, c] = [{}, {}, {}];
    expect(ledger.admit(IP, 1, 3, a)).toBe(true);
    expect(ledger.admit(IP, 1, 3, a)).toBe(true);
    expect(ledger.held(IP)).toBe(1);
    expect(ledger.admit(IP, 1, 3, b)).toBe(true);
    expect(ledger.held(IP)).toBe(2);
    expect(ledger.admit(IP, 1, 3, c)).toBe(false);
    expect(ledger.admit('198.51.100.9', 0, 3, c)).toBe(true);
    ledger.release(a);
    ledger.release(a);
    expect(ledger.held(IP)).toBe(1);
    expect(ledger.admit(IP, 2, 3, {})).toBe(false);
    ledger.release(b);
    ledger.release({});
    expect(ledger.held(IP)).toBe(0);
    expect(ledger.admit(IP, 2, 3, {})).toBe(true);
  });

  it('a settled count at the limit admits nothing, a held holder included', () => {
    const ledger = createInFlightLedger();
    const holder = {};
    expect(ledger.admit(IP, 0, 1, holder)).toBe(true);
    expect(ledger.admit(IP, 0, 1, holder)).toBe(false);
    expect(ledger.admit(IP, 1, 1, {})).toBe(false);
  });

  it('[R2-M1] [D-ARCH-226] once entered, the close no longer releases the unit; only the outcome does', () => {
    const ledger = createInFlightLedger();
    const holder = {};
    expect(ledger.admit(IP, 0, 2, holder)).toBe(true);
    expect(ledger.enter(holder)).toBe(true);
    ledger.releaseUnentered(holder);
    expect(ledger.held(IP)).toBe(1);
    expect(ledger.admit(IP, 1, 2, {})).toBe(false);
    ledger.release(holder);
    ledger.release(holder);
    ledger.releaseUnentered(holder);
    expect(ledger.held(IP)).toBe(0);
  });

  it('[D-TASK041-20] the close releases a unit that never entered; that holder can neither enter nor be admitted again', () => {
    const ledger = createInFlightLedger();
    const [gone, other] = [{}, {}];
    expect(ledger.admit(IP, 0, 2, gone)).toBe(true);
    expect(ledger.admit(IP, 0, 2, other)).toBe(true);
    ledger.releaseUnentered(gone);
    ledger.releaseUnentered(gone);
    expect(ledger.held(IP)).toBe(1);
    expect(ledger.enter(gone)).toBe(false);
    expect(ledger.admit(IP, 0, 2, gone)).toBe(false);
    ledger.release(gone);
    expect(ledger.held(IP)).toBe(1);
    // A holder that was never gated (step 0 did not hold for it) may enter, and holds nothing.
    expect(ledger.enter({})).toBe(true);
    ledger.release(other);
    expect(ledger.held(IP)).toBe(0);
  });
});

describe('[R1-M1] consumeGated admits in the same step as the store reply', () => {
  it('a parallel burst of 10 over the memory store admits exactly the limit; the rest are refused with the gate reading and a 1 s retry', async () => {
    const ledger = createInFlightLedger();
    const limiter = createRateLimiter({ store: createMemoryStore(() => 0), onStoreUnavailable: () => undefined });
    const decisions = await Promise.all(
      Array.from({ length: 10 }, () => {
        const holder = {};
        return limiter.consumeGated(step, gate, { ...OPEN, admit: (settled) => ledger.admit(IP, settled, gate.limit, holder) });
      }),
    );
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(3);
    expect(decisions.filter((decision) => !decision.allowed)[0]).toEqual({
      allowed: false,
      reading: { rule: AUTHN_FAILED_RULE, limit: 3, remaining: 0, resetSeconds: 1 },
      retryAfterSeconds: 1,
      first: false,
      held: true,
    });
    expect(ledger.held(IP)).toBe(3);
  });

  it('the same over the Valkey store: the settled count of the reply plus the held units decide', async () => {
    const valkey = new FakeValkey();
    const ledger = createInFlightLedger();
    const limiter = createRateLimiter({ store: createValkeyStore(valkey), onStoreUnavailable: () => undefined });
    await limiter.spend(gate, 'rate-limit');
    const burst = await Promise.all(
      Array.from({ length: 6 }, () => {
        const holder = {};
        return limiter.consumeGated(step, gate, { ...OPEN, admit: (settled) => ledger.admit(IP, settled, gate.limit, holder) });
      }),
    );
    expect(burst.map((decision) => decision.allowed)).toEqual([true, true, false, false, false, false]);
    // Every step-0 hit is still counted once, in one store call per request.
    expect(valkey.value(`rl:step0:credentialed:${IP}`)).toBe(6);
    expect(valkey.calls).toBe(7);
  });

  it('is not asked when the gate is spent or the rule refuses, and an absent admission admits', async () => {
    const asked: number[] = [];
    const limiter = createRateLimiter({ store: createMemoryStore(() => 0), onStoreUnavailable: () => undefined });
    const admit = (settled: number): boolean => {
      asked.push(settled);
      return true;
    };
    const tight = { ...step, limit: 1 };
    expect((await limiter.consumeGated(tight, gate, { ...OPEN, admit })).allowed).toBe(true);
    expect((await limiter.consumeGated(tight, gate, { ...OPEN, admit })).allowed).toBe(false);
    for (let spend = 0; spend < 3; spend += 1) await limiter.spend(gate, 'rate-limit');
    // [H5] A refusal by the spent gate is not a refusal by the hold.
    const spent = await limiter.consumeGated(step, gate, { ...OPEN, admit });
    expect(spent).toMatchObject({ allowed: false, retryAfterSeconds: 60 });
    expect(spent).not.toHaveProperty('held');
    expect(asked).toEqual([0]);
    expect((await limiter.consumeGated(step, { ...gate, key: 'other' }, OPEN)).allowed).toBe(true);
  });

  it('during an outage the admission reads the per-instance fallback, after the rule', async () => {
    const valkey = new FakeValkey();
    valkey.failure = new Error('down');
    const limiter = createRateLimiter({ store: createValkeyStore(valkey), onStoreUnavailable: () => undefined });
    await limiter.spend(gate, 'rate-limit');
    const asked: number[] = [];
    const refuse = (settled: number): boolean => {
      asked.push(settled);
      return false;
    };
    expect(await limiter.consumeGated(step, gate, { ...OPEN, admit: refuse })).toMatchObject({
      allowed: false,
      reading: { rule: AUTHN_FAILED_RULE, remaining: 0 },
      retryAfterSeconds: 1,
      held: true,
    });
    expect(await limiter.consumeGated(step, gate, { onStoreFailure: 'fallback', scope: 'rate-limit', admit: refuse })).toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(asked).toEqual([1, 1]);
  });
});
