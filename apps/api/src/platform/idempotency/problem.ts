/**
 * Thrown 4xx outcomes of an idempotent request (TASK-040; ADR-0014 amendment 6, D-ARCH-195 F1/F2; data-model §6.2
 * step 4; api/README §5; AT-US-038-07). Pure: no I/O.
 *
 * A 4xx other than 429 that the request throws after its claim (in `load`, `call` or the handler transaction) is the
 * response AS SENT: its problem document is rendered ONCE, with the first request's `correlation_id`, by the same
 * classification and rendering as the problem handler (errors/rendered-problem.ts). That exact document is stored
 * (status, `Content-Type: application/problem+json`, the JSON body, encrypted like every stored body) and sent; a
 * replay sends the stored document byte for byte, `correlation_id` included (the id of the request that executed and
 * whose FAILED entry exists), with its own `X-Correlation-Id` header and `Idempotent-Replayed: true`.
 */
import { PROBLEM_CONTENT_TYPE } from '../errors/problem.js';
import { type RenderContext, RenderedProblemError, renderProblem, storedProblemCode } from '../errors/rendered-problem.js';
import type { RouteResult } from '../routing/define-route.js';
import { IdempotencyReplayError } from './body-cipher.js';

/** A 4xx other than 429 is stored (a 5xx or a 429 releases the key). */
const isStoredProblemStatus = (status: number): boolean => status >= 400 && status < 500 && status !== 429;

export interface StoredProblem {
  /** What the store keeps: the status, the `Content-Type` and the document. */
  readonly result: RouteResult;
  /** What the tx slot throws instead of the original failure: the same document, sent as is. */
  readonly error: RenderedProblemError;
}

/**
 * The rendered, storable outcome of a THROWN failure, or `undefined` when it is not stored (a 5xx, a 429, a failure
 * the problem handler would answer 5xx).
 */
export function storedProblemOf(thrown: unknown, context: RenderContext): StoredProblem | undefined {
  const { code, problem } = renderProblem(thrown, context);
  if (!isStoredProblemStatus(problem.status)) return undefined;
  return {
    result: { status: problem.status, headers: { 'Content-Type': PROBLEM_CONTENT_TYPE }, body: problem },
    error: new RenderedProblemError(code, JSON.stringify(problem), { replayed: false, cause: thrown }),
  };
}

/**
 * The error that replays a stored SLOT-RENDERED problem document (the store calls it only for a row whose sealed envelope
 * says `slot-problem`; a route's own problem+json result replays as an ordinary result, code review R3-M1). A document
 * that does not name a stored 4xx of its status is unreadable ({@link IdempotencyReplayError}).
 */
export function replayedProblemOf(result: RouteResult): RenderedProblemError {
  const code = storedProblemCode(result.body, result.status);
  if (code === undefined || !isStoredProblemStatus(result.status)) throw new IdempotencyReplayError('stored problem malformed');
  return new RenderedProblemError(code, JSON.stringify(result.body), { replayed: true });
}
