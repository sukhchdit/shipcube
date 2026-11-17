/**
 * RBAC matrix generator (US-071, REQ-RBAC-011, NFR-SEC-011, NFR-TENANT-002; T-QA-04; ADR-0008 am. 4 and 5; D-ARCH-107,
 * D-ARCH-109, D-ARCH-110; TASK-027, TASK-289). Pure: no I/O. Input: the routes (route metadata, read from the `defineRoute`
 * descriptors or from openapi.yaml), the seeded roles (`ROLES`, the single source of the seed migration) and the
 * permission catalogue. Output: one cell per route x caller with the outcome the pipeline must produce.
 *
 * Callers (the matrix columns), in this order:
 *  - `none`: no credential at all;
 *  - one per seeded role: a valid session (bearer) in an organisation of the role's scope; an OPERATOR role is a staff
 *    member who has not passed the second factor yet (staff before TOTP, REQ-AUTH-018), so the MFA gate refuses it on
 *    every route without `mfaGateExempt`;
 *  - one per OPERATOR role with a verified second factor (`<ROLE>+mfa`): the same session past the MFA gate, so the
 *    operator grants are decided by the permission gate;
 *  - invalid or non-session credentials: an expired bearer, a valid and an unknown refresh cookie, a valid and an
 *    unknown guest quote token;
 *  - on `[signature]` routes only (a signature is never presented through a header a non-signature route reads): a
 *    provider signature whose principal holds the route's permission, and one that does not (D-ARCH-110);
 *  - on every route WITHOUT `signature` in its set: one caller per real provider signature header
 *    (`signature-header:<name>`, presenting `<name>: t=0,v1=0`; PR48-SEC-01), a foreign credential there.
 *
 * The rules, in pipeline order (authenticate -> MFA gate -> authorise; apps/api platform/routing/pipeline.ts):
 *  1. D-ARCH-109: a credential of a kind outside the route's `auth` set is never read, so the cell equals the
 *     no-credential cell (the whole response but its volatile parts, PR48-SEC-01: the runner compares them); with no
 *     declared credential, a set containing `anonymous` gives the anonymous principal, any other set 401 `AUTH_REQUIRED`;
 *  2. a declared credential that does not verify (expired bearer, unknown cookie or token) is 401, never 403;
 *  3. MFA gate: a staff principal (OPERATOR scope) without a verified factor is 403 `AUTHZ_DENIED` unless the route
 *     declares `mfaGateExempt`;
 *  4. permission gate (D-ARCH-107 (6), D-ARCH-110): `public` passes, except that a session on a dual-mode route must
 *     hold `permissionAuthenticated` (403); a `signatureOnly` permission needs a signature principal (else 401) holding
 *     it (else 403); `authenticated` needs a user actor (401); any other catalogued permission needs a user actor (401)
 *     holding it in the active organisation (403).
 * A response is private (`Cache-Control: private, no-store`, SEC-TC-29) when the set has no `anonymous` member or the
 * request presented a credential of a declared kind.
 */
import { CREDENTIAL_HEADER_NAMES } from '@platform/shared';

import type { PermissionDefinition } from '../permissions/index.js';
import type { RoleDefinition, RoleScope } from '../roles.js';

/** A route as the matrix reads it: plain data from a `defineRoute` descriptor or an openapi.yaml operation. */
export interface MatrixRoute {
  readonly operationId: string;
  readonly method: string;
  /** Express (`/a/:id`) or OpenAPI (`/a/{id}`) form. */
  readonly path: string;
  /** A catalogued permission or a route marker (`public`, `authenticated`). */
  readonly permission: string;
  readonly tenancy: string;
  /** The credential kinds the route accepts (`RouteDescriptor.auth`, the contract's `security` alternatives). */
  readonly auth: readonly string[];
  /** Dual-mode routes only: the permission a session caller must hold (`x-permission-authenticated`). */
  readonly permissionAuthenticated?: string | undefined;
  /** `x-mfa-gate-exempt`: staff without a verified factor may pass the MFA gate. */
  readonly mfaGateExempt?: boolean | undefined;
}

/** A credential kind a caller presents; `none` is the absence of a credential. */
export type PresentedKind = 'none' | 'session' | 'refresh-cookie' | 'quote-token' | 'signature';

/** One column of the matrix. */
export type MatrixCaller =
  | { readonly id: 'none'; readonly kind: 'none' }
  | {
      readonly id: string;
      readonly kind: 'role';
      readonly role: string;
      readonly scope: RoleScope;
      /** OPERATOR roles: `pending` (staff before TOTP) or `verified`; customer and partner roles: `n/a`. */
      readonly factor: 'pending' | 'verified' | 'n/a';
      /** The role's grants (its seeded permissions). */
      readonly grants: ReadonlySet<string>;
    }
  | {
      readonly id: string;
      readonly kind: 'credential';
      readonly credential: 'session' | 'refresh-cookie' | 'quote-token';
      readonly valid: boolean;
    }
  | { readonly id: string; readonly kind: 'signature'; readonly holds: boolean }
  /** A real provider signature header (PR48-SEC-01): presented only where the route does not declare `signature`. */
  | { readonly id: string; readonly kind: 'signature-header'; readonly header: string };

/**
 * The real provider signature headers (Stripe, the mock gateway, the carrier push): the names of
 * `CREDENTIAL_HEADER_NAMES` (D-ARCH-113 (1)) that end in `-signature`. A new provider header WITH that suffix gets its
 * foreign column without an edit here; one without it (`x-hub-signature-256`, `x-<carrier>-hmac`) fails the totality
 * test of matrix.test.ts until it gets a column or an entry in `UNPRESENTED_CREDENTIAL_HEADERS` (PR #60 R1-m1).
 */
export const SIGNATURE_HEADER_NAMES: readonly string[] = Object.freeze(
  CREDENTIAL_HEADER_NAMES.filter((name) => name.endsWith('-signature')),
);

/**
 * The credential headers no matrix caller presents yet, each with the task that adds its foreign column and generator
 * rule (PR60-SEC-02): the CSRF token and the re-authentication proof are proofs, not `ROUTE_AUTHS` kinds. Every other
 * `CREDENTIAL_HEADER_NAMES` entry must be presented by some caller (matrix.test.ts).
 */
export const UNPRESENTED_CREDENTIAL_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'x-csrf-token': 'TASK-048',
  'x-reauth-proof': 'TASK-187',
});

/** The column id of the caller presenting the real signature header `name`. */
export const signatureHeaderId = (name: string): string => `signature-header:${name}`;

/** Ids of the fixed (non-role) callers. */
export const FIXED_CALLERS = {
  none: 'none',
  expiredBearer: 'session:expired',
  refreshCookie: 'refresh-cookie:valid',
  unknownRefreshCookie: 'refresh-cookie:unknown',
  guest: 'quote-token:valid',
  unknownGuestToken: 'quote-token:unknown',
  signatureHolds: 'signature:holds',
  signatureLacks: 'signature:lacks',
} as const;

/** The column id of a staff caller with a verified second factor. */
export const verifiedId = (role: string): string => `${role}+mfa`;

export type CellOutcome = 'allow' | 'deny-401' | 'deny-403' | 'deny-403-mfa';

/** The status and problem code of a refusal (the platform catalogue codes). */
export const REFUSALS: Readonly<Record<Exclude<CellOutcome, 'allow'>, { readonly status: 401 | 403; readonly code: string }>> = {
  'deny-401': { status: 401, code: 'AUTH_REQUIRED' },
  'deny-403': { status: 403, code: 'AUTHZ_DENIED' },
  'deny-403-mfa': { status: 403, code: 'AUTHZ_DENIED' },
};

export interface MatrixCell {
  readonly caller: string;
  readonly outcome: CellOutcome;
  /** `Cache-Control: private, no-store` is expected (SEC-TC-29). */
  readonly private: boolean;
  /** Set when the caller's credential is outside the route's set: the cell must equal the `none` cell (D-ARCH-109). */
  readonly foreign: boolean;
}

export interface MatrixRow {
  readonly route: MatrixRoute;
  readonly cells: readonly MatrixCell[];
}

export interface RouteMatrix {
  readonly callers: readonly MatrixCaller[];
  readonly rows: readonly MatrixRow[];
}

/** What the generator reads besides the routes. */
export interface MatrixSource {
  readonly roles: readonly RoleDefinition<string, string>[];
  readonly catalogue: readonly PermissionDefinition[];
}

/**
 * Every column: `none`, the roles (seed order), the verified staff variants, the fixed credentials, the signatures,
 * the real signature headers.
 */
export function matrixCallers(roles: readonly RoleDefinition<string, string>[]): MatrixCaller[] {
  const role = (definition: RoleDefinition<string, string>, factor: 'pending' | 'verified' | 'n/a', id: string): MatrixCaller => ({
    id,
    kind: 'role',
    role: definition.key,
    scope: definition.scope,
    factor,
    grants: new Set<string>(definition.permissions),
  });
  const operators = roles.filter((definition) => definition.scope === 'OPERATOR');
  return [
    { id: FIXED_CALLERS.none, kind: 'none' },
    ...roles.map((definition) => role(definition, definition.scope === 'OPERATOR' ? 'pending' : 'n/a', definition.key)),
    ...operators.map((definition) => role(definition, 'verified', verifiedId(definition.key))),
    { id: FIXED_CALLERS.expiredBearer, kind: 'credential', credential: 'session', valid: false },
    { id: FIXED_CALLERS.refreshCookie, kind: 'credential', credential: 'refresh-cookie', valid: true },
    { id: FIXED_CALLERS.unknownRefreshCookie, kind: 'credential', credential: 'refresh-cookie', valid: false },
    { id: FIXED_CALLERS.guest, kind: 'credential', credential: 'quote-token', valid: true },
    { id: FIXED_CALLERS.unknownGuestToken, kind: 'credential', credential: 'quote-token', valid: false },
    { id: FIXED_CALLERS.signatureHolds, kind: 'signature', holds: true },
    { id: FIXED_CALLERS.signatureLacks, kind: 'signature', holds: false },
    ...SIGNATURE_HEADER_NAMES.map((header): MatrixCaller => ({ id: signatureHeaderId(header), kind: 'signature-header', header })),
  ];
}

/** The credential kind the caller presents. */
export function presentedKind(caller: MatrixCaller): PresentedKind {
  switch (caller.kind) {
    case 'none':
      return 'none';
    case 'role':
      return 'session';
    case 'credential':
      return caller.credential;
    case 'signature':
    case 'signature-header':
      return 'signature';
  }
}

/**
 * The synthetic signature callers exist only on routes that accept a signature (no header of another route carries
 * one); the real signature headers exactly on the other routes, where they are foreign (PR48-SEC-01).
 */
export function appliesTo(caller: MatrixCaller, route: MatrixRoute): boolean {
  if (caller.kind === 'signature') return route.auth.includes('signature');
  if (caller.kind === 'signature-header') return !route.auth.includes('signature');
  return true;
}

/** The principal the pipeline builds for a verified credential (only what the gates read). */
interface GatePrincipal {
  readonly credential: PresentedKind | 'anonymous';
  /** A user actor (a session); guests, refresh-cookie callers and providers have none. */
  readonly authenticated: boolean;
  readonly staffPending: boolean;
  /** The permissions it holds in the active organisation. */
  readonly held: ReadonlySet<string>;
}

const NOTHING: ReadonlySet<string> = new Set<string>();

const ANONYMOUS: GatePrincipal = { credential: 'anonymous', authenticated: false, staffPending: false, held: NOTHING };

/** Step 4, the permission gate of the authorise slot (the credential gate has passed). */
function permissionGate(route: MatrixRoute, principal: GatePrincipal, signatureOnly: ReadonlySet<string>): CellOutcome {
  if (route.permission === 'public') {
    const required = route.permissionAuthenticated;
    return required !== undefined && principal.credential === 'session' && !principal.held.has(required) ? 'deny-403' : 'allow';
  }
  if (signatureOnly.has(route.permission)) {
    if (principal.credential !== 'signature') return 'deny-401';
    return principal.held.has(route.permission) ? 'allow' : 'deny-403';
  }
  if (!principal.authenticated) return 'deny-401';
  return route.permission === 'authenticated' || principal.held.has(route.permission) ? 'allow' : 'deny-403';
}

/** The principal of a declared, verifying credential. */
function principalOf(caller: Exclude<MatrixCaller, { kind: 'none' | 'signature-header' }>, route: MatrixRoute): GatePrincipal {
  switch (caller.kind) {
    case 'role':
      return { credential: 'session', authenticated: true, staffPending: caller.factor === 'pending', held: caller.grants };
    case 'signature':
      return {
        credential: 'signature',
        authenticated: false,
        staffPending: false,
        held: caller.holds ? new Set([route.permission]) : NOTHING,
      };
    case 'credential':
      return { credential: caller.credential, authenticated: false, staffPending: false, held: NOTHING };
  }
}

/** The outcome of one cell: the authenticate, MFA-gate and authorise rules of the module comment. */
export function expectCell(route: MatrixRoute, caller: MatrixCaller, signatureOnly: ReadonlySet<string>): MatrixCell {
  const kind = presentedKind(caller);
  const anonymousAllowed = route.auth.includes('anonymous');
  const declared = kind !== 'none' && route.auth.includes(kind);
  const cell = (outcome: CellOutcome): MatrixCell => ({
    caller: caller.id,
    outcome,
    private: !anonymousAllowed || declared,
    foreign: kind !== 'none' && !declared,
  });
  if (caller.kind === 'none' || !declared) return cell(anonymousAllowed ? permissionGate(route, ANONYMOUS, signatureOnly) : 'deny-401');
  // Rule 2; a real signature header is declared only on a signature route, which `appliesTo` never pairs with it.
  if ((caller.kind === 'credential' && !caller.valid) || caller.kind === 'signature-header') return cell('deny-401');
  const principal = principalOf(caller, route);
  if (principal.staffPending && route.mfaGateExempt !== true) return cell('deny-403-mfa');
  return cell(permissionGate(route, principal, signatureOnly));
}

/** The catalogue permissions only a provider signature satisfies. */
export const signatureOnlyOf = (catalogue: readonly PermissionDefinition[]): ReadonlySet<string> =>
  new Set(catalogue.filter((definition) => definition.signatureOnly === true).map((definition) => definition.key));

/** The matrix: one row per route (input order), one cell per applicable caller (column order). */
export function generateMatrix(routes: readonly MatrixRoute[], source: MatrixSource): RouteMatrix {
  const callers = matrixCallers(source.roles);
  const signatureOnly = signatureOnlyOf(source.catalogue);
  return {
    callers,
    rows: routes.map((route) => ({
      route,
      cells: callers.filter((caller) => appliesTo(caller, route)).map((caller) => expectCell(route, caller, signatureOnly)),
    })),
  };
}
