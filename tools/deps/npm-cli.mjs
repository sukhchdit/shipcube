// @ts-check
/**
 * Locates the npm CLI entry (`npm-cli.js`) that belongs to the running Node installation, so
 * callers start npm as `node <npm-cli.js> …` with `process.execPath`: no shell, no `.cmd` shim.
 *
 * Plain ESM with no imports beyond `node:` builtins, because `tools/deps/rebuild.mjs` runs right
 * after `npm ci --ignore-scripts`, before any loader (tsx, swc) can be relied on. The tooling tests
 * share it through `tools/test-support/process.ts`.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** @returns {string} absolute path of `npm-cli.js` */
export function npmCli() {
  const fromEnv = process.env['npm_execpath'];
  if (fromEnv !== undefined && /npm-cli\.js$/.test(fromEnv) && existsSync(fromEnv)) return fromEnv;
  const nodeDir = dirname(process.execPath);
  const candidates = [
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Windows layout
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), // POSIX layout
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) throw new Error(`npm CLI not found next to ${process.execPath}`);
  return found;
}
