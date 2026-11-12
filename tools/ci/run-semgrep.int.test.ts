/**
 * run-semgrep against the pinned Docker image (TASK-007; US-048, PR2-SEC-02, PR2-SEC-04). Needs Docker: the
 * integration project. Runs every rule pack's `semgrep --test` fixtures, then scans a seeded tree with the repository
 * rules passed through `--rules-from` (the lane-A base-ref path) to prove `--disable-nosem`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';

const repoRoot = findRepoRoot();
const script = join(repoRoot, 'tools', 'ci', 'run-semgrep.mjs');
const TEN_MINUTES = 10 * 60_000;
const scratch = mkdtempSync(join(tmpdir(), 'run-semgrep-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('run-semgrep (Docker)', () => {
  it(
    'every .semgrep rule pack passes its tests/fixtures/semgrep fixture (semgrep --test)',
    () => {
      const result = runNode([script, '--test'], { cwd: repoRoot, timeoutMs: TEN_MINUTES });
      expect(result.stdout).not.toContain('FAIL');
      expect(result.stdout.match(/^PASS /gmu)).toHaveLength(5);
      expect(result.status).toBe(0);
    },
    TEN_MINUTES,
  );

  it(
    'PR2-SEC-04 / PR2-SEC-02: a seeded violation fails with --rules-from, and an inline nosemgrep does not suppress it',
    () => {
      const tree = join(scratch, 'tree');
      mkdirSync(join(tree, 'apps', 'api', 'src'), { recursive: true });
      writeFileSync(
        join(tree, 'apps', 'api', 'src', 'egress.ts'),
        'export const call = (u: string) => fetch(u); // nosemgrep\nexport const load = (n: string) => import(n);\n',
      );
      const result = runNode([script, '--root', tree, '--rules-from', join(repoRoot, '.semgrep'), '--json'], {
        cwd: repoRoot,
        timeoutMs: TEN_MINUTES,
      });
      const report = JSON.parse(result.stdout) as { findings: Array<{ rule: string; location: string }> };
      expect(report.findings.map(({ rule, location }) => `${rule} ${location}`).sort()).toEqual([
        'platform.outbound-http.global-fetch-or-socket apps/api/src/egress.ts:1',
        'platform.password-hashing.dynamic-module-load apps/api/src/egress.ts:2',
      ]);
      expect(result.status).toBe(1);
    },
    TEN_MINUTES,
  );

  it(
    'PR10-SEC-03: a head .semgrepignore that drops apps/ hides the violation, and --ignore-from <base> restores the scope',
    () => {
      const tree = join(scratch, 'narrowed');
      const base = join(scratch, 'base-scope');
      mkdirSync(join(tree, 'apps', 'api', 'src'), { recursive: true });
      mkdirSync(base, { recursive: true });
      writeFileSync(join(tree, 'apps', 'api', 'src', 'egress.ts'), 'export const call = (u: string) => fetch(u);\n');
      writeFileSync(join(tree, 'keep.ts'), 'export const keep = 1;\n');
      writeFileSync(join(tree, '.semgrepignore'), 'apps/\n');
      writeFileSync(join(base, '.semgrepignore'), 'node_modules/\n');
      const scan = (extra: string[]) =>
        runNode([script, '--root', tree, '--rules-from', join(repoRoot, '.semgrep'), ...extra, '--json'], {
          cwd: repoRoot,
          timeoutMs: TEN_MINUTES,
        });
      // Negative control: the head scope file alone hides the seeded file.
      const narrowed = scan([]);
      expect((JSON.parse(narrowed.stdout) as { findings: unknown[] }).findings).toEqual([]);
      const restored = scan(['--ignore-from', base]);
      const report = JSON.parse(restored.stdout) as { findings: Array<{ rule: string; location: string }> };
      expect(report.findings.map(({ rule, location }) => `${rule} ${location}`)).toEqual([
        'platform.outbound-http.global-fetch-or-socket apps/api/src/egress.ts:1',
      ]);
      expect(restored.status).toBe(1);
    },
    TEN_MINUTES,
  );
});
