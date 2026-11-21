/**
 * The rate-limit engine, the class table and the denial budget without HTTP (US-040; T-39, D-SECT39-01; TASK-041):
 * fixed windows, several rules per request, the Valkey store over a fake client, the outage fallbacks and the
 * budget's verdict sequence. The HTTP side is limits.api.test.ts and audit/capture.api.test.ts.
 */
import { describe, expect, it } from '@jest/globals';
import { RATE_LIMIT_DEFAULTS } from '@platform/config';

import { BoundedMap, SWEEP_PER_INSERT } from './bounded-map.js';
import { createRateLimitCounter } from './counter.js';
import { createDenialBudget, denialKeys, memoryDenialStore, RESTORE_SCRIPT, windowEndsAt, type DenialSubject } from './denial-budget.js';
import { createOutageReporter, createRateLimiter, type RateRule } from './limiter.js';
import {
  authAccountRule,
  classPolicy,
  clientIpKey,
  emailSendRules,
  HOUR_MS,
  MINUTE_MS,
  quoteCreateRules,
  streamSlotRule,
  type RateLimitSettings,
} from './policy.js';
import { createMemoryStore, createValkeyStore, RateLimitStoreError, withStoreTimeout } from './store.js';
import { FakeValkey } from './tests/fake-valkey.js';

const settings: RateLimitSettings = {
  RATE_LIMIT_PUBLIC_PER_MIN: RATE_LIMIT_DEFAULTS.public.value,
  RATE_LIMIT_AUTH_PER_IP_PER_MIN: RATE_LIMIT_DEFAULTS.authIp.value,
  RATE_LIMIT_AUTH_PER_ACCOUNT_PER_MIN: RATE_LIMIT_DEFAULTS.authAccount.value,
  RATE_LIMIT_AUTHENTICATED_PER_MIN: RATE_LIMIT_DEFAULTS.authenticated.value,
  RATE_LIMIT_WEBHOOK_PER_MIN: RATE_LIMIT_DEFAULTS.webhook.value,
  RATE_LIMIT_CSP_REPORT_PER_MIN: RATE_LIMIT_DEFAULTS.cspReport.value,
  RATE_LIMIT_PUBLIC_QUOTE_PER_MIN: RATE_LIMIT_DEFAULTS.publicQuoteMin.value,
  RATE_LIMIT_PUBLIC_QUOTE_PER_HOUR: RATE_LIMIT_DEFAULTS.publicQuoteHour.value,
  RATE_LIMIT_PUBLIC_TRACKING_PER_MIN: RATE_LIMIT_DEFAULTS.publicTrackingMin.value,
  RATE_LIMIT_PUBLIC_TRACKING_PER_HOUR: RATE_LIMIT_DEFAULTS.publicTrackingHour.value,
  RATE_LIMIT_EMAIL_SEND_PER_ADDRESS_PER_HOUR: RATE_LIMIT_DEFAULTS.emailAddress.value,
  RATE_LIMIT_EMAIL_SEND_PER_IP_PER_HOUR: RATE_LIMIT_DEFAULTS.emailIp.value,
  RATE_QUOTE_CREATE_PER_USER_PER_MIN: RATE_LIMIT_DEFAULTS.quoteUserMin.value,
  RATE_QUOTE_CREATE_PER_USER_PER_HOUR: RATE_LIMIT_DEFAULTS.quoteUserHour.value,
  RATE_QUOTE_CREATE_PER_ORG_PER_HOUR: RATE_LIMIT_DEFAULTS.quoteOrgHour.value,
  SSE_MAX_STREAMS_PER_IP: RATE_LIMIT_DEFAULTS.streamsIp.value,
  SSE_MAX_STREAMS_PER_USER: RATE_LIMIT_DEFAULTS.streamsUser.value,
};

const OPEN = { onStoreFailure: 'fail-open', scope: 'rate-limit' } as const;
const FALLBACK = { onStoreFailure: 'fallback', scope: 'rate-limit' } as const;

/** Makes `count` calls and returns the number of the first refused call (1-based), or undefined. */
async function firstRefused(
  limiter: ReturnType<typeof createRateLimiter>,
  rules: readonly RateRule[],
  count: number,
  options: typeof OPEN | typeof FALLBACK = OPEN,
): Promise<number | undefined> {
  for (let call = 1; call <= count; call += 1) {
    if (!(await limiter.consume(rules, options)).allowed) return call;
  }
  return undefined;
}

function memoryLimiter(clock = { now: 0 }) {
  const outages: string[] = [];
  const limiter = createRateLimiter({
    store: createMemoryStore(() => clock.now),
    onStoreUnavailable: (scope) => outages.push(scope),
  });
  return { limiter, outages, clock };
}

describe('[US-040] the limiter: fixed windows, headers readings and the class table', () => {
  it('[AT-US-040-01] the first request of the public class reads limit 120, remaining 119 and a reset', async () => {
    const { limiter } = memoryLimiter();
    const { rules } = classPolicy('public', { ip: '203.0.113.7' }, settings);
    const decision = await limiter.consume(rules, OPEN);
    expect(decision).toEqual({ allowed: true, reading: { rule: 'public:ip', limit: 120, remaining: 119, resetSeconds: 60 } });
  });

  it.each([
    ['[AT-US-040-02] unauthenticated / public per IP', 'public', 121],
    ['[AT-US-040-03-1] login per IP', 'auth', 11],
    ['[AT-US-040-03-3] authenticated per user', 'authenticated', 601],
    ['[AT-US-040-03-4] CSP report per IP', 'csp-report', 21],
    ['webhook per source IP', 'webhook', 601],
  ] as const)('%s: request number %i is the first refused', async (_label, klass, refusedAt) => {
    const { limiter } = memoryLimiter();
    const { rules } = classPolicy(klass, { ip: '203.0.113.7', userId: 'u-1' }, settings);
    expect(await firstRefused(limiter, rules, refusedAt + 5)).toBe(refusedAt);
  });

  it('[AT-US-040-03-2] login per account identifier: the 6th request in a minute is refused', async () => {
    const { limiter } = memoryLimiter();
    expect(await firstRefused(limiter, [authAccountRule('account-hash-1', settings)], 10)).toBe(6);
  });

  it('[AT-US-040-04] quote-create: the 31st in a minute, the 301st in an hour and the 1001st of an organisation are refused', async () => {
    const { limiter, clock } = memoryLimiter();
    expect(await firstRefused(limiter, quoteCreateRules('user-a', 'org-1', settings), 40)).toBe(31);
    // 30 per minute for 10 minutes: the minute window never fills, the 301st request of the hour does.
    const hourly = memoryLimiter();
    let refusedAt: number | undefined;
    for (let call = 1; call <= 310 && refusedAt === undefined; call += 1) {
      if (call % 30 === 1 && call > 1) hourly.clock.now += MINUTE_MS;
      if (!(await hourly.limiter.consume(quoteCreateRules('user-b', 'org-2', settings), OPEN)).allowed) refusedAt = call;
    }
    expect(refusedAt).toBe(301);
    // 1,000 an hour per organisation, each user below their own limits; another organisation is not affected.
    const orgs = memoryLimiter(clock);
    let allowed = 0;
    for (let user = 0; user < 41; user += 1) {
      for (let call = 0; call < 25; call += 1) {
        if ((await orgs.limiter.consume(quoteCreateRules(`user-${String(user)}`, 'org-shared', settings), OPEN)).allowed) allowed += 1;
      }
    }
    expect(allowed).toBe(1_000);
    expect((await orgs.limiter.consume(quoteCreateRules('user-x', 'org-other', settings), OPEN)).allowed).toBe(true);
  });

  it('[AT-US-040-11] limits apply per user: user A exhausted, user B from the same IP still succeeds', async () => {
    const { limiter } = memoryLimiter();
    const a = classPolicy('authenticated', { ip: '203.0.113.7', userId: 'user-a' }, settings).rules;
    const b = classPolicy('authenticated', { ip: '203.0.113.7', userId: 'user-b' }, settings).rules;
    expect(await firstRefused(limiter, a, 601)).toBe(601);
    expect((await limiter.consume(b, OPEN)).allowed).toBe(true);
  });

  it('[AT-US-040-12] a principal without a user actor is counted against its IP, never against a user', () => {
    expect(classPolicy('authenticated', { ip: '203.0.113.7' }, settings).rules.map((rule) => [rule.name, rule.key])).toEqual([
      ['authenticated:ip', '203.0.113.7'],
    ]);
  });

  it('[AT-US-040-07] refresh, logout and CSRF (class public): 11 requests are not rejected, the 121st is', async () => {
    const { limiter } = memoryLimiter();
    const { rules } = classPolicy('public', { ip: '203.0.113.7' }, settings);
    expect(await firstRefused(limiter, rules, 11)).toBeUndefined();
    expect(await firstRefused(limiter, rules, 120)).toBe(110);
  });

  it('[AT-US-040-13] email-send: 3 per hour per address, 10 per hour per IP; the 11th from one IP is also an auth-class refusal', async () => {
    const perAddress = memoryLimiter();
    expect(await firstRefused(perAddress.limiter, emailSendRules('addr-1', '203.0.113.7', settings), 5, FALLBACK)).toBe(4);
    const perIp = memoryLimiter();
    let refusedAt: number | undefined;
    for (let call = 1; call <= 12 && refusedAt === undefined; call += 1) {
      const decision = await perIp.limiter.consume(emailSendRules(`addr-${String(call)}`, '203.0.113.7', settings), FALLBACK);
      if (!decision.allowed) refusedAt = call;
    }
    expect(refusedAt).toBe(11);
    // The auth class of the same registration is 10 per minute per IP.
    const auth = memoryLimiter();
    expect(await firstRefused(auth.limiter, classPolicy('auth', { ip: '203.0.113.7' }, settings).rules, 12, FALLBACK)).toBe(11);
  });

  it('the headers describe the rule closest to exhaustion; a refusal names the exceeded rule and its reset', async () => {
    const { limiter, clock } = memoryLimiter();
    const rules: RateRule[] = [
      { name: 'a:min', key: 'k', limit: 10, windowMs: MINUTE_MS },
      { name: 'a:hour', key: 'k', limit: 3, windowMs: HOUR_MS },
    ];
    const first = await limiter.consume(rules, OPEN);
    expect(first.reading).toMatchObject({ rule: 'a:hour', remaining: 2, resetSeconds: 3600 });
    clock.now += 1_500;
    await limiter.consume(rules, OPEN);
    await limiter.consume(rules, OPEN);
    const refused = await limiter.consume(rules, OPEN);
    expect(refused).toMatchObject({ allowed: false, retryAfterSeconds: 3599, reading: { rule: 'a:hour', remaining: 0 } });
  });

  it('a new window opens when the old one has passed', async () => {
    const { limiter, clock } = memoryLimiter();
    const { rules } = classPolicy('csp-report', { ip: '203.0.113.7' }, settings);
    expect(await firstRefused(limiter, rules, 25)).toBe(21);
    clock.now += MINUTE_MS + 1;
    expect((await limiter.consume(rules, OPEN)).allowed).toBe(true);
  });

  it('[AT-US-040-05] two limiters over one Valkey share the counters: 60 + 60 requests, the 121st overall is refused', async () => {
    const valkey = new FakeValkey();
    const make = () => createRateLimiter({ store: createValkeyStore(valkey), onStoreUnavailable: () => undefined });
    const [one, two] = [make(), make()];
    const { rules } = classPolicy('public', { ip: '203.0.113.7' }, settings);
    for (let call = 0; call < 60; call += 1) {
      expect((await one.consume(rules, OPEN)).allowed).toBe(true);
      expect((await two.consume(rules, OPEN)).allowed).toBe(true);
    }
    expect((await one.consume(rules, OPEN)).allowed).toBe(false);
    expect(valkey.keys()).toEqual(['rl:public:ip:203.0.113.7']);
  });

  it('[AT-US-040-09] Valkey down: the auth class uses the in-memory counter (11th refused) and reports once; public fails open', async () => {
    const valkey = new FakeValkey();
    valkey.failure = new Error('connect ECONNREFUSED valkey.internal:6379');
    const outages: string[] = [];
    const report = createOutageReporter((scope) => outages.push(scope), { now: () => valkey.time });
    const limiter = createRateLimiter({ store: createValkeyStore(valkey), onStoreUnavailable: report });
    expect(await firstRefused(limiter, classPolicy('auth', { ip: '203.0.113.7' }, settings).rules, 12, FALLBACK)).toBe(11);
    expect(outages).toEqual(['rate-limit']);
    const open = await limiter.consume(classPolicy('public', { ip: '203.0.113.7' }, settings).rules, OPEN);
    expect(open).toEqual({ allowed: true, reading: undefined });
    valkey.time += 61_000;
    await limiter.consume(classPolicy('public', { ip: '203.0.113.7' }, settings).rules, OPEN);
    expect(outages).toEqual(['rate-limit', 'rate-limit']);
  });

  it('[AT-US-040-15] [AT-US-040-16] stream slots: 2 per anonymous IP, 5 per user; closing a stream frees its slot', async () => {
    for (const [subject, existing] of [
      [{ ip: '203.0.113.7' }, 2],
      [{ ip: '203.0.113.7', userId: 'user-a' }, 5],
    ] as const) {
      const { limiter } = memoryLimiter();
      const slot = { ...streamSlotRule(subject, settings), ttlMs: 60_000 };
      expect(slot.max).toBe(existing);
      for (let stream = 0; stream < existing; stream += 1) expect(await limiter.acquire(slot, `stream-${String(stream)}`)).toBe(true);
      expect(await limiter.acquire(slot, 'one-too-many')).toBe(false);
      await limiter.release(slot, 'stream-0');
      expect(await limiter.acquire(slot, 'new-stream')).toBe(true);
    }
  });

  it('stream slots share one Valkey, and a crashed holder frees its slot after the ttl', async () => {
    const valkey = new FakeValkey();
    const limiter = createRateLimiter({ store: createValkeyStore(valkey), onStoreUnavailable: () => undefined });
    const slot = { name: 'sse:ip', key: '203.0.113.7', max: 2, ttlMs: 30_000 };
    expect(await limiter.acquire(slot, 'a')).toBe(true);
    expect(await limiter.acquire(slot, 'b')).toBe(true);
    expect(await limiter.acquire(slot, 'c')).toBe(false);
    valkey.time += 30_001;
    expect(await limiter.acquire(slot, 'c')).toBe(true);
    valkey.failure = new Error('down');
    expect(await limiter.acquire(slot, 'd')).toBe(true);
    await expect(limiter.release(slot, 'd')).resolves.toBeUndefined();
  });

  it('[PR61-SEC-12] IPv4-mapped spellings share one key; IPv6 is counted by its /64; garbage shares one key', () => {
    expect(new Set(['127.0.0.1', '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1'].map(clientIpKey))).toEqual(
      new Set(['127.0.0.1']),
    );
    expect(clientIpKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(clientIpKey('2001:db8:1:2::1'));
    expect(clientIpKey('2001:db8:1:3::1')).not.toBe(clientIpKey('2001:db8:1:2::1'));
    expect([undefined, '', 'not-an-ip'].map(clientIpKey)).toEqual(['unknown', 'unknown', 'unknown']);
  });
});

describe('[PR041-SEC-01] [R1-m5] the fallback maps cost O(1) per new key and stay within their bound', () => {
  it('a new key inspects at most SWEEP_PER_INSERT entries, however many the map holds', () => {
    let inspected = 0;
    const map = new BoundedMap<number, { dead: boolean }>(10_000, (value) => {
      inspected += 1;
      return value.dead;
    });
    for (let key = 0; key < 20_000; key += 1) {
      const before = inspected;
      map.set(key, { dead: false });
      expect(inspected - before).toBeLessThanOrEqual(SWEEP_PER_INSERT);
    }
    expect(map.size).toBe(10_000);
    expect(map.get(0)).toBeUndefined();
    expect(map.get(19_999)).toBeDefined();
  });

  it('drops expired entries from the head and keeps live ones; an update keeps its place', () => {
    const map = new BoundedMap<string, { dead: boolean }>(5, (value) => value.dead);
    map.set('a', { dead: true });
    map.set('b', { dead: false });
    map.set('c', { dead: false });
    map.set('d', { dead: false });
    // The next new key swept the dead head entry away; live entries stay and an update keeps its place.
    expect(map.get('a')).toBeUndefined();
    expect(map.size).toBe(3);
    map.set('b', { dead: false });
    expect(map.size).toBe(3);
    map.set('e', { dead: false });
    expect(map.size).toBe(4);
  });

  it('the window store evicts the oldest window at the cap: 1,000 keys through a cap of 100 leave the recent ones counting', async () => {
    const store = createMemoryStore(() => 0, 100);
    for (let key = 0; key < 1_000; key += 1) await store.hit(`k${String(key)}`, 60_000);
    expect((await store.hit('k999', 60_000)).count).toBe(2);
    expect((await store.hit('k0', 60_000)).count).toBe(1);
  });

  it('the slot map is bounded the same way', async () => {
    const store = createMemoryStore(() => 0, 50);
    for (let key = 0; key < 500; key += 1) await store.acquire(`s${String(key)}`, 'h', 1, 60_000);
    expect(await store.acquire('s499', 'other', 1, 60_000)).toBe(false);
    expect(await store.acquire('s0', 'other', 1, 60_000)).toBe(true);
  });
});

describe('the Valkey store: bounded calls and checked replies', () => {
  it('times out a call that does not answer, with a class-only error', async () => {
    const never = new Promise<never>(() => undefined);
    await expect(withStoreTimeout(never, 5)).rejects.toEqual(expect.objectContaining({ name: 'RateLimitStoreError', reason: 'timeout' }));
    await expect(withStoreTimeout(Promise.reject(new Error('ECONNREFUSED 10.0.0.1:6379')), 50)).rejects.toMatchObject({
      reason: 'unavailable',
      message: 'rate-limit store: unavailable',
    });
  });

  it('refuses a malformed script reply instead of counting it', async () => {
    const store = createValkeyStore({ eval: () => Promise.resolve('OK') });
    await expect(store.hit('rl:x', 60_000)).rejects.toBeInstanceOf(RateLimitStoreError);
    await expect(store.acquire('rl:x', 'h', 1, 1000)).rejects.toMatchObject({ reason: 'malformed-reply' });
  });

  it('keeps the reset inside the window', async () => {
    const store = createValkeyStore({ eval: () => Promise.resolve([1, 999_999]) });
    expect(await store.hit('rl:x', 60_000)).toEqual({ count: 1, resetMs: 60_000 });
  });
});

const ORG = '0193a5b2-7c1e-7d4a-9f3b-0000000000b2';
const ACTOR = '0193a5b2-7c1e-7d4a-9f3b-0000000000a2';
const user: DenialSubject = { orgId: ORG, actorId: ACTOR, credential: 'session', authenticated: true };

describe('[T-39] [D-SECT39-01] the denial budget', () => {
  it('[key grammar] {org|system}:{actor | credential kind}; no segment empty, none able to carry a colon', () => {
    expect(denialKeys(user)).toEqual({ budget: `rl:authz-denial:${ORG}:${ACTOR}`, carry: `rl:authz-denial-carry:${ORG}:${ACTOR}` });
    expect(denialKeys({ orgId: '', actorId: '', credential: 'signature', authenticated: false }).budget).toBe(
      'rl:authz-denial:system:signature',
    );
    const hostile = denialKeys({ orgId: 'a:b', actorId: '*', credential: 'session', authenticated: true });
    expect(hostile.budget).toBe('rl:authz-denial:unknown:unknown');
  });

  it('[SEC-TC-15] N+2 denials: N individual, one aggregated, one suppressed; the next window opens with the carry', async () => {
    const valkey = new FakeValkey();
    const counter = createRateLimitCounter();
    const budget = createDenialBudget({ threshold: 3, valkey, counter, now: () => valkey.time });
    const kinds: string[] = [];
    for (let denial = 1; denial <= 5; denial += 1) kinds.push((await budget.take(user)).kind);
    expect(kinds).toEqual(['individual', 'individual', 'individual', 'aggregated', 'suppressed']);
    expect(valkey.value(denialKeys(user).carry)).toBe(1);
    expect(counter.snapshot()).toEqual({ 'authz-denial': 2 });
    valkey.time += 60_001;
    const opener = await budget.take(user);
    expect(opener).toMatchObject({ kind: 'individual', mark: { kind: 'individual', suppressed: 1 } });
    expect(valkey.value(denialKeys(user).carry)).toBeUndefined();
  });

  it('the crossing verdict carries the closed aggregated mark and the rest of the window; no count', async () => {
    const valkey = new FakeValkey();
    const budget = createDenialBudget({ threshold: 1, valkey, now: () => valkey.time });
    await budget.take(user);
    valkey.time += 10_250;
    const crossing = await budget.take(user);
    expect(crossing).toEqual({
      kind: 'aggregated',
      retryAfterSeconds: 50,
      mark: { kind: 'aggregated', threshold: 1, windowSeconds: 60, windowEndsAt: windowEndsAt(valkey.time, 49_750) },
    });
    expect(windowEndsAt(1_800_000_000_000, 49_750)).toBe('2027-01-15T08:00:50Z');
  });

  it('the budget key always has a TTL of at most 60 s, also at the first take', async () => {
    const valkey = new FakeValkey();
    const budget = createDenialBudget({ threshold: 2, valkey, now: () => valkey.time });
    await budget.take(user);
    const ttl = valkey.pttl(denialKeys(user).budget);
    expect(ttl).toBeGreaterThanOrEqual(1);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });

  it('[restore] the carry claimed by the window opener goes back when its entry was not written', async () => {
    const valkey = new FakeValkey();
    const budget = createDenialBudget({ threshold: 1, valkey, now: () => valkey.time });
    await budget.take(user);
    await budget.take(user);
    await budget.take(user);
    expect(valkey.value(denialKeys(user).carry)).toBe(1);
    valkey.time += 60_001;
    const opener = await budget.take(user);
    expect(opener.kind === 'individual' && opener.mark.suppressed).toBe(1);
    expect(valkey.value(denialKeys(user).carry)).toBeUndefined();
    if (opener.kind === 'individual') await opener.restoreCarry?.();
    expect(valkey.value(denialKeys(user).carry)).toBe(1);
    expect(valkey.pttl(denialKeys(user).carry)).toBeGreaterThan(80_000_000);
  });

  it('a window without suppressed denials carries nothing (never 0), and an out-of-range carry is dropped and reported', async () => {
    const valkey = new FakeValkey();
    const warnings: string[] = [];
    const budget = createDenialBudget({ threshold: 1, valkey, now: () => valkey.time, log: { warn: (event) => warnings.push(event) } });
    expect(await budget.take(user)).toEqual({ kind: 'individual', mark: { kind: 'individual' } });
    valkey.time += 60_001;
    const second = await budget.take(user);
    expect(second).toEqual({ kind: 'individual', mark: { kind: 'individual' } });
    for (const hostile of [2 ** 31, -1]) {
      valkey.time += 60_001;
      await valkey.eval(RESTORE_SCRIPT, 1, denialKeys(user).carry, String(hostile), '86400');
      expect(await budget.take(user)).toEqual({ kind: 'individual', mark: { kind: 'individual' } });
    }
    expect(warnings).toEqual(['rate_limit.carry_dropped', 'rate_limit.carry_dropped']);
  });

  it.each([
    ['an error', new Error('ECONNREFUSED valkey:6379')],
    ['a timeout', new RateLimitStoreError('timeout')],
  ])('[outage] %s uses the per-instance fallback with the same threshold, shape and carry, and reports it', async (_label, failure) => {
    const valkey = new FakeValkey();
    valkey.failure = failure;
    const outages: string[] = [];
    const budget = createDenialBudget({ threshold: 2, valkey, now: () => valkey.time, onStoreUnavailable: (scope) => outages.push(scope) });
    const kinds: string[] = [];
    for (let denial = 1; denial <= 4; denial += 1) kinds.push((await budget.take(user)).kind);
    expect(kinds).toEqual(['individual', 'individual', 'aggregated', 'suppressed']);
    expect(outages).toHaveLength(4);
    valkey.time += 60_001;
    const opener = await budget.take(user);
    expect(opener).toMatchObject({ kind: 'individual', mark: { suppressed: 1 } });
  });

  it('without a Valkey client (test composition) the budget is per instance and never reports an outage', async () => {
    const outages: string[] = [];
    const budget = createDenialBudget({ threshold: 1, onStoreUnavailable: (scope) => outages.push(scope) });
    expect([(await budget.take(user)).kind, (await budget.take(user)).kind, (await budget.take(user)).kind]).toEqual([
      'individual',
      'aggregated',
      'suppressed',
    ]);
    expect(outages).toEqual([]);
  });

  it('two replicas over one Valkey share one budget', async () => {
    const valkey = new FakeValkey();
    const make = () => createDenialBudget({ threshold: 4, valkey, now: () => valkey.time });
    const [one, two] = [make(), make()];
    const kinds: string[] = [];
    for (let denial = 0; denial < 3; denial += 1) kinds.push((await one.take(user)).kind, (await two.take(user)).kind);
    expect(kinds).toEqual(['individual', 'individual', 'individual', 'individual', 'aggregated', 'suppressed']);
  });

  it('[hostile settings] a non-positive threshold is refused at construction', () => {
    expect(() => createDenialBudget({ threshold: 0 })).toThrow(RangeError);
    expect(() => createDenialBudget({ threshold: 1.5 })).toThrow(RangeError);
  });

  it('[PR041-SEC-01] the in-memory denial store is bounded: past the cap the oldest actors are evicted, windows and carries alike', async () => {
    const now = 0;
    const store = memoryDenialStore(() => now, 100);
    for (let actor = 0; actor < 1_000; actor += 1) {
      // Three denials above a threshold of 1 leave a carry per actor.
      for (let denial = 0; denial < 3; denial += 1) await store.take(`b${String(actor)}`, `c${String(actor)}`, 1);
    }
    expect((await store.take('b0', 'c0', 1)).count).toBe(1);
    expect((await store.take('b999', 'c999', 1)).count).toBe(4);
    // The evicted actor's carry went with it (bounded), the recent one is still claimable in its next window.
    expect((await store.take('b0', 'c0', 1)).claimed).toBe(0);
  });

  it('the in-memory denial store is bounded and discards expired windows', async () => {
    let now = 0;
    const store = memoryDenialStore(() => now);
    expect((await store.take('b', 'c', 5)).count).toBe(1);
    now += 60_001;
    expect((await store.take('b', 'c', 5)).count).toBe(1);
  });
});
