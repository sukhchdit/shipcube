// Thrown 4xx outcomes are stored as the problem document as sent, rendered once, and replayed byte for byte
// (TASK-040; ADR-0014 amendment 6, D-ARCH-195 F1/F2; data-model §6.2 step 4; api/README §5; AT-US-038-07).
import { describe, expect, it } from '@jest/globals';
import { AppError } from '@platform/shared';

import { DbError } from '../db/index.js';
import { dbErrorMapping } from '../db/map-db-error.js';
import { isRenderedProblem, renderProblem } from '../errors/rendered-problem.js';
import { IdempotencyReplayError } from './body-cipher.js';
import { replayedProblemOf, storedProblemOf } from './problem.js';

const ISSUE = { pointer: '/body/qty', code: 'OUT_OF_RANGE', message: 'Field is out of range.' };
const MARKED = { 'Content-Type': 'application/problem+json' };
const CONTEXT = { correlationId: 'first-0001', url: '/api/v1/orders?dry=1' };

describe('[AT-US-038-07] [D-ARCH-195] thrown 4xx outcomes', () => {
  it('renders the document once, as the problem handler renders it, and stores exactly that document', () => {
    const thrown = new AppError('VALIDATION_ERROR', { errors: [ISSUE] });
    const stored = storedProblemOf(thrown, CONTEXT);
    const { problem } = renderProblem(thrown, CONTEXT);
    expect(stored?.result).toEqual({ status: 400, headers: MARKED, body: problem });
    expect(problem).toMatchObject({ code: 'VALIDATION_ERROR', correlation_id: 'first-0001', instance: '/api/v1/orders', errors: [ISSUE] });
    expect(stored?.error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, body: JSON.stringify(problem), replayed: false });
    expect(stored?.error.cause).toBe(thrown);
    expect(isRenderedProblem(stored?.error)).toBe(true);
  });

  it('stores a DbError with a 4xx catalogue code and honours a configured type base', () => {
    const stored = storedProblemOf(new DbError(dbErrorMapping(409, 'CONFLICT')), { ...CONTEXT, typeBase: 'https://docs.example.test/p/' });
    expect(stored?.result.body).toMatchObject({ code: 'CONFLICT', status: 409, type: 'https://docs.example.test/p/CONFLICT' });
  });

  it('[AT-US-038-06] never stores a 429, a 5xx or an unexpected error', () => {
    expect(storedProblemOf(new AppError('RATE_LIMITED'), CONTEXT)).toBeUndefined();
    expect(storedProblemOf(new AppError('SERVICE_UNAVAILABLE'), CONTEXT)).toBeUndefined();
    expect(storedProblemOf(new DbError(dbErrorMapping(503, 'LOCK_TIMEOUT', { retryable: true })), CONTEXT)).toBeUndefined();
    expect(storedProblemOf(new Error('boom'), CONTEXT)).toBeUndefined();
    expect(storedProblemOf('not an error', CONTEXT)).toBeUndefined();
  });

  it('replays the stored document byte for byte, correlation_id included, marked as a replay', () => {
    const stored = storedProblemOf(new AppError('ORG_TYPE_NOT_ALLOWED', { detail: 'No.' }), CONTEXT);
    if (stored === undefined) throw new Error('not stored');
    const fromRow = JSON.parse(JSON.stringify(stored.result)) as typeof stored.result;
    const replayed = replayedProblemOf(fromRow);
    expect(replayed).toMatchObject({ code: 'ORG_TYPE_NOT_ALLOWED', status: 422, replayed: true });
    expect(replayed?.body).toBe(stored.error.body);
    expect(isRenderedProblem(replayed)).toBe(true);
  });

  it('a slot-marked row whose document does not name a stored 4xx of its status is unreadable', () => {
    for (const bad of [
      { status: 201, headers: { Location: '/x' }, body: { id: '1' } },
      { status: 201 },
      { status: 409, headers: MARKED, body: { code: 'NOT_A_CODE' } },
      { status: 422, headers: MARKED, body: { code: 'CONFLICT' } },
      { status: 429, headers: MARKED, body: { code: 'RATE_LIMITED' } },
      { status: 503, headers: MARKED, body: { code: 'SERVICE_UNAVAILABLE' } },
      { status: 409, headers: MARKED, body: 'CONFLICT' },
      { status: 409, headers: MARKED },
    ]) {
      expect(() => replayedProblemOf(bad)).toThrow(IdempotencyReplayError);
    }
  });
});
