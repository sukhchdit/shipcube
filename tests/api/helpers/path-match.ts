// Matches a concrete request path against OpenAPI path templates (US-034, REQ-API-004, api/README.md §16 item 2).
// `{param}` matches exactly one non-empty segment without `/`. When several templates match, the one with a static
// segment at the first position where they differ wins (`/orgs/me` beats `/orgs/{orgId}`), as in Express route order.
// Used by the Supertest response validator and the contract stub server (tests/contract-stubs).

/** Longest request path considered; longer paths never match (bounded work per request). */
export const MAX_MATCH_PATH_LENGTH = 2048;

const PARAM_SEGMENT = /^\{[^{}/]+\}$/;

export interface PathTemplate<T> {
  readonly template: string;
  /** `null` marks a `{param}` segment. */
  readonly segments: readonly (string | null)[];
  readonly value: T;
}

export function compilePathTemplate<T>(template: string, value: T): PathTemplate<T> {
  const segments = template.split('/').map((segment) => (PARAM_SEGMENT.test(segment) ? null : segment));
  return { template, segments, value };
}

/** The path part of a request target: no query string or fragment. */
export function requestPathOf(target: string): string {
  const end = target.search(/[?#]/);
  return end === -1 ? target : target.slice(0, end);
}

function matches(segments: readonly (string | null)[], parts: readonly string[]): boolean {
  if (segments.length !== parts.length) return false;
  return segments.every((segment, index) => {
    const part = parts[index] ?? '';
    return segment === null ? part.length > 0 : segment === part;
  });
}

/** Negative when `a` is more specific than `b` (a static segment where `b` has a parameter, first difference wins). */
function bySpecificity(a: PathTemplate<unknown>, b: PathTemplate<unknown>): number {
  for (let index = 0; index < a.segments.length; index += 1) {
    const aStatic = a.segments[index] !== null;
    const bStatic = b.segments[index] !== null;
    if (aStatic !== bStatic) return aStatic ? -1 : 1;
  }
  return 0;
}

/**
 * Every template matching `target` (query ignored), most specific first. One trailing `/` is ignored, as Express's
 * non-strict routing serves `/health/live/` from `/health/live` (PR #21 N4).
 */
export function matchAll<T>(templates: readonly PathTemplate<T>[], target: string): PathTemplate<T>[] {
  const requested = requestPathOf(target);
  const path = requested.length > 1 && requested.endsWith('/') ? requested.slice(0, -1) : requested;
  if (path.length > MAX_MATCH_PATH_LENGTH) return [];
  const parts = path.split('/');
  return templates.filter((candidate) => matches(candidate.segments, parts)).sort(bySpecificity);
}

/** The most specific template matching `target`, or `undefined`. */
export function matchPath<T>(templates: readonly PathTemplate<T>[], target: string): PathTemplate<T> | undefined {
  return matchAll(templates, target)[0];
}
