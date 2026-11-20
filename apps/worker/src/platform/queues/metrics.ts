/**
 * Queue metrics (ADR-0013 §8 and amendment 3 item 12; REQ-PLAT-013, REQ-PLAT-018, NFR-RES-004; AT-US-009-05; TASK-035,
 * TASK-039): per named queue the job counts by state, the dead-letter depth and the dead-lettered counter, in the
 * Prometheus text exposition format served on the worker's `/metrics`. In-house rendering (fixed label sets), no
 * client library until TASK-214 (ADR-0017 am. 1); the names and label sets are the contract.
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

/**
 * `platform_queue_dead_lettered_total{queue}` (D-ARCH-160): +1 for each final failure of a job, where the consumer
 * writes the dead-letter record or fails to write it. Every queue's series exists at 0 from worker start, because a
 * series that first appears at 1 shows no `increase()` to the QueueDeadLetterNew alarm (TASK-214). Process-local, as a
 * Prometheus counter is: a restart resets it, which `increase()` handles.
 */
export interface DeadLetteredCounter {
  inc(queue: QueueName): void;
  /** The value of every queue's series, in the order the counter was built with. */
  values(): readonly (readonly [QueueName, number])[];
}

export function createDeadLetteredCounter(queues: readonly QueueName[]): DeadLetteredCounter {
  const counts = new Map<QueueName, number>(queues.map((queue) => [queue, 0]));
  return {
    inc(queue) {
      const current = counts.get(queue);
      if (current !== undefined) counts.set(queue, current + 1);
    },
    values: () => [...counts.entries()],
  };
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
export function renderQueueMetrics(metrics: readonly QueueMetrics[], deadLettered?: DeadLetteredCounter): string {
  const lines = ['# HELP platform_queue_jobs Jobs per named queue and state.', '# TYPE platform_queue_jobs gauge'];
  for (const { queue, counts } of metrics)
    for (const state of QUEUE_STATES) lines.push(`platform_queue_jobs{queue="${queue}",state="${state}"} ${String(counts[state])}`);
  lines.push('# HELP platform_queue_dead_letter_jobs Records in the dead-letter queue of a named queue.');
  lines.push('# TYPE platform_queue_dead_letter_jobs gauge');
  for (const { queue, deadLetter } of metrics) lines.push(`platform_queue_dead_letter_jobs{queue="${queue}"} ${String(deadLetter)}`);
  if (deadLettered !== undefined) {
    lines.push('# HELP platform_queue_dead_lettered_total Final job failures per named queue (dead-letter record written or attempted).');
    lines.push('# TYPE platform_queue_dead_lettered_total counter');
    for (const [queue, value] of deadLettered.values()) lines.push(`platform_queue_dead_lettered_total{queue="${queue}"} ${String(value)}`);
  }
  return `${lines.join('\n')}\n`;
}
