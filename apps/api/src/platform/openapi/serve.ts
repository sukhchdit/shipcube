// API documentation UI (US-035 AT-US-035-01/02, REQ-API-003; ADR-0016 §1, api/README.md §1). Swagger UI
// (`swagger-ui-dist`, Apache-2.0) over the OpenAPI document at `/api/docs`, mounted only when `DOCS_ENABLED` (on by
// default in local and test, off in production unless configured; disabled -> the route does not exist -> 404
// NOT_FOUND problem+json). Public by design (descriptor NONE, "API documentation"); excluded from the route/contract
// drift check like README §15 says. Only an allow-list of assets is served (no source maps, no OAuth redirect page),
// with a restrictive CSP of its own. Every body is read once at start-up and served with a precomputed strong ETag,
// so a request never hashes a 0.8-1.6 MB body (PR21-SEC-01). The initializer pins the hardening options instead of
// relying on library defaults (PR21-SEC-02): no external validator badge, no `?url=`/`?configUrl=` query config, no
// "Try it out" when the process serves live data, and the top-bar URL box only in local development.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { AppEnv } from '@platform/config';
import express, { type Request, type Response, type Router } from 'express';

import { type ApiMode, resolveApiMode } from '../context/api-mode.js';
import { routePrefix } from '../logging/request-logger.js';

/** Where the UI is mounted (outside /api/v1, REQ-API-003). */
export const DOCS_PATH = '/api/docs';
export const DOCS_SPEC_FILE = 'openapi.yaml';

/** UI page CSP: same-origin scripts only; Swagger UI sets inline style attributes, hence `'unsafe-inline'` for styles. */
export const DOCS_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** swagger-ui-dist files the page needs, with their media types. */
const ASSETS: Readonly<Record<string, string>> = {
  'swagger-ui.css': 'text/css; charset=utf-8',
  'index.css': 'text/css; charset=utf-8',
  'swagger-ui-bundle.js': 'text/javascript; charset=utf-8',
  'swagger-ui-standalone-preset.js': 'text/javascript; charset=utf-8',
  'favicon-32x32.png': 'image/png',
  'favicon-16x16.png': 'image/png',
};

const HTML = 'text/html; charset=utf-8';
const JAVASCRIPT = 'text/javascript; charset=utf-8';
const YAML = 'application/yaml; charset=utf-8';

export class DocsSpecError extends Error {
  override readonly name = 'DocsSpecError';
}

export interface DocsOptions {
  /** Absolute path (or file URL) of openapi.yaml. */
  readonly specPath: string | URL;
  /** `live` renders without "Try it out" (no submit methods), PR21-SEC-02. */
  readonly apiMode: ApiMode;
  /** Swagger UI's top bar (a box that loads any spec URL); local development only, PR21-SEC-02. */
  readonly topBar: boolean;
}

/** The docs options for createApp, or undefined when the UI is disabled by configuration. */
export function docsOptionsFrom(
  config: { readonly DOCS_ENABLED: boolean; readonly APP_ENV: AppEnv },
  specPath: string | URL,
): DocsOptions | undefined {
  return config.DOCS_ENABLED ? { specPath, apiMode: resolveApiMode(config.APP_ENV), topBar: config.APP_ENV === 'local' } : undefined;
}

/** The UI page; the standalone preset (top bar) is loaded only when the layout uses it. */
export function docsPage(options: Pick<DocsOptions, 'topBar'>): string {
  const preset = options.topBar ? `\n    <script src="${DOCS_PATH}/swagger-ui-standalone-preset.js" charset="UTF-8"></script>` : '';
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Platform API documentation</title>
    <link rel="stylesheet" type="text/css" href="${DOCS_PATH}/swagger-ui.css" />
    <link rel="stylesheet" type="text/css" href="${DOCS_PATH}/index.css" />
    <link rel="icon" type="image/png" href="${DOCS_PATH}/favicon-32x32.png" sizes="32x32" />
    <link rel="icon" type="image/png" href="${DOCS_PATH}/favicon-16x16.png" sizes="16x16" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${DOCS_PATH}/swagger-ui-bundle.js" charset="UTF-8"></script>${preset}
    <script src="${DOCS_PATH}/swagger-initializer.js" charset="UTF-8"></script>
  </body>
</html>
`;
}

/** Swagger UI configuration (JSON-safe part); the presets reference page globals and are added by the initializer. */
export function swaggerUiConfig(options: Pick<DocsOptions, 'apiMode' | 'topBar'>): Readonly<Record<string, unknown>> {
  return {
    url: `${DOCS_PATH}/${DOCS_SPEC_FILE}`,
    dom_id: '#swagger-ui',
    deepLinking: true,
    // No badge image from validator.swagger.io carrying the spec URL.
    validatorUrl: null,
    // Pinned (the 5.x default): `?url=` / `?configUrl=` never load another document into this origin.
    queryConfigEnabled: false,
    // Live data: documentation only, no request is ever sent from the page.
    ...(options.apiMode === 'live' ? { supportedSubmitMethods: [] } : {}),
    layout: options.topBar ? 'StandaloneLayout' : 'BaseLayout',
  };
}

/** The initializer script; every value comes from typed options, serialised with JSON.stringify. */
export function docsInitializer(options: Pick<DocsOptions, 'apiMode' | 'topBar'>): string {
  const presets = options.topBar ? '[SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset]' : '[SwaggerUIBundle.presets.apis]';
  return `window.onload = function () {
  window.ui = SwaggerUIBundle(Object.assign(${JSON.stringify(swaggerUiConfig(options))}, { presets: ${presets} }));
};
`;
}

function swaggerUiDir(): string {
  return dirname(createRequire(import.meta.url).resolve('swagger-ui-dist/package.json'));
}

function readSpec(specPath: string | URL): Buffer {
  try {
    return readFileSync(specPath);
  } catch (error) {
    throw new DocsSpecError('the OpenAPI document for /api/docs cannot be read', { cause: error });
  }
}

interface StaticBody {
  readonly type: string;
  readonly content: Buffer;
  /** Strong validator computed once (a quoted base64url SHA-256 prefix). */
  readonly etag: string;
}

function staticBody(type: string, content: Buffer | string): StaticBody {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  return { type, content: buffer, etag: `"${createHash('sha256').update(buffer).digest('base64url').slice(0, 27)}"` };
}

function send(res: Response, body: StaticBody): void {
  res.setHeader('Content-Security-Policy', DOCS_CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-cache');
  // With an ETag already set, Express neither hashes the body nor skips its 304 answer for a matching If-None-Match.
  res.setHeader('ETag', body.etag);
  res.type(body.type).send(body.content);
}

/** The docs router, to mount at DOCS_PATH. Reads the document and the asset folder once; throws DocsSpecError early. */
export function createDocsRouter(options: DocsOptions): Router {
  const bodies = new Map<string, StaticBody>([
    ['/', staticBody(HTML, docsPage(options))],
    ['/swagger-initializer.js', staticBody(JAVASCRIPT, docsInitializer(options))],
    [`/${DOCS_SPEC_FILE}`, staticBody(YAML, readSpec(options.specPath))],
  ]);
  const assetDir = swaggerUiDir();
  for (const [file, type] of Object.entries(ASSETS)) bodies.set(`/${file}`, staticBody(type, readFileSync(join(assetDir, file))));

  const router = express.Router();
  // First, path-less layer: the access log names a docs request by its full template (D-ORCH-024 (3), PR #20 union).
  router.use(routePrefix(DOCS_PATH));
  for (const [path, body] of bodies) router.get(path, (_req: Request, res: Response) => send(res, body));
  return router;
}
