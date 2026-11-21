/**
 * Problem documents rendered ONCE (TASK-040; ADR-0014 amendment 6, D-ARCH-195 F1/F2). `renderProblem` is the one
 * classification and rendering of a thrown value: the problem handler answers every failure with it, and the tx slot
 * uses it for the 4xx of an idempotent request, whose document must be stored and replayed exactly as it was sent.
 * A {@link RenderedProblemError} carries such a document; the problem handler sends its bytes unchanged (the status,
 * `Content-Type`, `Cache-Control` and the error mark are set as for any problem). Pure apart from the brand set.
 */
import { type ErrorCode, ERROR_CATALOGUE, isErrorCode } from '@platform/shared';

import { type Classified, classifyThrown } from './classify.js';
import { buildProblem, type Problem } from './problem.js';

export interface RenderContext {
  readonly correlationId: string;
  /** The request target (`req.originalUrl`); the query is dropped for `instance`. */
  readonly url: string;
  readonly typeBase?: string | undefined;
}

export interface RenderedProblem {
  readonly classified: Classified;
  readonly code: ErrorCode;
  readonly problem: Problem;
}

function codeOf(classified: Classified): ErrorCode {
  switch (classified.kind) {
    case 'app':
      return classified.error.code;
    case 'framework':
    case 'db':
      return classified.code;
    case 'unexpected':
      return 'INTERNAL_ERROR';
  }
}

/** Classifies `thrown` (classify.ts) and builds its problem document (problem.ts). */
export function renderProblem(thrown: unknown, context: RenderContext): RenderedProblem {
  const classified = classifyThrown(thrown);
  const code = codeOf(classified);
  const appError = classified.kind === 'app' ? classified.error : undefined;
  const problem = buildProblem({
    code,
    correlationId: context.correlationId,
    url: context.url,
    ...(appError === undefined ? {} : { detail: appError.detail, errors: appError.errors }),
    ...(context.typeBase === undefined ? {} : { typeBase: context.typeBase }),
  });
  return { classified, code, problem };
}

const RENDERED = new WeakSet<object>();

/**
 * A failure whose problem document was already rendered (and, for an idempotent request, stored): the problem handler
 * sends `body` as is. `replayed` marks the answer of a replay (`Idempotent-Replayed: true`).
 */
export class RenderedProblemError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** The exact JSON text of the document. */
  readonly body: string;
  readonly replayed: boolean;

  constructor(code: ErrorCode, body: string, options: { readonly replayed: boolean; readonly cause?: unknown }) {
    super(`problem ${code} rendered once`, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'RenderedProblemError';
    this.code = code;
    this.status = ERROR_CATALOGUE[code].status;
    this.body = body;
    this.replayed = options.replayed;
    RENDERED.add(this);
  }
}

/** True only for an error built by {@link RenderedProblemError} (a forged look-alike is classified as usual). */
export const isRenderedProblem = (value: unknown): value is RenderedProblemError =>
  typeof value === 'object' && value !== null && RENDERED.has(value);

/** The catalogue code of a stored document, when it names one whose status matches. */
export function storedProblemCode(document: unknown, status: number): ErrorCode | undefined {
  if (typeof document !== 'object' || document === null) return undefined;
  const code = (document as Record<string, unknown>)['code'];
  return isErrorCode(code) && ERROR_CATALOGUE[code].status === status ? code : undefined;
}
