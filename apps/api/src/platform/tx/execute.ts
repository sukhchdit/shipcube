/**
 * Pipeline step 8-10, the tx slot (DR-A08, ADR-0005 am. 10 and am. 11, ADR-0003 amendment 2026-11-13, threat model §4.3
 * and T-83; TASK-020 parts A and C). For a `transaction: 'tenant'` route it runs, in this order:
 *  1. `load` (optional) in one short READ-ONLY `withTenantTx` (a write fails with SQLSTATE 25006), committed;
 *  2. `call` (optional) with no transaction, no database handle and an AbortSignal (request deadline, client gone). The
 *     deadline is ENFORCED (D-ORCH-069): the slot stops waiting when the signal aborts and answers a retryable 503
 *     (`Retry-After`), whether or not `call` honours the signal; a client already gone skips `call`;
 *  3. `handler` plus the audit hook in ONE `withTenantTx`, the only write transaction, committed (the hook records
 *     the route's entry and runs the transaction's one audit flush as its last database work, TASK-029). A returned
 *     status of 400 or more rolls it back and is sent as returned (D-TASK029-16); a VIEW / DOWNLOAD route's handler
 *     transaction is read-only (R1-m6);
 *  3a. a VIEW / DOWNLOAD route's entry in its own short transaction, before anything is sent (fail closed for
 *     SENSITIVE, 503 AUDIT_UNAVAILABLE); after a failed step 1, 2 or 3 of a mutating route, its FAILED entry (best
 *     effort, at most FAILED_ENTRY_WAIT_MS, none when the failure is the client's disconnect);
 *  4. send the handler's result (a stream result is completed here, after COMMIT, under the same signal and deadline;
 *     TASK-044 owns its framing);
 *  5. `afterCommit` (optional), scheduled once the write committed (also when sending or the stream fails afterwards),
 *     best effort, bounded and drained at shutdown (after-commit.ts).
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

import { type AuditCapture, type AuditHook, type MountedAudit, NOT_AUDITED, withoutCapture } from '../audit/capture.js';
import { requestContextOf } from '../context/request-context.js';
import type { TenantContext, TenantTxRunner } from '../db/index.js';
import {
  type PhaseResults,
  type Principal,
  type RouteContext,
  type RouteDescriptor,
  type RouteRequestContext,
  type RouteResult,
  RouteReturnedError,
  type RouteStream,
  type RouteTransport,
} from '../routing/define-route.js';
import { inputOf, isPrivateResponse, principalOf, PRIVATE_CACHE_CONTROL, routeTemplateOf } from '../routing/route-state.js';
import type { RouteSlot } from '../routing/slot.js';
import { abortable, deadline } from './abortable.js';
import type { AfterCommitQueue } from './after-commit.js';

/**
 * The request deadline of the `call` phase and of a stream (D-ARCH-106 (4), D-ORCH-069): armed when `call` (or, without
 * one, the stream) starts; at the deadline the signal aborts and the slot stops waiting, so an in-flight call cannot
 * outlive the stop window. Below the 25 s shutdown drain (platform/runtime/shutdown.ts, pinned by execute-phases.test.ts);
 * external clients keep their own, shorter timeouts (ADR-0011, TASK-113).
 */
export const CALL_DEADLINE_MS = 20_000;

/**
 * How long the slot waits for the best-effort FAILED entry of a failed request before it answers the failure (R1-m4):
 * the write goes on in its own transaction, but a slow one never holds the error response.
 */
export const FAILED_ENTRY_WAIT_MS = 1_000;

/** `Retry-After` of the 503 a deadline or an early disconnect answers (the request may simply be repeated). */
export const DEADLINE_RETRY_AFTER_SECONDS = 1;

export interface ExecuteOptions {
  /**
   * `RuntimeServices.tenantTx` (always defined since TASK-020 part 020-B, D-ARCH-104). Optional only for test
   * compositions: createApp refuses a tenant route without it (assertPipelineReady), and this slot answers 503 as the
   * last line of defence.
   */
  readonly tenantTx: TenantTxRunner<unknown> | undefined;
  /**
   * The audit capture (TASK-029; createApp builds it from `DB_AUDIT_LOCK_TIMEOUT_MS`). Without it an audited route is
   * refused when it is mounted (`withoutCapture`, PR32-SEC-03).
   */
  readonly capture?: AuditCapture;
  /** Test seam: replaces the in-transaction audit hook of every route (the capture's other steps stay off). */
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
 * nothing else (no status, no headers); the result type, the SSE framing and backpressure belong to TASK-044. The
 * response ends when the stream settles, and at the latest when the signal aborts (deadline or client gone): the slot
 * stops waiting for a stream that ignores it. A throw or an abort after the headers went out cannot become a problem
 * document, so the connection closes.
 */
async function completeStream(res: Response, stream: RouteStream, signal: AbortSignal): Promise<void> {
  try {
    await abortable(stream.complete({ write: (chunk) => void res.write(chunk) }, signal), signal);
    res.end();
  } catch (error) {
    res.destroy();
    throw error;
  }
}

/** The retryable 503 reason of an aborted request signal (a phase that rethrows it answers the same). */
function unavailable(why: string): AppError {
  return new AppError('SERVICE_UNAVAILABLE', { cause: new Error(why), retryAfterSeconds: DEADLINE_RETRY_AFTER_SECONDS });
}

interface RequestLifetime {
  /** The request signal; the first read arms the deadline (`call`, or the stream of a route without `call`). */
  readonly signal: () => AbortSignal;
  /**
   * `error` is this request's own disconnect abort (the client closed the connection before the response finished,
   * and that abort, not another failure, ended the request): it gets no FAILED entry (R1-m4, PR56-SEC-11).
   */
  readonly isDisconnect: (error: unknown) => boolean;
  readonly release: () => void;
}

/**
 * Created at slot entry, before `load` (PR #44 R1-m1): the signal aborts when the client goes away before the response
 * finished (also when it went before the slot ran) or at the deadline, with a retryable 503 `AppError` as the reason.
 */
function requestLifetime(res: Response, deadlineMs: number): RequestLifetime {
  const controller = new AbortController();
  const abort = (why: string): void => {
    if (!controller.signal.aborted) controller.abort(unavailable(why));
  };
  let disconnect: AppError | undefined;
  const onClose = (): void => {
    if (res.writableFinished || controller.signal.aborted) return;
    disconnect = unavailable('client closed the request');
    controller.abort(disconnect);
  };
  if (res.closed || res.destroyed) onClose();
  else res.once('close', onClose);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    signal: () => {
      if (timer === undefined) {
        timer = setTimeout(() => abort('request deadline exceeded'), deadlineMs);
        timer.unref();
      }
      return controller.signal;
    },
    isDisconnect: (error) => disconnect !== undefined && error === disconnect,
    release: () => {
      clearTimeout(timer);
      res.off('close', onClose);
    },
  };
}

/** The frozen transport view a handler may read (PR32-SEC-05 (c), PR #32 n4): never the live request or response. */
export function transportOf(req: Request, routeTemplate = ''): RouteTransport {
  return Object.freeze({
    ip: req.ip ?? '',
    userAgent: req.get('user-agent') ?? '',
    clientApp: req.get('x-client-app') ?? '',
    routeTemplate,
  });
}

interface Phases {
  readonly route: RouteDescriptor;
  readonly request: RouteRequestContext;
  readonly options: ExecuteOptions;
  readonly audit: MountedAudit;
  readonly lifetime: RequestLifetime;
}

/**
 * What steps 1-3 produced: the result to send, and whether the write committed. Only a committed result schedules
 * `afterCommit` (D-ARCH-106 (5)); a returned failure was rolled back (D-TASK029-16, PR56-SEC-10).
 */
interface RunOutcome {
  readonly result: RouteResult;
  readonly committed: boolean;
}

/** Steps 1-3 for a tenant route; `transaction: 'none'` runs the handler (and its audit hook) without a transaction. */
async function run({ route, request, options, audit, lifetime }: Phases): Promise<RunOutcome> {
  const write = async (db: unknown, phases: PhaseResults<unknown, unknown>): Promise<RouteResult> => {
    const ctx: RouteContext = Object.freeze({ ...request, db });
    // The descriptor erases the phase result types; this is the one place that hands them on (define-route.ts).
    const result = await route.handler(ctx, phases as PhaseResults<never, never>);
    // Inside the transaction (PR #44 R1-m2): a result the slot cannot send rolls the write back instead of answering
    // 500 after COMMIT, which a client would retry into a duplicate effect.
    if (result.stream !== undefined && result.body !== undefined) {
      throw new RouteResultError(route.operationId, 'a stream result has no body');
    }
    // D-TASK029-16 (ADR-0007 §Capture, REQ-AUDIT-010): a returned status of 400 or more commits nothing; the result is
    // sent as returned, and a 409, 422 or 5xx gets its FAILED entry in a transaction of its own.
    if (result.status >= 400 && db !== undefined) throw new RouteReturnedError(result);
    await audit.inTransaction(ctx, result);
    return result;
  };
  const none: PhaseResults<unknown, unknown> = Object.freeze({ loaded: undefined, called: undefined });
  // No transaction to roll back: the result is sent as returned; one rule with the tenant routes for afterCommit, which
  // runs after a result below 400 only (code review R2-n2, PR56-SEC-14).
  if (route.transaction === 'none') {
    const result = await write(undefined, none);
    return { result, committed: result.status < 400 };
  }
  if (options.tenantTx === undefined) throw new AppError('SERVICE_UNAVAILABLE', { cause: new Error('no tenant transaction runner') });
  const runner = options.tenantTx;
  const tenant = tenantContextOf(request.principal, request.correlationId);
  const { load, call } = route;
  let result: RouteResult;
  try {
    const loaded =
      load === undefined
        ? undefined
        : await runner.withTenantTx(tenant, async (db) => await load(Object.freeze({ ...request, db })), { readOnly: true });
    let called: unknown;
    if (call !== undefined) {
      const signal = lifetime.signal();
      // A client already gone (during load, authn or validation) gets no external effect and no write (PR #44 R1-m1).
      signal.throwIfAborted();
      called = await abortable(call(Object.freeze({ ...request, signal }), loaded as never), signal);
    }
    // R1-m6: a VIEW / DOWNLOAD handler records nothing in its transaction, so it may write nothing either.
    const handlerTx = audit.readOnlyHandler ? { readOnly: true } : undefined;
    result = await runner.withTenantTx(tenant, (db) => write(db, Object.freeze({ loaded, called })), handlerTx);
  } catch (error) {
    // REQ-AUDIT-010: the request failed after authorisation (in load, call or the handler transaction, which rolled
    // back); its FAILED entry goes in a transaction of its own.
    await recordFailure(audit, request, error, tenant, lifetime);
    if (error instanceof RouteReturnedError) return { result: error.result, committed: false };
    throw error;
  }
  // The result set is fixed and nothing is sent yet: a VIEW / DOWNLOAD entry is written now (REQ-AUDIT-005).
  await audit.afterCommit(request, result, tenant);
  return { result, committed: true };
}

/**
 * The FAILED entry of a failed request (R1-m4): none when the failure IS the client's disconnect (the slot's own abort
 * of `call`, or of a call skipped because the client had gone: no business outcome to record). Any other failure is
 * recorded even when the client has gone meanwhile, so a client cannot suppress its FAILED entry by disconnecting
 * (PR56-SEC-11, REQ-AUDIT-010). The answer waits at most {@link FAILED_ENTRY_WAIT_MS} for it; a write still running
 * after that wait is detached and, unlike the afterCommit queue, not drained at shutdown (best effort by design; the
 * business change it describes was rolled back; code review R2-n4). `afterFailure` resolves always (it reports an unwritten entry itself), so the only rejection here is the end
 * of the wait, after which the write finishes or rolls back in its own transaction.
 */
async function recordFailure(
  audit: MountedAudit,
  request: RouteRequestContext,
  error: unknown,
  tenant: TenantContext,
  lifetime: RequestLifetime,
): Promise<void> {
  if (lifetime.isDisconnect(error)) return;
  const wait = deadline(FAILED_ENTRY_WAIT_MS, () => new Error('FAILED entry wait elapsed'));
  try {
    await abortable(audit.afterFailure(request, error, tenant), wait.signal);
  } catch {
    // The wait elapsed: the response no longer waits for the best-effort entry (see above).
  } finally {
    wait.clear();
  }
}

export function executeSlot(options: ExecuteOptions): RouteSlot {
  return (route) => {
    // Compiled at mount time: an incomplete descriptor, or an audited route without a capture, is refused before it can
    // be served (AT-US-086-02, PR32-SEC-03).
    const audit: MountedAudit =
      options.audit !== undefined
        ? { ...NOT_AUDITED, inTransaction: options.audit }
        : options.capture === undefined
          ? withoutCapture(route)
          : options.capture.mount(route);
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
        transport: transportOf(req, routeTemplateOf(res) ?? route.path),
      });
      const lifetime = requestLifetime(res, deadlineMs);
      try {
        const { result, committed } = await run({ route, request, options, audit, lifetime });
        // After a commit, afterCommit runs even when sending or the stream fails (PR #44 R1-n4); a returned failure
        // was rolled back, so nothing is scheduled for it (PR56-SEC-10).
        try {
          send(res, result);
          if (result.stream !== undefined) await completeStream(res, result.stream, lifetime.signal());
        } finally {
          const afterCommit = route.afterCommit;
          if (committed && afterCommit !== undefined && queue !== undefined) {
            const label = { route: routeTemplateOf(res) ?? route.path, operationId: route.operationId, correlationId };
            queue.schedule((signal) => afterCommit(Object.freeze({ ...request, signal }), result), label);
          }
        }
      } finally {
        lifetime.release();
      }
    };
  };
}
