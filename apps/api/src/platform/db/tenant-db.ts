/**
 * `TenantDb`: the only database handle repositories receive (ADR-0005 §Transaction-scoped context and amendment 10
 * item 1, PR7-SEC-05; TASK-016).
 *
 * Compile time: the transaction client without `$transaction` (a nested call is a SAVEPOINT; savepoints are not exposed
 * until a use case appears, F-01) and without the `*Unsafe` raw methods (string interpolation is an injection surface,
 * F-04). Run time: a `Proxy` that throws on those members, on the client-lifecycle members and on Prisma's internal
 * (`_`-prefixed) properties, which can reach the root client; it is read-only and is revoked when the transaction ends.
 *
 * Generic over the transaction-client type because the generated client has no import alias for `apps/api` yet
 * (data-model §7.2); the composition root instantiates it as `TenantDb<Prisma.TransactionClient>`.
 */
import { DbError, dbErrorMapping } from './map-db-error.js';

/** Members removed at compile time (ADR-0005 am. 10 item 1). */
export const TENANT_DB_OMITTED = ['$transaction', '$queryRawUnsafe', '$executeRawUnsafe'] as const;

/** `TenantDb = Omit<Prisma.TransactionClient, '$transaction' | '$queryRawUnsafe' | '$executeRawUnsafe'>`. */
export type TenantDb<TTx> = Omit<TTx, (typeof TENANT_DB_OMITTED)[number]>;

/** Members blocked at run time: the omitted ones plus everything that manages or escapes the client. */
const BLOCKED: ReadonlySet<PropertyKey> = new Set<PropertyKey>([
  ...TENANT_DB_OMITTED,
  '$connect',
  '$disconnect',
  '$on',
  '$use',
  '$extends',
  '$runCommandRaw',
]);

/** Thrown when blocked members are touched or the proxy is mutated; a programming error (500). */
export class TenantDbAccessError extends Error {
  constructor(member: string) {
    super(`TenantDb does not expose ${member}`);
    this.name = 'TenantDbAccessError';
  }
}

function isBlocked(key: PropertyKey): boolean {
  return BLOCKED.has(key) || (typeof key === 'string' && key.startsWith('_'));
}

function describeKey(key: PropertyKey): string {
  return typeof key === 'symbol' ? key.toString() : String(key);
}

export interface TenantDbHandle<TTx> {
  readonly db: TenantDb<TTx>;
  /** Makes every later access throw `TENANT_TX_CLOSED` (called when the transaction settles). */
  readonly revoke: () => void;
}

/** Wraps a transaction client in the run-time `TenantDb` guard. */
export function createTenantDb<TTx extends object>(tx: TTx): TenantDbHandle<TTx> {
  let closed = false;
  const bound = new Map<PropertyKey, unknown>();
  const deny = (key: PropertyKey): never => {
    throw new TenantDbAccessError(describeKey(key));
  };
  const handler: ProxyHandler<TTx> = {
    get(target, key) {
      if (closed) throw new DbError(dbErrorMapping(500, 'TENANT_TX_CLOSED'));
      if (isBlocked(key)) return deny(key);
      const cached = bound.get(key);
      if (cached !== undefined) return cached;
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      // Bind to the real client: Prisma methods use internal state that a proxy receiver would not carry.
      const fn = (value as (...args: unknown[]) => unknown).bind(target);
      bound.set(key, fn);
      return fn;
    },
    has(target, key) {
      if (isBlocked(key) && Reflect.getOwnPropertyDescriptor(target, key)?.configurable !== false) return false;
      return Reflect.has(target, key);
    },
    set: (_target, key) => deny(key),
    defineProperty: (_target, key) => deny(key),
    deleteProperty: (_target, key) => deny(key),
    setPrototypeOf: () => deny('prototype'),
  };
  const db = new Proxy(tx, handler) as unknown as TenantDb<TTx>;
  return {
    db,
    revoke: () => {
      closed = true;
      bound.clear();
    },
  };
}
