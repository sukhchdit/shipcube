// Marks a response as an error response (US-007 scenario "Error response is not audited as a mutation",
// AT-US-007-05). The problem handler sets the mark; audit capture (TASK-029) reads it and writes no mutation entry
// for a marked response. The mark lives in `res.locals`, so it needs no shared mutable state.
import type { ErrorCode } from '@platform/shared';
import type { Response } from 'express';

const MARK = 'errorResponse';

export interface ErrorResponseMark {
  readonly code: ErrorCode;
  readonly status: number;
}

export function markErrorResponse(res: Response, mark: ErrorResponseMark): void {
  res.locals[MARK] = Object.freeze({ ...mark });
}

/** The mark set by the problem handler, or undefined for a response no error produced. */
export function errorResponseMark(res: Response): ErrorResponseMark | undefined {
  const value: unknown = res.locals[MARK];
  return typeof value === 'object' && value !== null ? (value as ErrorResponseMark) : undefined;
}

/** Audit capture's predicate: a marked response is never recorded as a mutation. */
export function isAuditableMutationResponse(res: Response): boolean {
  return errorResponseMark(res) === undefined;
}
