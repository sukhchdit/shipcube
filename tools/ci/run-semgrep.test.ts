/**
 * run-semgrep (TASK-007; US-048, PR2-SEC-02, PR2-SEC-04, SEC-P3-31): argument building, fixture pairing and output
 * parsing. No Docker here; tools/ci/run-semgrep.int.test.ts runs the image.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import {
  SEMGREP_IMAGE,
  bindMount,
  buildScanArgs,
  buildTestArgs,
  isTestPass,
  pairRuleFixtures,
  parseArgs,
  parseScanOutput,
  toMarkdown,
} from './run-semgrep.mjs';
import { findRepoRoot } from '../test-support/process.js';

const repoRoot = findRepoRoot();
const root = join(repoRoot, 'checkout');

describe('docker arguments', () => {
  it('pins the Semgrep image by tag and sha256 digest', () => {
    expect(SEMGREP_IMAGE).toMatch(/^semgrep\/semgrep:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/u);
  });

  it('scans read-only, offline, with --disable-nosem, --error and --metrics=off, head rules by default', () => {
    const args = buildScanArgs({ root });
    expect(args.slice(0, 4)).toEqual(['run', '--rm', '--network', 'none']);
    expect(args).toContain(`type=bind,source=${root},target=/src,readonly`);
    const semgrep = args.slice(args.indexOf(SEMGREP_IMAGE) + 1);
    expect(semgrep).toEqual(['semgrep', 'scan', '--config', '/src/.semgrep', '--disable-nosem', '--error', '--metrics=off', '--json', '.']);
  });

  it('SEC-P3-31: --rules-from mounts the base-ref rules read-only and scans with them', () => {
    const base = join(repoRoot, 'base-ref', '.semgrep');
    const args = buildScanArgs({ root, rulesFrom: base });
    expect(args).toContain(`type=bind,source=${base},target=/rules,readonly`);
    expect(args.slice(args.indexOf('--config'), args.indexOf('--config') + 2)).toEqual(['--config', '/rules']);
    expect(args).toContain('--disable-nosem');
  });

  it('PR10-SEC-03: --ignore-from mounts the base .semgrepignore and .gitignore over the scanned copies, read-only', () => {
    const base = join(repoRoot, 'base-ref');
    const args = buildScanArgs({ root, ignoreFrom: base, has: () => true });
    expect(args).toContain(`type=bind,source=${join(base, '.semgrepignore')},target=/src/.semgrepignore,readonly`);
    expect(args).toContain(`type=bind,source=${join(base, '.gitignore')},target=/src/.gitignore,readonly`);
    // The overlay mounts come after the /src mount, so they shadow the head files.
    expect(args.indexOf(`type=bind,source=${root},target=/src,readonly`)).toBeLessThan(
      args.indexOf(`type=bind,source=${join(base, '.semgrepignore')},target=/src/.semgrepignore,readonly`),
    );
  });

  it('PR10-SEC-03: a scope file the --ignore-from directory lacks is not mounted (the scanned copy applies)', () => {
    const base = join(repoRoot, 'base-ref');
    const args = buildScanArgs({ root, ignoreFrom: base, has: (path) => path.endsWith('.semgrepignore') });
    expect(args.filter((arg) => arg.includes('target=/src/'))).toEqual([
      `type=bind,source=${join(base, '.semgrepignore')},target=/src/.semgrepignore,readonly`,
    ]);
    expect(buildScanArgs({ root }).filter((arg) => arg.includes('target=/src/'))).toEqual([]);
  });

  it('test mode runs semgrep --test for one rule pack and its fixtures', () => {
    const args = buildTestArgs({ root, ruleFile: '.semgrep/raw-sql.yml', fixtures: ['tests/fixtures/semgrep/raw-sql.ts'] });
    expect(args.slice(args.indexOf(SEMGREP_IMAGE) + 1)).toEqual([
      'semgrep',
      '--test',
      '--metrics=off',
      '--config',
      '.semgrep/raw-sql.yml',
      'tests/fixtures/semgrep/raw-sql.ts',
    ]);
  });

  it('refuses a mount path that would split the --mount specification', () => {
    expect(() => bindMount('/a,b', '/src')).toThrow(/comma/u);
  });
});

describe('CLI arguments', () => {
  it('parses the contract flags and rejects unknown or incomplete ones', () => {
    expect(parseArgs(['--rules-from', 'base/.semgrep', '--summary', 's.md', '--json'])).toMatchObject({
      rulesFrom: expect.stringMatching(/base[\\/]\.semgrep$/u) as unknown,
      summaryFile: 's.md',
      json: true,
      test: false,
    });
    expect(parseArgs(['--test']).test).toBe(true);
    expect(() => parseArgs(['--rules-from'])).toThrow(/needs a value/u);
    expect(() => parseArgs(['--nosem'])).toThrow(/unknown argument/u);
    expect(() => parseArgs(['--test', '--rules-from', 'x'])).toThrow(/--test/u);
    expect(() => parseArgs(['--test', '--ignore-from', 'x'])).toThrow(/--test/u);
    expect(parseArgs(['--ignore-from', 'base']).ignoreFrom).toMatch(/base$/u);
  });
});

describe('rule packs and fixtures', () => {
  it('every rule pack in .semgrep has a tests/fixtures/semgrep fixture, and the five ADR-0024 packs exist', () => {
    const { pairs, missing } = pairRuleFixtures(repoRoot);
    expect(missing).toEqual([]);
    expect(pairs.map((pair) => pair.ruleFile)).toEqual([
      '.semgrep/country-branches.yml',
      '.semgrep/innerhtml.yml',
      '.semgrep/outbound-http.yml',
      '.semgrep/password-hashing.yml',
      '.semgrep/raw-sql.yml',
    ]);
    expect(pairs.find((pair) => pair.ruleFile === '.semgrep/innerhtml.yml')?.fixtures).toEqual(['tests/fixtures/semgrep/innerhtml.tsx']);
  });
});

describe('output parsing', () => {
  it('every rule id lives under the platform. namespace (the config-directory prefix is stripped)', () => {
    const ids = readdirSync(join(repoRoot, '.semgrep')).flatMap((name) =>
      [...readFileSync(join(repoRoot, '.semgrep', name), 'utf8').matchAll(/^\s+- id: (\S+)$/gmu)].map((match) => match[1]),
    );
    expect(ids.length).toBeGreaterThanOrEqual(10);
    expect(ids.filter((id) => !id?.startsWith('platform.'))).toEqual([]);
  });

  it('maps Semgrep JSON results to findings with rule, message and location', () => {
    const stdout = JSON.stringify({
      results: [
        { check_id: 'semgrep.platform.raw-sql.unsafe-api', path: 'apps/api/src/a.ts', start: { line: 3 }, extra: { message: 'x\n  y' } },
      ],
      errors: [],
      paths: { scanned: ['apps/api/src/a.ts'] },
    });
    expect(parseScanOutput(stdout)).toEqual({
      findings: [{ rule: 'platform.raw-sql.unsafe-api', message: 'x y', location: 'apps/api/src/a.ts:3' }],
      errors: [],
      scanned: 1,
    });
  });

  it('fails closed when no file was scanned', () => {
    expect(parseScanOutput(JSON.stringify({ results: [], errors: [], paths: { scanned: [] } })).errors).toHaveLength(1);
  });

  it('a rule test passes only on exit 0 with the "All tests passed" line and no failure marker', () => {
    expect(isTestPass(0, '2/2: ✓ All tests passed\nNo tests for fixes found.')).toBe(true);
    expect(isTestPass(1, '1/2: 1 unit tests did not pass:\n\t✖ platform.x')).toBe(false);
    expect(isTestPass(0, 'No unit tests found.')).toBe(false);
  });

  it('writes a per-rule Markdown summary', () => {
    const markdown = toMarkdown([{ rule: 'a', message: 'm', location: 'f:1' }], 'Semgrep');
    expect(markdown).toContain('| `a` | 1 |');
  });
});
