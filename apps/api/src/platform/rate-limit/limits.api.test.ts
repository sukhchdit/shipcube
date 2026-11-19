/**
 * The step-0 per-IP limiter and the step-5 class limiter through the real createApp (US-040 AT-US-040-01 … -12, -17;
 * PR21-SEC-01 step 5; AT-US-087-04 trusted proxy chain; PR48-SEC-06 production composition; TASK-041). Valkey is the
 * script-interpreting fake shared by every "replica"; the real Lua is proved in rate-limit.int.test.ts.
 */
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it, jest } from '@jest/globals';
import { RATE_LIMIT_DEFAULTS } from '@platform/config';
import type { NextFunction, Request, Response } from 'express';

import { createApp, type AppDependencies, type AppLogger } from '../../app.js';
import type { Principal } from '../routing/define-route.js';
import type { RouteSlot } from '../routing/slot.js';
import { ANONYMOUS, markPrivateResponse, readonlySet, setPrincipal } from '../routing/route-state.js';
import { fixtureRoute } from '../routing/tests/fixture-route.js';
import type { RateLimitDependencies } from './kit.js';
import { closeServedApps, request } from './tests/serve.js';
import { FakeValkey } from './tests/fake-valkey.js';

jest.setTimeout(60_000);

afterAll(closeServedApps);

const SPEC = fileURLToPath(new URL('../../../../../docs/03-architecture/api/openapi.yaml', import.meta.url));

const defaults = Object.fromEntries(
  Object.entries({
    RATE_LIMIT_PUBLIC_PER_MIN: 'public',
    RATE_LIMIT_AUTH_PER_IP_PER_MIN: 'authIp',
    RATE_LIMIT_AUTH_PER_ACCOUNT_PER_MIN: 'authAccount',
    RATE_LIMIT_AUTHENTICATED_PER_MIN: 'authenticated',
    RATE_LIMIT_WEBHOOK_PER_MIN: 'webhook',
    RATE_LIMIT_CSP_REPORT_PER_MIN: 'cspReport',
    RATE_LIMIT_PUBLIC_QUOTE_PER_MIN: 'publicQuoteMin',
    RATE_LIMIT_PUBLIC_QUOTE_PER_HOUR: 'publicQuoteHour',
    RATE_LIMIT_PUBLIC_TRACKING_PER_MIN: 'publicTrackingMin',
    RATE_LIMIT_PUBLIC_TRACKING_PER_HOUR: 'publicTrackingHour',
    RATE_LIMIT_EMAIL_SEND_PER_ADDRESS_PER_HOUR: 'emailAddress',
    RATE_LIMIT_EMAIL_SEND_PER_IP_PER_HOUR: 'emailIp',
    RATE_QUOTE_CREATE_PER_USER_PER_MIN: 'quoteUserMin',
    RATE_QUOTE_CREATE_PER_USER_PER_HOUR: 'quoteUserHour',
    RATE_QUOTE_CREATE_PER_ORG_PER_HOUR: 'quoteOrgHour',
    SSE_MAX_STREAMS_PER_IP: 'streamsIp',
    SSE_MAX_STREAMS_PER_USER: 'streamsUser',
    AUTHZ_DENIAL_BUDGET_PER_MIN: 'authzDenial',
  }).map(([key, name]) => [key, RATE_LIMIT_DEFAULTS[name as keyof typeof RATE_LIMIT_DEFAULTS].value]),
) as unknown as RateLimitDependencies['settings'];

const USER_A = '0193a5b2-7c1e-7d4a-9f3b-0000000000a1';
const USER_B = '0193a5b2-7c1e-7d4a-9f3b-0000000000a2';

/** The authentication seam: the `x-test-user` header selects a session principal, otherwise anonymous. */
const authenticate: RouteSlot = () => (req: Request, res: Response, next: NextFunction) => {
  const id = req.get('x-test-user');
  if (id === undefined) {
    setPrincipal(res, ANONYMOUS);
  } else {
    const principal: Principal = {
      ...ANONYMOUS,
      credential: 'session',
      authenticated: true,
      actorId: id,
      orgId: '0193a5b2-7c1e-7d4a-9f3b-0000000000b2',
      permissions: readonlySet(['quote:create']),
    };
    setPrincipal(res, principal);
    markPrivateResponse(res);
  }
  next();
};

interface Harness {
  readonly logged: [string, Readonly<Record<string, unknown>>][];
  readonly handled: Record<string, number>;
  app(options?: Partial<AppDependencies>, overrides?: Partial<RateLimitDependencies['settings']>): ReturnType<typeof createApp>;
}

function harness(valkey = new FakeValkey()): Harness & { valkey: FakeValkey } {
  const logged: [string, Readonly<Record<string, unknown>>][] = [];
  const handled: Record<string, number> = {};
  const count = (name: string): void => {
    handled[name] = (handled[name] ?? 0) + 1;
  };
  const logger: AppLogger = {
    info: () => undefined,
    debug: () => undefined,
    warn: (event, fields) => void logged.push([event, fields ?? {}]),
    error: (event, fields) => void logged.push([event, fields ?? {}]),
  };
  const routes = [
    fixtureRoute({
      operationId: 'listCountries',
      path: '/reference/countries',
      rateLimit: 'public',
      handler: () => {
        count('countries');
        return { status: 200, body: { data: [] } };
      },
    }),
    fixtureRoute({
      operationId: 'refreshSession',
      method: 'post',
      path: '/auth/refresh',
      rateLimit: 'public',
      handler: () => ({ status: 200, body: {} }),
    }),
    fixtureRoute({
      operationId: 'login',
      method: 'post',
      path: '/auth/login',
      rateLimit: 'auth',
      handler: () => {
        count('passwordHashComparison');
        return { status: 200, body: {} };
      },
    }),
    fixtureRoute({
      operationId: 'reportCspViolation',
      method: 'post',
      path: '/security/csp-report',
      rateLimit: 'csp-report',
      handler: () => ({ status: 204 }),
    }),
    fixtureRoute({
      operationId: 'listMine',
      path: '/mine',
      rateLimit: 'authenticated',
      auth: ['anonymous', 'session'],
      permissionAuthenticated: 'quote:create',
      handler: () => ({ status: 200, body: { data: [] } }),
    }),
    fixtureRoute({
      operationId: 'whoAmI',
      path: '/whoami',
      handler: (ctx) => ({ status: 200, body: { ip: ctx.transport.ip } }),
    }),
  ];
  const health = [
    fixtureRoute({ operationId: 'getLiveness', path: '/health/live', handler: () => ({ status: 200, body: { status: 'ok' } }) }),
  ];
  return {
    logged,
    handled,
    valkey,
    app: (options = {}, overrides = {}) =>
      createApp({
        health,
        modules: [{ name: 'fixtures', routes }],
        logger,
        authenticate,
        trustProxyHops: 1,
        rateLimit: { settings: { ...defaults, ...overrides }, valkey },
        ...options,
      }),
  };
}

const fromIp = (ip: string) => ({ 'X-Forwarded-For': ip });

describe('[US-040] headers and refusals through the real pipeline', () => {
  it('[AT-US-040-01] [AT-US-040-17] GET /reference/countries: RateLimit-Limit 120, Remaining 119 and Reset; only the three draft-06 names', async () => {
    const res = await request(harness().app()).get('/api/v1/reference/countries').set(fromIp('203.0.113.7'));
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('120');
    expect(res.headers['ratelimit-remaining']).toBe('119');
    expect(Number(res.headers['ratelimit-reset'])).toBeGreaterThanOrEqual(1);
    const names = Object.keys(res.headers);
    expect(names.filter((name) => name.startsWith('x-ratelimit'))).toEqual([]);
    expect(names).not.toContain('ratelimit');
    expect(names).not.toContain('ratelimit-policy');
  });

  it('[AT-US-040-02] the 121st unauthenticated request from one IP is 429 RATE_LIMITED problem+json with Retry-After in seconds', async () => {
    const app = harness().app();
    let last = await request(app).get('/api/v1/reference/countries').set(fromIp('203.0.113.7'));
    for (let call = 2; call <= 121; call += 1) last = await request(app).get('/api/v1/reference/countries').set(fromIp('203.0.113.7'));
    expect(last.status).toBe(429);
    expect(last.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect((last.body as { code?: unknown }).code).toBe('RATE_LIMITED');
    expect(last.headers['retry-after']).toMatch(/^\d+$/);
    expect(last.headers['ratelimit-remaining']).toBe('0');
    expect((await request(app).get('/api/v1/reference/countries').set(fromIp('198.51.100.9'))).status).toBe(200);
  });

  it('[AT-US-040-03] CSP report: the 21st request per IP is refused', async () => {
    const app = harness().app();
    const statuses: number[] = [];
    for (let call = 1; call <= 21; call += 1)
      statuses.push((await request(app).post('/api/v1/security/csp-report').set(fromIp('203.0.113.7'))).status);
    expect(statuses.slice(0, 20).every((status) => status === 204)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it('[AT-US-040-05] two API instances share the counters: 60 requests to each, the 121st overall is refused', async () => {
    const valkey = new FakeValkey();
    const [one, two] = [harness(valkey).app(), harness(valkey).app()];
    const statuses: number[] = [];
    for (let call = 0; call < 60; call += 1) {
      statuses.push((await request(one).get('/api/v1/reference/countries').set(fromIp('203.0.113.7'))).status);
      statuses.push((await request(two).get('/api/v1/reference/countries').set(fromIp('203.0.113.7'))).status);
    }
    expect(statuses.every((status) => status === 200)).toBe(true);
    expect((await request(one).get('/api/v1/reference/countries').set(fromIp('203.0.113.7'))).status).toBe(429);
  });

  it('[AT-US-040-06] the auth class refuses the 11th login per IP before the handler (no password hash comparison)', async () => {
    const h = harness();
    const app = h.app();
    const statuses: number[] = [];
    for (let call = 1; call <= 11; call += 1)
      statuses.push((await request(app).post('/api/v1/auth/login').send({}).set(fromIp('203.0.113.7'))).status);
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect(h.handled['passwordHashComparison']).toBe(10);
  });

  it('[AT-US-040-07] 11 refresh requests are not rate limited', async () => {
    const app = harness().app();
    for (let call = 1; call <= 11; call += 1) {
      expect((await request(app).post('/api/v1/auth/refresh').set(fromIp('203.0.113.7'))).status).toBe(200);
    }
  });

  it('[AT-US-040-10] a refused auth-class request is a security event rate_limit_auth', async () => {
    const h = harness();
    const app = h.app();
    for (let call = 1; call <= 11; call += 1) await request(app).post('/api/v1/auth/login').send({}).set(fromIp('203.0.113.7'));
    expect(h.logged.filter(([event]) => event === 'security.rate_limit_auth')).toEqual([
      ['security.rate_limit_auth', expect.objectContaining({ class: 'auth', key_type: 'ip' })],
    ]);
  });

  it('[AT-US-040-11] limits apply per user: user A exhausted 600, user B from the same IP still succeeds', async () => {
    const app = harness().app();
    let last = 200;
    for (let call = 1; call <= 601; call += 1)
      last = (
        await request(app).get('/api/v1/mine').set(fromIp('203.0.113.7')).set('Authorization', 'Bearer test').set('x-test-user', USER_A)
      ).status;
    expect(last).toBe(429);
    expect(
      (await request(app).get('/api/v1/mine').set(fromIp('203.0.113.7')).set('Authorization', 'Bearer test').set('x-test-user', USER_B))
        .status,
    ).toBe(200);
  });

  it('[AT-US-040-08] [AT-US-087-04] a forged leading X-Forwarded-For address is ignored: req.ip is the first untrusted hop', async () => {
    const app = harness().app();
    const res = await request(app).get('/api/v1/whoami').set('X-Forwarded-For', '1.2.3.4, 203.0.113.9');
    expect((res.body as { ip: string }).ip).toBe('203.0.113.9');
    // Behind no trusted proxy the header is not read at all: the connecting address counts.
    const direct = await request(harness().app({ trustProxyHops: 0 }))
      .get('/api/v1/whoami')
      .set('X-Forwarded-For', '1.2.3.4');
    expect((direct.body as { ip: string }).ip).toMatch(/^(::ffff:)?127\.0\.0\.1$|^::1$/);
  });

  it('[AT-US-040-09] Valkey down: the 11th login is refused from the in-memory counter and an ERROR security event is logged; reference data is served', async () => {
    const h = harness();
    h.valkey.failure = new Error('connect ECONNREFUSED valkey.internal:6379');
    const app = h.app();
    const statuses: number[] = [];
    for (let call = 1; call <= 11; call += 1)
      statuses.push((await request(app).post('/api/v1/auth/login').send({}).set(fromIp('203.0.113.7'))).status);
    expect(statuses[9]).toBe(200);
    expect(statuses[10]).toBe(429);
    const open = await request(app).get('/api/v1/reference/countries').set(fromIp('203.0.113.7'));
    expect(open.status).toBe(200);
    expect(open.headers['ratelimit-limit']).toBeUndefined();
    const outage = h.logged.filter(([event]) => event === 'security.rate_limit_store_unavailable');
    expect(outage).toHaveLength(1);
    expect(JSON.stringify(h.logged)).not.toContain('valkey.internal');
  });

  it('[PR21-SEC-01 step 5] the step-0 limiter is path-less: /api/docs/* is limited like every other public route', async () => {
    const app = harness().app({ docs: { specPath: SPEC, apiMode: 'test', topBar: false } }, { RATE_LIMIT_PUBLIC_PER_MIN: 3 });
    const statuses: number[] = [];
    for (let call = 1; call <= 4; call += 1) statuses.push((await request(app).get('/api/docs/').set(fromIp('203.0.113.7'))).status);
    expect(statuses.slice(0, 3)).not.toContain(429);
    expect(statuses[3]).toBe(429);
  });

  it('the orchestrator probes (class none) are never counted', async () => {
    const app = harness().app({}, { RATE_LIMIT_PUBLIC_PER_MIN: 2 });
    for (let call = 1; call <= 10; call += 1) expect((await request(app).get('/health/live').set(fromIp('203.0.113.7'))).status).toBe(200);
  });

  it('a credentialed request has a per-IP ceiling of ten times the per-user limit, so forged credentials cannot flood', async () => {
    const app = harness().app({}, { RATE_LIMIT_AUTHENTICATED_PER_MIN: 2 });
    const statuses: number[] = [];
    for (let call = 1; call <= 21; call += 1) {
      statuses.push(
        (await request(app).get('/api/v1/reference/countries').set(fromIp('203.0.113.7')).set('Authorization', 'Bearer not-a-token'))
          .status,
      );
    }
    expect(statuses.slice(0, 20)).not.toContain(429);
    expect(statuses[20]).toBe(429);
  });

  it('a composition without the rate-limit dependencies keeps the pass-through stubs (no headers)', async () => {
    const h = harness();
    const routes = [fixtureRoute({ operationId: 'x', path: '/x', handler: () => ({ status: 200 }) })];
    const app = createApp({
      health: [],
      modules: [{ name: 'fixtures', routes }],
      logger: { info: () => undefined, debug: () => undefined, error: () => undefined },
    });
    const res = await request(app).get('/api/v1/x');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBeUndefined();
    expect(h.valkey.calls).toBe(0);
  });
});
