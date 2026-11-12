/**
 * `TenantDb`: the only database handle repositories receive (ADR-0005 §Transaction-scoped context and amendment 10
 * item 1, PR7-SEC-05; TASK-016).
 *
 * Compile time: the transaction client without `$transaction` (a nested call is a SAVEPOINT; savepoints are not exposed
 * until a use case appears, F-01) and without the `*Unsafe` raw methods (string interpolation is an injection surface,
 * F-04).
 *
 * Run time: a DENY-BY-DEFAULT, DEEP `Proxy` (PR #11 M1, PR11-SEC-01). The Prisma 7 transaction client and every model
 * delegate carry back-references to unguarded clients: `$parent` (the same transaction without a guard; its
 * `_originalClient` is the root client on another pooled connection), a module-private symbol key, `constructor` and
 * the `_`-prefixed internals. A deny-list cannot keep up with that surface, so the guard exposes only:
 *  - top level: the model delegates (lower-camel names from the client's own runtime data model), `$queryRaw` and
 *    `$executeRaw` (tagged-template calls only, PR #11 m5) and `$queryRawTyped`;
 *  - each model delegate, behind its own child guard: the Prisma model operations in {@link MODEL_OPERATIONS}, bound
 *    to the raw delegate (so a query extension's `getExtensionContext(this)` still sees Prisma's own object).
 * Every other string key throws `TenantDbAccessError`. Symbol keys: `Symbol.toStringTag` returns the guard's label;
 * every other symbol, Prisma's private client symbol included, reads as `undefined` (Node's `util.inspect` bypasses
 * Proxy traps and prints the empty target, so logs show no internals). `then` reads as `undefined`, so the handle is
 * not a thenable (`await db` and
 * `return db` from an async function are safe). `ownKeys` / `getOwnPropertyDescriptor` / `has` report only the exposed
 * keys; each guard's Proxy target is an empty, extensible, null-prototype object, so no target invariant constrains
 * what is reported. The guard is read-only, and `revoke()` (the transaction settled) makes the top level and every
 * child guard throw `TENANT_TX_CLOSED`, including delegate and method references taken inside the callback.
 *
 * Generic over the transaction-client type because the generated client has no import alias for `apps/api` yet
 * (data-model §7.2); the composition root instantiates it as `TenantDb<Prisma.TransactionClient>`.
 */
import { DbError, dbErrorMapping } from './map-db-error.js';

/** Members removed at compile time (ADR-0005 am. 10 item 1). */
export const TENANT_DB_OMITTED = ['$transaction', '$queryRawUnsafe', '$executeRawUnsafe'] as const;

/** `TenantDb = Omit<Prisma.TransactionClient, '$transaction' | '$queryRawUnsafe' | '$executeRawUnsafe'>`. */
export type TenantDb<TTx> = Omit<TTx, (typeof TENANT_DB_OMITTED)[number]>;

/** Top-level raw members exposed by the guard. `$queryRaw` and `$executeRaw` accept the tagged-template shape only. */
export const TENANT_DB_RAW_MEMBERS = ['$queryRaw', '$executeRaw', '$queryRawTyped'] as const;
const TAGGED_ONLY: ReadonlySet<string> = new Set(['$queryRaw', '$executeRaw']);
const RAW_MEMBERS: ReadonlySet<string> = new Set(TENANT_DB_RAW_MEMBERS);

/** Prisma model operations exposed on each model delegate (Prisma 7.10 model actions, relational subset). */
export const MODEL_OPERATIONS: ReadonlySet<string> = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
  'aggregate',
  'groupBy',
  'count',
  'fields',
]);

/** Thrown when a member outside the allow-list is touched or the guard is mutated; a programming error (500). */
export class TenantDbAccessError extends Error {
  constructor(member: string) {
    super(`TenantDb does not expose ${member}`);
    this.name = 'TenantDbAccessError';
  }
}

export interface TenantDbHandle<TTx> {
  readonly db: TenantDb<TTx>;
  /** Makes every later access (top level and model delegates) throw `TENANT_TX_CLOSED` (the transaction settled). */
  readonly revoke: () => void;
}

type AnyFunction = (...args: unknown[]) => unknown;

interface GuardState {
  closed: boolean;
}

/** One guard level: the keys it exposes and how an exposed key's value is produced (computed once, then cached). */
interface GuardSpec {
  readonly label: string;
  readonly isAllowed: (key: string) => boolean;
  readonly keys: () => readonly string[];
  readonly resolve: (key: string) => unknown;
}

const lowerFirst = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);

/**
 * The model delegate names of a Prisma client: the keys of its runtime data model (the data Prisma itself builds the
 * delegates from), lower-camel. Fails closed: a client without a readable data model exposes no model.
 */
export function modelDelegateNames(tx: object): ReadonlySet<string> {
  const dataModel: unknown = Reflect.get(tx, '_runtimeDataModel', tx);
  if (typeof dataModel !== 'object' || dataModel === null) return new Set();
  const models: unknown = Reflect.get(dataModel, 'models');
  if (typeof models !== 'object' || models === null) return new Set();
  return new Set(Object.keys(models).map(lowerFirst));
}

/** True for the tagged-template call shape: a frozen array whose `raw` array has the same length. */
export function isTemplateStringsArray(value: unknown): value is TemplateStringsArray {
  if (!Array.isArray(value) || !Object.isFrozen(value)) return false;
  const raw: unknown = (value as unknown as { raw?: unknown }).raw;
  return Array.isArray(raw) && raw.length === value.length;
}

const describeKey = (key: PropertyKey): string => (typeof key === 'symbol' ? key.toString() : String(key));

const deny = (key: PropertyKey): never => {
  throw new TenantDbAccessError(describeKey(key));
};

const closedError = (): DbError => new DbError(dbErrorMapping(500, 'TENANT_TX_CLOSED'));

function guard(spec: GuardSpec, state: GuardState): object {
  const cache = new Map<string, unknown>();
  const exposed = (key: PropertyKey): key is string => typeof key === 'string' && key !== 'then' && spec.isAllowed(key);
  const valueOf = (key: string): unknown => {
    if (state.closed) throw closedError();
    if (!spec.isAllowed(key)) return deny(key);
    if (cache.has(key)) return cache.get(key);
    const value = spec.resolve(key);
    cache.set(key, value);
    return value;
  };
  const open = (): void => {
    if (state.closed) throw closedError();
  };
  return new Proxy(Object.create(null) as object, {
    get(_target, key) {
      if (typeof key === 'symbol') {
        return key === Symbol.toStringTag ? spec.label : undefined;
      }
      return key === 'then' ? undefined : valueOf(key);
    },
    has(_target, key) {
      open();
      return exposed(key);
    },
    ownKeys() {
      open();
      return [...spec.keys()];
    },
    getOwnPropertyDescriptor(_target, key) {
      open();
      return exposed(key) ? { value: valueOf(key), writable: false, enumerable: true, configurable: true } : undefined;
    },
    set: (_target, key) => deny(key),
    defineProperty: (_target, key) => deny(key),
    deleteProperty: (_target, key) => deny(key),
    setPrototypeOf: () => deny('prototype'),
    preventExtensions: () => deny('preventExtensions'),
  });
}

/**
 * A function member is called on the raw object it was read from (Prisma methods use the receiver's internal state),
 * and only while the transaction is open: a method reference kept past `revoke()` throws `TENANT_TX_CLOSED` too.
 * `check` runs first (the tagged-template check of `$queryRaw` / `$executeRaw`).
 */
function bindMember(raw: object, key: string, state: GuardState, check?: (args: unknown[]) => void): unknown {
  const value: unknown = Reflect.get(raw, key, raw);
  if (typeof value !== 'function') return value;
  const fn = value as AnyFunction;
  return (...args: unknown[]): unknown => {
    if (state.closed) throw closedError();
    check?.(args);
    return fn.apply(raw, args);
  };
}

function guardDelegate(name: string, delegate: object, state: GuardState): object {
  const isAllowed = (key: string): boolean => MODEL_OPERATIONS.has(key) && Reflect.has(delegate, key);
  return guard(
    {
      label: `TenantDb.${name}`,
      isAllowed,
      keys: () => [...MODEL_OPERATIONS].filter(isAllowed),
      resolve: (key) => bindMember(delegate, key, state),
    },
    state,
  );
}

/**
 * m5: `$queryRaw` / `$executeRaw` bind every value only in the tagged-template shape; `$queryRaw(Prisma.raw(s))`
 * interpolates and a pre-built `Prisma.sql` fragment escapes review, so any other first argument is refused.
 */
const taggedOnly =
  (key: string) =>
  (args: unknown[]): void => {
    if (!isTemplateStringsArray(args[0])) throw new TenantDbAccessError(`${key} called without a tagged template`);
  };

function rawMember(tx: object, key: string, state: GuardState): unknown {
  return bindMember(tx, key, state, TAGGED_ONLY.has(key) ? taggedOnly(key) : undefined);
}

/** Wraps a transaction client in the run-time `TenantDb` guard. */
export function createTenantDb<TTx extends object>(tx: TTx): TenantDbHandle<TTx> {
  const state: GuardState = { closed: false };
  const models = modelDelegateNames(tx);
  const isAllowed = (key: string): boolean => (models.has(key) || RAW_MEMBERS.has(key)) && Reflect.has(tx, key);
  const db = guard(
    {
      label: 'TenantDb',
      isAllowed,
      keys: () => [...models, ...TENANT_DB_RAW_MEMBERS].filter(isAllowed),
      resolve: (key) => {
        if (!models.has(key)) return rawMember(tx, key, state);
        const delegate: unknown = Reflect.get(tx, key, tx);
        return typeof delegate === 'object' && delegate !== null ? guardDelegate(key, delegate, state) : deny(key);
      },
    },
    state,
  );
  return {
    db: db as TenantDb<TTx>,
    revoke: () => {
      state.closed = true;
    },
  };
}
