/**
 * Pipeline step 8-10, the tx slot (DR-A08, ADR-0005 am. 10 and am. 11, ADR-0003 amendment 2026-11-13, threat model §4.3
 * and T-83; TASK-020 parts A and C). For a `transaction: 'tenant'` route it runs, in this order:
 *  1. `load` (optional) in one short READ-ONLY `withTenantTx` (a write fails with SQLSTATE 25006), committed;
 *  2. `call` (optional) with no transaction, no database handle and an AbortSignal (request deadline, client gone);
 *  3. `handler` plus the audit hook in ONE `withTenantTx`, the only write transaction, committed;
 *  4. send the handler's result (a stream result is completed here, after COMMIT; TASK-044 owns its framing);
 *  5. `afterCommit` (optional), scheduled after the response, best effort, drained at shutdown.
 * So a rollback (failed audit write, serialisation failure) never sends a 2xx, and no admission permit (D-ARCH-086) or
 * connection is held across `call`: each `withTenantTx` takes and releases its own. A route with only a `handler` is
 * exactly one transaction, as before part C. This is the only per-request `withTenantTx` entry of the API (PR11-SEC-09
 * verification point, D-ORCH-014, D-ARCH-074): the runner comes from the database runtime (`platform/db/runtime.ts`,
 * through `RuntimeServices.tenantTx`), never from `platform/db/client.ts`. A data-layer failure surfaces as the
 * `DbError` the runner throws; the problem handler answers it with the catalogue code, `Retry-After` when retryable and
 * the generic text, never its reason. `transaction: 'none'` routes (health) run `handler` and `afterCommit` without a
 * transaction and get no database handle. No external call may run inside a transaction callback (T-83 lint).
 */
import { ANONYMOUS_ACTOR_ID, AppError, SYSTEM_ACTOR_ID } from '@platform/shared';
import type { Request, Response } from 'express';

import { type AuditHook, captureAudit } from '../audit/capture.js';
import { requestContextOf } from '../context/request-context.js';
import type { TenantContext, TenantTxRunner } from '../db/index.js';
import type {
  PhaseResults,
  Principal,
  RouteContext,
  RouteDescriptor,
  RouteRequestContext,
  RouteResult,
  RouteTransport,
} from '../routing/define-route.js';
import { inputOf, isPrivateResponse, principalOf, PRIVATE_CACHE_CONTROL, routeTemplateOf } from '../routing/route-state.js';
import type { RouteSlot } from '../routing/slot.js';
import type { AfterCommitQueue } from './after-commit.js';

/**
 * The request deadline of the `call` phase (D-ARCH-106 (4)): its AbortSignal aborts after this long. Below the 25 s
 * shutdown drain (platform/runtime/shutdown.ts) so an in-flight call cannot outlive the stop window; external clients
 * keep their own, shorter timeouts (ADR-0011, TASK-113).
 */
export const CALL_DEADLINE_MS = 20_000;

export interface ExecuteOptions {
  /**
   * `RuntimeServices.tenantTx` (always defined since TASK-020 part 020-B, D-ARCH-104). Optional only for test
   * compositions: createApp refuses a tenant route without it (assertPipelineReady), and this slot answers 503 as the
   * last line of defence.
   */
  readonly tenantTx: TenantTxRunner<unknown> | undefined;
  readonly audit?: AuditHook;
  /**
   * Runs the `afterCommit` phases and drains them at shutdown (createApp passes the process's queue). Required by a
   * route that declares `afterCommit`: without it the slot refuses the route when it is mounted.
   */
  readonly afterCommit?: AfterCommitQueue;
  /** Test seam: the `call` deadline (default `CALL_DEADLINE_MS`). */
  readonly callDeadlineMs?: number;
}

/** Ids no request may act as: SYSTEM is for jobs and seeds, ANONYMOUS is stamped by the extension (PR26-SEC-04). */
const RESERVED_ACTOR_IDS: ReadonlySet<string> = new Set([SYSTEM_ACTOR_ID, ANONYMOUS_ACTOR_ID]);

export class RequestContextError extends Error {
  constructor(reason: string) {
    super(`request context refused: ${reason}`);
    this.name = 'RequestContextError';
  }
}

/** A route declares `afterCommit` but the composition supplied no queue to run and drain it (a wiring bug). */
export class AfterCommitNotWiredError extends Error {
  constructor(readonly operationId: string) {
    super(`route ${operationId} declares afterCommit, but the tx slot has no afterCommit queue`);
    this.name = 'AfterCommitNotWiredError';
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

/** A handler result the slot cannot send: a pipeline or handler bug, answered 500. */
export class RouteResultError extends Error {
  constructor(operationId: string, what: string) {
    super(`route ${operationId}: ${what}`);
    this.name = 'RouteResultError';
  }
}

/**
 * Sends the handler's result. On a response the authn slot marked as authenticated, `Cache-Control: private, no-store`
 * is re-asserted after the handler's headers, so a handler can never make an authenticated response cacheable
 * (SEC-TC-29, PR #32 m1 (a), PR32-SEC-06 (b)). A stream result sends the status line and headers here; its body is
 * completed by `completeStream` (part 020-C (f)).
 */
function send(res: Response, result: RouteResult): void {
  res.removeHeader('X-Powered-By');
  for (const [name, value] of Object.entries(result.headers ?? {})) res.setHeader(name, value);
  if (isPrivateResponse(res)) res.setHeader('Cache-Control', PRIVATE_CACHE_CONTROL);
  res.status(result.status);
  if (result.stream !== undefined) res.flushHeaders();
  else if (result.body === undefined) res.end();
  else res.json(result.body);
}

/**
 * Part 020-C (f), the stream hook: a stream result is completed after COMMIT, through a sink that writes the body and
 * nothing else (no status, no headers); the result type and the SSE framing belong to TASK-044. The response ends when
 * the stream settles; a throw after the headers went out cannot become a problem document, so the connection closes.
 */
async function completeStream(res: Response, result: RouteResult, signal: AbortSignal): Promise<void> {
  const stream = result.stream;
  if (stream === undefined) return;
  try {
    await stream.complete({ write: (chunk) => void res.write(chunk) }, signal);
    res.end();
  } catch (error) {
    res.destroy();
    throw error;
  }
}

/** Aborts on the request deadline or when the client goes away before the response finished. */
function requestSignal(res: Response, deadlineMs: number): { readonly signal: AbortSignal; readonly release: () => void } {
  const gone = new AbortController();
  const onClose = (): void => {
    if (!res.writableFinished) gone.abort(new AppError('SERVICE_UNAVAILABLE', { cause: new Error('client closed the request') }));
  };
  res.once('close', onClose);
  return {
    signal: AbortSignal.any([gone.signal, AbortSignal.timeout(deadlineMs)]),
    release: () => res.off('close', onClose),
  };
}

/** The frozen transport view a handler may read (PR32-SEC-05 (c), PR #32 n4): never the live request or response. */
export function transportOf(req: Request): RouteTransport {
  return Object.freeze({ ip: req.ip ?? '', userAgent: req.get('user-agent') ?? '' });
}

interface Phases {
  readonly route: RouteDescriptor;
  readonly request: RouteRequestContext;
  readonly options: ExecuteOptions;
  readonly audit: AuditHook;
  readonly signal: () => AbortSignal;
}

/** Steps 1-3 for a tenant route; `transaction: 'none'` runs the handler (and its audit hook) without a transaction. */
async function run({ route, request, options, audit, signal }: Phases): Promise<RouteResult> {
  const write = async (db: unknown, phases: PhaseResults<unknown, unknown>): Promise<RouteResult> => {
    const ctx: RouteContext = Object.freeze({ ...request, db });
    // The descriptor erases the phase result types; this is the one place that hands them on (define-route.ts).
    const result = await route.handler(ctx, phases as PhaseResults<never, never>);
    await audit(ctx, result);
    return result;
  };
  const none: PhaseResults<unknown, unknown> = Object.freeze({ loaded: undefined, called: undefined });
  if (route.transaction === 'none') return write(undefined, none);
  if (options.tenantTx === undefined) throw new AppError('SERVICE_UNAVAILABLE', { cause: new Error('no tenant transaction runner') });
  const runner = options.tenantTx;
  const tenant = tenantContextOf(request.principal, request.correlationId);
  const { load, call } = route;
  const loaded =
    load === undefined
      ? undefined
      : await runner.withTenantTx(tenant, async (db) => await load(Object.freeze({ ...request, db })), { readOnly: true });
  const called = call === undefined ? undefined : await call(Object.freeze({ ...request, signal: signal() }), loaded as never);
  return runner.withTenantTx(tenant, (db) => write(db, Object.freeze({ loaded, called })));
}

export function executeSlot(options: ExecuteOptions): RouteSlot {
  return (route) => {
    // Chosen at mount time: the audit stub refuses an audited route before it can be served (PR32-SEC-03).
    const audit = options.audit ?? captureAudit(route);
    const queue = options.afterCommit;
    if (route.afterCommit !== undefined && queue === undefined) throw new AfterCommitNotWiredError(route.operationId);
    const deadlineMs = options.callDeadlineMs ?? CALL_DEADLINE_MS;
    return async (req: Request, res: Response) => {
      const correlationId = requestContextOf(res)?.correlationId ?? '';
      const request: RouteRequestContext = Object.freeze({
        route,
        input: inputOf(res),
        principal: principalOf(res),
        correlationId,
        transport: transportOf(req),
      });
      let lifetime: ReturnType<typeof requestSignal> | undefined;
      const signal = (): AbortSignal => (lifetime ??= requestSignal(res, deadlineMs)).signal;
      try {
        const result = await run({ route, request, options, audit, signal });
        if (result.stream !== undefined && result.body !== undefined) {
          throw new RouteResultError(route.operationId, 'a stream result has no body');
        }
        send(res, result);
        await completeStream(res, result, signal());
        const afterCommit = route.afterCommit;
        if (afterCommit !== undefined && queue !== undefined) {
          const label = { route: routeTemplateOf(res) ?? route.path, operationId: route.operationId, correlationId };
          queue.schedule(() => afterCommit(request, result), label);
        }
      } finally {
        lifetime?.release();
      }
    };
  };
}
