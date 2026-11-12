// @ts-check
/**
 * Build-must-not-mutate-the-tree gate (lane A, after `npm run build`; ADR-0023 am. I item 4 and J item 5; F-SEC-1;
 * PR1-SEC-03 (b), PR4-SEC-04). Requires `git status --porcelain --untracked-files=all` to be EMPTY: a build may neither
 * modify tracked files (for example `@react-router/dev` rewriting `package.json` to add `isbot` and running
 * `npm install`) nor create non-ignored files (a nested `package-lock.json`, a stale generated `types.gen.ts`).
 *
 * Paths are printed, contents never are.
 *
 * CLI: node tools/ci/check-porcelain.mjs [--root <dir>] [--summary <file>] [--json]
 * Exit 0 clean, 1 tree mutated, 2 usage/internal error (including git failing).
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @typedef {{ status: string, path: string }} PorcelainEntry */

/**
 * @param {string} output `git status --porcelain` (v1) output
 * @returns {PorcelainEntry[]}
 */
export function parsePorcelain(output) {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => ({ status: line.slice(0, 2), path: line.slice(3) }));
}

/**
 * @param {string} root
 * @returns {PorcelainEntry[]}
 * @throws {Error} when git cannot report the status
 */
export function gitPorcelain(root) {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git status failed (exit ${String(result.status)}): ${result.stderr.trim()}`);
  return parsePorcelain(result.stdout);
}

/** @param {string[]} argv */
export function main(argv) {
  let root = process.cwd();
  /** @type {string | undefined} */
  let summary;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root' || arg === '--summary') {
      const value = argv[i + 1];
      if (value === undefined) {
        console.error(`check-porcelain: ${arg} needs a value`);
        return 2;
      }
      if (arg === '--root') root = resolve(value);
      else summary = value;
      i += 1;
    } else if (arg === '--json') json = true;
    else {
      console.error(`check-porcelain: unknown argument ${String(arg)}`);
      return 2;
    }
  }
  /** @type {PorcelainEntry[]} */
  let entries;
  try {
    entries = gitPorcelain(root);
  } catch (error) {
    console.error(`check-porcelain: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  if (json) console.log(JSON.stringify({ entries }, null, 2));
  else
    for (const entry of entries)
      console.log(`porcelain: the build changed the tree: "${entry.status}" ${entry.path} (git status --porcelain)`);
  if (summary) {
    const body =
      entries.length === 0
        ? 'clean'
        : `**${entries.length} path(s) changed**\n\n${entries.map((e) => `- \`${e.status}\` \`${e.path}\``).join('\n')}`;
    appendFileSync(summary, `\n### Build left the tree: ${body}\n`);
  }
  return entries.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
