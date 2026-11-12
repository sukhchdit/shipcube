/**
 * check-suppressions (TASK-007; PR2-SEC-01 items 1, 2 and 4; NFR-MAINT-002): the suppression-comment policy that runs
 * as the third step of `npm run lint`. Seeded fixtures live in tests/fixtures/lint/suppressions (outside the repository
 * scan, which skips tests/fixtures/lint/**); the CLI is pointed at that directory with `--root`.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { checkSuppressions, extractJsComments, isProtected, isScanned, parseArgs, scanText } from './check-suppressions.mjs';
import { findRepoRoot, runNode } from '../test-support/process.js';

const repoRoot = findRepoRoot();
const fixtures = join(repoRoot, 'tests', 'fixtures', 'lint', 'suppressions');
const script = join(repoRoot, 'tools', 'lint', 'check-suppressions.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'check-suppressions-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Runs the pure core over one fixture, under a repository path the scan does not exclude. */
const check = (name: string) =>
  checkSuppressions([{ path: `packages/shared/src/${name}`, text: readFileSync(join(fixtures, name), 'utf8') }]);
const rulesOf = (name: string) => check(name).findings.map((finding) => finding.rule);

describe('suppression policy fixtures (PR2-SEC-01)', () => {
  it.each([
    ['PR2-SEC-01 (b): blanket eslint-disable, even with a TASK-linked reason', 'bad-blanket-eslint.ts', ['suppression/blanket']],
    ['PR2-SEC-01 (b): blanket stylelint-disable fails whatever its description', 'bad-blanket-stylelint.css', ['suppression/blanket']],
    ['PR2-SEC-01 (d): a reason without a linked task ID', 'bad-no-task-id.ts', ['suppression/missing-task-id']],
    ['PR2-SEC-01 (c): a protected rule, even with a task ID', 'bad-protected-disable.ts', ['suppression/protected-rule']],
    ['PR2-SEC-01 (a): inline rule configuration', 'bad-inline-config.ts', ['suppression/inline-config']],
    ['@ts-ignore is never allowed', 'bad-ts-ignore.ts', ['suppression/ts-ignore']],
    ['nosemgrep is never allowed (PR2-SEC-02 runs with --disable-nosem)', 'bad-nosemgrep.ts', ['suppression/semgrep']],
    ['an inline Gitleaks allow marker is never allowed (US-048)', 'bad-gitleaks-allow.yml', ['suppression/gitleaks']],
  ])('%s', (_title, name, expected) => {
    expect(rulesOf(name)).toEqual(expected);
  });

  it('a TASK-linked suppression of an unprotected rule passes (TS and CSS)', () => {
    expect(check('ok-justified.ts').findings).toEqual([]);
    expect(check('ok-justified.css').findings).toEqual([]);
  });

  it('counts each suppression per kind and per rule (NFR-MAINT-002 evidence)', () => {
    const { summary } = checkSuppressions(
      ['ok-justified.ts', 'ok-justified.css', 'bad-blanket-eslint.ts'].map((name) => ({
        path: `packages/shared/src/${name}`,
        text: readFileSync(join(fixtures, name), 'utf8'),
      })),
    );
    expect(summary).toEqual({
      files: 3,
      total: 4,
      byKind: { 'eslint-disable': 2, 'ts-expect-error': 1, 'stylelint-disable': 1 },
      byRule: {
        'eslint-disable: @typescript-eslint/no-explicit-any': 1,
        'eslint-disable: (all rules)': 1,
        'ts-expect-error: (all rules)': 1,
        'stylelint-disable: declaration-no-important': 1,
      },
    });
  });

  it('names the file and line of each finding', () => {
    expect(check('bad-protected-disable.ts').findings[0]).toMatchObject({
      rule: 'suppression/protected-rule',
      location: 'packages/shared/src/bad-protected-disable.ts:2',
      message: expect.stringContaining("'platform/no-innerhtml'") as unknown,
    });
  });
});

describe('scanner', () => {
  it('reads only real comments: strings, template text and regex literals are skipped', () => {
    const text = [
      "const a = '// eslint-disable';",
      'const b = `/* eslint-disable */ ${x /* eslint-disable-line no-console -- TASK-001 in a template hole */}`;',
      'const c = /\\/\\/ eslint-disable/u; const d = e / 2 / 1; // eslint-disable-line no-console -- TASK-002',
    ].join('\n');
    expect(scanText(text, 'a.ts').map(({ line, rules }) => ({ line, rules }))).toEqual([
      { line: 2, rules: ['no-console'] },
      { line: 3, rules: ['no-console'] },
    ]);
    expect(extractJsComments('/* a\n b */\n// c').map(({ line, block }) => ({ line, block }))).toEqual([
      { line: 1, block: true },
      { line: 3, block: false },
    ]);
  });

  it('multi-line block directives and prose comments', () => {
    const text = '/* eslint-disable\n  no-console,\n  boundaries/dependencies -- TASK-001 */\n// eslint is configured centrally';
    const findings = checkSuppressions([{ path: 'apps/api/src/a.ts', text }]).findings.map((f) => f.rule);
    expect(findings).toEqual(['suppression/protected-rule']);
  });

  it('protected rules include the boundaries family and the platform security rules', () => {
    expect(['boundaries/dependencies', 'platform/money-arith', 'no-restricted-imports'].every(isProtected)).toBe(true);
    expect(isProtected('@typescript-eslint/no-explicit-any')).toBe(false);
  });

  it('skips fixtures, docs and non-source files', () => {
    expect(isScanned('tests/fixtures/lint/suppressions/bad-ts-ignore.ts')).toBe(false);
    expect(isScanned('docs/05-quality/x.ts')).toBe(false);
    expect(isScanned('README.md')).toBe(false);
    expect(isScanned('apps/api/Dockerfile')).toBe(true);
    expect(isScanned('apps/web/app/app.css')).toBe(true);
  });

  it('rejects unknown and incomplete arguments', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/unknown argument/u);
    expect(() => parseArgs(['--root'])).toThrow(/needs a value/u);
    expect(parseArgs(['--json']).json).toBe(true);
  });
});

describe('CLI', () => {
  it('the repository itself passes (exit 0)', () => {
    const result = runNode([script], { cwd: repoRoot });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^check-suppressions: \d+ suppression\(s\) in \d+ file\(s\)/u);
  });

  it('fails the seeded fixtures with exit 1, one line per finding, and writes the job summary', () => {
    const summaryFile = join(scratch, 'summary.md');
    const result = runNode([script, '--root', fixtures, '--summary', summaryFile], { cwd: repoRoot });
    expect(result.status).toBe(1);
    for (const name of ['bad-blanket-eslint.ts', 'bad-blanket-stylelint.css', 'bad-no-task-id.ts', 'bad-ts-ignore.ts']) {
      expect(result.stderr).toContain(`(${name}:`);
    }
    expect(result.stderr).not.toContain('ok-justified');
    expect(readFileSync(summaryFile, 'utf8')).toContain('### Suppression comments (NFR-MAINT-002)');
  });

  it('--json prints findings and the summary', () => {
    const result = runNode([script, '--root', fixtures, '--json'], { cwd: repoRoot });
    const report = JSON.parse(result.stdout) as { findings: unknown[]; summary: { total: number } };
    expect(report.findings).toHaveLength(8);
    expect(report.summary.total).toBe(11);
  });

  it('exits 2 on a usage error', () => {
    expect(runNode([script, '--nope'], { cwd: repoRoot }).status).toBe(2);
  });
});
