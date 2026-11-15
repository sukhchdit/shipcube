// JSON request bodies (ADR-0016 §4, REQ-SEC-015): a content-type allow-list (JSON only, UTF-8 only) and a size limit
// (1 MB default). A request that carries a body with any other media type or charset is refused with 415 before
// anything reads it. Parse failures and oversized bodies surface as body-parser errors, which platform/errors maps to
// catalogue codes; any other client-side body error (a corrupt gzip/deflate/br stream) is MALFORMED_REQUEST here.
// Per-route limits and media types arrive with route metadata (TASK-020).
//
// PR42-SEC-15 (c), D-TASK025-13/-27: a parsed body whose string values or object keys (at any depth) hold a NUL
// (U+0000) or a lone surrogate is refused with 400 MALFORMED_REQUEST before any route sees it. The audit writer refuses
// NUL and normalises lone surrogates, and PostgreSQL JSONB refuses NUL (SQLSTATE 22P05) and unpaired surrogate escapes
// (22P02), so a client could otherwise steer a request into a 500 (or two keys into one after normalisation); the
// boundary answers 400 instead. JSON escapes (`\u0000`, `\ud800`) are the only way in: UTF-8 bytes cannot encode
// either. A well-formed surrogate pair (an emoji) is accepted.
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

const HIGH_SURROGATE_FIRST = 0xd800;
const HIGH_SURROGATE_LAST = 0xdbff;
const LOW_SURROGATE_FIRST = 0xdc00;
const LOW_SURROGATE_LAST = 0xdfff;

const isLowSurrogate = (unit: number): boolean => unit >= LOW_SURROGATE_FIRST && unit <= LOW_SURROGATE_LAST;

/**
 * True when `text` can be stored as-is (PR42-SEC-15 (c)): no NUL and no lone surrogate (a high surrogate not followed
 * by a low one, or a low surrogate not preceded by a high one). One pass over the UTF-16 code units, no regex.
 */
export function isStorableText(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit === 0 || isLowSurrogate(unit)) return false;
    if (unit >= HIGH_SURROGATE_FIRST && unit <= HIGH_SURROGATE_LAST) {
      // charCodeAt past the end is NaN, which is not a low surrogate.
      if (!isLowSurrogate(text.charCodeAt(index + 1))) return false;
      index += 1;
    }
  }
  return true;
}

/**
 * True when any string value or object key in a parsed JSON value, at any depth, is not storable (`isStorableText`).
 * Iterative over an explicit stack (a 1 MB body can nest far deeper than the call stack allows), linear in the size of
 * the value, and read-only. JSON.parse yields only arrays, plain objects and primitives, so own enumerable entries are
 * the whole content (a `__proto__` key is an own property there and is checked like any other).
 */
export function containsUnstorableText(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === 'string') {
      if (!isStorableText(current)) return true;
    } else if (Array.isArray(current)) {
      for (const item of current) pending.push(item);
    } else if (typeof current === 'object' && current !== null) {
      for (const [key, item] of Object.entries(current)) {
        if (!isStorableText(key)) return true;
        pending.push(item);
      }
    }
  }
  return false;
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
        if (error === undefined && containsUnstorableText(req.body)) {
          next(new AppError('MALFORMED_REQUEST'));
          return;
        }
        next(toBodyError(error));
      }),
    );
  };
}
