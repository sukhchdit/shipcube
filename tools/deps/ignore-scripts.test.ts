/**
 * SEC-TC-45 (local part), ADR-0023 amendment F, SEC-P3-04, R-ARCH-20.
 * Install-time code never runs on `npm ci`; the allow-listed `deps:rebuild` still yields a working
 * bcrypt. The CI, Dockerfile and quality:heavy halves of SEC-TC-45 land with TASK-007/011/014.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { listManifests } from '../repo/workspaces.js';
import { PRISMA_TREE_LOCK, withFileLock } from '../test-support/fs-lock.js';
import { findRepoRoot, runNode, runNpm } from '../test-support/process.js';

const repoRoot = findRepoRoot();
const rebuildScript = join(repoRoot, 'tools', 'deps', 'rebuild.mjs');
const fixtureDir = join(repoRoot, 'tools', 'deps', 'fixtures', 'postinstall-marker');
const MARKER = 'postinstall-marker.txt';

/** `.npmrc` as key/value pairs (comments and blank lines dropped). */
function readNpmrc(): Map<string, string> {
  const lines = readFileSync(join(repoRoot, '.npmrc'), 'utf8').split(/\r?\n/);
  const pairs = lines
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith(';'))
    .map((line): [string, string] => {
      const eq = line.indexOf('=');
      return [line.slice(0, eq).trim(), line.slice(eq + 1).trim()];
    });
  return new Map(pairs);
}

/** npm lifecycle hooks that run on install/publish, plus `pre<x>`/`post<x>` hooks of an existing script. */
const INSTALL_LIFECYCLE = new Set([
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'preprepare',
  'postprepare',
  'prepublish',
  'prepublishOnly',
  'prepack',
  'postpack',
  'dependencies',
]);
function lifecycleScripts(scripts: Record<string, string>): string[] {
  return Object.keys(scripts).filter((name) => {
    if (INSTALL_LIFECYCLE.has(name)) return true;
    const hooked = /^(pre|post)(.+)$/.exec(name)?.[2];
    return hooked !== undefined && hooked in scripts;
  });
}

describe('install scripts are disabled (SEC-TC-45, ADR-0023 am. F)', () => {
  it('[SEC-TC-45] .npmrc enforces ignore-scripts, engine-strict, save-exact, cooldown and quiet installs', () => {
    const npmrc = readNpmrc();
    expect(Object.fromEntries(npmrc)).toEqual(
      expect.objectContaining({
        'ignore-scripts': 'true',
        'engine-strict': 'true',
        'save-exact': 'true',
        fund: 'false',
        'update-notifier': 'false',
        'min-release-age': '7',
      }),
    );
  });

  it('[SEC-TC-45] .npmrc pins the @platform scope to an unresolvable registry (PR1-SEC-01)', () => {
    expect(readNpmrc().get('@platform:registry')).toBe('https://registry.invalid/');
  });

  it('[SEC-TC-45] lockfile entries for @platform/* are workspace links only, never registry downloads (PR1-SEC-01)', () => {
    type LockEntry = { link?: boolean; resolved?: string; version?: string };
    const lock = JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf8')) as { packages: Record<string, LockEntry> };
    const workspaceDirs = new Set(listManifests(repoRoot).map(({ dir }) => dir));
    const platformEntries = Object.entries(lock.packages).filter(([key]) => /(^|\/)node_modules\/@platform\//.test(key));
    expect(platformEntries.length).toBeGreaterThan(0);
    const offenders = platformEntries
      .filter(([, entry]) => entry.link !== true || entry.resolved === undefined || !workspaceDirs.has(entry.resolved))
      .map(([key, entry]) => `${key} -> ${entry.resolved ?? '(no resolved)'}`);
    expect(offenders).toEqual([]);
  });

  it('[SEC-TC-45] the lifecycle-hook detector flags hooks and ignores ordinary names (control)', () => {
    expect(lifecycleScripts({ postinstall: 'x', prebuild: 'x', build: 'x', prettier: 'x', 'pre-commit': 'x' })).toEqual([
      'postinstall',
      'prebuild',
    ]);
  });

  it('[SEC-TC-45] no workspace declares lifecycle-style scripts that ignore-scripts would silently skip', () => {
    const offenders = listManifests(repoRoot).flatMap(({ dir, manifest }) =>
      lifecycleScripts(manifest.scripts ?? {}).map((name) => `${dir}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  describe('fixture package with a marker-writing postinstall', () => {
    let work: string;
    let env: NodeJS.ProcessEnv;

    /** A project depending on the packed fixture, using the repository's committed .npmrc. */
    const project = (name: string): string => {
      const dir = join(work, name);
      mkdirSync(dir);
      copyFileSync(join(repoRoot, '.npmrc'), join(dir, '.npmrc'));
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          name,
          version: '0.0.0',
          private: true,
          dependencies: { 'postinstall-marker-fixture': 'file:../postinstall-marker-fixture-1.0.0.tgz' },
        }),
      );
      const lock = runNpm(['install', '--package-lock-only', '--no-audit'], { cwd: dir, env });
      expect(lock.status).toBe(0);
      return dir;
    };

    beforeAll(() => {
      work = mkdtempSync(join(tmpdir(), 'sec-tc-45-'));
      // Isolate the child npm from the caller's npm_config_* variables and user config, so only
      // the committed .npmrc decides whether scripts run.
      const userconfig = join(work, 'empty-userconfig');
      writeFileSync(userconfig, '');
      env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)));
      env['npm_config_userconfig'] = userconfig;
      const pack = runNpm(['pack', fixtureDir, '--pack-destination', work], { cwd: work, env });
      expect(pack.status).toBe(0);
    }, 120_000);

    afterAll(() => rmSync(work, { recursive: true, force: true }));

    it('[SEC-TC-45] npm ci with the committed .npmrc installs the package but leaves no marker', () => {
      const dir = project('ignored');
      const ci = runNpm(['ci', '--no-audit'], { cwd: dir, env });
      expect(ci.status).toBe(0);
      expect(existsSync(join(dir, 'node_modules', 'postinstall-marker-fixture', 'package.json'))).toBe(true);
      expect(existsSync(join(dir, MARKER))).toBe(false);
    }, 120_000);

    it('[SEC-TC-45] the same install with scripts enabled writes the marker (control)', () => {
      const dir = project('control');
      const ci = runNpm(['ci', '--no-audit', '--ignore-scripts=false'], { cwd: dir, env });
      expect(ci.status).toBe(0);
      expect(existsSync(join(dir, MARKER))).toBe(true);
    }, 120_000);
  });
});

/**
 * R2-n5: budget for the real `deps:rebuild` run in the unit lane. No per-test figure exists; the lane A `unit` job is
 * budgeted at 6 job-minutes in total (platform.md §7.2, level L1, including `npm ci` and `deps:rebuild`), and this
 * one test may use at most a tenth of it.
 */
const UNIT_REAL_RUN_BUDGET_MS = 36_000;

describe('deps:rebuild allow-list (ADR-0023 am. F, R-ARCH-20)', () => {
  type Step = { id: string; action: 'run' | 'skip'; reason: string; command?: string[]; env?: string[] };
  const dryRun = (...args: string[]) => {
    const result = runNode([rebuildScript, '--dry-run', ...args], { cwd: repoRoot });
    return { ...result, steps: result.status === 0 ? (JSON.parse(result.stdout) as Step[]) : [] };
  };

  /** Environment without an inherited Playwright opt-in, so the real run only does what the tree needs. */
  const rebuildEnv = (): NodeJS.ProcessEnv =>
    Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'DEPS_REBUILD_PLAYWRIGHT'));
  const hasPrismaSchema = () => existsSync(join(repoRoot, 'prisma.config.ts')) || existsSync(join(repoRoot, 'prisma', 'schema'));

  it('[SEC-TC-45] deps:rebuild runs end to end: every allow-listed step reports, then exits 0', async () => {
    // Positive control for main(): the step loop, the exit-code propagation and the final bcrypt check. On this
    // tree it builds nothing (bcrypt's N-API prebuild loads; Playwright is opt-in); the engine step runs in offline
    // mode against the engine verified by the preceding `npm run deps:rebuild`, and `prisma generate` regenerates
    // the client. R2-n5: the duration is asserted against UNIT_REAL_RUN_BUDGET_MS. The engine fetch from an empty
    // directory (network) is the integration test tools/deps/prisma-engines.int.test.ts.
    const started = Date.now();
    const result = await withFileLock(PRISMA_TREE_LOCK, () => runNode([rebuildScript], { cwd: repoRoot, env: rebuildEnv() }));
    const elapsed = Date.now() - started;
    expect(result.status).toBe(0);
    const reported = result.stdout.split(/\r?\n/).filter((line) => /^\[deps:rebuild\] [\w-]+: (run|skip) /.test(line));
    expect(reported.map((line) => /^\[deps:rebuild\] ([\w-]+): (run|skip) /.exec(line)?.slice(1, 3))).toEqual([
      ['bcrypt', 'skip'],
      ['prisma-engines', hasPrismaSchema() ? 'run' : 'skip'],
      ['prisma', hasPrismaSchema() ? 'run' : 'skip'],
      ['playwright', 'skip'],
    ]);
    if (hasPrismaSchema()) {
      expect(result.stdout).toMatch(/\[deps:rebuild\] prisma-engines: .*schema-engine-[\w.-]+ verified \(cached\)/);
      expect(result.stdout).toContain('Generated Prisma Client');
    }
    expect(elapsed).toBeLessThan(UNIT_REAL_RUN_BUDGET_MS);
  }, 120_000);

  it('[SEC-TC-45] deps:rebuild still runs when started through a directory junction or symlink (m1)', () => {
    // The old entry guard compared process.argv[1] with the real module path, so a linked path made
    // the script skip main() and exit 0 with no output: a false green on the install path.
    const linkRoot = mkdtempSync(join(tmpdir(), 'deps-rebuild-link-'));
    try {
      const linkedDir = join(linkRoot, 'deps');
      symlinkSync(join(repoRoot, 'tools', 'deps'), linkedDir, 'junction');
      const result = runNode([join(linkedDir, 'rebuild.mjs'), '--dry-run'], { cwd: repoRoot, env: rebuildEnv() });
      expect(result.status).toBe(0);
      const steps = JSON.parse(result.stdout) as Step[];
      expect(steps.map((s) => s.id)).toEqual(['bcrypt', 'prisma-engines', 'prisma', 'playwright']);
    } finally {
      rmSync(linkRoot, { recursive: true, force: true });
    }
  });

  it('[SEC-TC-45] bcrypt works in the installed tree after deps:rebuild', () => {
    const requireFromApi = createRequire(join(repoRoot, 'apps', 'api', 'package.json'));
    const bcrypt = requireFromApi('bcrypt') as {
      hashSync(data: string, rounds: number): string;
      compareSync(data: string, hash: string): boolean;
    };
    const hash = bcrypt.hashSync('correct horse', 4);
    expect(hash).toMatch(/^\$2[aby]\$04\$/);
    expect(bcrypt.compareSync('correct horse', hash)).toBe(true);
    expect(bcrypt.compareSync('wrong horse', hash)).toBe(false);
  });

  it('[SEC-TC-45] plans only allow-listed steps, runs them through `npm exec --no`, and needs no bcrypt build', () => {
    const { status, steps } = dryRun();
    expect(status).toBe(0);
    expect(steps.map((s) => s.id)).toEqual(['bcrypt', 'prisma-engines', 'prisma', 'playwright']);
    expect(steps.find((s) => s.id === 'bcrypt')?.action).toBe('skip');
    expect(steps.find((s) => s.id === 'playwright')?.action).toBe('skip');
    const prisma = steps.find((s) => s.id === 'prisma');
    expect(prisma?.action).toBe(hasPrismaSchema() ? 'run' : 'skip');
    expect(steps.find((s) => s.id === 'prisma-engines')?.action).toBe(prisma?.action);
    if (prisma?.command) {
      expect(prisma.command).toEqual(['exec', '--no', '--', 'prisma', 'generate']);
      expect(prisma.env).toEqual(['PRISMA_SCHEMA_ENGINE_BINARY', 'CHECKPOINT_DISABLE']);
    }
  });

  it('[SEC-TC-45] installs Playwright browsers only on request and only known engines', () => {
    const requested = dryRun('--playwright=chromium').steps.find((s) => s.id === 'playwright');
    expect(requested?.action).toBe('run');
    expect(requested?.command?.slice(0, 5)).toEqual(['exec', '--no', '--', 'playwright', 'install']);
    expect(requested?.command?.at(-1)).toBe('chromium');
    const bogus = dryRun('--playwright=chromium,netscape');
    expect(bogus.status).not.toBe(0);
    expect(bogus.stderr).toContain('netscape');
  });
});
