/**
 * Outbox relay metrics (ADR-0004 item 3 and amendment 2 item 11; REQ-PLAT-017, REQ-PLAT-018; AT-US-011-06; TASK-043;
 * D-ARCH-183), in the Prometheus text exposition format served on the worker's `/metrics` beside the queue gauges.
 * In-house rendering with fixed names and no labels, as platform/queues/metrics.ts, until the metrics pipeline
 * (TASK-214, which also owns the OutboxRelayLag and OutboxRelayStalled alarms).
 *
 * - `platform_outbox_relay_latency_seconds` (histogram): from the event's insert (`created_at`, set by the writer to
 *   `clock_timestamp()`) to the moment BullMQ accepted its job. The age is read from the database clock at claim time
 *   plus the worker's monotonic time since, so clock skew between the hosts does not enter it.
 * - `platform_outbox_relay_published_total` / `platform_outbox_relay_failed_total` (counters): rows marked published,
 *   and enqueue attempts that failed (the row stays pending).
 * - `platform_outbox_relay_oldest_pending_age_seconds` (gauge, "relay lag"): the age of the first row of the claim in
 *   the last tick that held the lock, set right after the claim and before the first enqueue (D-ARCH-188), so a tick
 *   that then hangs or throws inside an enqueue still shows its lag; 0 when that tick claimed nothing and 0 after a
 *   tick without the lock. Read as the maximum over the workers.
 * - `platform_outbox_relay_last_tick_timestamp_seconds` (gauge): the wall-clock time of the last tick that held the
 *   relay lock and ended without an error; 0 until the first one (PR043-SEC-04: a tick without the lock does not count,
 *   so a foreign holder of the key stops it on every worker). A dead loop, an unreachable database or a foreign holder shows
 *   as a value that stops.
 */

/** Histogram bucket bounds in seconds (the 500 ms poll and the NFR-PERF-004 2 s queue-wait budget sit inside). */
export const RELAY_LATENCY_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60] as const;

export interface RelayMetrics {
  /** Records one accepted enqueue `seconds` after its event was written. */
  observeLatency(seconds: number): void;
  published(count: number): void;
  failed(count: number): void;
  /** The lag gauge: set right after the claim (age of its first row; 0 for none) and to 0 after a tick without the lock. */
  pendingAge(seconds: number): void;
  /** The last-tick gauge: the wall-clock end (seconds) of a tick that held the lock and ended without an error. */
  tickEnded(endedAtSeconds: number): void;
  render(): string;
}

const finite = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

export function createRelayMetrics(): RelayMetrics {
  const buckets = RELAY_LATENCY_BUCKETS.map(() => 0);
  let count = 0;
  let sum = 0;
  let published = 0;
  let failed = 0;
  let oldestPendingAge = 0;
  let lastTick = 0;
  return {
    observeLatency(seconds) {
      const value = finite(seconds);
      count += 1;
      sum += value;
      RELAY_LATENCY_BUCKETS.forEach((bound, index) => {
        if (value <= bound) buckets[index] = (buckets[index] ?? 0) + 1;
      });
    },
    published(n) {
      published += finite(n);
    },
    failed(n) {
      failed += finite(n);
    },
    pendingAge(seconds) {
      oldestPendingAge = finite(seconds);
    },
    tickEnded(endedAtSeconds) {
      lastTick = finite(endedAtSeconds);
    },
    render() {
      const lines = [
        '# HELP platform_outbox_relay_latency_seconds Seconds from an outbox event insert to its accepted enqueue.',
        '# TYPE platform_outbox_relay_latency_seconds histogram',
        ...RELAY_LATENCY_BUCKETS.map(
          (bound, index) => `platform_outbox_relay_latency_seconds_bucket{le="${String(bound)}"} ${String(buckets[index] ?? 0)}`,
        ),
        `platform_outbox_relay_latency_seconds_bucket{le="+Inf"} ${String(count)}`,
        `platform_outbox_relay_latency_seconds_sum ${String(sum)}`,
        `platform_outbox_relay_latency_seconds_count ${String(count)}`,
        '# HELP platform_outbox_relay_published_total Outbox events marked published after BullMQ accepted their job.',
        '# TYPE platform_outbox_relay_published_total counter',
        `platform_outbox_relay_published_total ${String(published)}`,
        '# HELP platform_outbox_relay_failed_total Outbox enqueue attempts that failed; the event stays pending.',
        '# TYPE platform_outbox_relay_failed_total counter',
        `platform_outbox_relay_failed_total ${String(failed)}`,
        '# HELP platform_outbox_relay_oldest_pending_age_seconds Age of the oldest claimed pending event in the last locked tick.',
        '# TYPE platform_outbox_relay_oldest_pending_age_seconds gauge',
        `platform_outbox_relay_oldest_pending_age_seconds ${String(oldestPendingAge)}`,
        '# HELP platform_outbox_relay_last_tick_timestamp_seconds Wall-clock time of the last tick that held the relay lock and ended without an error.',
        '# TYPE platform_outbox_relay_last_tick_timestamp_seconds gauge',
        `platform_outbox_relay_last_tick_timestamp_seconds ${String(lastTick)}`,
      ];
      return `${lines.join('\n')}\n`;
    },
  };
}
