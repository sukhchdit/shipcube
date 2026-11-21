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
 *
 * Idempotency (TASK-040; ADR-0014, api/README §5, data-model §6.2): when the idempotency slot (7a) recorded a key, the
 * key is claimed (ADR-0014 amendment 7: in the tx slot) in a transaction of its own BEFORE step 1, so a replay (stored status, headers, body and
 * `Idempotent-Replayed: true`), a reused key (422) or a key still running (409 + `Retry-After: 1`) answers without any
 * phase. The lease is sized to the longest phase and renewed before `call` and before the handler transaction
 * ({@link idempotencyLeaseMs}). A 2xx completes the key inside the handler transaction (step 3), or, on a read-only
 * (VIEW / DOWNLOAD) handler, after its fail-closed entry (step 3a); after a failure, a returned or thrown 4xx (not 429)
 * is completed in its own short transaction after the FAILED entry, a thrown one as its problem document rendered
 * once (ADR-0014 amendment 6, D-ARCH-195); a 5xx, a 429 or any other failure releases the key. A replay commits nothing
 * new and schedules no `afterCommit`; a stored document is sent again byte for byte.
 */
import { ANONYMOUS_ACTOR_ID, AppError, SYSTEM_ACTOR_ID } from '@platform/shared';
import type { Request, Response } from 'express';

import { type AuditCapture, type AuditHook, type MountedAudit, NOT_AUDITED, withoutCapture } from '../audit/capture.js';
import { requestContextOf } from '../context/request-context.js';
import type { AppDb, TenantContext, TenantTxRunner, TransactionOptions } from '../db/index.js';
import { IdempotencyReplayError } from '../idempotency/body-cipher.js';
import { storedProblemOf } from '../idempotency/problem.js';
import { isRenderedProblem } from '../errors/rendered-problem.js';
import { IDEMPOTENT_REPLAYED_HEADER, idempotencyRequestOf, type IdempotencyRequest } from '../idempotency/request.js';
import {
  type BeginOutcome,
  IDEMPOTENCY_LEASE_MS,
  type IdempotencyClaim,
  IdempotencyClaimLostError,
  type IdempotencyStore,
  IN_PROGRESS_RETRY_AFTER_SECONDS,
  isStoredStatus,
  type StoredOrigin,
} from '../idempotency/store.js';
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

/**
 * Margin of an idempotency lease for clock skew between API instances (the lease is written and read with each
 * instance's application clock, data-model §7.6; NTP keeps the skew far below this) and for scheduling jitter.
 */
export const LEASE_SKEW_MARGIN_MS = 5_000;

/**
 * The idempotency lease of a request (ADR-0014 amendment 10, D-ARCH-200; PR040-SEC-04 = code review R2-n1): not
 * shorter than the longest stretch between two writes of `lease_until`, or between the last write and the end of the
 * request, plus {@link LEASE_SKEW_MARGIN_MS}, and never below {@link IDEMPOTENCY_LEASE_MS} (the 30 s floor). One
 * transaction counts with its full bound T = admission wait + pool wait (`maxWait`) + `timeout`. The stretches:
 *  - through `call`: the call deadline D, plus T for the renewal that ends it;
 *  - after the last write: at most three transactions and the FAILED entry wait (the handler transaction; the
 *    fail-closed entry of a VIEW or DOWNLOAD route, or the FAILED entry wait of a failure; the completion or release).
 * So `lease = max(30 s, max(D + T, 3 × T + FAILED_ENTRY_WAIT_MS) + 5 s)`; 32.25 s at the defaults (D = 20 s,
 * T = 0.25 + 2 + 5 s). `admissionWaitMs` is `DB_TENANT_ADMISSION_WAIT_MS`; when the composition does not pass it, its
 * validated upper bound `maxWait` is used (the admission wait may not exceed it, with-tenant-tx.ts), which only
 * lengthens the lease.
 */
export function idempotencyLeaseMs(
  transaction: TransactionOptions,
  callDeadlineMs: number,
  admissionWaitMs: number = transaction.maxWait,
): number {
  const oneTransaction = admissionWaitMs + transaction.maxWait + transaction.timeout;
  const longest = Math.max(callDeadlineMs + oneTransaction, 3 * oneTransaction + FAILED_ENTRY_WAIT_MS);
  return Math.max(IDEMPOTENCY_LEASE_MS, longest + LEASE_SKEW_MARGIN_MS);
}

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
  /**
   * The idempotency key store (TASK-040; `idempotencyStoreFrom` over IDEMPOTENCY_BODY_KEY). Required by a route whose
   * `idempotency` is `required` or `optional`: without it the slot refuses the route when it is mounted.
   */
  readonly idempotency?: IdempotencyStore;
  /**
   * The problem `type` base of the problem handler (`AppDependencies.problemTypeBase`), so that the 4xx document an
   * idempotent request renders once and stores is the one the problem handler would render (D-ARCH-195). Default: the
   * handler's default; part 040-B passes the same value to both when it wires the store.
   */
  readonly problemTypeBase?: string;
  /**
   * `DB_TENANT_ADMISSION_WAIT_MS`, one term of the transaction bound the idempotency lease counts
   * ({@link idempotencyLeaseMs}). Default: the runner's `maxWait`, the validated upper bound of that wait.
   */
  readonly admissionWaitMs?: number;
}

/** A route declares an idempotency mode but the composition supplied no key store (a wiring bug; PR32-SEC-03). */
export class IdempotencyNotWiredError extends Error {
  constructor(readonly operationId: string) {
    super(`route ${operationId} declares an idempotency mode, but the tx slot has no idempotency store`);
    this.name = 'IdempotencyNotWiredError';
  }
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
  /** The idempotent request the idempotency slot recorded (a key was sent on an idempotent route), if any. */
  readonly idempotent: IdempotencyRequest | undefined;
  /** The `call` deadline of this slot (the lease covers it). */
  readonly deadlineMs: number;
  /** `req.originalUrl`: the `instance` of a problem document rendered here. */
  readonly url: string;
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
async function run({ route, request, options, audit, lifetime, idempotent, deadlineMs, url }: Phases): Promise<RunOutcome> {
  // The key this request claimed (TASK-040); a stored 2xx completes it inside the handler transaction.
  let claim: IdempotencyClaim | undefined;
  let completedInTx = false;
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
    // ADR-0014: a 2xx completes the claimed key atomically with the business change, before the audit flush (the
    // transaction's last database work). A stream has no body to store; a read-only handler transaction cannot write,
    // so its key is completed after COMMIT instead (settleClaim).
    if (claim !== undefined && db !== undefined && isStoredStatus(result.status) && !audit.readOnlyHandler) {
      if (result.stream !== undefined) throw new RouteResultError(route.operationId, 'an idempotent route cannot return a stream');
      await idempotencyStoreOf(options).complete(db as AppDb, claim, result);
      completedInTx = true;
    }
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
  const leaseMs = idempotencyLeaseMs(runner.transactionOptions, deadlineMs, options.admissionWaitMs);
  if (idempotent !== undefined) {
    const begun = await beginIdempotent(runner, tenant, idempotencyStoreOf(options), idempotent, { request, audit, lifetime }, leaseMs);
    if (begun.kind === 'replay') return { result: begun.result, committed: false };
    if (begun.kind === 'execute') claim = begun.claim;
  }
  // Renews the lease before a phase that follows another one (m4). A claim lost meanwhile answers 409 IN_PROGRESS and
  // logs WARN `api.idempotency_claim_lost` (phase and correlation id only). Audit: before `call` ran nothing external
  // happened, so no entry (D-PM-081); after `call` ran, its effect happened, so exactly one FAILED entry (D-PM-084).
  let unaudited: AppError | undefined;
  const renew = async (phase: 'before-call' | 'before-handler', callRan: boolean): Promise<void> => {
    const owned = claim;
    if (owned === undefined) return;
    try {
      claim = await runner.withTenantTx(tenant, (db) => idempotencyStoreOf(options).renew(db as AppDb, owned, leaseMs));
    } catch (error) {
      if (!(error instanceof IdempotencyClaimLostError)) throw error;
      claim = undefined;
      idempotencyStoreOf(options).log.warn('api.idempotency_claim_lost', { phase, correlation_id: request.correlationId });
      const lost = new AppError('IDEMPOTENCY_IN_PROGRESS', { cause: error, retryAfterSeconds: IN_PROGRESS_RETRY_AFTER_SECONDS });
      if (!callRan) unaudited = lost;
      throw lost;
    }
  };
  let result: RouteResult;
  try {
    const loaded =
      load === undefined
        ? undefined
        : await runner.withTenantTx(tenant, async (db) => await load(Object.freeze({ ...request, db })), { readOnly: true });
    let called: unknown;
    if (call !== undefined) {
      if (load !== undefined) await renew('before-call', false);
      const signal = lifetime.signal();
      // A client already gone (during load, authn or validation) gets no external effect and no write (PR #44 R1-m1).
      signal.throwIfAborted();
      called = await abortable(call(Object.freeze({ ...request, signal }), loaded as never), signal);
    }
    // R1-m6: a VIEW / DOWNLOAD handler records nothing in its transaction, so it may write nothing either.
    const handlerTx = audit.readOnlyHandler ? { readOnly: true } : undefined;
    if (load !== undefined || call !== undefined) await renew('before-handler', call !== undefined);
    result = await runner.withTenantTx(tenant, (db) => write(db, Object.freeze({ loaded, called })), handlerTx);
  } catch (error) {
    // REQ-AUDIT-010: the request failed after authorisation (in load, call or the handler transaction, which rolled
    // back); its FAILED entry goes in a transaction of its own.
    if (error !== unaudited) await recordFailure(audit, request, error, tenant, lifetime);
    // ADR-0014 amendment 6, D-ARCH-195, D-ARCH-143: after the FAILED entry, a returned or thrown 4xx (not 429) is
    // completed in its own short transaction, then sent (a replay answers it without running any phase again). A thrown
    // one is rendered ONCE here, with this request's correlation id, and the same document is stored and sent. A 5xx, a
    // 429 or any other failure releases the key.
    if (claim !== undefined) {
      if (error instanceof RouteReturnedError) {
        await settleClaim(runner, tenant, idempotencyStoreOf(options), claim, error.result);
      } else {
        const context = { correlationId: request.correlationId, url, typeBase: options.problemTypeBase };
        const stored = storableProblemOf(error, context, idempotencyStoreOf(options).log);
        await settleClaim(runner, tenant, idempotencyStoreOf(options), claim, stored?.result, 'slot-problem');
        if (stored !== undefined) throw stored.error;
      }
    }
    if (error instanceof RouteReturnedError) return { result: error.result, committed: false };
    throw error;
  }
  // The result set is fixed and nothing is sent yet: a VIEW / DOWNLOAD entry is written now (REQ-AUDIT-005). It fails
  // closed, so a key not yet completed (a read-only handler) is completed only after it (code review M1): when the entry
  // fails, the key is released and the retry runs again, writing the entry and scheduling `afterCommit`.
  const pending = claim !== undefined && !completedInTx ? claim : undefined;
  try {
    await audit.afterCommit(request, result, tenant);
  } catch (error) {
    if (pending !== undefined) await settleClaim(runner, tenant, idempotencyStoreOf(options), pending, undefined);
    throw error;
  }
  if (pending !== undefined) await settleClaim(runner, tenant, idempotencyStoreOf(options), pending, result);
  return { result, committed: true };
}

/** The store of an idempotent route; executeSlot refuses such a route at mount without one, so this never throws. */
function idempotencyStoreOf(options: ExecuteOptions): IdempotencyStore {
  if (options.idempotency === undefined) throw new IdempotencyNotWiredError('(unknown)');
  return options.idempotency;
}

/**
 * The claim of an idempotent request (TASK-040; data-model §6.2 step 1), in a transaction of its own committed before
 * any phase runs (admitted under the request's tenant bulkhead like every other transaction of the request). A replay
 * is returned for sending, a stored thrown 4xx is rethrown (problem.ts). Audit (REQ-AUDIT-010 as amended by D-PM-081):
 *  - a reused key (422 `IDEMPOTENCY_KEY_REUSED`) and a key still running (409 `IDEMPOTENCY_IN_PROGRESS`,
 *    `Retry-After: 1`) write NO audit entry: they are protocol answers, not business outcomes. Each logs
 *    `api.idempotency_conflict` with the code and the correlation id, never the key;
 *  - a replay writes none either (api/README §5 "Replay": no business action, no second audit entry or outbox event).
 *    A stored response that cannot be read back answers 500, logged at ERROR by the store
 *    (`api.idempotency_replay_unreadable`, class only, never the key or the body);
 *  - a claim that fails on a NEW request (a 5xx: the claim transaction, or a `required` route without a scope) gets its
 *    one FAILED entry, as any other 5xx of the route.
 * An anonymous caller without a client network has no scope (code review n6): a `required` route answers 503, an
 * `optional` one runs without idempotency, and both log `api.idempotency_scope_unavailable`.
 */
async function beginIdempotent(
  runner: TenantTxRunner<unknown>,
  tenant: TenantContext,
  store: IdempotencyStore,
  idempotent: IdempotencyRequest,
  phases: Pick<Phases, 'request' | 'audit' | 'lifetime'>,
  leaseMs: number,
): Promise<
  | { readonly kind: 'replay'; readonly result: RouteResult }
  | { readonly kind: 'execute'; readonly claim: IdempotencyClaim }
  | { readonly kind: 'unscoped' }
> {
  const { request, audit, lifetime } = phases;
  const failed = async (error: unknown): Promise<never> => {
    await recordFailure(audit, request, error, tenant, lifetime);
    throw error;
  };
  let begun: BeginOutcome;
  try {
    begun = await runner.withTenantTx(tenant, (db) =>
      store.begin(db as AppDb, { request: idempotent, principal: request.principal, clientIp: request.transport.ip, leaseMs }),
    );
  } catch (error) {
    // An unreadable stored response belongs to a retry (no new business outcome); anything else failed a new request.
    if (error instanceof IdempotencyReplayError) throw error;
    return failed(error);
  }
  const conflict = (code: 'IDEMPOTENCY_KEY_REUSED' | 'IDEMPOTENCY_IN_PROGRESS'): AppError => {
    store.log.info('api.idempotency_conflict', { code, correlation_id: request.correlationId });
    return code === 'IDEMPOTENCY_IN_PROGRESS'
      ? new AppError(code, { retryAfterSeconds: IN_PROGRESS_RETRY_AFTER_SECONDS })
      : new AppError(code);
  };
  switch (begun.kind) {
    case 'replay-problem':
      throw begun.error;
    case 'unscoped':
      store.log.warn('api.idempotency_scope_unavailable', { mode: request.route.idempotency, correlation_id: request.correlationId });
      if (request.route.idempotency === 'required') {
        return failed(new AppError('SERVICE_UNAVAILABLE', { cause: new Error('no client network for an anonymous idempotency scope') }));
      }
      return begun;
    case 'reused':
      throw conflict('IDEMPOTENCY_KEY_REUSED');
    case 'in-progress':
      throw conflict('IDEMPOTENCY_IN_PROGRESS');
    default:
      return begun;
  }
}

const errorClass = (error: unknown): string => (error instanceof Error ? error.name : 'non-error');

/**
 * The storable document of a thrown failure (problem.ts), or `undefined` when it is not stored. A failure whose
 * document cannot be rendered (an `errors[]` item that cannot be serialised: a code defect) is not stored either, so its
 * key is released instead of being held until the lease ends (PR040-SEC-09, CWE-755); the original failure goes on to
 * the problem handler, and a WARN line names the class of the rendering error only.
 */
function storableProblemOf(
  error: unknown,
  context: Parameters<typeof storedProblemOf>[1],
  log: IdempotencyStore['log'],
): ReturnType<typeof storedProblemOf> {
  try {
    return storedProblemOf(error, context);
  } catch (renderError) {
    log.warn('api.idempotency_problem_unrendered', { error: errorClass(renderError) });
    return undefined;
  }
}

/**
 * Settles a claim whose result did not complete inside the handler transaction (TASK-040; D-TASK029-16/-17, PR #56
 * R1-M1 / R2-m1, PR56-SEC-09, D-ARCH-143): a stored status (a 2xx, or a returned or thrown 4xx other than 429) is
 * completed in a short transaction of its own; anything else (a 5xx, a 429, any other failure: `result` undefined)
 * releases the key so the retry executes again (ADR-0014, EC-A30). A completion that fails releases the key instead,
 * and the original status is still answered: the request changed nothing, so its retry may run again. A release that
 * fails is logged; the lease then frees the key. Never throws.
 */
async function settleClaim(
  runner: TenantTxRunner<unknown>,
  tenant: TenantContext,
  store: IdempotencyStore,
  claim: IdempotencyClaim,
  result: RouteResult | undefined,
  origin: StoredOrigin = 'handler',
): Promise<void> {
  if (result !== undefined && isStoredStatus(result.status) && result.stream === undefined) {
    try {
      await runner.withTenantTx(tenant, (db) => store.complete(db as AppDb, claim, result, origin));
      return;
    } catch (error) {
      store.log.warn('api.idempotency_completion_failed', { error: errorClass(error), status: result.status });
    }
  }
  try {
    await runner.withTenantTx(tenant, (db) => store.release(db as AppDb, claim));
  } catch (error) {
    store.log.warn('api.idempotency_release_failed', { error: errorClass(error) });
  }
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
    if (route.idempotency !== 'not-applicable' && options.idempotency === undefined) throw new IdempotencyNotWiredError(route.operationId);
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
        const { result, committed } = await run({
          route,
          request,
          options,
          audit,
          lifetime,
          idempotent: idempotencyRequestOf(res),
          deadlineMs,
          url: req.originalUrl,
        }).catch((error: unknown) => {
          // A replayed stored 4xx is rendered by the problem handler like the original, marked as a replay.
          if (isRenderedProblem(error) && error.replayed) res.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
          throw error;
        });
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
