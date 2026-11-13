// Per-request context (ADR-0016 §15, REQ-PLAT-011, US-008). The correlation ID is taken from an inbound
// `X-Correlation-Id` only when it matches the strict pattern, otherwise a UUID is generated; it is echoed on every
// response (errors included, because the header is set before any other middleware runs). Besides it, every request
// gets a server-generated `requestId` (PR9-SEC-10, threat model L-14/R-22; the audit shard key of TASK-030) and keeps
// the validated client value as `clientCorrelationId`, so a client can never choose the only key of a request, and
// the process's `apiMode` (REQ-API-020). Code below the HTTP layer reads the context through AsyncLocalStorage
// instead of threading `req` around; the logger (platform/logging) reads it for every line. Audit (TASK-029), outbox
// and jobs extend it in their own tasks.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import { CORRELATION_ID_PATTERN } from '@platform/shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { ApiMode } from './api-mode.js';

export const CORRELATION_ID_HEADER = 'X-Correlation-Id';
/** ADR-0016 §15 and openapi `Problem.correlation_id` (single source in @platform/shared, PR #20 n2). */
export { CORRELATION_ID_PATTERN };

export interface RequestContext {
  /** Echoed in `X-Correlation-Id`: the validated inbound value, else a generated UUID. */
  readonly correlationId: string;
  /** Always server-generated (PR9-SEC-10); never taken from the request. */
  readonly requestId: string;
  /** The inbound `X-Correlation-Id` when it passed CORRELATION_ID_PATTERN (so it is at most 64 safe characters). */
  readonly clientCorrelationId?: string;
  /** `test` in every non-production environment (REQ-API-020, AT-US-035-06); M3 derives it from the API key. */
  readonly apiMode: ApiMode;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The validated inbound correlation value, or undefined (missing, repeated or not matching the pattern). */
export function validClientCorrelationId(inbound: string | readonly string[] | undefined): string | undefined {
  return typeof inbound === 'string' && CORRELATION_ID_PATTERN.test(inbound) ? inbound : undefined;
}

/** Accepts the inbound value only if it is a single header matching the pattern; otherwise generates a UUID. */
export function resolveCorrelationId(inbound: string | readonly string[] | undefined, generate: () => string = randomUUID): string {
  return validClientCorrelationId(inbound) ?? generate();
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
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { correlationId?: unknown; requestId?: unknown; apiMode?: unknown };
  return typeof candidate.correlationId === 'string' && typeof candidate.requestId === 'string' && typeof candidate.apiMode === 'string';
}

export interface RequestContextOptions {
  /** Makes the correlation ID when the client sent no valid one (default: UUID v4). */
  readonly generateCorrelationId?: () => string;
  /** Makes the server-side request ID (default: UUID v4). */
  readonly generateRequestId?: () => string;
  /** The process's ApiMode (`resolveApiMode(APP_ENV)`); default `test`. */
  readonly apiMode?: ApiMode;
}

/** First middleware of the app: resolves the correlation ID, echoes it, and runs the rest of the chain in context. */
export function requestContextMiddleware(options: RequestContextOptions = {}): RequestHandler {
  const generateCorrelationId = options.generateCorrelationId ?? randomUUID;
  const generateRequestId = options.generateRequestId ?? randomUUID;
  const apiMode = options.apiMode ?? 'test';
  return (req: Request, res: Response, next: NextFunction): void => {
    const clientCorrelationId = validClientCorrelationId(req.headers[CORRELATION_ID_HEADER.toLowerCase()]);
    const context: RequestContext = Object.freeze({
      correlationId: clientCorrelationId ?? generateCorrelationId(),
      requestId: generateRequestId(),
      ...(clientCorrelationId === undefined ? {} : { clientCorrelationId }),
      apiMode,
    });
    res.locals['requestContext'] = context;
    res.setHeader(CORRELATION_ID_HEADER, context.correlationId);
    storage.run(context, next);
  };
}
