/**
 * The worker's queues (ADR-0013 §1, §5, §7, §8 and amendment 3; REQ-PLAT-013, REQ-PLAT-015; TASK-035, TASK-039): one
 * BullMQ `Queue` and dead-letter queue per named queue (for the metrics, the dead-letter records, the retention sweep
 * and the Job Schedulers; nothing else constructs a `Queue`, PR64-SEC-13), and one consumer per queue that has a
 * registered processor. With `schedules` on, the runtime also owns the scheduled jobs: the housekeeping consumer that
 * runs them (the `queue-retention` sweep is `sweepRetention()` of this runtime) and their Job Schedulers, upserted at
 * `start()` and retried until registered. Consumers are built stopped; `start()` is called after the start-up checks
 * (D-ARCH-104), and `close()` stops taking jobs and waits for the active ones (the shutdown drain, ADR-0013 §7), then
 * closes every connection.
 */
import { deadLetterQueueName, QUEUE_NAMES, QUEUES, type QueueName, type ScheduleName } from '@platform/shared/queues';
import type { ConnectionOptions } from 'bullmq';

import type { RuntimeLog } from '@platform/api/runtime';

import { createScheduleProcessor, registerSchedules } from '../jobs/schedulers.js';
import { type ConsumerTuning, createQueueConsumer, type JobProcessor, type QueueConsumer } from './consumer.js';
import { errorClass } from './job-handler.js';
import { collectQueueMetrics, createDeadLetteredCounter, renderQueueMetrics } from './metrics.js';
import { openQueue } from './open-queue.js';
import { PRODUCTION_RETENTION, type RetentionBounds, type SweepResult, sweepRetention } from './retention.js';

export type ProcessorRegistry = Readonly<Partial<Record<QueueName, JobProcessor>>>;

/** Delay between two attempts to register the Job Schedulers while Valkey refuses them. */
export const SCHEDULE_REGISTRATION_RETRY_MS = 30_000;

export interface ScheduleOptions {
  /** Interval overrides per schedule (test seam; production uses SCHEDULE_EVERY_MS). */
  readonly every?: Partial<Readonly<Record<ScheduleName, number>>>;
}

export interface WorkerQueuesOptions {
  /** The `worker` connection profile (blocking commands): for the consumers' BullMQ `Worker`s only. */
  readonly connection: ConnectionOptions;
  /** The fail-fast `queue` connection profile (command timeout, bounded retries): for every non-blocking `Queue`. */
  readonly queueConnection: ConnectionOptions;
  readonly log: RuntimeLog;
  readonly processors: ProcessorRegistry;
  /** Run the scheduled jobs (housekeeping consumer and Job Schedulers); off when absent. */
  readonly schedules?: ScheduleOptions;
  /** Retention bounds of every consumer and of the sweep; default the ADR-0013 am. 3 constants. */
  readonly retention?: RetentionBounds;
  readonly prefix?: string;
  /** Test seams. */
  readonly retryBaseMs?: number;
  readonly tuning?: ConsumerTuning;
  readonly deadlineMs?: number;
  readonly sweepBatch?: number;
  readonly registrationRetryMs?: number;
}

export interface WorkerQueues {
  /** The queues with a consumer, sorted. */
  readonly consuming: readonly QueueName[];
  /** Starts every consumer (after the start-up checks) and, with schedules on, registers the Job Schedulers. */
  start(): void;
  /** Upserts every Job Scheduler (idempotent); `start()` calls it and retries on failure. */
  registerSchedules(): Promise<readonly ScheduleName[]>;
  /** One run of the `queue-retention` sweep over every named queue (ADR-0013 am. 3 item 10). */
  sweepRetention(): Promise<SweepResult>;
  /** Prometheus text of every named queue; single-flight (PR64-SEC-12). */
  metrics(): Promise<string>;
  /** Stops the consumers (waiting for active jobs), then closes the queues' connections. */
  drain(): Promise<void>;
  close(): Promise<void>;
}

export function createWorkerQueues(options: WorkerQueuesOptions): WorkerQueues {
  const { log } = options;
  const prefix = options.prefix === undefined ? {} : { prefix: options.prefix };
  const retention = options.retention ?? PRODUCTION_RETENTION;
  // Refused before any connection is opened (D-SECPR039-01 condition (iii)).
  if (options.schedules !== undefined) {
    for (const name of QUEUE_NAMES) {
      if ((QUEUES[name].schedules ?? []).length > 0 && options.processors[name] !== undefined)
        throw new Error(`queue ${name} runs scheduled jobs; it takes no registered processor`);
    }
  }
  const queues = QUEUE_NAMES.map((name) => ({
    queue: name,
    jobs: openQueue(name, { connection: options.queueConnection, ...prefix }, log),
    deadLetter: openQueue(deadLetterQueueName(name), { connection: options.queueConnection, ...prefix }, log),
  }));
  const queueOf = (name: QueueName) => {
    const found = queues.find((entry) => entry.queue === name);
    if (found === undefined) throw new Error(`unknown queue ${name}`);
    return found.jobs;
  };
  const deadLettered = createDeadLetteredCounter(QUEUE_NAMES);

  const sweep = (signal?: AbortSignal): Promise<SweepResult> =>
    sweepRetention({
      sources: queues,
      bounds: retention,
      log,
      ...(signal === undefined ? {} : { signal }),
      ...(options.sweepBatch === undefined ? {} : { batch: options.sweepBatch }),
    });

  const processors: Partial<Record<QueueName, JobProcessor>> = { ...options.processors };
  if (options.schedules !== undefined) {
    for (const name of QUEUE_NAMES) {
      if ((QUEUES[name].schedules ?? []).length === 0) continue;
      processors[name] = createScheduleProcessor({
        'queue-retention': async (job) => {
          await sweep(job.signal);
        },
      });
    }
  }

  const consumers: QueueConsumer[] = queues.flatMap(({ queue, deadLetter }) => {
    const processor = processors[queue];
    if (processor === undefined) return [];
    return [
      createQueueConsumer({
        queue,
        processor,
        connection: options.connection,
        queueConnection: options.queueConnection,
        log,
        deadLetter,
        retention,
        onDeadLettered: (name) => deadLettered.inc(name),
        ...prefix,
        ...(options.retryBaseMs === undefined ? {} : { retryBaseMs: options.retryBaseMs }),
        ...(options.tuning === undefined ? {} : { tuning: options.tuning }),
        ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
      }),
    ];
  });

  const register = (): Promise<readonly ScheduleName[]> => registerSchedules(queueOf, options.schedules?.every ?? {});
  let closed = false;
  let retryTimer: NodeJS.Timeout | undefined;
  const registerUntilDone = (): void => {
    register().then(
      (names) => log.info('worker.schedules_registered', { schedules: names.join(',') }),
      (error: unknown) => {
        log.error('worker.schedules_register_failed', { error: errorClass(error) });
        if (closed) return;
        retryTimer = setTimeout(registerUntilDone, options.registrationRetryMs ?? SCHEDULE_REGISTRATION_RETRY_MS);
        retryTimer.unref();
      },
    );
  };

  let inflight: Promise<string> | undefined;
  let drained: Promise<void> | undefined;
  const drain = (): Promise<void> => {
    closed = true;
    clearTimeout(retryTimer);
    return (drained ??= Promise.all(consumers.map((consumer) => consumer.close())).then(() => undefined));
  };
  return {
    consuming: consumers.map((consumer) => consumer.queue),
    start() {
      for (const consumer of consumers) consumer.start();
      log.info('worker.queues_started', { queues: consumers.map((consumer) => consumer.queue).join(',') });
      if (options.schedules !== undefined) registerUntilDone();
    },
    registerSchedules: register,
    sweepRetention: () => sweep(),
    metrics() {
      // Single-flight (PR64-SEC-12): a scrape while a collection is pending joins it, so collections that wait for a
      // connection that never became ready do not pile up.
      inflight ??= collectQueueMetrics(queues)
        .then((metrics) => renderQueueMetrics(metrics, deadLettered))
        .finally(() => {
          inflight = undefined;
        });
      return inflight;
    },
    drain,
    async close() {
      await drain();
      await Promise.all(queues.flatMap(({ jobs, deadLetter }) => [jobs.close(), deadLetter.close()]));
    },
  };
}
