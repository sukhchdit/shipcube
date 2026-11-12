// Child-process fixture for runtime-config.test.ts: starts like the API or worker entry point does
// (`node <tsx> start-runtime-service.ts <api|worker>`), printing "ready" only when the configuration loads and every
// secret reference resolves and passes the post-resolution checks (PR3-SEC-05).
import { loadRuntimeConfigOrExit } from '../process-env.js';

const service = process.argv[2] === 'worker' ? 'worker' : 'api';
const { config, secrets } = await loadRuntimeConfigOrExit(service);
process.stdout.write(`ready ${service} ${config.APP_ENV} secrets=${String(secrets.size)}\n`);
