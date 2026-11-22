/**
 * gitleaks-full runner (PR25-SEC-01 runner half, PR33-SEC-08; D-SEC-PR45-01; TASK-015 part 015-B): baseline validation
 * before anything is mounted, the hardened docker argument list, the image pin and the suite-runners entry. The scans
 * themselves (22 lines -> 0 findings, 21 -> 1) are in gitleaks-full.int.test.ts (Docker).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import {
  BASELINE_COUNT,
  BASELINE_LINE,
  BASELINE_PATH,
  BaselineError,
  CONFIG_PATH,
  GITLEAKS_IMAGE,
  LOG_OPTS,
  dockerArgs,
  main,
  readInputs,
  scan,
  validateBaseline,
} from './gitleaks-full.mjs';

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
    expect(lines).toHaveLength(22);
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
    // PR #46 r1 m5: exact, so neither --text/--no-textconv/--no-ext-diff nor first-parent can be dropped.
    expect(LOG_OPTS).toBe('--diff-merges=first-parent --text --no-textconv --no-ext-diff');
    expect(args.filter((a) => a.startsWith('--log-opts'))).toEqual([
      `--log-opts=--diff-merges=first-parent --text --no-textconv --no-ext-diff ${SHA}`,
    ]);
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

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=f', '-c', 'user.email=f@example.invalid', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
}

describe('gitleaks-full: CLI', () => {
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

/** A docker stand-in: records what scan() mounted and writes `findings` as the native report. */
function fakeDocker(findings: unknown[], status: number | null) {
  const calls: { args: string[]; config: string; baseline: string }[] = [];
  const srcOf = (args: string[], dst: string): string => {
    const mount = args.find((a) => a.startsWith('type=bind,') && a.includes(`,dst=${dst}`)) ?? '';
    return (/,src=(.*?),dst=/u.exec(mount) ?? [])[1] ?? '';
  };
  const run = (args: string[]) => {
    calls.push({
      args,
      config: readFileSync(srcOf(args, '/config/gitleaks.toml'), 'utf8'),
      baseline: readFileSync(srcOf(args, '/config/baseline.txt'), 'utf8'),
    });
    writeFileSync(join(srcOf(args, '/out'), 'gitleaks-full.json'), JSON.stringify(findings));
    return { status, stderr: '' };
  };
  return { run, calls };
}

describe('gitleaks-full: config and baseline come from --ref, never HEAD (D-TASK015-39; PR #46 r1 m2)', () => {
  // Commit A: a valid 22-line baseline (the committed one) and config A. Commit B (HEAD): a commit-less baseline line
  // (which would silence every commit at that path) and config B. In lane B the ref is the base and HEAD the PR.
  const root = mkdtempSync(join(tmpdir(), 'gitleaks-full-ref-'));
  temps.push(root);
  git(root, ['init', '-q', '-b', 'main']);
  mkdirSync(join(root, 'tools', 'quality'), { recursive: true });
  const committedBaseline = git(repoRoot, ['show', `HEAD:${BASELINE_PATH}`]);
  writeFileSync(join(root, CONFIG_PATH), '[extend]\nuseDefault = true\n# config A\n');
  writeFileSync(join(root, ...BASELINE_PATH.split('/')), committedBaseline);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'A']);
  const a = git(root, ['rev-parse', 'HEAD']).trim();
  writeFileSync(join(root, CONFIG_PATH), '[extend]\nuseDefault = true\n[allowlist]\npaths = [".*"]\n# config B\n');
  writeFileSync(
    join(root, ...BASELINE_PATH.split('/')),
    `${Array.from({ length: 16 }, (_, i) => fingerprint(i + 1)).join('\n')}\ndocs/x.md:generic-api-key:99\n`,
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'B']);
  const b = git(root, ['rev-parse', 'HEAD']).trim();
  const atA = { config: git(root, ['show', `${a}:${CONFIG_PATH}`]), baseline: git(root, ['show', `${a}:${BASELINE_PATH}`]) };

  it('readInputs(root, A) returns the config and baseline of A while HEAD is B', () => {
    const inputs = readInputs(root, a);
    expect(inputs.configRef).toBe(a);
    expect(inputs.configText).toBe(atA.config);
    expect(inputs.baselineLines).toEqual(validateBaseline(atA.baseline, { count: BASELINE_COUNT }));
    expect(() => readInputs(root, b)).toThrow(BaselineError);
  });

  it('--ref A --scan B passes validation and mounts exactly A config and A baseline while scanning B', () => {
    const docker = fakeDocker([], 0);
    const report = join(root, 'out', 'a.json');
    expect(main(['--root', root, '--ref', a, '--scan', b, '--report', report], { runDocker: docker.run })).toBe(0);
    expect(docker.calls).toHaveLength(1);
    const [call] = docker.calls;
    expect(call?.config).toBe(atA.config);
    expect(call?.baseline).toBe(`${validateBaseline(atA.baseline, { count: BASELINE_COUNT }).join('\n')}\n`);
    expect(call?.args).toContain(`--log-opts=${LOG_OPTS} ${b}`);
    expect(readFileSync(report, 'utf8')).toBe('[]');
  });

  it('--ref B (the commit-less baseline) exits 2 before docker runs', () => {
    const docker = fakeDocker([], 0);
    expect(main(['--root', root, '--ref', b, '--scan', b, '--report', join(root, 'out', 'b.json')], { runDocker: docker.run })).toBe(2);
    expect(docker.calls).toHaveLength(0);
  });
});

describe('gitleaks-full: exit status and report together decide the verdict (PR #46 r1 G4)', () => {
  const lines = Array.from({ length: 2 }, (_, i) => fingerprint(i + 1));
  const run = (findings: unknown[], status: number | null) => {
    const dir = mkdtempSync(join(tmpdir(), 'gitleaks-full-scan-'));
    temps.push(dir);
    return scan({
      root: repoRoot,
      sha: SHA,
      configText: 'x',
      baselineLines: lines,
      report: join(dir, 'r.json'),
      runDocker: fakeDocker(findings, status).run,
    });
  };

  it('exit 0 with an empty array is clean; exit 1 is findings even when the array is empty; findings count', () => {
    expect(run([], 0)).toEqual({ status: 'clean', findings: 0 });
    expect(run([], 1)).toEqual({ status: 'findings', findings: 0 });
    expect(run([{ RuleID: 'generic-api-key' }], 1)).toEqual({ status: 'findings', findings: 1 });
  });

  it('any other exit status, or a report that is not an array, is an error', () => {
    expect(() => run([], 2)).toThrow(/did not complete \(exit 2\)/u);
    expect(() => run([], null)).toThrow(/did not complete/u);
    const dir = mkdtempSync(join(tmpdir(), 'gitleaks-full-scan-'));
    temps.push(dir);
    const notArray = (args: string[]) => {
      const out = (/,src=(.*?),dst=\/out$/u.exec(args.find((x) => x.endsWith(',dst=/out')) ?? '') ?? [])[1] ?? '';
      writeFileSync(join(out, 'gitleaks-full.json'), '{}');
      return { status: 0, stderr: '' };
    };
    expect(() =>
      scan({ root: repoRoot, sha: SHA, configText: 'x', baselineLines: lines, report: join(dir, 'r.json'), runDocker: notArray }),
    ).toThrow(/not a findings array/u);
  });
});
