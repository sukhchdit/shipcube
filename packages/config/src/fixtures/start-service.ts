// Child-process fixture for process-env.test.ts: starts like the API or worker entry point would
// (`node --import tsx start-service.ts <api|worker>`), printing "ready" only when the configuration loads.
import { loadConfigOrExit } from '../process-env.js';

const service = process.argv[2] === 'worker' ? 'worker' : 'api';
const config = loadConfigOrExit(service);
process.stdout.write(`ready ${service} ${config.APP_ENV}\n`);
