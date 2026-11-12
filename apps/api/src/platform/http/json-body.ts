// JSON request bodies (ADR-0016 §4, REQ-SEC-015): a content-type allow-list (JSON only) and a size limit (1 MB
// default). A request that carries a body with any other media type is refused with 415 before anything reads it.
// Parse failures and oversized bodies surface as body-parser errors, which platform/errors maps to catalogue codes.
// Per-route limits and media types arrive with route metadata (TASK-020).
import { AsyncLocalStorage } from 'node:async_hooks';

import { AppError } from '@platform/shared';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';

/** Media types accepted for request bodies. */
export const JSON_MEDIA_TYPES: readonly string[] = ['application/json', 'application/*+json'];
export const DEFAULT_BODY_LIMIT = '1mb';

export interface JsonBodyOptions {
  /** body-parser size string or bytes; default 1 MB. */
  readonly limit?: string | number;
}

/** True when the request declares a body (RFC 9110 §8.6: Content-Length or Transfer-Encoding present). */
export function declaresBody(req: Request): boolean {
  const length = req.headers['content-length'];
  return req.headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0');
}

export function jsonBodyParser(options: JsonBodyOptions = {}): RequestHandler {
  const parse = express.json({
    limit: options.limit ?? DEFAULT_BODY_LIMIT,
    strict: true,
    type: [...JSON_MEDIA_TYPES],
  });
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!declaresBody(req)) {
      next();
      return;
    }
    if (typeof req.is([...JSON_MEDIA_TYPES]) !== 'string') {
      next(new AppError('UNSUPPORTED_MEDIA_TYPE'));
      return;
    }
    // The parser calls back from stream events, outside the request's async context: re-enter it (RequestContext).
    parse(req, res, AsyncLocalStorage.bind(next));
  };
}
