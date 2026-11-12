// @ts-check
/**
 * `node tools/deps/prisma-cli.mjs [--verify-only] <prisma args>` — the only way the repository runs the Prisma CLI
 * (ADR-0023 amendment J item 2 (d), D-ARCH-041). Every root `db:*` script, the migration linter's `prisma validate`,
 * the Testcontainers harness and the `migrate` image entrypoint go through it; package.json scripts never call a bare
 * `prisma`.
 *
 *   1. `ensureEngine()` from `prisma-engines.mjs`: forbidden-variable refusal, manifest/version equality, target,
 *      offline/cached mode or a verified fetch from the fixed origin. `--verify-only` never fetches.
 *   2. `npm exec --node-options= --no -- prisma <args>` (`prismaExecArgs`) from the repository root with
 *      `PRISMA_SCHEMA_ENGINE_BINARY=<verified path>` and `CHECKPOINT_DISABLE=1`, so the CLI's own downloader and the
 *      per-user engine cache are never reached. The environment carries no `NODE_OPTIONS` (PR5-SEC-07) and
 *      `--node-options=` stops npm from writing one from its own env/`.npmrc` `node-options` setting (PR9-SEC-02), so
 *      no preload can redirect the engine inside the child.
 *   3. The engine is re-hashed after the child exits; a change deletes it and fails the run.
 *
 * `--verify-only` with no further arguments only verifies and exits.
 */
import { spawnSync } from 'node:child_process';

import { npmCli } from './npm-cli.mjs';
import { REPO_ROOT, ensureEngine, prismaChildEnv, prismaExecArgs, reverifyEngine } from './prisma-engines.mjs';

/**
 * Runs the Prisma CLI through the verified engine. Returns the exit code.
 * @param {string[]} argv
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string }} [options]
 */
export async function runPrisma(argv, options = {}) {
  const env = options.env ?? process.env;
  const verifyOnly = argv[0] === '--verify-only';
  const args = verifyOnly ? argv.slice(1) : argv;
  const log = (/** @type {string} */ line) => process.stderr.write(`${line}\n`);
  /** @type {Awaited<ReturnType<typeof ensureEngine>>} */
  let engine;
  try {
    engine = await ensureEngine({ verifyOnly, env, log });
  } catch (error) {
    process.stderr.write(`[prisma-cli] ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  if (verifyOnly && args.length === 0) {
    process.stdout.write(`[prisma-cli] verified ${engine.path} (${engine.mode})\n`);
    return 0;
  }
  const child = spawnSync(process.execPath, [npmCli(), ...prismaExecArgs(args)], {
    cwd: options.cwd ?? REPO_ROOT,
    env: prismaChildEnv(env, engine.path),
    stdio: 'inherit',
    windowsHide: true,
  });
  try {
    reverifyEngine(engine.path, engine.sha256);
  } catch (error) {
    process.stderr.write(`[prisma-cli] ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  if (child.error !== undefined) {
    process.stderr.write(`[prisma-cli] could not start prisma: ${child.error.message}\n`);
    return 1;
  }
  return child.status ?? 1;
}

if (typeof import.meta.main !== 'boolean') {
  throw new Error('prisma-cli needs Node >= 24.2 (import.meta.main); see .node-version');
}
if (import.meta.main) {
  void runPrisma(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
