// @ts-check
/**
 * Locates the npm CLI entry (`npm-cli.js`) that belongs to the running Node installation, so
 * callers start npm as `node <npm-cli.js> …` with `process.execPath`: no shell, no `.cmd` shim.
 * Only paths relative to the Node installation are candidates (PR9-SEC-15, TASK-014): the
 * `npm_execpath` variable is ignored, because any parent process (or an `.npmrc` `script-shell`)
 * can set it and it would choose the code every npm child runs.
 *
 * Plain ESM with no imports beyond `node:` builtins, because `tools/deps/rebuild.mjs` runs right
 * after `npm ci --ignore-scripts`, before any loader (tsx, swc) can be relied on. The tooling tests
 * share it through `tools/test-support/process.ts`.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * @param {string} [execPath] the Node binary whose bundled npm is wanted (test seam; default `process.execPath`)
 * @returns {string} absolute path of `npm-cli.js`
 */
export function npmCli(execPath = process.execPath) {
  const nodeDir = dirname(execPath);
  const candidates = [
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Windows layout
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), // POSIX layout
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) throw new Error(`npm CLI not found next to ${execPath}`);
  return found;
}
