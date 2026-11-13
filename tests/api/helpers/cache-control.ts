/**
 * SEC-TC-29 (T-06, ASVS 8.2.1) predicate shared by the contract validator and the contract stubs (PR32-SEC-06 (a), PR #32
 * code review m1 (c), D-ARCH-107 (5)): the same rule the API applies. A response must carry `Cache-Control: private,
 * no-store` when the operation's effective `security` has no anonymous alternative (`{}`, or no requirement at all) or
 * the request carried a credential (an `Authorization` header, a refresh cookie or `X-Quote-Token`), errors included.
 *
 * Exception (code review m1 (b)/(c) recommendation): a problem raised before the route is known, so before the authn
 * slot could mark the response (the body parser's `MALFORMED_REQUEST`, `UNSUPPORTED_MEDIA_TYPE` and
 * `PAYLOAD_TOO_LARGE`, and the 404/405 fallback), needs only `no-store` unless the request carried a credential, in
 * which case the problem handler makes it `private, no-store` too. Every problem document is `no-store` (PR-0009 m4).
 */
import { presentsCredential } from '@platform/shared';

import type { ContractOperation, OpenApiDocument } from '../../../tools/openapi/contract.js';

export type HeaderValue = string | readonly string[] | undefined;

export const PRIVATE_NO_STORE: readonly string[] = Object.freeze(['private', 'no-store']);
export const NO_STORE: readonly string[] = Object.freeze(['no-store']);

/** Catalogue codes the app raises before a route matched (app-level body parsing). */
export const PRE_ROUTE_PROBLEM_CODES: ReadonlySet<string> = new Set(['MALFORMED_REQUEST', 'UNSUPPORTED_MEDIA_TYPE', 'PAYLOAD_TOO_LARGE']);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** True when the operation's effective `security` (its own, else the document's) admits an anonymous caller. */
export function allowsAnonymous(operation: ContractOperation, doc: OpenApiDocument): boolean {
  const declared = operation.operation['security'] ?? doc['security' as `x-${string}`];
  const requirements = Array.isArray(declared) ? (declared as unknown[]).filter(isRecord) : [];
  return requirements.length === 0 || requirements.some((requirement) => Object.keys(requirement).length === 0);
}

/** The operation half of the predicate: its responses are `private, no-store` whatever the request carried. */
export const requiresPrivateNoStore = (operation: ContractOperation, doc: OpenApiDocument): boolean => !allowsAnonymous(operation, doc);

/** Whether request headers (any case) carry a credential; `undefined` (the request is unknown) carries none. */
export function requestCarriesCredential(headers: Readonly<Record<string, HeaderValue>> | undefined): boolean {
  if (headers === undefined) return false;
  const lower: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) lower[name.toLowerCase()] = typeof value === 'string' ? value : [...value];
  }
  return presentsCredential(lower);
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
  /** Whether the request carried a credential (`requestCarriesCredential`); false when the request is unknown. */
  readonly credential: boolean;
  /** The problem body's `code`, if the response is a problem document. */
  readonly problemCode?: unknown;
}

/** What SEC-TC-29 requires of one response; `undefined` when it requires nothing. */
export function cacheRequirement({ operation, doc, credential, problemCode }: CacheRequirementInput): CacheRequirement | undefined {
  if (credential) return { directives: PRIVATE_NO_STORE, reason: 'the request carried a credential' };
  if (operation === undefined) return { directives: NO_STORE, reason: 'a framework problem raised before any route matched' };
  if (typeof problemCode === 'string' && PRE_ROUTE_PROBLEM_CODES.has(problemCode)) {
    return { directives: NO_STORE, reason: `${problemCode} is raised before the route is known` };
  }
  if (requiresPrivateNoStore(operation, doc)) return { directives: PRIVATE_NO_STORE, reason: 'its security has no anonymous alternative' };
  return undefined;
}
