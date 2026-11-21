/**
 * The failed-authentication budget through the real createApp (PR041-SEC-02 (b), PR041-SEC-09; ADR-0016 amendment 12
 * items 3, 4 and 6, amendment 13 items 1 to 3; rulings B1 tests (1) to (7) and (9) to (13), B2; conditions E4 and E5;
 * TASK-041 part 041-B; the parallel burst of R1-M1 and D-TASK041-18, the replaced pipeline of R1-m2). Valkey is the script-interpreting fake shared by every "replica"; the real Lua is proved in
 * rate-limit.int.test.ts, the startApi half (B1 (8)) in start-api.denial-budget.api.test.ts.
 */
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { AppError, presentedKinds } from '@platform/shared';
import type { NextFunction, Request, Response } from 'express';
import Joi from 'joi';
import { generateKeyPair, jwtVerify } from 'jose';

import { createApp, type AppDependencies, type AppLogger } from '../../app.js';
import { precheckAccessToken } from '../authn/access-token-precheck.js';
import type { Principal } from '../routing/define-route.js';
import { bootFailureOf, defaultPipelineSlots } from '../routing/pipeline.js';
import { ANONYMOUS, markPrivateResponse, readonlySet, setPrincipal } from '../routing/route-state.js';
import type { RouteSlot } from '../routing/slot.js';
import { fixtureRoute } from '../routing/tests/fixture-route.js';
import { closeLoopbackServer } from '../routing/tests/loopback.js';
import { createRateLimitCounter } from './counter.js';
import type { RateLimitDependencies } from './kit.js';
import { RefreshCookiePathError } from './limits.js';
import { FakeValkey } from './tests/fake-valkey.js';
import { closeServedApps, request } from './tests/serve.js';
import { DEFAULT_RATE_LIMIT_SETTINGS } from './tests/settings.js';

jest.setTimeout(120_000);

afterAll(closeServedApps);

const IP_A = '203.0.113.7';
const IP_B = '198.51.100.9';
const USER = '0193a5b2-7c1e-7d4a-9f3b-0000000000a1';
const failedKey = (ip: string): string => `rl:step0:authn-failed:${ip}`;
const fromIp = (ip: string) => ({ 'X-Forwarded-For': ip });

const session: Principal = {
  ...ANONYMOUS,
  credential: 'session',
  authenticated: true,
  actorId: USER,
  orgId: '0193a5b2-7c1e-7d4a-9f3b-0000000000b2',
  permissions: readonlySet([]),
};

/** Builds a compact token at run time (no token literal in the repository): ES256 header, the claims, a random tail. */
function forgedToken(claims: Readonly<Record<string, unknown>>): string {
  const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'ES256', typ: 'JWT' })}.${part(claims)}.${Buffer.from(Array.from({ length: 64 }, (_, i) => i)).toString('base64url')}`;
}

interface Seam {
  readonly slot: RouteSlot;
  /** Requests the seam was entered for. */
  entered: number;
}

/**
 * The authentication seam: it reads only the kinds the route declares (D-ARCH-109). `Bearer valid`, the cookie value
 * `valid` and the signature `valid` authenticate; `Bearer expired` is 401 ACCESS_TOKEN_EXPIRED; any other declared
 * credential is 401 AUTH_REQUIRED; no declared credential is anonymous where the route allows it.
 */
function seam(): Seam {
  const state: Seam = {
    entered: 0,
    slot: (route) => (req: Request, res: Response, next: NextFunction) => {
      state.entered += 1;
      const declared: readonly string[] = route.auth;
      const bearer = declared.includes('session') ? req.get('authorization') : undefined;
      const cookie = declared.includes('refresh-cookie') && presentedKinds(req.headers, ['refresh-cookie']).length > 0;
      const signature = declared.includes('signature') ? req.get('x-mock-signature') : undefined;
      if (bearer === 'Bearer valid') {
        setPrincipal(res, session);
      } else if (cookie && (req.get('cookie') ?? '').includes('__Host-rt_web=valid')) {
        setPrincipal(res, { ...ANONYMOUS, credential: 'refresh-cookie' });
      } else if (signature === 'valid') {
        setPrincipal(res, { ...ANONYMOUS, credential: 'signature' });
      } else if (bearer === 'Bearer expired') {
        next(new AppError('ACCESS_TOKEN_EXPIRED'));
        return;
      } else if (bearer !== undefined || cookie || signature !== undefined || !declared.includes('anonymous')) {
        markPrivateResponse(res);
        next(new AppError('AUTH_REQUIRED'));
        return;
      } else {
        setPrincipal(res, ANONYMOUS);
      }
      next();
    },
  };
  return state;
}

const routes = [
  fixtureRoute({ operationId: 'listCountries', path: '/reference/countries', rateLimit: 'public', handler: () => ({ status: 200 }) }),
  fixtureRoute({ operationId: 'getProfile', path: '/me', auth: 'session', handler: () => ({ status: 200 }) }),
  fixtureRoute({ operationId: 'login', method: 'post', path: '/auth/login', rateLimit: 'auth', handler: () => ({ status: 200 }) }),
  fixtureRoute({
    operationId: 'getCsrfToken',
    path: '/auth/csrf',
    auth: 'refresh-cookie',
    rateLimit: 'public',
    handler: () => ({ status: 200 }),
  }),
  fixtureRoute({
    operationId: 'refreshSession',
    method: 'post',
    path: '/auth/refresh',
    auth: 'refresh-cookie',
    csrf: true,
    rateLimit: 'public',
    handler: () => ({ status: 200 }),
  }),
  fixtureRoute({
    operationId: 'receiveMockWebhook',
    method: 'post',
    path: '/webhooks/mock',
    auth: 'signature',
    rateLimit: 'webhook',
    handler: () => ({ status: 204 }),
  }),
];

interface Harness {
  readonly valkey: FakeValkey;
  readonly logged: [string, Readonly<Record<string, unknown>>][];
  readonly counter: ReturnType<typeof createRateLimitCounter>;
  readonly seam: Seam;
  app(overrides?: Partial<RateLimitDependencies['settings']>, options?: Partial<AppDependencies>): ReturnType<typeof createApp>;
}

function harness(valkey = new FakeValkey()): Harness {
  const logged: [string, Readonly<Record<string, unknown>>][] = [];
  const counter = createRateLimitCounter();
  const authn = seam();
  const logger: AppLogger = {
    info: () => undefined,
    debug: () => undefined,
    warn: (event, fields) => void logged.push([event, fields ?? {}]),
    error: (event, fields) => void logged.push([event, fields ?? {}]),
  };
  return {
    valkey,
    logged,
    counter,
    seam: authn,
    app: (overrides = {}, options = {}) =>
      createApp({
        health: [],
        modules: [{ name: 'fixtures', routes }],
        logger,
        authenticate: authn.slot,
        trustProxyHops: 1,
        rateLimit: { settings: { ...DEFAULT_RATE_LIMIT_SETTINGS, ...overrides }, valkey, counter },
        ...options,
      }),
  };
}

const securityEvents = (h: Harness, name: string) => h.logged.filter(([event]) => event === `security.${name}`);

/** Sends `count` junk bearers from `ip` to the [session] route; returns the statuses. */
async function junkBearers(app: ReturnType<typeof createApp>, ip: string, count: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let call = 0; call < count; call += 1) {
    statuses.push((await request(app).get('/api/v1/me').set(fromIp(ip)).set('Authorization', 'Bearer junk')).status);
  }
  return statuses;
}

describe('[PR041-SEC-02] [B1] the failed-authentication budget of step 0', () => {
  it('[B1 (1)] 120 junk bearers answer 401; the 121st is 429 before the authentication slot is entered; one event, one counted refusal', async () => {
    const h = harness();
    const app = h.app();
    const statuses = await junkBearers(app, IP_A, 120);
    expect(statuses.every((status) => status === 401)).toBe(true);
    expect(h.seam.entered).toBe(120);
    const refused = await request(app).get('/api/v1/me').set(fromIp(IP_A)).set('Authorization', 'Bearer junk');
    expect(refused.status).toBe(429);
    expect((refused.body as { code?: unknown }).code).toBe('RATE_LIMITED');
    expect(h.seam.entered).toBe(120);
    expect(refused.headers['retry-after']).toMatch(/^\d+$/);
    expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(refused.headers['ratelimit-limit']).toBe('120');
    expect(refused.headers['ratelimit-remaining']).toBe('0');
    expect(refused.headers['ratelimit-reset']).toBe(refused.headers['retry-after']);
    expect(h.counter.snapshot()).toEqual({ 'step0-authn-failed': 1 });
    expect(securityEvents(h, 'rate_limit_auth')).toEqual([
      ['security.rate_limit_auth', expect.objectContaining({ class: 'authn-failed', key_type: 'ip' })],
    ]);
    expect(h.valkey.value(failedKey(IP_A))).toBe(120);
    const ttl = h.valkey.pttl(failedKey(IP_A));
    expect(ttl).toBeGreaterThanOrEqual(1);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });

  it('[B1 (2)] [B1 (3)] another IP with a credential, and the first IP without one, are not affected', async () => {
    const h = harness();
    const app = h.app({ RATE_LIMIT_PUBLIC_PER_MIN: 5 });
    await junkBearers(app, IP_A, 5);
    expect((await request(app).get('/api/v1/me').set(fromIp(IP_A)).set('Authorization', 'Bearer junk')).status).toBe(429);
    expect((await request(app).get('/api/v1/me').set(fromIp(IP_B)).set('Authorization', 'Bearer junk')).status).toBe(401);
    expect((await request(app).get('/api/v1/reference/countries').set(fromIp(IP_A))).status).toBe(200);
  });

  it('[B1 (4)] [E4] a seam that answers ACCESS_TOKEN_EXPIRED 200 times causes no 429 and spends nothing', async () => {
    const h = harness();
    const app = h.app();
    for (let call = 0; call < 200; call += 1) {
      const res = await request(app).get('/api/v1/me').set(fromIp(IP_A)).set('Authorization', 'Bearer expired');
      expect([res.status, (res.body as { code?: unknown }).code]).toEqual([401, 'ACCESS_TOKEN_EXPIRED']);
    }
    expect(h.valkey.value(failedKey(IP_A))).toBeUndefined();
    expect(h.valkey.count('hit', failedKey(IP_A))).toBe(0);
    expect(securityEvents(h, 'rate_limit_auth')).toEqual([]);
  });

  it('[B1 (5)] [D-ARCH-109] a junk bearer on an [anonymous] route is never read and spends nothing', async () => {
    const h = harness();
    const app = h.app();
    for (let call = 0; call < 10; call += 1) {
      const res = await request(app).get('/api/v1/reference/countries').set(fromIp(IP_A)).set('Authorization', 'Bearer junk');
      expect(res.status).toBe(200);
    }
    expect(h.valkey.value(failedKey(IP_A))).toBeUndefined();
  });

  it('[B1 (6)] two replicas over one Valkey share the budget', async () => {
    const valkey = new FakeValkey();
    const [one, two] = [harness(valkey).app({ RATE_LIMIT_PUBLIC_PER_MIN: 5 }), harness(valkey).app({ RATE_LIMIT_PUBLIC_PER_MIN: 5 })];
    expect(await junkBearers(one, IP_A, 3)).toEqual([401, 401, 401]);
    expect(await junkBearers(two, IP_A, 2)).toEqual([401, 401]);
    expect(await junkBearers(one, IP_A, 1)).toEqual([429]);
    expect(await junkBearers(two, IP_A, 1)).toEqual([429]);
  });

  it('[B1 (7)] with the store failing the budget holds per instance, and the outage is reported once', async () => {
    const valkey = new FakeValkey();
    valkey.failure = new Error('connect ECONNREFUSED valkey.internal:6379');
    const h = harness(valkey);
    const app = h.app({ RATE_LIMIT_PUBLIC_PER_MIN: 5 });
    expect(await junkBearers(app, IP_A, 6)).toEqual([401, 401, 401, 401, 401, 429]);
    // Per instance: another replica over the same failing store has its own counter.
    expect(await junkBearers(harness(valkey).app({ RATE_LIMIT_PUBLIC_PER_MIN: 5 }), IP_A, 1)).toEqual([401]);
    expect(securityEvents(h, 'rate_limit_store_unavailable')).toHaveLength(1);
    expect(securityEvents(h, 'rate_limit_auth')).toHaveLength(1);
    expect(JSON.stringify(h.logged)).not.toContain('valkey.internal');
  });

  it('[B1] the first spend of the next window starts a new budget and the limit emits again', async () => {
    const h = harness();
    const app = h.app({ RATE_LIMIT_PUBLIC_PER_MIN: 2 });
    await junkBearers(app, IP_A, 2);
    expect(await junkBearers(app, IP_A, 1)).toEqual([429]);
    h.valkey.time += 60_001;
    expect(await junkBearers(app, IP_A, 3)).toEqual([401, 401, 429]);
    expect(securityEvents(h, 'rate_limit_auth')).toHaveLength(2);
  });
});

describe('[PR041-SEC-09] [ADR-0016 am. 13] revision 2: the refresh cookie selects the lock only on the cookie routes', () => {
  /** An app whose budget for IP A is spent (limit 5). */
  async function locked(): Promise<{ h: Harness; app: ReturnType<typeof createApp> }> {
    const h = harness();
    const app = h.app({ RATE_LIMIT_PUBLIC_PER_MIN: 5 });
    expect(await junkBearers(app, IP_A, 5)).toEqual([401, 401, 401, 401, 401]);
    return { h, app };
  }

  it('[B1 (9)] a request from A that carries only __Host-rt_web to the sign-in route is served, counted under the unauthenticated budget', async () => {
    const { h, app } = await locked();
    const anonymousBefore = h.valkey.value(`rl:step0:anonymous:${IP_A}`) ?? 0;
    const credentialedBefore = h.valkey.value(`rl:step0:credentialed:${IP_A}`);
    const res = await request(app).post('/api/v1/auth/login').set(fromIp(IP_A)).set('Cookie', '__Host-rt_web=stale').send({});
    expect(res.status).toBe(200);
    expect(h.valkey.value(`rl:step0:anonymous:${IP_A}`)).toBe(anonymousBefore + 1);
    expect(h.valkey.value(`rl:step0:credentialed:${IP_A}`)).toBe(credentialedBefore);
  });

  it('[B1 (10)] [R2 (i)] a credential the seam would accept, from the locked IP, gets 429 with Retry-After (the accepted scope)', async () => {
    const { h, app } = await locked();
    const entered = h.seam.entered;
    const res = await request(app).get('/api/v1/me').set(fromIp(IP_A)).set('Authorization', 'Bearer valid');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toMatch(/^\d+$/);
    expect(res.headers['ratelimit-limit']).toBe('5');
    expect(h.seam.entered).toBe(entered);
    expect(h.counter.snapshot()['step0-authn-failed']).toBe(1);
  });

  it('[B1 (11)] a credentialed request from IP B is served', async () => {
    const { app } = await locked();
    expect((await request(app).get('/api/v1/me').set(fromIp(IP_B)).set('Authorization', 'Bearer valid')).status).toBe(200);
  });

  it('[B1 (12)] before the lock the cookie takes the credentialed rule only on /auth/refresh; under the lock that request is 429', async () => {
    const h = harness();
    const app = h.app({ RATE_LIMIT_PUBLIC_PER_MIN: 5 });
    const cookie = { Cookie: 'theme=dark; __Host-rt_web=valid', ...fromIp(IP_A) };
    expect((await request(app).post('/api/v1/auth/refresh').set(cookie)).status).toBe(200);
    expect(h.valkey.value(`rl:step0:credentialed:${IP_A}`)).toBe(1);
    expect(h.valkey.value(`rl:step0:anonymous:${IP_A}`)).toBeUndefined();
    expect((await request(app).get('/api/v1/reference/countries').set(cookie)).status).toBe(200);
    expect(h.valkey.value(`rl:step0:anonymous:${IP_A}`)).toBe(1);
    expect(h.valkey.value(`rl:step0:credentialed:${IP_A}`)).toBe(1);
    await junkBearers(app, IP_A, 5);
    const refused = await request(app).post('/api/v1/auth/refresh').set(cookie);
    expect(refused.status).toBe(429);
    expect(refused.headers['retry-after']).toMatch(/^\d+$/);
    expect((await request(app).get('/api/v1/auth/csrf').set(cookie)).status).toBe(429);
    // Off the cookie routes the same cookie is unauthenticated and never locked.
    expect((await request(app).get('/api/v1/reference/countries').set(cookie)).status).toBe(200);
  });

  it('[B1 (12)] another spelling of a cookie route takes the unauthenticated budget (the cookie is still under one of the two bounds)', async () => {
    const { h, app } = await locked();
    const before = h.valkey.value(`rl:step0:anonymous:${IP_A}`) ?? 0;
    const res = await request(app).post('/api/v1/auth/refresh/').set(fromIp(IP_A)).set('Cookie', '__Host-rt_web=valid');
    expect(res.status).not.toBe(429);
    expect(h.valkey.value(`rl:step0:anonymous:${IP_A}`)).toBe(before + 1);
  });

  it('[B1] a refused refresh cookie on its own route spends one unit', async () => {
    const h = harness();
    const app = h.app({ RATE_LIMIT_PUBLIC_PER_MIN: 5 });
    expect((await request(app).post('/api/v1/auth/refresh').set(fromIp(IP_A)).set('Cookie', '__Host-rt_web=unknown')).status).toBe(401);
    expect(h.valkey.value(failedKey(IP_A))).toBe(1);
  });

  it('[B1 (13)] createApp refuses a refresh-cookie route with a path parameter, and startApi maps it to a boot line', () => {
    const bad = fixtureRoute({
      operationId: 'refreshSession',
      method: 'post',
      path: '/auth/:kind/refresh',
      auth: 'refresh-cookie',
      csrf: true,
      schema: { params: Joi.object({ kind: Joi.string() }) },
      handler: () => ({ status: 200 }),
    });
    const compose = () =>
      createApp({
        health: [],
        modules: [{ name: 'auth', routes: [bad] }],
        logger: { info: () => undefined, debug: () => undefined, error: () => undefined },
      });
    expect(compose).toThrow(RefreshCookiePathError);
    let thrown: unknown;
    try {
      compose();
    } catch (error) {
      thrown = error;
    }
    expect(bootFailureOf(thrown)).toEqual({
      event: 'api.refresh_cookie_route_refused',
      fields: { error: 'RefreshCookiePathError', operation: 'refreshSession', path: '/auth/:kind/refresh' },
    });
  });
});

describe('[B2] a provider signature header selects the credentialed rule', () => {
  it('121 signed webhook requests from one IP are not refused by step 0 (the webhook class allows 600)', async () => {
    const h = harness();
    const app = h.app();
    for (let call = 1; call <= 121; call += 1) {
      const res = await request(app).post('/api/v1/webhooks/mock').set(fromIp(IP_A)).set('X-Mock-Signature', 'valid').send({});
      expect(res.status).toBe(204);
    }
    expect(h.valkey.value(`rl:step0:credentialed:${IP_A}`)).toBe(121);
    expect(h.valkey.value(`rl:step0:anonymous:${IP_A}`)).toBeUndefined();
  });

  it('a bad signature is a refusal of the [signature] route and spends one unit', async () => {
    const h = harness();
    const app = h.app();
    expect((await request(app).post('/api/v1/webhooks/mock').set(fromIp(IP_A)).set('X-Mock-Signature', 'forged').send({})).status).toBe(
      401,
    );
    expect(h.valkey.value(failedKey(IP_A))).toBe(1);
  });
});

describe('[E5] [ADR-0016 am. 13 item 3] the exp pre-check in front of the verification, through the wrapper', () => {
  let verifyKey: Awaited<ReturnType<typeof generateKeyPair>>['publicKey'];
  let verifications = 0;

  beforeAll(async () => {
    ({ publicKey: verifyKey } = await generateKeyPair('ES256'));
  });

  /** A session authenticator shaped as E1 to E4 require: pre-check, then full verification, no I/O, no event. */
  const preChecking: RouteSlot = () => (req: Request, res: Response, next: NextFunction) => {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    markPrivateResponse(res);
    const verdict = precheckAccessToken(token, Math.floor(Date.now() / 1000), 30);
    if (verdict === 'expired') {
      next(new AppError('ACCESS_TOKEN_EXPIRED'));
      return;
    }
    if (verdict === 'malformed') {
      next(new AppError('AUTH_REQUIRED'));
      return;
    }
    verifications += 1;
    jwtVerify(token, verifyKey, { algorithms: ['ES256'], issuer: 'https://api.example.test', audience: 'web', clockTolerance: 30 }).then(
      () => {
        setPrincipal(res, session);
        next();
      },
      () => next(new AppError('AUTH_REQUIRED')),
    );
  };

  it('[E5] 200 forged tokens with a past exp: 200 x 401 ACCESS_TOKEN_EXPIRED, no verification, no spend, no event, no 429', async () => {
    const h = harness();
    const app = h.app({}, { authenticate: preChecking });
    verifications = 0;
    const past = Math.floor(Date.now() / 1000) - 3_600;
    for (let call = 0; call < 200; call += 1) {
      const res = await request(app)
        .get('/api/v1/me')
        .set(fromIp(IP_A))
        .set('Authorization', `Bearer ${forgedToken({ exp: past - call, sub: USER })}`);
      expect([res.status, (res.body as { code?: unknown }).code]).toEqual([401, 'ACCESS_TOKEN_EXPIRED']);
    }
    expect(verifications).toBe(0);
    // The only store calls are the 200 step-0 calls of the requests themselves; the authenticator made none.
    expect(h.valkey.calls).toBe(200);
    expect(h.valkey.count('hitAndPeek', `rl:step0:credentialed:${IP_A}`)).toBe(200);
    expect(h.valkey.count('hit', failedKey(IP_A))).toBe(0);
    expect(h.logged.filter(([event]) => event.startsWith('security.'))).toEqual([]);
    expect(h.counter.snapshot()).toEqual({});
  });

  it('[E5] a forged token with a future exp is verified once and spends one unit', async () => {
    const h = harness();
    const app = h.app({}, { authenticate: preChecking });
    verifications = 0;
    const res = await request(app)
      .get('/api/v1/me')
      .set(fromIp(IP_A))
      .set('Authorization', `Bearer ${forgedToken({ exp: Math.floor(Date.now() / 1000) + 600, sub: USER })}`);
    expect([res.status, (res.body as { code?: unknown }).code]).toEqual([401, 'AUTH_REQUIRED']);
    expect(verifications).toBe(1);
    expect(h.valkey.value(failedKey(IP_A))).toBe(1);
  });

  it('[E2] a token without a usable exp is refused before any verification and spends one unit', async () => {
    const h = harness();
    const app = h.app({}, { authenticate: preChecking });
    verifications = 0;
    for (const claims of [{ sub: USER }, { exp: '1' }, { exp: 1e300 }]) {
      const res = await request(app)
        .get('/api/v1/me')
        .set(fromIp(IP_A))
        .set('Authorization', `Bearer ${forgedToken(claims)}`);
      expect((res.body as { code?: unknown }).code).toBe('AUTH_REQUIRED');
    }
    expect(verifications).toBe(0);
    expect(h.valkey.value(failedKey(IP_A))).toBe(3);
  });
});

/** A seam that answers after `delayMs` (a stand-in for a verification or a lookup) and records its peak concurrency. */
function slowSeam(delayMs: number): Seam & { active: number; peak: number } {
  const state = {
    entered: 0,
    active: 0,
    peak: 0,
    slot: (() => (req: Request, res: Response, next: NextFunction) => {
      state.entered += 1;
      state.active += 1;
      state.peak = Math.max(state.peak, state.active);
      setTimeout(() => {
        state.active -= 1;
        markPrivateResponse(res);
        if (req.get('authorization') === 'Bearer valid') {
          setPrincipal(res, session);
          next();
          return;
        }
        next(new AppError('AUTH_REQUIRED'));
      }, delayMs);
    }) as RouteSlot,
  };
  return state;
}

/** Sends `count` bearers from `ip` to the [session] route at once; resolves with every reply. */
const parallelBearers = (app: ReturnType<typeof createApp>, ip: string, count: number, bearer = 'Bearer junk') =>
  Promise.all(Array.from({ length: count }, () => request(app).get('/api/v1/me').set(fromIp(ip)).set('Authorization', bearer)));

/** Polls `done` every 10 ms (a condition, not a sleep); fails after `deadlineMs`. */
async function until(done: () => boolean, deadlineMs = 30_000): Promise<void> {
  const started = Date.now();
  while (!done()) {
    if (Date.now() - started > deadlineMs) throw new Error('condition not reached');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('[R1-M1] [D-TASK041-18] a parallel burst is bounded by the budget (the in-flight ledger)', () => {
  it('60 parallel junk bearers with limit 5: the authenticator is entered 5 times (per-instance slack 0), 5 x 401 and 55 x 429', async () => {
    const h = harness();
    const slow = slowSeam(20);
    const app = h.app({ RATE_LIMIT_PUBLIC_PER_MIN: 5 }, { authenticate: slow.slot });
    const replies = await parallelBearers(app, IP_A, 60);
    expect(slow.entered).toBe(5);
    expect(replies.filter((reply) => reply.status === 401)).toHaveLength(5);
    const refused = replies.filter((reply) => reply.status === 429);
    expect(refused).toHaveLength(55);
    for (const reply of refused) {
      expect((reply.body as { code?: unknown }).code).toBe('RATE_LIMITED');
      expect(reply.headers['retry-after']).toMatch(/^\d+$/);
      expect(reply.headers['ratelimit-limit']).toBe('5');
      expect(reply.headers['ratelimit-remaining']).toBe('0');
    }
    expect(h.valkey.value(failedKey(IP_A))).toBe(5);
    expect(h.counter.snapshot()).toEqual({ 'step0-authn-failed': 55 });
    expect(securityEvents(h, 'rate_limit_auth')).toHaveLength(1);
    // The window is spent: the next request is refused before the authenticator, valid or not.
    expect((await request(app).get('/api/v1/me').set(fromIp(IP_A)).set('Authorization', 'Bearer valid')).status).toBe(429);
    expect(slow.entered).toBe(5);
  });

  it('[D-TASK041-18] the residual: two replicas over one Valkey each admit up to the limit, so at most 2 x 5 reach an authenticator', async () => {
    const valkey = new FakeValkey();
    const [first, second] = [slowSeam(20), slowSeam(20)];
    const one = harness(valkey).app({ RATE_LIMIT_PUBLIC_PER_MIN: 5 }, { authenticate: first.slot });
    const two = harness(valkey).app({ RATE_LIMIT_PUBLIC_PER_MIN: 5 }, { authenticate: second.slot });
    const replies = (await Promise.all([parallelBearers(one, IP_A, 30), parallelBearers(two, IP_A, 30)])).flat();
    expect(first.entered).toBeLessThanOrEqual(5);
    expect(second.entered).toBeLessThanOrEqual(5);
    const entered = first.entered + second.entered;
    expect(entered).toBeGreaterThanOrEqual(5);
    expect(replies.filter((reply) => reply.status === 401)).toHaveLength(entered);
    expect(replies.filter((reply) => reply.status === 429)).toHaveLength(60 - entered);
    expect(valkey.value(failedKey(IP_A))).toBe(entered);
  });

  it('valid credentials of one IP are refused (Retry-After 1) only while the limit of its authentications is in flight; every unit is released', async () => {
    const h = harness();
    const slow = slowSeam(20);
    const app = h.app({ RATE_LIMIT_PUBLIC_PER_MIN: 5 }, { authenticate: slow.slot });
    const replies = await parallelBearers(app, IP_A, 30, 'Bearer valid');
    expect(slow.peak).toBeLessThanOrEqual(5);
    expect(replies.filter((reply) => reply.status === 200).length).toBeGreaterThanOrEqual(5);
    for (const reply of replies.filter((candidate) => candidate.status !== 200)) {
      expect([reply.status, reply.headers['retry-after']]).toEqual([429, '1']);
    }
    expect(h.valkey.value(failedKey(IP_A))).toBeUndefined();
    // Nothing is left held: five refusals in sequence still reach the authenticator.
    expect(await junkBearers(app, IP_A, 5)).toEqual([401, 401, 401, 401, 401]);
  });

  it('a credentialed request that never reaches the authentication slot (404) releases its unit when the response closes', async () => {
    const h = harness();
    const app = h.app({ RATE_LIMIT_PUBLIC_PER_MIN: 2 });
    for (let call = 0; call < 5; call += 1) {
      expect((await request(app).get('/api/v1/no-such-route').set(fromIp(IP_A)).set('Authorization', 'Bearer junk')).status).toBe(404);
    }
    expect(await junkBearers(app, IP_A, 3)).toEqual([401, 401, 429]);
  });

  it('a request whose client went away before step 0 answered is never admitted, so an abort cannot skip the hold', async () => {
    const h = harness();
    h.valkey.hang = true;
    const app = h.app({ RATE_LIMIT_PUBLIC_PER_MIN: 5 });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    try {
      const outgoing = httpRequest({
        host: '127.0.0.1',
        port: (server.address() as AddressInfo).port,
        path: '/api/v1/me',
        agent: false,
        headers: { ...fromIp(IP_A), Authorization: 'Bearer junk' },
      });
      outgoing.on('error', () => undefined);
      outgoing.end();
      // Step 0 has sent its store call (it hangs until the 250 ms bound); then the client goes away.
      await until(() => h.valkey.calls === 1);
      outgoing.destroy();
      await until(() => h.counter.snapshot()['step0-authn-failed'] === 1);
      expect(h.seam.entered).toBe(0);
    } finally {
      await closeLoopbackServer(server);
    }
  });
});

describe('[R1-m2] [K3] the wrapper is composed around a replaced pipeline too', () => {
  it('with `pipeline` and `rateLimit`, a refusal of the replaced authentication slot spends one unit', async () => {
    const h = harness();
    const passThrough: RouteSlot = () => (_req: Request, _res: Response, next: NextFunction) => next();
    const app = h.app(
      { RATE_LIMIT_PUBLIC_PER_MIN: 5 },
      { pipeline: { ...defaultPipelineSlots({ tenantTx: undefined }), rateLimit: passThrough, authenticate: h.seam.slot } },
    );
    expect(await junkBearers(app, IP_A, 1)).toEqual([401]);
    expect(h.seam.entered).toBe(1);
    expect(h.valkey.value(failedKey(IP_A))).toBe(1);
  });
});
