// US-034 contract-first pipeline: the Supertest response validator (AT-US-034-04, AT-US-034-05; REQ-API-004,
// ADR-0016 §1, api/README.md §16). Runs the real createApp with the real health routes or defineRoute fixtures; no database.
import { describe, expect, it } from '@jest/globals';
import Joi from 'joi';

import { createApp, type ModuleRegistration } from '../../apps/api/src/app.js';
import { GENERIC_SERVER_DETAIL } from '../../apps/api/src/platform/errors/problem.js';
import { healthRoutes } from '../../apps/api/src/platform/health/router.js';
import type { RouteDescriptor } from '../../apps/api/src/platform/routing/define-route.js';
import { fixtureRoute } from '../../apps/api/src/platform/routing/tests/fixture-route.js';
import {
  createReadinessProbe,
  isCriticalComponent,
  READINESS_COMPONENTS,
  type ReadinessCheck,
  type ReadinessComponent,
} from '../../apps/api/src/platform/runtime/readiness.js';
import type { OpenApiDocument } from '../../tools/openapi/contract.js';
import { createContractValidator, type ResponseUnderTest } from './helpers/contract-validator.js';
import { api, contractValidator, expectContract } from './helpers/expect-contract.js';

const silent = { info: () => undefined, error: () => undefined };
const appWith = (health: readonly RouteDescriptor[], modules: ModuleRegistration[] = []) => createApp({ health, modules, logger: silent });

/** Every component passes, except `failing` (rejects) and `late` (resolves 'degraded', a degradable outcome). */
const checks = (failing: readonly ReadinessComponent[] = [], late: readonly ReadinessComponent[] = []): ReadinessCheck[] =>
  READINESS_COMPONENTS.map((name) => ({
    name,
    critical: isCriticalComponent(name),
    check: () =>
      failing.includes(name) ? Promise.reject(new Error('down')) : Promise.resolve(late.includes(name) ? 'degraded' : undefined),
  }));
const healthApp = (failing: readonly ReadinessComponent[] = [], late: readonly ReadinessComponent[] = []) =>
  appWith(healthRoutes({ probe: createReadinessProbe(checks(failing, late), { cacheTtlMs: 0 }) }));

const CORRELATION_ID = 'c0ffee00-1234-4abc-9def-001122334455';
/** SEC-TC-29: authenticated operations (getShipment, the DELETE below) answer with private, no-store. */
const PRIVATE = { 'cache-control': 'private, no-store' };
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
  headers: { 'content-type': 'application/problem+json; charset=utf-8', 'x-correlation-id': CORRELATION_ID, ...PRIVATE },
  body: problem('NOT_FOUND', 404),
  ...overrides,
});

describe('US-034 response validation helper', () => {
  it('[AT-US-034-04] a response deviating from the contract fails the test', async () => {
    const health = [
      fixtureRoute({
        operationId: 'getLiveness',
        path: '/health/live',
        handler: () => ({ status: 201, body: { status: 'ok', extra: true } }),
      }),
    ];
    const client = await api(appWith(health));
    const failure = client.get('/health/live');
    await expect(failure).rejects.toThrow(/getLiveness GET \/health\/live -> 201/);
    await expect(client.get('/health/live')).rejects.toThrow(
      /\/status: status 201 is not declared for getLiveness \(declared: 200, 500, 503\)/,
    );
  });

  it('[AT-US-034-04] an extra member in a declared 200 body is reported with its JSON pointer', async () => {
    const health = [
      fixtureRoute({
        operationId: 'getLiveness',
        path: '/health/live',
        handler: () => ({ status: 200, body: { status: 'ok', extra: true } }),
      }),
    ];
    const client = await api(appWith(health));
    await expect(client.get('/health/live')).rejects.toThrow(/\/body: must NOT have additional properties \(additional property "extra"\)/);
  });

  it('[AT-US-034-05] a 404 problem body lacking "code" fails the helper', async () => {
    const shipments = fixtureRoute({
      operationId: 'getShipment',
      path: '/shipments/:shipmentId',
      schema: { params: Joi.object({ shipmentId: Joi.string() }) },
      handler: () => ({
        status: 404,
        body: Object.fromEntries(Object.entries(problem('NOT_FOUND', 404)).filter(([key]) => key !== 'code')),
        headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': 'private, no-store' },
      }),
    });
    const client = await api(appWith([], [{ name: 'shipments', routes: [shipments] }]));
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

  it('[D-ARCH-081] the three audit_partitions states conform: unavailable (503) and degraded (200)', async () => {
    const missingMonth = await api(healthApp(['audit_partitions']));
    await missingMonth
      .get('/health/ready')
      .expect(503)
      .expect((res) =>
        expect(res.body).toMatchObject({ status: 'unavailable', components: { audit_partitions: 'unavailable', database: 'ok' } }),
      );
    const lateMonth = await api(healthApp([], ['audit_partitions']));
    await lateMonth
      .get('/health/ready')
      .expect(200)
      .expect((res) => expect(res.body).toMatchObject({ status: 'degraded', components: { audit_partitions: 'degraded' } }));
  });

  it('[SEC-TC-29] an authenticated operation answers with Cache-Control: private, no-store, checked by the shared helper', async () => {
    // getShipment declared as the session-authenticated route it is; the authn slot answers 401 AUTH_REQUIRED until
    // TASK-052, and the helper validates the response against the contract including the SEC-TC-29 cache check.
    const getShipment = fixtureRoute({
      operationId: 'getShipment',
      path: '/shipments/:shipmentId',
      permission: 'shipment:read',
      permissionJustification: undefined,
      tenancy: 'tenant',
      auth: 'session',
      transaction: 'tenant',
      schema: { params: Joi.object({ shipmentId: Joi.string().guid().required() }) },
      handler: () => ({ status: 200, body: {} }),
    } as Parameters<typeof fixtureRoute>[0]);
    const client = await api(appWith([], [{ name: 'shipments', routes: [getShipment] }]));
    const response = await client.get('/api/v1/shipments/0193a5b2-7c1e-7d4a-9f3b-000000000f01').expect(401);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect((response.body as { code?: string }).code).toBe('AUTH_REQUIRED');
  });

  it('framework errors conform: unknown route 404 NOT_FOUND and wrong method 405 with Allow', async () => {
    const client = await api(healthApp());
    await client.get('/api/v1/does-not-exist?token=abc').expect(404);
    await client.post('/health/live').expect(405).expect('Allow', 'GET, HEAD, OPTIONS');
    // expectContract re-validates a response the test already holds (here one the agent has validated once).
    await expectContract(await client.get('/does-not-exist'));
  });

  it('[PR #21 R1-m3] OPTIONS on a known path is 204 with Allow including OPTIONS, through the helper; a 405 Allow must list OPTIONS', async () => {
    const client = await api(healthApp());
    await client.options('/health/live').expect(204).expect('Allow', 'GET, HEAD, OPTIONS');
    await client.options('/api/v1/does-not-exist').expect(404);

    const validator = await contractValidator();
    const options = (overrides: Partial<ResponseUnderTest>): ResponseUnderTest =>
      response({
        method: 'OPTIONS',
        path: '/health/live',
        status: 204,
        headers: { 'x-correlation-id': CORRELATION_ID },
        body: undefined,
        text: '',
        ...overrides,
      });
    expect(validator.validateResponse(options({ headers: { 'x-correlation-id': CORRELATION_ID, allow: 'GET, HEAD, OPTIONS' } }))).toEqual(
      [],
    );
    expect(validator.validateResponse(options({ headers: { 'x-correlation-id': CORRELATION_ID, allow: 'GET, HEAD' } }))).toEqual([
      '/headers/allow: "GET, HEAD" must include OPTIONS',
    ]);
    expect(validator.validateResponse(options({ status: 405 }))).toEqual([
      '/status: OPTIONS on a known path answers 204 with Allow; got 405',
    ]);
    const methodNotAllowed = response({
      method: 'POST',
      path: '/health/live',
      status: 405,
      headers: { 'content-type': 'application/problem+json', 'x-correlation-id': CORRELATION_ID, allow: 'GET, HEAD' },
      body: problem('METHOD_NOT_ALLOWED', 405, { instance: '/health/live' }),
    });
    expect(validator.validateResponse(methodNotAllowed)).toEqual([
      '/headers/allow: "GET, HEAD" must include OPTIONS (answered on every known path)',
    ]);
  });

  it('[PR #21 N4] a request path with one trailing slash is validated like the path Express serves it from', async () => {
    const client = await api(healthApp());
    await client.get('/health/live/').expect(200, { status: 'ok' });
  });

  it('[PR #21 N3] refuses a document that uses the OpenAPI 3.0 nullable keyword (Ajv would apply it natively)', async () => {
    const validator = await contractValidator();
    const edited = structuredClone(validator.document) as unknown as { components: { schemas: Record<string, Record<string, unknown>> } };
    const problemSchema = edited.components.schemas['Problem'];
    if (problemSchema === undefined) throw new Error('no Problem schema');
    problemSchema['nullable'] = true;
    expect(() => createContractValidator(edited as unknown as OpenApiDocument)).toThrow(
      'openapi.yaml: OpenAPI 3.0 schema keyword(s) nullable in a 3.1 document',
    );
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
    expect(
      validator.validateResponse(response({ headers: { 'content-type': 'application/json', 'x-correlation-id': 'short', ...PRIVATE } })),
    ).toEqual([
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
    const withBody = response({
      method: 'DELETE',
      status: 204,
      headers: { 'x-correlation-id': CORRELATION_ID, ...PRIVATE },
      body: {},
      text: 'x',
    });
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
      body: {
        access_token: sentinel,
        nested: { Authorization: sentinel, refreshCookie: sentinel },
        // PR21-SEC-07: one-time and credential-like contract fields; `code` is a TOTP code unless it is a catalogue code.
        reauth_proof: sentinel,
        recovery_codes: [sentinel],
        provisioning_uri: sentinel,
        mfa: { code: sentinel },
        code: 'NOT_FOUND',
        filler: 'f'.repeat(900),
      },
    });
    const message = validator.describeFailure(leaky, validator.validateResponse(leaky));
    expect(message).not.toContain(sentinel);
    expect(message).toContain('"access_token":"[REDACTED]"');
    expect(message).toContain('"code":"NOT_FOUND"');
    const excerpt = /Body excerpt \(redacted\): (.*)$/s.exec(message)?.[1] ?? '';
    expect(excerpt.length).toBeLessThanOrEqual(501);
  });

  it('every response schema of the contract compiles under Ajv strict mode', async () => {
    const validator = await contractValidator();
    expect(validator.operations).toHaveLength(133);
    expect(validator.compileAll()).toBeGreaterThan(133);
  });
});
