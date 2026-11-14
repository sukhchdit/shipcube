/**
 * gitleaks-full runner (PR25-SEC-01 runner half, PR33-SEC-08; D-SEC-PR45-01; TASK-015 part 015-B): baseline validation
 * before anything is mounted, the hardened docker argument list, the image pin and the suite-runners entry. The scans
 * themselves (17 lines -> 0 findings, 16 -> 1) are in gitleaks-full.int.test.ts (Docker).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { BASELINE_COUNT, BASELINE_LINE, BaselineError, GITLEAKS_IMAGE, dockerArgs, validateBaseline } from './gitleaks-full.mjs';

const repoRoot = findRepoRoot();
const script = join(repoRoot, 'tools', 'quality', 'gitleaks-full.mjs');
const baselineText = readFileSync(join(repoRoot, 'tools', 'quality', 'gitleaks-baseline.txt'), 'utf8');
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const SHA = 'a'.repeat(40);
const fingerprint = (n: number): string => `${SHA}:docs/x.md:generic-api-key:${String(n)}`;

describe('gitleaks-full: baseline validation (before the scan)', () => {
  it('accepts the committed baseline: exactly BASELINE_COUNT exact fingerprints', () => {
    const lines = validateBaseline(baselineText, { count: BASELINE_COUNT });
    expect(lines).toHaveLength(17);
    expect(lines.every((line) => BASELINE_LINE.test(line))).toBe(true);
  });

  it('rejects a commit-less line, a path or rule widening, a short commit and a non-positive line', () => {
    for (const bad of [
      'docs/x.md:generic-api-key:3',
      `${SHA}:docs/x.md:generic-api-key`,
      `${SHA}:docs/x.md:*:3`,
      `${SHA}::generic-api-key:3`,
      `${SHA.slice(0, 7)}:docs/x.md:generic-api-key:3`,
      `${SHA}:docs/x.md:generic-api-key:0`,
      `${SHA}:docs/a b.md:generic-api-key:3`,
      `${SHA}:docs/x.md:aws-access-token:3`,
    ]) {
      expect(() => validateBaseline(`# c\n${fingerprint(1)}\n${bad}\n`, { count: 2 })).toThrow(BaselineError);
      expect(() => validateBaseline(`${bad}\n`, { count: 1 })).toThrow(/rejected before the scan/u);
    }
  });

  it('rejects a count other than expected and a duplicate; comments, blanks and CRLF are fine', () => {
    expect(() => validateBaseline(`${fingerprint(1)}\n`, { count: 2 })).toThrow(/holds 1 fingerprints, exactly 2 expected/u);
    expect(() => validateBaseline(`${fingerprint(1)}\n${fingerprint(1)}\n`, { count: 2 })).toThrow(/duplicate/u);
    expect(validateBaseline(`# head\r\n\r\n${fingerprint(1)}\r\n${fingerprint(2)}\r\n`, { count: 2 })).toEqual([
      fingerprint(1),
      fingerprint(2),
    ]);
  });

  it('the pattern is the sec-static pin (BASELINE_LINE source)', () => {
    const secStatic = readFileSync(join(repoRoot, 'tools', 'ci', 'sec-static.test.ts'), 'utf8');
    expect(secStatic).toContain(`toMatch(/${BASELINE_LINE.source}/u)`);
  });
});

describe('gitleaks-full: docker invocation', () => {
  const args = dockerArgs({ gitDir: '/g', configFile: '/c.toml', baselineFile: '/b.txt', outDir: '/o', sha: SHA });

  it('no network, read-only git dir, config and baseline, the ignore path, allow markers inert, ancestry of one commit', () => {
    expect(args.slice(0, 4)).toEqual(['run', '--rm', '--network', 'none']);
    expect(args).toContain('type=bind,src=/g,dst=/repo/.git,readonly');
    expect(args).toContain('type=bind,src=/c.toml,dst=/config/gitleaks.toml,readonly');
    expect(args).toContain('type=bind,src=/b.txt,dst=/config/baseline.txt,readonly');
    expect(args).toContain('type=bind,src=/o,dst=/out');
    expect(args.join(' ')).toContain('--gitleaks-ignore-path /config/baseline.txt');
    expect(args).toContain(`--log-opts=--diff-merges=first-parent ${SHA}`);
    expect(args).toContain('--ignore-gitleaks-allow');
    expect(args.join(' ')).toContain('--exit-code 1');
    expect(args.join(' ')).not.toMatch(/--all\b|--baseline-path|--max-target-megabytes|--no-git/u);
    // Only the git directory reaches /repo: no working tree that could carry a .gitleaksignore.
    expect(args.filter((a) => a.includes('dst=/repo'))).toEqual(['type=bind,src=/g,dst=/repo/.git,readonly']);
  });

  it('refuses a scan target that is not a full SHA (a ref name, --all, an option)', () => {
    for (const sha of ['HEAD', '--all', SHA.slice(0, 12), `${SHA} --all`])
      expect(() => dockerArgs({ gitDir: '/g', configFile: '/c', baselineFile: '/b', outDir: '/o', sha })).toThrow(/full 40-hex SHA/u);
  });

  it('pins the same gitleaks image as ci.yml', () => {
    const ci = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toContain(`  GITLEAKS_IMAGE: ${GITLEAKS_IMAGE}\n`);
  });

  it('suite-runners.json runs it as the gitleaks-full command suite with the run base ref', () => {
    const runners = JSON.parse(readFileSync(join(repoRoot, 'tools', 'quality', 'suite-runners.json'), 'utf8')) as {
      suites: Record<string, unknown>;
    };
    expect(runners.suites['gitleaks-full']).toEqual({
      kind: 'command',
      cmd: ['{node}', '{root}/tools/quality/gitleaks-full.mjs', '--root', '{root}', '--ref', '{base}', '--report', '{native}'],
      converter: 'gitleaks',
      native_report: 'gitleaks-full.json',
    });
  });
});

describe('gitleaks-full: CLI', () => {
  function git(cwd: string, args: string[]): void {
    const r = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=f', '-c', 'user.email=f@example.invalid', ...args], {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (r.status !== 0) throw new Error(r.stderr);
  }

  it('[PR33-SEC-08] a commit-less baseline line at the config ref is rejected before any scan (exit 2, no report)', () => {
    const root = mkdtempSync(join(tmpdir(), 'gitleaks-full-cli-'));
    temps.push(root);
    git(root, ['init', '-q', '-b', 'main']);
    mkdirSync(join(root, 'tools', 'quality'), { recursive: true });
    writeFileSync(join(root, '.gitleaks.toml'), '[extend]\nuseDefault = true\n');
    const lines = Array.from({ length: 16 }, (_, i) => fingerprint(i + 1));
    writeFileSync(join(root, 'tools', 'quality', 'gitleaks-baseline.txt'), `${[...lines, 'docs/x.md:generic-api-key:99'].join('\n')}\n`);
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'x']);
    const report = join(root, 'report.json');
    const r = runNode([script, '--root', root, '--ref', 'HEAD', '--report', report], { cwd: root });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('baseline entry 17 is not an exact');
    expect(r.stderr).toContain('rejected before the scan');
    expect(() => readFileSync(report)).toThrow();
  });

  it('refuses missing arguments and an unknown ref with exit 2', () => {
    expect(runNode([script, '--root', repoRoot], { cwd: repoRoot }).status).toBe(2);
    expect(runNode([script, '--root', repoRoot, '--ref', 'no-such-ref-x', '--report', 'r.json'], { cwd: repoRoot }).status).toBe(2);
  });
});
