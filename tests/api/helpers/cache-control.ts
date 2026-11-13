/**
 * SEC-TC-29 (T-06, ASVS 8.2.1) predicate shared by the contract validator and the contract stubs (PR32-SEC-06 (a), PR #32
 * code review m1 (c), D-ARCH-107 (5), D-ARCH-109): the same rule the API applies. A response must carry `Cache-Control:
 * private, no-store` when the operation's effective `security` has no anonymous alternative (`{}`, or no requirement at
 * all) or the request presented a credential of a kind the operation declares, errors included. A foreign credential
 * (a refresh cookie or a bearer on `listCountries`) is ignored by the route and requires nothing: the contract's
 * `public, max-age=3600` passes.
 *
 * Exception (code review m1 (b)/(c) recommendation): a problem raised before the route is known, so before the authn
 * slot read the request (the body parser's `MALFORMED_REQUEST`, `UNSUPPORTED_MEDIA_TYPE` and `PAYLOAD_TOO_LARGE`, and
 * the 404/405 fallback), needs only `no-store` unless the request carried any credential (the generic test), in which
 * case the problem handler makes it `private, no-store` too. Every problem document is `no-store` (PR-0009 m4).
 */
import { presentedKinds, presentsCredential } from '@platform/shared';

import type { ContractOperation, OpenApiDocument } from '../../../tools/openapi/contract.js';

export type HeaderValue = string | readonly string[] | undefined;
export type RequestHeaders = Readonly<Record<string, HeaderValue>>;

export const PRIVATE_NO_STORE: readonly string[] = Object.freeze(['private', 'no-store']);
export const NO_STORE: readonly string[] = Object.freeze(['no-store']);

/** Catalogue codes the app raises before a route matched (app-level body parsing). */
export const PRE_ROUTE_PROBLEM_CODES: ReadonlySet<string> = new Set(['MALFORMED_REQUEST', 'UNSUPPORTED_MEDIA_TYPE', 'PAYLOAD_TOO_LARGE']);

/**
 * The credential kind of each contract security scheme (D-ARCH-107 (1); the mapping of tests/generated/route-metadata.ts
 * `contractAuth`, which the helpers do not import). `*Signature` schemes are `signature`; `csrfToken` rides with the
 * refresh cookie as a companion, not a kind.
 */
const SCHEME_KINDS: Readonly<Record<string, string>> = Object.freeze({
  bearerAuth: 'session',
  refreshCookieWeb: 'refresh-cookie',
  refreshCookieAdmin: 'refresh-cookie',
  quoteToken: 'quote-token',
});
const COMPANION_SCHEMES: ReadonlySet<string> = new Set(['csrfToken']);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The kinds one `security` requirement object stands for: `{}` is anonymous; an unknown scheme is kept verbatim. */
function requirementKinds(requirement: Readonly<Record<string, unknown>>): string[] {
  const names = Object.keys(requirement);
  if (names.length === 0) return ['anonymous'];
  return names
    .filter((scheme) => !COMPANION_SCHEMES.has(scheme))
    .map((scheme) => SCHEME_KINDS[scheme] ?? (scheme.endsWith('Signature') ? 'signature' : scheme));
}

/**
 * The credential kinds the operation declares, from its effective `security` (its own, else the document's): one per
 * requirement object; no requirement at all is `anonymous`. Deduplicated, frozen.
 */
export function declaredKinds(operation: ContractOperation, doc: OpenApiDocument): readonly string[] {
  const declared = operation.operation['security'] ?? doc['security' as `x-${string}`];
  const requirements = Array.isArray(declared) ? (declared as unknown[]).filter(isRecord) : [];
  if (requirements.length === 0) return Object.freeze(['anonymous']);
  return Object.freeze([...new Set(requirements.flatMap(requirementKinds))]);
}

/** True when the operation's effective `security` admits an anonymous caller. */
export const allowsAnonymous = (operation: ContractOperation, doc: OpenApiDocument): boolean =>
  declaredKinds(operation, doc).includes('anonymous');

/** The operation half of the predicate: its responses are `private, no-store` whatever the request carried. */
export const requiresPrivateNoStore = (operation: ContractOperation, doc: OpenApiDocument): boolean => !allowsAnonymous(operation, doc);

function lowerCased(headers: RequestHeaders): Record<string, string | string[]> {
  const lower: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) lower[name.toLowerCase()] = typeof value === 'string' ? value : [...value];
  }
  return lower;
}

/**
 * Whether request headers (any case) carry a credential: of a kind in `declared` when given (D-ARCH-109, a known
 * operation), else of any kind (the generic test). `undefined` headers (the request is unknown) carry none.
 */
export function requestCarriesCredential(headers: RequestHeaders | undefined, declared?: readonly string[]): boolean {
  if (headers === undefined) return false;
  const lower = lowerCased(headers);
  return declared === undefined ? presentsCredential(lower) : presentedKinds(lower, declared).length > 0;
}

/** A problem the app raises before any route read the request (body parser). */
export const isPreRouteProblemCode = (code: unknown): boolean => typeof code === 'string' && PRE_ROUTE_PROBLEM_CODES.has(code);

/**
 * The credential half of SEC-TC-29 for one response: before the route is known (`declared` undefined: 404/405) or for
 * a pre-route problem code, any credential (the generic test); otherwise only a credential of a declared kind.
 */
export function credentialMakesPrivate(
  headers: RequestHeaders | undefined,
  declared: readonly string[] | undefined,
  problemCode?: unknown,
): boolean {
  return requestCarriesCredential(headers, isPreRouteProblemCode(problemCode) ? undefined : declared);
}

export interface CacheRequirement {
  /** Directive names the `Cache-Control` value must include. */
  readonly directives: readonly string[];
  /** Why, for the failure message. */
  readonly reason: string;
}

export interface CacheRequirementInput {
  /** The contract operation; `undefined` for the framework 404/405 (no operation matched). */
  readonly operation: ContractOperation | undefined;
  readonly doc: OpenApiDocument;
  /** Headers of the request (any case); `undefined` when the request is unknown (it carried no credential). */
  readonly requestHeaders: RequestHeaders | undefined;
  /** The problem body's `code`, if the response is a problem document. */
  readonly problemCode?: unknown;
}

/** What SEC-TC-29 requires of one response; `undefined` when it requires nothing. */
export function cacheRequirement({ operation, doc, requestHeaders, problemCode }: CacheRequirementInput): CacheRequirement | undefined {
  const declared = operation === undefined ? undefined : declaredKinds(operation, doc);
  const preRoute = declared === undefined || isPreRouteProblemCode(problemCode);
  if (credentialMakesPrivate(requestHeaders, declared, problemCode)) {
    const reason = preRoute ? 'the request carried a credential' : 'the request carried a credential of a kind the operation declares';
    return { directives: PRIVATE_NO_STORE, reason };
  }
  if (declared === undefined) return { directives: NO_STORE, reason: 'a framework problem raised before any route matched' };
  if (preRoute) return { directives: NO_STORE, reason: `${String(problemCode)} is raised before the route is known` };
  if (!declared.includes('anonymous')) return { directives: PRIVATE_NO_STORE, reason: 'its security has no anonymous alternative' };
  return undefined;
}
