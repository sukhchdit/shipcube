/**
 * US-006 coverage gate (AT-US-006-01..03; REQ-PLAT-008; TASK-015). Fixture summaries are built in memory and, for the
 * CLI cases, written to a temp repository whose package folders exist or not as the scenario needs.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { COVERAGE_THRESHOLDS, coverageGateCases, evaluateCoverage, hasMeasurableSource, renderResult } from './coverage-gate.mjs';

const repoRoot = findRepoRoot();
const script = join(repoRoot, 'tools', 'ci', 'coverage-gate.mjs');
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

type Metric = { total: number; covered: number; skipped: number; pct: number };
type Entry = { lines: Metric; branches: Metric; statements: Metric; functions: Metric };

/** A summary entry at the given percentages, over 1000 lines and 1000 branches (one decimal place is exact). */
function entry(linesPct: number, branchesPct: number): Entry {
  const m = (pct: number): Metric => ({ total: 1000, covered: Math.round(pct * 10), skipped: 0, pct });
  return { lines: m(linesPct), branches: m(branchesPct), statements: m(linesPct), functions: m(linesPct) };
}

/** Overall plus one file per critical package (absolute keys, as Jest writes them). */
function summary(
  root: string,
  overall: [number, number],
  packages: Partial<Record<'pricing' | 'audit' | 'authz' | 'ledger', [number, number]>>,
): Record<string, Entry> {
  const out: Record<string, Entry> = { total: entry(...overall) };
  for (const [name, pcts] of Object.entries(packages)) out[join(root, 'packages', name, 'src', 'x.ts')] = entry(...pcts);
  return out;
}

const ALL_AT_TARGET = { pricing: [95, 95], audit: [95, 95], authz: [95, 95] } as const satisfies Record<string, [number, number]>;
const REQUIRED = new Set(['packages/pricing', 'packages/audit', 'packages/authz']);
/** The three required packages exist with measured code; every optional scope (money paths, ledger) is absent. */
const ALL_EXIST = { exists: (s: string) => REQUIRED.has(s), measurable: () => true };
/** The D-QA-003 money paths and the ledger module (PR #33 R1-M3): optional scopes whose source root is the scope. */
const MONEY_SCOPES = ['apps/api/src/modules/payments/service', 'packages/shared/src/money', 'apps/api/src/modules/ledger'] as const;

/** A temp repository with the named package folders (each with one measurable file) and a summary file. */
function repo(packages: readonly string[], body: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'coverage-gate-'));
  temps.push(root);
  for (const name of packages) {
    mkdirSync(join(root, 'packages', name, 'src'), { recursive: true });
    writeFileSync(join(root, 'packages', name, 'src', 'x.ts'), 'export const x = 1;\n');
  }
  mkdirSync(join(root, 'coverage'));
  writeFileSync(join(root, 'coverage', 'coverage-summary.json'), JSON.stringify(body));
  return root;
}

describe('coverage gate (US-006)', () => {
  it('[AT-US-006-01] coverage at target passes: overall 86/76 and each critical package at least 95', () => {
    const root = repo(['pricing', 'audit', 'authz'], {});
    const body = summary(root, [86, 76], ALL_AT_TARGET);
    writeFileSync(join(root, 'coverage', 'coverage-summary.json'), JSON.stringify(body));
    const result = evaluateCoverage(body, { root, probe: ALL_EXIST });
    expect(result.errors).toEqual([]);
    expect(result.checks.every((c) => c.ok)).toBe(true);
    expect(result.checks.map((c) => `${c.scope} ${c.metric}`)).toEqual([
      'overall lines',
      'overall branches',
      'packages/pricing lines',
      'packages/pricing branches',
      'packages/audit lines',
      'packages/audit branches',
      'packages/authz lines',
      'packages/authz branches',
    ]);
    const cli = runNode([script, '--root', root], { cwd: root });
    expect(cli.status).toBe(0);
    expect(cli.stdout).toContain('coverage-gate: PASS');
  });

  it.each([
    ['overall lines', summary('/r', [84.9, 76], ALL_AT_TARGET)],
    ['overall branches', summary('/r', [86, 74.9], ALL_AT_TARGET)],
    ['packages/audit lines', summary('/r', [86, 76], { ...ALL_AT_TARGET, audit: [94.9, 95] })],
    ['packages/authz lines', summary('/r', [86, 76], { ...ALL_AT_TARGET, authz: [94.9, 95] })],
    ['packages/pricing lines', summary('/r', [86, 76], { ...ALL_AT_TARGET, pricing: [94.9, 95] })],
    ['packages/pricing branches', summary('/r', [86, 76], { ...ALL_AT_TARGET, pricing: [95, 94.9] })],
  ])('[AT-US-006-02] below-threshold coverage fails the gate naming "%s"', (scope, body) => {
    const result = evaluateCoverage(body, { root: '/r', probe: ALL_EXIST });
    const rendered = renderResult(result);
    expect(rendered.ok).toBe(false);
    expect(result.checks.filter((c) => !c.ok).map((c) => `${c.scope} ${c.metric}`)).toEqual([scope]);
    expect(rendered.lines.at(-1)).toContain(scope);
  });

  it('[AT-US-006-02] the CLI exits non-zero naming the scope (packages/audit at 94.9 % lines)', () => {
    const root = repo(['pricing', 'audit', 'authz'], {});
    writeFileSync(
      join(root, 'coverage', 'coverage-summary.json'),
      JSON.stringify(summary(root, [86, 76], { ...ALL_AT_TARGET, audit: [94.9, 95] })),
    );
    const cli = runNode([script, '--root', root], { cwd: root });
    expect(cli.status).toBe(1);
    expect(cli.stderr).toContain('FAIL packages/audit lines 94.90% < 95%');
  });

  it('[AT-US-006-03] a missing packages/ledger does not fail and logs that the ledger gate is inactive', () => {
    const root = repo(['pricing', 'audit', 'authz'], {});
    writeFileSync(join(root, 'coverage', 'coverage-summary.json'), JSON.stringify(summary(root, [86, 76], ALL_AT_TARGET)));
    const cli = runNode([script, '--root', root], { cwd: root });
    expect(cli.status).toBe(0);
    expect(cli.stdout).toContain('inactive packages/ledger does not exist: ledger gate is inactive until M4');
    expect(cli.stdout).toContain(
      'inactive apps/api/src/modules/ledger does not exist: ledger gate is inactive until the ledger module lands (M4, ADR-0003)',
    );
    for (const scope of MONEY_SCOPES) expect(cli.stdout).toContain(`inactive ${scope} does not exist`);
  });

  it('[AT-US-006-03] once packages/ledger has measured code it is gated at 95 %', () => {
    const body = summary('/r', [86, 76], { ...ALL_AT_TARGET, ledger: [94.9, 95] });
    const result = evaluateCoverage(body, { root: '/r', probe: { exists: (s) => s.startsWith('packages/'), measurable: () => true } });
    expect(result.checks.filter((c) => !c.ok).map((c) => `${c.scope} ${c.metric}`)).toEqual(['packages/ledger lines']);
  });

  it.each(MONEY_SCOPES)(
    '[R1-M3] [D-QA-003] [AT-US-006-03] %s: inactive while absent or without source, gated at 95/95 once it has code',
    (scope) => {
      const root = repo(['pricing', 'audit', 'authz'], {});
      const body = (pcts: [number, number] | null): Record<string, Entry> => ({
        ...summary(root, [86, 76], ALL_AT_TARGET),
        ...(pcts === null ? {} : { [join(root, ...scope.split('/'), 'core.ts')]: entry(...pcts) }),
      });
      const evaluate = (pcts: [number, number] | null) => evaluateCoverage(body(pcts), { root });
      // Absent: inactive, not failed.
      expect(evaluate(null)).toMatchObject({
        errors: [],
        inactive: expect.arrayContaining([expect.stringContaining(`${scope} does not exist`)]),
      });
      // Present with only a placeholder, a test, a declaration and a tests/ helper: still inactive (nothing to measure).
      mkdirSync(join(root, ...scope.split('/'), 'tests'), { recursive: true });
      writeFileSync(join(root, ...scope.split('/'), '.gitkeep'), '');
      writeFileSync(join(root, ...scope.split('/'), 'core.test.ts'), 'export {};\n');
      writeFileSync(join(root, ...scope.split('/'), 'types.d.ts'), 'export {};\n');
      writeFileSync(join(root, ...scope.split('/'), 'tests', 'helper.ts'), 'export {};\n');
      expect(hasMeasurableSource(root, scope)).toBe(false);
      expect(evaluate(null).inactive).toContain(`${scope} has no measured source file yet: its 95 % gate is inactive`);
      // First source file: the scope itself is the source root, so it is measurable; without a summary entry = error.
      writeFileSync(join(root, ...scope.split('/'), 'core.ts'), 'export const x = 1;\n');
      expect(hasMeasurableSource(root, scope)).toBe(true);
      expect(evaluate(null).errors).toEqual([`${scope} has measurable source files but the coverage summary has no entry for them`]);
      // Measured: 94.9 % lines or branches fails naming the scope; 95/95 passes.
      for (const [pcts, failing] of [
        [[94.9, 95], [`${scope} lines`]],
        [[95, 94.9], [`${scope} branches`]],
        [[95, 95], []],
      ] as const) {
        const result = evaluate([...pcts]);
        expect([pcts, result.errors, result.checks.filter((c) => !c.ok).map((c) => `${c.scope} ${c.metric}`)]).toEqual([pcts, [], failing]);
      }
    },
  );

  it('[US-006] thresholds live in one constant: 85/75 overall, 95/95 for pricing, audit, authz, the money paths and the ledger', () => {
    expect(COVERAGE_THRESHOLDS.overall).toEqual({ lines: 85, branches: 75 });
    expect(COVERAGE_THRESHOLDS.critical.map((c) => [c.scope, c.lines, c.branches, c.required, [...c.roots]])).toEqual([
      ['packages/pricing', 95, 95, true, ['src', 'app']],
      ['packages/audit', 95, 95, true, ['src', 'app']],
      ['packages/authz', 95, 95, true, ['src', 'app']],
      ['apps/api/src/modules/payments/service', 95, 95, false, ['.']],
      ['packages/shared/src/money', 95, 95, false, ['.']],
      ['apps/api/src/modules/ledger', 95, 95, false, ['.']],
      ['packages/ledger', 95, 95, false, ['src', 'app']],
    ]);
  });

  it('[US-006] fail closed: a missing required package, unmeasured sources, zero lines or no total fail', () => {
    const noAudit = evaluateCoverage(summary('/r', [86, 76], { pricing: [95, 95], authz: [95, 95] }), {
      root: '/r',
      probe: { exists: (s) => s !== 'packages/audit' && REQUIRED.has(s), measurable: () => true },
    });
    expect(noAudit.errors).toEqual(['packages/audit does not exist (a required critical package)']);
    const unmeasured = evaluateCoverage(summary('/r', [86, 76], { pricing: [95, 95], authz: [95, 95] }), {
      root: '/r',
      probe: ALL_EXIST,
    });
    expect(unmeasured.errors).toEqual(['packages/audit has measurable source files but the coverage summary has no entry for them']);
    const zero = { total: { lines: { total: 0, covered: 0 }, branches: { total: 0, covered: 0 } } };
    expect(evaluateCoverage(zero, { root: '/r', probe: ALL_EXIST }).errors[0]).toContain('zero lines');
    expect(evaluateCoverage({}, { root: '/r', probe: ALL_EXIST }).errors[0]).toContain('no valid `total');
    const bad = { total: { lines: { total: 10, covered: 11 }, branches: { total: 0, covered: 0 } } };
    expect(evaluateCoverage(bad, { root: '/r', probe: ALL_EXIST }).errors[0]).toContain('no valid `total');
  });

  it('[US-006] a package with only its re-exporting index.ts is inactive, not failed', () => {
    const root = mkdtempSync(join(tmpdir(), 'coverage-gate-src-'));
    temps.push(root);
    mkdirSync(join(root, 'packages', 'pricing', 'src', 'tests'), { recursive: true });
    writeFileSync(join(root, 'packages', 'pricing', 'src', 'index.ts'), 'export {};\n');
    writeFileSync(join(root, 'packages', 'pricing', 'src', 'a.test.ts'), 'export {};\n');
    writeFileSync(join(root, 'packages', 'pricing', 'src', 'tests', 'helper.ts'), 'export {};\n');
    expect(hasMeasurableSource(root, 'packages/pricing')).toBe(false);
    const result = evaluateCoverage(summary(root, [86, 76], { audit: [95, 95], authz: [95, 95] }), {
      root,
      probe: { exists: (s) => s === 'packages/pricing', measurable: (s) => hasMeasurableSource(root, s) },
    });
    expect(result.inactive).toContain('packages/pricing has no measured source file yet: its 95 % gate is inactive');
    writeFileSync(join(root, 'packages', 'pricing', 'src', 'quote.ts'), 'export {};\n');
    expect(hasMeasurableSource(root, 'packages/pricing')).toBe(true);
  });

  it('[US-006] quality:heavy cases: a below-threshold scope is a failed case; an absent summary is an error case', () => {
    const cases = coverageGateCases(summary('/r', [84.9, 76], ALL_AT_TARGET), { root: '/r', classname: 'unit' });
    expect(cases.find((c) => c.name === 'coverage gate: overall lines')).toMatchObject({ status: 'failed' });
    expect(coverageGateCases(null, { root: '/r', classname: 'unit' })).toEqual([expect.objectContaining({ status: 'error' })]);
  });

  it('[US-006] usage errors and an unreadable summary exit 2', () => {
    const root = repo([], {});
    expect(runNode([script, '--root', root, '--summary', 'nope.json'], { cwd: root }).status).toBe(2);
    expect(runNode([script, '--bogus'], { cwd: root }).status).toBe(2);
    expect(runNode([script, '--root', root], { cwd: root }).status).toBe(2);
  });
});
