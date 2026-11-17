/**
 * The app the rbac-matrix suite calls (US-071; TASK-027, TASK-289): `createApp` with the production slots for
 * authentication fallback, MFA gate and authorisation, and three test seams around them.
 *
 *  - `matrixAuthenticate`: the authenticators that verify a bearer, a refresh cookie, a guest token or a provider
 *    signature do not exist yet (TASK-052/055/091/171/261; the stub verifies nothing). This slot resolves the matrix's
 *    synthetic test credentials (`callerHeaders`) to principals, only for the kinds in `STUBBED_CREDENTIAL_KINDS` and
 *    only for the kinds the route DECLARES (`presentedKinds(headers, route.auth)`, D-ARCH-109): a foreign credential is
 *    never read. Every other request (no declared credential, or one that does not resolve: the expired bearer, the
 *    unknown cookie or token) goes to the production `authenticate` stub, which gives the anonymous principal or 401
 *    `AUTH_REQUIRED` exactly as in production.
 *
 * What the matrix therefore proves (truth in labelling; PR #48 code review R1-m2, PR48-SEC-05/06, D-ARCH-134): the
 * credential-kind selection (`presentedKinds`, D-ARCH-109), the production authenticate stub, the production MFA gate
 * for pending staff, and the PERMISSION gate of the production `authorise`. It does NOT prove the authenticators (they
 * do not exist; the seam stands in for them), and it does not reach the credential and actor gates of `authorise`
 * (a principal of an undeclared kind, a non-signature principal on a signature-only permission, an actor check): the
 * seam never builds such a principal, so those gates stay proven by apps/api platform/authz/authorise.test.ts until
 * each kind's seam retires with its authenticator task (TASK-052/055/091/171/261, TASK-067 for `+mfa`).
 *  - `matrixMfaGate`: a staff principal created for a `<ROLE>+mfa` column stands for a verified second factor, which
 *    no principal can carry until the MFA task lands; it passes, every other principal meets the production `mfaGate`
 *    (staff before TOTP: 403).
 *  - the terminal: steps 5-10 come after authorise in the fixed pipeline order (`ROUTE_PIPELINE`), so they cannot
 *    change an authorisation outcome; the matrix app replaces them with one slot that answers 204 with
 *    `x-rbac-matrix: authorised` (and a public `Cache-Control` unless the response was marked private), so an allowed
 *    cell is observable without a database, a body or a handler.
 *
 * The org-scope app (SEC-TC-01) keeps the production authorise and execute slots behind the same authentication
 * seams, with a runner whose database handle throws on first use: a route must refuse a foreign `{orgId}` with 404
 * before any query (ADR-0005 am. 3).
 */
import type { RouteAuth } from '@platform/authz';
import { type MatrixCaller, verifiedId } from '@platform/authz/matrix';
import { presentedKinds, REFRESH_COOKIE_NAMES } from '@platform/shared';
import type { Express, NextFunction, Request, Response } from 'express';

import { createApp, type ModuleRegistration } from '../../../apps/api/src/app.js';
import { authenticate } from '../../../apps/api/src/platform/authn/authenticate.js';
import { authorise } from '../../../apps/api/src/platform/authz/authorise.js';
import type { TenantTxRunner } from '../../../apps/api/src/platform/db/index.js';
import { mfaGate } from '../../../apps/api/src/platform/mfa/mfa-gate.js';
import type { Principal, RouteDescriptor } from '../../../apps/api/src/platform/routing/define-route.js';
import type { PipelineSlots } from '../../../apps/api/src/platform/routing/pipeline.js';
import {
  ANONYMOUS,
  isPrivateResponse,
  markCredentialsRead,
  markPrivateResponse,
  principalOf,
  readonlySet,
  setInput,
  setPrincipal,
} from '../../../apps/api/src/platform/routing/route-state.js';
import type { RouteSlot } from '../../../apps/api/src/platform/routing/slot.js';
import { executeSlot } from '../../../apps/api/src/platform/tx/execute.js';
import { stableHash, stableUuid } from '../rls/generator.js';

/** Response header of the terminal slot: the request passed authenticate, the MFA gate and authorise. */
export const REACHED_HEADER = 'x-rbac-matrix';
export const REACHED_VALUE = 'authorised';
/** The terminal's `Cache-Control` on a response nothing marked private (so a wrongly private answer is visible). */
export const PUBLIC_CACHE_CONTROL = 'public, max-age=60';
/** Test-only signature header, read only on routes that declare `signature`. */
export const SIGNATURE_HEADER = 'x-rbac-matrix-signature';
/** The value a `signature-header:<name>` caller presents in the real provider header `<name>` (PR48-SEC-01). */
export const FOREIGN_SIGNATURE_VALUE = 't=0,v1=0';

/**
 * The credential kinds the seam still resolves in place of a real authenticator (the still-stubbed list, D-ARCH-134).
 * Each authenticator task deletes its kind here and its branch of `resolvePrincipal`, and presents a real test
 * credential through the real slot; TASK-052's tripwire fails when a kind is both listed here and mounted by createApp.
 * `resolvePrincipal` reads this list, so a kind removed here is no longer resolved by the seam.
 */
export const STUBBED_CREDENTIAL_KINDS: readonly Exclude<RouteAuth, 'anonymous'>[] = Object.freeze([
  'session',
  'refresh-cookie',
  'quote-token',
  'signature',
]);

/** Synthetic test credentials: matrix labels, never secrets (nothing verifies them but this file). */
const TOKEN_PREFIX = 'rbac-matrix.';
const VALID = `${TOKEN_PREFIX}valid`;
const UNKNOWN = `${TOKEN_PREFIX}unknown`;

/** The organisations of the matrix principals: one per role scope, plus the foreign organisation B of SEC-TC-01. */
export const MATRIX_ORGS = {
  OPERATOR: stableUuid('rbac-matrix:org:operator'),
  CUSTOMER: stableUuid('rbac-matrix:org:customer-a'),
  PARTNER: stableUuid('rbac-matrix:org:partner'),
  FOREIGN: stableUuid('rbac-matrix:org:customer-b'),
} as const;

/**
 * The refresh cookie name a caller presents: the web cookie for the valid one, the admin cookie for the unknown one,
 * so both names are presented as a foreign credential on every route outside `[refresh-cookie]` (PR #48 R1-n2).
 */
export const refreshCookieName = (valid: boolean): string => String(REFRESH_COOKIE_NAMES[valid ? 0 : 1]);

/** The request headers that present `caller`'s credential (none for `none`). */
export function callerHeaders(caller: MatrixCaller): Record<string, string> {
  switch (caller.kind) {
    case 'none':
      return {};
    case 'role':
      return { authorization: `Bearer ${TOKEN_PREFIX}${caller.id}` };
    case 'signature':
      return { [SIGNATURE_HEADER]: caller.holds ? 'holds' : 'lacks' };
    case 'signature-header':
      return { [caller.header]: FOREIGN_SIGNATURE_VALUE };
    case 'credential':
      if (caller.credential === 'session') return { authorization: `Bearer ${TOKEN_PREFIX}expired` };
      if (caller.credential === 'refresh-cookie') return { cookie: `${refreshCookieName(caller.valid)}=${caller.valid ? VALID : UNKNOWN}` };
      return { 'x-quote-token': caller.valid ? VALID : UNKNOWN };
  }
}

/** The principals of the role callers (bearer token -> principal); `verified` holds the `+mfa` ones. */
export interface MatrixPrincipals {
  readonly byToken: ReadonlyMap<string, Principal>;
  readonly verified: ReadonlySet<Principal>;
}

export function matrixPrincipals(callers: readonly MatrixCaller[]): MatrixPrincipals {
  const byToken = new Map<string, Principal>();
  const verified = new Set<Principal>();
  for (const caller of callers) {
    if (caller.kind !== 'role') continue;
    const principal: Principal = Object.freeze({
      credential: 'session',
      authenticated: true,
      actorId: stableUuid(`rbac-matrix:actor:${caller.role}`),
      orgId: MATRIX_ORGS[caller.scope],
      actorScope: caller.scope === 'OPERATOR' ? 'OPERATOR' : 'TENANT',
      guestTokenHash: '',
      permissions: readonlySet(caller.grants),
    });
    byToken.set(`Bearer ${TOKEN_PREFIX}${caller.id}`, principal);
    if (caller.id === verifiedId(caller.role)) verified.add(principal);
  }
  return { byToken, verified };
}

const GUEST: Principal = Object.freeze({ ...ANONYMOUS, credential: 'quote-token', guestTokenHash: stableHash('rbac-matrix:guest') });
const REFRESH: Principal = Object.freeze({ ...ANONYMOUS, credential: 'refresh-cookie' });

const header = (req: Request, name: string): string | undefined => {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
};

/** `kind` is declared by the route and still stubbed (no real authenticator yet). */
const seamed = (route: RouteDescriptor, kind: Exclude<RouteAuth, 'anonymous'>): boolean =>
  route.auth.includes(kind) && STUBBED_CREDENTIAL_KINDS.includes(kind);

/**
 * The principal of the one declared, still-stubbed test credential the request presents, or undefined (the
 * production stub decides). Only declared kinds: the seam can never build a principal of a kind outside `route.auth`.
 */
function resolvePrincipal(route: RouteDescriptor, req: Request, principals: MatrixPrincipals): Principal | undefined {
  const [kind] = presentedKinds(req.headers, route.auth);
  if (kind !== undefined) {
    if (!seamed(route, kind)) return undefined;
    if (kind === 'session') return principals.byToken.get(header(req, 'authorization') ?? '');
    if (kind === 'refresh-cookie') return header(req, 'cookie')?.endsWith(`=${VALID}`) === true ? REFRESH : undefined;
    return header(req, 'x-quote-token') === VALID ? GUEST : undefined;
  }
  const signature = seamed(route, 'signature') ? header(req, SIGNATURE_HEADER) : undefined;
  if (signature === undefined) return undefined;
  return Object.freeze({
    ...ANONYMOUS,
    credential: 'signature',
    permissions: readonlySet(signature === 'holds' ? [route.permission] : []),
  });
}

export const matrixAuthenticate =
  (principals: MatrixPrincipals): RouteSlot =>
  (route) => {
    const production = authenticate(route);
    return (req: Request, res: Response, next: NextFunction) => {
      const principal = resolvePrincipal(route, req, principals);
      if (principal === undefined) {
        production(req, res, next);
        return;
      }
      // What every real authenticator does with a verified declared credential (authenticate.ts, D-ARCH-109).
      markCredentialsRead(res);
      markPrivateResponse(res);
      setPrincipal(res, principal);
      next();
    };
  };

export const matrixMfaGate =
  (principals: MatrixPrincipals): RouteSlot =>
  (route) => {
    const production = mfaGate(route);
    return (req: Request, res: Response, next: NextFunction) => {
      if (principals.verified.has(principalOf(res))) next();
      else production(req, res, next);
    };
  };

const passThrough: RouteSlot = () => (_req, _res, next) => {
  next();
};

const terminal: RouteSlot = () => (_req: Request, res: Response) => {
  res.setHeader(REACHED_HEADER, REACHED_VALUE);
  if (!isPrivateResponse(res)) res.setHeader('Cache-Control', PUBLIC_CACHE_CONTROL);
  res.status(204).end();
};

/** The authorisation app's slots: authentication seams, production authorise, then the terminal. */
export function matrixSlots(principals: MatrixPrincipals): PipelineSlots {
  return {
    authenticate: matrixAuthenticate(principals),
    mfaGate: matrixMfaGate(principals),
    authorise,
    rateLimit: passThrough,
    validate: passThrough,
    idempotency: passThrough,
    etag: passThrough,
    execute: terminal,
  };
}

/** Thrown by the org-scope app's database handle: the route reached the database for a foreign organisation. */
export class DatabaseReachedError extends Error {
  constructor() {
    super('the route reached the database before refusing a foreign {orgId}');
    this.name = 'DatabaseReachedError';
  }
}

const inertDb: unknown = new Proxy(
  {},
  {
    get: () => {
      throw new DatabaseReachedError();
    },
  },
);

/** A runner that opens no transaction and hands the route a handle that throws on first use. */
export const inertRunner: TenantTxRunner<unknown> = {
  transactionOptions: { maxWait: 1, timeout: 1 },
  probeFreshConnection: () => Promise.resolve(),
  withTenantTx: <R>(_ctx: unknown, fn: (db: never) => Promise<R>): Promise<R> => fn(inertDb as never),
};

/**
 * The org-scope app's input step: the raw path parameters, unvalidated. A foreign `{orgId}` must be refused whatever
 * the body or query, so the case sends neither and does not let validation answer first.
 */
const rawInput: RouteSlot = () => (req: Request, res: Response, next: NextFunction) => {
  setInput(res, { params: { ...req.params }, query: {}, body: undefined, headers: {} });
  next();
};

/**
 * The org-scope (SEC-TC-01) app's slots: the authentication seams, production authorise and execute. Rate limit,
 * idempotency and the If-Match precondition answer on the request's shape, not on its organisation, so they pass.
 */
export function orgScopeSlots(principals: MatrixPrincipals): PipelineSlots {
  return {
    authenticate: matrixAuthenticate(principals),
    mfaGate: matrixMfaGate(principals),
    authorise,
    rateLimit: passThrough,
    validate: rawInput,
    idempotency: passThrough,
    etag: passThrough,
    execute: executeSlot({ tenantTx: inertRunner, audit: () => Promise.resolve() }),
  };
}

const silentLogger = { info: () => undefined, debug: () => undefined, error: () => undefined };

/** createApp with `slots`; nothing listens. */
export function composeMatrixApp(
  health: readonly RouteDescriptor[],
  modules: readonly ModuleRegistration[],
  slots: PipelineSlots,
): Express {
  return createApp({ health, modules, tenantTx: inertRunner, pipeline: slots, logger: silentLogger });
}
