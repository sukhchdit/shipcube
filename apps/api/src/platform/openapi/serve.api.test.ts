// US-035 AT-US-035-01/02 (REQ-API-003): Swagger UI at /api/docs, enabled by configuration, public, serving the
// current contract; off in production when DOCS_ENABLED is unset (404 NOT_FOUND problem+json). Also PR21-SEC-01
// (precomputed ETags), PR21-SEC-02 (initializer hardening) and PR #21 N5 (OPTIONS and 405 on the docs paths).
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from '@jest/globals';
import { loadConfig } from '@platform/config';
import { createTestEnv } from '@platform/config/testing';
import type { Express } from 'express';
import request from 'supertest';

import { createApp, type AppDependencies } from '../../app.js';
import {
  createDocsRouter,
  DOCS_CSP,
  docsInitializer,
  docsOptionsFrom,
  type DocsOptions,
  docsPage,
  DocsSpecError,
  swaggerUiConfig,
} from './serve.js';

const SPEC = new URL('../../../../../docs/03-architecture/api/openapi.yaml', import.meta.url);
/** createTestEnv generates key material and the docs router reads the 1.5 MB UI bundle: slow on a loaded host. */
const SLOW = 30_000;
const TEST_DOCS: DocsOptions = { specPath: SPEC, apiMode: 'test', topBar: false };
const DOCS_PATHS = [
  '/api/docs',
  '/api/docs/swagger-initializer.js',
  '/api/docs/openapi.yaml',
  '/api/docs/swagger-ui-bundle.js',
  '/api/docs/swagger-ui-standalone-preset.js',
  '/api/docs/swagger-ui.css',
  '/api/docs/index.css',
  '/api/docs/favicon-32x32.png',
  '/api/docs/favicon-16x16.png',
];

function app(docs: AppDependencies['docs']): Express {
  return createApp({
    health: [],
    modules: [],
    logger: { info: () => undefined, error: () => undefined },
    ...(docs === undefined ? {} : { docs }),
  });
}

/** One listening server and fetch: per-request supertest servers flaked (ECONNRESET) on the 1.6 MB bundle. */
async function withServer(target: Express, run: (get: (path: string, init?: RequestInit) => Promise<Response>) => Promise<void>) {
  const server = target.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run((path, init) => fetch(`http://127.0.0.1:${String(port)}${path}`, init));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('API documentation UI', () => {
  it(
    '[AT-US-035-01] with DOCS_ENABLED in the test environment, GET /api/docs renders Swagger UI over the current document without authentication',
    async () => {
      const config = loadConfig(createTestEnv({ appEnv: 'test' }), { service: 'api' });
      const docs = docsOptionsFrom(config, SPEC);
      expect(docs).toEqual({ specPath: SPEC, apiMode: 'test', topBar: false });
      await withServer(app(docs), async (get) => {
        const page = await get('/api/docs');
        expect(page.status).toBe(200);
        expect(page.headers.get('content-type')).toMatch(/^text\/html/);
        expect(await page.text()).toContain('<div id="swagger-ui"></div>');
        expect(page.headers.get('content-security-policy')).toBe(DOCS_CSP);
        expect(page.headers.get('x-content-type-options')).toBe('nosniff');

        const initializer = await get('/api/docs/swagger-initializer.js');
        expect(await initializer.text()).toContain('"url":"/api/docs/openapi.yaml"');

        const spec = await get('/api/docs/openapi.yaml');
        expect(spec.status).toBe(200);
        expect(spec.headers.get('content-type')).toMatch(/^application\/yaml/);
        expect(await spec.text()).toBe(readFileSync(SPEC, 'utf8'));

        for (const [asset, type] of [
          ['swagger-ui-bundle.js', /^text\/javascript/],
          ['swagger-ui.css', /^text\/css/],
          ['favicon-32x32.png', /^image\/png/],
        ] as const) {
          const res = await get(`/api/docs/${asset}`);
          expect(res.status).toBe(200);
          expect(res.headers.get('content-type')).toMatch(type);
          expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
        }
      });
    },
    SLOW,
  );

  it(
    '[PR21-SEC-01] serves precomputed strong ETags: no per-request hashing, and If-None-Match gets 304 without a body',
    async () => {
      const target = app(TEST_DOCS);
      let etagCalls = 0;
      target.set('etag', () => {
        etagCalls += 1;
        return '"from-the-etag-fn"';
      });
      await withServer(target, async (get) => {
        for (const path of DOCS_PATHS) {
          const first = await get(path);
          await first.arrayBuffer();
          const second = await get(path);
          await second.arrayBuffer();
          const etag = first.headers.get('etag');
          expect([path, first.status, etag]).toEqual([path, 200, expect.stringMatching(/^"[A-Za-z0-9_-]{27}"$/)]);
          expect(second.headers.get('etag')).toBe(etag);
          // fetch adds `Cache-Control: no-cache` to a conditional request unless one is set, which disables 304s.
          const revalidated = await get(path, { headers: { 'If-None-Match': String(etag), 'Cache-Control': 'max-age=0' } });
          expect([path, revalidated.status, (await revalidated.arrayBuffer()).byteLength]).toEqual([path, 304, 0]);
        }
      });
      expect(etagCalls).toBe(0);
    },
    SLOW,
  );

  it(
    'serves only the allow-listed assets (no source maps, no OAuth redirect page)',
    async () => {
      const server = app(TEST_DOCS);
      for (const path of ['/api/docs/swagger-ui-bundle.js.map', '/api/docs/oauth2-redirect.html', '/api/docs/../package.json']) {
        const res = await request(server).get(path);
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
      }
    },
    SLOW,
  );

  it(
    '[PR #21 N5] OPTIONS on a docs path answers 204 + Allow; another method gets 405 problem+json with Allow',
    async () => {
      const server = app(TEST_DOCS);
      const options = await request(server).options('/api/docs');
      expect([options.status, options.headers['allow'], options.text]).toEqual([204, 'GET, HEAD, OPTIONS', '']);
      const post = await request(server).post('/api/docs/openapi.yaml');
      expect(post.status).toBe(405);
      expect(post.headers['allow']).toBe('GET, HEAD, OPTIONS');
      expect(post.headers['content-type']).toMatch(/^application\/problem\+json/);
    },
    SLOW,
  );

  it(
    '[AT-US-035-02] with NODE_ENV=production and DOCS_ENABLED unset, GET /api/docs returns 404 NOT_FOUND',
    async () => {
      const env = createTestEnv({ appEnv: 'production' });
      expect(env['NODE_ENV']).toBe('production');
      expect(env['DOCS_ENABLED']).toBeUndefined();
      const config = loadConfig(env, { service: 'api' });
      const docs = docsOptionsFrom(config, SPEC);
      expect(docs).toBeUndefined();

      for (const path of ['/api/docs', '/api/docs/openapi.yaml']) {
        const res = await request(app(docs)).get(path);
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
        expect((res.body as { code?: unknown }).code).toBe('NOT_FOUND');
      }
    },
    SLOW,
  );

  it('refuses to start the docs without a readable document', () => {
    expect(() => createDocsRouter({ ...TEST_DOCS, specPath: new URL('file:///definitely/missing/openapi.yaml') })).toThrow(DocsSpecError);
  });
});

describe('Swagger UI initializer hardening (PR21-SEC-02)', () => {
  it('pins the validator badge off and query config off in every mode', () => {
    for (const options of [TEST_DOCS, { ...TEST_DOCS, apiMode: 'live' as const }, { ...TEST_DOCS, topBar: true }]) {
      expect(swaggerUiConfig(options)).toMatchObject({ validatorUrl: null, queryConfigEnabled: false, deepLinking: true });
    }
  });

  it('renders without "Try it out" when the process serves live data, and keeps the default otherwise', () => {
    expect(swaggerUiConfig({ ...TEST_DOCS, apiMode: 'live' })).toMatchObject({ supportedSubmitMethods: [] });
    expect(swaggerUiConfig(TEST_DOCS)).not.toHaveProperty('supportedSubmitMethods');
  });

  it('uses the top bar (StandaloneLayout and its preset) only when asked, which docsOptionsFrom does for local only', () => {
    expect(swaggerUiConfig(TEST_DOCS)).toMatchObject({ layout: 'BaseLayout' });
    expect(docsInitializer(TEST_DOCS)).not.toContain('SwaggerUIStandalonePreset');
    expect(docsPage(TEST_DOCS)).not.toContain('swagger-ui-standalone-preset.js');
    const local = { ...TEST_DOCS, topBar: true };
    expect(swaggerUiConfig(local)).toMatchObject({ layout: 'StandaloneLayout' });
    expect(docsInitializer(local)).toContain('[SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset]');
    expect(docsPage(local)).toContain('swagger-ui-standalone-preset.js');

    const enabled = { DOCS_ENABLED: true } as const;
    expect(docsOptionsFrom({ ...enabled, APP_ENV: 'local' }, SPEC)).toEqual({ specPath: SPEC, apiMode: 'test', topBar: true });
    expect(docsOptionsFrom({ ...enabled, APP_ENV: 'staging' }, SPEC)).toEqual({ specPath: SPEC, apiMode: 'test', topBar: false });
    expect(docsOptionsFrom({ ...enabled, APP_ENV: 'production' }, SPEC)).toEqual({ specPath: SPEC, apiMode: 'live', topBar: false });
    expect(docsOptionsFrom({ DOCS_ENABLED: false, APP_ENV: 'local' }, SPEC)).toBeUndefined();
  });
});
