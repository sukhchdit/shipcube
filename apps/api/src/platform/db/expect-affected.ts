/**
 * Affected-row assertion for state transitions (ADR-0005 amendment 10 item 15, PR7-SEC-13; TASK-016).
 *
 * An `UPDATE`/`DELETE` outside the tenant context, or on a row RLS hides, touches 0 rows and raises nothing. Every
 * state-transition `UPDATE`/`DELETE` in a repository therefore passes its result through `expectAffected`, which is
 * also the optimistic-concurrency check (a version predicate that matched nothing).
 */
import { DbError, dbErrorMapping } from './map-db-error.js';

/** Result of `updateMany`/`deleteMany` (`{ count }`) or of `$executeRaw` (a number). */
export type AffectedRows = { readonly count: number } | number;

/**
 * Returns the affected-row count when it equals `expected` (default 1). Throws `DbError` `NOT_FOUND` (404) for 0 rows
 * and `CONFLICT` (409) for any other count (more rows than expected, or fewer but not none).
 */
export function expectAffected(result: AffectedRows, expected = 1): number {
  if (!Number.isInteger(expected) || expected < 1) throw new RangeError('expectAffected: expected must be a positive integer');
  const count = typeof result === 'number' ? result : result.count;
  if (!Number.isInteger(count) || count < 0) throw new RangeError('expectAffected: result is not a row count');
  if (count === expected) return count;
  throw new DbError(count === 0 ? dbErrorMapping(404, 'NOT_FOUND') : dbErrorMapping(409, 'CONFLICT'));
}
