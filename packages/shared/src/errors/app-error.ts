// The one error type the API throws on purpose (ADR-0016 §3, REQ-PLAT-009, REQ-API-005). The code must exist in
// the catalogue, which fixes the HTTP status. `cause` keeps the underlying failure for the server log and is never
// part of the client response: the problem+json handler builds the body from `code`, `detail` and `errors` only,
// and `toJSON()` exposes the same safe subset if an AppError is ever serialised directly.
import type { ProblemStatus } from './catalogue-entry.js';
import { ERROR_CATALOGUE, type ErrorCode } from './catalogue/index.js';

/** One field-level validation issue (openapi `ValidationIssue`). */
export interface ValidationIssue {
  /** JSON pointer into the request: /body/..., /query/..., /params/..., /headers/... */
  readonly pointer: string;
  /** Stable SCREAMING_SNAKE sub-code (api README, validation sub-codes). */
  readonly code: string;
  /** English developer message; clients localise from `code`. */
  readonly message: string;
}

/** Upper bound on `errors[]` (openapi `Problem.errors.maxItems`). */
export const MAX_VALIDATION_ISSUES = 50;

export interface AppErrorOptions {
  /** Client-safe English detail. Defaults to "<title>." Ignored for 5xx, which always carry the generic detail. */
  readonly detail?: string;
  /** Field issues, for VALIDATION_ERROR; truncated to MAX_VALIDATION_ISSUES. */
  readonly errors?: readonly ValidationIssue[];
  /** Underlying failure, for the server log only. Never serialised. */
  readonly cause?: unknown;
}

/** The safe, serialisable view of an AppError. */
export interface AppErrorJson {
  readonly code: ErrorCode;
  readonly status: ProblemStatus;
  readonly detail: string;
  readonly errors?: readonly ValidationIssue[];
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: ProblemStatus;
  readonly title: string;
  readonly detail: string;
  readonly errors: readonly ValidationIssue[] | undefined;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    const entry = ERROR_CATALOGUE[code];
    // `cause` goes to Error's own non-enumerable `cause` property, so spreads and JSON.stringify skip it.
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = entry.status;
    this.title = entry.title;
    this.detail = options.detail ?? `${entry.title}.`;
    this.errors = options.errors?.slice(0, MAX_VALIDATION_ISSUES);
  }

  toJSON(): AppErrorJson {
    return this.errors === undefined
      ? { code: this.code, status: this.status, detail: this.detail }
      : { code: this.code, status: this.status, detail: this.detail, errors: this.errors };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
