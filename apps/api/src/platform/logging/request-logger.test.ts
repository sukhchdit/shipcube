// Access-log middleware unit tests (US-008 AT-US-008-06; TASK-010): route template derivation, duration from a
// fake monotonic clock, aborted requests, one line per request.
import { EventEmitter } from 'node:events';

import { describe, expect, it } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

import { requestLogger, routePrefix, routeTemplateOf, type AccessLogFields } from './request-logger.js';

function fakeRes(locals: Record<string, unknown> = {}, statusCode = 200): Response & EventEmitter & { writableFinished: boolean } {
  return Object.assign(new EventEmitter(), { locals, statusCode, writableFinished: false }) as unknown as Response &
    EventEmitter & { writableFinished: boolean };
}

const fakeReq = (route?: unknown): Request => ({ method: 'GET', route }) as unknown as Request;
const next: NextFunction = () => undefined;

describe('routeTemplateOf', () => {
  it('prefers the explicit template set by route metadata (TASK-020)', () => {
    expect(routeTemplateOf(fakeReq({ path: '/x' }), fakeRes({ routeTemplate: '/api/v1/x/{id}', routePrefix: '/api/v1' }))).toBe(
      '/api/v1/x/{id}',
    );
  });

  it('joins the recorded mount prefix and the matched route pattern', () => {
    expect(routeTemplateOf(fakeReq({ path: '/shipments/:shipmentId' }), fakeRes({ routePrefix: '/api/v1' }))).toBe(
      '/api/v1/shipments/:shipmentId',
    );
    expect(routeTemplateOf(fakeReq({ path: '/health/live' }), fakeRes())).toBe('/health/live');
  });

  it('is null when no route matched or the route has no string path', () => {
    expect(routeTemplateOf(fakeReq(), fakeRes({ routePrefix: '/api/v1' }))).toBeNull();
    expect(routeTemplateOf(fakeReq({ path: /regex/ }), fakeRes())).toBeNull();
    expect(routeTemplateOf(fakeReq(null), fakeRes())).toBeNull();
  });
});

describe('requestLogger', () => {
  function run(statusCode: number, path = '/things') {
    const logged: [string, AccessLogFields | undefined][] = [];
    const ticks = [1_000_000_000n, 1_012_500_000n];
    const middleware = requestLogger(
      { info: (event, fields) => logged.push([event, fields]), debug: (event, fields) => logged.push([`debug:${event}`, fields]) },
      { now: () => ticks.shift() ?? 0n },
    );
    const res = fakeRes({}, statusCode);
    middleware({ method: 'POST', route: { path } } as unknown as Request, res, next);
    return { logged, res };
  }

  it('[AT-US-008-06] logs once per request with method, route, status and duration in ms', () => {
    const { logged, res } = run(201);
    res.writableFinished = true;
    res.emit('finish');
    res.emit('close');
    expect(logged).toEqual([['http.request', { method: 'POST', route: '/things', status: 201, duration_ms: 12.5 }]]);
  });

  it('marks a request whose connection closed before the response finished', () => {
    const { logged, res } = run(200);
    res.emit('close');
    expect(logged).toEqual([['http.request', { method: 'POST', route: '/things', status: 200, duration_ms: 12.5, aborted: true }]]);
  });

  it('[PR #20 n7] logs health probes at debug, not info', () => {
    const { logged, res } = run(200, '/health/live');
    res.emit('finish');
    expect(logged).toEqual([['debug:http.request', { method: 'POST', route: '/health/live', status: 200, duration_ms: 12.5 }]]);
  });

  it('routePrefix records the mount prefix for the template', () => {
    const res = fakeRes();
    routePrefix('/api/v1')({} as Request, res, next);
    expect(res.locals['routePrefix']).toBe('/api/v1');
  });
});
