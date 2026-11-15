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
import { CI_GATE_TOOLING_SCRIPT_TESTED_BASE, FAST_LANE_TOOLING_SCRIPT } from './check-workflow-policy.mjs';
import {
  CLASSIFICATION_KEYS,
  MAX_BASE_COMMITS,
  baseChangedAt,
  checkedOutTopology,
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
const stage2Text = readFileSync(join(repoRoot, 'tools', 'ci', 'fixtures', 'stage-2', 'ci.yml'), 'utf8');
const stage1Text = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
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
    const { root, m0, f1 } = stalePr();
    for (const rev of [m0, f1]) {
      const shown = spawnSync('git', ['cat-file', '-e', `${rev}:tools/ci/lane-scope.mjs`], { cwd: root, windowsHide: true });
      expect(shown.status).not.toBe(0);
    }
  });

  it('fast-lane: the pinned tooling step takes every gate tool from HEAD^1 (current main) and sets TOOLS_REF; the classify command then runs', () => {
    const { root, m0, f1, m1 } = stalePr();
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
    const { root, m0, f1, m1 } = stalePr();
    const step = runStep(root, CI_GATE_TOOLING_SCRIPT_TESTED_BASE, { GITHUB_EVENT_NAME: 'pull_request', RANGE_BASE: m0, RANGE_HEAD: f1 });
    expect(step.status).toBe(0);
    expect(step.env.TOOLS_REF).toBe(m1);
    expect(step.env.GATE_LANE_SCOPE).toBe(`${step.temp}/gates/base/tools/ci/lane-scope.mjs`);
    expect(existsSync(step.env.GATE_LANE_SCOPE ?? '')).toBe(true);
    // The record checker is on the tested base (current main), so the record is enforced although the merge base lacks it.
    expect(step.env.RECORD_MODE).toBe('enforce');
  });

  it('fails closed when the checkout is not the test merge of the PR head into a descendant of its base', () => {
    const { root, m0, f1, m1 } = stalePr();
    // HEAD^2 is not the PR head.
    expect(runStep(root, FAST_LANE_TOOLING_SCRIPT, { GITHUB_EVENT_NAME: 'pull_request', RANGE_BASE: m0, RANGE_HEAD: m0 }).status).toBe(1);
    // RANGE_BASE is not an ancestor of HEAD^1.
    expect(runStep(root, FAST_LANE_TOOLING_SCRIPT, { GITHUB_EVENT_NAME: 'pull_request', RANGE_BASE: f1, RANGE_HEAD: f1 }).status).toBe(1);
    // Not a merge at all (HEAD^2 missing).
    git(root, ['checkout', '-q', '--detach', m1]);
    const notMerge = runStep(root, CI_GATE_TOOLING_SCRIPT_TESTED_BASE, {
      GITHUB_EVENT_NAME: 'pull_request',
      RANGE_BASE: m0,
      RANGE_HEAD: f1,
    });
    expect(notMerge.status).toBe(1);
    expect(notMerge.env.GATE_LANE_SCOPE).toBeUndefined();
  });

  it('on a push (CI_MAIN_FAST_LANE) the tested base is the pushed range base', () => {
    const { root, m0, m1 } = stalePr();
    git(root, ['checkout', '-q', '--detach', m1]);
    const step = runStep(root, FAST_LANE_TOOLING_SCRIPT, { GITHUB_EVENT_NAME: 'push', RANGE_BASE: m0, RANGE_HEAD: m1 });
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

  it('a docs push runs light (CODE=false), with the classification naming the tested base', () => {
    const { root, m0, f1, f2, m2 } = docsPush('docs/notes/x.md');
    const args = ['--root', root, '--base', m0, '--head', f2, '--before', f1, '--pr', '53', '--head-ref', 'test/x', '--tools-ref', m2];
    const result = classifyCli(root, args);
    expect(result.status).toBe(0);
    expect(result.env).toBe('CODE=false\nLINT_CONTROLS=false\n');
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
    expect(result.outputs).toContain('mode=full\n');
  });
});

describe('[PR46-SEC-17] testedBase (lane-scope verifies --tools-ref against the checkout)', () => {
  it('accepts HEAD^1 of the test merge; refuses another commit, a non-merge checkout and a base outside its history', () => {
    const { root, m0, f1, m1 } = stalePr();
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
    const { root, m0, f1 } = stalePr();
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
    ['apps/api/src/a.ts', false],
  ])('%s -> %s', (path, expected) => {
    expect(proofBasePath(path, INPUTS)).toBe(expected);
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

  it('baseChangedAt is the newest first-parent commit on a proofBasePath (docs commits do not count)', () => {
    const base = mainHistory({ 'package.json': '{"name":"x"}\n' });
    expect(baseChangedAt(base.root, base.tip, INPUTS)).toBe(Date.parse('2026-11-14T12:00:00Z'));
    const docsOnly = mainHistory({ 'docs/z.md': 'z\n' });
    // Only the root commit (08:00, which added the manifest) touches a lane A input.
    expect(baseChangedAt(docsOnly.root, docsOnly.tip, INPUTS)).toBe(Date.parse('2026-11-14T08:00:00Z'));
    expect(baseChangedAt(docsOnly.root, 'f'.repeat(40), INPUTS)).toBeNull();
    expect(MAX_BASE_COMMITS).toBe(500);
  });

  it('beyond the history window the oldest commit read dates the base (conservative), within it 0 means none', () => {
    const docsOnly = mainHistory({ 'docs/z.md': 'z\n' });
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
    const changed = mainHistory({ 'package.json': '{"name":"x"}\n' });
    const docs = mainHistory({ 'docs/z.md': 'z\n' });
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

  it('gate() takes the stage-2 rules when the checked-out ci.yml is stage 2, the stage-1 rules otherwise', () => {
    const root = tempDir('lane-scope-gate-');
    git(root, ['init', '-q', '-b', 'main']);
    commit(root, { '.github/workflows/ci.yml': stage2Text }, 'stage 2');
    expect(checkedOutTopology(root)).toBe('stage-2');
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
    commit(root, { '.github/workflows/ci.yml': stage1Text }, 'stage 1');
    expect(checkedOutTopology(root)).toBe('stage-1');
    // The stage-1 rules read the scans outputs, which the stage-2 env does not carry: classification missing.
    expect(gate({ root, env: stage2Env, api: none }).reasons).toContain('classification missing');
  });
});
