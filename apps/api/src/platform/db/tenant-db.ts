/**
 * `TenantDb`: the only database handle repositories receive (ADR-0005 §Transaction-scoped context and amendment 10
 * item 1, PR7-SEC-05; TASK-016).
 *
 * Compile time: the transaction client without `$transaction` (a nested call is a SAVEPOINT; savepoints are not exposed
 * until a use case appears, F-01), without the `*Unsafe` raw methods (string interpolation is an injection surface,
 * F-04) and without `$queryRawTyped` (PR11-SEC-15 f, see {@link TENANT_DB_OMITTED}).
 *
 * Run time: a DENY-BY-DEFAULT, DEEP `Proxy` (PR #11 M1, PR11-SEC-01). The Prisma 7 transaction client and every model
 * delegate carry back-references to unguarded clients: `$parent` (the same transaction without a guard; its
 * `_originalClient` is the root client on another pooled connection), a module-private symbol key, `constructor` and
 * the `_`-prefixed internals. A deny-list cannot keep up with that surface, so the guard exposes only:
 *  - top level: the model delegates (lower-camel names from the client's own runtime data model), `$queryRaw` and
 *    `$executeRaw` (tagged-template calls only, every value bound, Sql fragments refused: PR #11 m5, PR11-SEC-13);
 *  - each model delegate, behind its own child guard: the Prisma model operations in {@link MODEL_OPERATIONS}, bound
 *    to the raw delegate (so a query extension's `getExtensionContext(this)` still sees Prisma's own object);
 *  - what an exposed operation returns: a thenable result (Prisma's `PrismaPromise`) is replaced by a LAZY guarded
 *    result exposing only `then` / `catch` / `finally` (R2-M1, PR11-SEC-12; see {@link guardResult}). Prisma's
 *    `requestTransaction` (re-runs the query with a caller-chosen transaction: `null` is the root pool), `spec` and the
 *    FLUENT relation accessors (`db.user.findUnique(…).posts()`) are therefore not exposed: load relations with
 *    `include` / `select` instead.
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

/**
 * Members removed at compile time (ADR-0005 am. 10 item 1) and refused at run time. `$queryRawTyped` (PR11-SEC-15 f)
 * stays out until the `typedSql` preview is adopted: once enabled it runs `sql`/`values` from its argument as given,
 * and `makeTypedQueryFactory` builds a `TypedSql` from any string, so it is a `$queryRawUnsafe` equivalent.
 */
export const TENANT_DB_OMITTED = ['$transaction', '$queryRawUnsafe', '$executeRawUnsafe', '$queryRawTyped'] as const;

/** `TenantDb = Omit<Prisma.TransactionClient, '$transaction' | '$queryRawUnsafe' | '$executeRawUnsafe' | '$queryRawTyped'>`. */
export type TenantDb<TTx> = Omit<TTx, (typeof TENANT_DB_OMITTED)[number]>;

/** Top-level raw members exposed by the guard; both accept the tagged-template shape only (see {@link taggedOnly}). */
export const TENANT_DB_RAW_MEMBERS = ['$queryRaw', '$executeRaw'] as const;
const RAW_MEMBERS: ReadonlySet<string> = new Set(TENANT_DB_RAW_MEMBERS);

/** `Object.prototype.toString` label of a guarded operation result. */
export const TENANT_DB_RESULT_LABEL = 'TenantDbResult';
/** Constructor names of Prisma's `Sql` fragment class (`sql-template-tag`; the bundled class expression is `_Sql`). */
const SQL_FRAGMENT_CLASSES: ReadonlySet<string> = new Set(['Sql', '_Sql']);

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

/**
 * True for the tagged-template call shape: a frozen array whose `raw` array is frozen too and has the same length
 * (R2-n3). Limit: this rejects every accidental shape, but a DELIBERATE forge
 * (`Object.freeze(Object.assign([s], { raw: Object.freeze([s]) }))`) still passes and Prisma interpolates its strings;
 * the `platform/db-raw-sql` lint and code review are the control for that.
 */
export function isTemplateStringsArray(value: unknown): value is TemplateStringsArray {
  if (!Array.isArray(value) || !Object.isFrozen(value)) return false;
  const raw: unknown = (value as unknown as { raw?: unknown }).raw;
  return Array.isArray(raw) && Object.isFrozen(raw) && raw.length === value.length;
}

/**
 * True for a Prisma `Sql` fragment (`Prisma.raw(s)`, `` Prisma.sql`…` ``, `Prisma.sql([s])`, `Prisma.join(…)`,
 * `new Prisma.Sql([s], [])`, a subclass): duck-typed, a non-array object whose `strings` and `values` are arrays (the
 * shape Prisma's template tag splices into the statement text), or whose prototype's constructor is the `Sql` class.
 * Read through `Reflect` only. A plain JSON value of exactly that shape is refused too (fail closed).
 */
export function isSqlFragment(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (Array.isArray(Reflect.get(value, 'strings')) && Array.isArray(Reflect.get(value, 'values'))) return true;
  const proto = Reflect.getPrototypeOf(value);
  const ctor: unknown = proto === null ? undefined : Reflect.get(proto, 'constructor');
  return typeof ctor === 'function' && SQL_FRAGMENT_CLASSES.has(ctor.name);
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

/** The `then` function of a thenable (object or function), else `undefined`. */
function thenOf(value: unknown): AnyFunction | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined;
  const then: unknown = Reflect.get(value, 'then');
  return typeof then === 'function' ? (then as AnyFunction) : undefined;
}

type Then = Promise<unknown>['then'];
type Catch = Promise<unknown>['catch'];
type Finally = Promise<unknown>['finally'];

/**
 * R2-M1 / PR11-SEC-12: what an exposed operation returns, guarded. A thenable (Prisma's `PrismaPromise`) becomes a
 * frozen, null-prototype result exposing ONLY `then`, `catch`, `finally` and `Symbol.toStringTag`
 * ({@link TENANT_DB_RESULT_LABEL}); `requestTransaction`, `spec` and the fluent relation accessors are absent (`in` is
 * false, a read is `undefined`). It is LAZY like the `PrismaPromise` it wraps: nothing runs until one of the three is
 * called. Each of them first checks the transaction: once it settled (`revoke()`), they return a promise rejected with
 * `TENANT_TX_CLOSED` WITHOUT calling the wrapped `then`, so no statement is ever sent (a result kept past commit gets
 * `TENANT_TX_CLOSED`, not P2028), and that holds also for a result whose query already ran. While open, the first call
 * starts the query once (the wrapped `then`) and every call chains on that same native `Promise`, which carries no
 * Prisma member either. Non-thenable values pass through unchanged.
 */
function guardResult(result: unknown, state: GuardState): unknown {
  const then = thenOf(result);
  if (then === undefined) return result;
  let started: Promise<unknown> | undefined;
  const settle = (): Promise<unknown> => {
    if (state.closed) return Promise.reject(closedError());
    started ??= new Promise((resolve, reject) => {
      Reflect.apply(then, result, [resolve, reject]);
    });
    return started;
  };
  const members = {
    then: ((...args: Parameters<Then>) => settle().then(...args)) as Then,
    catch: ((...args: Parameters<Catch>) => settle().catch(...args)) as Catch,
    finally: ((...args: Parameters<Finally>) => settle().finally(...args)) as Finally,
    [Symbol.toStringTag]: TENANT_DB_RESULT_LABEL,
  };
  return Object.freeze(Object.assign(Object.create(null) as object, members));
}

/**
 * A function member is called on the raw object it was read from (Prisma methods use the receiver's internal state),
 * and only while the transaction is open: a method reference kept past `revoke()` throws `TENANT_TX_CLOSED` too.
 * `check` runs first (the tagged-template check of `$queryRaw` / `$executeRaw`); the return value is guarded
 * ({@link guardResult}).
 */
function bindMember(raw: object, key: string, state: GuardState, check?: (args: unknown[]) => void): unknown {
  const value: unknown = Reflect.get(raw, key, raw);
  if (typeof value !== 'function') return value;
  const fn = value as AnyFunction;
  return (...args: unknown[]): unknown => {
    if (state.closed) throw closedError();
    check?.(args);
    return guardResult(fn.apply(raw, args), state);
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
 * Run-time rule for `$queryRaw` / `$executeRaw` (PR #11 m5, PR11-SEC-13): every value of a tagged template is BOUND,
 * never spliced.
 *  - The first argument must be a tagged template's strings array ({@link isTemplateStringsArray}): the `Sql`-object
 *    overload (`$queryRaw(Prisma.raw(s))`, `$queryRaw(Prisma.sql…)`) and a plain string are refused.
 *  - No interpolated value may be a Prisma `Sql` fragment ({@link isSqlFragment}): Prisma's template tag splices a
 *    fragment's strings into the statement text, so `` $queryRaw`… ${Prisma.raw(s)}` `` (and `Prisma.sql`,
 *    `Prisma.join`, `new Prisma.Sql`) would interpolate. The guard cannot tell a reviewed fragment from `raw(input)`,
 *    so ALL fragments are refused. Write one template per statement shape and bind lists as arrays, e.g.
 *    `` WHERE id = ANY(${ids}::uuid[]) ``.
 * Both checks throw `TenantDbAccessError` before Prisma is called. The `platform/db-raw-sql` lint reports the same
 * shapes at build time.
 */
const taggedOnly =
  (key: string) =>
  (args: unknown[]): void => {
    const [strings, ...values] = args;
    if (!isTemplateStringsArray(strings)) throw new TenantDbAccessError(`${key} called without a tagged template`);
    if (values.some(isSqlFragment)) throw new TenantDbAccessError(`${key} with an interpolated Sql fragment`);
  };

function rawMember(tx: object, key: string, state: GuardState): unknown {
  return bindMember(tx, key, state, taggedOnly(key));
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
