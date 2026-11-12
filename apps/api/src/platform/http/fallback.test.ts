import { describe, expect, it } from '@jest/globals';
import express from 'express';

import { allowedMethods } from './fallback.js';
import { declaresBody } from './json-body.js';

/** Pins the router-stack walk against the installed Express 5 / router 2.x internals (see fallback.ts). */
describe('allowedMethods', () => {
  const noop: express.RequestHandler = (_req, res) => {
    res.end();
  };
  const root = express.Router();
  const health = express.Router();
  health.get('/health/live', noop);
  root.use(health);
  const api = express.Router();
  const orders = express.Router();
  orders.get('/orders', noop).post('/orders', noop);
  orders.route('/orders/:orderId').get(noop).patch(noop).delete(noop);
  orders.post('/orders/:orderId/checkout', noop);
  api.use(orders);
  root.use('/api/v1', api);

  it.each([
    ['/health/live', ['GET', 'HEAD']],
    ['/api/v1/orders', ['GET', 'HEAD', 'POST']],
    ['/api/v1/orders/0193', ['GET', 'HEAD', 'PATCH', 'DELETE']],
    ['/api/v1/orders/0193/checkout', ['POST']],
    ['/api/v1/nothing', []],
    ['/health/live/extra', []],
    ['/api/v1', []],
  ])('%s -> %j', (path, expected) => {
    expect(allowedMethods(root, path)).toEqual(expected);
  });

  it('tolerates values that are not routers and an undecodable parameter', () => {
    expect(allowedMethods(undefined, '/x')).toEqual([]);
    expect(allowedMethods({ stack: 'nope' }, '/x')).toEqual([]);
    expect(allowedMethods({ stack: [{}, null] }, '/x')).toEqual([]);
    expect(allowedMethods(root, '/api/v1/orders/%E0%A4%A')).toEqual([]);
  });
});

describe('declaresBody', () => {
  const req = (headers: Record<string, string>) => ({ headers }) as unknown as express.Request;

  it('follows Content-Length and Transfer-Encoding', () => {
    expect(declaresBody(req({}))).toBe(false);
    expect(declaresBody(req({ 'content-length': '0' }))).toBe(false);
    expect(declaresBody(req({ 'content-length': '12' }))).toBe(true);
    expect(declaresBody(req({ 'transfer-encoding': 'chunked' }))).toBe(true);
  });
});
