/**
 * Pipeline step 9, automatic audit capture driven by route descriptors (REQ-AUDIT-001/004/005/006/010, ADR-0007
 * §Capture, amendments 10 and 11 item 3; D-ARCH-106, D-ARCH-122; US-086; TASK-029). The tx slot (tx/execute.ts) mounts
 * each route through {@link AuditCapture.mount}; the authorisation slot reports denials through
 * {@link AuditCapture.denied}; the pipeline composition (routing/pipeline.ts) builds the one capture. Those three files
 * are the only api importers of this one (eslint.config.mjs, PR56-SEC-02). Feature code never imports the writer: the
 * descriptor decides.
 *
 * Where each entry is written (descriptor-runtime.ts compiles the mode):
 *  - `write` (CREATE, UPDATE, DELETE, CONFIG_CHANGE): inside the handler transaction, as its LAST database work
 *    (D-ARCH-106: after the business statements, the outbox insert and the idempotency completion): `record` + the
 *    transaction's ONE `flush` (D-ARCH-122), so the mutation and its entry commit together or neither does (O4). A 503
 *    AUDIT_LOCK_TIMEOUT or TENANT_CONCURRENCY_LIMIT rolls the business change back with it. The `load` phase is
 *    read-only and records nothing. Only a result below 400 reaches this point: the tx slot rolls back any result of
 *    400 or more (D-TASK029-16).
 *  - `view` / `list` (VIEW, DOWNLOAD): the handler runs in a READ-ONLY transaction (R1-m6) and the entry is written in
 *    its own short transaction after the result is fixed and before the response is released (ADR-0007 am. 10); a
 *    SENSITIVE entry that cannot be written fails closed with 503 AUDIT_UNAVAILABLE and nothing is sent
 *    (REQ-AUDIT-005); a NORMAL one is best effort, and an unwritten one is logged (`audit.view_unrecorded`).
 *  - FAILED (REQ-AUDIT-010): an authenticated mutating request that ended in 409, 422 or 5xx (thrown in any phase, or
 *    returned by the handler) gets its entry in a separate transaction, because the business one rolled back; best
 *    effort and logged when unwritten (`audit.failed_unrecorded`). Never after a failure of the audit path, the
 *    admission bulkhead, the pool or a statement / lock timeout: a second transaction would only add load to what just
 *    failed (R1-m4); the tx slot also skips it for a client that went away and bounds the wait for it.
 *  - DENIED: a 403 AUTHZ_DENIED gets one PERMISSION_DENIED entry with the required permission, in its own transaction
 *    (REQ-AUDIT-010, REQ-RBAC-007); a failure to write it answers that failure (500 / 503), never a silent 403.
 * Every entry carries personal values (the IP, the user agent), so a capture without a tokeniser refuses, at MOUNT
 * time, every audited route and every route that can answer 403 (R1-m1, PR56-SEC-08 condition 2; TASK-028 wires it).
 * No external I/O here (T-83 whole-file root); every write goes through the writer composed from the validated
 * configuration (writer.ts, DB_AUDIT_LOCK_TIMEOUT_MS).
 */
import type { AuditSqlPort, AuditWriter } from '@platform/audit';
import type { Config } from '@platform/config';
import { AppError } from '@platform/shared';

import { DbError, type DbErrorReason, type TenantContext, type TenantTxRunner } from '../db/index.js';
import {
  type RouteContext,
  type RouteDescriptor,
  type RouteRequestContext,
  type RouteResult,
  RouteReturnedError,
} from '../routing/define-route.js';
import { SlotNotImplementedError } from '../routing/slot.js';
import { compileAudit, type CompiledAudit, entryFor, failedOutcomeApplies, type UserAgentParser } from './descriptor-runtime.js';
import { auditWriterFromConfig, type AuditWriterDeps } from './writer.js';

export type AuditHook = (ctx: RouteContext, result: RouteResult) => Promise<void>;

/** The audit work of one mounted route, in the order the tx slot runs it. */
export interface MountedAudit {
  /** The handler transaction is read-only: a VIEW / DOWNLOAD route records nothing in it, so it may write nothing. */
  readonly readOnlyHandler: boolean;
  /** Inside the handler transaction, its last database work: `record` + the one `flush` (write routes only). */
  readonly inTransaction: AuditHook;
  /** After COMMIT and before the response: the VIEW / DOWNLOAD entry in its own short transaction. */
  readonly afterCommit: (request: RouteRequestContext, result: RouteResult, tenant: TenantContext) => Promise<void>;
  /**
   * After a phase failed (a thrown error, or a {@link RouteReturnedError} for a returned status of 400 or more): the
   * FAILED entry in its own transaction. Best effort: it resolves always.
   */
  readonly afterFailure: (request: RouteRequestContext, error: unknown, tenant: TenantContext) => Promise<void>;
}

export interface AuditCapture {
  /** Compiles the route's descriptor at mount time; throws for a descriptor the capture cannot honour (AT-US-086-02). */
  mount(route: RouteDescriptor): MountedAudit;
  /**
   * Mount-time check of a route that can answer 403 AUTHZ_DENIED: throws when its PERMISSION_DENIED entry could never
   * be written (no tokeniser in the composition), so the route is refused instead of answering 500 per request.
   */
  mountDenials(route: RouteDescriptor): void;
  /** A 403 AUTHZ_DENIED: one PERMISSION_DENIED entry, outcome DENIED, in its own transaction (rejects when unwritten). */
  denied(request: RouteRequestContext, tenant: TenantContext): Promise<void>;
}

/** The capture's log seam (the platform logger satisfies it): class-only fields, never a value of the request. */
export interface AuditCaptureLog {
  error(event: string, fields?: Readonly<Record<string, string | number | boolean>>): void;
}

export interface AuditCaptureOptions {
  /** The validated configuration: `DB_AUDIT_LOCK_TIMEOUT_MS` reaches the head-row lock statement (PR #42 R1-n5). */
  readonly config: Pick<Config, 'DB_AUDIT_LOCK_TIMEOUT_MS'>;
  /** `RuntimeServices.tenantTx`: the runner of the separate VIEW, FAILED and DENIED transactions. */
  readonly tenantTx: TenantTxRunner<unknown> | undefined;
  /** Writer options other than the lock timeout (the TASK-028 tokeniser and IP index; tests inject a store). */
  readonly writer?: AuditWriterDeps;
  /** Parses `User-Agent` for `ua_parsed`; without one the column stays null. */
  readonly parseUserAgent?: UserAgentParser;
  /** Where an entry the capture could not write, or a CREATE without an entity id, is reported (R1-m7, R1-n4). */
  readonly log?: AuditCaptureLog;
}

const nothing = (): Promise<void> => Promise.resolve();
/** The audit work of a `NONE` route: nothing at any step. */
export const NOT_AUDITED: MountedAudit = Object.freeze({
  readOnlyHandler: false,
  inTransaction: nothing,
  afterCommit: nothing,
  afterFailure: nothing,
});

/** The status a failure answers with (a returned result, AppError and DbError carry it; anything else is a 500). */
function statusOf(error: unknown): number {
  if (error instanceof RouteReturnedError) return error.result.status;
  return error instanceof AppError || error instanceof DbError ? error.status : 500;
}
const codeOf = (error: unknown): string => (error instanceof AppError || error instanceof DbError ? error.code : 'INTERNAL_ERROR');
/**
 * Failures after which no FAILED entry is attempted (R1-m4): the audit path and the admission bulkhead (the entry
 * would queue on the congested stream), and the congestion classes of the pool and the database (another transaction
 * would wait for the same pool or lock, roughly doubling the error latency).
 */
const NO_FAILED_ENTRY: ReadonlySet<DbErrorReason> = new Set<DbErrorReason>([
  'AUDIT_WRITE_FAILED',
  'AUDIT_LOCK_TIMEOUT',
  'TENANT_CONCURRENCY_LIMIT',
  'TRANSACTION_UNAVAILABLE',
  'STATEMENT_TIMEOUT',
  'LOCK_TIMEOUT',
]);
const skipsFailedEntry = (error: unknown): boolean => error instanceof DbError && NO_FAILED_ENTRY.has(error.reason);

const isSuccess = (status: number): boolean => status >= 200 && status < 300;

/** The class-only description of a failure for the log line: its class name and catalogue code or reason. */
function failureFields(error: unknown): Record<string, string> {
  const errorClass = error instanceof Error ? error.name : typeof error;
  if (error instanceof DbError) return { errorClass, code: error.code, reason: error.reason };
  if (error instanceof AppError) return { errorClass, code: error.code };
  return { errorClass };
}

export function createAuditCapture(options: AuditCaptureOptions): AuditCapture {
  const writer: AuditWriter = auditWriterFromConfig(options.config, options.writer);
  const { parseUserAgent } = options;
  const tokenises = options.writer?.tokeniser !== undefined;
  const report = (event: string, route: RouteDescriptor, error: unknown): void => {
    options.log?.error(event, { operationId: route.operationId, ...failureFields(error) });
  };

  /** One entry in its own tenant transaction (I4: write = record + flush). */
  async function writeAlone(tenant: TenantContext, build: () => Parameters<AuditWriter['write']>[1]): Promise<void> {
    const runner = options.tenantTx;
    if (runner === undefined) throw new AppError('SERVICE_UNAVAILABLE', { cause: new Error('no tenant transaction runner') });
    await runner.withTenantTx(tenant, (db) => writer.write(db as AuditSqlPort, build()));
  }

  /** PR56-SEC-08 condition 2: an entry with personal values cannot be written without the TASK-028 tokeniser. */
  function requireTokeniser(route: RouteDescriptor, what: string): void {
    if (!tokenises) throw new SlotNotImplementedError('audit', route.operationId, what, 'an audit tokeniser in the composition (TASK-028)');
  }

  function inTransaction(compiled: CompiledAudit): AuditHook {
    if (compiled.mode !== 'write') return nothing;
    return async (ctx, result) => {
      const db = ctx.db as AuditSqlPort;
      const entry = entryFor({ compiled, request: ctx, result, action: compiled.action, outcome: 'SUCCESS', parseUserAgent });
      // R1-n4: a CREATE whose result carries no well-formed id records entity_id null; worth a line (class only).
      if (compiled.action === 'CREATE' && entry.entityId === null) {
        options.log?.error('audit.entity_id_unresolved', { operationId: compiled.route.operationId, action: compiled.action });
      }
      writer.record(db, entry);
      // The transaction's one flush, as its last database work (I1; nothing else runs after the head-row lock).
      await writer.flush(db);
    };
  }

  function afterCommit(compiled: CompiledAudit): MountedAudit['afterCommit'] {
    if (compiled.mode === 'write') return nothing;
    return async (request, result, tenant) => {
      if (!isSuccess(result.status)) return;
      try {
        await writeAlone(tenant, () =>
          entryFor({ compiled, request, result, action: compiled.action, outcome: 'SUCCESS', parseUserAgent }),
        );
      } catch (error) {
        // REQ-AUDIT-005: a SENSITIVE view is never released without its entry; a NORMAL one is best effort, reported.
        if (compiled.sensitive) throw new AppError('AUDIT_UNAVAILABLE', { cause: error, retryAfterSeconds: 1 });
        report('audit.view_unrecorded', compiled.route, error);
      }
    };
  }

  function afterFailure(compiled: CompiledAudit): MountedAudit['afterFailure'] {
    if (compiled.mode !== 'write') return nothing;
    return async (request, error, tenant) => {
      const status = statusOf(error);
      if (!failedOutcomeApplies(compiled.route, request, status) || skipsFailedEntry(error)) return;
      // A returned result has no catalogue code of its own: only its status is recorded.
      const details = error instanceof RouteReturnedError ? { status } : { status, code: codeOf(error) };
      try {
        await writeAlone(tenant, () =>
          entryFor({ compiled, request, result: undefined, action: compiled.action, outcome: 'FAILED', details, parseUserAgent }),
        );
      } catch (failure) {
        // Best effort: the original failure is what the client gets; the unwritten entry is reported.
        report('audit.failed_unrecorded', compiled.route, failure);
      }
    };
  }

  function mount(route: RouteDescriptor): MountedAudit {
    const compiled = compileAudit(route);
    if (compiled === undefined) return NOT_AUDITED;
    requireTokeniser(route, `audit action ${compiled.action}`);
    return {
      readOnlyHandler: compiled.mode !== 'write',
      inTransaction: inTransaction(compiled),
      afterCommit: afterCommit(compiled),
      afterFailure: afterFailure(compiled),
    };
  }

  function mountDenials(route: RouteDescriptor): void {
    requireTokeniser(route, 'PERMISSION_DENIED entries');
  }

  async function denied(request: RouteRequestContext, tenant: TenantContext): Promise<void> {
    const { route } = request;
    const required = route.permissionAuthenticated ?? route.permission;
    const compiled = { route, entityName: route.audit.entity ?? 'request', mode: 'write', entityId: () => null } as const;
    // Pre-validation: no entity id, whatever the path holds (PR42-SEC-15).
    await writeAlone(tenant, () =>
      entryFor({
        compiled,
        request,
        result: undefined,
        action: 'PERMISSION_DENIED',
        outcome: 'DENIED',
        details: { required_permission: required },
        parseUserAgent,
      }),
    );
  }

  return { mount, mountDenials, denied };
}

/**
 * The tx slot's audit work when no capture is configured (test compositions that do not exercise auditing): an
 * unaudited route mounts, an audited one is refused at mount time, so it can never be served unaudited (PR32-SEC-03,
 * condition C3; O4).
 */
export function withoutCapture(route: RouteDescriptor): MountedAudit {
  if (route.audit.action !== 'NONE') {
    throw new SlotNotImplementedError(
      'audit',
      route.operationId,
      `audit action ${route.audit.action}`,
      'a configured audit capture (TASK-029)',
    );
  }
  return NOT_AUDITED;
}
