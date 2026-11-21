// The one error handler (ADR-0016 §3, REQ-PLAT-009/010, US-007). Mounted last by createApp. It answers every
// failure as application/problem+json with a catalogue code, echoes the correlation ID (header set by the context
// middleware, field set here), logs 5xx with the raw thrown value for the server log only, and marks the response
// so audit capture skips it. The body is built from catalogue data and AppError's client-safe fields only; a DbError
// contributes its catalogue code and, when retryable, `Retry-After` (never its reason, SQLSTATE or Prisma code); a 503
// AppError carrying `retryAfterSeconds` (the tx slot's request deadline, PR #44 R1-M1) gets `Retry-After` too.
import { randomUUID } from 'node:crypto';

import { AppError, ERROR_CATALOGUE, presentsCredential } from '@platform/shared';
import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';

import { requestContextOf } from '../context/request-context.js';
import {
  credentialsReadOf,
  declaresPrivateResponse,
  isPrivateResponse,
  PRIVATE_CACHE_CONTROL,
  routeDescriptorOf,
} from '../routing/route-state.js';
import { thrownClassName } from './classify.js';
import { markErrorResponse } from './error-response.js';
import { DEFAULT_PROBLEM_TYPE_BASE, GENERIC_SERVER_DETAIL, instanceOf, PROBLEM_CONTENT_TYPE } from './problem.js';
import { isRenderedProblem, renderProblem } from './rendered-problem.js';

/** Scalar log fields chosen by code (CLAUDE.md §9); structurally compatible with platform/runtime RuntimeLog. */
export type ErrorLogFields = Readonly<Record<string, string | number | boolean>>;

/**
 * The logger seam of the problem handler (the platform logger, TASK-010, satisfies it). `error` receives the raw thrown
 * value as a separate argument, which the logger serialises into `err` (database errors as { name, code, originalCode,
 * kind } only; other errors with redacted message and stack, AT-US-007-03).
 */
export interface ErrorLogger {
  error(event: string, fields?: ErrorLogFields, thrown?: unknown): void;
}

export interface ProblemHandlerOptions {
  readonly logger: ErrorLogger;
  /** `https://docs.<domain>/problems/` (ADR-0016 §3). */
  readonly typeBase?: string;
  /** Correlation ID when the context middleware did not run (it always runs in createApp). */
  readonly fallbackCorrelationId?: () => string;
}

/**
 * Representation headers a handler may have set before it threw; they describe the intended response, not the
 * problem document (PR-0009 m4, CWE-525). `Cache-Control` is replaced with `no-store`, or `private, no-store` when
 * `isAuthenticatedProblem` holds (SEC-TC-29, D-ARCH-107 (5), D-ARCH-109). The mark is read from the response state,
 * never from the header text a handler may have rewritten (PR #32 m1 (b)), so an error raised before the route is
 * known is private exactly when the request carried a credential.
 */
export const DROPPED_ON_PROBLEM = ['ETag', 'Last-Modified', 'Content-Disposition', 'Content-Language'] as const;

/**
 * 500 body for when building the problem itself failed (PR9-SEC-07): never HTML, never a stack. Plain strings only,
 * so it cannot fail the way the problem did; `type` and `title` match what buildProblem gives (PR-0009 R2-n1).
 */
function fallbackProblemBody(correlationId: string, url: string, typeBase: string): string {
  return JSON.stringify({
    type: `${typeBase}INTERNAL_ERROR`,
    title: ERROR_CATALOGUE.INTERNAL_ERROR.title,
    status: 500,
    detail: GENERIC_SERVER_DETAIL,
    instance: instanceOf(url),
    code: 'INTERNAL_ERROR',
    correlation_id: correlationId,
  });
}

/**
 * SEC-TC-29 for a problem document (D-ARCH-109 (4)). Private when any of these holds:
 * - a slot marked the response private;
 * - the route is known (the `context` step recorded its descriptor before authn ran) and its declaration makes the
 *   response private: no `anonymous` member, or a credential of a declared kind was presented. Computed here from the
 *   descriptor, so an authenticator that refuses a declared credential before marking still answers private (R1-m1);
 * - no route is known (404/405 fallback, body parser, or a descriptor local that `defineRoute` did not return) or the
 *   authn slot has not read the credentials yet (a step that failed before the slot), and the request carries any
 *   credential header: the generic test, free because a problem is no-store anyway.
 * After the slot read the credentials of a known route, a foreign credential it ignored does not make the error
 * private. An unbranded or forged descriptor local reads as no route and keeps the generic test even when the
 * credentials-read mark is set (D-ARCH-113 (3), PR #38 code review R2-n1): fail closed, more private, never less.
 */
const isAuthenticatedProblem = (req: Request, res: Response): boolean => {
  if (isPrivateResponse(res)) return true;
  const route = routeDescriptorOf(res);
  if (route !== undefined && declaresPrivateResponse(route.auth, req.headers)) return true;
  return (route === undefined || !credentialsReadOf(res)) && presentsCredential(req.headers);
};

function sendProblem(req: Request, res: Response, status: number, body: string, retryAfterSeconds?: number): void {
  for (const header of DROPPED_ON_PROBLEM) res.removeHeader(header);
  const authenticated = isAuthenticatedProblem(req, res);
  res.setHeader('Cache-Control', authenticated ? PRIVATE_CACHE_CONTROL : 'no-store');
  if (retryAfterSeconds !== undefined) res.setHeader('Retry-After', String(retryAfterSeconds));
  res.status(status).type(PROBLEM_CONTENT_TYPE).send(body);
}

export function problemHandler(options: ProblemHandlerOptions): ErrorRequestHandler {
  return (thrown: unknown, req: Request, res: Response, next: NextFunction): void => {
    const correlationId = requestContextOf(res)?.correlationId ?? (options.fallbackCorrelationId ?? randomUUID)();
    try {
      // A document already rendered once (an idempotent 4xx, stored before it is sent; TASK-040, D-ARCH-195): sent as is.
      if (isRenderedProblem(thrown) && !res.headersSent) {
        markErrorResponse(res, { code: thrown.code, status: thrown.status });
        sendProblem(req, res, thrown.status, thrown.body);
        return;
      }
      const { classified, code, problem } = renderProblem(thrown, { correlationId, url: req.originalUrl, typeBase: options.typeBase });
      const appError = classified.kind === 'app' ? classified.error : undefined;

      if (problem.status >= 500 || res.headersSent) {
        options.logger.error(
          'http.request_failed',
          {
            correlation_id: correlationId,
            code,
            status: problem.status,
            method: req.method,
            error_class: thrownClassName(thrown),
            headers_sent: res.headersSent,
          },
          thrown,
        );
      }
      if (res.headersSent) {
        // A partial response cannot become a problem document: Express's final handler aborts the connection. It gets
        // a code-only AppError, never the thrown value, so its own stderr line cannot carry the original message.
        next(appError ?? new AppError('INTERNAL_ERROR'));
        return;
      }

      const body = JSON.stringify(problem);
      markErrorResponse(res, { code, status: problem.status });
      const retryAfter = classified.kind === 'db' || classified.kind === 'app' ? classified.retryAfterSeconds : undefined;
      sendProblem(req, res, problem.status, body, retryAfter);
    } catch {
      // PR9-SEC-07: a failure inside the handler (an unserialisable `errors` entry, a hostile value) must not reach
      // Express's final handler, which answers HTML with a stack outside NODE_ENV=production.
      if (res.headersSent) {
        res.destroy();
        return;
      }
      markErrorResponse(res, { code: 'INTERNAL_ERROR', status: 500 });
      try {
        options.logger.error('http.problem_handler_failed', { correlation_id: correlationId, method: req.method });
      } catch {
        // The response below is what matters; a failing logger must not prevent it.
      }
      sendProblem(req, res, 500, fallbackProblemBody(correlationId, req.originalUrl, options.typeBase ?? DEFAULT_PROBLEM_TYPE_BASE));
    }
  };
}
