// @ts-check
/**
 * `npm run deps:rebuild` — the only place install-time work runs (ADR-0023 amendment F,
 * SEC-P3-04, R-ARCH-20). `.npmrc` sets `ignore-scripts=true`, so `npm ci` never executes package
 * lifecycle scripts; this script performs the allow-listed steps explicitly, in order:
 *
 *   1. bcrypt   – checks that bcrypt loads (its N-API prebuild for this platform ships in the
 *                 package). Only when it does not load: `npm rebuild bcrypt --ignore-scripts=false`.
 *   2. prisma-engines – the pinned Prisma schema engine (ADR-0023 am. J item 2, D-ARCH-041;
 *                 tools/deps/prisma-engines.mjs): refuses engine-redirecting variables, checks the
 *                 manifest against the installed engines version, uses the existing file when its
 *                 SHA-256 equals tools/deps/prisma-engines.json, otherwise fetches and verifies it.
 *   3. prisma   – `node <prisma CLI> generate` (the CLI resolved from prisma/package.json and started with
 *                 process.execPath, no npm: PR9-SEC-15) with PRISMA_SCHEMA_ENGINE_BINARY=<verified engine>,
 *                 CHECKPOINT_DISABLE=1 and no NODE_OPTIONS, once a Prisma schema or prisma.config.ts exists.
 *   4. playwright – browsers, opt-in only: `--playwright=chromium[,firefox,webkit]` or
 *                 DEPS_REBUILD_PLAYWRIGHT=… (local e2e and lane C; never in images). Refused before any step when
 *                 the environment carries a download redirect (PLAYWRIGHT_DOWNLOAD_HOST or PLAYWRIGHT_<BROWSER>_
 *                 DOWNLOAD_HOST, any case; PR4-SEC-08). `--with-deps` (apt on Linux) is added on Linux only, and
 *                 the workflow policy confines browser installs to lane-c.yml.
 *
 * Network: the single origin this script itself may contact is https://binaries.prisma.sh/all_commits/
 * (`ENGINE_ORIGIN`, step 2, only when no verified engine is present). Prisma's own downloader and the
 * per-user Prisma cache are never used. Steps 1 and 4 run npm/Playwright, which use their registries.
 *
 * Nothing else is ever executed. `--dry-run` prints the plan as JSON and changes nothing.
 * `npm exec --no` (not `npx`) refuses to download a missing binary (SEC-P3-31). Steps with `runner: 'prisma'`
 * run `command` as Prisma CLI arguments (`prismaArgv`); every other command is npm arguments.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { npmCli } from './npm-cli.mjs';
import { ensureEngine, forbiddenEnv, prismaArgv, prismaChildEnv, reverifyEngine } from './prisma-engines.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLAYWRIGHT_BROWSERS = new Set(['chromium', 'firefox', 'webkit']);
/** Workspace whose dependency graph owns bcrypt; resolution runs from here. */
const BCRYPT_OWNER = join(ROOT, 'apps', 'api');

/**
 * @typedef {{
 *   id: 'bcrypt' | 'prisma-engines' | 'prisma' | 'playwright',
 *   action: 'run' | 'skip',
 *   reason: string,
 *   command?: string[],
 *   runner?: 'npm' | 'prisma',
 *   env?: string[],
 * }} Step
 */

/**
 * Runs a short CommonJS probe in a child Node process (cwd = the owning workspace) so that the
 * result reflects a fresh module load, not this process's cache.
 * @param {string} code
 */
function probe(code) {
  const r = spawnSync(process.execPath, ['-e', code], { cwd: BCRYPT_OWNER, encoding: 'utf8', windowsHide: true });
  return { ok: r.status === 0, detail: (r.stderr || r.stdout || '').trim().split('\n')[0] ?? '' };
}

const bcryptInstalled = () => probe("require.resolve('bcrypt')").ok;
const bcryptLoads = () => probe("const b=require('bcrypt');if(!b.compareSync('x',b.hashSync('x',4)))process.exit(2)");

/** @param {string[]} argv */
function parsePlaywright(argv) {
  const flag = argv.find((a) => a.startsWith('--playwright='));
  const raw = flag ? flag.slice('--playwright='.length) : (process.env['DEPS_REBUILD_PLAYWRIGHT'] ?? '');
  const browsers = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = browsers.filter((b) => !PLAYWRIGHT_BROWSERS.has(b));
  if (unknown.length) throw new Error(`Unknown Playwright browser(s): ${unknown.join(', ')}`);
  return browsers;
}

/** @param {string[]} argv @returns {Step[]} */
export function plan(argv) {
  /** @type {Step[]} */
  const steps = [];

  if (!bcryptInstalled()) {
    steps.push({ id: 'bcrypt', action: 'skip', reason: 'bcrypt is not installed in this tree' });
  } else {
    const load = bcryptLoads();
    steps.push(
      load.ok
        ? { id: 'bcrypt', action: 'skip', reason: 'bcrypt loads its N-API prebuild; no native build needed' }
        : {
            id: 'bcrypt',
            action: 'run',
            reason: `bcrypt does not load (${load.detail})`,
            command: ['rebuild', 'bcrypt', '--ignore-scripts=false'],
          },
    );
  }

  const hasSchema = existsSync(join(ROOT, 'prisma.config.ts')) || existsSync(join(ROOT, 'prisma', 'schema'));
  if (hasSchema) {
    steps.push({ id: 'prisma-engines', action: 'run', reason: 'pin and verify the schema engine (tools/deps/prisma-engines.json)' });
    steps.push({
      id: 'prisma',
      action: 'run',
      reason: 'Prisma schema present',
      runner: 'prisma',
      command: ['generate'],
      env: ['PRISMA_SCHEMA_ENGINE_BINARY', 'CHECKPOINT_DISABLE'],
    });
  } else {
    steps.push({ id: 'prisma-engines', action: 'skip', reason: 'no prisma.config.ts or prisma/schema yet' });
    steps.push({ id: 'prisma', action: 'skip', reason: 'no prisma.config.ts or prisma/schema yet' });
  }

  const browsers = parsePlaywright(argv);
  steps.push(
    browsers.length
      ? {
          id: 'playwright',
          action: 'run',
          reason: `browsers requested: ${browsers.join(', ')}`,
          command: ['exec', '--no', '--', 'playwright', 'install', ...(process.platform === 'linux' ? ['--with-deps'] : []), ...browsers],
        }
      : { id: 'playwright', action: 'skip', reason: 'not requested; pass --playwright=<browsers>' },
  );
  return steps;
}

/**
 * Playwright browser download redirects (PR4-SEC-08; PR46-SEC-02, code review PR #46 m3; the shape of
 * check-workflow-policy PLAYWRIGHT_HOST, any case). Playwright's getFromENV also reads `npm_config_<name>` (an `.npmrc`
 * key, which npm exports to `npm run` children) and `npm_package_config_<name>` (a `package.json` "config" key).
 */
export const PLAYWRIGHT_REDIRECT = /^(?:npm_config_|npm_package_config_)?playwright_(?:[a-z]+_)?download_host$/iu;

/**
 * Names of Playwright download-redirect variables set (non-empty) in `env` when the plan installs browsers.
 * @param {NodeJS.ProcessEnv} env
 * @param {readonly Step[]} steps
 * @returns {string[]}
 */
export function playwrightRedirects(env, steps) {
  if (!steps.some((step) => step.id === 'playwright' && step.action === 'run')) return [];
  return Object.keys(env)
    .filter((name) => PLAYWRIGHT_REDIRECT.test(name) && (env[name] ?? '') !== '')
    .sort();
}

/** @param {string[]} argv */
async function main(argv) {
  const steps = plan(argv);
  if (argv.includes('--dry-run')) {
    process.stdout.write(`${JSON.stringify(steps, null, 2)}\n`);
    return 0;
  }
  // ADR-0023 am. J item 2 (c): refuse before any step runs, and so before any network call.
  const inherited = forbiddenEnv(process.env);
  if (inherited.length > 0) {
    process.stderr.write(
      `[deps:rebuild] refusing to run: engine-redirecting variable(s) set in the environment: ${inherited.join(', ')}\n`,
    );
    return 1;
  }
  const redirects = playwrightRedirects(process.env, steps);
  if (redirects.length > 0) {
    process.stderr.write(
      `[deps:rebuild] refusing to run: Playwright download redirect(s) set in the environment: ${redirects.join(', ')} (PR4-SEC-08)\n`,
    );
    return 1;
  }
  const cli = npmCli();
  /** @type {Awaited<ReturnType<typeof ensureEngine>> | undefined} */
  let engine;
  for (const step of steps) {
    process.stdout.write(`[deps:rebuild] ${step.id}: ${step.action} (${step.reason})\n`);
    if (step.action !== 'run') continue;
    if (step.id === 'prisma-engines') {
      try {
        engine = await ensureEngine({ log: (line) => process.stdout.write(`${line}\n`) });
        process.stdout.write(`[deps:rebuild] prisma-engines: ${engine.path} verified (${engine.mode})\n`);
      } catch (error) {
        process.stderr.write(`[deps:rebuild] prisma-engines failed: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
      }
      continue;
    }
    if (!step.command) continue;
    if (step.id === 'prisma' && engine === undefined) {
      process.stderr.write('[deps:rebuild] prisma: no verified schema engine\n');
      return 1;
    }
    const env = step.id === 'prisma' && engine !== undefined ? prismaChildEnv(process.env, engine.path) : process.env;
    const argv = step.runner === 'prisma' ? prismaArgv(step.command, ROOT) : [cli, ...step.command];
    const r = spawnSync(process.execPath, argv, { cwd: ROOT, stdio: 'inherit', windowsHide: true, env });
    if (step.id === 'prisma' && engine !== undefined) {
      try {
        reverifyEngine(engine.path, engine.sha256);
      } catch (error) {
        process.stderr.write(`[deps:rebuild] ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
      }
    }
    if (r.status !== 0) {
      process.stderr.write(`[deps:rebuild] ${step.id} failed with exit code ${r.status}\n`);
      return 1;
    }
  }
  if (bcryptInstalled()) {
    const load = bcryptLoads();
    if (!load.ok) {
      process.stderr.write(`[deps:rebuild] bcrypt still does not load: ${load.detail}\n`);
      return 1;
    }
  }
  return 0;
}

// `import.meta.main` is Node's own "this file is the entry point" test (Node >= 24.2). It holds when the
// script is started through a symlink or junction, where comparing `process.argv[1]` with this module's
// real path would silently skip `main()` and exit 0 (PR #1 review m1). Fail closed on a Node without it.
if (typeof import.meta.main !== 'boolean') {
  throw new Error('deps:rebuild needs Node >= 24.2 (import.meta.main); see .node-version');
}
if (import.meta.main) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
