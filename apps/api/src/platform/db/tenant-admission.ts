/**
 * Per-tenant admission bulkhead of `withTenantTx` (ADR-0007 amendment 10 item 3, D-ARCH-086, data-model §7.7; TASK-025).
 *
 * A noisy-neighbour control, not a fairness scheduler: before a tenant transaction checks a connection out of the
 * process pool, it must hold one of at most `maxConcurrentTx` permits of its admission key. An arrival that finds the
 * key saturated waits FIFO for at most `waitMs`; at most `2 × maxConcurrentTx` arrivals wait per key. An arrival that
 * finds the queue full is refused at once (`depth`), a waiter whose wait expires is refused (`wait`); both get the
 * retryable 503 `TENANT_CONCURRENCY_LIMIT` and their transaction is never started.
 *
 * A release hands its permit straight to the head waiter (no barging), clears that waiter's timer and, when the key is
 * idle (no permit held, nobody waiting), deletes the key's state: with ~125k organisations nothing stays behind per
 * key. Acquire and release are O(1) (a doubly linked waiter list, so an expiring waiter unlinks in O(1) as well).
 *
 * Counters follow the `sessionContextLeaks()` precedent of `./runtime.ts`: in-process values behind a read-only
 * snapshot until the metrics pipeline exports them. Nothing is logged per request.
 */
import { DbError, dbErrorMapping } from './map-db-error.js';

/** `key_kind` label of `db_tenant_admission_inflight`. */
export type AdmissionKeyKind = 'tenant' | 'anonymous' | 'operator';

/** `reason` label of `db_tenant_admission_rejected_total`. */
export type AdmissionRejectReason = 'wait' | 'depth';

/** The admission key of one transaction: the lowercase organisation UUID, `anonymous` or `operator`. */
export interface AdmissionKey {
  readonly key: string;
  readonly kind: AdmissionKeyKind;
}

export interface TenantAdmissionOptions {
  /** `DB_TENANT_MAX_CONCURRENT_TX`: permits per key per process. */
  readonly maxConcurrentTx: number;
  /** `DB_TENANT_ADMISSION_WAIT_MS`: the longest FIFO wait for a permit. */
  readonly waitMs: number;
}

/** Timer seam (unit tests); defaults to the global timers. */
export interface AdmissionTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Metric names the snapshot fields are exported under. */
export const TENANT_ADMISSION_METRICS = Object.freeze({
  rejectedTotal: 'db_tenant_admission_rejected_total',
  inflight: 'db_tenant_admission_inflight',
} as const);

export interface TenantAdmissionSnapshot {
  /** Counter `db_tenant_admission_rejected_total{reason}` since start. */
  readonly rejectedTotal: Readonly<Record<AdmissionRejectReason, number>>;
  /** Gauge `db_tenant_admission_inflight{key_kind}`: permits currently held. */
  readonly inflight: Readonly<Record<AdmissionKeyKind, number>>;
  /** Arrivals currently waiting for a permit, all keys. */
  readonly queued: number;
  /** Keys with state (a permit held or a waiter queued); 0 when the process is idle. */
  readonly keys: number;
}

/** Read-only view the runtime exposes for the metrics pipeline. */
export interface TenantAdmissionMetrics {
  snapshot(): TenantAdmissionSnapshot;
}

export interface TenantAdmission extends TenantAdmissionMetrics {
  readonly maxConcurrentTx: number;
  readonly waitMs: number;
  /** Most arrivals that may wait per key (`2 × maxConcurrentTx`). */
  readonly maxQueued: number;
  /**
   * Holds a permit of `key` for exactly the extent of `fn`: acquires (or rejects with the 503 DbError without calling
   * `fn`), runs `fn`, and releases in `finally` whether `fn` resolves or rejects.
   */
  run<R>(key: AdmissionKey, fn: () => Promise<R>): Promise<R>;
}

const OPERATOR_KEY: AdmissionKey = Object.freeze({ key: 'operator', kind: 'operator' });
const ANONYMOUS_KEY: AdmissionKey = Object.freeze({ key: 'anonymous', kind: 'anonymous' });

/**
 * The admission key of a VALIDATED context (`contextValues` output, never the raw context): an operator transaction is
 * `operator`, an organisation-less one `anonymous`, any other the lowercase organisation UUID.
 */
export function admissionKeyOf(orgId: string, actorScope: string): AdmissionKey {
  if (actorScope === 'OPERATOR') return OPERATOR_KEY;
  if (orgId === '') return ANONYMOUS_KEY;
  return { key: orgId.toLowerCase(), kind: 'tenant' };
}

/** The refusal of an admission: retryable 503 SERVICE_UNAVAILABLE with `Retry-After`. */
export const tenantConcurrencyLimitError = (): DbError => new DbError(dbErrorMapping(503, 'TENANT_CONCURRENCY_LIMIT', { retryable: true }));

interface Waiter {
  readonly grant: () => void;
  readonly refuse: (error: DbError) => void;
  prev: Waiter | undefined;
  next: Waiter | undefined;
  timer: unknown;
}

interface KeyState {
  readonly kind: AdmissionKeyKind;
  inflight: number;
  queued: number;
  head: Waiter | undefined;
  tail: Waiter | undefined;
}

const GLOBAL_TIMERS: AdmissionTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function positiveInt(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new RangeError(`tenant admission: ${name} must be a positive integer`);
  }
  return value;
}

function enqueue(state: KeyState, waiter: Waiter): void {
  waiter.prev = state.tail;
  if (state.tail === undefined) state.head = waiter;
  else state.tail.next = waiter;
  state.tail = waiter;
  state.queued += 1;
}

function unlink(state: KeyState, waiter: Waiter): void {
  if (waiter.prev === undefined) state.head = waiter.next;
  else waiter.prev.next = waiter.next;
  if (waiter.next === undefined) state.tail = waiter.prev;
  else waiter.next.prev = waiter.prev;
  waiter.prev = undefined;
  waiter.next = undefined;
  state.queued -= 1;
}

export function createTenantAdmission(options: TenantAdmissionOptions, timers: AdmissionTimers = GLOBAL_TIMERS): TenantAdmission {
  const maxConcurrentTx = positiveInt('maxConcurrentTx', options.maxConcurrentTx);
  const waitMs = positiveInt('waitMs', options.waitMs);
  const maxQueued = 2 * maxConcurrentTx;
  const states = new Map<string, KeyState>();
  const rejected: Record<AdmissionRejectReason, number> = { wait: 0, depth: 0 };
  const inflight: Record<AdmissionKeyKind, number> = { tenant: 0, anonymous: 0, operator: 0 };
  let queued = 0;

  const dropIfIdle = (key: string, state: KeyState): void => {
    if (state.inflight === 0 && state.queued === 0) states.delete(key);
  };

  function acquire({ key, kind }: AdmissionKey): Promise<KeyState> {
    let state = states.get(key);
    if (state === undefined) {
      state = { kind, inflight: 0, queued: 0, head: undefined, tail: undefined };
      states.set(key, state);
    }
    // Nobody may overtake a waiter: a free permit with a non-empty queue cannot exist (release hands off directly).
    if (state.inflight < maxConcurrentTx && state.queued === 0) {
      state.inflight += 1;
      inflight[kind] += 1;
      return Promise.resolve(state);
    }
    if (state.queued >= maxQueued) {
      rejected.depth += 1;
      return Promise.reject(tenantConcurrencyLimitError());
    }
    const keyState = state;
    return new Promise<KeyState>((resolve, reject) => {
      const waiter: Waiter = {
        grant: () => resolve(keyState),
        refuse: reject,
        prev: undefined,
        next: undefined,
        timer: undefined,
      };
      enqueue(keyState, waiter);
      queued += 1;
      waiter.timer = timers.setTimeout(() => {
        unlink(keyState, waiter);
        queued -= 1;
        rejected.wait += 1;
        dropIfIdle(key, keyState);
        waiter.refuse(tenantConcurrencyLimitError());
      }, waitMs);
    });
  }

  function release(key: string, state: KeyState): void {
    const head = state.head;
    if (head !== undefined) {
      // Direct hand-off: the permit (and its inflight count) passes to the head waiter.
      unlink(state, head);
      queued -= 1;
      timers.clearTimeout(head.timer);
      head.grant();
      return;
    }
    state.inflight -= 1;
    inflight[state.kind] -= 1;
    dropIfIdle(key, state);
  }

  return Object.freeze({
    maxConcurrentTx,
    waitMs,
    maxQueued,
    async run<R>(key: AdmissionKey, fn: () => Promise<R>): Promise<R> {
      const state = await acquire(key);
      try {
        return await fn();
      } finally {
        release(key.key, state);
      }
    },
    snapshot: (): TenantAdmissionSnapshot =>
      Object.freeze({
        rejectedTotal: Object.freeze({ ...rejected }),
        inflight: Object.freeze({ ...inflight }),
        queued,
        keys: states.size,
      }),
  });
}

/** The snapshot of a process without a tenant-transaction runner (nothing admitted, nothing refused). */
export const EMPTY_ADMISSION_SNAPSHOT: TenantAdmissionSnapshot = Object.freeze({
  rejectedTotal: Object.freeze({ wait: 0, depth: 0 }),
  inflight: Object.freeze({ tenant: 0, anonymous: 0, operator: 0 }),
  queued: 0,
  keys: 0,
});
