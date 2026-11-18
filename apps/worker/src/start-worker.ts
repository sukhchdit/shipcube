// Worker process start (ADR-0003, ADR-0013, US-009, US-012, NFR-AVAIL-002; D-ORCH-073, D-TASK020-91, D-ARCH-136):
// the composition root that main.ts calls. Configuration (exit 78 on a rejected configuration or secret,
// PR3-SEC-05), the runtime services shared with the API (`@platform/api/runtime`), the named queues with their
// consumers and dead-letter queues (TASK-035), the health and metrics server on APP_HEALTH_PORT and graceful shutdown.
// The process seams are injectable so the whole sequence runs under test; main.ts passes none, so production always
// gets WORKER_PROCESS. No top-level await: main.ts stays importable.
import {
  createRuntimeLog,
  createRuntimeServices,
  createShutdown,
  exitAfterFlush,
  installProcessErrorHandlers,
  readPackageVersion,
  type FlushableStream,
  type LogSink,
  type ProcessErrorSource,
  type ReadinessProbe,
  type RuntimeLog,
  type RuntimeServices,
} from '@platform/api/runtime';
import { loadRuntimeConfigOrExit, type Config, type RuntimeConfig, type Secret } from '@platform/config';

import { createWorkerHealthServer, type MetricsSource } from './platform/health/server.js';
import { jobLogContext } from './platform/logging/job-context.js';
import { queueConnectionOptions } from './platform/queues/connection.js';
import { createWorkerQueues, type ProcessorRegistry, type WorkerQueues } from './platform/queues/runtime.js';
import { PROCESSORS } from './processors.js';

/** The signals that start graceful shutdown (each handled once). */
export const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;
export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

/** The part of the health server startWorker uses (an http.Server). */
export interface WorkerServer {
  listen(port: number, callback: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  close(callback: (error?: Error) => void): unknown;
  closeIdleConnections(): void;
  closeAllConnections(): void;
}

/** The process events startWorker subscribes to (`process`): the fatal error handlers and the shutdown signals. */
export interface WorkerProcessEvents extends ProcessErrorSource {
  once(event: ShutdownSignal, listener: () => void): unknown;
}

export interface WorkerQueuesInput {
  readonly config: Config;
  readonly log: RuntimeLog;
  readonly processors: ProcessorRegistry;
}

export interface StartWorkerDependencies {
  /** `loadRuntimeConfigOrExit`: names the rejected keys on stderr and exits 78; never resolves with a bad config. */
  readonly loadConfig: (service: 'worker') => Promise<RuntimeConfig>;
  /** The log sink, flushed before every exit (`process.stdout`). */
  readonly stdout: LogSink & FlushableStream;
  /** `process.exit`. */
  readonly exitProcess: (code: number) => never;
  /** `process`. */
  readonly processEvents: WorkerProcessEvents;
  readonly createRuntimeServices: (
    config: Config,
    service: 'worker',
    log: RuntimeLog,
    secrets: ReadonlyMap<string, Secret<string>>,
  ) => RuntimeServices;
  /** The named queues, their dead-letter queues and the consumers of the registered processors. */
  readonly createQueues: (input: WorkerQueuesInput) => WorkerQueues;
  readonly createHealthServer: (probe: ReadinessProbe, metrics: MetricsSource) => WorkerServer;
  /** The processor registry (`processors.ts`). */
  readonly processors: ProcessorRegistry;
}

/**
 * BullMQ queues over the worker's own connections (ACL user `worker`, key prefix `bull:`): the blocking profile for the
 * consumers' `Worker`s, the fail-fast profile for every `Queue` (metrics, dead-letter writes; PR64-SEC-03).
 */
export function createProductionQueues({ config, log, processors }: WorkerQueuesInput): WorkerQueues {
  const url = config.REDIS_URL.reveal();
  return createWorkerQueues({
    connection: queueConnectionOptions(url, 'worker-consumers', 'worker'),
    queueConnection: queueConnectionOptions(url, 'worker-queues', 'queue'),
    log,
    processors,
  });
}

/** The production process: what main.ts runs with. */
export const WORKER_PROCESS: StartWorkerDependencies = {
  loadConfig: loadRuntimeConfigOrExit,
  stdout: process.stdout,
  exitProcess: (code) => process.exit(code),
  processEvents: process,
  createRuntimeServices,
  createQueues: createProductionQueues,
  createHealthServer: createWorkerHealthServer,
  processors: PROCESSORS,
};

/**
 * Starts the worker process. Resolves once the health server is opening, the consumers take jobs and the shutdown
 * signals are registered. Rejects with an unexpected error only (a fault of the configuration loader before the
 * process error handlers exist, or a composition error after them); main.ts re-raises it as an uncaught exception
 * (raiseStartupError), as the former top-level-await entry point did.
 */
export async function startWorker(overrides: Partial<StartWorkerDependencies> = {}): Promise<void> {
  const deps: StartWorkerDependencies = { ...WORKER_PROCESS, ...overrides };
  const { config, secrets } = await deps.loadConfig('worker');
  // Redacted Pino logger (TASK-010); lines written while a job runs carry its correlation context (job-context.ts).
  const log = createRuntimeLog('worker', deps.stdout, {
    version: readPackageVersion(new URL('../package.json', import.meta.url)),
    level: config.APP_LOG_LEVEL,
    context: jobLogContext,
  });
  // Every exit after a log line lets the line reach stdout first (R2-n7, R3-n1).
  const exit = exitAfterFlush({ stream: deps.stdout, exit: deps.exitProcess });
  // Uncaught exceptions and unhandled rejections: one redacted fatal line, flushed, then the exit code that
  // installProcessErrorHandlers chooses for the error: 1, or 78 for a runtime configuration error (PR20-SEC-06).
  installProcessErrorHandlers({ log, exit, source: deps.processEvents });
  // A StorageConfigError thrown here reaches the handlers above as one redacted fatal line (PR30-SEC-11).
  const services = deps.createRuntimeServices(config, 'worker', log, secrets);
  // Built stopped: no consumer takes a job before the start-up checks below.
  const queues = deps.createQueues({ config, log, processors: deps.processors });
  const server = deps.createHealthServer(services.probe, () => queues.metrics());

  // Session-integrity check on a dedicated connection before the health server opens and before any consumer takes
  // a job (PR-0009 M1, D-ARCH-104); never rejects.
  await services.startup();
  queues.start();

  server.listen(config.APP_HEALTH_PORT, () => log.info('worker.health_listening', { port: config.APP_HEALTH_PORT }));
  server.on('error', (error: Error) => {
    log.error('worker.listen_failed', { error: error.name });
    exit(1);
  });

  const shutdown = createShutdown({
    probe: services.probe,
    // Active jobs first (the consumers stop taking jobs and wait for the running ones, ADR-0013 §7), then the health
    // listener (also when a consumer fails to close); both inside the drain bound of the 30 s stop window.
    drain: async () => {
      try {
        await queues.drain();
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
          server.closeIdleConnections();
        });
      }
    },
    forceClose: () => server.closeAllConnections(),
    resources: [{ name: 'queues', close: () => queues.close() }, ...services.resources],
    log,
    exit,
  });
  for (const signal of SHUTDOWN_SIGNALS) deps.processEvents.once(signal, () => void shutdown(signal));
}

/**
 * main.ts's rejection policy: a startWorker rejection is re-raised as an uncaught exception, as the rejection of the
 * former top-level-await entry point was. The process error handlers startWorker installed report it as one redacted
 * line and exit with the code they choose (PR20-SEC-06). `schedule` is a test seam (default queueMicrotask).
 */
export function raiseStartupError(error: unknown, schedule: (task: () => void) => void = queueMicrotask): void {
  schedule(() => {
    throw error;
  });
}
