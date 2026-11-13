// Deprecation signalling (US-035 AT-US-035-04, REQ-API-015; ADR-0016 §14, api/README.md §1 "Deprecation and sunset").
// A route marked deprecated answers with `Deprecation: @<unix-seconds>` (RFC 9745), `Sunset: <HTTP-date>` (RFC 8594)
// and `Link: <url>; rel="deprecation"`. No operation is deprecated in 1.0.0-m1; route metadata (`defineRoute`
// `deprecated: { since, sunset, link }`, TASK-020) mounts this middleware, and the contract test refuses a deprecated
// operation without `x-sunset` (tools/openapi drift check).
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface DeprecationInfo {
  /** When the operation became deprecated (RFC 3339 date or date-time). */
  readonly since: string;
  /** When it stops working (`x-sunset`, RFC 3339 date or date-time). */
  readonly sunset: string;
  /** Migration notes (`x-deprecation-link`), an absolute https URL. */
  readonly link: string;
}

export class DeprecationConfigError extends Error {
  override readonly name = 'DeprecationConfigError';
}

const RFC3339 = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?$/;

/** True when the calendar date exists (V8 rolls `2026-02-30` over to March instead of rejecting it). */
function isCalendarDate(day: string): boolean {
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

function parseDate(label: string, value: string): Date {
  const date = RFC3339.test(value) && isCalendarDate(value.slice(0, 10)) ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) throw new DeprecationConfigError(`${label} must be an RFC 3339 date`);
  return date;
}

function parseLink(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DeprecationConfigError('link must be an absolute URL');
  }
  if (url.protocol !== 'https:') throw new DeprecationConfigError('link must use https');
  return url.href;
}

/** The three header values; validated once, at route definition. */
export function deprecationHeaderValues(info: DeprecationInfo): Readonly<Record<'Deprecation' | 'Sunset' | 'Link', string>> {
  const since = parseDate('since', info.since);
  const sunset = parseDate('sunset', info.sunset);
  if (sunset.getTime() <= since.getTime()) throw new DeprecationConfigError('sunset must be after since');
  return {
    Deprecation: `@${Math.floor(since.getTime() / 1000)}`,
    Sunset: sunset.toUTCString(),
    Link: `<${parseLink(info.link)}>; rel="deprecation"`,
  };
}

/** Sets the deprecation headers on every response of the route (success and problem responses alike). */
export function deprecationHeaders(info: DeprecationInfo): RequestHandler {
  const headers = deprecationHeaderValues(info);
  return (_req: Request, res: Response, next: NextFunction): void => {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    next();
  };
}
