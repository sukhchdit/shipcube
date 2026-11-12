// RFC 9457 problem details (ADR-0016 §3, openapi `Problem`, REQ-PLAT-009). Pure: builds the body from a catalogue
// code and client-safe fields only. Every 5xx carries the generic detail, whatever the code or the thrown value.
import { ERROR_CATALOGUE, type ErrorCode, type ProblemStatus, type ValidationIssue } from '@platform/shared';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
/** Generic 5xx detail (api README §3; openapi INTERNAL_ERROR example). */
export const GENERIC_SERVER_DETAIL = 'An unexpected error occurred.';
/** `type` base until the brand docs domain is configured (openapi examples use docs.platform.invalid). */
export const DEFAULT_PROBLEM_TYPE_BASE = 'https://docs.platform.invalid/problems/';
/** `instance` is the request path, capped so a hostile URL cannot inflate the error body. */
const MAX_INSTANCE_LENGTH = 2048;

export interface Problem {
  readonly type: string;
  readonly title: string;
  readonly status: ProblemStatus;
  readonly detail: string;
  readonly instance: string;
  readonly code: ErrorCode;
  readonly correlation_id: string;
  readonly errors?: readonly ValidationIssue[];
}

export interface ProblemInput {
  readonly code: ErrorCode;
  readonly correlationId: string;
  /** Request target; the query string is dropped (it may carry tokens). */
  readonly url: string;
  readonly detail?: string;
  readonly errors?: readonly ValidationIssue[] | undefined;
  readonly typeBase?: string;
}

export function instanceOf(url: string): string {
  const queryAt = url.indexOf('?');
  const path = queryAt === -1 ? url : url.slice(0, queryAt);
  return path.slice(0, MAX_INSTANCE_LENGTH);
}

export function buildProblem(input: ProblemInput): Problem {
  const entry = ERROR_CATALOGUE[input.code];
  const serverError = entry.status >= 500;
  const base: Problem = {
    type: `${input.typeBase ?? DEFAULT_PROBLEM_TYPE_BASE}${input.code}`,
    title: entry.title,
    status: entry.status,
    detail: serverError ? GENERIC_SERVER_DETAIL : (input.detail ?? `${entry.title}.`),
    instance: instanceOf(input.url),
    code: input.code,
    correlation_id: input.correlationId,
  };
  return !serverError && input.errors !== undefined && input.errors.length > 0 ? { ...base, errors: input.errors } : base;
}
