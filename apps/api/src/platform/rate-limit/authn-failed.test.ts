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
import { AUTHN_FAILED_EVENT_CLASS, presentsDeclaredCredential, spendsAuthnBudget, withAuthnFailedBudget } from './authn-failed.js';
import { createRateLimitKit } from './kit.js';
import { refreshCookieRoutePaths, RefreshCookiePathError, selectsCredentialedRule, type StepZeroOptions } from './limits.js';
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
    return { composed, events };
  }

  /** Runs the wrapped slot once and resolves with what it passed on. */
  const run = (slot: RouteSlot, k: ReturnType<typeof kit>, req = request()) =>
    new Promise<unknown>((resolve) => {
      withAuthnFailedBudget(slot, k.composed)(route)(req, response, ((error?: unknown) => resolve(error)) as NextFunction);
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
      withAuthnFailedBudget(twice, k.composed)(route)(request(), response, (() => {
        passed += 1;
        resolve();
      }) as NextFunction);
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(passed).toBe(1);
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
