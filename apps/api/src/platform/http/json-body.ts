// JSON request bodies (ADR-0016 §4, REQ-SEC-015): a content-type allow-list (JSON only, UTF-8 only) and a size limit
// (1 MB default). A request that carries a body with any other media type or charset is refused with 415 before
// anything reads it. Parse failures and oversized bodies surface as body-parser errors, which platform/errors maps to
// catalogue codes; any other client-side body error (a corrupt gzip/deflate/br stream) is MALFORMED_REQUEST here.
// Per-route limits and media types arrive with route metadata (TASK-020).
import { AsyncLocalStorage } from 'node:async_hooks';

import { AppError } from '@platform/shared';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';

import { classifyThrown, ownDataProperty } from '../errors/classify.js';

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

const TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const QUOTED = '"(?:[^"\\\\]|\\\\.)*"';
/**
 * RFC 9110 §8.3 media type: `type/subtype *( OWS ";" OWS [ parameter ] )`, parameter = token "=" ( token / quoted-string ).
 *
 * PR9-SEC-14 (CWE-1333): the OWS after `;` is matched only together with a parameter. Matched on its own
 * (`;[ \t]*(?:parameter)?`), a run of blanks between two `;` could be split between "after this `;`" and "before the
 * next `;`" in many ways, and a failing match backtracked through every split (exponential in the number of empty
 * parameters). Here every blank has exactly one place in a match, so a failing match is linear. The language is
 * unchanged: blanks after a `;` with no parameter are the next `;`'s leading OWS, or the trailing OWS.
 */
const MEDIA_TYPE = new RegExp(`^[ \\t]*${TOKEN}/${TOKEN}(?:[ \\t]*;(?:[ \\t]*${TOKEN}=(?:${TOKEN}|${QUOTED}))?)*[ \\t]*$`, 'u');
const PARAMETER = new RegExp(`;[ \\t]*(${TOKEN})=(${TOKEN}|${QUOTED})`, 'gu');

/** A `Content-Type` longer than this is refused before any pattern runs (PR9-SEC-14, defence in depth). */
export const MAX_CONTENT_TYPE_LENGTH = 256;

/** True when `header` matches the media-type grammar above. No length bound and no charset rule: see below. */
export function isWellFormedMediaType(header: string): boolean {
  return MEDIA_TYPE.test(header);
}

/**
 * PR9-SEC-01: JSON exchanged between systems is UTF-8 (RFC 8259 §8.1). body-parser would decode any `utf-*` charset
 * (UTF-7 lets keys and markup pass byte-level inspection), so only an absent charset or `utf-8` is accepted. A
 * malformed header, a header longer than MAX_CONTENT_TYPE_LENGTH or a repeated charset is refused too.
 */
export function isUtf8JsonContentType(header: string | undefined): boolean {
  if (header === undefined || header.length > MAX_CONTENT_TYPE_LENGTH || !isWellFormedMediaType(header)) return false;
  const charsets = [...header.matchAll(PARAMETER)]
    .filter(([, name]) => name?.toLowerCase() === 'charset')
    .map(([, , value = '']) => (value.startsWith('"') ? value.slice(1, -1).replace(/\\(.)/gu, '$1') : value).toLowerCase());
  return charsets.length === 0 || (charsets.length === 1 && charsets[0] === 'utf-8');
}

/**
 * PR-0009 m1: body-parser reports some client failures (a corrupt compressed stream: `Z_DATA_ERROR` with status 400)
 * without a `type`; the classifier would answer 500. A 4xx error it does not already map becomes MALFORMED_REQUEST.
 */
export function toBodyError(error: unknown): unknown {
  if (error === undefined || classifyThrown(error).kind !== 'unexpected') return error;
  const status = statusOf(error);
  return typeof status === 'number' && status >= 400 && status < 500 ? new AppError('MALFORMED_REQUEST', { cause: error }) : error;
}

/**
 * `status` as http-errors defines it: an own property, or (named classes such as BadRequestError) a data property of
 * the prototype. Data properties only, so no getter runs; at most a short prototype walk.
 */
function statusOf(error: unknown): unknown {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    const status = ownDataProperty(current, 'status');
    if (status !== undefined) return status;
    try {
      current = Object.getPrototypeOf(current);
    } catch {
      return undefined;
    }
  }
  return undefined;
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
    // The bounded, linear check runs first, so no other parser sees an over-long or malformed header (PR9-SEC-14).
    if (!isUtf8JsonContentType(req.headers['content-type']) || typeof req.is([...JSON_MEDIA_TYPES]) !== 'string') {
      next(new AppError('UNSUPPORTED_MEDIA_TYPE'));
      return;
    }
    // The parser calls back from stream events, outside the request's async context: re-enter it (RequestContext).
    parse(
      req,
      res,
      AsyncLocalStorage.bind((error?: unknown) => {
        next(toBodyError(error));
      }),
    );
  };
}
