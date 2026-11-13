// TASK-017 runtime seams over the real createApp: AT-US-034-03 (version prefix), AT-US-035-04 (deprecated fixture
// operation carries Deprecation/Sunset/Link), AT-US-035-06 (ApiMode is test outside production) and the PR #9 code
// review n9 OPTIONS answer (204 + Allow instead of Express's text/plain 200).
import { describe, expect, it } from '@jest/globals';
import request from 'supertest';

import { createApp } from '../../app.js';
import { resolveApiMode, type ApiMode } from '../context/api-mode.js';
import { currentRequestContext } from '../context/request-context.js';
import { fixtureRoute } from '../routing/tests/fixture-route.js';

function app(apiMode?: ApiMode) {
  const health = [
    fixtureRoute({ operationId: 'getLiveness', path: '/health/live', handler: () => ({ status: 200, body: { status: 'ok' } }) }),
  ];
  const fixtures = [
    // Fixture only: no operation is deprecated in 1.0.0-m1 (US-035 notes). The pipeline sends the headers from metadata.
    fixtureRoute({
      operationId: 'getDeprecatedFixture',
      path: '/fixtures/deprecated',
      deprecated: { since: '2026-11-12', sunset: '2027-06-30', link: 'https://docs.platform.invalid/migrations/fixture' },
      handler: () => ({ status: 200, body: { ok: true } }),
    }),
    fixtureRoute({
      operationId: 'getModeFixture',
      path: '/fixtures/mode',
      handler: () => ({ status: 200, body: { apiMode: currentRequestContext()?.apiMode } }),
    }),
  ];
  return createApp({
    health,
    modules: [{ name: 'fixtures', routes: fixtures }],
    logger: { info: () => undefined, error: () => undefined },
    ...(apiMode === undefined ? {} : { apiMode }),
  });
}

describe('version prefix', () => {
  it('[AT-US-034-03] GET /api/v2/anything is 404 NOT_FOUND problem+json and /health/live is reachable without the prefix', async () => {
    const server = app();
    const unknown = await request(server).get('/api/v2/anything');
    expect(unknown.status).toBe(404);
    expect(unknown.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect((unknown.body as { code?: unknown }).code).toBe('NOT_FOUND');
    const live = await request(server).get('/health/live');
    expect(live.status).toBe(200);
    expect(
      await request(server)
        .get('/api/v1/health/live')
        .then((res) => res.status),
    ).toBe(404);
  });
});

describe('deprecation headers', () => {
  it('[AT-US-035-04] a fixture operation marked deprecated with sunset 2027-06-30 answers Deprecation, Sunset and Link rel="deprecation"', async () => {
    const res = await request(app()).get('/api/v1/fixtures/deprecated');
    expect(res.status).toBe(200);
    expect(res.headers['deprecation']).toBe(`@${Date.UTC(2026, 10, 12) / 1000}`);
    expect(res.headers['sunset']).toBe('Wed, 30 Jun 2027 00:00:00 GMT');
    expect(res.headers['link']).toBe('<https://docs.platform.invalid/migrations/fixture>; rel="deprecation"');
  });
});

describe('ApiMode seam', () => {
  it('[AT-US-035-06] any request handled in staging has request context ApiMode "test"', async () => {
    const res = await request(app(resolveApiMode('staging'))).get('/api/v1/fixtures/mode');
    expect(res.body).toEqual({ apiMode: 'test' });
  });

  it('is test in local and test, live only in production, and defaults to test', async () => {
    expect([resolveApiMode('local'), resolveApiMode('test'), resolveApiMode('production')]).toEqual(['test', 'test', 'live']);
    expect((await request(app()).get('/api/v1/fixtures/mode')).body).toEqual({ apiMode: 'test' });
    expect((await request(app('live')).get('/api/v1/fixtures/mode')).body).toEqual({ apiMode: 'live' });
  });
});

describe('OPTIONS (PR #9 code review n9)', () => {
  it('a known path answers 204 with Allow and no body', async () => {
    const res = await request(app()).options('/health/live');
    expect(res.status).toBe(204);
    expect(res.headers['allow']).toBe('GET, HEAD, OPTIONS');
    expect(res.text).toBe('');
    expect(res.headers['x-correlation-id']).toBeDefined();
  });

  it('an unknown path answers 404 problem+json', async () => {
    const res = await request(app()).options('/api/v1/nowhere');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  });
});
