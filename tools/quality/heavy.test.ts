/**
 * Lane B heavy run (TASK-011; ADR-0023 am. B, C, G items 1-3, I item 4; TEST-STRATEGY sections 4, 9; R-ARCH-16,
 * R-ARCH-21, D-ARCH-021). Pure planning/verdict functions are tested directly; the CLI runs end to end inside
 * throw-away git repositories whose only suite is a `kind: command` runner that writes a tiny JUnit file.
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import {
  buildCleanFrom,
  computeVerdict,
  coverageFrom,
  coverageSourceFrom,
  diffCoverageCases,
  expandCommand,
  isAllowedRunFile,
  jestArgs,
  jestCasesFrom,
  mergedCoverageNote,
  mergedCoverageStep,
  parseArgs,
  parseRunners,
  planRun,
  relativiseCoverage,
  renderSummaryMd,
  resolveOutBase,
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

describe('Jest report reading and the evidence location (PR #23 R1-n1, R1-n5)', () => {
  const scratch = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'heavy-report-'));
    temps.push(dir);
    return dir;
  };

  it('[R1-n1] a missing, truncated or empty Jest report becomes one error case instead of a crash', () => {
    const dir = scratch();
    const options = { root: dir, scrub: [] };
    const expected = [expect.objectContaining({ status: 'error', classname: 'jest' })];
    expect(jestCasesFrom(join(dir, 'absent.json'), options)).toEqual(expected);
    writeFileSync(join(dir, 'truncated.json'), '{"numTotalTests": 3, "testResults": [{"name": "x"');
    writeFileSync(join(dir, 'empty.json'), '');
    expect(jestCasesFrom(join(dir, 'truncated.json'), options)).toEqual(expected);
    expect(jestCasesFrom(join(dir, 'empty.json'), options)).toEqual(expected);
    expect(jestCasesFrom(join(dir, 'truncated.json'), options)[0]?.message).toMatch(
      /malformed jest report: Jest JSON report is not readable/,
    );
  });

  it('[R1-n1] an unreadable coverage summary is null, a readable one is returned', () => {
    const dir = scratch();
    expect(coverageFrom(join(dir, 'absent.json'))).toBeNull();
    writeFileSync(join(dir, 'bad.json'), '{"total":');
    expect(coverageFrom(join(dir, 'bad.json'))).toBeNull();
    writeFileSync(join(dir, 'good.json'), '{"total":{}}');
    expect(coverageFrom(join(dir, 'good.json'))).toEqual({ total: {} });
  });

  it('[R1-n5] a restricted (--suites) run defaults to a temp directory outside the repository; --out-root and normal runs do not', () => {
    const dir = scratch();
    const restricted = resolveOutBase({ outRoot: null, suites: ['unit'] }, dir);
    temps.push(restricted);
    expect(isAbsolute(restricted)).toBe(true);
    expect(relative(dir, restricted).startsWith('..')).toBe(true);
    expect(resolveOutBase({ outRoot: null, suites: null }, dir)).toBe(join(dir, 'docs', '05-quality'));
    expect(resolveOutBase({ outRoot: join(dir, 'out'), suites: ['unit'] }, dir)).toBe(join(dir, 'out'));
  });
});

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
      runners: { testcontainers_images: [], suites: {}, mergedCoverage: null },
      profile: 'wave',
      changedPaths: [],
      restrict: null,
    });
    expect(plan).toMatchObject({ required: ['fake'], planned: ['later'], restricted: false });
    expect(plan.toRun).toEqual([{ id: 'fake', runner: null, root: 'tests' }]);
  });

  it('[R-ARCH-16] --suites may only name active manifest suites', () => {
    const runners = { testcontainers_images: [], suites: {}, mergedCoverage: null };
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
    // The generated project (TASK-276): selectable by a runner and in band like integration and api.
    expect(parseRunners({ version: 1, suites: { g: { kind: 'jest', project: 'generated' } } }).suites['g']).toMatchObject({
      projects: ['generated'],
    });
    const generated = jestArgs(
      { kind: 'jest', projects: ['generated'], paths: ['tests/generated/'], coverage: false },
      { testTimeoutMs: 45_000, outputFile: 'o.json', coverageDir: 'c' },
    );
    expect(generated.slice(-2)).toEqual(['-i', '--testTimeout=45000']);
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
    // Coverage runs write istanbul JSON for the merged gate; Jest's own global threshold is off per partial run (D-ORCH-047).
    expect(unit).toEqual(
      expect.arrayContaining(['--coverage', '--coverageReporters=json', '--coverageThreshold={}', '--coverageDirectory=c']),
    );
    expect(unit).not.toContain('--coverageReporters=json-summary');
  });

  it('[US-006] [PR33-SEC-06] coverage runners: whole projects only, and never without a merged_coverage host suite', () => {
    const unit = { kind: 'jest', project: ['unit', 'unit-dom'], coverage: true };
    const merged = { suite: 'unit', projects: ['unit', 'unit-dom'] };
    expect(parseRunners({ version: 1, merged_coverage: merged, suites: { unit } }).mergedCoverage).toEqual({
      suite: 'unit',
      projects: ['unit', 'unit-dom'],
      projectsIfSuites: [],
    });
    expect(() => parseRunners({ version: 1, suites: { unit } })).toThrow(/need merged_coverage/);
    expect(() =>
      parseRunners({
        version: 1,
        merged_coverage: merged,
        suites: { unit, i: { kind: 'jest', project: 'integration', paths: ['prisma/'], coverage: true } },
      }),
    ).toThrow(/whole projects/);
    expect(() =>
      parseRunners({
        version: 1,
        merged_coverage: merged,
        suites: { unit, i: { kind: 'jest', project: 'integration', testNamePattern: 'x', coverage: true } },
      }),
    ).toThrow(/whole projects/);
    expect(() => parseRunners({ version: 1, merged_coverage: { ...merged, suite: 'nope' }, suites: { unit } })).toThrow(
      /merged_coverage.suite nope/,
    );
    expect(() =>
      parseRunners({
        version: 1,
        merged_coverage: { ...merged, suite: 'i' },
        suites: { unit, i: { kind: 'jest', project: 'integration' } },
      }),
    ).toThrow(/coverage: true/);
    expect(parseRunners({ version: 1, suites: {} }).mergedCoverage).toBeNull();
  });

  it('[US-006] the repository runner file parses with the merged gate on the unit suite', () => {
    const runners = parseRunners(JSON.parse(readFileSync(join(repoRoot, 'tools', 'quality', 'suite-runners.json'), 'utf8')));
    expect(runners.mergedCoverage?.suite).toBe('unit');
    expect(runners.suites['unit']).toMatchObject({ kind: 'jest', coverage: true, paths: [] });
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

describe('merged coverage step (US-006; D-ORCH-047; PR #33 R1-m4, PR33-SEC-06)', () => {
  /** A temp root where the three required critical packages exist with only index.ts (inactive in the gate). */
  const gateRoot = () => {
    const dir = mkdtempSync(join(tmpdir(), 'heavy-merge-'));
    temps.push(dir);
    for (const pkg of ['pricing', 'audit', 'authz']) {
      mkdirSync(join(dir, 'packages', pkg, 'src'), { recursive: true });
      writeFileSync(join(dir, 'packages', pkg, 'src', 'index.ts'), 'export {};\n');
    }
    return dir;
  };
  /** One file with 10 lines (`covered` lines hit), as one coverage source of `projects`. */
  const source = (root: string, projects: string[], covered: number[]) => {
    const path = join(root, 'packages', 'x', 'src', 'a.ts');
    const fc = {
      path,
      statementMap: {} as Record<string, unknown>,
      s: {} as Record<string, number>,
      fnMap: {},
      f: {},
      branchMap: {},
      b: {},
    };
    for (let i = 0; i < 10; i += 1) {
      fc.statementMap[String(i)] = { start: { line: i + 1, column: 0 }, end: { line: i + 1, column: 5 } };
      fc.s[String(i)] = covered.includes(i + 1) ? 1 : 0;
    }
    return { projects, map: { [path]: fc }, problem: null } as NonNullable<ReturnType<typeof coverageSourceFrom>>;
  };
  const runResult = (id: string, coverageSource: ReturnType<typeof coverageSourceFrom> | null) => ({
    ...result({ id }),
    coverageRaw: null,
    coverageSource,
  });
  const config = { suite: 'unit', projects: ['unit', 'integration'], projectsIfSuites: ['generated'] };
  const diffAdding = (lines: number[]) => () =>
    ['+++ b/packages/x/src/a.ts', ...lines.map((n) => `@@ -0,0 +${n},1 @@`), '+++ b/docs/x.md', '@@ -0,0 +1,1 @@'].join('\n');

  it('[US-006] merges the coverage of the suites that ran, then gate, tripwire and (profile pr) diff cases follow', async () => {
    const root = gateRoot();
    const step = await mergedCoverageStep({
      config,
      results: [
        runResult('unit', source(root, ['unit'], [1, 2, 3, 4, 5, 6, 7, 8, 9])),
        runResult('integration', source(root, ['integration'], [10])),
      ],
      repoRoot: root,
      work: root,
      testTimeoutMs: 1,
      suiteTimeoutMs: 1,
      profile: 'pr',
      base: 'origin/main',
      listTests: () => [],
      loadThreshold: () => Promise.resolve({ lines: 85, branches: 75 }),
      diff: diffAdding([9, 10]),
    });
    expect(step.required).toEqual(['unit', 'integration']);
    expect(step.summary?.['total']).toMatchObject({ lines: { total: 10, covered: 10, pct: 100 } });
    expect(step.cases.map((c) => [c.name, c.status])).toEqual([
      ['coverage merge: project generated has no test files (not required)', 'passed'],
      ['coverage merge: project unit measured', 'passed'],
      ['coverage merge: project integration measured', 'passed'],
      ['coverage gate: overall lines', 'passed'],
      ['coverage gate: overall branches', 'passed'],
      ['coverage gate: packages/pricing (inactive)', 'passed'],
      ['coverage gate: packages/audit (inactive)', 'passed'],
      ['coverage gate: packages/authz (inactive)', 'passed'],
      ['coverage gate: apps/api/src/modules/payments/service (inactive)', 'passed'],
      ['coverage gate: packages/shared/src/money (inactive)', 'passed'],
      ['coverage gate: apps/api/src/modules/ledger (inactive)', 'passed'],
      ['coverage gate: packages/ledger (inactive)', 'passed'],
      ['coverage tripwire: jest.config.ts global lines', 'passed'],
      ['coverage tripwire: jest.config.ts global branches', 'passed'],
      ['coverage diff: packages/x/src/a.ts', 'passed'],
    ]);
    expect(mergedCoverageNote(step.summary, step.required, step.cases)).toBe(
      'Merged coverage (unit, integration): lines 100 % (10/10), branches 100 % (0/0); US-006 merged gate PASS',
    );
  });

  it('[US-006] [PR33-SEC-06] fail closed: an unusable project source fails by name and the gate reports no summary', async () => {
    const root = gateRoot();
    const step = await mergedCoverageStep({
      config: { ...config, projectsIfSuites: [] },
      results: [
        runResult('unit', source(root, ['unit'], [1])),
        runResult('integration', {
          projects: ['integration'],
          map: null,
          problem: 'coverage of integration: Jest wrote no coverage-final.json',
        }),
      ],
      repoRoot: root,
      work: root,
      testTimeoutMs: 1,
      suiteTimeoutMs: 1,
      profile: 'wave',
      base: 'origin/main',
      loadThreshold: () => Promise.resolve({ lines: 85 }),
    });
    expect(step.summary).toBeNull();
    expect(step.cases.map((c) => [c.name, c.status, c.message])).toEqual([
      ['coverage merge: project unit measured', 'passed', undefined],
      ['coverage merge: project integration measured', 'failed', 'coverage of integration: Jest wrote no coverage-final.json'],
      ['coverage gate: summary present', 'error', 'coverage-summary.json is absent or unreadable'],
    ]);
    expect(mergedCoverageNote(step.summary, step.required, step.cases)).toBe(
      'Merged coverage (unit, integration): lines n/a, branches n/a; US-006 merged gate FAIL (2 case(s))',
    );
  });

  it('[US-006] a tripwire that cannot be evaluated is an error case, not a pass', async () => {
    const root = gateRoot();
    const step = await mergedCoverageStep({
      config: { suite: 'unit', projects: ['unit'], projectsIfSuites: [] },
      results: [runResult('unit', source(root, ['unit'], [1, 2, 3, 4, 5, 6, 7, 8, 9]))],
      repoRoot: root,
      work: root,
      testTimeoutMs: 1,
      suiteTimeoutMs: 1,
      profile: 'wave',
      base: 'origin/main',
      loadThreshold: () => Promise.reject(new Error('jest.config.ts has no coverageThreshold.global')),
    });
    expect(step.cases.find((c) => c.name.startsWith('coverage tripwire'))).toMatchObject({
      name: 'coverage tripwire: jest.config.ts global',
      status: 'error',
      message: 'tripwire not evaluated: jest.config.ts has no coverageThreshold.global',
    });
  });

  it('[US-006] diff cases: a changed file below target fails with its uncovered lines; no change passes; git errors are errors', () => {
    const root = gateRoot();
    const lcov = ['TN:', 'SF:packages/x/src/a.ts', 'DA:1,1', 'DA:2,0', 'DA:3,0', 'BRDA:2,0,0,0', 'end_of_record', ''].join('\n');
    expect(diffCoverageCases({ lcov, repoRoot: root, base: 'b', classname: 'unit', diff: diffAdding([1, 2, 3]) })).toEqual([
      {
        name: 'coverage diff: packages/x/src/a.ts',
        classname: 'unit',
        status: 'failed',
        message: 'below: changed lines 33.33% (1/3) (>= 85%), branches 0.00% (0/1) (>= 75%), uncovered lines 2,3',
      },
    ]);
    expect(diffCoverageCases({ lcov, repoRoot: root, base: 'b', classname: 'unit', diff: () => '' })).toEqual([
      { name: 'coverage diff: no changed source file in scope', classname: 'unit', status: 'passed' },
    ]);
    expect(
      diffCoverageCases({
        lcov,
        repoRoot: root,
        base: 'b',
        classname: 'unit',
        diff: () => {
          throw new Error('git diff failed (exit 128)');
        },
      }),
    ).toEqual([
      {
        name: 'coverage diff: evaluated',
        classname: 'unit',
        status: 'error',
        message: 'diff coverage not evaluated: git diff failed (exit 128)',
      },
    ]);
  });

  it('[US-006] coverageSourceFrom: absent, unreadable and valid coverage-final.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'heavy-source-'));
    temps.push(dir);
    expect(coverageSourceFrom(['unit'], dir)).toEqual({
      projects: ['unit'],
      map: null,
      problem: 'coverage of unit: Jest wrote no coverage-final.json',
    });
    writeFileSync(join(dir, 'coverage-final.json'), '{"C:/x": ');
    expect(coverageSourceFrom(['api'], dir)).toEqual({
      projects: ['api'],
      map: null,
      problem: 'coverage of api: coverage-final.json is not valid JSON',
    });
    writeFileSync(join(dir, 'coverage-final.json'), '{}');
    expect(coverageSourceFrom(['api'], dir)).toEqual({ projects: ['api'], map: {}, problem: null });
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

/**
 * A stand-in for node_modules/jest/bin/jest.js (CommonJS): `--listTests` prints `[]`; otherwise it writes a passing
 * two-test Jest JSON report to `--outputFile` and, unless the selected projects are listed in `noCoverage`, a
 * v8-shaped coverage-final.json for `<cwd>/packages/x/src/a.ts` (100 lines, 100 disjoint block ranges) with the given
 * line and branch percentages into `--coverageDirectory=`.
 */
function fakeJest(linesPct: number, branchesPct: number, noCoverage: readonly string[] = []): string {
  const report = {
    testResults: [
      {
        name: 'a.test.ts',
        status: 'passed',
        assertionResults: [
          { status: 'passed', fullName: '[SEC-TC-48] verdict recomputed', duration: 1 },
          { status: 'passed', fullName: 'second', duration: 1 },
        ],
      },
    ],
  };
  return [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const argv = process.argv.slice(2);',
    "if (argv.includes('--listTests')) { console.log('[]'); process.exit(0); }",
    "const out = argv[argv.indexOf('--outputFile') + 1];",
    "const at = argv.indexOf('--selectProjects');",
    'const projects = [];',
    "for (let k = at + 1; k < argv.length && !argv[k].startsWith('-'); k += 1) projects.push(argv[k]);",
    `fs.writeFileSync(out, ${JSON.stringify(JSON.stringify(report))});`,
    "const dir = argv.find((a) => a.startsWith('--coverageDirectory=')).slice('--coverageDirectory='.length);",
    `if (projects.some((p) => ${JSON.stringify(noCoverage)}.includes(p))) process.exit(0);`,
    "const file = path.join(process.cwd(), 'packages', 'x', 'src', 'a.ts');",
    'const fc = { path: file, statementMap: {}, s: {}, fnMap: {}, f: {}, branchMap: {}, b: {} };',
    'for (let i = 0; i < 100; i += 1) {',
    '  const loc = { start: { line: i + 1, column: 0 }, end: { line: i + 1, column: 5 } };',
    `  fc.statementMap[i] = loc; fc.s[i] = i < ${linesPct} ? 1 : 0;`,
    `  fc.branchMap[i] = { type: 'branch', line: i + 1, loc, locations: [loc] }; fc.b[i] = [i < ${branchesPct} ? 1 : 0];`,
    '}',
    'fs.mkdirSync(dir, { recursive: true });',
    "fs.writeFileSync(path.join(dir, 'coverage-final.json'), JSON.stringify({ [file]: fc }));",
    '',
  ].join('\n');
}

/**
 * A throw-away repository with a manifest, a runner file and a build script (dirty = the build writes a file). With
 * `jestCoverage`, the only suite is a `kind: jest` runner with `coverage: true` served by fakeJest that carries the
 * merged gate (`merged_coverage.projects` = `mergedProjects`, default unit), the three required critical packages exist
 * with only their re-exporting index.ts (inactive in the US-006 gate), and jest.config.ts holds the 85/75 tripwire.
 */
function fixtureRepo(options: {
  dirtyBuild: boolean;
  junit?: string;
  jestCoverage?: [number, number];
  mergedProjects?: string[];
  noCoverage?: string[];
}): string {
  const dir = mkdtempSync(join(tmpdir(), 'heavy-e2e-'));
  temps.push(dir);
  const write = (rel: string, content: string) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  const coverage = options.jestCoverage;
  write(
    'package.json',
    JSON.stringify({
      name: 'heavy-fixture',
      private: true,
      ...(coverage === undefined ? {} : { type: 'module' }),
      scripts: { build: 'node build.mjs' },
    }),
  );
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
  const junit =
    options.junit ??
    '<testsuite name="fake" tests="2"><testcase name="[SEC-TC-48] verdict recomputed"/><testcase name="second"/></testsuite>';
  if (coverage !== undefined) {
    write('.gitignore', 'node_modules/\n');
    write('node_modules/jest/package.json', JSON.stringify({ name: 'jest', type: 'commonjs' }));
    write('node_modules/jest/bin/jest.js', fakeJest(...coverage, options.noCoverage));
    write(
      'jest.config.ts',
      'const config: object = { coverageThreshold: { global: { lines: 85, branches: 75 } } };\nexport default config;\n',
    );
    for (const pkg of ['pricing', 'audit', 'authz']) write(`packages/${pkg}/src/index.ts`, 'export {};\n');
  }
  write(
    'tools/quality/suite-runners.json',
    JSON.stringify({
      version: 1,
      testcontainers_images: [PINNED],
      ...(coverage === undefined ? {} : { merged_coverage: { suite: 'fake', projects: options.mergedProjects ?? ['unit'] } }),
      suites: {
        fake:
          coverage === undefined
            ? {
                kind: 'command',
                cmd: ['{node}', '-e', `require('fs').writeFileSync(process.argv[1], ${JSON.stringify(junit)})`, '{junit}'],
                converter: 'junit',
              }
            : { kind: 'jest', project: 'unit', paths: [], coverage: true },
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

  it('[PR28-SEC-02] host paths (temp directory, its real path, a user-profile path) never reach the committed JUnit or summary', () => {
    const tmp = tmpdir();
    const real = realpathSync.native(tmp);
    const profile = String.raw`C:\Users\Zebediah\AppData\Local\Temp`;
    const short = String.raw`C:\Users\ZEBEDI~1\AppData\Local\Temp`;
    const junit =
      '<testsuite name="fake" tests="3">' +
      `<testcase name="[SEC-TC-48] refuses ${tmp}/outside-1/s"/>` +
      `<testcase name="real ${real}/outside-2/s"/>` +
      `<testcase name="profile ${profile}/x and ${short}/y and /home/zebediah/z"/>` +
      '</testsuite>';
    const dir = fixtureRepo({ dirtyBuild: false, junit });
    const out = join(dir, 'out');
    const run = runNode([heavy, '--profile', 'wave', '--out-root', out], { cwd: dir, env: cliEnv(), timeoutMs: 180_000 });
    expect(run.status).toBe(0);
    const runDir = join(out, 'tests', 'runs', String(readdirSync(join(out, 'tests', 'runs'))[0]));
    for (const name of readdirSync(runDir)) {
      const text = readFileSync(join(runDir, name), 'utf8');
      const fragments = [tmp, real, 'Zebediah', 'ZEBEDI', dir];
      for (const fragment of [...fragments, ...fragments.map((f) => f.replaceAll('\\', '/'))])
        expect({ file: name, leaks: text.toLowerCase().includes(fragment.toLowerCase()) }).toEqual({ file: name, leaks: false });
    }
    expect(readFileSync(join(runDir, 'fake.junit.xml'), 'utf8')).toContain('[SEC-TC-48] refuses &lt;root&gt;');
  });

  it('[R-ARCH-21] a build that leaves a file behind yields build_clean false and INVALID (exit 1)', () => {
    const dir = fixtureRepo({ dirtyBuild: true });
    const run = runNode([heavy, '--profile', 'wave'], { cwd: dir, env: cliEnv(), timeoutMs: 180_000 });
    expect(run.status).toBe(1);
    const { summary } = readRun(join(dir, 'docs', '05-quality'));
    expect(summary).toMatchObject({ verdict: 'INVALID', build_clean: false });
    expect((summary['invalid_reasons'] as string[]).join(' ')).toMatch(/build_clean false/);
  });

  /** Runs heavy in a coverage fixture and returns exit status, verdict, the host suite JUnit and summary.md. */
  const coverageRun = (dir: string, extra: string[] = ['--profile', 'wave']) => {
    const out = join(dir, 'out');
    const run = runNode([heavy, ...extra, '--out-root', out], { cwd: dir, env: cliEnv(), timeoutMs: 180_000 });
    const { summary, md, files } = readRun(out);
    const runDir = join(out, 'tests', 'runs', String(readdirSync(join(out, 'tests', 'runs'))[0]));
    const junit = readFileSync(join(runDir, 'fake.junit.xml'), 'utf8');
    return { status: run.status, verdict: summary['verdict'], summary, junit, md, files, stderr: run.stderr };
  };

  it('[R1-m1] [US-006] [AT-US-006-02] the merged gate cases sit in the host suite: below 85 % lines fails the suite by name, at target it passes', () => {
    const below = coverageRun(fixtureRepo({ dirtyBuild: false, jestCoverage: [84, 90] }));
    expect(below.status).toBe(1);
    expect(below.verdict).toBe('FAIL');
    expect(below.junit).toMatch(
      /<testcase [^>]*name="coverage gate: overall lines"[^>]*>\s*<failure[^>]*message="overall lines 84\.00% &lt; 85%"/u,
    );
    expect(below.junit).toMatch(/<testcase [^>]*name="coverage gate: overall branches"[^>]*\/>/u);
    // The jest.config.ts tripwire is evaluated on the merged total as well (independent of coverage-gate.mjs).
    expect(below.junit).toMatch(
      /<testcase [^>]*name="coverage tripwire: jest.config.ts global lines"[^>]*>\s*<failure[^>]*message="lines: 84% &lt; 85%"/u,
    );
    const atTarget = coverageRun(fixtureRepo({ dirtyBuild: false, jestCoverage: [90, 80] }));
    expect([atTarget.status, atTarget.verdict]).toEqual([0, 'PASS']);
    for (const name of [
      'coverage merge: project unit measured',
      'coverage gate: overall lines',
      'coverage gate: overall branches',
      'coverage gate: packages/pricing (inactive)',
      'coverage gate: packages/ledger (inactive)',
      'coverage tripwire: jest.config.ts global lines',
      'coverage tripwire: jest.config.ts global branches',
    ])
      expect(atTarget.junit).toContain(`name="${name}"`);
    // The evidence records the MERGED summary (repository-relative keys) and one summary.md line on the merged gate.
    expect(atTarget.summary['coverage']).toEqual({ line: 90, branch: 80, per_package: { 'packages/x': { line: 90, branch: 80 } } });
    expect(atTarget.files).toContain('coverage-summary.json');
    expect(atTarget.md).toContain('Merged coverage (unit): lines 90 % (90/100), branches 80 % (80/100); US-006 merged gate PASS');
    expect(atTarget.junit).not.toContain('coverage diff:'); // the diff gate needs a base: profile pr only
  });

  it('[US-006] [PR33-SEC-06] fail closed: a required project no suite ran is run for coverage; without coverage it fails by name', () => {
    const missing = coverageRun(
      fixtureRepo({ dirtyBuild: false, jestCoverage: [90, 80], mergedProjects: ['unit', 'api'], noCoverage: ['api'] }),
    );
    expect([missing.status, missing.verdict]).toEqual([1, 'FAIL']);
    expect(missing.stderr).toContain('coverage run api (no selected suite ran these projects)');
    expect(missing.junit).toMatch(/<testcase [^>]*name="coverage merge: api coverage run"[^>]*\/>/u);
    expect(missing.junit).toMatch(
      /<testcase [^>]*name="coverage merge: project api measured"[^>]*>\s*<failure[^>]*message="coverage of api: Jest wrote no coverage-final.json"/u,
    );
    expect(missing.junit).toMatch(/<testcase [^>]*name="coverage gate: summary present"[^>]*>\s*<error/u);
    expect(missing.summary['coverage']).toBeUndefined();
    expect(missing.md).toContain('US-006 merged gate FAIL');
    const supplied = coverageRun(fixtureRepo({ dirtyBuild: false, jestCoverage: [90, 80], mergedProjects: ['unit', 'api'] }));
    expect([supplied.status, supplied.verdict]).toEqual([0, 'PASS']);
    expect(supplied.junit).toContain('name="coverage merge: project api measured"');
  });

  it('[US-006] profile pr adds the diff-coverage gate over the merged lcov for the changed source files', () => {
    const dir = fixtureRepo({ dirtyBuild: false, jestCoverage: [90, 80] });
    mkdirSync(join(dir, 'packages', 'x', 'src'), { recursive: true });
    writeFileSync(
      join(dir, 'packages', 'x', 'src', 'a.ts'),
      `${Array.from({ length: 100 }, (_, i) => `export const v${i} = ${i};`).join('\n')}\n`,
    );
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'add a.ts']);
    const run = coverageRun(dir, ['--profile', 'pr', '--base', 'HEAD~1']);
    expect([run.status, run.verdict]).toEqual([0, 'PASS']);
    expect(run.junit).toMatch(/<testcase [^>]*name="coverage diff: packages\/x\/src\/a.ts"[^>]*\/>/u);
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
