/**
 * Lane B heavy run (TASK-011; ADR-0023 am. B, C, G items 1-3, I item 4; TEST-STRATEGY sections 4, 9; R-ARCH-16,
 * R-ARCH-21, D-ARCH-021). Pure planning/verdict functions are tested directly; the CLI runs end to end inside
 * throw-away git repositories whose only suite is a `kind: command` runner that writes a tiny JUnit file.
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import {
  buildCleanFrom,
  computeVerdict,
  expandCommand,
  isAllowedRunFile,
  jestArgs,
  parseArgs,
  parseRunners,
  planRun,
  relativiseCoverage,
  renderSummaryMd,
  summaryValidator,
} from './heavy.mjs';
import { digestFromRef, envOverrides, parseNpmVersion, parsePorcelainZ, utcStamp } from './lib/host.mjs';
import { parseManifest } from './lib/manifest.mjs';

const repoRoot = findRepoRoot();
const heavy = join(repoRoot, 'tools', 'quality', 'heavy.mjs');
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const PINNED = `postgres:18@sha256:${'ab'.repeat(32)}`;

function manifestJson(status: 'active' | 'planned' = 'active') {
  return {
    manifest_version: 1,
    rules: {
      invalid_env_prefixes: ['SKIP_'],
      recorded_env_prefixes: ['SKIP_', 'TEST_'],
      clean_tree_paths: [
        'apps/**',
        'packages/**',
        'prisma/**',
        'tools/**',
        'tests/**',
        '*.config.*',
        '.env*',
        '!.env.example',
        'compose*.yaml',
        'package*.json',
        '.npmrc',
      ],
    },
    tooling_inputs: [],
    suites: {
      fake: { lane: ['B'], status, security: true, zero_skip: true, min_tests: 2, required_cases: ['SEC-TC-48'] },
      later: { lane: ['B'], status: 'planned', security: false, zero_skip: false, min_tests: 1, required_cases: [] },
    },
    profiles: { pr: { always: ['fake'] }, wave: { always: ['fake', 'later'] }, gate: { always: ['fake', 'later'] } },
    path_rules: [{ id: 'docs', globs: ['docs/**'], profile_min: 'none', suites: [] }],
  };
}
const manifest = parseManifest(manifestJson());

type Result = Parameters<typeof computeVerdict>[0]['results'][number];
function result(over: Partial<Result> = {}): Result {
  return {
    id: 'fake',
    root: 'tests',
    cases: [
      { name: '[SEC-TC-48] verdict recomputed', status: 'passed' },
      { name: 'second', status: 'passed' },
    ],
    tests: 2,
    failures: 0,
    errors: 0,
    skipped: 0,
    durationS: 1,
    junit: '',
    native: null,
    jestArgs: [],
    ...over,
  };
}
const base = {
  manifest,
  required: ['fake'],
  results: [result()],
  gitDirtyPaths: [],
  buildClean: true,
  buildFailed: false,
  invalidEnv: [],
  restricted: null,
};

describe('argument parsing and planning (TASK-011)', () => {
  it('[R-ARCH-16] requires a profile and validates numbers and suite lists', () => {
    expect(parseArgs(['--profile', 'pr'])).toMatchObject({
      profile: 'pr',
      base: 'origin/main',
      suites: null,
      dryRun: false,
      testTimeoutMs: 30_000,
      suiteTimeoutMin: 45,
    });
    expect(parseArgs(['--profile=gate', '--suites', 'unit,api', '--test-timeout', '60000', '--dry-run'])).toMatchObject({
      profile: 'gate',
      suites: ['unit', 'api'],
      testTimeoutMs: 60_000,
      dryRun: true,
    });
    expect(() => parseArgs([])).toThrow(/--profile/);
    expect(() => parseArgs(['--profile', 'nightly'])).toThrow(/--profile/);
    expect(() => parseArgs(['--profile', 'pr', '--suites', '../x'])).toThrow(/--suites/);
    expect(() => parseArgs(['--profile', 'pr', '--suite-timeout-min', '0'])).toThrow(/1\.\.600/);
    expect(() => parseArgs(['--profile', 'pr', '--force'])).toThrow(/unknown argument/);
  });

  it('[R-ARCH-16] runs only active suites; planned ones are listed, an active suite without a runner is planned as "no runner"', () => {
    const plan = planRun({
      manifest,
      runners: { testcontainers_images: [], suites: {} },
      profile: 'wave',
      changedPaths: [],
      restrict: null,
    });
    expect(plan).toMatchObject({ required: ['fake'], planned: ['later'], restricted: false });
    expect(plan.toRun).toEqual([{ id: 'fake', runner: null, root: 'tests' }]);
  });

  it('[R-ARCH-16] --suites may only name active manifest suites', () => {
    const runners = { testcontainers_images: [], suites: {} };
    expect(() => planRun({ manifest, runners, profile: 'pr', changedPaths: [], restrict: ['nope'] })).toThrow(/not in the manifest/);
    expect(() => planRun({ manifest, runners, profile: 'pr', changedPaths: [], restrict: ['later'] })).toThrow(/not active/);
    expect(planRun({ manifest, runners, profile: 'pr', changedPaths: ['apps/api/x.ts'], restrict: ['fake'] }).restricted).toBe(true);
  });

  it('[R-ARCH-16] Jest suites: paths before --selectProjects; integration and api in band with the raised test timeout', () => {
    const integration = jestArgs(
      { kind: 'jest', projects: ['integration'], paths: ['prisma/tests/catalog/'], coverage: false },
      { testTimeoutMs: 30_000, outputFile: 'o.json', coverageDir: 'c' },
    );
    expect(integration.indexOf('prisma/tests/catalog/')).toBeLessThan(integration.indexOf('--selectProjects'));
    expect(integration.slice(-2)).toEqual(['-i', '--testTimeout=30000']);
    const unit = jestArgs(
      { kind: 'jest', projects: ['unit', 'unit-dom'], paths: [], coverage: true },
      { testTimeoutMs: 30_000, outputFile: 'o.json', coverageDir: 'c' },
    );
    expect(unit).not.toContain('-i');
    // npm run test:unit selects unit + unit-dom (TASK-004): the heavy unit suite runs both in one Jest run.
    expect(unit.slice(unit.indexOf('--selectProjects'), unit.indexOf('--selectProjects') + 3)).toEqual([
      '--selectProjects',
      'unit',
      'unit-dom',
    ]);
    expect(unit).toEqual(expect.arrayContaining(['--coverage', '--coverageReporters=json-summary', '--coverageDirectory=c']));
  });

  it('[R-ARCH-16] suite-runners.json is validated and command placeholders expand without a shell', () => {
    expect(() => parseRunners({ version: 1, suites: { x: { kind: 'shell' } } })).toThrow(/kind/);
    expect(() => parseRunners({ version: 1, suites: { x: { kind: 'jest', project: [] } } })).toThrow(/project/);
    expect(() => parseRunners({ version: 1, suites: { x: { kind: 'jest', project: ['unit', 'evil'] } } })).toThrow(/project/);
    expect(parseRunners({ version: 1, suites: { x: { kind: 'jest', project: 'unit' } } }).suites['x']).toMatchObject({
      projects: ['unit'],
    });
    expect(() => parseRunners({ version: 1, suites: { x: { kind: 'jest', project: 'unit', paths: ['--config=evil.js'] } } })).toThrow(
      /paths/,
    );
    expect(() => parseRunners({ version: 1, suites: { x: { kind: 'command', cmd: ['k6'], converter: 'k6' } } })).toThrow(/native_report/);
    const parsed = parseRunners({
      version: 1,
      suites: { trivy: { kind: 'command', cmd: ['trivy'], converter: 'trivy', native_report: 'trivy-api.json' } },
    });
    expect(parsed.suites['trivy']).toMatchObject({ evidence_root: 'security' });
    expect(
      expandCommand(['{npm}', 'exec', '--no', '--', 'k6', '--out={native}'], {
        node: 'n',
        npm: ['n', 'cli'],
        root: 'r',
        junit: 'j',
        native: 'x.json',
      }),
    ).toEqual(['n', 'cli', 'exec', '--no', '--', 'k6', '--out=x.json']);
  });
});

describe('verdict (TEST-STRATEGY 9.2; ADR-0023 am. G, I item 4)', () => {
  it('[R-ARCH-16] PASS only when clean, build clean, no SKIP_, every required suite present, enough tests, no failures', () => {
    expect(computeVerdict(base)).toEqual({ verdict: 'PASS', invalidReasons: [], failReasons: [] });
  });

  it('[R-ARCH-16] integrity problems are INVALID: dirty tree, restricted run, nothing selected', () => {
    expect(computeVerdict({ ...base, gitDirtyPaths: ['apps/api/x.ts'] }).invalidReasons[0]).toMatch(/dirty tree.*apps\/api\/x\.ts/);
    expect(computeVerdict({ ...base, restricted: ['fake'] }).verdict).toBe('INVALID');
    expect(computeVerdict({ ...base, required: [], results: [] }).invalidReasons).toEqual([expect.stringMatching(/nothing was verified/)]);
  });

  it('[R-ARCH-21] a build that changed the tree (build_clean false) is INVALID', () => {
    const { verdict, invalidReasons } = computeVerdict({ ...base, buildClean: false });
    expect(verdict).toBe('INVALID');
    expect(invalidReasons[0]).toMatch(/build_clean false/);
    expect(buildCleanFrom([{ status: '??', path: 'docs/a.md' }], [{ status: '??', path: 'docs/a.md' }])).toBe(true);
    expect(buildCleanFrom([], [{ status: ' M', path: 'package.json' }])).toBe(false);
    expect(buildCleanFrom([{ status: ' M', path: 'docs/a.md' }], [{ status: 'MM', path: 'docs/a.md' }])).toBe(false);
  });

  it('[D-ARCH-021] a SKIP_ variable is INVALID and only its NAME is recorded', () => {
    const value = randomBytes(12).toString('hex');
    const env = envOverrides({ SKIP_DB: value, TEST_SEED: value, test_lower: value, PATH: value }, ['SKIP_', 'TEST_'], ['SKIP_']);
    expect(env).toEqual({ names: ['SKIP_DB', 'TEST_LOWER', 'TEST_SEED'], invalid: ['SKIP_DB'] });
    expect(JSON.stringify(env)).not.toContain(value);
    const { verdict, invalidReasons } = computeVerdict({ ...base, invalidEnv: env.invalid });
    expect(verdict).toBe('INVALID');
    expect(invalidReasons.join(' ')).toContain('SKIP_DB');
    expect(invalidReasons.join(' ')).not.toContain(value);
  });

  it('[R-ARCH-16] test failures are FAIL: failures, too few tests, skips in a zero-skip suite, missing required case, missing suite', () => {
    const fail = (over: Partial<Result>) => computeVerdict({ ...base, results: [result(over)] });
    expect(fail({ failures: 1 }).verdict).toBe('FAIL');
    expect(fail({ tests: 1 }).failReasons).toEqual([expect.stringMatching(/min_tests 2/)]);
    expect(fail({ skipped: 1 }).failReasons).toEqual([expect.stringMatching(/zero-skip/)]);
    expect(fail({ cases: [{ name: '[SEC-TC-480] other', status: 'passed' }] }).failReasons).toEqual([
      expect.stringMatching(/SEC-TC-48 has no passing/),
    ]);
    expect(fail({ cases: [...result().cases, { name: '[SEC-TC-99] skipped', status: 'skipped' }] }).failReasons).toEqual([
      expect.stringMatching(/security case not passing/),
    ]);
    expect(computeVerdict({ ...base, results: [] }).failReasons).toEqual(['fake: required suite missing']);
  });

  it('[R-ARCH-16] summary.md first line is the ADR-0023 am. B contract and planned suites are listed', () => {
    const md = renderSummaryMd(
      { git_sha: 'a'.repeat(40), stamp: '20261113T0930Z', profile: 'wave', verdict: 'FAIL', invalid_reasons: [], suites: [] },
      { planned: ['later'], rules: [], failReasons: ['fake: 1 failure(s), 0 error(s)'], restricted: null, siblings: [] },
    );
    expect(md.split('\n')[0]).toBe('sha aaaaaaa · 20261113T0930Z · profile wave · verdict FAIL');
    expect(md).toContain('Skipped by manifest (status planned, never reported as JUnit): later');
  });
});

describe('evidence content rules (ADR-0023 am. B; TEST-STRATEGY 9.1)', () => {
  it('[R-ARCH-16] file-name allow-list per evidence root', () => {
    const ids = ['unit', 'trivy'];
    expect(isAllowedRunFile('unit.junit.xml', 'tests', ids)).toBe(true);
    expect(isAllowedRunFile('coverage-summary.json', 'tests', ids)).toBe(true);
    expect(isAllowedRunFile('trivy-api.json', 'security', ids)).toBe(true);
    expect(isAllowedRunFile('k6-smoke.summary.json', 'performance', ids)).toBe(true);
    expect(isAllowedRunFile('lighthouse/home-en.json', 'performance', ids)).toBe(true);
    expect(isAllowedRunFile('fastlane.json', 'tests', ids)).toBe(false); // degraded-mode record lives in tests/fastlane/
    expect(isAllowedRunFile('k6-smoke_x.summary.json', 'performance', ids)).toBe(false);
    for (const bad of ['other.junit.xml', 'lcov.info', 'report.html', 'trace.zip', 'screenshot.png', 'trivy-api.json', '../summary.json'])
      expect(isAllowedRunFile(bad, 'tests', ids)).toBe(false);
  });

  it('[R-ARCH-16] coverage summary keys become repository-relative with a per-package roll-up', () => {
    const m = (covered: number, total: number) => ({ covered, total, pct: total === 0 ? 100 : (covered / total) * 100, skipped: 0 });
    const rel = relativiseCoverage(
      {
        total: { lines: m(9, 10), branches: m(3, 4) },
        'C:\\host\\repo\\packages\\pricing\\src\\a.ts': { lines: m(4, 5), branches: m(1, 2) },
        'C:\\host\\repo\\packages\\pricing\\src\\b.ts': { lines: m(5, 5), branches: m(2, 2) },
      },
      'C:\\host\\repo',
    );
    expect(Object.keys(rel?.file ?? {})).toEqual(['total', 'packages/pricing/src/a.ts', 'packages/pricing/src/b.ts']);
    expect(rel?.coverage).toEqual({ line: 90, branch: 75, per_package: { 'packages/pricing': { line: 90, branch: 75 } } });
  });

  it('[R-ARCH-16] host helpers: UTC stamp, pinned digest, porcelain -z with renames, npm user agent', () => {
    expect(utcStamp(new Date('2026-11-13T09:05:59.999Z'))).toBe('20261113T0905Z');
    expect(digestFromRef(PINNED)).toBe(`sha256:${'ab'.repeat(32)}`);
    expect(digestFromRef('postgres:18')).toBeNull();
    expect(parsePorcelainZ('R  new.ts\0old.ts\0?? apps/x.ts\0')).toEqual([
      { status: 'R ', path: 'new.ts' },
      { status: 'R ', path: 'old.ts' },
      { status: '??', path: 'apps/x.ts' },
    ]);
    expect(parseNpmVersion('npm/11.19.1 node/v24.22.3 win32 x64 workspaces/false')).toBe('11.19.1');
    expect(parseNpmVersion(undefined)).toBeNull();
  });
});

// --- CLI end to end -------------------------------------------------------------------------------------------------

function git(cwd: string, args: string[]): void {
  const r = spawnSync(
    'git',
    ['-c', 'core.autocrlf=false', '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

/** A throw-away repository with a manifest, a runner file and a build script (dirty = the build writes a file). */
function fixtureRepo(options: { dirtyBuild: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), 'heavy-e2e-'));
  temps.push(dir);
  const write = (rel: string, content: string) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  write('package.json', JSON.stringify({ name: 'heavy-fixture', private: true, scripts: { build: 'node build.mjs' } }));
  write(
    'package-lock.json',
    JSON.stringify({ name: 'heavy-fixture', lockfileVersion: 3, requires: true, packages: { '': { name: 'heavy-fixture' } } }),
  );
  write(
    'build.mjs',
    options.dirtyBuild
      ? "import { writeFileSync } from 'node:fs';\nwriteFileSync('packages-generated.config.json', '{}');\n"
      : 'export {};\n',
  );
  write('tools/quality/required-suites.json', JSON.stringify(manifestJson()));
  const junit = '<testsuite name="fake" tests="2"><testcase name="[SEC-TC-48] verdict recomputed"/><testcase name="second"/></testsuite>';
  write(
    'tools/quality/suite-runners.json',
    JSON.stringify({
      version: 1,
      testcontainers_images: [PINNED],
      suites: {
        fake: {
          kind: 'command',
          cmd: ['{node}', '-e', `require('fs').writeFileSync(process.argv[1], ${JSON.stringify(junit)})`, '{junit}'],
          converter: 'junit',
        },
      },
    }),
  );
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'fixture']);
  return dir;
}

/** Environment of the CLI under test: the caller's, without any SKIP_/TEST_ name, plus `extra`. */
function cliEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^(SKIP_|TEST_)/i.test(key)) env[key] = value;
  return { ...env, ...extra };
}

function readRun(outBase: string) {
  const runs = join(outBase, 'tests', 'runs');
  const [dirName] = readdirSync(runs);
  const dir = join(runs, String(dirName));
  return {
    dirName: String(dirName),
    files: readdirSync(dir).sort(),
    summaryText: readFileSync(join(dir, 'summary.json'), 'utf8'),
    summary: JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')) as Record<string, unknown>,
    md: readFileSync(join(dir, 'summary.md'), 'utf8'),
  };
}

describe('quality:heavy CLI end to end (temp git repository, fake command suite)', () => {
  it('[R-ARCH-16] [R-ARCH-21] a clean run is PASS with a schema-valid summary recording build_clean, node, lockfile SHA-256, image digests and host spec', () => {
    const dir = fixtureRepo({ dirtyBuild: false });
    const run = runNode([heavy, '--profile', 'wave'], { cwd: dir, env: cliEnv(), timeoutMs: 180_000 });
    expect(run.status).toBe(0);
    const { dirName, files, summary, md } = readRun(join(dir, 'docs', '05-quality'));
    expect(dirName).toMatch(/^\d{8}T\d{4}Z_[0-9a-f]{7}$/);
    expect(files).toEqual(['fake.junit.xml', 'summary.json', 'summary.md']);
    const validate = summaryValidator();
    expect(validate(summary)).toBe(true);
    expect(summary).toMatchObject({
      verdict: 'PASS',
      git_dirty: false,
      build_clean: true,
      profile: 'wave',
      env_overrides: [],
      testcontainers_images: [{ image: PINNED, digest: `sha256:${'ab'.repeat(32)}` }],
      host: { node_version: process.version, cores: expect.any(Number), ram_gb: expect.any(Number) },
      suites: [{ name: 'fake', status: 'passed', tests: 2, failures: 0, errors: 0, skipped: 0, report: 'fake.junit.xml' }],
    });
    const lock = readFileSync(join(dir, 'package-lock.json'));
    expect(summary['lockfile_sha256']).toBe(createHash('sha256').update(lock).digest('hex'));
    expect(md.split('\n')[0]).toBe(`sha ${dirName.slice(-7)} · ${dirName.slice(0, 14)} · profile wave · verdict PASS`);
    expect(md).toContain('Skipped by manifest (status planned, never reported as JUnit): later');
  });

  it('[R-ARCH-21] a build that leaves a file behind yields build_clean false and INVALID (exit 1)', () => {
    const dir = fixtureRepo({ dirtyBuild: true });
    const run = runNode([heavy, '--profile', 'wave'], { cwd: dir, env: cliEnv(), timeoutMs: 180_000 });
    expect(run.status).toBe(1);
    const { summary } = readRun(join(dir, 'docs', '05-quality'));
    expect(summary).toMatchObject({ verdict: 'INVALID', build_clean: false });
    expect((summary['invalid_reasons'] as string[]).join(' ')).toMatch(/build_clean false/);
  });

  it('[D-ARCH-021] a SKIP_ variable yields INVALID and only its NAME is recorded', () => {
    const dir = fixtureRepo({ dirtyBuild: false });
    const value = randomBytes(12).toString('hex');
    const out = join(dir, 'out');
    const run = runNode([heavy, '--profile', 'wave', '--out-root', out], {
      cwd: dir,
      env: cliEnv({ SKIP_INTEGRATION: value }),
      timeoutMs: 180_000,
    });
    expect(run.status).toBe(1);
    expect(run.stdout + run.stderr).not.toContain(value);
    const { summary, summaryText, md } = readRun(out);
    expect(summary).toMatchObject({ verdict: 'INVALID', env_overrides: ['SKIP_INTEGRATION'] });
    expect(summaryText).not.toContain(value);
    expect(md).not.toContain(value);
  });
});
