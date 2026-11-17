/**
 * Stage 2 of ADR-0023 amendment L item 3 (D-ARCH-128; TASK-286) in tools/ci/lane-scope.mjs and the pinned tooling
 * steps: the tested base TOOLS_REF = HEAD^1 of the test merge (PR46-SEC-17), proofs voided when the tested base changed
 * a lane A input after the proof run (PR46-SEC-16), the classification ci-gate recomputes and compares (PR46-SEC-12),
 * and the D-ORCH-103 regression: a PR whose merge base predates tools/ci/lane-scope.mjs (PR #53, run 43736296983,
 * MODULE_NOT_FOUND) now starts lane A, because the tooling comes from the current main, not from the merge base.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';
import {
  CI_GATE_TOOLING_SCRIPT_TESTED_BASE,
  CI_GATE_TOOLING_SCRIPT_TESTED_BASE_V2,
  FAST_LANE_TOOLING_SCRIPT,
  FAST_LANE_TOOLING_SCRIPT_V2,
} from './check-workflow-policy.mjs';
import {
  CLASSIFICATION_KEYS,
  MAX_BASE_COMMITS,
  baseChangedAt,
  FAST_LANE_OUTPUT_ENV,
  checkoutProblem,
  classify,
  fastLaneProblems,
  formatClassification,
  gate,
  gateVerdictStage2,
  lookupProofs,
  main,
  parseArgs,
  parseClassification,
  proofBasePath,
  proofSteps,
  scansProblems,
  testedBase,
} from './lane-scope.mjs';
import type { Api, GateInputStage2, ProofSteps } from './lane-scope.mjs';

const repoRoot = findRepoRoot();
const stage2Text = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const INPUTS = ['docs/03-architecture/api/**', 'docs/05-quality/tests/gherkin-test-map.md'];
const MANIFEST = JSON.stringify({ tooling_inputs: INPUTS });

function git(cwd: string, args: string[], date?: string): string {
  const env = date === undefined ? process.env : { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  const result = spawnSync(
    'git',
    ['-c', 'core.autocrlf=false', '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    { cwd, encoding: 'utf8', timeout: 30_000, windowsHide: true, env },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function commit(root: string, files: Record<string, string>, message: string, date?: string): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '--allow-empty', '-m', message], date);
  return git(root, ['rev-parse', 'HEAD']);
}

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** The real tools/ci modules (lane-scope.mjs and every sibling it may import), as the files of a commit. */
function toolsCi(): Record<string, string> {
  const dir = join(repoRoot, 'tools', 'ci');
  return Object.fromEntries(
    readdirSync(dir)
      .filter((name) => name.endsWith('.mjs'))
      .map((name) => [`tools/ci/${name}`, readFileSync(join(dir, name), 'utf8')]),
  );
}

/**
 * The D-ORCH-103 shape: main M0 predates tools/ci altogether; the PR branch forks there (merge base M0) and changes
 * code; main then gains the tools (M1, with the stage-2 ci.yml) and the checkout is GitHub's test merge (M1, F1).
 */
function stalePr() {
  const root = tempDir('lane-scope-s2-');
  git(root, ['init', '-q', '-b', 'main']);
  const m0 = commit(
    root,
    { 'README.md': 'base\n', 'apps/api/src/a.ts': 'export const a = 1;\n', 'tools/quality/required-suites.json': MANIFEST },
    'base',
  );
  git(root, ['checkout', '-q', '-b', 'feat']);
  const f1 = commit(root, { 'apps/api/src/a.ts': 'export const a = 2;\n' }, 'code');
  git(root, ['checkout', '-q', 'main']);
  const m1 = commit(root, { ...toolsCi(), '.github/workflows/ci.yml': stage2Text }, 'tools');
  git(root, ['checkout', '-q', '--detach', m1]);
  git(root, ['merge', '-q', '--no-ff', '--no-edit', f1]);
  const merge = git(root, ['rev-parse', 'HEAD']);
  return { root, m0, f1, m1, merge };
}

/**
 * One stale-PR repository shared by the cases that only read it (fewer git and bash processes in the parallel unit
 * run); a case that moves HEAD does so through `at`, which puts the test merge back.
 */
let shared: ReturnType<typeof stalePr> | undefined;
const sharedPr = () => (shared ??= stalePr());
function at<T>(pr: ReturnType<typeof stalePr>, rev: string, body: () => T): T {
  git(pr.root, ['checkout', '-q', '--detach', rev]);
  try {
    return body();
  } finally {
    git(pr.root, ['checkout', '-q', '--detach', pr.merge]);
  }
}

/** Git for Windows' bash on win32 (the runner's bash elsewhere): the pinned step scripts run under it as on the runner. */
function bash(): string {
  if (process.platform !== 'win32') return 'bash';
  const exec = spawnSync('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  const found = [join(exec, '..', '..', '..', 'bin', 'bash.exe'), join(exec, '..', '..', '..', 'usr', 'bin', 'bash.exe')].find((path) =>
    existsSync(path),
  );
  if (found === undefined) throw new Error('bash (Git for Windows) not found next to git');
  return found;
}

/** Runs a pinned step script the way the runner does (bash, the step's env files), returning $GITHUB_ENV as a map. */
function runStep(root: string, script: readonly string[], env: Record<string, string>) {
  const temp = tempDir('lane-scope-runner-').replace(/\\/gu, '/');
  const files = { GITHUB_ENV: `${temp}/env`, GITHUB_STEP_SUMMARY: `${temp}/summary.md` };
  writeFileSync(files.GITHUB_ENV, '');
  writeFileSync(files.GITHUB_STEP_SUMMARY, '');
  const result = spawnSync(bash(), ['-c', script.join('\n')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
    env: { ...process.env, RUNNER_TEMP: temp, ...files, ...env },
  });
  const written = Object.fromEntries(
    readFileSync(files.GITHUB_ENV, 'utf8')
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
  return { status: result.status, stderr: result.stderr, env: written, summary: readFileSync(files.GITHUB_STEP_SUMMARY, 'utf8'), temp };
}

describe('[PR46-SEC-17] [D-ORCH-103] the bootstrap: a PR whose merge base lacks the tooling starts lane A', () => {
  it('precondition: neither the merge base nor the PR head has tools/ci/lane-scope.mjs (the stage-1 bootstrap had no tool: MODULE_NOT_FOUND)', () => {
    const { root, m0, f1 } = sharedPr();
    for (const rev of [m0, f1]) {
      const shown = spawnSync('git', ['cat-file', '-e', `${rev}:tools/ci/lane-scope.mjs`], { cwd: root, windowsHide: true });
      expect(shown.status).not.toBe(0);
    }
  });

  it('fast-lane: the pinned tooling step takes every gate tool from HEAD^1 (current main) and sets TOOLS_REF; the classify command then runs', () => {
    const { root, m0, f1, m1 } = sharedPr();
    const step = runStep(root, FAST_LANE_TOOLING_SCRIPT, { GITHUB_EVENT_NAME: 'pull_request', RANGE_BASE: m0, RANGE_HEAD: f1 });
    expect(step.stderr).toBe('');
    expect(step.status).toBe(0);
    expect(step.env.TOOLS_REF).toBe(m1);
    expect(step.env.GATE_LANE_SCOPE).toBe(`${step.temp}/base/tools/ci/lane-scope.mjs`);
    expect(existsSync(step.env.GATE_LANE_SCOPE ?? '')).toBe(true);
    expect(step.env.GATE_CHECK_WORKFLOW_POLICY).toBe(`${step.temp}/base/tools/ci/check-workflow-policy.mjs`);
    expect(step.summary).toContain(`tested base \`${m1.slice(0, 7)}\``);
    expect(step.summary).not.toContain('bootstrap');

    // The classify step's exact command (CLASSIFY_RUN) against that extracted tool, in the test-merge checkout.
    const out = join(step.temp, 'out');
    const envFile = join(step.temp, 'classify-env');
    const run = spawnSync(
      process.execPath,
      [
        step.env.GATE_LANE_SCOPE ?? '',
        ...['--root', root, '--base', m0, '--head', f1, '--before', '', '--event', 'pull_request', '--pr', '53', '--head-ref', 'test/x'],
        ...['--tools-ref', m1, '--lookup', '--env', envFile, '--output', out],
      ],
      { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60_000, env: { ...process.env, GITHUB_REPOSITORY: '', GH_TOKEN: '' } },
    );
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    const outputs = readFileSync(out, 'utf8');
    expect(outputs).toContain(`tools_ref=${m1}\n`);
    expect(outputs).toContain('mode=full\n');
    expect(outputs).toMatch(/^classification=mode=full,code_changed=true,/mu);
    expect(readFileSync(envFile, 'utf8')).toBe('CODE=true\nLINT_CONTROLS=false\n');
  });

  it('ci-gate: the pinned tooling step takes lane-scope and the scan configuration from the tested base too', () => {
    const { root, m0, f1, m1 } = sharedPr();
    const step = runStep(root, CI_GATE_TOOLING_SCRIPT_TESTED_BASE, { GITHUB_EVENT_NAME: 'pull_request', RANGE_BASE: m0, RANGE_HEAD: f1 });
    expect(step.status).toBe(0);
    expect(step.env.TOOLS_REF).toBe(m1);
    expect(step.env.GATE_LANE_SCOPE).toBe(`${step.temp}/gates/base/tools/ci/lane-scope.mjs`);
    expect(existsSync(step.env.GATE_LANE_SCOPE ?? '')).toBe(true);
    // The record checker is on the tested base (current main), so the record is enforced although the merge base lacks it.
    expect(step.env.RECORD_MODE).toBe('enforce');
  });

  it('fails closed when the checkout is not the test merge of the PR head into a descendant of its base', () => {
    const pr = sharedPr();
    const { root, m0, f1, m1 } = pr;
    // HEAD^2 is not the PR head.
    expect(runStep(root, FAST_LANE_TOOLING_SCRIPT, { GITHUB_EVENT_NAME: 'pull_request', RANGE_BASE: m0, RANGE_HEAD: m0 }).status).toBe(1);
    // RANGE_BASE is not an ancestor of HEAD^1.
    expect(runStep(root, FAST_LANE_TOOLING_SCRIPT, { GITHUB_EVENT_NAME: 'pull_request', RANGE_BASE: f1, RANGE_HEAD: f1 }).status).toBe(1);
    // Not a merge at all (HEAD^2 missing).
    const notMerge = at(pr, m1, () =>
      runStep(root, CI_GATE_TOOLING_SCRIPT_TESTED_BASE, { GITHUB_EVENT_NAME: 'pull_request', RANGE_BASE: m0, RANGE_HEAD: f1 }),
    );
    expect(notMerge.status).toBe(1);
    expect(notMerge.env.GATE_LANE_SCOPE).toBeUndefined();
  });

  it('on a push (CI_MAIN_FAST_LANE) the tested base is the pushed range base', () => {
    const pr = sharedPr();
    const { root, m0, m1 } = pr;
    const step = at(pr, m1, () => runStep(root, FAST_LANE_TOOLING_SCRIPT, { GITHUB_EVENT_NAME: 'push', RANGE_BASE: m0, RANGE_HEAD: m1 }));
    expect(step.status).toBe(0);
    expect(step.env.TOOLS_REF).toBe(m0);
    // m0 has no tools/ci: every tool is the head's (bootstrap), and the summary says so.
    expect(step.env.GATE_LANE_SCOPE).toBe(`${step.temp}/head/tools/ci/lane-scope.mjs`);
    expect(step.summary).toContain('head (bootstrap: not on the tested base yet)');
  });
});

describe('[D-ARCH-126] [PR46-SEC-17] the stage-2 classify CLI on a docs push', () => {
  /**
   * The PR pushes a docs commit after its code commit; main's tested base (M1) has meanwhile made docs/special/**
   * a tooling input that the merge base's manifest (M0) does not list.
   */
  function docsPush(path: string) {
    const { root, m0, f1, m1 } = stalePr();
    git(root, ['checkout', '-q', 'main']);
    const m2 = commit(
      root,
      { 'tools/quality/required-suites.json': JSON.stringify({ tooling_inputs: [...INPUTS, 'docs/special/**'] }) },
      'manifest',
    );
    git(root, ['checkout', '-q', 'feat']);
    const f2 = commit(root, { [path]: 'note\n' }, 'docs');
    git(root, ['checkout', '-q', '--detach', m2]);
    git(root, ['merge', '-q', '--no-ff', '--no-edit', f2]);
    return { root, m0, f1, f2, m1, m2 };
  }
  const classifyCli = (root: string, args: string[]) => {
    const out = join(tempDir('lane-scope-out-'), 'out');
    const envFile = `${out}.env`;
    const status = main([...args, '--lookup', '--env', envFile, '--output', out], { env: {}, api: () => ({ ok: false, problem: 'none' }) });
    return { status, outputs: readFileSync(out, 'utf8'), env: readFileSync(envFile, 'utf8') };
  };

  it('a docs push with no proof candidate at all (pending or red code) stays light and BLOCKED; the classification names the tested base', () => {
    const { root, m0, f1, f2, m2 } = docsPush('docs/notes/x.md');
    const args = ['--root', root, '--base', m0, '--head', f2, '--before', f1, '--pr', '53', '--head-ref', 'test/x', '--tools-ref', m2];
    const result = classifyCli(root, args);
    expect(result.status).toBe(0);
    // The fake API answers nothing: no candidate run, so nothing was voided by the base (TASK-287 narrows run-full).
    expect(result.env).toBe('CODE=false\nLINT_CONTROLS=false\n');
    expect(result.outputs).toContain('push_scope=docs\n');
    expect(result.outputs).toContain('mode=light\n');
    expect(result.outputs).toContain(`classification=mode=light,code_changed=false,pr_docs_only=false,lint_controls=false,`);
    expect(result.outputs).toContain(`,tools_ref=${m2}\n`);
  });

  it("DOCS_ONLY_PATHS reads the TESTED base's tooling inputs: a push on a path main made a tooling input runs full", () => {
    const { root, m0, f1, f2, m2 } = docsPush('docs/special/x.md');
    const args = ['--root', root, '--base', m0, '--head', f2, '--before', f1, '--pr', '53', '--head-ref', 'test/x', '--tools-ref', m2];
    const result = classifyCli(root, args);
    expect(result.status).toBe(0);
    expect(result.env).toBe('CODE=true\nLINT_CONTROLS=false\n');
    expect(result.outputs).toContain('push_scope=code\n');
    expect(result.outputs).toContain('mode=full\n');
  });
});

describe('[PR46-SEC-17] testedBase (lane-scope verifies --tools-ref against the checkout)', () => {
  it('accepts HEAD^1 of the test merge; refuses another commit, a non-merge checkout and a base outside its history', () => {
    const { root, m0, f1, m1 } = sharedPr();
    expect(testedBase({ root, toolsRef: m1, base: m0, head: f1, event: 'pull_request' })).toEqual({ sha: m1 });
    expect(testedBase({ root, toolsRef: m0, base: m0, head: f1, event: 'pull_request' })).toMatchObject({
      problem: expect.stringContaining('HEAD^1'),
    });
    expect(testedBase({ root, toolsRef: '', base: m0, head: f1, event: 'pull_request' })).toMatchObject({ problem: expect.any(String) });
    expect(testedBase({ root, toolsRef: m1, base: m0, head: m0, event: 'pull_request' })).toMatchObject({
      problem: expect.stringContaining('HEAD^2'),
    });
    expect(testedBase({ root, toolsRef: m1, base: f1, head: f1, event: 'pull_request' })).toMatchObject({
      problem: expect.stringContaining('ancestor'),
    });
    expect(testedBase({ root, toolsRef: '', base: '', head: m1, event: 'push' })).toEqual({ sha: '' });
    expect(testedBase({ root, toolsRef: m0, base: m0, head: m1, event: 'push' })).toEqual({ sha: m0 });
    expect(testedBase({ root, toolsRef: m1, base: m0, head: m1, event: 'push' })).toMatchObject({ problem: expect.any(String) });
  });

  it('the CLI exits 2 on a wrong --tools-ref (fail closed) and needs --lookup with it', () => {
    const { root, m0, f1 } = sharedPr();
    const args = ['--root', root, '--base', m0, '--head', f1, '--pr', '53', '--head-ref', 'test/x', '--lookup'];
    expect(main([...args, '--tools-ref', m0], { env: {}, api: () => ({ ok: false, problem: 'none' }) })).toBe(2);
    expect(parseArgs(['--root', root, '--base', m0, '--head', f1, '--tools-ref', m0])).toMatchObject({
      error: '--tools-ref needs --lookup (stage 2)',
    });
    expect(parseArgs(['--root', root, '--gate', '--tools-ref', m0])).toMatchObject({ error: expect.stringContaining('--gate') });
    expect(parseArgs(['--root', root, '--gate', '--env', 'x'])).toMatchObject({ error: expect.stringContaining('--gate') });
  });
});

describe('[PR46-SEC-16] a proof is void when the tested base changed a lane A input after the proof run', () => {
  it.each([
    ['package.json', true],
    ['package-lock.json', true],
    ['.npmrc', true],
    ['.gitleaks.toml', true],
    ['eslint.config.mjs', true],
    ['.node-version', true],
    ['README.md', false],
    ['CLAUDE.md', false],
    ['.github/workflows/ci.yml', true],
    ['.github/CODEOWNERS', true],
    ['prisma/schema.prisma', true],
    ['tools/ci/lane-scope.mjs', true],
    ['tools/quality/required-suites.json', true],
    ['.semgrep/rules.yml', true],
    ['docs/03-architecture/api/openapi.yaml', true],
    ['docs/05-quality/tests/gherkin-test-map.md', true],
    ['docs/05-quality/security/PR-0053-x.md', false],
    ['.claude/agent-memory/x.md', false],
    // PR #55 R1-M1 / PR55-SEC-03 (D-TASK286-06): the lint controls and tools/deps are lane A inputs too.
    ['tools/eslint-rules/no-raw-sql.mjs', true],
    ['tools/stylelint-rules/x.mjs', true],
    ['tools/lint/lint-fixtures.mjs', true],
    ['tools/test-support/process.ts', true],
    ['tests/fixtures/lint/bad-raw-any.ts', true],
    ['tests/fixtures/semgrep/x.ts', true],
    // PR #55 R2-n4 (N09): a non-lint fixture the unit suites read is in the set through tests/fixtures/**.
    ['tests/fixtures/sql/raw-statement-corpus.json', true],
    ['tools/deps/prisma-engines.json', true],
    // An application file the PR does not change: a disjoint semantic conflict is the D-ORCH-042 post-merge gate's.
    ['apps/api/src/other.ts', false],
  ])('%s -> %s', (path, expected) => {
    expect(proofBasePath(path, INPUTS)).toBe(expected);
  });

  it('[R1-M1] [PR55-SEC-03] P1 (b): any path the PR range itself changes is a lane A input of this proof, docs included', () => {
    const own = new Set(['apps/api/src/a.ts', 'docs/07-ops/CI-CD.md']);
    expect(proofBasePath('apps/api/src/a.ts', INPUTS, own)).toBe(true);
    expect(proofBasePath('docs/07-ops/CI-CD.md', INPUTS, own)).toBe(true);
    expect(proofBasePath('apps/api/src/b.ts', INPUTS, own)).toBe(false);
    expect(proofBasePath('docs/07-ops/DEPLOYMENT.md', INPUTS, own)).toBe(false);
  });

  /** main with a docs commit at 10:00 and, optionally, a lane A input change at 12:00 (committer dates). */
  function mainHistory(change?: Record<string, string>) {
    const root = tempDir('lane-scope-base-');
    git(root, ['init', '-q', '-b', 'main']);
    commit(root, { 'README.md': 'base\n', 'tools/quality/required-suites.json': MANIFEST }, 'base', '2026-11-14T08:00:00Z');
    commit(root, { 'docs/x.md': 'x\n' }, 'docs', '2026-11-14T10:00:00Z');
    if (change !== undefined) commit(root, change, 'change', '2026-11-14T12:00:00Z');
    commit(root, { 'docs/y.md': 'y\n' }, 'docs 2', '2026-11-14T13:00:00Z');
    return { root, tip: git(root, ['rev-parse', 'HEAD']) };
  }
  /** The two histories the cases share (read-only): a package.json change at 12:00, or a docs change at 12:00. */
  const histories = new Map<string, ReturnType<typeof mainHistory>>();
  const historyWith = (kind: 'package' | 'docs') => {
    const found = histories.get(kind);
    if (found !== undefined) return found;
    const made = mainHistory(kind === 'package' ? { 'package.json': '{"name":"x"}\n' } : { 'docs/z.md': 'z\n' });
    histories.set(kind, made);
    return made;
  };

  it('baseChangedAt is the newest first-parent commit on a proofBasePath (docs commits do not count)', () => {
    const base = historyWith('package');
    expect(baseChangedAt(base.root, base.tip, INPUTS)).toBe(Date.parse('2026-11-14T12:00:00Z'));
    const docsOnly = historyWith('docs');
    // Only the root commit (08:00, which added the manifest) touches a lane A input.
    expect(baseChangedAt(docsOnly.root, docsOnly.tip, INPUTS)).toBe(Date.parse('2026-11-14T08:00:00Z'));
    expect(baseChangedAt(docsOnly.root, 'f'.repeat(40), INPUTS)).toBeNull();
    expect(MAX_BASE_COMMITS).toBe(500);
  });

  it('beyond the history window the oldest commit read dates the base (conservative), within it 0 means none', () => {
    const docsOnly = historyWith('docs');
    // Two docs commits read (13:00, 12:00), no lane A input among them: the window's oldest (12:00) dates it.
    expect(baseChangedAt(docsOnly.root, docsOnly.tip, INPUTS, 2)).toBe(Date.parse('2026-11-14T12:00:00Z'));
    // A history with no lane A input at all, shorter than the window: 0.
    const root = tempDir('lane-scope-base-');
    git(root, ['init', '-q', '-b', 'main']);
    const tip = commit(root, { 'docs/x.md': 'x\n' }, 'docs only', '2026-11-14T08:00:00Z');
    expect(baseChangedAt(root, tip, INPUTS)).toBe(0);
  });

  const STEPS = proofSteps(stage2Text) as ProofSteps;
  const SHA = 'a'.repeat(40);
  const runAt = (created: string) => ({
    id: 11,
    head_sha: SHA,
    head_branch: 'feat/x',
    head_repository: { full_name: 'o/r' },
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    created_at: created,
    path: '.github/workflows/ci.yml',
    pull_requests: [
      {
        number: 53,
        base: { ref: 'main', repo: { url: 'https://api.github.com/repos/o/r' } },
        head: { ref: 'feat/x', repo: { url: 'https://api.github.com/repos/o/r' } },
      },
    ],
  });
  const stage2Jobs = {
    jobs: [
      {
        name: 'fast-lane',
        status: 'completed',
        conclusion: 'success',
        steps: STEPS.fastLane.map((s) => ({ name: s.name, conclusion: s.mayBeSkipped ? 'skipped' : 'success' })),
      },
      {
        name: 'ci-gate',
        status: 'completed',
        conclusion: 'failure',
        steps: [
          ...STEPS.scans.map((name) => ({ name, conclusion: 'success' })),
          { name: 'Security-owned paths need a review record (PR5-SEC-04, PR10-SEC-04)', conclusion: 'failure' },
        ],
      },
      { name: 'security-integration', status: 'completed', conclusion: 'success', steps: [] },
    ],
  };
  const api =
    (created: string): Api =>
    (path) => {
      if (path.startsWith('repos/o/r/actions/workflows/ci.yml/runs?head_sha='))
        return { ok: true, json: { workflow_runs: [runAt(created)] } };
      if (path === 'repos/o/r/actions/runs/11/jobs?per_page=100') return { ok: true, json: stage2Jobs };
      if (path.startsWith('repos/o/r/pulls?'))
        return {
          ok: true,
          json: [{ number: 53, base: { ref: 'main', repo: { full_name: 'o/r' } }, head: { ref: 'feat/x', repo: { full_name: 'o/r' } } }],
        };
      if (path.startsWith('repos/o/r/issues/53/events')) return { ok: true, json: [] };
      return { ok: false, problem: `unexpected ${path}` };
    };
  const lookup = (created: string, changedAt: number | null | undefined) =>
    lookupProofs({ api: api(created), repo: 'o/r', identical: [SHA], steps: STEPS, pr: '53', headRef: 'feat/x', baseChangedAt: changedAt });

  it('a main commit on package.json newer than the candidate run gives no proof; the same commit on docs/** keeps it', () => {
    const changed = historyWith('package');
    const docs = historyWith('docs');
    const created = '2026-11-14T11:00:00Z';
    const voided = lookup(created, baseChangedAt(changed.root, changed.tip, INPUTS));
    expect(voided).toMatchObject({ codeProof: '', securityProof: '' });
    expect(voided.notes.join('\n')).toContain('tested an older base');
    expect(lookup(created, baseChangedAt(docs.root, docs.tip, INPUTS))).toMatchObject({
      codeProof: `11:${SHA}`,
      securityProof: `11:${SHA}`,
    });
    // A run created after the change tested the new base: a proof again.
    expect(lookup('2026-11-14T12:30:00Z', baseChangedAt(changed.root, changed.tip, INPUTS)).codeProof).toBe(`11:${SHA}`);
    // The change at the same second as the run creation voids it (at or before).
    expect(lookup('2026-11-14T12:00:00Z', baseChangedAt(changed.root, changed.tip, INPUTS)).codeProof).toBe('');
  });

  it('[R1-M1] baseChangedAt dates a main commit on a path the PR changes (P1 (b)); another app file does not; an unknown range gives null', () => {
    const app = mainHistory({ 'apps/api/src/a.ts': 'export const a = 3;\n' });
    const changeAt = Date.parse('2026-11-14T12:00:00Z');
    const rootAt = Date.parse('2026-11-14T08:00:00Z');
    expect(baseChangedAt(app.root, app.tip, INPUTS, MAX_BASE_COMMITS, ['apps/api/src/a.ts', 'docs/z.md'])).toBe(changeAt);
    expect(baseChangedAt(app.root, app.tip, INPUTS, MAX_BASE_COMMITS, ['apps/api/src/b.ts'])).toBe(rootAt);
    expect(baseChangedAt(app.root, app.tip, INPUTS)).toBe(rootAt);
    expect(baseChangedAt(app.root, app.tip, INPUTS, MAX_BASE_COMMITS, null)).toBeNull();
    const created = '2026-11-14T11:00:00Z';
    expect(lookup(created, baseChangedAt(app.root, app.tip, INPUTS, MAX_BASE_COMMITS, ['apps/api/src/a.ts'])).codeProof).toBe('');
    // V5 (accepted by the C2 ruling): main changed an app file the PR does not change: the proof stands.
    expect(lookup(created, baseChangedAt(app.root, app.tip, INPUTS, MAX_BASE_COMMITS, ['apps/api/src/b.ts'])).codeProof).toBe(`11:${SHA}`);
  });

  it.each([
    ['V3 a lint rule source', { 'tools/eslint-rules/no-raw-sql.mjs': 'export default {};\n' }],
    ['V3b a lint fixture', { 'tests/fixtures/lint/x.ts': 'export {};\n' }],
    ['V4 the schema-engine pin', { 'tools/deps/prisma-engines.json': '{}\n' }],
  ])('[PR55-SEC-03] %s changed on main after the proof run: no proof', (_title, change) => {
    const base = mainHistory(change);
    const voided = lookup('2026-11-14T11:00:00Z', baseChangedAt(base.root, base.tip, INPUTS, MAX_BASE_COMMITS, ['apps/api/src/a.ts']));
    expect(voided.codeProof).toBe('');
    expect(voided.notes.join('\n')).toContain('tested an older base');
  });

  it('an unreadable tested-base history gives no proof at all; stage 1 (undefined) does not check', () => {
    expect(lookup('2026-11-14T11:00:00Z', null)).toMatchObject({
      codeProof: '',
      securityProof: '',
      notes: [expect.stringContaining('fail closed')],
    });
    expect(lookup('2020-01-01T00:00:00Z', undefined).codeProof).toBe(`11:${SHA}`);
  });

  it('a stage-1 run (scans job) is no proof for a stage-2 workflow: its scans are not in ci-gate', () => {
    expect(scansProblems(stage2Jobs, STEPS.scans, 'ci-gate')).toEqual([]);
    expect(scansProblems(stage2Jobs, STEPS.scans, 'scans')).toEqual(['0 jobs named scans']);
  });
});

describe('[PR46-SEC-12] the classification ci-gate recomputes and compares (rule (g))', () => {
  const values = {
    mode: 'light',
    code_changed: 'false',
    pr_docs_only: 'false',
    lint_controls: 'false',
    security_paths: 'true',
    record_ok: 'true',
    code_proof: `41:${'c'.repeat(40)}`,
    security_proof: '',
    security_integration_due: 'true',
    tools_ref: 'd'.repeat(40),
  };
  const text = formatClassification(values);

  it('round-trips in CLASSIFICATION_KEYS order and refuses anything malformed', () => {
    expect(CLASSIFICATION_KEYS).toEqual(Object.keys(values));
    expect(parseClassification(text)).toEqual(values);
    for (const bad of [
      '',
      text.replace('mode=light', 'mode=fast'),
      text.replace('mode=light', 'mode=full'),
      text.replace('record_ok=true', 'record_ok=yes'),
      text.replace('code_proof=41:', 'code_proof=x41:'),
      text.replace(`tools_ref=${'d'.repeat(40)}`, 'tools_ref=main'),
      text.replace('mode=light,', ''),
      `${text},extra=1`,
      text.replace('code_changed=false,pr_docs_only=false', 'pr_docs_only=false,code_changed=false'),
    ])
      expect(parseClassification(bad)).toBeNull();
  });

  const input = (overrides: Partial<GateInputStage2> = {}): GateInputStage2 => ({
    event: 'pull_request',
    fastLane: 'success',
    securityIntegration: 'success',
    classification: text,
    fastLaneClassification: text,
    thisRunCodeProblems: () => [],
    ...overrides,
  });

  it('MERGE-READY when both classifications agree and the rules hold', () => {
    expect(gateVerdictStage2(input())).toEqual({ ready: true, reasons: [] });
  });

  it.each<[string, Partial<GateInputStage2>, string[]]>([
    [
      '(g) fast-lane classified differently',
      { fastLaneClassification: text.replace('security_integration_due=true', 'security_integration_due=false') },
      ['classification mismatch (fast-lane and ci-gate disagree)'],
    ],
    [
      '(g) fast-lane classification forged as a full run',
      { fastLaneClassification: text.replace('mode=light,code_changed=false', 'mode=full,code_changed=true') },
      ['classification mismatch (fast-lane and ci-gate disagree)'],
    ],
    ['(f) ci-gate classification missing', { classification: '' }, ['classification missing']],
    [
      '(a) draft PR (fast-lane skipped, no classification)',
      { fastLane: 'skipped', fastLaneClassification: '' },
      ['fast-lane skipped (a draft PR is not gated: mark it ready for review)', 'classification mismatch (fast-lane and ci-gate disagree)'],
    ],
    [
      '(c) a docs push without a code proof',
      {
        classification: text.replace(/code_proof=[^,]*/u, 'code_proof='),
        fastLaneClassification: text.replace(/code_proof=[^,]*/u, 'code_proof='),
      },
      ['no code proof for this tree'],
    ],
    ['(e) security-integration red', { securityIntegration: 'failure' }, ['security-integration red']],
    ['(e) security-integration pending (not run)', { securityIntegration: 'skipped' }, ['security-integration pending (not run)']],
  ])('%s', (_title, overrides, reasons) => {
    expect(gateVerdictStage2(input(overrides))).toEqual({ ready: false, reasons });
  });

  it('(b) a code push: this run must have run every CODE-gated step', () => {
    const full = formatClassification({ ...values, mode: 'full', code_changed: 'true', code_proof: '' });
    expect(gateVerdictStage2(input({ classification: full, fastLaneClassification: full }))).toEqual({ ready: true, reasons: [] });
    const verdict = gateVerdictStage2(
      input({ classification: full, fastLaneClassification: full, thisRunCodeProblems: () => ['Unit tests: skipped'] }),
    );
    expect(verdict.reasons).toEqual(['code gates skipped on a code push (Unit tests: skipped)']);
  });

  it('gate() takes the stage-2 rules (stage 1 retired: no topology switch, TASK-287 part 287-A)', () => {
    const root = tempDir('lane-scope-gate-');
    git(root, ['init', '-q', '-b', 'main']);
    commit(root, { '.github/workflows/ci.yml': stage2Text }, 'stage 2');
    const stage2Env = {
      GITHUB_EVENT_NAME: 'pull_request',
      FAST_LANE: 'success',
      SECURITY_INTEGRATION: 'success',
      CLASSIFICATION: text,
      FAST_LANE_CLASSIFICATION: text,
    };
    const none: Api = () => ({ ok: false, problem: 'not called' });
    expect(gate({ root, env: stage2Env, api: none })).toEqual({ ready: true, reasons: [] });
    expect(gate({ root, env: { ...stage2Env, FAST_LANE_CLASSIFICATION: '' }, api: none }).ready).toBe(false);
  });

  it('[PR55-SEC-05] the separate fast-lane outputs passed into the aggregation must equal the own classification', () => {
    const root = tempDir('lane-scope-gate-');
    git(root, ['init', '-q', '-b', 'main']);
    commit(root, { '.github/workflows/ci.yml': stage2Text }, 'stage 2');
    const none: Api = () => ({ ok: false, problem: 'not called' });
    const base = {
      GITHUB_EVENT_NAME: 'pull_request',
      FAST_LANE: 'success',
      SECURITY_INTEGRATION: 'success',
      CLASSIFICATION: text,
      FAST_LANE_CLASSIFICATION: text,
    };
    expect(FAST_LANE_OUTPUT_ENV).toEqual({
      mode: 'FAST_LANE_MODE',
      code_proof: 'FAST_LANE_CODE_PROOF',
      security_integration_due: 'FAST_LANE_SECURITY_INTEGRATION_DUE',
      tools_ref: 'FAST_LANE_TOOLS_REF',
    });
    const equal = {
      FAST_LANE_MODE: values.mode,
      FAST_LANE_CODE_PROOF: values.code_proof,
      FAST_LANE_SECURITY_INTEGRATION_DUE: values.security_integration_due,
      FAST_LANE_TOOLS_REF: values.tools_ref,
    };
    // Absent (the live ci.yml until the workflow half lands) and equal: MERGE-READY.
    expect(gate({ root, env: base, api: none })).toEqual({ ready: true, reasons: [] });
    expect(gate({ root, env: { ...base, ...equal }, api: none })).toEqual({ ready: true, reasons: [] });
    // A differing tools_ref (security-integration would read other manifests) or any other differing output: BLOCKED.
    expect(gate({ root, env: { ...base, ...equal, FAST_LANE_TOOLS_REF: 'e'.repeat(40) }, api: none }).reasons).toEqual([
      'fast-lane outputs mismatch (tools_ref)',
    ]);
    expect(
      gate({ root, env: { ...base, ...equal, FAST_LANE_MODE: 'full', FAST_LANE_SECURITY_INTEGRATION_DUE: 'false' }, api: none }).reasons,
    ).toEqual(['fast-lane outputs mismatch (mode, security_integration_due)']);
    // Present but empty is compared too (an expression that evaluates to nothing is not "absent").
    expect(gate({ root, env: { ...base, FAST_LANE_CODE_PROOF: '' }, api: none }).reasons).toEqual([
      'fast-lane outputs mismatch (code_proof)',
    ]);
  });
});

describe('[R1-m4] [R1-n6] the classify CLI binds a proof to the tested base end to end (main() wiring of PR46-SEC-16)', () => {
  const A_LINES = (first: string, last: string) => `${first}\nexport const x2 = 2;\nexport const x3 = 3;\nexport const x4 = 4;\n${last}\n`;
  const D = (hour: string) => `2026-11-14T${hour}:00Z`;
  /**
   * main M0 (no tools, no ci.yml) -> the PR (F1: code on line 1 of a.ts at 09:00, F2: a docs commit at 10:00, the push)
   * and main M1 (tools + the stage-2 ci.yml, 09:30); the proof run of F1 is created at 11:00; each variant adds one main
   * commit at 12:00 and the checkout is GitHub's test merge of F2 into that main. F1 and F2 carry no ci.yml, so the
   * proof's step names can only come from the test merge (R1-n6, mutant L20).
   */
  const made = new Map<boolean, { root: string; m0: string; f1: string; f2: string; m1: string }>();
  /** lint: the PR's code commit also touches a lint control (tools/lint), so lint_controls=true (R1-n1). */
  const repo = (lint = false) => {
    const cached = made.get(lint);
    if (cached !== undefined) return cached;
    const root = tempDir('lane-scope-cli-');
    git(root, ['init', '-q', '-b', 'main']);
    const m0 = commit(
      root,
      {
        'README.md': 'base\n',
        'apps/api/src/a.ts': A_LINES('export const x1 = 1;', 'export const x5 = 5;'),
        'apps/api/src/b.ts': 'export const b = 1;\n',
        'tools/quality/required-suites.json': MANIFEST,
      },
      'base',
      D('08:00'),
    );
    git(root, ['checkout', '-q', '-b', 'feat/x']);
    const code = { 'apps/api/src/a.ts': A_LINES('export const x1 = 10;', 'export const x5 = 5;') };
    const f1 = commit(root, lint ? { ...code, 'tools/lint/x.mjs': 'export {};\n' } : code, 'code', D('09:00'));
    const f2 = commit(root, { 'docs/notes/x.md': 'note\n' }, 'docs', D('10:00'));
    git(root, ['checkout', '-q', 'main']);
    const m1 = commit(root, { ...toolsCi(), '.github/workflows/ci.yml': stage2Text }, 'tools', D('09:30'));
    const result = { root, m0, f1, f2, m1 };
    made.set(lint, result);
    return result;
  };
  /** The test merge of F2 into M1 plus one main commit (or none), checked out; returns the tested base. */
  function testMerge(change: Record<string, string> | undefined, name: string, lint: boolean): string {
    const { root, m1, f2 } = repo(lint);
    git(root, ['checkout', '-q', '-B', `main-${name}`, m1]);
    const tip = change === undefined ? m1 : commit(root, change, `main ${name}`, D('12:00'));
    git(root, ['checkout', '-q', '--detach', tip]);
    git(root, ['merge', '-q', '--no-ff', '--no-edit', f2]);
    return tip;
  }
  const PROOF_RUN = 11;
  const jobsOfProof = () => {
    const steps = proofSteps(stage2Text) as ProofSteps;
    return {
      jobs: [
        {
          name: 'fast-lane',
          status: 'completed',
          conclusion: 'success',
          steps: steps.fastLane.map((s) => ({ name: s.name, conclusion: s.mayBeSkipped ? 'skipped' : 'success' })),
        },
        {
          name: 'ci-gate',
          status: 'completed',
          conclusion: 'success',
          steps: steps.scans.map((name) => ({ name, conclusion: 'success' })),
        },
        { name: 'security-integration', status: 'completed', conclusion: 'skipped', steps: [] },
      ],
    };
  };
  /** A runs API with one completed proof run of F1 (this PR into main, created 11:00), whose steps all passed. */
  const apiFor =
    (f1: string): Api =>
    (path) => {
      if (path.startsWith('repos/o/r/actions/workflows/ci.yml/runs?head_sha=')) {
        const sha = /head_sha=([0-9a-f]{40})/u.exec(path)?.[1] ?? '';
        if (sha !== f1) return { ok: true, json: { workflow_runs: [] } };
        const pullRequest = {
          number: 53,
          base: { ref: 'main', repo: { url: 'https://api.github.com/repos/o/r' } },
          head: { ref: 'feat/x', repo: { url: 'https://api.github.com/repos/o/r' } },
        };
        const proof = {
          id: PROOF_RUN,
          head_sha: f1,
          head_branch: 'feat/x',
          head_repository: { full_name: 'o/r' },
          event: 'pull_request',
          status: 'completed',
          conclusion: 'success',
          created_at: D('11:00'),
          path: '.github/workflows/ci.yml',
          pull_requests: [pullRequest],
        };
        return { ok: true, json: { workflow_runs: [proof] } };
      }
      if (path === `repos/o/r/actions/runs/${String(PROOF_RUN)}/jobs?per_page=100`) return { ok: true, json: jobsOfProof() };
      if (path.startsWith('repos/o/r/pulls?'))
        return {
          ok: true,
          json: [{ number: 53, base: { ref: 'main', repo: { full_name: 'o/r' } }, head: { ref: 'feat/x', repo: { full_name: 'o/r' } } }],
        };
      if (path.startsWith('repos/o/r/issues/53/events')) return { ok: true, json: [] };
      return { ok: false, problem: `unexpected ${path}` };
    };
  function run(change: Record<string, string> | undefined, name: string, lint = false) {
    const { root, m0, f1, f2 } = repo(lint);
    const api = apiFor(f1);
    const tip = testMerge(change, name, lint);
    const dir = tempDir('lane-scope-cli-out-');
    const out = join(dir, 'out');
    const summary = join(dir, 'summary.md');
    const args = ['--root', root, '--base', m0, '--head', f2, '--before', f1, '--event', 'pull_request', '--pr', '53'];
    const status = main([...args, '--head-ref', 'feat/x', '--tools-ref', tip, '--lookup', '--output', out, '--summary', summary], {
      env: { GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '99' },
      api,
    });
    const outputs = Object.fromEntries(
      readFileSync(out, 'utf8')
        .split('\n')
        .filter((line) => line.includes('='))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );
    return { status, outputs, summary: readFileSync(summary, 'utf8'), f1 };
  }

  it.each<[string, string, Record<string, string> | undefined, boolean]>([
    ['no main commit since the proof run (control)', 'none', undefined, true],
    ['a docs commit on main (control)', 'docs', { 'docs/y.md': 'y\n' }, true],
    ['a package.json commit on main (lane A input)', 'package', { 'package.json': '{"name":"x"}\n' }, false],
    [
      'P1 (b): main edits another line of a file the PR changes',
      'p1b',
      { 'apps/api/src/a.ts': A_LINES('export const x1 = 1;', 'export const x5 = 50;') },
      false,
    ],
    ['V5: main edits an app file the PR does not change', 'v5', { 'apps/api/src/b.ts': 'export const b = 2;\n' }, true],
    ['V3: main edits a lint rule source', 'v3', { 'tools/eslint-rules/x.mjs': 'export default {};\n' }, false],
    ['V4: main edits the schema-engine pin', 'v4', { 'tools/deps/prisma-engines.json': '{}\n' }, false],
  ])('%s', (_title, name, change, kept) => {
    const result = run(change, name);
    expect(result.status).toBe(0);
    // A kept proof runs light; a void one runs the full lane at once (TASK-287 run-full, D-TASK286-06a option).
    expect(result.outputs.push_scope).toBe('docs');
    expect(result.outputs.mode).toBe(kept ? 'light' : 'full');
    expect(result.outputs.code_changed).toBe(kept ? 'false' : 'true');
    expect(result.outputs.code_proof).toBe(kept ? `${String(PROOF_RUN)}:${result.f1}` : '');
    if (kept) expect(result.summary).not.toContain('tested an older base');
    else {
      expect(result.summary).toContain('tested an older base');
      expect(result.summary).toContain('the code proof was voided by the tested base: the full lane runs for this docs push');
    }
  });

  it('[R1-n1] a PR range touching a lint control: a proof whose lint-fixture step was skipped is no proof', () => {
    const result = run(undefined, 'lint', true);
    expect(result.status).toBe(0);
    expect(result.outputs.lint_controls).toBe('true');
    expect(result.outputs.code_proof).toBe('');
    expect(result.summary).toContain('is not a code proof');
    expect(result.summary).toContain(': skipped');
  });
});

describe('[R1-n1] lint_controls end to end: the classify output, the env line and the gate rule', () => {
  it('a PR range touching a lint control writes LINT_CONTROLS=true and lint_controls=true; an unknown range is true', () => {
    const { root, m0, f1, m1 } = stalePr();
    git(root, ['checkout', '-q', 'feat']);
    const f2 = commit(root, { 'tools/lint/x.mjs': 'export {};\n' }, 'lint control');
    git(root, ['checkout', '-q', '--detach', m1]);
    git(root, ['merge', '-q', '--no-ff', '--no-edit', f2]);
    const dir = tempDir('lane-scope-lint-');
    const out = join(dir, 'out');
    const envFile = join(dir, 'env');
    const args = ['--root', root, '--base', m0, '--head', f2, '--before', f1, '--pr', '53', '--head-ref', 'feat/x', '--tools-ref', m1];
    expect(main([...args, '--lookup', '--env', envFile, '--output', out], { env: {}, api: () => ({ ok: false, problem: 'none' }) })).toBe(
      0,
    );
    expect(readFileSync(envFile, 'utf8')).toBe('CODE=true\nLINT_CONTROLS=true\n');
    expect(readFileSync(out, 'utf8')).toContain('classification=mode=full,code_changed=true,pr_docs_only=false,lint_controls=true,');
    expect(classify({ root, base: 'f'.repeat(40), head: f2 }).lintControls).toBe(true);
    expect(classify({ root, base: m0, head: f1 }).lintControls).toBe(false);
  });

  it('a skipped LINT_CONTROLS step is accepted only when the verified classification says lint_controls=false', () => {
    const steps = proofSteps(stage2Text) as ProofSteps;
    const skippable = steps.fastLane.filter((s) => s.mayBeSkipped);
    expect(skippable.length).toBeGreaterThan(0);
    const jobs = {
      jobs: [
        {
          name: 'fast-lane',
          status: 'completed',
          conclusion: 'success',
          steps: steps.fastLane.map((s) => ({ name: s.name, conclusion: s.mayBeSkipped ? 'skipped' : 'success' })),
        },
      ],
    };
    expect(fastLaneProblems(jobs, steps.fastLane)).toEqual([]);
    expect(fastLaneProblems(jobs, steps.fastLane, true)).toEqual(skippable.map((s) => `${s.name}: skipped`));
  });

  it('gateVerdictStage2 passes the verified lint_controls to the code-step check of this run', () => {
    const base = {
      mode: 'full',
      code_changed: 'true',
      pr_docs_only: 'false',
      lint_controls: 'true',
      security_paths: 'false',
      record_ok: 'true',
      code_proof: '',
      security_proof: '',
      security_integration_due: 'false',
      tools_ref: 'd'.repeat(40),
    };
    const seen: Array<boolean | undefined> = [];
    const verdict = (values: typeof base) =>
      gateVerdictStage2({
        event: 'pull_request',
        fastLane: 'success',
        securityIntegration: 'skipped',
        classification: formatClassification(values),
        fastLaneClassification: formatClassification(values),
        thisRunCodeProblems: (lintControls) => {
          seen.push(lintControls);
          return lintControls === true ? ['Lint negative fixtures: skipped'] : [];
        },
      });
    expect(verdict(base).reasons).toEqual(['code gates skipped on a code push (Lint negative fixtures: skipped)']);
    expect(verdict({ ...base, lint_controls: 'false' })).toEqual({ ready: true, reasons: [] });
    expect(seen).toEqual([true, false]);
  });
});

describe('[PR59-SEC-01] [TASK-287] on a runner the checkout is the event commit GITHUB_SHA', () => {
  it('checkoutProblem: off a runner nothing is checked; on a runner HEAD must be the full GITHUB_SHA', () => {
    const { root, merge, m1 } = sharedPr();
    expect(checkoutProblem(root, {})).toBe('');
    expect(checkoutProblem(root, { GITHUB_ACTIONS: 'false', GITHUB_SHA: m1 })).toBe('');
    expect(checkoutProblem(root, { GITHUB_ACTIONS: 'true', GITHUB_SHA: merge })).toBe('');
    expect(checkoutProblem(root, { GITHUB_ACTIONS: 'true', GITHUB_SHA: m1 })).toContain('not the event commit');
    expect(checkoutProblem(root, { GITHUB_ACTIONS: 'true', GITHUB_SHA: merge.slice(0, 7) })).toContain('full commit SHA');
    expect(checkoutProblem(root, { GITHUB_ACTIONS: 'true' })).toContain('full commit SHA');
  });

  it('the CLI exits 2 (fail closed) in classify and --gate mode when the checkout is not GITHUB_SHA', () => {
    const { root, m0, f1, m1, merge } = sharedPr();
    const api: Api = () => ({ ok: false, problem: 'none' });
    const args = ['--root', root, '--base', m0, '--head', f1, '--pr', '53', '--head-ref', 'test/x', '--tools-ref', m1, '--lookup'];
    expect(main(args, { env: { GITHUB_ACTIONS: 'true', GITHUB_SHA: m1 }, api })).toBe(2);
    expect(main(args, { env: { GITHUB_ACTIONS: 'true', GITHUB_SHA: merge }, api })).toBe(0);
    expect(main(['--gate', '--root', root], { env: { GITHUB_ACTIONS: 'true', GITHUB_SHA: m1 }, api })).toBe(2);
  });

  it('the V2 tooling scripts fail the step when HEAD is not GITHUB_SHA and behave as V1 otherwise', () => {
    const { root, m0, f1, m1, merge } = sharedPr();
    for (const script of [FAST_LANE_TOOLING_SCRIPT_V2, CI_GATE_TOOLING_SCRIPT_TESTED_BASE_V2]) {
      const ok = runStep(root, script, { GITHUB_EVENT_NAME: 'pull_request', RANGE_BASE: m0, RANGE_HEAD: f1, GITHUB_SHA: merge });
      expect([ok.status, ok.env.TOOLS_REF]).toEqual([0, m1]);
      const bad = runStep(root, script, { GITHUB_EVENT_NAME: 'pull_request', RANGE_BASE: m0, RANGE_HEAD: f1, GITHUB_SHA: m1 });
      expect(bad.status).toBe(1);
      expect(bad.env.TOOLS_REF).toBeUndefined();
    }
  });
});
