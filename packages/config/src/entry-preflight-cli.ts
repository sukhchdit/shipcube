/**
 * `node --disable-sigusr1 /app/packages/config/dist/entry-preflight-cli.js -- <container argv>`: the process run by
 * tools/docker/entrypoint.sh before the api or worker starts (TASK-014; see entry-preflight.ts). The arguments after
 * the first `--` are the argv the entrypoint would exec (PR39-SEC-02 (a), R1-m1); without a `--` the argv is empty,
 * which a hardened environment refuses. Exit 0 lets the entrypoint exec the application; exit 78 stops the container
 * before any application code runs.
 */
import { argvAfterSeparator, runEntryPreflight } from './entry-preflight.js';

process.exitCode = runEntryPreflight(process.env, { stderr: process.stderr }, argvAfterSeparator(process.argv.slice(2)));
