/**
 * The failed-authentication budget without HTTP (PR041-SEC-02 (b), PR041-SEC-09; ADR-0016 amendment 12 items 3 and 4,
 * amendment 13 items 1 and 3; rulings B1, B2; conditions E2 and E4; TASK-041 part 041-B): what spends, what a request
 * presents, which requests take the credentialed rule, the cookie-route paths and the wrapper's control flow. The HTTP
 * side is authn-failed.api.test.ts.
 */
import { describe, expect, it } from '@jest/globals';
import { AppError } from '@platform/shared';
import type { NextFunction, Request, Response } from 'express';

import { bootFailureOf } from '../routing/pipeline.js';
import type { RouteSlot } from '../routing/slot.js';
import { fixtureRoute } from '../routing/tests/fixture-route.js';
import {
  AUTHN_FAILED_EVENT_CLASS,
  type AuthnFailedBudgetOptions,
  presentsDeclaredCredential,
  SLOT_UNREPORTED_EVENT,
  SLOT_UNREPORTED_INTERVAL_MS,
  SLOT_UNREPORTED_MESSAGE,
  spendsAuthnBudget,
  withAuthnFailedBudget,
} from './authn-failed.js';
import { createRateLimitKit } from './kit.js';
import {
  type RateLimitKit,
  refreshCookieRoutePaths,
  RefreshCookiePathError,
  selectsCredentialedRule,
  type StepZeroOptions,
} from './limits.js';
import { DEFAULT_RATE_LIMIT_SETTINGS } from './tests/settings.js';

describe('[E4] [E2] what spends one unit', () => {
  it.each<[string, unknown, boolean]>([
    ['401 AUTH_REQUIRED (forged, malformed, no usable exp)', new AppError('AUTH_REQUIRED'), true],
    ['401 ACCESS_TOKEN_EXPIRED (the one exemption, by code)', new AppError('ACCESS_TOKEN_EXPIRED'), false],
    ['ACCESS_TOKEN_EXPIRED with another detail', new AppError('ACCESS_TOKEN_EXPIRED', { detail: 'stale' }), false],
    ['401 REAUTH_REQUIRED', new AppError('REAUTH_REQUIRED'), true],
    ['403 AUTHZ_DENIED raised in the slot', new AppError('AUTHZ_DENIED'), true],
    ['a 5xx (a fault of the server, not a refused credential)', new AppError('SERVICE_UNAVAILABLE'), false],
    ['a plain Error', new Error('boom'), false],
    ['a look-alike object with the code', { code: 'AUTH_REQUIRED', status: 401 }, false],
    ['no error', undefined, false],
    ["Express 'route'", 'route', false],
  ])('%s', (_label, error, spends) => {
    expect(spendsAuthnBudget(error)).toBe(spends);
  });
});

describe('[D-ARCH-109] a credential spends only when the route declares its kind', () => {
  it.each<[string, readonly string[], Record<string, string>, boolean]>([
    ['bearer on [session]', ['session'], { authorization: 'Bearer x' }, true],
    ['bearer on [anonymous]', ['anonymous'], { authorization: 'Bearer x' }, false],
    ['refresh cookie on [refresh-cookie]', ['refresh-cookie'], { cookie: '__Host-rt_web=x' }, true],
    ['refresh cookie on [session]', ['session'], { cookie: '__Host-rt_web=x' }, false],
    ['quote token on [session, quote-token]', ['session', 'quote-token'], { 'x-quote-token': 'q' }, true],
    ['signature on [signature]', ['signature'], { 'stripe-signature': 't=1,v1=x' }, true],
    ['blank signature on [signature]', ['signature'], { 'x-carrier-signature': '  ' }, false],
    ['signature on [session]', ['session'], { 'x-mock-signature': 'x' }, false],
    ['nothing on [session]', ['session'], {}, false],
  ])('%s', (_label, auth, headers, presents) => {
    expect(presentsDeclaredCredential(auth, headers)).toBe(presents);
  });
});

describe('[A1] [B1 R1] [B2] the step-0 selector', () => {
  const options: StepZeroOptions = { apiPrefix: '/api/v1', refreshCookiePaths: new Set(['/api/v1/auth/refresh', '/api/v1/auth/csrf']) };
  const takes = (method: string, path: string, headers: Record<string, string | string[]>) =>
    selectsCredentialedRule({ method, path, headers }, options);

  it.each<[string, string, string, Record<string, string | string[]>, boolean]>([
    ['bearer under the prefix', 'GET', '/api/v1/me', { authorization: 'Bearer x' }, true],
    ['quote token under the prefix', 'GET', '/api/v1/quotes/1', { 'x-quote-token': 'q' }, true],
    ['[B2] Stripe-Signature', 'POST', '/api/v1/webhooks/stripe', { 'stripe-signature': 't=1' }, true],
    ['[B2] X-Mock-Signature', 'POST', '/api/v1/webhooks/mock', { 'x-mock-signature': 'x' }, true],
    ['[B2] X-Carrier-Signature as a list', 'POST', '/api/v1/webhooks/dhl', { 'x-carrier-signature': ['', 'x'] }, true],
    ['[B2] a blank signature', 'POST', '/api/v1/webhooks/mock', { 'x-mock-signature': ' ' }, false],
    ['[R1] the cookie on the refresh route', 'POST', '/api/v1/auth/refresh', { cookie: 'a=b; __Host-rt_web=x' }, true],
    ['[R1] the admin cookie on the CSRF route', 'GET', '/api/v1/auth/csrf', { cookie: '__Host-rt_admin=x' }, true],
    ['[R1] the cookie on sign-in', 'POST', '/api/v1/auth/login', { cookie: '__Host-rt_web=x' }, false],
    ['[R1] the cookie on a public read', 'GET', '/api/v1/reference/countries', { cookie: '__Host-rt_web=x' }, false],
    ['[R1] the cookie on another spelling of a cookie route', 'POST', '/api/v1/auth/refresh/', { cookie: '__Host-rt_web=x' }, false],
    ['[R1] the cookie on an upper-case spelling', 'POST', '/api/v1/AUTH/REFRESH', { cookie: '__Host-rt_web=x' }, false],
    ['another cookie on the refresh route', 'POST', '/api/v1/auth/refresh', { cookie: 'rt_web=x' }, false],
    ['OPTIONS with a bearer', 'OPTIONS', '/api/v1/me', { authorization: 'Bearer x' }, false],
    ['outside the prefix with a signature', 'POST', '/webhooks/mock', { 'x-mock-signature': 'x' }, false],
    ['no credential', 'GET', '/api/v1/me', {}, false],
  ])('%s', (_label, method, path, headers, credentialed) => {
    expect(takes(method, path, headers)).toBe(credentialed);
  });
});

describe('[ADR-0016 am. 13 item 1] the refresh-cookie route paths', () => {
  const handler = () => ({ status: 200 as const });
  it('are the exact full paths of the module routes that declare refresh-cookie', () => {
    const routes = [
      fixtureRoute({ operationId: 'getCsrfToken', path: '/auth/csrf', auth: 'refresh-cookie', handler }),
      fixtureRoute({ operationId: 'refreshSession', method: 'post', path: '/auth/refresh', auth: 'refresh-cookie', csrf: true, handler }),
      fixtureRoute({ operationId: 'getProfile', path: '/me', auth: 'session', handler }),
      fixtureRoute({ operationId: 'login', method: 'post', path: '/auth/login', handler }),
    ];
    expect([...refreshCookieRoutePaths(routes, '/api/v1')]).toEqual(['/api/v1/auth/csrf', '/api/v1/auth/refresh']);
  });

  it.each(['/auth/refresh*rest', '/auth/{x}', '/auth/refresh/'])('[B1 (13)] refuse the non-literal path %s, with a boot line', (path) => {
    const route = { ...fixtureRoute({ operationId: 'refreshSession', path: '/auth/refresh', auth: 'refresh-cookie', handler }), path };
    let thrown: unknown;
    try {
      refreshCookieRoutePaths([route], '/api/v1');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RefreshCookiePathError);
    expect(bootFailureOf(thrown)).toEqual({
      event: 'api.refresh_cookie_route_refused',
      fields: { error: 'RefreshCookiePathError', operation: 'refreshSession', path },
    });
  });
});

describe('[B1] the wrapper around the authentication slot', () => {
  const route = fixtureRoute({ operationId: 'getProfile', path: '/me', auth: 'session', handler: () => ({ status: 200 }) });
  const request = (headers: Record<string, string> = { authorization: 'Bearer junk' }) =>
    ({ headers, ip: '203.0.113.7' }) as unknown as Request;
  const response = {} as Response;

  function kit() {
    const events: [string, Readonly<Record<string, unknown>>][] = [];
    const composed = createRateLimitKit(
      { settings: { ...DEFAULT_RATE_LIMIT_SETTINGS, RATE_LIMIT_PUBLIC_PER_MIN: 2 } },
      { emit: (event, fields) => void events.push([event, fields ?? {}]) },
    );
    // These slots all report an outcome: the error line of C-4 is never written (its rows are in the next block).
    const options: AuthnFailedBudgetOptions = { log: { error: () => undefined } };
    return { composed, events, options };
  }

  /** Runs the wrapped slot once and resolves with what it passed on. */
  const run = (slot: RouteSlot, k: ReturnType<typeof kit>, req = request(), res = response) =>
    new Promise<unknown>((resolve) => {
      withAuthnFailedBudget(slot, k.composed, k.options)(route)(req, res, ((error?: unknown) => resolve(error)) as NextFunction);
    });

  const refusing: RouteSlot = () => (_req, _res, next) => next(new AppError('AUTH_REQUIRED'));

  it('passes the refusal on unchanged after the spend; the spend that reaches the limit emits the event once', async () => {
    const k = kit();
    const first = await run(refusing, k);
    expect(first).toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(k.events).toEqual([]);
    await run(refusing, k);
    expect(k.events).toEqual([['rate_limit_auth', { class: AUTHN_FAILED_EVENT_CLASS, key_type: 'ip' }]]);
    await run(refusing, k);
    expect(k.events).toHaveLength(1);
  });

  it('a synchronous throw and a rejected promise of the slot are refusals too, and are passed on once', async () => {
    const k = kit();
    const throwing: RouteSlot = () => () => {
      throw new AppError('AUTH_REQUIRED');
    };
    const rejecting: RouteSlot = () => () => Promise.reject(new AppError('AUTH_REQUIRED'));
    expect(await run(throwing, k)).toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(await run(rejecting, k)).toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(k.events).toHaveLength(1);
    let passed = 0;
    const twice: RouteSlot = () => (_req, _res, next) => {
      next(new AppError('AUTH_REQUIRED'));
      next(new AppError('AUTH_REQUIRED'));
    };
    await new Promise<void>((resolve) => {
      withAuthnFailedBudget(twice, k.composed, k.options)(route)(request(), response, (() => {
        passed += 1;
        resolve();
      }) as NextFunction);
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(passed).toBe(1);
  });

  it('[R1-m1] a promise rejected with a falsy value, and a falsy throw, are passed on as errors and spend nothing', async () => {
    const k = kit();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- TASK-041 the falsy rejection under test (R1-m1)
    const rejectsUndefined: RouteSlot = () => () => Promise.reject(undefined);
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- TASK-041 the falsy rejection under test (R1-m1)
    const rejectsFalse: RouteSlot = () => () => Promise.reject(false);
    const throwsUndefined: RouteSlot = () => () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TASK-041 the falsy throw under test (R1-m1)
      throw undefined;
    };
    const passed = [await run(rejectsUndefined, k), await run(rejectsFalse, k), await run(throwsUndefined, k)];
    expect(passed.map((error) => (error instanceof Error ? error.message : error))).toEqual([
      'Rejected promise',
      'Rejected promise',
      'Thrown falsy value',
    ]);
    // None is a refused credential (no AppError): nothing was spent, so the limit of 2 is still two refusals away.
    await run(refusing, k);
    expect(k.events).toEqual([]);
    await run(refusing, k);
    expect(k.events).toHaveLength(1);
  });

  it('[R1-M1] the in-flight unit of the request is released when the outcome is known: at once, or after the spend has landed', async () => {
    const k = kit();
    const ip = '203.0.113.7';
    const heldDuringSpend: number[] = [];
    const observed = {
      ...k.composed,
      limiter: {
        ...k.composed.limiter,
        spend: (...args: Parameters<typeof k.composed.limiter.spend>) => {
          heldDuringSpend.push(k.composed.inFlight.held(ip));
          return k.composed.limiter.spend(...args);
        },
      },
    };
    const accepting: RouteSlot = () => (_req, _res, next) => next();
    const heldAtNext: number[] = [];
    for (const slot of [accepting, refusing]) {
      const holder = {} as Response;
      expect(k.composed.inFlight.admit(ip, 0, 2, holder)).toBe(true);
      await new Promise<void>((resolve) => {
        withAuthnFailedBudget(slot, observed, k.options)(route)(request(), holder, (() => {
          heldAtNext.push(k.composed.inFlight.held(ip));
          resolve();
        }) as NextFunction);
      });
    }
    expect(heldAtNext).toEqual([0, 0]);
    // The refusal's unit was still held while its spend was issued: no step-0 reading in between can miss it.
    expect(heldDuringSpend).toEqual([1]);
  });

  it('[R2-M1] [D-ARCH-226] the unit is entered before the slot is called, so a close while the slot runs does not free it', async () => {
    const k = kit();
    const ip = '203.0.113.7';
    const holder = {} as Response;
    expect(k.composed.inFlight.admit(ip, 0, 2, holder)).toBe(true);
    let heldAfterClose = -1;
    const leaving: RouteSlot = () => (_req, res, next) => {
      // The client disconnects while the authentication runs: step 0's close handler fires.
      k.composed.inFlight.releaseUnentered(res);
      heldAfterClose = k.composed.inFlight.held(ip);
      next(new AppError('AUTH_REQUIRED'));
    };
    expect(await run(leaving, k, request(), holder)).toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(heldAfterClose).toBe(1);
    expect(k.composed.inFlight.held(ip)).toBe(0);
  });

  it('[D-TASK041-20] a request whose unit the close released before the slot is not authenticated and goes no further', async () => {
    const k = kit();
    const gone = {} as Response;
    expect(k.composed.inFlight.admit('203.0.113.7', 0, 2, gone)).toBe(true);
    k.composed.inFlight.releaseUnentered(gone);
    let entered = 0;
    let passed = 0;
    const counting: RouteSlot = () => (_req, _res, next) => {
      entered += 1;
      next();
    };
    withAuthnFailedBudget(counting, k.composed, k.options)(route)(request(), gone, (() => {
      passed += 1;
    }) as NextFunction);
    await new Promise((resolve) => setImmediate(resolve));
    expect([entered, passed]).toEqual([0, 0]);
    // A request step 0 did not hold for is authenticated as before.
    expect(await run(counting, k)).toBeUndefined();
    expect(entered).toBe(1);
  });

  it('an accepted request, a refusal without a declared credential and a server fault spend nothing', async () => {
    const k = kit();
    const accepting: RouteSlot = () => (_req, _res, next) => next();
    const faulting: RouteSlot = () => (_req, _res, next) => next(new AppError('SERVICE_UNAVAILABLE'));
    expect(await run(accepting, k)).toBeUndefined();
    expect(await run(refusing, k, request({}))).toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(await run(faulting, k)).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(await run(refusing, k)).toMatchObject({ code: 'AUTH_REQUIRED' });
    // Only the last request spent: the limit of 2 is not reached yet.
    expect(k.events).toEqual([]);
  });
});

describe('[C-4] [D-ARCH-230] a slot that ends without an outcome is ended by the wrapper (ADR-0016 am. 13 item 6, Release)', () => {
  const IP = '203.0.113.7';
  const route = fixtureRoute({ operationId: 'getProfile', path: '/me', auth: 'session', handler: () => ({ status: 200 }) });
  const request = () => ({ headers: { authorization: 'Bearer junk' }, ip: IP }) as unknown as Request;
  const later = () => new Promise((resolve) => setTimeout(resolve, 1));
  /** Lets every pending callback and spend land. */
  const drained = () => new Promise((resolve) => setTimeout(resolve, 5));
  /** What a slot that answers the client itself leaves on the response: the wrapper reads `headersSent` and the status. */
  const answer = (res: Response, status: number): void => void Object.assign(res, { headersSent: true, statusCode: status });

  /** A kit with every release of a unit and every spend recorded, and the error lines of the wrapper. */
  function observed() {
    const lines: [string, Readonly<Record<string, unknown>>][] = [];
    const clock = { now: 0 };
    const options: AuthnFailedBudgetOptions = {
      log: { error: (event, fields) => void lines.push([event, fields ?? {}]) },
      now: () => clock.now,
    };
    const base = createRateLimitKit(
      { settings: { ...DEFAULT_RATE_LIMIT_SETTINGS, RATE_LIMIT_PUBLIC_PER_MIN: 100 } },
      { emit: () => undefined },
    );
    const releases: object[] = [];
    let spends = 0;
    const composed: RateLimitKit = {
      ...base,
      inFlight: {
        ...base.inFlight,
        release: (holder) => {
          releases.push(holder);
          base.inFlight.release(holder);
        },
      },
      limiter: {
        ...base.limiter,
        spend: (...args: Parameters<RateLimitKit['limiter']['spend']>) => {
          spends += 1;
          return base.limiter.spend(...args);
        },
      },
    };
    // One wrapper per slot, as createApp composes one per app: the once-a-minute rule of the error line lives in it.
    const wrappers = new Map<RouteSlot, RouteSlot>();
    const wrapped = (slot: RouteSlot): RouteSlot => {
      const existing = wrappers.get(slot);
      if (existing !== undefined) return existing;
      const created = withAuthnFailedBudget(slot, composed, options);
      wrappers.set(slot, created);
      return created;
    };
    /** Admits a fresh holder, enters the wrapped slot once and records every value passed on. */
    const enter = (slot: RouteSlot, of = route) => {
      const res = {} as Response;
      expect(base.inFlight.admit(IP, 0, 100, res)).toBe(true);
      const passed: unknown[] = [];
      wrapped(slot)(of)(request(), res, ((error?: unknown) => void passed.push(error)) as NextFunction);
      return { res, passed, released: () => releases.filter((holder) => holder === res).length };
    };
    return { lines, clock, enter, spends: () => spends, held: () => base.inFlight.held(IP) };
  }

  it('[H10] a conforming slot writes no error line and releases its unit exactly once', async () => {
    const o = observed();
    const conforming: Readonly<Record<string, RouteSlot>> = {
      accepts: () => (_req, _res, next) => next(),
      'accepts (async)': () => async (_req, _res, next) => {
        await later();
        next();
      },
      refuses: () => (_req, _res, next) => next(new AppError('AUTH_REQUIRED')),
      'refuses (async)': () => async (_req, _res, next) => {
        await later();
        next(new AppError('AUTH_REQUIRED'));
      },
      'expired token': () => (_req, _res, next) => next(new AppError('ACCESS_TOKEN_EXPIRED')),
      throws: () => () => {
        throw new AppError('AUTH_REQUIRED');
      },
      rejects: () => async () => {
        await later();
        throw new AppError('AUTH_REQUIRED');
      },
      'reports twice': () => (_req, _res, next) => {
        next();
        next(new AppError('AUTH_REQUIRED'));
      },
      'reports from a callback': () => (_req, _res, next) => {
        setTimeout(() => next(new AppError('AUTH_REQUIRED')), 1);
      },
    };
    for (const [shape, slot] of Object.entries(conforming)) {
      const entered = o.enter(slot);
      await drained();
      expect({ shape, passed: entered.passed.length, released: entered.released() }).toEqual({ shape, passed: 1, released: 1 });
    }
    expect(o.held()).toBe(0);
    expect(o.lines).toEqual([]);
    // The refusals that present a declared credential spent (refuses, refuses async, throws, rejects, the callback).
    expect(o.spends()).toBe(5);
  });

  it.each(['plain', 'async'] as const)(
    '[H7] a %s slot that answered the client itself and reports nothing: the unit is released, nothing is spent, nothing more is called',
    async (shape) => {
      const o = observed();
      const answers: RouteSlot =
        shape === 'plain'
          ? () => (_req, res) => answer(res, 401)
          : () => async (_req, res) => {
              await later();
              answer(res, 401);
            };
      const first = o.enter(answers);
      const second = o.enter(answers);
      await drained();
      expect([first.passed, second.passed, first.released(), second.released()]).toEqual([[], [], 1, 1]);
      expect([o.held(), o.spends()]).toEqual([0, 0]);
      // Once a minute per operation: the second slot of the same minute writes no second line.
      expect(o.lines).toEqual([[SLOT_UNREPORTED_EVENT, { operation_id: 'getProfile', status: 401 }]]);
    },
  );

  it('[H8] an async slot that ends without reporting or answering is ended with an error (the 500 path): no spend, the unit released once', async () => {
    const o = observed();
    const silent: RouteSlot = () => async () => {
      await later();
    };
    const entered = o.enter(silent);
    await drained();
    expect(entered.passed.map((error) => (error as Error).message)).toEqual([SLOT_UNREPORTED_MESSAGE]);
    // Not an AppError: the problem handler answers it 500 INTERNAL_ERROR, and it is no refused credential.
    expect(spendsAuthnBudget(entered.passed[0])).toBe(false);
    expect([entered.released(), o.held(), o.spends()]).toEqual([1, 0, 0]);
    expect(o.lines).toEqual([[SLOT_UNREPORTED_EVENT, { operation_id: 'getProfile' }]]);
  });

  it('[C-4] a report that arrives after an async slot fulfilled is outside the contract and is dropped: the request was answered 500', async () => {
    const o = observed();
    const reportsLate: RouteSlot = () => async (_req, _res, next) => {
      await later();
      setTimeout(() => next(new AppError('AUTH_REQUIRED')), 1);
    };
    const entered = o.enter(reportsLate);
    await drained();
    await drained();
    expect(entered.passed.map((error) => (error as Error).message)).toEqual([SLOT_UNREPORTED_MESSAGE]);
    expect([entered.released(), o.spends()]).toEqual([1, 0]);
  });

  it('[C-4] a plain slot that returns without an outcome and answered nothing is waited for: it reports from a callback', async () => {
    const o = observed();
    const reports: NextFunction[] = [];
    const deferred: RouteSlot = () => (_req, _res, next) => void reports.push(next);
    const entered = o.enter(deferred);
    await drained();
    expect([entered.passed.length, entered.released(), o.held()]).toEqual([0, 0, 1]);
    for (const report of reports) report(new AppError('AUTH_REQUIRED'));
    await drained();
    expect(entered.passed).toEqual([expect.objectContaining({ code: 'AUTH_REQUIRED' })]);
    expect([entered.released(), o.held(), o.spends()]).toEqual([1, 0, 1]);
    expect(o.lines).toEqual([]);
  });

  it('[C-4] the error line is written at most once a minute per operation and instance, with no request data', async () => {
    const o = observed();
    const silent: RouteSlot = () => async () => {
      await later();
    };
    const other = fixtureRoute({ operationId: 'listAddresses', path: '/addresses', auth: 'session', handler: () => ({ status: 200 }) });
    for (const [at, of] of [
      [0, route],
      [1_000, route],
      [SLOT_UNREPORTED_INTERVAL_MS - 1, route],
      [SLOT_UNREPORTED_INTERVAL_MS - 1, other],
      [SLOT_UNREPORTED_INTERVAL_MS, route],
    ] as const) {
      o.clock.now = at;
      o.enter(silent, of);
      await drained();
    }
    expect(o.lines).toEqual([
      [SLOT_UNREPORTED_EVENT, { operation_id: 'getProfile' }],
      [SLOT_UNREPORTED_EVENT, { operation_id: 'listAddresses' }],
      [SLOT_UNREPORTED_EVENT, { operation_id: 'getProfile' }],
    ]);
    expect(o.held()).toBe(0);
  });
});
