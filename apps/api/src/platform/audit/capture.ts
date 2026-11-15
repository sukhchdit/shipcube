/**
 * Pipeline step 9, automatic audit capture driven by route descriptors (REQ-AUDIT-001/004/005/006/010, ADR-0007
 * §Capture, amendments 10 and 11 item 3; D-ARCH-106, D-ARCH-122; US-086; TASK-029). The tx slot (tx/execute.ts, the
 * one importer of this file) mounts each route through {@link AuditCapture.mount}; the authorisation slot reports
 * denials through {@link AuditCapture.denied}. Feature code never imports the writer: the descriptor decides.
 *
 * Where each entry is written (descriptor-runtime.ts compiles the mode):
 *  - `write` (CREATE, UPDATE, DELETE, CONFIG_CHANGE): inside the handler transaction, as its LAST database work
 *    (D-ARCH-106: after the business statements, the outbox insert and the idempotency completion): `record` + the
 *    transaction's ONE `flush` (D-ARCH-122), so the mutation and its entry commit together or neither does (O4). A 503
 *    AUDIT_LOCK_TIMEOUT or TENANT_CONCURRENCY_LIMIT rolls the business change back with it. The `load` phase is
 *    read-only and records nothing.
 *  - `view` / `list` (VIEW, DOWNLOAD): in their own short transaction after the handler transaction fixed the result and
 *    before the response is released (ADR-0007 am. 10); a SENSITIVE entry that cannot be written fails closed with 503
 *    AUDIT_UNAVAILABLE and nothing is sent (REQ-AUDIT-005); a NORMAL one is best effort (the runner's redacting
 *    `onDbError` hook logs the failure).
 *  - FAILED (REQ-AUDIT-010): an authenticated mutating request that ended in 409, 422 or 5xx gets its entry in a
 *    separate transaction, because the business one rolled back; best effort, and never for a failure of the audit
 *    path or the admission bulkhead itself (it would only add load to the congested stream).
 *  - DENIED: a 403 AUTHZ_DENIED gets one PERMISSION_DENIED entry with the required permission, in its own transaction
 *    (REQ-AUDIT-010, REQ-RBAC-007); a failure to write it answers that failure (500 / 503), never a silent 403.
 * No external I/O here (T-83 whole-file root); every write goes through the writer composed from the validated
 * configuration (writer.ts, DB_AUDIT_LOCK_TIMEOUT_MS).
 */
import type { AuditSqlPort, AuditWriter } from '@platform/audit';
import type { Config } from '@platform/config';
import { AppError } from '@platform/shared';

import { DbError, type TenantContext, type TenantTxRunner } from '../db/index.js';
import type { RouteContext, RouteDescriptor, RouteRequestContext, RouteResult } from '../routing/define-route.js';
import { SlotNotImplementedError } from '../routing/slot.js';
import { compileAudit, type CompiledAudit, entryFor, failedOutcomeApplies, type UserAgentParser } from './descriptor-runtime.js';
import { auditWriterFromConfig, type AuditWriterDeps } from './writer.js';

export type AuditHook = (ctx: RouteContext, result: RouteResult) => Promise<void>;

/** The audit work of one mounted route, in the order the tx slot runs it. */
export interface MountedAudit {
  /** Inside the handler transaction, its last database work: `record` + the one `flush` (write routes only). */
  readonly inTransaction: AuditHook;
  /** After COMMIT and before the response: the VIEW / DOWNLOAD entry in its own short transaction. */
  readonly afterCommit: (request: RouteRequestContext, result: RouteResult, tenant: TenantContext) => Promise<void>;
  /** After the handler phase failed: the FAILED entry in its own transaction (best effort; resolves always). */
  readonly afterFailure: (request: RouteRequestContext, error: unknown, tenant: TenantContext) => Promise<void>;
}

export interface AuditCapture {
  /** Compiles the route's descriptor at mount time; throws for a descriptor the capture cannot honour (AT-US-086-02). */
  mount(route: RouteDescriptor): MountedAudit;
  /** A 403 AUTHZ_DENIED: one PERMISSION_DENIED entry, outcome DENIED, in its own transaction (rejects when unwritten). */
  denied(request: RouteRequestContext, tenant: TenantContext): Promise<void>;
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
}

const nothing = (): Promise<void> => Promise.resolve();
/** The audit work of a `NONE` route: nothing at any step. */
export const NOT_AUDITED: MountedAudit = Object.freeze({ inTransaction: nothing, afterCommit: nothing, afterFailure: nothing });

/** The status a failure answers with (AppError and DbError carry it; anything else is a 500). */
const statusOf = (error: unknown): number => (error instanceof AppError || error instanceof DbError ? error.status : 500);
const codeOf = (error: unknown): string => (error instanceof AppError || error instanceof DbError ? error.code : 'INTERNAL_ERROR');
/** Failures of the audit path or the bulkhead: a FAILED entry would only add load to what just failed. */
const AUDIT_PATH_REASONS: ReadonlySet<string> = new Set(['AUDIT_WRITE_FAILED', 'AUDIT_LOCK_TIMEOUT', 'TENANT_CONCURRENCY_LIMIT']);
const isAuditPathFailure = (error: unknown): boolean => error instanceof DbError && AUDIT_PATH_REASONS.has(error.reason);

const isSuccess = (status: number): boolean => status >= 200 && status < 300;

export function createAuditCapture(options: AuditCaptureOptions): AuditCapture {
  const writer: AuditWriter = auditWriterFromConfig(options.config, options.writer);
  const { parseUserAgent } = options;

  /** One entry in its own tenant transaction (I4: write = record + flush). */
  async function writeAlone(tenant: TenantContext, build: () => Parameters<AuditWriter['write']>[1]): Promise<void> {
    const runner = options.tenantTx;
    if (runner === undefined) throw new AppError('SERVICE_UNAVAILABLE', { cause: new Error('no tenant transaction runner') });
    await runner.withTenantTx(tenant, (db) => writer.write(db as AuditSqlPort, build()));
  }

  function inTransaction(compiled: CompiledAudit): AuditHook {
    if (compiled.mode !== 'write') return nothing;
    return async (ctx, result) => {
      const db = ctx.db as AuditSqlPort;
      const status = result.status;
      // A 2xx is the mutation; 409/422/5xx returned (not thrown) by the handler commit as FAILED; another 4xx changed
      // nothing worth an entry (validation and not-found answers are logged only, REQ-AUDIT-010, api/README §6).
      if (status < 400)
        writer.record(db, entryFor({ compiled, request: ctx, result, action: compiled.action, outcome: 'SUCCESS', parseUserAgent }));
      else if (failedOutcomeApplies(compiled.route, ctx, status)) {
        const details = { status };
        writer.record(
          db,
          entryFor({ compiled, request: ctx, result, action: compiled.action, outcome: 'FAILED', details, parseUserAgent }),
        );
      }
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
        // REQ-AUDIT-005: a SENSITIVE view is never released without its entry; a NORMAL one is best effort.
        if (compiled.sensitive) throw new AppError('AUDIT_UNAVAILABLE', { cause: error, retryAfterSeconds: 1 });
      }
    };
  }

  function afterFailure(compiled: CompiledAudit): MountedAudit['afterFailure'] {
    if (compiled.mode !== 'write') return nothing;
    return async (request, error, tenant) => {
      const status = statusOf(error);
      if (!failedOutcomeApplies(compiled.route, request, status) || isAuditPathFailure(error)) return;
      const details = { status, code: codeOf(error) };
      await writeAlone(tenant, () =>
        entryFor({ compiled, request, result: undefined, action: compiled.action, outcome: 'FAILED', details, parseUserAgent }),
      ).catch(() => undefined);
    };
  }

  function mount(route: RouteDescriptor): MountedAudit {
    const compiled = compileAudit(route);
    if (compiled === undefined) return NOT_AUDITED;
    return { inTransaction: inTransaction(compiled), afterCommit: afterCommit(compiled), afterFailure: afterFailure(compiled) };
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

  return { mount, denied };
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
