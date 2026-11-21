/**
 * The Lua scripts of the rate limiter and the denial budget against a real Valkey 8 (Testcontainers; lane B): the
 * fake client of the unit suites interprets the same scripts in JavaScript, this suite proves the real semantics
 * (atomic INCR + PEXPIRE, PTTL of the budget key, GETDEL of the carry, the concurrency slots, two clients sharing one
 * counter, the hit-and-peek script of the failed-authentication budget). US-040 AT-US-040-05; T-39, D-SECT39-01 item 3;
 * PR041-SEC-02 (b); TASK-041.
 */
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { Redis } from 'ioredis';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

import { createValkeyClient } from '../valkey/client.js';
import { createDenialBudget, denialKeys, RESTORE_SCRIPT, type DenialSubject } from './denial-budget.js';
import { createRateLimiter } from './limiter.js';
import { AUTHN_FAILED_RULE } from './policy.js';
import { createValkeyStore } from './store.js';

jest.setTimeout(120_000);

/** Valkey 8.1 (Alpine), pinned by digest; the image of the api readiness suite. */
const VALKEY_IMAGE = 'valkey/valkey:8.1-alpine@sha256:2602ace2be6569bc2bbb06f873776516ab9089821525be34f4305c67eb9db02a';

const ORG = '0193a5b2-7c1e-7d4a-9f3b-0000000000b2';
const ACTOR = '0193a5b2-7c1e-7d4a-9f3b-0000000000a2';
const user: DenialSubject = { orgId: ORG, actorId: ACTOR, credential: 'session', authenticated: true };

/** This suite proves the Lua semantics, not the 250 ms production bound: a slow reply under lane-B load must not look like a Lua defect (R1-n5). */
const LOAD_TIMEOUT_MS = 5_000;

let container: StartedTestContainer;
const clients: Redis[] = [];

function client(name: string): Redis {
  const created = createValkeyClient({
    url: `redis://${container.getHost()}:${String(container.getMappedPort(6379))}`,
    connectionName: name,
  });
  clients.push(created);
  return created;
}

beforeAll(async () => {
  container = await new GenericContainer(VALKEY_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
});

afterAll(async () => {
  for (const created of clients) created.disconnect();
  await container.stop();
});

describe('[US-040] the counter store over a real Valkey', () => {
  it('[AT-US-040-05] two clients share one counter; the window is anchored by the key TTL', async () => {
    const [one, two] = [client('rl-one'), client('rl-two')];
    const limiters = [one, two].map((valkey) =>
      createRateLimiter({ store: createValkeyStore(valkey, { timeoutMs: LOAD_TIMEOUT_MS }), onStoreUnavailable: () => undefined }),
    );
    const rule = { name: 'it:public', key: '203.0.113.7', limit: 120, windowMs: 60_000 };
    let refusedAt: number | undefined;
    for (let call = 1; call <= 130 && refusedAt === undefined; call += 1) {
      const decision = await (limiters[call % 2] as (typeof limiters)[number]).consume([rule], {
        onStoreFailure: 'fail-open',
        scope: 'it',
      });
      if (!decision.allowed) refusedAt = call;
    }
    expect(refusedAt).toBe(121);
    const ttl = await one.pttl('rl:it:public:203.0.113.7');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });

  it('concurrent hits are counted exactly (no lost update) and concurrency slots are capped', async () => {
    const store = createValkeyStore(client('rl-atomic'), { timeoutMs: LOAD_TIMEOUT_MS });
    const hits = await Promise.all(Array.from({ length: 50 }, () => store.hit('rl:it:atomic', 60_000)));
    expect(hits.map((hit) => hit.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    const slots = await Promise.all(
      Array.from({ length: 6 }, (_, index) => store.acquire('rl:it:sse', `stream-${String(index)}`, 2, 30_000)),
    );
    expect(slots.filter(Boolean)).toHaveLength(2);
    await store.release('rl:it:sse', 'stream-0');
    expect(await store.acquire('rl:it:sse', 'stream-9', 2, 30_000)).toBe(true);
  });
});

describe('[T-39] [D-SECT39-01 item 3] the denial budget over a real Valkey', () => {
  it('after the first take the budget key has a TTL of 1..60000 ms, and no key under the two prefixes lacks one', async () => {
    const valkey = client('rl-budget-ttl');
    const budget = createDenialBudget({ threshold: 3, valkey, timeoutMs: LOAD_TIMEOUT_MS });
    await budget.take(user);
    const keys = denialKeys(user);
    const ttl = await valkey.pttl(keys.budget);
    expect(ttl).toBeGreaterThanOrEqual(1);
    expect(ttl).toBeLessThanOrEqual(60_000);
    for (let denial = 0; denial < 4; denial += 1) await budget.take(user);
    for (const key of await valkey.keys('rl:authz-denial*')) {
      expect(key).toMatch(new RegExp(`^rl:authz-denial(-carry)?:(system|[0-9a-f-]{36}):([0-9a-f-]{36}|signature)$`));
      expect(await valkey.pttl(key)).toBeGreaterThan(0);
    }
    expect(await valkey.pttl(keys.carry)).toBeGreaterThan(80_000_000);
  });

  it('the verdicts, the carry and its restore follow the ruling, for two replicas on one budget', async () => {
    const [one, two] = [client('rl-budget-a'), client('rl-budget-b')];
    const subject: DenialSubject = { orgId: '', actorId: '', credential: 'signature', authenticated: false };
    const budgets = [one, two].map((valkey) => createDenialBudget({ threshold: 3, valkey, timeoutMs: LOAD_TIMEOUT_MS }));
    const kinds: string[] = [];
    for (let denial = 0; denial < 6; denial += 1) kinds.push((await (budgets[denial % 2] as (typeof budgets)[number]).take(subject)).kind);
    expect(kinds).toEqual(['individual', 'individual', 'individual', 'aggregated', 'suppressed', 'suppressed']);
    const keys = denialKeys(subject);
    expect(keys.budget).toBe('rl:authz-denial:system:signature');
    expect(await one.get(keys.carry)).toBe('2');
    // The window ends: expire the budget key as the passage of time would, then the opener claims the carry atomically.
    await one.pexpire(keys.budget, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const opener = await (budgets[0] as (typeof budgets)[number]).take(subject);
    expect(opener).toMatchObject({ kind: 'individual', mark: { kind: 'individual', suppressed: 2 } });
    expect(await one.get(keys.carry)).toBeNull();
    if (opener.kind === 'individual') await opener.restoreCarry?.();
    expect(await one.get(keys.carry)).toBe('2');
    expect(await one.eval(RESTORE_SCRIPT, 1, keys.carry, '1', '86400')).toBe(1);
    expect(await one.get(keys.carry)).toBe('3');
  });

  it('concurrent denials of one actor are counted exactly: threshold individual, one aggregated, the rest suppressed', async () => {
    const budgets = [client('rl-budget-c'), client('rl-budget-d')].map((valkey) =>
      createDenialBudget({ threshold: 5, valkey, timeoutMs: LOAD_TIMEOUT_MS }),
    );
    const subject: DenialSubject = { ...user, actorId: '0193a5b2-7c1e-7d4a-9f3b-0000000000a9' };
    const verdicts = await Promise.all(
      Array.from({ length: 30 }, (_, index) => (budgets[index % 2] as (typeof budgets)[number]).take(subject)),
    );
    const counts = Object.fromEntries(
      ['individual', 'aggregated', 'suppressed'].map((kind) => [kind, verdicts.filter((v) => v.kind === kind).length]),
    );
    expect(counts).toEqual({ individual: 5, aggregated: 1, suppressed: 24 });
  });
});

describe('[PR041-SEC-02] [B1] the failed-authentication budget over a real Valkey (TASK-041 part 041-B)', () => {
  it('HIT_AND_PEEK_SCRIPT counts the first key and reads the second without counting it; a missing second key reads 0, 0', async () => {
    const valkey = client('rl-peek');
    const store = createValkeyStore(valkey, { timeoutMs: LOAD_TIMEOUT_MS });
    expect(await store.hitAndPeek('rl:it:step', 60_000, 'rl:it:failed', 60_000)).toMatchObject({
      hit: { count: 1 },
      peek: { count: 0, resetMs: 0 },
    });
    expect(await valkey.exists('rl:it:failed')).toBe(0);
    await store.hit('rl:it:failed', 60_000);
    await store.hit('rl:it:failed', 60_000);
    const { hit, peek } = await store.hitAndPeek('rl:it:step', 60_000, 'rl:it:failed', 60_000);
    expect(hit.count).toBe(2);
    expect(peek.count).toBe(2);
    expect(peek.resetMs).toBeGreaterThanOrEqual(1);
    expect(peek.resetMs).toBeLessThanOrEqual(60_000);
    expect(await valkey.get('rl:it:failed')).toBe('2');
    expect(await store.peek('rl:it:failed', 60_000)).toMatchObject({ count: 2 });
    expect(await store.peek('rl:it:none', 60_000)).toEqual({ count: 0, resetMs: 0 });
  });

  it('a peeked key without a TTL (never expected) gets one, so no counter stays for good', async () => {
    const valkey = client('rl-peek-ttl');
    const store = createValkeyStore(valkey, { timeoutMs: LOAD_TIMEOUT_MS });
    await valkey.set('rl:it:no-ttl', '5');
    expect((await store.hitAndPeek('rl:it:step-2', 60_000, 'rl:it:no-ttl', 60_000)).peek.count).toBe(5);
    const ttl = await valkey.pttl('rl:it:no-ttl');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
    await valkey.set('rl:it:no-ttl-2', '1');
    await store.peek('rl:it:no-ttl-2', 60_000);
    expect(await valkey.pttl('rl:it:no-ttl-2')).toBeGreaterThan(0);
  });

  it('spends from two replicas reach the limit once; the gate then refuses with the rest of the window; key and TTL follow the ruling', async () => {
    const limiters = [client('rl-authn-a'), client('rl-authn-b')].map((valkey) =>
      createRateLimiter({ store: createValkeyStore(valkey, { timeoutMs: LOAD_TIMEOUT_MS }), onStoreUnavailable: () => undefined }),
    );
    const gate = { name: AUTHN_FAILED_RULE, key: '203.0.113.99', limit: 4, windowMs: 60_000 };
    const step = { name: 'step0:credentialed', key: '203.0.113.99', limit: 6_000, windowMs: 60_000 };
    const spends = await Promise.all(
      Array.from({ length: 6 }, (_, index) => (limiters[index % 2] as (typeof limiters)[number]).spend(gate, 'it')),
    );
    expect(spends.filter((spend) => spend.reached)).toHaveLength(1);
    const refused = await (limiters[0] as (typeof limiters)[number]).consumeGated(step, gate, { onStoreFailure: 'fail-open', scope: 'it' });
    expect(refused).toMatchObject({ allowed: false, reading: { rule: AUTHN_FAILED_RULE, limit: 4, remaining: 0 } });
    if (!refused.allowed) expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60);
    const probe = client('rl-authn-probe');
    expect(await probe.get('rl:step0:authn-failed:203.0.113.99')).toBe('6');
    const ttl = await probe.pttl('rl:step0:authn-failed:203.0.113.99');
    expect(ttl).toBeGreaterThanOrEqual(1);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });
});
