/**
 * The API start-up and shutdown sequence (D-ORCH-073; ADR-0003, US-012, NFR-AVAIL-002, PR #44 R1-m3), run with fakes
 * for the process seams: configuration, stdout, process.exit, the process events, the runtime services, createApp and
 * the listener. The real logger, flush-before-exit, process error handlers, afterCommit queue and shutdown sequence run.
 */
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { CONFIG_EXIT_CODE, loadRuntimeConfigOrExit, type Config, type Secret } from '@platform/config';

import { createApp, type AppDependencies } from './app.js';
import { moduleRegistry } from './modules/index.generated.js';
import { DocsSpecError } from './platform/openapi/serve.js';
import { UndefinedRouteError } from './platform/routing/pipeline.js';
import type { ReadinessProbe } from './platform/runtime/readiness.js';
import { createRuntimeServices, type RuntimeServices } from './platform/runtime/services.js';
import { DRAIN_TIMEOUT_MS } from './platform/runtime/shutdown.js';
import {
  API_PROCESS,
  raiseStartupError,
  SHUTDOWN_SIGNALS,
  startApi,
  type ApiListener,
  type ApiServer,
  type StartApiDependencies,
} from './start-api.js';

type LogLine = Readonly<Record<string, unknown>>;

/** The http.Server seam: records calls; the test decides when (and how) `close` calls back. */
class FakeServer extends EventEmitter implements ApiServer {
  readonly calls: string[];
  closeCallback: ((error?: Error) => void) | undefined;

  constructor(calls: string[]) {
    super();
    this.calls = calls;
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
  readonly deps: Partial<StartApiDependencies>;
  /** Every seam call in order (plus the afterCommit work's abort). */
  readonly calls: string[];
  readonly exits: number[];
  readonly events: EventEmitter;
  readonly server: FakeServer;
  readonly services: RuntimeServices;
  readonly secrets: ReadonlyMap<string, Secret<string>>;
  readonly config: Config;
  /** The parsed log lines written to the fake stdout. */
  lines(): LogLine[];
  /** The dependencies startApi passed to createApp. */
  composed(): AppDependencies;
  /** The callback startApi passed to `listen`. */
  listenCallback(): (error?: Error) => void;
  /** From now on stdout holds its write callbacks (an unflushed stream); the returned function flushes them. */
  holdFlush(): () => void;
}

const API_PACKAGE_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

function harness(
  options: { readonly config?: Readonly<Record<string, unknown>>; readonly createApp?: (deps: AppDependencies) => ApiListener } = {},
): Harness {
  const calls: string[] = [];
  const exits: number[] = [];
  const raw: string[] = [];
  const events = new EventEmitter();
  const server = new FakeServer(calls);
  const config = { APP_LOG_LEVEL: 'info', APP_PORT: 3000, APP_ENV: 'local', DOCS_ENABLED: false, ...options.config } as unknown as Config;
  const secrets: ReadonlyMap<string, Secret<string>> = new Map();
  const probe = { startDraining: () => calls.push('probe.startDraining') } as unknown as ReadinessProbe;
  const services = {
    probe,
    tenantTx: { runner: 'the runtime runner' } as unknown as RuntimeServices['tenantTx'],
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
  let composed: AppDependencies | undefined;
  let listenCallback: ((error?: Error) => void) | undefined;
  let heldFlushes: ((error?: Error | null) => void)[] | undefined;
  const deps: Partial<StartApiDependencies> = {
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
    createApp: (appDeps) => {
      calls.push('createApp');
      composed = appDeps;
      if (options.createApp !== undefined) return options.createApp(appDeps);
      return {
        listen: (port, callback) => {
          calls.push(`listen ${String(port)}`);
          listenCallback = callback;
          return server;
        },
      };
    },
    modules: [],
  };
  return {
    deps,
    calls,
    exits,
    events,
    server,
    services,
    secrets,
    config,
    lines: () => raw.flatMap((chunk) => chunk.split('\n').filter((line) => line !== '')).map((line) => JSON.parse(line) as LogLine),
    composed: () => {
      if (composed === undefined) throw new Error('createApp was not called');
      return composed;
    },
    listenCallback: () => {
      if (listenCallback === undefined) throw new Error('listen was not called');
      return listenCallback;
    },
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

// Fake timers: the shutdown drain bound and the flush-before-exit fallback timer (1 s, exitAfterFlush) never hold the
// worker open. setImmediate (the afterCommit start, settle()) and microtasks stay real.
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

/** Lets pending promise callbacks and the afterCommit queue's later-turn starts run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** Schedules afterCommit work that settles only when its signal aborts (the drain), recording the abort. */
function scheduleAbortableWork(h: Harness): void {
  const queue = h.composed().afterCommit;
  if (queue === undefined) throw new Error('no afterCommit queue was passed to createApp');
  queue.schedule(
    (signal) =>
      new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            h.calls.push('afterCommit.aborted');
            resolve();
          },
          { once: true },
        );
      }),
    { route: 'POST /fixture', operationId: 'fixtureOperation', correlationId: 'corr-1' },
  );
}

describe('[D-ORCH-073] startApi: boot order (D-ARCH-104, PR11-SEC-09)', () => {
  it('loads the config, composes the services once, composes the app with the runtime runner, awaits startup, then listens', async () => {
    const h = harness();
    await startApi(h.deps);
    expect(h.calls).toEqual(['loadConfig api', 'createRuntimeServices api', 'createApp', 'services.startup', 'listen 3000']);
    const composed = h.composed();
    expect(composed.tenantTx).toBe(h.services.tenantTx);
    expect(composed.modules).toBe(h.deps.modules);
    expect(composed.apiMode).toBe('test');
    expect(composed.logger).toBeDefined();
    expect('docs' in composed).toBe(false);
    expect(composed.health.length).toBeGreaterThan(0);
    // 'listening' is logged by the success callback only (PR-0009 n1), with the version of apps/api/package.json.
    expect(eventsOf(h)).toEqual([]);
    h.listenCallback()(undefined);
    expect(h.lines()).toEqual([
      expect.objectContaining({ event: 'api.listening', port: 3000, service: 'api', version: API_PACKAGE_VERSION }),
    ]);
  });

  it('production selects the live mode; DOCS_ENABLED passes the contract, whose path resolves from src/', async () => {
    const h = harness({ config: { APP_ENV: 'production', DOCS_ENABLED: true } });
    await startApi(h.deps);
    const composed = h.composed();
    expect(composed.apiMode).toBe('live');
    const specPath = composed.docs?.specPath;
    expect(specPath).toBeInstanceOf(URL);
    const file = fileURLToPath(specPath as URL).replaceAll('\\', '/');
    expect(file.endsWith('/docs/03-architecture/api/openapi.yaml')).toBe(true);
    expect(existsSync(file)).toBe(true);
  });

  it('the process error handlers are installed before the services are composed; a fatal error exits 1 after one line', async () => {
    const h = harness();
    const compose = h.deps.createRuntimeServices;
    let handlersAtComposition = -1;
    await startApi({
      ...h.deps,
      createRuntimeServices: (config, service, log, secrets) => {
        handlersAtComposition = h.events.listenerCount('uncaughtException') + h.events.listenerCount('unhandledRejection');
        expect([config, secrets]).toEqual([h.config, h.secrets]);
        return (compose as StartApiDependencies['createRuntimeServices'])(config, service, log, secrets);
      },
    });
    expect(handlersAtComposition).toBe(2);
    h.events.emit('uncaughtException', new TypeError('boom'), 'uncaughtException');
    expect(h.lines()).toEqual([expect.objectContaining({ level: 'fatal', event: 'process.uncaught_exception' })]);
    expect(h.exits).toEqual([1]);
  });

  it('a listen failure logs no listening line; the error event logs api.listen_failed and exits 1 after the flush', async () => {
    const h = harness();
    await startApi(h.deps);
    h.listenCallback()(new RangeError('port in use'));
    expect(eventsOf(h)).toEqual([]);
    const flush = h.holdFlush();
    h.server.emit('error', new RangeError('port in use'));
    expect(h.lines()).toEqual([expect.objectContaining({ level: 'error', event: 'api.listen_failed', error: 'RangeError' })]);
    // The exit waits for the line to reach stdout (exitAfterFlush, R2-n7).
    expect(h.exits).toEqual([]);
    flush();
    expect(h.exits).toEqual([1]);
  });
});

describe('[D-ORCH-073] startApi: start-up errors', () => {
  it.each([
    ['DocsSpecError (DOCS_ENABLED without a readable contract)', new DocsSpecError('unreadable'), 'api.docs_unavailable', 'DocsSpecError'],
    ['a refused composition (bootFailureOf)', new UndefinedRouteError('getFixture'), 'api.route_not_defined', 'UndefinedRouteError'],
  ])('%s: one error line, exit 78 before startup, listen or any signal handler', async (_label, thrown, event, name) => {
    const h = harness({
      createApp: () => {
        throw thrown;
      },
    });
    await startApi(h.deps);
    expect(h.lines()).toEqual([expect.objectContaining({ level: 'error', event, error: name })]);
    expect(h.exits).toEqual([CONFIG_EXIT_CODE]);
    expect(CONFIG_EXIT_CODE).toBe(78);
    expect(h.calls).toEqual(['loadConfig api', 'createRuntimeServices api', 'createApp', 'exit 78']);
    expect(SHUTDOWN_SIGNALS.map((signal) => h.events.listenerCount(signal))).toEqual([0, 0]);
  });

  it('an unmapped composition error rejects startApi (main.ts re-raises it) without an exit of its own', async () => {
    const failure = new Error('unexpected');
    const h = harness({
      createApp: () => {
        throw failure;
      },
    });
    await expect(startApi(h.deps)).rejects.toBe(failure);
    expect(h.exits).toEqual([]);
    expect(eventsOf(h)).toEqual([]);
  });

  it('raiseStartupError re-raises the rejection as an uncaught exception on a later task (the process handlers report it)', () => {
    const failure = new Error('unexpected');
    const tasks: (() => void)[] = [];
    raiseStartupError(failure, (task) => tasks.push(task));
    expect(tasks).toHaveLength(1);
    let thrown: unknown;
    try {
      tasks[0]?.();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(failure);
  });
});

describe('[D-ORCH-073] startApi: graceful shutdown (NFR-AVAIL-002, ADR-0013 item 7, PR #44 R1-m3)', () => {
  it('registers SIGTERM and SIGINT once each', async () => {
    const h = harness();
    await startApi(h.deps);
    expect(SHUTDOWN_SIGNALS).toEqual(['SIGTERM', 'SIGINT']);
    expect(SHUTDOWN_SIGNALS.map((signal) => h.events.listenerCount(signal))).toEqual([1, 1]);
  });

  it('SIGTERM: readiness drains, the listener closes, THEN the one afterCommit queue passed to createApp drains, then exit 0', async () => {
    const h = harness();
    await startApi(h.deps);
    scheduleAbortableWork(h);
    await settle();
    h.events.emit('SIGTERM');
    await settle();
    // In-flight requests first: the afterCommit work keeps running until the listener has closed.
    expect(h.calls.slice(5)).toEqual(['probe.startDraining', 'server.close', 'server.closeIdleConnections']);
    expect(h.exits).toEqual([]);
    h.server.closeCallback?.();
    await settle();
    expect(h.calls.slice(8)).toEqual(['afterCommit.aborted', 'pool.close', 'exit 0']);
    expect(h.lines()).toEqual([
      expect.objectContaining({ event: 'shutdown.start', signal: 'SIGTERM' }),
      expect.objectContaining({ event: 'shutdown.done', code: 0 }),
    ]);
  });

  it('closing the listener fails: the afterCommit work is still drained (finally), exit 1', async () => {
    const h = harness();
    await startApi(h.deps);
    scheduleAbortableWork(h);
    await settle();
    h.events.emit('SIGTERM');
    await settle();
    h.server.closeCallback?.(new Error('close failed'));
    await settle();
    expect(h.calls.slice(8)).toEqual(['afterCommit.aborted', 'pool.close', 'exit 1']);
    expect(h.lines()).toEqual([
      expect.objectContaining({ event: 'shutdown.start', signal: 'SIGTERM' }),
      expect.objectContaining({ event: 'shutdown.drain_failed', error: 'Error' }),
      expect.objectContaining({ event: 'shutdown.done', code: 1 }),
    ]);
  });

  it('SIGINT runs the same sequence; a second signal does not restart it', async () => {
    const h = harness();
    await startApi(h.deps);
    h.events.emit('SIGINT');
    h.events.emit('SIGTERM');
    await settle();
    h.server.closeCallback?.();
    await settle();
    expect(h.calls.filter((call) => call === 'server.close')).toHaveLength(1);
    expect(h.exits).toEqual([0]);
    expect(h.lines().filter((line) => line['event'] === 'shutdown.start')).toEqual([expect.objectContaining({ signal: 'SIGINT' })]);
  });

  it('the drain is bounded at 25 s: then the connections are force-closed and the process exits 1', async () => {
    expect(DRAIN_TIMEOUT_MS).toBe(25_000);
    const h = harness();
    await startApi(h.deps);
    h.events.emit('SIGTERM');
    await jest.advanceTimersByTimeAsync(DRAIN_TIMEOUT_MS - 1);
    expect(h.calls).not.toContain('server.closeAllConnections');
    expect(h.exits).toEqual([]);
    await jest.advanceTimersByTimeAsync(1);
    expect(h.calls.slice(-3)).toEqual(['server.closeAllConnections', 'pool.close', 'exit 1']);
    expect(h.lines()).toContainEqual(expect.objectContaining({ event: 'shutdown.drain_timeout', timeoutMs: DRAIN_TIMEOUT_MS }));
  });
});

describe('[D-ORCH-073] API_PROCESS: main.ts runs with the real process', () => {
  it('uses process.stdout, the process events, the configuration loader, the runtime factory, createApp and the registry', () => {
    expect(API_PROCESS.stdout).toBe(process.stdout);
    expect(API_PROCESS.processEvents).toBe(process);
    expect(API_PROCESS.loadConfig).toBe(loadRuntimeConfigOrExit);
    expect(API_PROCESS.createRuntimeServices).toBe(createRuntimeServices);
    expect(API_PROCESS.createApp).toBe(createApp);
    expect(API_PROCESS.modules).toBe(moduleRegistry);
  });

  it('exitProcess is process.exit', () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      API_PROCESS.exitProcess(CONFIG_EXIT_CODE);
      expect(exit.mock.calls).toEqual([[CONFIG_EXIT_CODE]]);
    } finally {
      exit.mockRestore();
    }
  });
});
