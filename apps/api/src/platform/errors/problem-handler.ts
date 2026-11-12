// The one error handler (ADR-0016 §3, REQ-PLAT-009/010, US-007). Mounted last by createApp. It answers every
// failure as application/problem+json with a catalogue code, echoes the correlation ID (header set by the context
// middleware, field set here), logs 5xx with the raw thrown value for the server log only, and marks the response
// so audit capture skips it. The body is built from catalogue data and AppError's client-safe fields only.
import { randomUUID } from 'node:crypto';

import { AppError, type ErrorCode } from '@platform/shared';
import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';

import { requestContextOf } from '../context/request-context.js';
import { classifyThrown, thrownClassName, type Classified } from './classify.js';
import { markErrorResponse } from './error-response.js';
import { buildProblem, PROBLEM_CONTENT_TYPE } from './problem.js';

/** Scalar log fields chosen by code (CLAUDE.md §9); structurally compatible with platform/runtime RuntimeLog. */
export type ErrorLogFields = Readonly<Record<string, string | number | boolean>>;

/**
 * Minimal logger seam until Pino arrives (TASK-010). `error` receives the raw thrown value as a separate argument:
 * a Pino adapter serialises it with redaction; the interim runtime log ignores it, so nothing unredacted is written.
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

function codeOf(classified: Classified): ErrorCode {
  switch (classified.kind) {
    case 'app':
      return classified.error.code;
    case 'framework':
      return classified.code;
    case 'unexpected':
      return 'INTERNAL_ERROR';
  }
}

export function problemHandler(options: ProblemHandlerOptions): ErrorRequestHandler {
  return (thrown: unknown, req: Request, res: Response, next: NextFunction): void => {
    const correlationId = requestContextOf(res)?.correlationId ?? (options.fallbackCorrelationId ?? randomUUID)();
    const classified = classifyThrown(thrown);
    const code = codeOf(classified);
    const appError = classified.kind === 'app' ? classified.error : undefined;
    const problem = buildProblem({
      code,
      correlationId,
      url: req.originalUrl,
      ...(appError === undefined ? {} : { detail: appError.detail, errors: appError.errors }),
      ...(options.typeBase === undefined ? {} : { typeBase: options.typeBase }),
    });

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

    markErrorResponse(res, { code, status: problem.status });
    res.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(problem));
  };
}
