// API process entry point (ADR-0003, US-012, NFR-AVAIL-002). Thin composition root: configuration (exit 78 on a
// rejected configuration or secret, PR3-SEC-05), shared runtime services, the Express app, the listener and
// graceful shutdown. Testable logic lives in platform/runtime and platform/health.
import { loadRuntimeConfigOrExit } from '@platform/config';

import { createApp } from './app.js';
import { moduleRegistry } from './modules/index.generated.js';
import { createHealthRouter } from './platform/health/router.js';
import { requestLogContext } from './platform/logging/correlation.js';
import { createRuntimeLog, readPackageVersion } from './platform/runtime/log.js';
import { installProcessErrorHandlers } from './platform/runtime/process-errors.js';
import { createRuntimeServices } from './platform/runtime/services.js';
import { createShutdown } from './platform/runtime/shutdown.js';

const { config } = await loadRuntimeConfigOrExit('api');
// Redacted Pino logger (TASK-010); every line carries the request context of the request being handled, if any.
const log = createRuntimeLog('api', process.stdout, {
  version: readPackageVersion(new URL('../package.json', import.meta.url)),
  level: config.APP_LOG_LEVEL,
  context: requestLogContext,
});
// Uncaught exceptions and unhandled rejections: one redacted fatal line, then exit 1 (PR20-SEC-06).
installProcessErrorHandlers({ log, exit: (code) => process.exit(code) });
const services = createRuntimeServices(config, 'api', log);
const app = createApp({ healthRouter: createHealthRouter({ probe: services.probe }), modules: moduleRegistry, logger: log });

// Session-integrity check on a dedicated connection before the listener opens (PR-0009 M1); never rejects.
await services.startup();
// Express 5 registers this callback as a once-'error' listener too: log 'listening' only on success (PR-0009 n1).
const server = app.listen(config.APP_PORT, (error?: Error) => {
  if (error === undefined) log.info('api.listening', { port: config.APP_PORT });
});
server.on('error', (error: Error) => {
  log.error('api.listen_failed', { error: error.name });
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
