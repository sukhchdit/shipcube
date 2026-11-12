// Worker process entry point (ADR-0003, ADR-0013, US-012, NFR-AVAIL-002). Thin composition root: configuration
// (exit 78 on a rejected configuration or secret, PR3-SEC-05), the runtime services shared with the API
// (`@platform/api/runtime`), the health server on APP_HEALTH_PORT and graceful shutdown. Queue processors arrive
// with the queue tasks; they register their drain here as an additional step.
import { createRuntimeLog, createRuntimeServices, createShutdown, readPackageVersion } from '@platform/api/runtime';
import { loadRuntimeConfigOrExit } from '@platform/config';

import { createWorkerHealthServer } from './platform/health/server.js';
import { jobLogContext } from './platform/logging/job-context.js';

const { config } = await loadRuntimeConfigOrExit('worker');
// Redacted Pino logger (TASK-010); lines written while a job runs carry its correlation context (job-context.ts).
const log = createRuntimeLog('worker', process.stdout, {
  version: readPackageVersion(new URL('../package.json', import.meta.url)),
  level: config.APP_LOG_LEVEL,
  context: jobLogContext,
});
const services = createRuntimeServices(config, 'worker', log);
const server = createWorkerHealthServer(services.probe);

// Session-integrity check on a dedicated connection before the health server opens and before any queue processor
// takes a job (PR-0009 M1); never rejects. Queue processors register after this line.
await services.startup();

server.listen(config.APP_HEALTH_PORT, () => log.info('worker.health_listening', { port: config.APP_HEALTH_PORT }));
server.on('error', (error: Error) => {
  log.error('worker.listen_failed', { error: error.name });
  process.exit(1);
});

const shutdown = createShutdown({
  probe: services.probe,
  drain: () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
      server.closeIdleConnections();
    }),
  forceClose: () => server.closeAllConnections(),
  resources: services.resources,
  log,
  exit: (code) => process.exit(code),
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => void shutdown(signal));
