/**
 * Worker twin of `apps/api/src/platform/db/system-db.ts` (PR19-SEC-01, D-ARCH-080; data-model §1.5 SYSTEM row): the
 * worker's one way to the SYSTEM-class model delegates (`job_context`, `processed_events`, the outbox relay's reads).
 *
 * The worker imports apps/api only through `@platform/api/runtime` (ADR-0003, D-TASK006-01), and the SYSTEM port is
 * tied to the api's `TenantDb` handles (a private `WeakMap` in apps/api/src/platform/db), so the twin cannot build the
 * delegates itself: the worker composition root binds it ONCE to the api accessor (`bindSystemDelegates`) when the
 * worker gets its first tenant transaction through that entry (TASK-047, the first worker SYSTEM writer). Until it is
 * bound, `systemDelegates` throws (fail closed). Importers are restricted by the same `platform/system-model-owner`
 * rule as the api accessor (per model, to the module whose table-class manifest declares the table).
 */

/** The api accessor (`systemDelegates` of apps/api/src/platform/db/system-db.ts) as the worker sees it. */
export type SystemDelegatesAccessor = (tx: object) => object;

/** Thrown when the twin is used before the composition root bound it, or bound twice. */
export class SystemDbBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SystemDbBindingError';
  }
}

/** The bound accessor; set once by the composition root. */
const binding: { accessor?: SystemDelegatesAccessor } = {};

/** Binds the twin to the api accessor; a second call is a programming error. */
export function bindSystemDelegates(accessor: SystemDelegatesAccessor): void {
  if (binding.accessor !== undefined) throw new SystemDbBindingError('the worker SYSTEM accessor is bound once');
  binding.accessor = accessor;
}

/**
 * The SYSTEM model delegates of the transaction behind `tx` (a `TenantDb` the worker was given), through the bound api
 * accessor; throws `SystemDbBindingError` while unbound.
 */
export function systemDelegates(tx: object): object {
  const { accessor } = binding;
  if (accessor === undefined) throw new SystemDbBindingError('the worker SYSTEM accessor is not bound (TASK-047 binds it)');
  return accessor(tx);
}
