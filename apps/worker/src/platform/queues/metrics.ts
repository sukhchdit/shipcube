/**
 * Queue metrics (ADR-0013 §8; REQ-PLAT-013, REQ-PLAT-018, NFR-RES-004; AT-US-009-05; TASK-035): per named queue the
 * job counts by state and the dead-letter depth, in the Prometheus text exposition format served on the worker's
 * `/metrics`. In-house rendering (two gauges, fixed label sets), no client library.
 */
import type { QueueName } from '@platform/shared/queues';

/** The job states reported per queue; depth = waiting + delayed + prioritized. */
export const QUEUE_STATES = ['waiting', 'active', 'delayed', 'prioritized', 'completed', 'failed'] as const;
export type QueueState = (typeof QUEUE_STATES)[number];

/** The part of a BullMQ `Queue` the metrics read. */
export interface CountableQueue {
  getJobCounts(...types: string[]): Promise<Record<string, number>>;
}

export interface QueueMetricsSource {
  readonly queue: QueueName;
  readonly jobs: CountableQueue;
  readonly deadLetter: CountableQueue;
}

export interface QueueMetrics {
  readonly queue: QueueName;
  readonly counts: Readonly<Record<QueueState, number>>;
  /** Records in the queue's dead-letter queue (they are never processed, so every state counts). */
  readonly deadLetter: number;
}

const count = (counts: Record<string, number>, state: string): number => {
  const value = counts[state];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
};

export async function collectQueueMetrics(sources: readonly QueueMetricsSource[]): Promise<QueueMetrics[]> {
  return Promise.all(
    sources.map(async ({ queue, jobs, deadLetter }) => {
      const [counts, dead] = await Promise.all([jobs.getJobCounts(...QUEUE_STATES), deadLetter.getJobCounts(...QUEUE_STATES)]);
      return {
        queue,
        counts: Object.fromEntries(QUEUE_STATES.map((state) => [state, count(counts, state)])) as Record<QueueState, number>,
        deadLetter: QUEUE_STATES.reduce((total, state) => total + count(dead, state), 0),
      };
    }),
  );
}

/** Prometheus text format 0.0.4. Queue names match the kebab pattern, so label values need no escaping. */
export function renderQueueMetrics(metrics: readonly QueueMetrics[]): string {
  const lines = ['# HELP platform_queue_jobs Jobs per named queue and state.', '# TYPE platform_queue_jobs gauge'];
  for (const { queue, counts } of metrics)
    for (const state of QUEUE_STATES) lines.push(`platform_queue_jobs{queue="${queue}",state="${state}"} ${String(counts[state])}`);
  lines.push('# HELP platform_queue_dead_letter_jobs Records in the dead-letter queue of a named queue.');
  lines.push('# TYPE platform_queue_dead_letter_jobs gauge');
  for (const { queue, deadLetter } of metrics) lines.push(`platform_queue_dead_letter_jobs{queue="${queue}"} ${String(deadLetter)}`);
  return `${lines.join('\n')}\n`;
}
