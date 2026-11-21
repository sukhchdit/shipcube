// API process start (ADR-0003, US-012, NFR-AVAIL-002; D-ORCH-073): the composition root that main.ts calls.
// Configuration (exit 78 on a rejected configuration or secret, PR3-SEC-05), shared runtime services, the Express app,
// the listener and graceful shutdown. The process seams (configuration loader, stdout, process.exit, the process
// events, the service and app factories, the module registry) are injectable so the whole sequence runs under test;
// main.ts passes none, so production always gets API_PROCESS. No top-level await: main.ts stays importable.
import { type AuditPrivacy, createAuditPrivacy } from '@platform/audit';
import { CONFIG_EXIT_CODE, loadRuntimeConfigOrExit, type Config, type RuntimeConfig, type Secret } from '@platform/config';

import { createApp, type AppDependencies, type ModuleRegistration } from './app.js';
import { moduleRegistry } from './modules/index.generated.js';
import { resolveApiMode } from './platform/context/api-mode.js';
import { healthRoutes } from './platform/health/router.js';
import { requestLogContext } from './platform/logging/correlation.js';
import { DocsSpecError, docsOptionsFrom, type DocsOptions } from './platform/openapi/serve.js';
import { bootFailureOf } from './platform/routing/pipeline.js';
import { createRuntimeLog, readPackageVersion, type LogSink, type RuntimeLog } from './platform/runtime/log.js';
import {
  exitAfterFlush,
  installProcessErrorHandlers,
  type FlushableStream,
  type ProcessErrorSource,
} from './platform/runtime/process-errors.js';
import { createRuntimeServices, type RuntimeServices } from './platform/runtime/services.js';
import { createShutdown } from './platform/runtime/shutdown.js';
import { createAfterCommitQueue } from './platform/tx/after-commit.js';

/** The signals that start graceful shutdown (each handled once; a second signal does not restart the sequence). */
export const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;
export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

/** The part of the listener startApi uses (the http.Server that `app.listen` returns). */
export interface ApiServer {
  close(callback: (error?: Error) => void): unknown;
  closeIdleConnections(): void;
  closeAllConnections(): void;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/** The part of the composed app startApi uses (Express 5 `listen` with the once-'error' callback). */
export interface ApiListener {
  listen(port: number, callback: (error?: Error) => void): ApiServer;
}

/** The process events startApi subscribes to (`process`): the fatal error handlers and the shutdown signals. */
export interface ApiProcessEvents extends ProcessErrorSource {
  once(event: ShutdownSignal, listener: () => void): unknown;
}

export interface StartApiDependencies {
  /** `loadRuntimeConfigOrExit`: names the rejected keys on stderr and exits 78; never resolves with a bad config. */
  readonly loadConfig: (service: 'api') => Promise<RuntimeConfig>;
  /** The log sink, flushed before every exit (`process.stdout`). */
  readonly stdout: LogSink & FlushableStream;
  /** `process.exit`. */
  readonly exitProcess: (code: number) => never;
  /** `process`. */
  readonly processEvents: ApiProcessEvents;
  readonly createRuntimeServices: (
    config: Config,
    service: 'api',
    log: RuntimeLog,
    secrets: ReadonlyMap<string, Secret<string>>,
  ) => RuntimeServices;
  /** `createApp`: runs the boot checks (TASK-020, PR32-SEC-05 (b)) and composes the Express app. */
  readonly createApp: (deps: AppDependencies) => ApiListener;
  /** The generated module registry. */
  readonly modules: readonly ModuleRegistration[];
}

/**
 * The audit capture's privacy dependencies from the validated configuration (D-SEC-PR56-01 condition 1, D-ARCH-141;
 * TASK-028): the vault tokeniser (AUDIT_VAULT_KEY, AUDIT_VAULT_HMAC_KEY), the `ip_hash` index (AUDIT_INDEX_KEY) and the
 * in-house user-agent parser. All three keys are required for the API (ADR-0018 register), so a loaded configuration
 * always has them; without one (a partial test configuration) the capture keeps refusing audited and deniable routes
 * at mount (D-TASK029-21). A malformed key throws here, before anything listens.
 */
export function auditPrivacyFrom(
  config: Pick<Config, 'AUDIT_VAULT_KEY' | 'AUDIT_VAULT_HMAC_KEY' | 'AUDIT_INDEX_KEY'>,
): AuditPrivacy | undefined {
  const { AUDIT_VAULT_KEY: vaultKey, AUDIT_VAULT_HMAC_KEY: vaultHmacKey, AUDIT_INDEX_KEY: indexKey } = config;
  if (vaultKey === undefined || vaultHmacKey === undefined || indexKey === undefined) return undefined;
  return createAuditPrivacy({ vaultKey, vaultHmacKey, indexKey });
}

/** The production process: what main.ts runs with. */
export const API_PROCESS: StartApiDependencies = {
  loadConfig: loadRuntimeConfigOrExit,
  stdout: process.stdout,
  exitProcess: (code) => process.exit(code),
  processEvents: process,
  createRuntimeServices,
  createApp,
  modules: moduleRegistry,
};

/**
 * Starts the API process. Resolves once the listener is opening and the shutdown signals are registered. Rejects with
 * an unexpected error only: a composition error of createApp that bootFailureOf does not map (after the process error
 * handlers are installed), or a fault of the configuration loader itself (before them); main.ts re-raises either as
 * an uncaught exception (raiseStartupError), as the former top-level-await entry point did.
 */
export async function startApi(overrides: Partial<StartApiDependencies> = {}): Promise<void> {
  const deps: StartApiDependencies = { ...API_PROCESS, ...overrides };
  const { config, secrets } = await deps.loadConfig('api');
  // Redacted Pino logger (TASK-010); every line carries the request context of the request being handled, if any.
  const log = createRuntimeLog('api', deps.stdout, {
    version: readPackageVersion(new URL('../package.json', import.meta.url)),
    level: config.APP_LOG_LEVEL,
    context: requestLogContext,
  });
  // Every exit after a log line lets the line reach stdout first (R2-n7, R3-n1).
  const exit = exitAfterFlush({ stream: deps.stdout, exit: deps.exitProcess });
  // Uncaught exceptions and unhandled rejections: one redacted line, flushed, then the exit code that
  // installProcessErrorHandlers chooses for the error (PR20-SEC-06).
  installProcessErrorHandlers({ log, exit, source: deps.processEvents });
  // A StorageConfigError thrown here reaches the handlers above as one redacted fatal line (PR30-SEC-11).
  const services = deps.createRuntimeServices(config, 'api', log, secrets);
  // The contract served by /api/docs when DOCS_ENABLED (REQ-API-003); same depth from src/ and dist/.
  const docs: DocsOptions | undefined = docsOptionsFrom(config, new URL('../../../docs/03-architecture/api/openapi.yaml', import.meta.url));
  const health = healthRoutes({ probe: services.probe });
  // The routes' afterCommit work (ADR-0003 amendment 2026-11-13): drained by the shutdown sequence below.
  const afterCommit = createAfterCommitQueue(log);
  let auditPrivacy: AuditPrivacy | undefined;
  try {
    auditPrivacy = auditPrivacyFrom(config);
  } catch (error) {
    // A malformed audit key is a rejected configuration: exit 78 like every other composition refusal, with a
    // class-only line (no key material; PR #61 dup-review R1-n3).
    log.error('api.audit_keys_rejected', { error: error instanceof Error ? error.name : 'non-error' });
    return deps.exitProcess(CONFIG_EXIT_CODE);
  }
  let app: ApiListener;
  try {
    // createApp runs the boot checks (TASK-020, PR32-SEC-05 (b)): routes declared with defineRoute, the runner for
    // every tenant-transaction route, the route bindings of this APP_ENV (PR8-SEC-05) and the slot stubs' limits
    // (PR32-SEC-03).
    app = deps.createApp({
      health,
      modules: deps.modules,
      tenantTx: services.tenantTx,
      afterCommit,
      auditConfig: config,
      ...(auditPrivacy === undefined ? {} : { auditPrivacy }),
      apiMode: resolveApiMode(config.APP_ENV),
      // The trusted proxy chain and the Valkey-backed limiters (TASK-041): production always composes the real ones.
      trustProxyHops: config.TRUST_PROXY_HOPS,
      rateLimit: { settings: config, valkey: services.valkey },
      ...(docs === undefined ? {} : { docs }),
      logger: log,
    });
  } catch (error) {
    // DOCS_ENABLED without a readable contract or a refused composition is a deployment error: exit like a rejected
    // configuration.
    const failure =
      error instanceof DocsSpecError ? { event: 'api.docs_unavailable', fields: { error: error.name } } : bootFailureOf(error);
    if (failure === undefined) throw error;
    log.error(failure.event, failure.fields);
    // A bare exit: nothing listens and nothing else is queued yet.
    return deps.exitProcess(CONFIG_EXIT_CODE);
  }

  // Session-integrity check on a dedicated connection before the listener opens (PR-0009 M1); never rejects.
  await services.startup();
  // Express 5 registers this callback as a once-'error' listener too: log 'listening' only on success (PR-0009 n1).
  const server = app.listen(config.APP_PORT, (error?: Error) => {
    if (error === undefined) log.info('api.listening', { port: config.APP_PORT });
  });
  server.on('error', (error: Error) => {
    log.error('api.listen_failed', { error: error.name });
    exit(1);
  });

  const shutdown = createShutdown({
    probe: services.probe,
    // In-flight requests first (each schedules its afterCommit before it finishes), then the afterCommit work (also
    // when closing the listener fails, PR #44 R1-m3); both inside the drain bound of the 30 s stop window (ADR-0013
    // item 7).
    drain: async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
          server.closeIdleConnections();
        });
      } finally {
        await afterCommit.drain();
      }
    },
    forceClose: () => server.closeAllConnections(),
    resources: services.resources,
    log,
    exit,
  });
  for (const signal of SHUTDOWN_SIGNALS) deps.processEvents.once(signal, () => void shutdown(signal));
}

/**
 * main.ts's rejection policy: a startApi rejection is re-raised as an uncaught exception, as the rejection of the
 * former top-level-await entry point was. The process error handlers startApi installed report it as one redacted
 * line and exit with the code they choose for the error (PR20-SEC-06, PR30-SEC-11). `schedule` is a test seam
 * (default queueMicrotask).
 */
export function raiseStartupError(error: unknown, schedule: (task: () => void) => void = queueMicrotask): void {
  schedule(() => {
    throw error;
  });
}
