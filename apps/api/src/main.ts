// API process entry point (ADR-0003, US-012, NFR-AVAIL-002). Thin composition root: configuration (exit 78 on a
// rejected configuration or secret, PR3-SEC-05), shared runtime services, the Express app, the listener and
// graceful shutdown. Testable logic lives in platform/runtime and platform/health.
import { CONFIG_EXIT_CODE, loadRuntimeConfigOrExit } from '@platform/config';

import { createApp } from './app.js';
import { moduleRegistry } from './modules/index.generated.js';
import { resolveApiMode } from './platform/context/api-mode.js';
import { createHealthRouter } from './platform/health/router.js';
import { DocsSpecError, docsOptionsFrom, type DocsOptions } from './platform/openapi/serve.js';
import { createRuntimeLog } from './platform/runtime/log.js';
import { createRuntimeServices } from './platform/runtime/services.js';
import { createShutdown } from './platform/runtime/shutdown.js';

const { config, secrets } = await loadRuntimeConfigOrExit('api');
const log = createRuntimeLog('api', process.stdout);
const services = createRuntimeServices(config, 'api', log, secrets);
// The contract served by /api/docs when DOCS_ENABLED (REQ-API-003); same depth from src/ and dist/.
const docs: DocsOptions | undefined = docsOptionsFrom(config, new URL('../../../docs/03-architecture/api/openapi.yaml', import.meta.url));
let app: ReturnType<typeof createApp>;
try {
  app = createApp({
    healthRouter: createHealthRouter({ probe: services.probe }),
    modules: moduleRegistry,
    apiMode: resolveApiMode(config.APP_ENV),
    ...(docs === undefined ? {} : { docs }),
  });
} catch (error) {
  // DOCS_ENABLED without a readable contract is a deployment error: exit like a rejected configuration.
  if (!(error instanceof DocsSpecError)) throw error;
  log.error('api.docs_unavailable', { error: error.name });
  process.exit(CONFIG_EXIT_CODE);
}

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
