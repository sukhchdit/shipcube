/**
 * Outbox relay metrics (ADR-0004 item 3 "relay latency commit → enqueue is a histogram metric"; REQ-PLAT-017,
 * REQ-PLAT-018; AT-US-011-06; TASK-043), in the Prometheus text exposition format served on the worker's `/metrics`
 * beside the queue gauges. In-house rendering with fixed names and no labels, as platform/queues/metrics.ts, until the
 * metrics pipeline (TASK-214).
 *
 * - `platform_outbox_relay_latency_seconds` (histogram): from the event row's `created_at` (its transaction's start,
 *   the earliest commit time) to the moment BullMQ accepted its job. The age is read from the database clock at claim
 *   time plus the worker's monotonic time since, so clock skew between the hosts does not enter it.
 * - `platform_outbox_relay_published_total` / `platform_outbox_relay_failed_total` (counters): rows marked published,
 *   and enqueue attempts that failed (the row stays pending).
 */

/** Histogram bucket bounds in seconds (the 500 ms poll and the NFR-PERF-004 2 s queue-wait budget sit inside). */
export const RELAY_LATENCY_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60] as const;

export interface RelayMetrics {
  /** Records one accepted enqueue `seconds` after its event was written. */
  observeLatency(seconds: number): void;
  published(count: number): void;
  failed(count: number): void;
  render(): string;
}

const finite = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

export function createRelayMetrics(): RelayMetrics {
  const buckets = RELAY_LATENCY_BUCKETS.map(() => 0);
  let count = 0;
  let sum = 0;
  let published = 0;
  let failed = 0;
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
    render() {
      const lines = [
        '# HELP platform_outbox_relay_latency_seconds Seconds from an outbox event write to its accepted enqueue.',
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
      ];
      return `${lines.join('\n')}\n`;
    },
  };
}
