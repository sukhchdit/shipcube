/**
 * Error code -> message key map (REQ-UI-010, REQ-API-005, api/README.md §3; TASK-036). The API returns a stable `code`
 * from the shared error catalogue; the client renders `errors.<CODE>` of the common namespace, never the English
 * `title`/`detail`. Every catalogue code has a key: `ERROR_MESSAGES` must hold one string per `ErrorCode`, so a code
 * added to the catalogue without a message fails the type-check. An unknown or missing code renders `errors.UNKNOWN`.
 */
import { type ErrorCode, isErrorCode } from '@platform/shared';

import en from '../../locales/en/common.json';
import type { MessageKey } from './messages';

/** Compile-time completeness: the en catalogue (and through `Messages`, es and fr) names every error code. */
export const ERROR_MESSAGES: Readonly<Record<ErrorCode | 'UNKNOWN', string>> = en.errors;

export type ErrorMessageKey = `errors.${ErrorCode}` | 'errors.UNKNOWN';

/** The message key for a problem `code` (any value; the API is a trust boundary for the client too). */
export function errorMessageKey(code: unknown): ErrorMessageKey & MessageKey {
  return isErrorCode(code) ? `errors.${code}` : 'errors.UNKNOWN';
}
