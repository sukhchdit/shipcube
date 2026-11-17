/**
 * The worker's queues (ADR-0013 §1, §7, §8; REQ-PLAT-013; TASK-035): one BullMQ `Queue` and dead-letter queue per
 * named queue (for the metrics and the dead-letter records), and one consumer per queue that has a registered
 * processor. Consumers are built stopped; `start()` is called after the start-up checks (D-ARCH-104), and `close()`
 * stops taking jobs and waits for the active ones (the shutdown drain, ADR-0013 §7), then closes every connection.
 */
import { deadLetterQueueName, QUEUE_NAMES, type QueueName } from '@platform/shared/queues';
import { type ConnectionOptions, Queue } from 'bullmq';

import type { RuntimeLog } from '@platform/api/runtime';

import { type ConsumerTuning, createQueueConsumer, type JobProcessor, type QueueConsumer } from './consumer.js';
import { collectQueueMetrics, renderQueueMetrics } from './metrics.js';

export type ProcessorRegistry = Readonly<Partial<Record<QueueName, JobProcessor>>>;

export interface WorkerQueuesOptions {
  readonly connection: ConnectionOptions;
  readonly log: RuntimeLog;
  readonly processors: ProcessorRegistry;
  readonly prefix?: string;
  /** Test seams. */
  readonly retryBaseMs?: number;
  readonly tuning?: ConsumerTuning;
}

export interface WorkerQueues {
  /** The queues with a consumer, sorted. */
  readonly consuming: readonly QueueName[];
  /** Starts every consumer (after the start-up checks). */
  start(): void;
  /** Prometheus text of every named queue. */
  metrics(): Promise<string>;
  /** Stops the consumers (waiting for active jobs), then closes the queues' connections. */
  drain(): Promise<void>;
  close(): Promise<void>;
}

export function createWorkerQueues(options: WorkerQueuesOptions): WorkerQueues {
  const prefix = options.prefix === undefined ? {} : { prefix: options.prefix };
  const queues = QUEUE_NAMES.map((name) => ({
    queue: name,
    jobs: new Queue(name, { connection: options.connection, ...prefix }),
    deadLetter: new Queue(deadLetterQueueName(name), { connection: options.connection, ...prefix }),
  }));
  const consumers: QueueConsumer[] = queues.flatMap(({ queue, deadLetter }) => {
    const processor = options.processors[queue];
    if (processor === undefined) return [];
    return [
      createQueueConsumer({
        queue,
        processor,
        connection: options.connection,
        log: options.log,
        deadLetter,
        ...prefix,
        ...(options.retryBaseMs === undefined ? {} : { retryBaseMs: options.retryBaseMs }),
        ...(options.tuning === undefined ? {} : { tuning: options.tuning }),
      }),
    ];
  });
  let drained: Promise<void> | undefined;
  const drain = (): Promise<void> => (drained ??= Promise.all(consumers.map((consumer) => consumer.close())).then(() => undefined));
  return {
    consuming: consumers.map((consumer) => consumer.queue),
    start() {
      for (const consumer of consumers) consumer.start();
      options.log.info('worker.queues_started', { queues: consumers.map((consumer) => consumer.queue).join(',') });
    },
    async metrics() {
      return renderQueueMetrics(await collectQueueMetrics(queues));
    },
    drain,
    async close() {
      await drain();
      await Promise.all(queues.flatMap(({ jobs, deadLetter }) => [jobs.close(), deadLetter.close()]));
    },
  };
}
