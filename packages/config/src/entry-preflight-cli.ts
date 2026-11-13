/**
 * `node --disable-sigusr1 /app/packages/config/dist/entry-preflight-cli.js`: the process run by
 * tools/docker/entrypoint.sh before the api or worker starts (TASK-014; see entry-preflight.ts). Exit 0 lets the
 * entrypoint exec the application; exit 78 stops the container before any application code runs.
 */
import { runEntryPreflight } from './entry-preflight.js';

process.exitCode = runEntryPreflight(process.env, { stderr: process.stderr });
