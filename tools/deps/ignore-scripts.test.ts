/**
 * SEC-TC-45 (local part), ADR-0023 amendment F, SEC-P3-04, R-ARCH-20.
 * Install-time code never runs on `npm ci`; the allow-listed `deps:rebuild` still yields a working
 * bcrypt. The CI, Dockerfile and quality:heavy halves of SEC-TC-45 land with TASK-007/011/014.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { listManifests } from '../repo/workspaces.js';
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

describe('deps:rebuild allow-list (ADR-0023 am. F, R-ARCH-20)', () => {
  type Step = { id: string; action: 'run' | 'skip'; reason: string; command?: string[] };
  const dryRun = (...args: string[]) => {
    const result = runNode([rebuildScript, '--dry-run', ...args], { cwd: repoRoot });
    return { ...result, steps: result.status === 0 ? (JSON.parse(result.stdout) as Step[]) : [] };
  };

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
    expect(steps.map((s) => s.id)).toEqual(['bcrypt', 'prisma', 'playwright']);
    expect(steps.find((s) => s.id === 'bcrypt')?.action).toBe('skip');
    expect(steps.find((s) => s.id === 'playwright')?.action).toBe('skip');
    const prisma = steps.find((s) => s.id === 'prisma');
    const hasSchema = existsSync(join(repoRoot, 'prisma.config.ts')) || existsSync(join(repoRoot, 'prisma', 'schema'));
    expect(prisma?.action).toBe(hasSchema ? 'run' : 'skip');
    if (prisma?.command) expect(prisma.command.slice(0, 3)).toEqual(['exec', '--no', '--']);
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
