// Per-request context (ADR-0016 §15, REQ-PLAT-011, US-008). The correlation ID is taken from an inbound
// `X-Correlation-Id` only when it matches the strict pattern, otherwise a UUID is generated; it is echoed on every
// response (errors included, because the header is set before any other middleware runs). Code below the HTTP layer
// reads it through AsyncLocalStorage instead of threading `req` around. Logging (TASK-010), audit (TASK-029), outbox
// and jobs extend RequestContext with their own fields in their own tasks.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { ApiMode } from './api-mode.js';

export const CORRELATION_ID_HEADER = 'X-Correlation-Id';
/** ADR-0016 §15 and openapi `Problem.correlation_id`. */
export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export interface RequestContext {
  readonly correlationId: string;
  /** `test` in every non-production environment (REQ-API-020, AT-US-035-06); M3 derives it from the API key. */
  readonly apiMode: ApiMode;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Accepts the inbound value only if it is a single header matching the pattern; otherwise generates a UUID. */
export function resolveCorrelationId(inbound: string | readonly string[] | undefined, generate: () => string = randomUUID): string {
  return typeof inbound === 'string' && CORRELATION_ID_PATTERN.test(inbound) ? inbound : generate();
}

/** The context of the request being handled, or undefined outside a request (start-up, jobs). */
export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Runs `fn` inside `context`; used by the middleware and by tests of context consumers. */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The context the middleware attached to this response (survives callbacks that lose the async context). */
export function requestContextOf(res: Response): RequestContext | undefined {
  const value: unknown = res.locals['requestContext'];
  return isRequestContext(value) ? value : undefined;
}

function isRequestContext(value: unknown): value is RequestContext {
  return typeof value === 'object' && value !== null && typeof (value as { correlationId?: unknown }).correlationId === 'string';
}

export interface RequestContextOptions {
  /** Makes the correlation ID when the client sent no valid one (default: UUID v4). */
  readonly generateCorrelationId?: () => string;
  /** The process's ApiMode (`resolveApiMode(APP_ENV)`); default `test`. */
  readonly apiMode?: ApiMode;
}

/** First middleware of the app: resolves the correlation ID, echoes it, and runs the rest of the chain in context. */
export function requestContextMiddleware(options: RequestContextOptions = {}): RequestHandler {
  const generateCorrelationId = options.generateCorrelationId ?? randomUUID;
  const apiMode = options.apiMode ?? 'test';
  return (req: Request, res: Response, next: NextFunction): void => {
    const context: RequestContext = Object.freeze({
      correlationId: resolveCorrelationId(req.headers[CORRELATION_ID_HEADER.toLowerCase()], generateCorrelationId),
      apiMode,
    });
    res.locals['requestContext'] = context;
    res.setHeader(CORRELATION_ID_HEADER, context.correlationId);
    storage.run(context, next);
  };
}
