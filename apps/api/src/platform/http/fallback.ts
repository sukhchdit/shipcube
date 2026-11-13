// Fallback for requests no route answered (REQ-PLAT-010, US-007): 405 METHOD_NOT_ALLOWED with an `Allow` header
// when the path exists for other methods, otherwise 404 NOT_FOUND. The allowed methods are derived from the routers
// that are actually mounted (health and module routers), so the header can never drift from the routes.
//
// Express 5 has no public route-table API. The derivation reads the router stack the same way Express does for its
// automatic OPTIONS answer (router 2.x: `layer.match(path)`, `layer.route.methods`, nested `handle.stack`), behind a
// structural guard. fallback.test.ts pins this against the installed Express, so an upgrade that changes the
// internals fails a test instead of silently dropping the header. TASK-020 (defineRoute) may replace the stack walk
// with its route metadata.
import { AppError } from '@platform/shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Canonical order of the `Allow` header. */
const METHOD_ORDER = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

interface LayerLike {
  match(path: string): boolean;
  readonly path?: unknown;
  readonly route?: { readonly methods: Readonly<Record<string, unknown>> } | undefined;
  readonly handle?: unknown;
}

function stackOf(router: unknown): readonly LayerLike[] {
  if (typeof router !== 'function' && (typeof router !== 'object' || router === null)) return [];
  const stack: unknown = (router as { stack?: unknown }).stack;
  return Array.isArray(stack) ? stack.filter(isLayerLike) : [];
}

function isLayerLike(value: unknown): value is LayerLike {
  return typeof value === 'object' && value !== null && typeof (value as { match?: unknown }).match === 'function';
}

function matches(layer: LayerLike, path: string): boolean {
  try {
    return layer.match(path);
  } catch (error) {
    // A parameter that cannot be decoded: the router itself has already answered 400 for this request.
    if (error instanceof URIError) return false;
    throw error;
  }
}

function collect(stack: readonly LayerLike[], path: string, into: Set<string>): void {
  for (const layer of stack) {
    if (!matches(layer, path)) continue;
    if (layer.route !== undefined) {
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled === true && method !== '_all') into.add(method.toUpperCase());
      }
      continue;
    }
    const nested = stackOf(layer.handle);
    if (nested.length === 0) continue;
    const prefix = typeof layer.path === 'string' ? layer.path : '';
    collect(nested, path.slice(prefix.length) || '/', into);
  }
}

/** The methods the mounted routes serve for `path`, in canonical order (`GET` implies `HEAD`, as in Express). */
export function allowedMethods(router: unknown, path: string): string[] {
  const found = new Set<string>();
  collect(stackOf(router), path, found);
  if (found.has('GET')) found.add('HEAD');
  const known = METHOD_ORDER.filter((method) => found.has(method));
  const others = [...found].filter((method) => !(METHOD_ORDER as readonly string[]).includes(method)).sort();
  return [...known, ...others];
}

/** `Allow` for a known path: the served methods plus OPTIONS, which optionsResponder answers on each (PR #21 R1-m3). */
export function allowHeader(allowed: readonly string[]): string {
  return (allowed.includes('OPTIONS') ? allowed : [...allowed, 'OPTIONS']).join(', ');
}

/**
 * `OPTIONS` on a path the mounted routes serve (PR #9 code review n9): 204 with `Allow` (including OPTIONS) and no
 * body, instead of Express's automatic 200 `text/plain`. Mounted first inside the routes router so it runs before
 * Express answers; an unknown path falls through to the 404 problem. CORS preflight (TASK-048) is answered before this.
 */
export function optionsResponder(router: unknown): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'OPTIONS') {
      next();
      return;
    }
    const allowed = allowedMethods(router, req.path);
    if (allowed.length === 0) {
      next();
      return;
    }
    res.setHeader('Allow', allowHeader(allowed));
    res.status(204).end();
  };
}

/**
 * Mounted after every router: 405 + `Allow` for a known path (RFC 9110 §15.5.6: every method the resource supports,
 * OPTIONS included), 404 otherwise. Both go to the problem handler.
 */
export function routeFallback(router: unknown): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const allowed = allowedMethods(router, req.path);
    if (allowed.length > 0 && !allowed.includes(req.method)) {
      res.setHeader('Allow', allowHeader(allowed));
      next(new AppError('METHOD_NOT_ALLOWED'));
      return;
    }
    next(new AppError('NOT_FOUND'));
  };
}
