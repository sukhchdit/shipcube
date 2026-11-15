// @ts-check
/**
 * `npm run test:stack [-- <jest path patterns>]` — the Compose/image stack suite (TASK-014; US-003, US-004, US-049;
 * NFR-OPS-001). It builds the images and runs `docker compose up`, so it is opt-in: the `stack` Jest project exists only
 * when JEST_STACK=1 (jest.config.ts), and this runner is the one place that sets it. Docker Desktop required; lane B
 * runs it under the host-wide docker lock. Path patterns come first (`jest <path> --selectProjects stack`): after
 * --selectProjects Jest would read them as project names.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Node and Jest arguments for a stack run with the caller's extra arguments (exported for the unit test). */
export function stackJestArgs(/** @type {readonly string[]} */ extra) {
  return [
    '--experimental-vm-modules',
    '--disable-warning=ExperimentalWarning',
    join(ROOT, 'node_modules', 'jest', 'bin', 'jest.js'),
    ...extra,
    '--selectProjects',
    'stack',
    '--runInBand',
    '--testTimeout=900000',
  ];
}

if (import.meta.main) {
  const result = spawnSync(process.execPath, stackJestArgs(process.argv.slice(2)), {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, JEST_STACK: '1' },
    windowsHide: true,
  });
  process.exitCode = result.status ?? 1;
}
