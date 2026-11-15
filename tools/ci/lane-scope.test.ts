/**
 * Lane scope, proof inheritance and the lane A gate (ADR-0023 amendment L items 1-2; D-ARCH-126/127; ruling
 * rulings/wave-0-ci-minutes.md section 4 RR-1, RR-6): the DOCS_ONLY_PATHS corpus, push and PR scope, the code-identical
 * set across a union merge, proof selection against a fake jobs API, ci-gate rules (a)-(f) and the CLI.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';
import {
  GATE_OUTPUTS,
  allDocs,
  classify,
  docsOnlyPath,
  fastLaneProblems,
  gateInputFromEnv,
  gateVerdict,
  ghApi,
  lookupProofs,
  main,
  parseArgs,
  parseRaw,
  proofBinding,
  proofSteps,
  runBindingProblem,
  scansProblems,
} from './lane-scope.mjs';
import type { Api, GateInput, ProofSteps } from './lane-scope.mjs';

const repoRoot = findRepoRoot();
const ciText = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const INPUTS = ['docs/03-architecture/api/**', 'docs/05-quality/tests/gherkin-test-map.md', 'docs/01-requirements/stories/**'];

function git(cwd: string, args: string[]): string {
  const result = spawnSync(
    'git',
    ['-c', 'core.autocrlf=false', '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    { cwd, encoding: 'utf8', timeout: 30_000, windowsHide: true },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function commit(root: string, files: Record<string, string>, message: string): string {
  for (const [path, text] of Object.entries(files)) write(root, path, text);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '--allow-empty', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

/** main: base commit with a manifest; branch `feat` off it. */
function repo(manifest = true): { root: string; base: string } {
  const root = mkdtempSync(join(tmpdir(), 'lane-scope-'));
  temps.push(root);
  git(root, ['init', '-q', '-b', 'main']);
  const files: Record<string, string> = { 'README.md': 'base\n', 'apps/api/src/a.ts': 'export const a = 1;\n', 'docs/x.md': 'x\n' };
  if (manifest) files['tools/quality/required-suites.json'] = JSON.stringify({ tooling_inputs: INPUTS });
  const base = commit(root, files, 'base');
  git(root, ['checkout', '-q', '-b', 'feat']);
  return { root, base };
}

describe('lane-scope: DOCS_ONLY_PATHS', () => {
  it.each([
    ['docs/04-plan/spikes/SPK-07.md', true],
    ['docs/05-quality/security/PR-0046-x.md', true],
    ['docs/05-quality/tests/runs/r/summary.json', true],
    ['docs/03-architecture/api/openapi.yaml', false],
    ['docs/03-architecture/api/README.md', false],
    ['docs/05-quality/tests/gherkin-test-map.md', false],
    ['docs/01-requirements/stories/US-001.md', false],
    ['.claude/agent-memory/x/MEMORY.md', true],
    ['.claude/agents/devops-engineer.md', true],
    ['.claude/settings.json', false],
    ['README.md', true],
    ['CHANGELOG.md', true],
    ['scripts/notes.md', true],
    ['apps/api/README.md', false],
    ['packages/authz/README.md', false],
    ['prisma/README.md', false],
    ['tools/ci/README.md', false],
    ['tests/e2e/README.md', false],
    ['infra/README.md', false],
    ['.github/PULL_REQUEST_TEMPLATE.md', false],
    ['README.MD', false],
    ['package.json', false],
    ['docs/../apps/x.md', false],
    ['docs\\x.md', false],
  ])('%s -> %s (tooling inputs, .claude/settings.json and .md placement)', (path, expected) => {
    expect(docsOnlyPath(path, INPUTS)).toBe(expected);
  });

  it('a missing base-ref manifest makes docs/** code (fail closed), but not .claude notes or a root README', () => {
    expect(docsOnlyPath('docs/04-plan/spikes/SPK-07.md', null)).toBe(false);
    expect(docsOnlyPath('docs/x.md', null)).toBe(false);
    expect(docsOnlyPath('.claude/agent-memory/x/MEMORY.md', null)).toBe(true);
    expect(docsOnlyPath('README.md', null)).toBe(true);
  });

  it('[PR28-SEC-03 item 3] a docs change counts only between regular non-executable files', () => {
    const change = (oldMode: string, newMode: string) => [{ path: 'docs/x.md', oldMode, newMode }];
    expect(allDocs(change('100644', '100644'), INPUTS)).toBe(true);
    expect(allDocs(change('000000', '100644'), INPUTS)).toBe(true);
    expect(allDocs(change('100644', '000000'), INPUTS)).toBe(true);
    expect(allDocs(change('100644', '100755'), INPUTS)).toBe(false);
    expect(allDocs(change('000000', '120000'), INPUTS)).toBe(false);
    expect(allDocs(change('160000', '000000'), INPUTS)).toBe(false);
    expect(allDocs([], INPUTS)).toBe(true);
  });

  it('parseRaw reads `git diff --raw -z` and refuses anything else', () => {
    const z = '0'.repeat(40);
    expect(parseRaw(`:100644 100755 ${z} ${z} M\0docs/a b.md\0`)).toEqual([{ path: 'docs/a b.md', oldMode: '100644', newMode: '100755' }]);
    expect(parseRaw('')).toEqual([]);
    expect(parseRaw('garbage\0x\0')).toBeNull();
  });
});

describe('lane-scope: push scope, PR scope and the code-identical set (RR-1)', () => {
  it('a docs-only push after a code push is docs (light); the code commit is code-identical, the base is not', () => {
    const { root, base } = repo();
    const code = commit(root, { 'apps/api/src/a.ts': 'export const a = 2;\n' }, 'code');
    const docs = commit(root, { 'docs/05-quality/security/PR-0001-x.md': 'record\n' }, 'record');
    const result = classify({ root, base, head: docs, before: code, event: 'pull_request' });
    expect(result.pushScope).toBe('docs');
    expect(result.prDocsOnly).toBe(false);
    expect(result.identical).toEqual([docs, code]);
  });

  it('a push carrying code, a tooling input, .claude/settings.json or a code-root README is code (full)', () => {
    for (const files of [
      { 'apps/api/src/a.ts': 'export const a = 3;\n' },
      { 'docs/05-quality/tests/gherkin-test-map.md': 'map\n' },
      { '.claude/settings.json': '{}\n' },
      { 'tools/ci/README.md': 'readme\n' },
    ]) {
      const { root, base } = repo();
      const before = commit(root, { 'docs/y.md': 'y\n' }, 'docs');
      const head = commit(root, files, 'change');
      expect(classify({ root, base, head, before, event: 'pull_request' }).pushScope).toBe('code');
    }
  });

  it('without a usable before-SHA the PR range decides: docs-only PR -> docs, code PR -> code; unknown range -> code', () => {
    const docsPr = repo();
    const docsHead = commit(docsPr.root, { 'docs/y.md': 'y\n' }, 'docs');
    expect(classify({ root: docsPr.root, base: docsPr.base, head: docsHead, before: '', event: 'pull_request' })).toMatchObject({
      pushScope: 'docs',
      prDocsOnly: true,
    });
    expect(classify({ root: docsPr.root, base: docsPr.base, head: docsHead, before: '0'.repeat(40) }).pushScope).toBe('docs');
    const codePr = repo();
    commit(codePr.root, { 'apps/api/src/a.ts': 'export const a = 4;\n' }, 'code');
    const codeHead = commit(codePr.root, { 'docs/y.md': 'y\n' }, 'docs');
    expect(classify({ root: codePr.root, base: codePr.base, head: codeHead, before: 'deadbeef' }).pushScope).toBe('code');
    expect(classify({ root: codePr.root, base: '', head: codeHead, before: '' })).toMatchObject({
      pushScope: 'code',
      prDocsOnly: false,
      identical: [codeHead],
    });
  });

  it('a before-SHA that is not an ancestor of the head falls back to the PR range', () => {
    const { root, base } = repo();
    const side = commit(root, { 'docs/side.md': 's\n' }, 'side');
    git(root, ['checkout', '-q', '-b', 'other', base]);
    commit(root, { 'apps/api/src/a.ts': 'export const a = 5;\n' }, 'code');
    const head = commit(root, { 'docs/z.md': 'z\n' }, 'docs');
    expect(classify({ root, base, head, before: side }).pushScope).toBe('code');
  });

  it('any event but pull_request runs full; an empty push range (same tree) is docs', () => {
    const { root, base } = repo();
    const head = commit(root, { 'docs/y.md': 'y\n' }, 'docs');
    expect(classify({ root, base, head, before: base, event: 'push' }).pushScope).toBe('code');
    const empty = commit(root, {}, 'empty');
    expect(classify({ root, base, head: empty, before: head }).pushScope).toBe('docs');
  });

  it('a symlink or an executable bit in docs/ is code', () => {
    const { root, base } = repo();
    const before = commit(root, { 'docs/y.md': 'y\n' }, 'docs');
    write(root, 'docs/run.md', '#!/bin/sh\n');
    git(root, ['add', 'docs/run.md']);
    git(root, ['update-index', '--chmod=+x', 'docs/run.md']);
    git(root, ['commit', '-q', '-m', 'exec']);
    const head = git(root, ['rev-parse', 'HEAD']);
    expect(classify({ root, base, head, before }).pushScope).toBe('code');
  });

  it('a missing base-ref manifest makes a docs push code (fail closed)', () => {
    const { root, base } = repo(false);
    const before = commit(root, { 'apps/api/src/a.ts': 'export const a = 6;\n' }, 'code');
    const head = commit(root, { 'docs/y.md': 'y\n' }, 'docs');
    expect(classify({ root, base, head, before }).pushScope).toBe('code');
  });

  it('identity across a union merge: a merge of main that brings only docs keeps the code tree; one that brings code does not', () => {
    const { root, base } = repo();
    const code = commit(root, { 'apps/api/src/a.ts': 'export const a = 7;\n' }, 'code');
    git(root, ['checkout', '-q', 'main']);
    const mainDocs = commit(root, { 'docs/main.md': 'm\n' }, 'main docs');
    git(root, ['checkout', '-q', 'feat']);
    git(root, ['merge', '-q', '--no-ff', '-m', 'union', 'main']);
    const union = git(root, ['rev-parse', 'HEAD']);
    const result = classify({ root, base: mainDocs, head: union, before: code });
    expect(result.pushScope).toBe('docs');
    expect(result.identical).toEqual([union, code]);
    git(root, ['checkout', '-q', 'main']);
    const mainCode = commit(root, { 'apps/api/src/b.ts': 'export const b = 1;\n' }, 'main code');
    git(root, ['checkout', '-q', 'feat']);
    git(root, ['merge', '-q', '--no-ff', '-m', 'union 2', 'main']);
    const union2 = git(root, ['rev-parse', 'HEAD']);
    const second = classify({ root, base: mainCode, head: union2, before: union });
    expect(second.pushScope).toBe('code');
    expect(second.identical).toEqual([union2]);
    expect(base).not.toBe(mainCode);
  });

  it('record_ok: not-required without owned paths, false without a record for an owned path, false off pull_request', () => {
    const { root, base } = repo();
    commit(root, { '.github/CODEOWNERS': '/tools/ci/ @owner\n' }, 'owners');
    git(root, ['checkout', '-q', 'main']);
    git(root, ['merge', '-q', '--ff-only', 'feat']);
    const ownersBase = git(root, ['rev-parse', 'HEAD']);
    git(root, ['checkout', '-q', 'feat']);
    const plain = commit(root, { 'apps/api/src/a.ts': 'export const a = 8;\n' }, 'plain');
    expect(classify({ root, base: ownersBase, head: plain, pr: '7' })).toMatchObject({ recordOk: true });
    const owned = commit(root, { 'tools/ci/x.mjs': 'x\n' }, 'owned');
    expect(classify({ root, base: ownersBase, head: owned, pr: '7' })).toMatchObject({ recordOk: false });
    expect(classify({ root, base: ownersBase, head: plain, pr: '7', event: 'push' })).toMatchObject({ recordOk: false });
    expect(classify({ root, base: ownersBase, head: plain, pr: '' })).toMatchObject({ recordOk: false });
    expect(base).not.toBe(ownersBase);
  });
});

describe('lane-scope: proof steps from ci.yml and CI_REQUIRED_GATES', () => {
  it('the committed ci.yml yields the CODE-gated fast-lane steps (lint fixtures may be skipped) and the three scans steps', () => {
    const steps = proofSteps(ciText);
    if ('problem' in steps) throw new Error(steps.problem);
    expect(steps.fastLane.map((step) => step.name)).toEqual([
      'Lockfile provenance and delta',
      'Release cooldown and freshness',
      'Licences',
      'Registry signatures and provenance (PR1-SEC-12)',
      'Vulnerability audit (npm audit + osv-scanner)',
      'Lint (ESLint, Stylelint, suppressions)',
      'Format check',
      'Type-check',
      'Unit tests',
      'Lint negative fixtures from the base ref against the head configs (PR2-SEC-08)',
      'Build',
      'Lint must not mutate the tree (git status --porcelain)',
      'Build must not mutate the tree (git status --porcelain)',
    ]);
    expect(steps.fastLane.filter((step) => step.mayBeSkipped).map((step) => step.name)).toEqual([
      'Lint negative fixtures from the base ref against the head configs (PR2-SEC-08)',
    ]);
    expect(steps.scans).toEqual([
      'Gitleaks (PR commit range)',
      'Semgrep (rules, .semgrepignore and .gitignore from the base ref; --disable-nosem)',
      'OpenAPI breaking changes against the latest release tag (oasdiff, NFR-MAINT-004)',
    ]);
  });

  it('an unnamed or duplicated gate step, or an unparseable ci.yml, is a problem (no proof, fail closed)', () => {
    expect(proofSteps(ciText.replace('      - name: Unit tests\n', '      - name: Type-check\n'))).toMatchObject({
      problem: expect.stringContaining('not unique'),
    });
    expect(proofSteps(ciText.replace('      - name: Unit tests\n        if:', '      - if:'))).toMatchObject({
      problem: expect.stringContaining('unit tests'),
    });
    expect(proofSteps('jobs: &a\n')).toMatchObject({ problem: expect.stringContaining('does not parse') });
  });
});

const STEPS = proofSteps(ciText) as ProofSteps;
const HEAD = 'a'.repeat(40);
const PREV = 'b'.repeat(40);

type Conclusion = 'success' | 'skipped' | 'failure';
function jobsOf(options: {
  fastLane?: Conclusion | 'in_progress';
  code?: Conclusion;
  lint?: Conclusion;
  scans?: Conclusion;
  si?: Conclusion;
}) {
  const code = options.code ?? 'success';
  const fast = options.fastLane ?? 'success';
  return {
    total_count: 4,
    jobs: [
      {
        name: 'fast-lane',
        status: fast === 'in_progress' ? 'in_progress' : 'completed',
        conclusion: fast === 'in_progress' ? null : fast,
        steps: [
          { name: 'Set up job', conclusion: 'success' },
          { name: 'Workflow policy', conclusion: 'success' },
          ...STEPS.fastLane.map((step) => ({ name: step.name, conclusion: step.mayBeSkipped ? (options.lint ?? 'skipped') : code })),
        ],
      },
      {
        name: 'scans',
        status: 'completed',
        conclusion: 'failure',
        steps: [
          ...STEPS.scans.map((name) => ({ name, conclusion: options.scans ?? 'success' })),
          { name: 'Security-owned paths need a review record (PR5-SEC-04, PR10-SEC-04)', conclusion: 'failure' },
        ],
      },
      { name: 'security-integration', status: 'completed', conclusion: options.si ?? 'skipped', steps: [] },
      { name: 'ci-gate', status: 'completed', conclusion: 'failure', steps: [] },
    ],
  };
}

/** This PR (R2-M1 binding): PR 46 of o/r from HEAD_REF into main. */
const PR = '46';
const HEAD_REF = 'feat/TASK-046-x';
const REPO_REF = { id: 1, name: 'r', url: 'https://api.github.com/repos/o/r' };
const FORK_REF = { id: 2, name: 'r', url: 'https://api.github.com/repos/fork/r' };
/** A workflow run's `pull_requests` entry (repositories named by API url, as GitHub returns them). */
const prEntry = (overrides: { number?: number; base?: string; head?: string; baseRepo?: object; headRepo?: object } = {}) => ({
  id: 5000 + (overrides.number ?? 46),
  number: overrides.number ?? 46,
  url: `https://api.github.com/repos/o/r/pulls/${String(overrides.number ?? 46)}`,
  base: { ref: overrides.base ?? 'main', sha: 'c'.repeat(40), repo: overrides.baseRepo ?? REPO_REF },
  head: { ref: overrides.head ?? HEAD_REF, sha: 'd'.repeat(40), repo: overrides.headRepo ?? REPO_REF },
});
/** A `pulls` API item (repositories named by full_name). */
const pull = (overrides: { number?: number; base?: string; head?: string; headRepo?: string } = {}) => ({
  number: overrides.number ?? 46,
  state: 'open',
  base: { ref: overrides.base ?? 'main', repo: { full_name: 'o/r' } },
  head: { ref: overrides.head ?? HEAD_REF, repo: { full_name: overrides.headRepo ?? 'o/r' } },
});
const PULLS_PATH = 'repos/o/r/pulls?state=all&head=o%3Afeat%2FTASK-046-x&per_page=100';
const eventsPath = (page: number) => `repos/o/r/issues/46/events?per_page=100&page=${String(page)}`;

/**
 * A fake API: run lists per commit, job lists per run id, and this PR's binding calls (the head branch's pull requests
 * and the PR's issue events, one array per page). `false` makes that binding call fail.
 */
function fakeApi(
  runs: Record<string, object[]>,
  jobs: Record<string, object>,
  binding: { pulls?: unknown; events?: unknown[][] | false } = {},
): Api & { calls: string[] } {
  const calls: string[] = [];
  const api = (path: string) => {
    calls.push(path);
    const runList =
      /^repos\/o\/r\/actions\/workflows\/ci\.yml\/runs\?head_sha=([0-9a-f]{40})&event=pull_request&status=completed&per_page=100$/u.exec(
        path,
      );
    if (runList) return { ok: true as const, json: { total_count: 0, workflow_runs: runs[runList[1] ?? ''] ?? [] } };
    const jobList = /^repos\/o\/r\/actions\/runs\/(\d+)\/jobs\?per_page=100$/u.exec(path);
    if (jobList && jobs[jobList[1] ?? ''] !== undefined) return { ok: true as const, json: jobs[jobList[1] ?? ''] };
    if (path === PULLS_PATH && binding.pulls !== false) return { ok: true as const, json: binding.pulls ?? [pull()] };
    const events = /^repos\/o\/r\/issues\/46\/events\?per_page=100&page=(\d+)$/u.exec(path);
    if (events && binding.events !== false) return { ok: true as const, json: (binding.events ?? [[]])[Number(events[1]) - 1] ?? [] };
    return { ok: false as const, problem: `unexpected ${path}` };
  };
  return Object.assign(api, { calls });
}

const run = (id: number, sha: string, extra: Record<string, unknown> = {}) => ({
  id,
  head_sha: sha,
  head_branch: HEAD_REF,
  head_repository: { full_name: 'o/r' },
  event: 'pull_request',
  status: 'completed',
  conclusion: 'failure',
  created_at: '2026-11-14T10:00:00Z',
  path: '.github/workflows/ci.yml',
  pull_requests: [prEntry()],
  ...extra,
});

/** lookupProofs for this PR (repository o/r, PR 46, head branch HEAD_REF). */
const lookup = (api: Api, identical: string[], extra: { currentRunId?: string; pr?: string; headRef?: string } = {}) =>
  lookupProofs({ api, repo: 'o/r', identical, steps: STEPS, pr: PR, headRef: HEAD_REF, ...extra });

describe('lane-scope: proof selection against the jobs API (D-ARCH-126/127)', () => {
  it('a full run with every CODE-gated step and the three scans steps green is a code proof; its security-integration success is a security proof', () => {
    const api = fakeApi({ [PREV]: [run(11, PREV)] }, { 11: jobsOf({ si: 'success' }) });
    expect(lookup(api, [HEAD, PREV])).toMatchObject({
      codeProof: `11:${PREV}`,
      securityProof: `11:${PREV}`,
    });
    expect(api.calls[0]).toBe(`repos/o/r/actions/workflows/ci.yml/runs?head_sha=${HEAD}&event=pull_request&status=completed&per_page=100`);
  });

  it('a light run (fast-lane success, code steps skipped) is never a proof, so a light success cannot chain', () => {
    const api = fakeApi({ [PREV]: [run(12, PREV, { conclusion: 'success' })] }, { 12: jobsOf({ code: 'skipped' }) });
    const found = lookup(api, [PREV]);
    expect(found.codeProof).toBe('');
    expect(found.notes.join('\n')).toContain('Lockfile provenance and delta: skipped');
  });

  it('a failed fast-lane, a failed code step, a failed scans step or a missing step is not a proof', () => {
    for (const jobs of [
      jobsOf({ fastLane: 'failure' }),
      jobsOf({ code: 'failure' }),
      jobsOf({ scans: 'failure' }),
      jobsOf({ lint: 'failure' }),
    ]) {
      const api = fakeApi({ [PREV]: [run(13, PREV)] }, { 13: jobs });
      expect(lookup(api, [PREV]).codeProof).toBe('');
    }
    const missing = jobsOf({});
    (missing.jobs[0] as { steps: unknown[] }).steps.pop();
    const api = fakeApi({ [PREV]: [run(14, PREV)] }, { 14: missing });
    expect(lookup(api, [PREV]).codeProof).toBe('');
  });

  it('in-progress or queued runs, other events, other workflows, other commits and the current run are not proofs', () => {
    const api = fakeApi(
      {
        [PREV]: [
          run(21, PREV, { status: 'in_progress' }),
          run(22, PREV, { status: 'queued' }),
          run(23, PREV, { event: 'push' }),
          run(24, PREV, { path: '.github/workflows/lane-c.yml' }),
          run(25, HEAD),
          run(26, PREV),
        ],
      },
      { 21: jobsOf({}), 22: jobsOf({}), 23: jobsOf({}), 24: jobsOf({}), 25: jobsOf({}), 26: jobsOf({ fastLane: 'in_progress' }) },
    );
    expect(lookup(api, [PREV], { currentRunId: '27' })).toMatchObject({
      codeProof: '',
      securityProof: '',
    });
    expect(api.calls.filter((path) => /\/runs\/\d+\/jobs/u.test(path))).toEqual(['repos/o/r/actions/runs/26/jobs?per_page=100']);
    const self = fakeApi({ [PREV]: [run(28, PREV)] }, { 28: jobsOf({}) });
    expect(lookup(self, [PREV], { currentRunId: '28' }).codeProof).toBe('');
  });

  it('[R2-M1] a run of another PR on the same commit is refused before its jobs are read; among this PR runs the newest is tried first', () => {
    const api = fakeApi(
      { [PREV]: [run(31, PREV, { pull_requests: [prEntry({ number: 99 })] }), run(32, PREV), run(30, PREV)] },
      { 30: jobsOf({}), 31: jobsOf({ si: 'success' }), 32: jobsOf({ code: 'skipped' }) },
    );
    const found = lookup(api, [PREV]);
    expect(found).toMatchObject({ codeProof: `30:${PREV}`, securityProof: '' });
    expect(found.notes.join('\n')).toContain('run 31 (bbbbbbb) is not a run of this PR into main: not this PR into main');
    expect(api.calls.filter((path) => /\/jobs/u.test(path))).toEqual([
      'repos/o/r/actions/runs/32/jobs?per_page=100',
      'repos/o/r/actions/runs/30/jobs?per_page=100',
    ]);
    // The binding calls happen once, after the first completed candidate and before any jobs call.
    expect(api.calls.slice(0, 4)).toEqual([
      `repos/o/r/actions/workflows/ci.yml/runs?head_sha=${PREV}&event=pull_request&status=completed&per_page=100`,
      PULLS_PATH,
      eventsPath(1),
      'repos/o/r/actions/runs/32/jobs?per_page=100',
    ]);
  });

  it.each([
    ['another head branch (a stacked PR from another branch)', { head_branch: 'feat/other' }, 'another head branch'],
    [
      'a fork run (another head repository, this PR listed)',
      { head_repository: { full_name: 'fork/r' } },
      'another head repository (fork)',
    ],
    ['a fork-shaped run (empty pull_requests)', { pull_requests: [] }, '0 pull requests listed (exactly this PR is required)'],
    ['a run with no pull_requests field', { pull_requests: undefined }, '0 pull requests listed (exactly this PR is required)'],
    [
      'an ambiguous run (this PR and another listed)',
      { pull_requests: [prEntry(), prEntry({ number: 99 })] },
      '2 pull requests listed (exactly this PR is required)',
    ],
    ['another PR listed', { pull_requests: [prEntry({ number: 99 })] }, 'not this PR into main'],
    ['a run against another base (PR into weak)', { pull_requests: [prEntry({ base: 'weak' })] }, 'not this PR into main'],
    ['a base in another repository', { pull_requests: [prEntry({ baseRepo: FORK_REF })] }, 'not this PR into main'],
    ['an entry from another head branch', { pull_requests: [prEntry({ head: 'feat/other' })] }, 'not this PR into main'],
    ['an entry whose head is a fork', { pull_requests: [prEntry({ headRepo: FORK_REF })] }, 'not this PR into main'],
    ['a run without a creation time', { created_at: 'yesterday' }, 'no creation time'],
  ])('[R2-M1] %s is refused (no proof)', (_title, extra, problem) => {
    const api = fakeApi({ [PREV]: [run(33, PREV, extra)] }, { 33: jobsOf({ si: 'success' }) });
    const found = lookup(api, [PREV]);
    expect(found).toMatchObject({ codeProof: '', securityProof: '' });
    expect(found.notes).toEqual([`run 33 (bbbbbbb) is not a run of this PR into main: ${problem}`]);
    expect(api.calls.some((path) => /\/jobs/u.test(path))).toBe(false);
  });

  it('[R2-M1] a retargeted PR: runs created at or before the last base_ref_changed are refused, a later run is a proof', () => {
    const noRetarget = [[{ event: 'referenced', created_at: '2026-11-14T13:00:00Z' }], []] as unknown[][];
    const events = [
      [
        { event: 'base_ref_changed', created_at: '2026-11-14T11:00:00Z' },
        { event: 'labeled', created_at: '2026-11-14T11:30:00Z' },
        { event: 'base_ref_changed', created_at: '2026-11-14T12:00:00Z' },
      ],
    ];
    const old = fakeApi({ [PREV]: [run(34, PREV, { created_at: '2026-11-14T11:59:59Z' })] }, { 34: jobsOf({ si: 'success' }) }, { events });
    expect(lookup(old, [PREV])).toMatchObject({ codeProof: '', securityProof: '' });
    const same = fakeApi({ [PREV]: [run(35, PREV, { created_at: '2026-11-14T12:00:00Z' })] }, { 35: jobsOf({}) }, { events });
    expect(lookup(same, [PREV]).notes).toEqual([
      'run 35 (bbbbbbb) is not a run of this PR into main: created before the last base change of this PR',
    ]);
    const later = fakeApi(
      { [PREV]: [run(36, PREV, { created_at: '2026-11-14T12:00:01Z' })] },
      { 36: jobsOf({ si: 'success' }) },
      { events },
    );
    expect(lookup(later, [PREV])).toMatchObject({ codeProof: `36:${PREV}`, securityProof: `36:${PREV}` });
    // No retarget at all: other events give no cutoff.
    const plain = fakeApi({ [PREV]: [run(37, PREV)] }, { 37: jobsOf({}) }, { events: noRetarget });
    expect(lookup(plain, [PREV]).codeProof).toBe(`37:${PREV}`);
  });

  it('[R2-M1] a retarget on a later events page is found (a full page reads the next one)', () => {
    const filler = Array.from({ length: 100 }, () => ({ event: 'referenced', created_at: '2026-11-14T09:00:00Z' }));
    const events = [filler, [{ event: 'base_ref_changed', created_at: '2026-11-14T12:00:00Z' }]];
    const api = fakeApi({ [PREV]: [run(38, PREV)] }, { 38: jobsOf({}) }, { events });
    expect(lookup(api, [PREV]).codeProof).toBe('');
    expect(api.calls).toContain(eventsPath(2));
  });

  it.each([
    ['the head branch has a second PR (into another base)', { pulls: [pull(), pull({ number: 99, base: 'weak' })] }, '2 pull request(s)'],
    ['the head branch has no PR', { pulls: [] }, '0 pull request(s)'],
    ['the head branch PR is another PR', { pulls: [pull({ number: 99 })] }, '1 pull request(s)'],
    ['the head branch PR targets another base', { pulls: [pull({ base: 'weak' })] }, '1 pull request(s)'],
    ['the head branch PR comes from a fork', { pulls: [pull({ headRepo: 'fork/r' })] }, '1 pull request(s)'],
    ['the pulls answer is not a list', { pulls: { message: 'x' } }, 'not a list'],
    ['the pulls call fails', { pulls: false }, 'pull requests of the head branch: unexpected'],
    ['the events call fails', { events: false as const }, 'events of PR 46: unexpected'],
    ['an event is not an object', { events: [['x']] }, 'not a list of events'],
    ['a base_ref_changed event has no time', { events: [[{ event: 'base_ref_changed' }]] }, 'without a time'],
  ])('[R2-M1] %s: no proof at all, and no jobs are read (fail closed)', (_title, binding, problem) => {
    const api = fakeApi({ [PREV]: [run(39, PREV)] }, { 39: jobsOf({ si: 'success' }) }, binding);
    const found = lookup(api, [PREV]);
    expect(found).toMatchObject({ codeProof: '', securityProof: '' });
    expect(found.notes.join('\n')).toContain('no proof (binding, fail closed): ');
    expect(found.notes.join('\n')).toContain(problem);
    expect(api.calls.some((path) => /\/jobs/u.test(path))).toBe(false);
  });

  it('[R2-M1] without a PR number or a usable head branch there is no proof (no binding call is made)', () => {
    for (const extra of [{ pr: '' }, { pr: '0' }, { headRef: '' }, { headRef: '-x' }, { headRef: 'a..b' }, { headRef: 'a b' }]) {
      const api = fakeApi({ [PREV]: [run(40, PREV)] }, { 40: jobsOf({}) });
      const found = lookup(api, [PREV], extra);
      expect(found.codeProof).toBe('');
      expect(api.calls).toHaveLength(1);
    }
    const binding = proofBinding({ call: fakeApi({}, {}), repo: 'o/r', pr: PR, headRef: HEAD_REF });
    expect(binding).toEqual({ repo: 'o/r', pr: PR, headRef: HEAD_REF, since: 0 });
    expect(runBindingProblem(run(41, PREV), { repo: 'o/r', pr: PR, headRef: HEAD_REF, since: 0 })).toBe('');
  });

  it('[R2-M1] binding calls count toward MAX_API_CALLS (endless full event pages give no proof)', () => {
    const filler = Array.from({ length: 100 }, () => ({ event: 'referenced', created_at: '2026-11-14T09:00:00Z' }));
    const api = fakeApi({ [PREV]: [run(42, PREV)] }, { 42: jobsOf({}) }, { events: Array.from({ length: 60 }, () => filler) });
    const found = lookup(api, [PREV]);
    expect(found.codeProof).toBe('');
    expect(found.notes.join('\n')).toContain('more than 40 API calls');
    expect(api.calls).toHaveLength(40);
  });

  it('an API failure gives no proof (fail closed), and the lookup stops after MAX_API_CALLS', () => {
    const failing: Api = () => ({ ok: false, problem: 'HTTP 403' });
    expect(lookup(failing, [PREV])).toMatchObject({
      codeProof: '',
      securityProof: '',
    });
    let calls = 0;
    const counting: Api = () => {
      calls += 1;
      return { ok: true, json: { workflow_runs: [] } };
    };
    lookupProofs({
      api: counting,
      repo: 'o/r',
      identical: Array.from({ length: 60 }, (_, i) => i.toString(16).padStart(40, '0')),
      steps: STEPS,
    });
    expect(calls).toBe(40);
  });

  it('fastLaneProblems and scansProblems read step conclusions, never the job colour', () => {
    expect(fastLaneProblems(jobsOf({}), STEPS.fastLane)).toEqual([]);
    expect(fastLaneProblems(jobsOf({ lint: 'success' }), STEPS.fastLane)).toEqual([]);
    expect(fastLaneProblems({ jobs: [] }, STEPS.fastLane)).toEqual(['0 jobs named fast-lane']);
    expect(fastLaneProblems({}, STEPS.fastLane)).toEqual(['the jobs API response has no jobs list']);
    expect(scansProblems(jobsOf({}), STEPS.scans)).toEqual([]);
  });

  it('ghApi refuses without GH_TOKEN before spawning anything', () => {
    const api = ghApi({ gh: join(repoRoot, 'does-not-exist'), env: {} });
    expect(api('repos/o/r')).toEqual({ ok: false, problem: 'GH_TOKEN is not set (no lookup)' });
  });
});

function gate(overrides: Partial<GateInput> & { outputs?: Record<string, string> }, codeProblems: string[] = []) {
  const outputs = {
    code_changed: 'true',
    pr_docs_only: 'false',
    code_proof: '',
    security_proof: '',
    record_ok: 'true',
    security_paths: 'false',
    security_integration_due: 'false',
    ...overrides.outputs,
  };
  return gateVerdict({
    event: 'pull_request',
    fastLane: 'success',
    fastLaneMode: 'full',
    scans: 'success',
    securityIntegration: 'skipped',
    thisRunCodeProblems: () => codeProblems,
    ...overrides,
    outputs,
  });
}

describe('lane-scope --gate: ci-gate rules (a)-(f) (RR-6)', () => {
  it('a green full code push without security paths is MERGE-READY', () => {
    expect(gate({})).toEqual({ ready: true, reasons: [] });
  });

  it('(a) fast-lane not success; a draft PR (skipped) is not green', () => {
    expect(gate({ fastLane: 'failure' }).reasons).toEqual(['fast-lane failure']);
    expect(gate({ fastLane: 'skipped' }).reasons).toEqual(['fast-lane skipped (a draft PR is not gated: mark it ready for review)']);
  });

  it('(b) a code push that ran light, or whose CODE-gated steps did not all succeed, is red; a docs push that ran full disagrees', () => {
    expect(gate({ fastLaneMode: 'light' }).reasons).toEqual(['code gates skipped on a code push']);
    expect(gate({}, ['Unit tests: skipped']).reasons).toEqual(['code gates skipped on a code push (Unit tests: skipped)']);
    expect(gate({ fastLaneMode: 'full', outputs: { code_changed: 'false', code_proof: `1:${PREV}` } }).reasons).toEqual([
      'fast-lane mode disagrees with the classification',
    ]);
  });

  it('(c) a docs push of a PR with code changes needs a code proof; a docs-only PR does not', () => {
    expect(gate({ fastLaneMode: 'light', outputs: { code_changed: 'false' } }).reasons).toEqual(['no code proof for this tree']);
    expect(gate({ fastLaneMode: 'light', outputs: { code_changed: 'false', code_proof: `9:${PREV}` } }).ready).toBe(true);
    expect(gate({ fastLaneMode: 'light', outputs: { code_changed: 'false', pr_docs_only: 'true' } }).ready).toBe(true);
  });

  it('(d) scans not success (a missing record) is red', () => {
    expect(gate({ scans: 'failure' }).reasons).toEqual(['scans failure']);
  });

  it('(e) security paths need security-integration success in this run or a security proof; pending and red reasons are enumerated', () => {
    const sec = { security_paths: 'true' };
    expect(gate({ securityIntegration: 'success', outputs: sec }).ready).toBe(true);
    expect(gate({ outputs: { ...sec, security_proof: `5:${PREV}` } }).ready).toBe(true);
    expect(gate({ outputs: { ...sec, record_ok: 'false' } }).reasons).toEqual(['security-integration pending (record missing)']);
    expect(gate({ outputs: { ...sec, security_integration_due: 'true' } }).reasons).toEqual(['security-integration pending (not run)']);
    expect(gate({ securityIntegration: 'failure', outputs: sec }).reasons).toEqual(['security-integration red']);
    expect(gate({ securityIntegration: 'cancelled', outputs: sec }).reasons).toEqual(['security-integration red']);
  });

  it('(f) any empty or malformed output is "classification missing" (fail closed)', () => {
    for (const key of GATE_OUTPUTS) expect(gate({ outputs: { [key]: '' } }).reasons).toContain('classification missing');
    expect(gate({ fastLaneMode: '' }).reasons).toContain('classification missing');
    expect(gate({ outputs: { code_proof: 'yes' } }).reasons).toContain('classification missing');
    expect(gate({ outputs: { security_proof: `1:${'a'.repeat(39)}` } }).reasons).toContain('classification missing');
    expect(gate({ outputs: { security_paths: 'TRUE' } }).reasons).toContain('classification missing');
  });

  it('a push to main (CI_MAIN_FAST_LANE) needs (a), (b) and (d) only: no proof, no security-integration', () => {
    expect(
      gateVerdict({
        event: 'push',
        fastLane: 'success',
        fastLaneMode: 'full',
        scans: 'success',
        securityIntegration: 'skipped',
        outputs: {
          code_changed: 'true',
          pr_docs_only: 'false',
          code_proof: '',
          security_proof: '',
          record_ok: 'false',
          security_paths: 'true',
          security_integration_due: 'false',
        },
        thisRunCodeProblems: () => [],
      }).ready,
    ).toBe(true);
    expect(
      gateVerdict({
        event: 'push',
        fastLane: 'success',
        fastLaneMode: 'light',
        scans: 'success',
        securityIntegration: 'skipped',
        outputs: {
          code_changed: 'false',
          pr_docs_only: 'true',
          code_proof: '',
          security_proof: '',
          record_ok: 'false',
          security_paths: 'false',
          security_integration_due: 'false',
        },
        thisRunCodeProblems: () => [],
      }).reasons,
    ).toEqual(['code gates skipped on a code push']);
  });
});

describe('lane-scope CLI', () => {
  it('usage errors exit 2', () => {
    expect(parseArgs(['--root'])).toMatchObject({ error: expect.any(String) });
    expect(parseArgs(['--root', '.', '--head', 'x'])).toMatchObject({ error: '--base and --head are required' });
    expect(parseArgs(['--root', '.', '--base', 'x', '--head', 'y', '--event', 'merge_group'])).toMatchObject({
      error: expect.stringContaining('--event'),
    });
    expect(parseArgs(['--root', '.', '--base', 'x', '--head', 'y', '--pr', '0'])).toMatchObject({ error: expect.stringContaining('--pr') });
    expect(parseArgs(['--root', '.', '--gate', '--lookup'])).toMatchObject({ error: expect.stringContaining('--gate') });
    expect(parseArgs(['--root', '.', '--gate', '--head-ref', 'x'])).toMatchObject({ error: expect.stringContaining('--gate') });
    expect(parseArgs(['--root', '.', '--base', 'x', '--head', 'y', '--head-ref'])).toMatchObject({
      error: expect.stringContaining('--head-ref'),
    });
    expect(main(['--bogus'])).toBe(2);
  });

  /** A PR with a code commit, docs, the real ci.yml and more docs: the ci.yml commit is the code-identical proof commit. */
  function cliRepo() {
    const { root, base } = repo();
    const code = commit(root, { 'prisma/schema.prisma': 'model A { id Int @id }\n' }, 'code');
    const docs = commit(root, { 'docs/y.md': 'y\n' }, 'docs');
    write(root, '.github/workflows/ci.yml', ciText);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'ci']);
    const ci = git(root, ['rev-parse', 'HEAD']);
    const head = commit(root, { 'docs/z.md': 'z\n' }, 'docs 2');
    expect(code).not.toBe(docs);
    return { root, base, ci, head };
  }
  const cliEnv = { GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '42' };

  it('writes key=value outputs; --lookup adds the proofs and security_integration_due from the fake API', () => {
    const { root, base, ci, head } = cliRepo();
    const output = join(root, 'out.txt');
    const api = fakeApi({ [ci]: [run(41, ci)] }, { 41: jobsOf({}) });
    const args = ['--root', root, '--base', base, '--head', head, '--before', ci, '--pr', PR, '--head-ref', HEAD_REF, '--lookup'];
    expect(main([...args, '--output', output], { env: cliEnv, api })).toBe(0);
    const lines = readFileSync(output, 'utf8').trim().split('\n');
    expect(lines).toEqual([
      'push_scope=docs',
      'code_changed=false',
      'mode=light',
      'pr_docs_only=false',
      `identical=${head} ${ci}`,
      'security_paths=true',
      'record_ok=true',
      `code_proof=41:${ci}`,
      'security_proof=',
      'security_integration_due=true',
    ]);
  });

  it('[R2-M1] --pr and --head-ref reach the binding (a run of another branch is no proof); [R2-n1 L14] no record, not due', () => {
    const { root, base, ci, head } = cliRepo();
    const api = fakeApi({ [ci]: [run(41, ci)] }, { 41: jobsOf({ si: 'success' }) });
    const args = ['--root', root, '--base', base, '--head', head, '--before', ci, '--lookup'];
    const other = join(root, 'other.txt');
    expect(main([...args, '--pr', PR, '--head-ref', 'feat/other', '--output', other], { env: cliEnv, api })).toBe(0);
    expect(readFileSync(other, 'utf8').trim().split('\n').slice(-3)).toEqual([
      'code_proof=',
      'security_proof=',
      'security_integration_due=true',
    ]);
    // Without --pr the record is not evaluated (record_ok=false): security-integration is not due although no proof exists.
    const unbound = join(root, 'unbound.txt');
    expect(main([...args, '--head-ref', HEAD_REF, '--output', unbound], { env: cliEnv, api })).toBe(0);
    expect(readFileSync(unbound, 'utf8').trim().split('\n').slice(-5)).toEqual([
      'security_paths=true',
      'record_ok=false',
      'code_proof=',
      'security_proof=',
      'security_integration_due=false',
    ]);
  });

  it('--gate reads the step env and exits 0 on MERGE-READY, 1 on BLOCKED', () => {
    const env = {
      GITHUB_EVENT_NAME: 'pull_request',
      FAST_LANE: 'success',
      FAST_LANE_MODE: 'light',
      SCANS: 'success',
      SECURITY_INTEGRATION: 'skipped',
      CODE_CHANGED: 'false',
      PR_DOCS_ONLY: 'false',
      CODE_PROOF: `7:${PREV}`,
      SECURITY_PROOF: '',
      RECORD_OK: 'true',
      SECURITY_PATHS: 'false',
      SECURITY_INTEGRATION_DUE: 'false',
    };
    const api: Api = () => ({ ok: false, problem: 'not called' });
    expect(main(['--gate', '--root', repoRoot], { env, api })).toBe(0);
    expect(main(['--gate', '--root', repoRoot], { env: { ...env, CODE_PROOF: '' }, api })).toBe(1);
    expect(main(['--gate', '--root', repoRoot], { env: { ...env, SECURITY_PATHS: '' }, api })).toBe(1);
  });
});

describe('[R2-m1] ci-gate reads this run attempt own CODE-gated step conclusions (gateInputFromEnv)', () => {
  const gateEnv = {
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_RUN_ID: '77',
    GITHUB_RUN_ATTEMPT: '2',
    FAST_LANE: 'success',
    FAST_LANE_MODE: 'full',
    SCANS: 'success',
    SECURITY_INTEGRATION: 'skipped',
    CODE_CHANGED: 'true',
    PR_DOCS_ONLY: 'false',
    CODE_PROOF: '',
    SECURITY_PROOF: '',
    RECORD_OK: 'true',
    SECURITY_PATHS: 'false',
    SECURITY_INTEGRATION_DUE: 'false',
  };
  /** A clone whose HEAD has the real ci.yml (the step names ci-gate requires come from it). */
  function ciRoot(): string {
    const { root } = repo();
    commit(root, { '.github/workflows/ci.yml': ciText }, 'ci');
    return root;
  }
  const ATTEMPT_PATH = 'repos/o/r/actions/runs/77/attempts/2/jobs?per_page=100';
  /** A fake API answering only this run attempt's jobs. */
  function attemptApi(jobs: object): Api & { calls: string[] } {
    const calls: string[] = [];
    const api = (path: string) => {
      calls.push(path);
      return path === ATTEMPT_PATH ? { ok: true as const, json: jobs } : { ok: false as const, problem: `unexpected ${path}` };
    };
    return Object.assign(api, { calls });
  }

  it('reads exactly runs/<id>/attempts/<attempt>/jobs: every CODE-gated step success is MERGE-READY', () => {
    const root = ciRoot();
    const api = attemptApi(jobsOf({}));
    const input = gateInputFromEnv({ root, env: gateEnv, api });
    expect(input.thisRunCodeProblems()).toEqual([]);
    expect(api.calls).toEqual([ATTEMPT_PATH]);
    expect(gateVerdict(gateInputFromEnv({ root, env: gateEnv, api }))).toEqual({ ready: true, reasons: [] });
  });

  it('a skipped CODE-gated step in this run (head code rewrote CODE through $GITHUB_ENV) is BLOCKED', () => {
    const root = ciRoot();
    const jobs = jobsOf({});
    const unit = (jobs.jobs[0] as { steps: { name: string; conclusion: string }[] }).steps.find((step) => step.name === 'Unit tests');
    if (unit === undefined) throw new Error('no Unit tests step');
    unit.conclusion = 'skipped';
    const verdict = gateVerdict(gateInputFromEnv({ root, env: gateEnv, api: attemptApi(jobs) }));
    expect(verdict).toEqual({ ready: false, reasons: ['code gates skipped on a code push (Unit tests: skipped)'] });
  });

  it('a run that cannot be identified, or a failing jobs API, is BLOCKED (fail closed)', () => {
    const root = ciRoot();
    const noRunId = { ...gateEnv, GITHUB_RUN_ID: '' };
    const api = attemptApi(jobsOf({}));
    expect(gateVerdict(gateInputFromEnv({ root, env: noRunId, api })).reasons).toEqual([
      'code gates skipped on a code push (this run is not identifiable (GITHUB_REPOSITORY, GITHUB_RUN_ID))',
    ]);
    expect(api.calls).toEqual([]);
    const failing: Api = () => ({ ok: false, problem: 'HTTP 502' });
    expect(gateVerdict(gateInputFromEnv({ root, env: gateEnv, api: failing })).reasons).toEqual([
      'code gates skipped on a code push (jobs API: HTTP 502)',
    ]);
  });
});

describe('[R2-n1] pinned guards', () => {
  it('L1: the API contract is code even when the base manifest tooling_inputs omit it (API_CONTRACT_GLOB backstop)', () => {
    expect(docsOnlyPath('docs/03-architecture/api/openapi.yaml', ['docs/05-quality/tests/gherkin-test-map.md'])).toBe(false);
    expect(docsOnlyPath('docs/03-architecture/api/README.md', [])).toBe(false);
    expect(docsOnlyPath('docs/03-architecture/other.md', [])).toBe(true);
  });

  it('L12: a before-SHA that is not an ancestor is not a push range even when its tree diff to the head is docs-only', () => {
    const { root, base } = repo();
    const code = commit(root, { 'apps/api/src/a.ts': 'export const a = 9;\n' }, 'code');
    const head = commit(root, { 'docs/y.md': 'y\n' }, 'docs');
    git(root, ['checkout', '-q', '-b', 'sibling', code]);
    const sibling = commit(root, { 'docs/sibling.md': 's\n' }, 'sibling docs');
    expect(classify({ root, base, head, before: sibling })).toMatchObject({ pushScope: 'code', prDocsOnly: false });
    expect(classify({ root, base, head, before: code }).pushScope).toBe('docs');
  });

  it('L20/L21: a duplicated job name or step name never takes the first match', () => {
    const twoJobs = jobsOf({});
    twoJobs.jobs.push({ ...twoJobs.jobs[0] } as (typeof twoJobs.jobs)[number]);
    expect(fastLaneProblems(twoJobs, STEPS.fastLane)).toEqual(['2 jobs named fast-lane']);
    const twoSteps = jobsOf({});
    const fast = twoSteps.jobs[0] as { steps: { name: string; conclusion: string }[] };
    fast.steps.push({ name: 'Unit tests', conclusion: 'success' });
    expect(fastLaneProblems(twoSteps, STEPS.fastLane)).toEqual(['Unit tests: ambiguous']);
    const twoScans = jobsOf({});
    const scans = twoScans.jobs[1] as { steps: { name: string; conclusion: string }[] };
    scans.steps.push({ name: STEPS.scans[0] ?? '', conclusion: 'success' });
    expect(scansProblems(twoScans, STEPS.scans)).toEqual([`${STEPS.scans[0] ?? ''}: missing`]);
  });

  it('L27: an empty PR range (the head tree equals the base tree) is code, never docs-only', () => {
    const { root, base } = repo();
    const head = commit(root, {}, 'empty');
    expect(classify({ root, base, head, before: '' })).toMatchObject({
      pushScope: 'code',
      prDocsOnly: false,
      prReason: 'the PR range changes nothing (code)',
    });
  });
});
