/**
 * `systemDelegates(tx)`: the one way to the SYSTEM-class model delegates (PR19-SEC-01, D-ARCH-080; data-model §1.5).
 *
 * SYSTEM tables (`outbox_events`, `idempotency_keys`, `login_attempt_counters`, `job_context`, `processed_events`,
 * `gateway_webhook_events`, `reference_dataset_versions`, …) have no RLS: a grant to `platform_app` is a grant to every
 * module. Their delegates are therefore absent from `TenantDb` (type and run time) and handed out here, inside the same
 * tenant transaction (the argument is the `TenantDb` the caller was given; the delegates run on its transaction and
 * close with it). Who may call this is decided per model by the `platform/system-model-owner` lint: only the module
 * whose table-class manifest declares the table (eslint.config.mjs `SYSTEM_MODEL_OWNERS`). Not re-exported from
 * `./index.ts`, so every importer is visible to that rule.
 *
 * GLOBAL catalogue delegates (permissions, roles, …) stay in `TenantDb` (read-only by grant).
 */
import { SYSTEM_MODELS, type SystemModelName } from './system-models.js';
import { openSystemPort } from './system-port.js';
import { type TenantDb, TenantDbAccessError } from './tenant-db.js';

export { SYSTEM_MODELS, type SystemModelName };

/** The SYSTEM model delegates of a transaction client type `TTx` (those its data model has). */
export type SystemDelegates<TTx> = Pick<TTx, Extract<SystemModelName, keyof TTx>>;

/**
 * The SYSTEM model delegates of the transaction behind `tx`. Each delegate is guarded like a `TenantDb` delegate
 * (model operations only, results guarded, closed with the transaction). Throws `TenantDbAccessError` when `tx` is not
 * a handle built by `createTenantDb` (a hand-made object cannot be turned into a SYSTEM accessor).
 */
export function systemDelegates<TTx>(tx: TenantDb<TTx>): SystemDelegates<TTx> {
  const port = openSystemPort(tx);
  if (port === undefined) throw new TenantDbAccessError('systemDelegates', 'the argument is not a TenantDb handle');
  return port as SystemDelegates<TTx>;
}
