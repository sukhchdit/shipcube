// API documentation UI (US-035 AT-US-035-01/02, REQ-API-003; ADR-0016 §1, api/README.md §1). Swagger UI
// (`swagger-ui-dist`, Apache-2.0) over the OpenAPI document at `/api/docs`, mounted only when `DOCS_ENABLED` (on by
// default in local and test, off in production unless configured; disabled -> the route does not exist -> 404
// NOT_FOUND problem+json). Public by design (descriptor NONE, "API documentation"); excluded from the route/contract
// drift check like README §15 says. Only an allow-list of assets is served (no source maps, no OAuth redirect page),
// with a restrictive CSP of its own; the document is read once at start-up.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import express, { type Request, type Response, type Router } from 'express';

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

export class DocsSpecError extends Error {
  override readonly name = 'DocsSpecError';
}

export interface DocsOptions {
  /** Absolute path (or file URL) of openapi.yaml. */
  readonly specPath: string | URL;
}

/** The docs options for createApp, or undefined when the UI is disabled by configuration. */
export function docsOptionsFrom(config: { readonly DOCS_ENABLED: boolean }, specPath: string | URL): DocsOptions | undefined {
  return config.DOCS_ENABLED ? { specPath } : undefined;
}

const PAGE = `<!DOCTYPE html>
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
    <script src="${DOCS_PATH}/swagger-ui-bundle.js" charset="UTF-8"></script>
    <script src="${DOCS_PATH}/swagger-ui-standalone-preset.js" charset="UTF-8"></script>
    <script src="${DOCS_PATH}/swagger-initializer.js" charset="UTF-8"></script>
  </body>
</html>
`;

const INITIALIZER = `window.onload = function () {
  window.ui = SwaggerUIBundle({
    url: '${DOCS_PATH}/${DOCS_SPEC_FILE}',
    dom_id: '#swagger-ui',
    deepLinking: true,
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: 'StandaloneLayout',
  });
};
`;

function swaggerUiDir(): string {
  return dirname(createRequire(import.meta.url).resolve('swagger-ui-dist/package.json'));
}

function readSpec(specPath: string | URL): string {
  try {
    return readFileSync(specPath, 'utf8');
  } catch (error) {
    throw new DocsSpecError('the OpenAPI document for /api/docs cannot be read', { cause: error });
  }
}

function send(res: Response, type: string, body: string | Buffer): void {
  res.setHeader('Content-Security-Policy', DOCS_CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-cache');
  res.type(type).send(body);
}

/** The docs router, to mount at DOCS_PATH. Reads the document and the asset folder once; throws DocsSpecError early. */
export function createDocsRouter(options: DocsOptions): Router {
  const spec = readSpec(options.specPath);
  const assetDir = swaggerUiDir();
  const router = express.Router();

  router.get('/', (_req: Request, res: Response) => send(res, 'text/html; charset=utf-8', PAGE));
  router.get('/swagger-initializer.js', (_req: Request, res: Response) => send(res, 'text/javascript; charset=utf-8', INITIALIZER));
  router.get(`/${DOCS_SPEC_FILE}`, (_req: Request, res: Response) => send(res, 'application/yaml; charset=utf-8', spec));
  for (const [file, type] of Object.entries(ASSETS)) {
    const content = readFileSync(join(assetDir, file));
    router.get(`/${file}`, (_req: Request, res: Response) => send(res, type, content));
  }
  return router;
}
