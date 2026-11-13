/**
 * `npm run test:coverage` (tools/ci/coverage-run.mjs; US-006; D-ORCH-047; PR #33 R1-m4). Planning helpers are tested
 * directly; the CLI runs end to end in throw-away directories whose node_modules/jest/bin/jest.js is a stand-in that
 * answers `--listTests` and writes a v8-shaped coverage-final.json per project group, as the scenario says.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { coverageFlags, coverageGroups, groupJestArgs, requiredProjects } from './coverage-run.mjs';

const repoRoot = findRepoRoot();
const script = join(repoRoot, 'tools', 'ci', 'coverage-run.mjs');
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const CONFIG = { suite: 'unit', projects: ['unit', 'unit-dom', 'integration', 'api'], projectsIfSuites: ['generated'] };

describe('planning (D-ORCH-047)', () => {
  it('[US-006] in-process projects run together with workers, Testcontainers/app projects together in band', () => {
    expect(coverageGroups(['unit', 'unit-dom', 'integration', 'api', 'generated'])).toEqual([
      { projects: ['unit', 'unit-dom'], inBand: false },
      { projects: ['integration', 'api', 'generated'], inBand: true },
    ]);
    expect(coverageGroups(['api'])).toEqual([{ projects: ['api'], inBand: true }]);
    expect(coverageGroups([])).toEqual([]);
  });

  it('[US-006] a partial run writes istanbul JSON and switches Jest’s own global threshold off', () => {
    expect(coverageFlags('d')).toEqual(['--coverage', '--coverageReporters=json', '--coverageThreshold={}', '--coverageDirectory=d']);
    expect(groupJestArgs({ projects: ['integration', 'api'], inBand: true }, { coverageDir: 'd', testTimeoutMs: 45_000 })).toEqual([
      '--experimental-vm-modules',
      '--disable-warning=ExperimentalWarning',
      'node_modules/jest/bin/jest.js',
      '--selectProjects',
      'integration',
      'api',
      ...coverageFlags('d'),
      '-i',
      '--testTimeout=45000',
    ]);
    expect(groupJestArgs({ projects: ['unit'], inBand: false }, { coverageDir: 'd', testTimeoutMs: 1 })).not.toContain('-i');
  });

  it('[US-006] a conditional project is required while it has test files, and when they cannot be listed (fail closed)', () => {
    expect(requiredProjects(CONFIG, () => [])).toEqual({ required: CONFIG.projects, notRequired: ['generated'] });
    expect(requiredProjects(CONFIG, () => ['tests/generated/x.api.test.ts']).required).toEqual([...CONFIG.projects, 'generated']);
    expect(
      requiredProjects(CONFIG, () => {
        throw new Error('jest --listTests failed');
      }).required,
    ).toContain('generated');
  });
});

// --- CLI end to end -------------------------------------------------------------------------------------------------

type Group = { lines: number[]; ranges: Array<[[number, number, number, number], number]>; exit?: number; write?: boolean };

/**
 * A stand-in Jest (CommonJS): `--listTests` prints `list[project]`; otherwise it records its argv and writes the
 * coverage of `groups[<projects joined by +>]` for `<root>/packages/audit/src/g.ts` (10 lines) as coverage-final.json.
 */
function fakeJest(): string {
  return [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const argv = process.argv.slice(2);',
    "const scenario = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scenario.json'), 'utf8'));",
    "const at = argv.indexOf('--selectProjects');",
    'const projects = [];',
    "for (let k = at + 1; k < argv.length && !argv[k].startsWith('-'); k += 1) projects.push(argv[k]);",
    "if (argv.includes('--listTests')) { console.log(JSON.stringify(scenario.list[projects[0]] || [])); process.exit(0); }",
    "const tag = projects.join('+');",
    'fs.writeFileSync(path.join(process.cwd(), `args-${tag}.json`), JSON.stringify(argv));',
    'const group = scenario.groups[tag] || { lines: [], ranges: [], write: false };',
    "const dir = argv.find((a) => a.startsWith('--coverageDirectory=')).slice('--coverageDirectory='.length);",
    'if (group.write !== false) {',
    "  const file = path.join(process.cwd(), 'packages', 'audit', 'src', 'g.ts');",
    '  const fc = { path: file, statementMap: {}, s: {}, fnMap: {}, f: {}, branchMap: {}, b: {} };',
    '  group.lines.forEach((c, i) => { fc.statementMap[i] = { start: { line: i + 1, column: 0 }, end: { line: i + 1, column: 9 } }; fc.s[i] = c; });',
    '  group.ranges.forEach(([[sl, sc, el, ec], c], i) => { const loc = { start: { line: sl, column: sc }, end: { line: el, column: ec } };',
    "    fc.branchMap[i] = { type: 'branch', line: sl, loc, locations: [loc] }; fc.b[i] = [c]; });",
    '  fs.mkdirSync(dir, { recursive: true });',
    "  fs.writeFileSync(path.join(dir, 'coverage-final.json'), JSON.stringify({ [file]: fc }));",
    '}',
    'process.exit(group.exit || 0);',
    '',
  ].join('\n');
}

function fixture(scenario: { list: Record<string, string[]>; groups: Record<string, Group> }): string {
  const dir = mkdtempSync(join(tmpdir(), 'coverage-run-'));
  temps.push(dir);
  const write = (rel: string, content: string) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  write('package.json', JSON.stringify({ name: 'coverage-run-fixture', private: true, type: 'module' }));
  write(
    'jest.config.ts',
    'const config: { coverageThreshold: object } = { coverageThreshold: { global: { lines: 85, branches: 75 } } };\nexport default config;\n',
  );
  write(
    'tools/quality/suite-runners.json',
    JSON.stringify({
      version: 1,
      merged_coverage: { suite: 'unit', projects: CONFIG.projects, projects_if_suites: CONFIG.projectsIfSuites },
      suites: {},
    }),
  );
  write('node_modules/jest/package.json', JSON.stringify({ name: 'jest', type: 'commonjs' }));
  write('node_modules/jest/bin/jest.js', fakeJest());
  write('scenario.json', JSON.stringify(scenario));
  return dir;
}

// g.ts: `if` over lines 2-9; the unit group takes `then` (lines 1-5, 10), the integration group `else` (lines 1, 6-10).
const THEN_SIDE: Group = {
  lines: [1, 1, 1, 1, 1, 0, 0, 0, 0, 1],
  ranges: [
    [[1, 0, 10, 1], 1],
    [[6, 0, 9, 1], 0],
  ],
};
const ELSE_SIDE: Group = {
  lines: [1, 0, 0, 0, 0, 1, 1, 1, 1, 1],
  ranges: [
    [[1, 0, 10, 1], 1],
    [[2, 0, 5, 1], 0],
  ],
};

function run(dir: string, args: string[] = []) {
  const r = runNode([script, ...args], { cwd: dir, timeoutMs: 120_000 });
  const read = (name: string) => (existsSync(join(dir, 'coverage', name)) ? readFileSync(join(dir, 'coverage', name), 'utf8') : null);
  return { ...r, summary: read('coverage-summary.json'), lcov: read('lcov.info'), final: read('coverage-final.json') };
}

describe('npm run test:coverage CLI end to end', () => {
  it('[US-006] [AT-US-006-02] writes ONE summary merged across the project groups; generated is skipped while it has no tests', () => {
    const dir = fixture({ list: {}, groups: { 'unit+unit-dom': THEN_SIDE, 'integration+api': ELSE_SIDE } });
    const r = run(dir);
    expect(r.stderr).toContain('not required (no test files): generated');
    expect(r.status).toBe(0);
    const summary = JSON.parse(String(r.summary)) as Record<
      string,
      { lines: { pct: number }; branches: { total: number; covered: number } }
    >;
    expect(summary['total']?.lines.pct).toBe(100);
    expect(summary['total']?.branches).toMatchObject({ total: 3, covered: 3 });
    expect(r.lcov).toMatch(/^TN:\nSF:packages[\\/]audit[\\/]src[\\/]g\.ts\n/u);
    expect(r.final).not.toBeNull();
    expect(r.stdout).toContain('Lines        : 100% ( 10/10 )');
    const inBand = JSON.parse(readFileSync(join(dir, 'args-integration+api.json'), 'utf8')) as string[];
    expect(inBand).toEqual(expect.arrayContaining(['-i', '--testTimeout=30000', '--coverageThreshold={}', '--coverageReporters=json']));
    const parallel = JSON.parse(readFileSync(join(dir, 'args-unit+unit-dom.json'), 'utf8')) as string[];
    expect(parallel).not.toContain('-i');
  });

  it('[US-006] generated joins the in-band group once it has test files', () => {
    const dir = fixture({
      list: { generated: ['tests/generated/rbac.api.test.ts'] },
      groups: { 'unit+unit-dom': THEN_SIDE, 'integration+api+generated': ELSE_SIDE },
    });
    const r = run(dir, ['--test-timeout', '45000']);
    expect(r.status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, 'args-integration+api+generated.json'), 'utf8'))).toContain('--testTimeout=45000');
  });

  it('[US-006] fail closed: a project group without coverage exits 1 and leaves no (stale) summary behind', () => {
    const dir = fixture({ list: {}, groups: { 'unit+unit-dom': THEN_SIDE, 'integration+api': { ...ELSE_SIDE, write: false } } });
    mkdirSync(join(dir, 'coverage'), { recursive: true });
    writeFileSync(join(dir, 'coverage', 'coverage-summary.json'), '{"total":{}}');
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('FAIL project integration: coverage of integration+api is missing');
    expect(r.stderr).toContain('FAIL project api');
    expect([r.summary, r.lcov, r.final]).toEqual([null, null, null]);
  });

  it('[US-006] fail closed: a failing Jest run exits 1 without writing the merge', () => {
    const dir = fixture({ list: {}, groups: { 'unit+unit-dom': { ...THEN_SIDE, exit: 1 }, 'integration+api': ELSE_SIDE } });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('coverage of unit+unit-dom: jest exited 1');
    expect(r.summary).toBeNull();
  });

  it('[US-006] the jest.config.ts global tripwire is applied to the merged total', () => {
    const dir = fixture({ list: {}, groups: { 'unit+unit-dom': THEN_SIDE, 'integration+api': THEN_SIDE } });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('FAIL jest.config.ts global lines: 60% < 85%');
    expect(r.stderr).toContain('FAIL jest.config.ts global branches: 50% < 75%');
    expect(r.summary).not.toBeNull();
  });

  it('[US-006] usage errors exit 2', () => {
    const dir = fixture({ list: {}, groups: {} });
    expect(run(dir, ['--nope']).status).toBe(2);
    expect(run(dir, ['--test-timeout', 'x']).status).toBe(2);
    expect(run(dir, ['--out']).status).toBe(2);
    rmSync(join(dir, 'tools'), { recursive: true });
    expect(run(dir).status).toBe(2);
  });
});
