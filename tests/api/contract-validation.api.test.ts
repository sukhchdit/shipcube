// US-034 contract-first pipeline: the Supertest response validator (AT-US-034-04, AT-US-034-05; REQ-API-004,
// ADR-0016 §1, api/README.md §16). Runs the real createApp with the real health router or stub routers; no database.
import { describe, expect, it } from '@jest/globals';
import express, { type Router } from 'express';
import request from 'supertest';

import { createApp } from '../../apps/api/src/app.js';
import { GENERIC_SERVER_DETAIL } from '../../apps/api/src/platform/errors/problem.js';
import { createHealthRouter } from '../../apps/api/src/platform/health/router.js';
import {
  createReadinessProbe,
  READINESS_COMPONENTS,
  type ReadinessCheck,
  type ReadinessComponent,
} from '../../apps/api/src/platform/runtime/readiness.js';
import type { ResponseUnderTest } from './helpers/contract-validator.js';
import { api, contractValidator, expectContract } from './helpers/expect-contract.js';

const silent = { info: () => undefined, error: () => undefined };
const appWith = (healthRouter: Router, modules: { name: string; router: Router }[] = []) =>
  createApp({ healthRouter, modules, logger: silent });

const CRITICAL: readonly ReadinessComponent[] = ['database', 'redis', 'object_storage'];
const checks = (failing: readonly ReadinessComponent[] = []): ReadinessCheck[] =>
  READINESS_COMPONENTS.map((name) => ({
    name,
    critical: CRITICAL.includes(name),
    check: () => (failing.includes(name) ? Promise.reject(new Error('down')) : Promise.resolve()),
  }));
const healthApp = (failing: readonly ReadinessComponent[] = []) =>
  appWith(createHealthRouter({ probe: createReadinessProbe(checks(failing), { cacheTtlMs: 0 }) }));

const CORRELATION_ID = 'c0ffee00-1234-4abc-9def-001122334455';
const problem = (code: string, status: number, extra: Record<string, unknown> = {}) => ({
  type: `https://docs.platform.invalid/problems/${code}`,
  title: 'Title',
  status,
  detail: 'Detail.',
  instance: '/api/v1/shipments/0193a5b2-7c1e-7d4a-9f3b-000000000f01',
  code,
  correlation_id: CORRELATION_ID,
  ...extra,
});
const response = (overrides: Partial<ResponseUnderTest>): ResponseUnderTest => ({
  method: 'GET',
  path: '/api/v1/shipments/0193a5b2-7c1e-7d4a-9f3b-000000000f01',
  status: 404,
  headers: { 'content-type': 'application/problem+json; charset=utf-8', 'x-correlation-id': CORRELATION_ID },
  body: problem('NOT_FOUND', 404),
  ...overrides,
});

describe('US-034 response validation helper', () => {
  it('[AT-US-034-04] a response deviating from the contract fails the test', async () => {
    const health = express.Router();
    health.get('/health/live', (_req, res) => {
      res.status(201).json({ status: 'ok', extra: true });
    });
    const client = await api(appWith(health));
    const failure = client.get('/health/live');
    await expect(failure).rejects.toThrow(/getLiveness GET \/health\/live -> 201/);
    await expect(client.get('/health/live')).rejects.toThrow(
      /\/status: status 201 is not declared for getLiveness \(declared: 200, 500, 503\)/,
    );
  });

  it('[AT-US-034-04] an extra member in a declared 200 body is reported with its JSON pointer', async () => {
    const health = express.Router();
    health.get('/health/live', (_req, res) => {
      res.json({ status: 'ok', extra: true });
    });
    const client = await api(appWith(health));
    await expect(client.get('/health/live')).rejects.toThrow(/\/body: must NOT have additional properties \(additional property "extra"\)/);
  });

  it('[AT-US-034-05] a 404 problem body lacking "code" fails the helper', async () => {
    const shipments = express.Router();
    shipments.get('/shipments/:shipmentId', (_req, res) => {
      const body = Object.fromEntries(Object.entries(problem('NOT_FOUND', 404)).filter(([key]) => key !== 'code'));
      res.status(404).type('application/problem+json').send(JSON.stringify(body));
    });
    const client = await api(appWith(express.Router(), [{ name: 'shipments', router: shipments }]));
    const pending = client.get('/api/v1/shipments/0193a5b2-7c1e-7d4a-9f3b-000000000f01');
    await expect(pending).rejects.toThrow(/getShipment GET \/api\/v1\/shipments\/0193a5b2-7c1e-7d4a-9f3b-000000000f01 -> 404/);
    const validator = await contractValidator();
    const deviations = validator.validateResponse(response({ body: problem('NOT_FOUND', 404, { code: undefined }) }));
    expect(deviations).toEqual(
      expect.arrayContaining(["/body: must have required property 'code'", '/body/code: a problem body must carry its catalogue code']),
    );
  });

  it('the real liveness route and the ok / degraded / unavailable readiness variants conform', async () => {
    const client = await api(healthApp());
    await client.get('/health/live').expect(200, { status: 'ok' });
    await client
      .get('/health/ready')
      .expect(200)
      .expect((res) => expect(res.body).toMatchObject({ status: 'ok' }));
    const degraded = await api(healthApp(['audit_chain']));
    await degraded
      .get('/health/ready')
      .expect(200)
      .expect((res) => expect(res.body).toMatchObject({ status: 'degraded' }));
    const notReady = await api(healthApp(['database']));
    await notReady
      .get('/health/ready')
      .expect(503)
      .expect((res) => expect(res.body).toMatchObject({ status: 'unavailable' }));
  });

  it('framework errors conform: unknown route 404 NOT_FOUND and wrong method 405 with Allow', async () => {
    const client = await api(healthApp());
    await client.get('/api/v1/does-not-exist?token=abc').expect(404);
    await client.post('/health/live').expect(405).expect('Allow', /GET/);
    await expectContract(await request(healthApp()).get('/does-not-exist'));
  });

  it('checks problem codes, catalogue status, type, 5xx detail, media type and the correlation header', async () => {
    const validator = await contractValidator();
    expect(validator.genericServerDetail).toBe(GENERIC_SERVER_DETAIL);
    expect(validator.validateResponse(response({}))).toEqual([]);
    expect(validator.validateResponse(response({ status: 403, body: problem('SHIPMENT_NOT_FOUND_X', 403) }))).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\/body\/code: "SHIPMENT_NOT_FOUND_X" is not in x-error-codes/),
        '/body/code: "SHIPMENT_NOT_FOUND_X" is not in the error catalogue',
      ]),
    );
    expect(validator.validateResponse(response({ body: problem('NOT_FOUND', 404, { status: 410 }) }))).toEqual(
      expect.arrayContaining(['/body/status: 410 differs from the catalogue status 404 of NOT_FOUND']),
    );
    expect(
      validator.validateResponse(response({ body: problem('NOT_FOUND', 404, { type: 'https://docs.platform.invalid/problems/GONE' }) })),
    ).toEqual(['/body/type: must end with "/problems/NOT_FOUND"']);
    expect(
      validator.validateResponse(response({ status: 500, body: problem('INTERNAL_ERROR', 500, { detail: 'boom at /srv/app' }) })),
    ).toEqual([`/body/detail: a 5xx detail must be "${GENERIC_SERVER_DETAIL}"`]);
    expect(validator.validateResponse(response({ headers: { 'content-type': 'application/json', 'x-correlation-id': 'short' } }))).toEqual([
      '/headers/x-correlation-id: "short" does not match ^[A-Za-z0-9-]{8,64}$',
      '/headers/content-type: "application/json" is not declared for 404 (declared: application/problem+json)',
    ]);
    expect(validator.validateResponse(response({ method: 'PATCH', path: '/nowhere', body: problem('NOT_FOUND', 404) }))).toEqual([]);
    expect(validator.validateResponse(response({ method: 'TRACE', status: 404 }))).toEqual([
      '/status: no TRACE operation for this path; expected 405 METHOD_NOT_ALLOWED, got 404',
    ]);
  });

  it('204/304 must not carry a body; the failure excerpt is redacted and capped at 500 characters', async () => {
    const validator = await contractValidator();
    const withBody = response({ method: 'DELETE', status: 204, headers: { 'x-correlation-id': CORRELATION_ID }, body: {}, text: 'x' });
    const op = validator.operations.find(
      (candidate) => candidate.method === 'DELETE' && Object.hasOwn(candidate.operation.responses ?? {}, '204'),
    );
    expect(op).toBeDefined();
    const path = (op?.fullPath ?? '').replaceAll(/\{[^}]+\}/g, 'p-1');
    expect(validator.validateResponse({ ...withBody, path })).toEqual([
      `/body: status 204 of ${op?.operationId ?? ''} declares no body, but one was sent`,
    ]);
    expect(validator.validateResponse({ ...withBody, path, text: '' })).toEqual([]);

    const sentinel = `sentinel-${String(Date.now())}`;
    const leaky = response({
      body: { access_token: sentinel, nested: { Authorization: sentinel, refreshCookie: sentinel }, filler: 'f'.repeat(900) },
    });
    const message = validator.describeFailure(leaky, validator.validateResponse(leaky));
    expect(message).not.toContain(sentinel);
    expect(message).toContain('"access_token":"[REDACTED]"');
    const excerpt = /Body excerpt \(redacted\): (.*)$/s.exec(message)?.[1] ?? '';
    expect(excerpt.length).toBeLessThanOrEqual(501);
  });

  it('every response schema of the contract compiles under Ajv strict mode', async () => {
    const validator = await contractValidator();
    expect(validator.operations).toHaveLength(133);
    expect(validator.compileAll()).toBeGreaterThan(133);
  });
});
