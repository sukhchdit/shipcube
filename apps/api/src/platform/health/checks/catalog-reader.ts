/**
 * The read-only query surface the audit readiness checks need: the runtime `pg` pool satisfies it (platform/db/runtime.ts
 * passes it in; this folder never imports the driver). Every statement is a fixed text without parameters, run as
 * `platform_app`, bounded by the pool's `statement_timeout` / `query_timeout` and the readiness deadline.
 */
export interface CatalogReader {
  query(text: string): Promise<{ readonly rows: readonly unknown[] }>;
}

/** Cache of the last evaluation, so the catalogue is read on the slow interval, not on every readiness poll. */
export interface IntervalCache<T> {
  get(load: () => Promise<T>): Promise<T>;
}

/**
 * Reuses a successful load for `intervalMs` (a rejected load is not cached: the next readiness poll retries it).
 * Concurrent callers share one in-flight load.
 */
export function intervalCache<T>(intervalMs: number, now: () => number): IntervalCache<T> {
  let last: { readonly value: T; readonly at: number } | undefined;
  let inflight: Promise<T> | undefined;
  return {
    get(load) {
      if (last !== undefined && now() - last.at < intervalMs) return Promise.resolve(last.value);
      inflight ??= load()
        .then((value) => {
          last = { value, at: now() };
          return value;
        })
        .finally(() => {
          inflight = undefined;
        });
      return inflight;
    },
  };
}

/** Slow readiness interval of the audit checks (data-model §5.3 amendment item 3): once a minute per process. */
export const AUDIT_READINESS_INTERVAL_MS = 60_000;
