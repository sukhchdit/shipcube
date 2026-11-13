/**
 * Readiness evaluation shared by the API router and the worker health server (US-012, REQ-PLAT-018,
 * openapi.yaml `getReadiness`). Process-agnostic: no Express, no `node:http`. Checks run in parallel; each is
 * bounded by its own timeout (2 s, US-012 notes) and all of them by an overall deadline (AT-US-012-03: the
 * response arrives within 2.5 s). A check that ignores its abort signal still cannot hold the response.
 *
 * Bodies carry fixed component names and enum statuses only (AT-US-012-05): never error messages, host names,
 * versions or stacks. A failure's cause is not inspected at all.
 */

/** Component keys of the `HealthReady` schema (openapi.yaml), in schema order. */
export const READINESS_COMPONENTS = ['database', 'redis', 'object_storage', 'audit_partitions', 'audit_chain'] as const;
export type ReadinessComponent = (typeof READINESS_COMPONENTS)[number];

/**
 * Components whose failure makes the process not ready (503). `audit_partitions` is critical since TASK-021
 * (data-model §5.3 amendment 2026-11-13, D-ARCH-076): a missing month in [current, current + 2] or a squatted partition
 * name fails every audited write, so it is `unavailable`; only a late pre-creation (current + 3 missing) degrades it
 * (AT-US-012-04). `audit_chain` only ever degrades.
 */
const CRITICAL: ReadonlySet<ReadinessComponent> = new Set(['database', 'redis', 'object_storage', 'audit_partitions']);

/** Components whose schema enum includes `degraded` (openapi.yaml `HealthReady`). */
const DEGRADABLE: ReadonlySet<ReadinessComponent> = new Set(['audit_partitions', 'audit_chain']);

export const isCriticalComponent = (name: ReadinessComponent): boolean => CRITICAL.has(name);

/** What a check resolves with: `undefined` (usable) or `'degraded'` (usable but late; degradable components only). */
export type CheckOutcome = void | 'degraded';

export interface ReadinessCheck {
  /** The `HealthReady.components` key this check reports. */
  readonly name: ReadinessComponent;
  /** `true`: a failure reports `unavailable` and readiness answers 503; `false`: a failure reports `degraded`. */
  readonly critical: boolean;
  /**
   * Resolves when the dependency is usable (with `'degraded'` when usable but late, for a component whose schema enum
   * has `degraded`); rejects otherwise. Must honour `signal`.
   */
  check(signal: AbortSignal): Promise<CheckOutcome>;
}

export type CriticalStatus = 'ok' | 'unavailable';
export type DegradableStatus = 'ok' | 'degraded';
export type AuditPartitionsStatus = 'ok' | 'degraded' | 'unavailable';

/** The `HealthReady` body. */
export interface ReadinessBody {
  readonly status: 'ok' | 'degraded' | 'unavailable';
  readonly components: {
    readonly database: CriticalStatus;
    readonly redis: CriticalStatus;
    readonly object_storage: CriticalStatus;
    readonly audit_partitions: AuditPartitionsStatus;
    readonly audit_chain: DegradableStatus;
  };
}

export interface ReadinessReport {
  readonly httpStatus: 200 | 503;
  readonly body: ReadinessBody;
}

/** `{ status: 'ok' }`: liveness has no dependency I/O (US-012). */
export const LIVENESS_BODY = Object.freeze({ status: 'ok' as const });

/** US-012 notes: 2 s per dependency. */
export const READINESS_CHECK_TIMEOUT_MS = 2_000;
/** AT-US-012-03: the whole readiness response within 2.5 s (the rest is left for serialisation and the network). */
export const READINESS_DEADLINE_MS = 2_250;

/**
 * PR-0009 m3 / PR9-SEC-08: `/health/ready` is public and unthrottled, so concurrent calls share one evaluation and a
 * report is reused for this long (dependency I/O at most about once per second per process, whatever the poll rate).
 */
export const READINESS_CACHE_TTL_MS = 1_000;

export interface ReadinessOptions {
  readonly checkTimeoutMs?: number;
  readonly deadlineMs?: number;
  /** Reuse a completed report for this long; 0 disables reuse (concurrent calls still share one evaluation). */
  readonly cacheTtlMs?: number;
  readonly now?: () => number;
}

/**
 * Validated set of checks: exactly one per component, with the criticality the schema implies. Thrown at
 * construction (a wiring error), never at request time.
 */
export function assertReadinessChecks(checks: readonly ReadinessCheck[]): readonly ReadinessCheck[] {
  const names = checks.map((check) => check.name);
  const missing = READINESS_COMPONENTS.filter((name) => !names.includes(name));
  if (missing.length > 0 || names.length !== READINESS_COMPONENTS.length) {
    throw new TypeError(`readiness checks must cover each of ${READINESS_COMPONENTS.join(', ')} exactly once`);
  }
  const wrong = checks.filter((check) => check.critical !== isCriticalComponent(check.name));
  if (wrong.length > 0)
    throw new TypeError(`readiness check criticality does not match the schema: ${wrong.map((c) => c.name).join(', ')}`);
  return Object.freeze([...checks]);
}

/** Result of one check run: resolved in time (`ok` or, for a degradable component, `degraded`) or `failed`. */
type CheckResult = 'ok' | 'degraded' | 'failed';

/** Runs one check against its own timeout and the shared deadline; `failed` unless it resolved in time. */
async function runCheck(check: ReadinessCheck, timeoutMs: number, deadline: AbortSignal): Promise<CheckResult> {
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), deadline]);
  if (signal.aborted) return 'failed';
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<'failed'>((resolve) => {
    onAbort = () => resolve('failed');
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    // Any rejection means "not usable"; its message is deliberately never read (AT-US-012-05).
    const ran = Promise.resolve(signal)
      .then((started) => check.check(started))
      .then(
        (outcome): CheckResult => {
          if (signal.aborted) return 'failed';
          if (outcome === undefined) return 'ok';
          // `degraded` from a component whose schema enum lacks it fails closed (never reported as ok).
          return outcome === 'degraded' && DEGRADABLE.has(check.name) ? 'degraded' : 'failed';
        },
        (): CheckResult => 'failed',
      );
    return await Promise.race([ran, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function report(results: ReadonlyMap<ReadinessComponent, CheckResult>): ReadinessReport {
  const critical = (name: ReadinessComponent): CriticalStatus => (results.get(name) === 'ok' ? 'ok' : 'unavailable');
  const degradable = (name: ReadinessComponent): DegradableStatus => (results.get(name) === 'ok' ? 'ok' : 'degraded');
  const partitions = results.get('audit_partitions');
  const components = {
    database: critical('database'),
    redis: critical('redis'),
    object_storage: critical('object_storage'),
    audit_partitions: partitions === 'ok' || partitions === 'degraded' ? partitions : ('unavailable' as const),
    audit_chain: degradable('audit_chain'),
  };
  const values: readonly string[] = Object.values(components);
  if (values.includes('unavailable')) return { httpStatus: 503, body: { status: 'unavailable', components } };
  return { httpStatus: 200, body: { status: values.includes('degraded') ? 'degraded' : 'ok', components } };
}

/** Evaluates every check in parallel within the per-check timeout and the overall deadline. */
export async function evaluateReadiness(checks: readonly ReadinessCheck[], options: ReadinessOptions = {}): Promise<ReadinessReport> {
  const timeoutMs = options.checkTimeoutMs ?? READINESS_CHECK_TIMEOUT_MS;
  const deadline = AbortSignal.timeout(options.deadlineMs ?? READINESS_DEADLINE_MS);
  const outcomes = await Promise.all(checks.map(async (check) => [check.name, await runCheck(check, timeoutMs, deadline)] as const));
  return report(new Map(outcomes));
}

/**
 * The report while the process drains (NFR-AVAIL-002): 503 at once, without dependency I/O. The listener closes in
 * the same tick; a pre-close delay that lets the load balancer deregister first is TASK-214 (PR-0009 n2). Critical
 * components read `unavailable` (this process cannot serve them any more), `audit_chain` `degraded`.
 */
export const DRAINING_REPORT: ReadinessReport = Object.freeze({
  httpStatus: 503,
  body: Object.freeze({
    status: 'unavailable',
    components: Object.freeze({
      database: 'unavailable',
      redis: 'unavailable',
      object_storage: 'unavailable',
      audit_partitions: 'unavailable',
      audit_chain: 'degraded',
    }),
  }),
});

/** A readiness probe bound to its checks and the process drain state; used by the API router and the worker server. */
export interface ReadinessProbe {
  readiness(): Promise<ReadinessReport>;
  /** Readiness answers 503 from now on (graceful shutdown). */
  startDraining(): void;
  readonly draining: boolean;
}

export function createReadinessProbe(checks: readonly ReadinessCheck[], options: ReadinessOptions = {}): ReadinessProbe {
  const validated = assertReadinessChecks(checks);
  const ttlMs = options.cacheTtlMs ?? READINESS_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  let draining = false;
  let inflight: Promise<ReadinessReport> | undefined;
  let last: { readonly report: ReadinessReport; readonly at: number } | undefined;

  const evaluate = (): Promise<ReadinessReport> => {
    if (last !== undefined && now() - last.at < ttlMs) return Promise.resolve(last.report);
    inflight ??= evaluateReadiness(validated, options)
      .then((report) => {
        last = { report, at: now() };
        return report;
      })
      .finally(() => {
        inflight = undefined;
      });
    return inflight;
  };

  return {
    // Draining answers at once, without I/O and without a cached report.
    readiness: () => (draining ? Promise.resolve(DRAINING_REPORT) : evaluate()),
    startDraining: () => {
      draining = true;
    },
    get draining() {
      return draining;
    },
  };
}

/** Every object pendingCheck returned (a brand: a copy or a real check with the same name is not pending). */
const PENDING_CHECKS = new WeakSet<ReadinessCheck>();

/** Components that may still be stubbed: the audit checks are real since TASK-021 and are never stubbed. */
export type PendableComponent = Exclude<ReadinessComponent, `audit_${string}`>;

/**
 * Placeholder for a component whose client does not exist yet. Each use names the task that replaces it, and
 * services.test.ts fails once the replacement exists while the stub is still wired.
 *  - An audit component is refused (TypeError): a stub would read an unverified audit as healthy or as merely
 *    degraded, which PR9-SEC-11 forbids (code review PR #24 R1-n2).
 *  - A critical component passes: `unavailable` would keep every stack permanently not ready (PR-0009 m2 ruling).
 *  - A non-critical component (none is pendable today) would report `degraded`, never `ok` (fail closed).
 */
export function pendingCheck(name: PendableComponent): ReadinessCheck {
  if ((name as string).startsWith('audit_')) throw new TypeError(`${name} has a real readiness check and is never stubbed`);
  const critical = isCriticalComponent(name);
  const stub: ReadinessCheck = Object.freeze({
    name,
    critical,
    check: () => (critical ? Promise.resolve() : Promise.reject(new Error(`${name} check pending`))),
  });
  PENDING_CHECKS.add(stub);
  return stub;
}

/** True when `check` is a placeholder from pendingCheck (PR-0009 R2-m1: the stub tripwires test the object, not the name). */
export function isPendingCheck(check: ReadinessCheck): boolean {
  return PENDING_CHECKS.has(check);
}
