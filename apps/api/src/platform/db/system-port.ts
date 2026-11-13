/**
 * The private link between a `TenantDb` handle and its SYSTEM-delegate guard (PR19-SEC-01, D-ARCH-080).
 *
 * `createTenantDb` registers, for every handle it builds, a function that returns the handle's SYSTEM-delegate guard;
 * `systemDelegates(tx)` (`./system-db.ts`) looks it up. Keyed by the handle's identity in a `WeakMap`, so nothing is
 * added to the handle (its Proxy exposes no extra key) and a settled handle is collected with its entry. Only
 * `./tenant-db.ts` and `./system-db.ts` import this module: the `platform/system-model-owner` lint reports any other
 * importer.
 */
const PORTS = new WeakMap<object, () => object>();

/** Registers the SYSTEM-delegate guard of `db` (once per handle; a second registration is a programming error). */
export function registerSystemPort(db: object, open: () => object): void {
  if (PORTS.has(db)) throw new Error('a TenantDb handle registers its SYSTEM port once');
  PORTS.set(db, open);
}

/** The SYSTEM-delegate guard of `db`, or `undefined` when `db` is not a handle built by `createTenantDb`. */
export function openSystemPort(db: unknown): object | undefined {
  if (typeof db !== 'object' || db === null) return undefined;
  return PORTS.get(db)?.();
}
