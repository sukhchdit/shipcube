/**
 * The worker start-up and shutdown sequence (D-ORCH-073, D-TASK020-91, D-ARCH-136; ADR-0003, ADR-0013 §7, US-009,
 * US-012, NFR-AVAIL-002), run with fakes for the process seams: configuration, stdout, process.exit, the process
 * events, the runtime services, the queues and the health server. The real logger, flush-before-exit, process error
 * handlers and shutdown sequence run.
 */
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';

import { createRuntimeServices, type ReadinessProbe, type RuntimeServices } from '@platform/api/runtime';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { CONFIG_EXIT_CODE, loadRuntimeConfigOrExit, type Config, type Secret } from '@platform/config';

import { createWorkerHealthServer, type MetricsSource } from './platform/health/server.js';
import type { WorkerQueues } from './platform/queues/runtime.js';
import { PROCESSORS } from './processors.js';
import { COMPLETED_RETENTION, DEAD_LETTER_RETENTION, FAILED_RETENTION } from '@platform/shared/queues';
import {
  createProductionQueues,
  productionQueuesOptions,
  raiseStartupError,
  SHUTDOWN_SIGNALS,
  startWorker,
  WORKER_PROCESS,
  type StartWorkerDependencies,
  type WorkerQueuesInput,
  type WorkerServer,
} from './start-worker.js';

type LogLine = Readonly<Record<string, unknown>>;

/** The http.Server seam: records calls; the test decides when (and how) `close` calls back. */
class FakeServer extends EventEmitter implements WorkerServer {
  readonly calls: string[];
  closeCallback: ((error?: Error) => void) | undefined;
  listenCallback: (() => void) | undefined;

  constructor(calls: string[]) {
    super();
    this.calls = calls;
  }

  listen(port: number, callback: () => void): this {
    this.calls.push(`listen ${String(port)}`);
    this.listenCallback = callback;
    return this;
  }

  close(callback: (error?: Error) => void): this {
    this.calls.push('server.close');
    this.closeCallback = callback;
    return this;
  }

  closeIdleConnections(): void {
    this.calls.push('server.closeIdleConnections');
  }

  closeAllConnections(): void {
    this.calls.push('server.closeAllConnections');
  }
}

interface Harness {
  readonly deps: Partial<StartWorkerDependencies>;
  readonly calls: string[];
  readonly exits: number[];
  readonly events: EventEmitter;
  readonly server: FakeServer;
  readonly config: Config;
  readonly secrets: ReadonlyMap<string, Secret<string>>;
  /** What startWorker passed to createQueues and createHealthServer. */
  queuesInput(): WorkerQueuesInput;
  metricsSource(): MetricsSource;
  /** Resolves the pending queue drain (active jobs finished), or rejects it. */
  finishDrain(error?: Error): void;
  lines(): LogLine[];
  holdFlush(): () => void;
}

const WORKER_PACKAGE_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string })
  .version;

function harness(): Harness {
  const calls: string[] = [];
  const exits: number[] = [];
  const raw: string[] = [];
  const events = new EventEmitter();
  const server = new FakeServer(calls);
  const config = { APP_LOG_LEVEL: 'info', APP_HEALTH_PORT: 9464, APP_ENV: 'local' } as unknown as Config;
  const secrets: ReadonlyMap<string, Secret<string>> = new Map();
  const probe = { startDraining: () => calls.push('probe.startDraining') } as unknown as ReadinessProbe;
  const services = {
    probe,
    resources: [
      {
        name: 'pool',
        close: () => {
          calls.push('pool.close');
          return Promise.resolve();
        },
      },
    ],
    startup: () => {
      calls.push('services.startup');
      return Promise.resolve();
    },
  } as unknown as RuntimeServices;
  let queuesInput: WorkerQueuesInput | undefined;
  let metricsSource: MetricsSource | undefined;
  let drainSettle: ((error?: Error) => void) | undefined;
  let heldFlushes: ((error?: Error | null) => void)[] | undefined;
  const queues: WorkerQueues = {
    consuming: [],
    start: () => calls.push('queues.start'),
    registerSchedules: () => Promise.resolve([]),
    sweepRetention: () => Promise.resolve({ failed: 0, completed: 0, deadLetterAged: 0, deadLetterTrimmed: 0, failedQueues: [] }),
    metrics: () => {
      calls.push('queues.metrics');
      return Promise.resolve('platform_queue_jobs 0\n');
    },
    drain: () => {
      calls.push('queues.drain');
      return new Promise<void>((resolve, reject) => {
        drainSettle = (error) => (error === undefined ? resolve() : reject(error));
      });
    },
    close: () => {
      calls.push('queues.close');
      return Promise.resolve();
    },
  };
  const deps: Partial<StartWorkerDependencies> = {
    loadConfig: (service) => {
      calls.push(`loadConfig ${service}`);
      return Promise.resolve({ config, secrets });
    },
    stdout: {
      write: (chunk: string, callback?: (error?: Error | null) => void) => {
        if (chunk !== '') raw.push(chunk);
        if (heldFlushes === undefined || callback === undefined) callback?.();
        else heldFlushes.push(callback);
        return true;
      },
    },
    exitProcess: (code: number): never => {
      calls.push(`exit ${String(code)}`);
      exits.push(code);
      return undefined as never;
    },
    processEvents: events,
    createRuntimeServices: (_config, service) => {
      calls.push(`createRuntimeServices ${service}`);
      return services;
    },
    createQueues: (input) => {
      calls.push('createQueues');
      queuesInput = input;
      return queues;
    },
    createHealthServer: (healthProbe, metrics) => {
      calls.push('createHealthServer');
      expect(healthProbe).toBe(probe);
      metricsSource = metrics;
      return server;
    },
    processors: {},
  };
  return {
    deps,
    calls,
    exits,
    events,
    server,
    config,
    secrets,
    queuesInput: () => {
      if (queuesInput === undefined) throw new Error('createQueues was not called');
      return queuesInput;
    },
    metricsSource: () => {
      if (metricsSource === undefined) throw new Error('createHealthServer was not called');
      return metricsSource;
    },
    finishDrain: (error) => drainSettle?.(error),
    lines: () => raw.flatMap((chunk) => chunk.split('\n').filter((line) => line !== '')).map((line) => JSON.parse(line) as LogLine),
    holdFlush: () => {
      const held: ((error?: Error | null) => void)[] = [];
      heldFlushes = held;
      return () => {
        heldFlushes = undefined;
        for (const callback of held.splice(0)) callback();
      };
    },
  };
}

const eventsOf = (h: Harness): unknown[] => h.lines().map((line) => line['event']);

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

describe('[D-ARCH-136] startWorker: boot order (D-ARCH-104, PR11-SEC-09)', () => {
  it('loads the config, composes the services once, builds the queues stopped, awaits startup, starts the consumers, then listens', async () => {
    const h = harness();
    await startWorker(h.deps);
    expect(h.calls).toEqual([
      'loadConfig worker',
      'createRuntimeServices worker',
      'createQueues',
      'createHealthServer',
      'services.startup',
      'queues.start',
      'listen 9464',
    ]);
    expect(h.queuesInput()).toEqual({ config: h.config, log: expect.any(Object), processors: h.deps.processors });
    expect(eventsOf(h)).toEqual([]);
    h.server.listenCallback?.();
    expect(h.lines()).toEqual([
      expect.objectContaining({ event: 'worker.health_listening', port: 9464, service: 'worker', version: WORKER_PACKAGE_VERSION }),
    ]);
  });

  it('[AT-US-009-05] the health server serves the queues gauges', async () => {
    const h = harness();
    await startWorker(h.deps);
    await expect(h.metricsSource()()).resolves.toBe('platform_queue_jobs 0\n');
    expect(h.calls).toContain('queues.metrics');
  });

  it('the process error handlers are installed before the services are composed; a fatal error exits 1 after one line', async () => {
    const h = harness();
    const compose = h.deps.createRuntimeServices as StartWorkerDependencies['createRuntimeServices'];
    let handlersAtComposition = -1;
    await startWorker({
      ...h.deps,
      createRuntimeServices: (config, service, log, secrets) => {
        handlersAtComposition = h.events.listenerCount('uncaughtException') + h.events.listenerCount('unhandledRejection');
        expect([config, secrets]).toEqual([h.config, h.secrets]);
        return compose(config, service, log, secrets);
      },
    });
    expect(handlersAtComposition).toBe(2);
    h.events.emit('uncaughtException', new TypeError('boom'), 'uncaughtException');
    expect(h.lines()).toEqual([expect.objectContaining({ level: 'fatal', event: 'process.uncaught_exception' })]);
    expect(h.exits).toEqual([1]);
  });

  it('a listen failure logs worker.listen_failed and exits 1 after the flush', async () => {
    const h = harness();
    await startWorker(h.deps);
    const flush = h.holdFlush();
    h.server.emit('error', new RangeError('port in use'));
    expect(h.lines()).toEqual([expect.objectContaining({ level: 'error', event: 'worker.listen_failed', error: 'RangeError' })]);
    expect(h.exits).toEqual([]);
    flush();
    expect(h.exits).toEqual([1]);
  });

  it('a composition error rejects startWorker (main.ts re-raises it) before startup, consumers or listen', async () => {
    const h = harness();
    const failure = new TypeError('queues refused');
    await expect(
      startWorker({
        ...h.deps,
        createQueues: () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(h.calls).toEqual(['loadConfig worker', 'createRuntimeServices worker']);
    expect(SHUTDOWN_SIGNALS.map((signal) => h.events.listenerCount(signal))).toEqual([0, 0]);
  });

  it('raiseStartupError re-raises the rejection as an uncaught exception on a later task', () => {
    const failure = new Error('composition');
    const tasks: (() => void)[] = [];
    raiseStartupError(failure, (task) => tasks.push(task));
    expect(tasks).toHaveLength(1);
    expect(() => tasks[0]?.()).toThrow(failure);
    const schedule = jest.spyOn(globalThis, 'queueMicrotask').mockImplementation(() => undefined);
    try {
      raiseStartupError(failure);
      expect(schedule).toHaveBeenCalledTimes(1);
    } finally {
      schedule.mockRestore();
    }
  });
});

describe('[ADR-0013 §7] startWorker: graceful shutdown', () => {
  it('registers SIGTERM and SIGINT once each', async () => {
    const h = harness();
    await startWorker(h.deps);
    expect(SHUTDOWN_SIGNALS).toEqual(['SIGTERM', 'SIGINT']);
    expect(SHUTDOWN_SIGNALS.map((signal) => h.events.listenerCount(signal))).toEqual([1, 1]);
  });

  it('SIGTERM: readiness drains, the consumers finish their active jobs, THEN the listener closes; queues and pool close; exit 0', async () => {
    const h = harness();
    await startWorker(h.deps);
    h.events.emit('SIGTERM');
    await settle();
    expect(h.calls.slice(7)).toEqual(['probe.startDraining', 'queues.drain']);
    h.finishDrain();
    await settle();
    expect(h.calls.slice(9)).toEqual(['server.close', 'server.closeIdleConnections']);
    expect(h.exits).toEqual([]);
    h.server.closeCallback?.();
    await settle();
    expect(h.calls.slice(11).sort()).toEqual(['exit 0', 'pool.close', 'queues.close']);
    expect(h.calls.at(-1)).toBe('exit 0');
    expect(h.lines()).toEqual([
      expect.objectContaining({ event: 'shutdown.start', signal: 'SIGTERM' }),
      expect.objectContaining({ event: 'shutdown.done', code: 0 }),
    ]);
  });

  it('a consumer that fails to close: the listener still closes (finally), exit 1', async () => {
    const h = harness();
    await startWorker(h.deps);
    h.events.emit('SIGINT');
    await settle();
    h.finishDrain(new Error('close failed'));
    await settle();
    expect(h.calls).toContain('server.close');
    h.server.closeCallback?.();
    await settle();
    expect(h.exits).toEqual([1]);
    expect(eventsOf(h)).toContain('shutdown.drain_failed');
  });

  it('the drain is bounded: then the health connections are force-closed and the process exits 1', async () => {
    const h = harness();
    await startWorker(h.deps);
    h.events.emit('SIGTERM');
    await jest.advanceTimersByTimeAsync(25_000);
    expect(h.calls).toContain('server.closeAllConnections');
    expect(h.exits).toEqual([1]);
  });
});

describe('[D-ORCH-073] WORKER_PROCESS: main.ts runs with the real process', () => {
  it('uses process.stdout, the process events, the configuration loader, the runtime factory, the queues, the health server and the registry', () => {
    expect(WORKER_PROCESS.stdout).toBe(process.stdout);
    expect(WORKER_PROCESS.processEvents).toBe(process);
    expect(WORKER_PROCESS.loadConfig).toBe(loadRuntimeConfigOrExit);
    expect(WORKER_PROCESS.createRuntimeServices).toBe(createRuntimeServices);
    expect(WORKER_PROCESS.createQueues).toBe(createProductionQueues);
    expect(WORKER_PROCESS.createHealthServer).toBe(createWorkerHealthServer);
    expect(WORKER_PROCESS.processors).toBe(PROCESSORS);
  });

  it('[PR64-SEC-04][R2-n2] the production queues get the three retention constants, the scheduled jobs and the right connection profile per client', () => {
    const log = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    } as unknown as WorkerQueuesInput['log'];
    const config = { REDIS_URL: { reveal: () => 'redis://worker:x@valkey:6379/0' } } as unknown as Config;
    const options = productionQueuesOptions({ config, log, processors: PROCESSORS });
    expect(options.retention).toEqual({ completed: COMPLETED_RETENTION, failed: FAILED_RETENTION, deadLetter: DEAD_LETTER_RETENTION });
    expect(options.schedules).toEqual({});
    expect(options.processors).toBe(PROCESSORS);
    const workerProfile = options.connection as Record<string, unknown>;
    const queueProfile = options.queueConnection as Record<string, unknown>;
    expect([workerProfile['connectionName'], workerProfile['maxRetriesPerRequest'], workerProfile['commandTimeout']]).toEqual([
      'worker-consumers',
      null,
      undefined,
    ]);
    expect([queueProfile['connectionName'], queueProfile['enableOfflineQueue']]).toEqual(['worker-queues', false]);
  });

  it('exitProcess is process.exit', () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      WORKER_PROCESS.exitProcess(CONFIG_EXIT_CODE);
      expect(exit.mock.calls).toEqual([[CONFIG_EXIT_CODE]]);
    } finally {
      exit.mockRestore();
    }
  });
});
