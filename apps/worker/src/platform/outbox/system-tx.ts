/**
 * SYSTEM-scope transactions of the outbox relay and the outbox purge (ADR-0004; data-model §3.5, §6.1; PR2-SEC-05
 * addendum, PR11-SEC-05 item 2, D-ARCH-074; TASK-043). Both run on the worker's one tenant-transaction runner
 * (`RuntimeServices.tenantTx`, the composition of `@platform/api/runtime`), never on a second pool or the root client,
 * with the reserved SYSTEM actor, no organisation and TENANT scope: every RLS table shows them nothing, and the SYSTEM
 * tables they read (`outbox_events`, `processed_events`, `job_executions`) have no RLS. Statements are tagged
 * `$queryRaw` / `$executeRaw` templates, every value bound.
 */
import type { TenantContext } from '@platform/api/runtime';
import { SYSTEM_ACTOR_ID } from '@platform/shared';

/** The raw members of the `TenantDb` the relay and the purge use (tagged templates only). */
export interface RawDb {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<number>;
}

/** The part of the tenant-transaction runner used here (`RuntimeServices.tenantTx` satisfies it). */
export interface SystemTxRunner {
  withTenantTx<R>(ctx: TenantContext, fn: (db: RawDb) => Promise<R>): Promise<R>;
}

/** The tenant context of a SYSTEM job transaction with this correlation id. */
export function systemContext(correlationId: string): TenantContext {
  return { orgId: '', actorId: SYSTEM_ACTOR_ID, actorScope: 'TENANT', guestTokenHash: '', correlationId };
}

/** Class name of a thrown value, for logs and `last_error`; never its message (it may carry a secret or a value). */
export const errorClassOf = (error: unknown): string => (error instanceof Error ? error.name : typeof error);
