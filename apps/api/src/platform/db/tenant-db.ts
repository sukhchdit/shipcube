/**
 * `TenantDb`: the only database handle repositories receive (ADR-0005 §Transaction-scoped context and amendment 10
 * item 1, PR7-SEC-05; TASK-016).
 *
 * Compile time: the transaction client without `$transaction` (a nested call is a SAVEPOINT; savepoints are not exposed
 * until a use case appears, F-01), without the `*Unsafe` raw methods (string interpolation is an injection surface,
 * F-04), without `$queryRawTyped` (PR11-SEC-15 f, see {@link TENANT_DB_OMITTED}) and without the SYSTEM-class model
 * delegates (PR19-SEC-01, D-ARCH-080: `./system-models.ts`; the owning module reaches them through
 * `systemDelegates(tx)` in `./system-db.ts`, whose importers the `platform/system-model-owner` lint restricts).
 *
 * Run time: a DENY-BY-DEFAULT, DEEP `Proxy` (PR #11 M1, PR11-SEC-01). The Prisma 7 transaction client and every model
 * delegate carry back-references to unguarded clients: `$parent` (the same transaction without a guard; its
 * `_originalClient` is the root client on another pooled connection), a module-private symbol key, `constructor` and
 * the `_`-prefixed internals. A deny-list cannot keep up with that surface, so the guard exposes only:
 *  - top level: the model delegates (lower-camel names from the client's own runtime data model) EXCEPT the SYSTEM
 *    ones (a read throws `TenantDbAccessError` naming the `systemDelegates` port), `$queryRaw` and `$executeRaw`
 *    (tagged-template calls only, every value bound, Sql fragments refused: PR #11 m5, PR11-SEC-13);
 *  - each model delegate, behind its own child guard: the Prisma model operations in {@link MODEL_OPERATIONS}, bound
 *    to the raw delegate (so a query extension's `getExtensionContext(this)` still sees Prisma's own object);
 *  - what an exposed operation returns: a thenable result (Prisma's `PrismaPromise`) is replaced by a LAZY guarded
 *    result exposing only `then` / `catch` / `finally` (R2-M1, PR11-SEC-12; see {@link guardResult}); reading any
 *    other string key of it throws `TenantDbAccessError` ({@link FLUENT_HINT}, PR #11 R3-n4). Prisma's
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
 * child guard throw `TENANT_TX_CLOSED`, including delegate and method references taken inside the callback, and the
 * SYSTEM delegates handed out by `systemDelegates(tx)` for the same handle.
 *
 * Generic over the transaction-client type because the generated client has no import alias for `apps/api` yet
 * (data-model §7.2); the composition root instantiates it as `TenantDb<Prisma.TransactionClient>`.
 */
import { DbError, dbErrorMapping } from './map-db-error.js';
import { refusedRawStatement } from './raw-statement.js';
import { SYSTEM_MODELS, type SystemModelName } from './system-models.js';
import { registerSystemPort } from './system-port.js';

/**
 * Members removed at compile time (ADR-0005 am. 10 item 1) and refused at run time. `$queryRawTyped` (PR11-SEC-15 f)
 * stays out until the `typedSql` preview is adopted: once enabled it runs `sql`/`values` from its argument as given,
 * and `makeTypedQueryFactory` builds a `TypedSql` from any string, so it is a `$queryRawUnsafe` equivalent.
 */
export const TENANT_DB_OMITTED = ['$transaction', '$queryRawUnsafe', '$executeRawUnsafe', '$queryRawTyped'] as const;

/**
 * `TenantDb = Omit<Prisma.TransactionClient, '$transaction' | '$queryRawUnsafe' | '$executeRawUnsafe' | '$queryRawTyped'
 * | SystemModelName>`: the SYSTEM-class model delegates are not part of it (PR19-SEC-01, D-ARCH-080).
 *
 * The optional symbol-keyed member is a compile-time-only carrier of `TTx` (the guard reads every symbol other than
 * `Symbol.toStringTag` as `undefined`, so it is truthful at run time): it lets `systemDelegates(tx)` infer the
 * transaction-client type from a `TenantDb` argument, which TypeScript cannot do through `Omit`.
 */
export type TenantDb<TTx> = Omit<TTx, (typeof TENANT_DB_OMITTED)[number] | SystemModelName> & {
  readonly [TENANT_DB_CLIENT]?: TTx;
};
declare const TENANT_DB_CLIENT: unique symbol;

/** Top-level raw members exposed by the guard; both accept the tagged-template shape only (see {@link taggedOnly}). */
export const TENANT_DB_RAW_MEMBERS = ['$queryRaw', '$executeRaw'] as const;
const RAW_MEMBERS: ReadonlySet<string> = new Set(TENANT_DB_RAW_MEMBERS);

/** `Object.prototype.toString` label of a guarded operation result. */
export const TENANT_DB_RESULT_LABEL = 'TenantDbResult';
/** `Object.prototype.toString` label of the SYSTEM-delegate guard handed out by `systemDelegates(tx)`. */
export const SYSTEM_DELEGATES_LABEL = 'SystemDelegates';
/** Why a SYSTEM model is refused on the top level: the error names the port (PR19-SEC-01, D-ARCH-080). */
export const SYSTEM_MODEL_HINT = 'a SYSTEM model is reached only through systemDelegates(tx) (platform/db/system-db.ts, D-ARCH-080)';
/** Why a member of a guarded operation result other than then/catch/finally is refused (PR #11 R3-n4). */
export const FLUENT_HINT = 'fluent accessors are not exposed; use include/select';
const SYSTEM_MODEL_SET: ReadonlySet<string> = new Set(SYSTEM_MODELS);
/** Members of a guarded operation result (see {@link guardResult}). */
const RESULT_MEMBERS: ReadonlySet<string> = new Set(['then', 'catch', 'finally']);
/**
 * Well-known probe keys of serialisers, renderers and matchers (`JSON.stringify`, React and Jest's pretty-format, Jest
 * asymmetric matchers) read as `undefined` on a guarded result instead of throwing, so logging or printing a pending
 * result cannot fail the request (PR #32 n2). They are not Prisma members, so nothing is exposed.
 */
const RESULT_PROBE_KEYS: ReadonlySet<string> = new Set(['toJSON', '$$typeof', 'asymmetricMatch', 'nodeType']);
/** Constructor names of Prisma's `Sql` fragment class (`sql-template-tag`; the bundled class expression is `_Sql`). */
const SQL_FRAGMENT_CLASSES: ReadonlySet<string> = new Set(['Sql', '_Sql']);
/** Prototype chains deeper than this are treated as fragments (fail closed; bounded walk). */
const MAX_PROTOTYPE_DEPTH = 32;

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
  /** @param detail why the member is refused (appended to the message, e.g. the port that does expose it). */
  constructor(member: string, detail?: string) {
    super(detail === undefined ? `TenantDb does not expose ${member}` : `TenantDb does not expose ${member}: ${detail}`);
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
  /** Why a refused key is refused, when there is more to say than "not exposed". */
  readonly explain?: (key: string) => string | undefined;
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
 * `new Prisma.Sql([s], [])`, a subclass at any depth) and for anything shaped like one (PR11-SEC-17 a/b, PR #11 R3-n2):
 *  - duck-typed: an object or function (arrays included) with BOTH a `strings` and a `values` key, own or inherited,
 *    whatever their values (`'strings' in v && 'values' in v`, not `Array.isArray`, so an array-like or a getter does
 *    not slip past it). A plain JSON value of that shape is refused too (fail closed);
 *  - nominal: ANY prototype on the chain (walked to the end, at most {@link MAX_PROTOTYPE_DEPTH} levels; deeper is
 *    refused) has a `constructor` named `Sql` / `_Sql`. Prisma's template tag splices a value when
 *    `value instanceof Sql`, i.e. when `Sql.prototype` is anywhere on the chain, and `Sql.prototype.constructor` is the
 *    class itself, so an intermediate prototype with its own `constructor` (the R3-n2 forge, which passed the former
 *    first-prototype check) no longer hides it.
 * Read through `Reflect` only. Limit: the check sees what the value's Proxy traps (if any) report. A Proxy whose
 * `has` / `getPrototypeOf` traps answer this check differently from Prisma's later `instanceof` (a stateful forge), or
 * a future Prisma that renames the class AND stops storing `strings` / `values` on the instance, is not detected here;
 * the `platform/db-raw-sql` lint (no `Sql` class, no `raw`, no untracked Prisma container or fragment constructor in
 * application code) and code review are the control for such deliberate forges.
 */
export function isSqlFragment(value: unknown): boolean {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
  if (Reflect.has(value, 'strings') && Reflect.has(value, 'values')) return true;
  let proto = Reflect.getPrototypeOf(value);
  for (let depth = 0; proto !== null; depth += 1) {
    if (depth >= MAX_PROTOTYPE_DEPTH) return true;
    const ctor: unknown = Reflect.get(proto, 'constructor');
    if (typeof ctor === 'function' && SQL_FRAGMENT_CLASSES.has(ctor.name)) return true;
    proto = Reflect.getPrototypeOf(proto);
  }
  return false;
}

const describeKey = (key: PropertyKey): string => (typeof key === 'symbol' ? key.toString() : String(key));

const deny = (key: PropertyKey, detail?: string): never => {
  throw new TenantDbAccessError(describeKey(key), detail);
};

const closedError = (): DbError => new DbError(dbErrorMapping(500, 'TENANT_TX_CLOSED'));

function guard(spec: GuardSpec, state: GuardState): object {
  const cache = new Map<string, unknown>();
  const exposed = (key: PropertyKey): key is string => typeof key === 'string' && key !== 'then' && spec.isAllowed(key);
  const valueOf = (key: string): unknown => {
    if (state.closed) throw closedError();
    if (!spec.isAllowed(key)) return deny(key, spec.explain?.(key));
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
 * Proxy over a frozen, null-prototype result exposing ONLY `then`, `catch`, `finally` and `Symbol.toStringTag`
 * ({@link TENANT_DB_RESULT_LABEL}). PR #11 R3-n4: reading ANY other string key throws `TenantDbAccessError`
 * ({@link FLUENT_HINT}), so `requestTransaction`, `spec` and a fluent relation accessor (`findUnique(…).posts()`) fail
 * loudly instead of reading `undefined`; `in`, `Object.keys` and other symbols stay silent (`false`, the three members,
 * `undefined`), so `await`, `Promise.resolve`, Jest and `util.inspect` behave as with any thenable. `catch` and
 * `finally` are kept beside `then` because the declared return type is Prisma's `PrismaPromise`, a `Promise`, and code
 * that type-checks against it may call them: refusing them would turn well-typed code into a run-time error, and both
 * only chain on the same native promise as `then` (no Prisma member behind them).
 * It is LAZY like the `PrismaPromise` it wraps: nothing runs until one of the three is called. Each of them first
 * checks the transaction: once it settled (`revoke()`), they return a promise rejected with `TENANT_TX_CLOSED`
 * WITHOUT calling the wrapped `then`, so no statement is ever sent (a result kept past commit gets `TENANT_TX_CLOSED`,
 * not P2028), and that holds also for a result whose query already ran. While open, the first call starts the query
 * once (the wrapped `then`) and every call chains on that same native `Promise`, which carries no Prisma member
 * either. Non-thenable values pass through unchanged.
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
  const target = Object.freeze(Object.assign(Object.create(null) as object, members));
  return new Proxy(target, {
    get(frozen, key) {
      if (typeof key !== 'symbol' && RESULT_PROBE_KEYS.has(key)) return undefined;
      if (typeof key !== 'symbol' && !RESULT_MEMBERS.has(key)) return deny(key, FLUENT_HINT);
      const member: unknown = Reflect.get(frozen, key);
      return member;
    },
  });
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

function guardDelegate(label: string, delegate: object, state: GuardState): object {
  const isAllowed = (key: string): boolean => MODEL_OPERATIONS.has(key) && Reflect.has(delegate, key);
  return guard(
    {
      label,
      isAllowed,
      keys: () => [...MODEL_OPERATIONS].filter(isAllowed),
      resolve: (key) => bindMember(delegate, key, state),
    },
    state,
  );
}

/** The guarded delegate `key` of `tx`, or a `TenantDbAccessError` when the data-model name has no object behind it. */
function delegateOf(tx: object, key: string, label: string, state: GuardState): object {
  const delegate: unknown = Reflect.get(tx, key, tx);
  return typeof delegate === 'object' && delegate !== null ? guardDelegate(`${label}.${key}`, delegate, state) : deny(key);
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
 *  - PR44-SEC-05 (TASK-020 part 020-D): the statement may not end, nest or prepare the transaction (`COMMIT`,
 *    `ROLLBACK`, `END`, `SAVEPOINT`, …), change the pooled session (`SET` in any form, `RESET`, `DISCARD`, …), be an
 *    anonymous `DO` block, set a setting beyond the transaction, or be unreadable (`refusedRawStatement`,
 *    ./raw-statement.ts). A `COMMIT` sent from `load` would end its read-only transaction and run the rest in
 *    autocommit without the tenant context; a session `SET` would outlive the request on the pooled connection.
 * Every check throws `TenantDbAccessError` before Prisma is called, so nothing reaches the server. The
 * `platform/db-raw-sql` lint reports the same shapes at build time.
 */
const taggedOnly =
  (key: string) =>
  (args: unknown[]): void => {
    const [strings, ...values] = args;
    if (!isTemplateStringsArray(strings)) throw new TenantDbAccessError(`${key} called without a tagged template`);
    if (values.some(isSqlFragment)) throw new TenantDbAccessError(`${key} with an interpolated Sql fragment`);
    const refusal = refusedRawStatement(strings);
    if (refusal !== undefined) throw new TenantDbAccessError(`${key} with a ${refusal.form} statement (${refusal.detail})`);
  };

function rawMember(tx: object, key: string, state: GuardState): unknown {
  return bindMember(tx, key, state, taggedOnly(key));
}

/**
 * The SYSTEM-delegate guard of one handle (PR19-SEC-01, D-ARCH-080): only the SYSTEM models of the client's data
 * model, each behind the same child guard as a tenant delegate, sharing the handle's state (so `revoke()` closes them
 * too). Built at most once per handle, when `systemDelegates(tx)` first asks for it.
 */
function systemGuard(tx: object, systemModels: ReadonlySet<string>, state: GuardState): () => object {
  let built: object | undefined;
  return () => {
    const isAllowed = (key: string): boolean => systemModels.has(key) && Reflect.has(tx, key);
    built ??= guard(
      {
        label: SYSTEM_DELEGATES_LABEL,
        isAllowed,
        keys: () => [...systemModels].filter(isAllowed),
        resolve: (key) => delegateOf(tx, key, SYSTEM_DELEGATES_LABEL, state),
      },
      state,
    );
    return built;
  };
}

/** Wraps a transaction client in the run-time `TenantDb` guard. */
export function createTenantDb<TTx extends object>(tx: TTx): TenantDbHandle<TTx> {
  const state: GuardState = { closed: false };
  const allModels = [...modelDelegateNames(tx)];
  const models: ReadonlySet<string> = new Set(allModels.filter((name) => !SYSTEM_MODEL_SET.has(name)));
  const systemModels: ReadonlySet<string> = new Set(allModels.filter((name) => SYSTEM_MODEL_SET.has(name)));
  const isAllowed = (key: string): boolean => (models.has(key) || RAW_MEMBERS.has(key)) && Reflect.has(tx, key);
  const db = guard(
    {
      label: 'TenantDb',
      isAllowed,
      keys: () => [...models, ...TENANT_DB_RAW_MEMBERS].filter(isAllowed),
      resolve: (key) => (models.has(key) ? delegateOf(tx, key, 'TenantDb', state) : rawMember(tx, key, state)),
      explain: (key) => (SYSTEM_MODEL_SET.has(key) ? SYSTEM_MODEL_HINT : undefined),
    },
    state,
  );
  registerSystemPort(db, systemGuard(tx, systemModels, state));
  return {
    db: db as TenantDb<TTx>,
    revoke: () => {
      state.closed = true;
    },
  };
}
