// US-035 AT-US-035-01/02 (REQ-API-003): Swagger UI at /api/docs, enabled by configuration, public, serving the
// current contract; off in production when DOCS_ENABLED is unset (404 NOT_FOUND problem+json).
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from '@jest/globals';
import { loadConfig } from '@platform/config';
import { createTestEnv } from '@platform/config/testing';
import express from 'express';
import request from 'supertest';

import { createApp, type AppDependencies } from '../../app.js';
import { createDocsRouter, DOCS_CSP, DocsSpecError, docsOptionsFrom } from './serve.js';

const SPEC = new URL('../../../../../docs/03-architecture/api/openapi.yaml', import.meta.url);
/** createTestEnv generates key material and the docs router reads the 1.5 MB UI bundle: slow on a loaded host. */
const SLOW = 30_000;

function app(docs: AppDependencies['docs']) {
  return createApp({
    healthRouter: express.Router(),
    modules: [],
    logger: { info: () => undefined, error: () => undefined },
    ...(docs === undefined ? {} : { docs }),
  });
}

describe('API documentation UI', () => {
  it(
    '[AT-US-035-01] with DOCS_ENABLED in the test environment, GET /api/docs renders Swagger UI over the current document without authentication',
    async () => {
      const config = loadConfig(createTestEnv({ appEnv: 'test' }), { service: 'api' });
      const docs = docsOptionsFrom(config, SPEC);
      expect(docs).toBeDefined();
      // One listening server and fetch: per-request supertest servers flaked (ECONNRESET) on the 1.6 MB bundle.
      const server = app(docs).listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const { port } = server.address() as AddressInfo;
      const get = (path: string) => fetch(`http://127.0.0.1:${port}${path}`);
      try {
        const page = await get('/api/docs');
        expect(page.status).toBe(200);
        expect(page.headers.get('content-type')).toMatch(/^text\/html/);
        expect(await page.text()).toContain('<div id="swagger-ui"></div>');
        expect(page.headers.get('content-security-policy')).toBe(DOCS_CSP);
        expect(page.headers.get('x-content-type-options')).toBe('nosniff');

        const initializer = await get('/api/docs/swagger-initializer.js');
        expect(await initializer.text()).toContain("url: '/api/docs/openapi.yaml'");

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
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
    SLOW,
  );

  it(
    'serves only the allow-listed assets (no source maps, no OAuth redirect page)',
    async () => {
      const server = app({ specPath: SPEC });
      for (const path of ['/api/docs/swagger-ui-bundle.js.map', '/api/docs/oauth2-redirect.html', '/api/docs/../package.json']) {
        const res = await request(server).get(path);
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
      }
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
    expect(() => createDocsRouter({ specPath: new URL('file:///definitely/missing/openapi.yaml') })).toThrow(DocsSpecError);
  });
});
