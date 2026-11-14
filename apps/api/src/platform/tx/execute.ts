/**
 * Pipeline step 8-9, the tx slot (DR-A08, ADR-0005 am. 10, threat model §4.3; TASK-020): runs the handler and the audit
 * hook inside ONE `withTenantTx` per request, then sends the handler's result after COMMIT, so a rollback (failed audit
 * write, serialisation failure) never sends a 2xx. This is the only per-request `withTenantTx` entry of the API
 * (PR11-SEC-09 verification point, D-ORCH-014, D-ARCH-074): the runner comes from the database runtime
 * (`platform/db/runtime.ts`, through `RuntimeServices.tenantTx`), never from `platform/db/client.ts`. A data-layer
 * failure surfaces as the `DbError` the runner throws; the problem handler answers it with the catalogue code,
 * `Retry-After` when retryable and the generic text, never its reason. `transaction: 'none'` routes (health) run
 * without a transaction and get no database handle. No external call may run inside the callback (T-83 lint).
 */
import { ANONYMOUS_ACTOR_ID, AppError, SYSTEM_ACTOR_ID } from '@platform/shared';
import type { Request, Response } from 'express';

import { type AuditHook, captureAudit } from '../audit/capture.js';
import { requestContextOf } from '../context/request-context.js';
import type { TenantContext, TenantTxRunner } from '../db/index.js';
import type { Principal, RouteContext, RouteDescriptor, RouteResult, RouteTransport } from '../routing/define-route.js';
import { inputOf, isPrivateResponse, principalOf, PRIVATE_CACHE_CONTROL } from '../routing/route-state.js';
import type { RouteSlot } from '../routing/slot.js';

export interface ExecuteOptions {
  /**
   * `RuntimeServices.tenantTx` (always defined since TASK-020 part 020-B, D-ARCH-104). Optional only for test
   * compositions: createApp refuses a tenant route without it (assertPipelineReady), and this slot answers 503 as the
   * last line of defence.
   */
  readonly tenantTx: TenantTxRunner<unknown> | undefined;
  readonly audit?: AuditHook;
}

/** Ids no request may act as: SYSTEM is for jobs and seeds, ANONYMOUS is stamped by the extension (PR26-SEC-04). */
const RESERVED_ACTOR_IDS: ReadonlySet<string> = new Set([SYSTEM_ACTOR_ID, ANONYMOUS_ACTOR_ID]);

export class RequestContextError extends Error {
  constructor(reason: string) {
    super(`request context refused: ${reason}`);
    this.name = 'RequestContextError';
  }
}

/**
 * The request's tenant context (PR26-SEC-04 context-builder checks): an anonymous principal carries no actor and the
 * TENANT scope; an authenticated one carries a non-reserved actor; an OPERATOR context always has a real actor. A
 * violation is a pipeline bug, so it fails the request (500) instead of attributing writes to SYSTEM or anonymous.
 * An authenticated TENANT principal always has an active organisation (PR #32 n3). Guest (quote-token) and provider
 * (signature) principals are not authenticated in this sense: no actor, `authenticated: false` (D-ARCH-107 (4)).
 */
export function tenantContextOf(principal: Principal, correlationId: string): TenantContext {
  if (RESERVED_ACTOR_IDS.has(principal.actorId)) throw new RequestContextError('a request may not act as a reserved actor');
  if (principal.authenticated !== (principal.actorId !== '')) throw new RequestContextError('actor and authentication disagree');
  if (principal.actorScope === 'OPERATOR' && principal.actorId === '') throw new RequestContextError('an OPERATOR context needs an actor');
  if (principal.authenticated && principal.actorScope === 'TENANT' && principal.orgId === '') {
    throw new RequestContextError('an authenticated TENANT context needs an organisation');
  }
  return {
    orgId: principal.orgId,
    actorId: principal.actorId,
    actorScope: principal.actorScope,
    guestTokenHash: principal.guestTokenHash,
    correlationId,
  };
}

/**
 * Sends the handler's result. On a response the authn slot marked as authenticated, `Cache-Control: private, no-store`
 * is re-asserted after the handler's headers, so a handler can never make an authenticated response cacheable
 * (SEC-TC-29, PR #32 m1 (a), PR32-SEC-06 (b)).
 */
function send(res: Response, result: RouteResult): void {
  res.removeHeader('X-Powered-By');
  for (const [name, value] of Object.entries(result.headers ?? {})) res.setHeader(name, value);
  if (isPrivateResponse(res)) res.setHeader('Cache-Control', PRIVATE_CACHE_CONTROL);
  res.status(result.status);
  if (result.body === undefined) res.end();
  else res.json(result.body);
}

async function run(route: RouteDescriptor, ctx: Omit<RouteContext, 'db'>, options: ExecuteOptions, audit: AuditHook): Promise<RouteResult> {
  const inTransaction = async (db: unknown): Promise<RouteResult> => {
    const full: RouteContext = { ...ctx, db };
    const result = await route.handler(full);
    await audit(full, result);
    return result;
  };
  if (route.transaction === 'none') return inTransaction(undefined);
  if (options.tenantTx === undefined) throw new AppError('SERVICE_UNAVAILABLE', { cause: new Error('no tenant transaction runner') });
  return options.tenantTx.withTenantTx(tenantContextOf(ctx.principal, ctx.correlationId), inTransaction);
}

/** The frozen transport view a handler may read (PR32-SEC-05 (c), PR #32 n4): never the live request or response. */
export function transportOf(req: Request): RouteTransport {
  return Object.freeze({ ip: req.ip ?? '', userAgent: req.get('user-agent') ?? '' });
}

export function executeSlot(options: ExecuteOptions): RouteSlot {
  return (route) => {
    // Chosen at mount time: the audit stub refuses an audited route before it can be served (PR32-SEC-03).
    const audit = options.audit ?? captureAudit(route);
    return async (req: Request, res: Response) => {
      const correlationId = requestContextOf(res)?.correlationId ?? '';
      const ctx = { route, input: inputOf(res), principal: principalOf(res), correlationId, transport: transportOf(req) };
      send(res, await run(route, ctx, options, audit));
    };
  };
}
