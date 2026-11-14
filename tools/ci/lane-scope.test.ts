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
  gateVerdict,
  ghApi,
  lookupProofs,
  main,
  parseArgs,
  parseRaw,
  proofSteps,
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

/** A fake jobs API: run lists per commit and job lists per run id. */
function fakeApi(runs: Record<string, object[]>, jobs: Record<string, object>): Api & { calls: string[] } {
  const calls: string[] = [];
  const api = (path: string) => {
    calls.push(path);
    const runList = /actions\/workflows\/ci\.yml\/runs\?head_sha=([0-9a-f]{40})&event=pull_request&status=completed&per_page=100$/u.exec(
      path,
    );
    if (runList) return { ok: true as const, json: { total_count: 0, workflow_runs: runs[runList[1] ?? ''] ?? [] } };
    const jobList = /actions\/runs\/(\d+)\/jobs\?per_page=100$/u.exec(path);
    if (jobList && jobs[jobList[1] ?? ''] !== undefined) return { ok: true as const, json: jobs[jobList[1] ?? ''] };
    return { ok: false as const, problem: `unexpected ${path}` };
  };
  return Object.assign(api, { calls });
}

const run = (id: number, sha: string, extra: Record<string, unknown> = {}) => ({
  id,
  head_sha: sha,
  event: 'pull_request',
  status: 'completed',
  conclusion: 'failure',
  path: '.github/workflows/ci.yml',
  pull_requests: [{ number: 46 }],
  ...extra,
});

describe('lane-scope: proof selection against the jobs API (D-ARCH-126/127)', () => {
  it('a full run with every CODE-gated step and the three scans steps green is a code proof; its security-integration success is a security proof', () => {
    const api = fakeApi({ [PREV]: [run(11, PREV)] }, { 11: jobsOf({ si: 'success' }) });
    expect(lookupProofs({ api, repo: 'o/r', identical: [HEAD, PREV], steps: STEPS })).toMatchObject({
      codeProof: `11:${PREV}`,
      securityProof: `11:${PREV}`,
    });
    expect(api.calls[0]).toBe(`repos/o/r/actions/workflows/ci.yml/runs?head_sha=${HEAD}&event=pull_request&status=completed&per_page=100`);
  });

  it('a light run (fast-lane success, code steps skipped) is never a proof, so a light success cannot chain', () => {
    const api = fakeApi({ [PREV]: [run(12, PREV, { conclusion: 'success' })] }, { 12: jobsOf({ code: 'skipped' }) });
    const found = lookupProofs({ api, repo: 'o/r', identical: [PREV], steps: STEPS });
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
      expect(lookupProofs({ api, repo: 'o/r', identical: [PREV], steps: STEPS }).codeProof).toBe('');
    }
    const missing = jobsOf({});
    (missing.jobs[0] as { steps: unknown[] }).steps.pop();
    const api = fakeApi({ [PREV]: [run(14, PREV)] }, { 14: missing });
    expect(lookupProofs({ api, repo: 'o/r', identical: [PREV], steps: STEPS }).codeProof).toBe('');
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
    expect(lookupProofs({ api, repo: 'o/r', identical: [PREV], steps: STEPS, currentRunId: '27' })).toMatchObject({
      codeProof: '',
      securityProof: '',
    });
    expect(api.calls.filter((path) => /\/runs\/\d+\/jobs/u.test(path))).toEqual(['repos/o/r/actions/runs/26/jobs?per_page=100']);
    const self = fakeApi({ [PREV]: [run(28, PREV)] }, { 28: jobsOf({}) });
    expect(lookupProofs({ api: self, repo: 'o/r', identical: [PREV], steps: STEPS, currentRunId: '28' }).codeProof).toBe('');
  });

  it('a run of another PR on the same commit is accepted; the newest run is tried first', () => {
    const api = fakeApi(
      { [PREV]: [run(31, PREV, { pull_requests: [{ number: 99 }] }), run(32, PREV)] },
      { 31: jobsOf({}), 32: jobsOf({ code: 'skipped' }) },
    );
    expect(lookupProofs({ api, repo: 'o/r', identical: [PREV], steps: STEPS }).codeProof).toBe(`31:${PREV}`);
    expect(api.calls.filter((path) => /\/jobs/u.test(path))).toEqual([
      'repos/o/r/actions/runs/32/jobs?per_page=100',
      'repos/o/r/actions/runs/31/jobs?per_page=100',
    ]);
  });

  it('an API failure gives no proof (fail closed), and the lookup stops after MAX_API_CALLS', () => {
    const failing: Api = () => ({ ok: false, problem: 'HTTP 403' });
    expect(lookupProofs({ api: failing, repo: 'o/r', identical: [PREV], steps: STEPS })).toMatchObject({
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
    expect(main(['--bogus'])).toBe(2);
  });

  it('writes key=value outputs; --lookup adds the proofs and security_integration_due from the fake API', () => {
    const { root, base } = repo();
    const code = commit(root, { 'prisma/schema.prisma': 'model A { id Int @id }\n' }, 'code');
    const docs = commit(root, { 'docs/y.md': 'y\n' }, 'docs');
    write(root, '.github/workflows/ci.yml', ciText);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'ci']);
    const ci = git(root, ['rev-parse', 'HEAD']);
    const head = commit(root, { 'docs/z.md': 'z\n' }, 'docs 2');
    const output = join(root, 'out.txt');
    const api = fakeApi({ [ci]: [run(41, ci)] }, { 41: jobsOf({}) });
    const env = { GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '42' };
    expect(
      main(['--root', root, '--base', base, '--head', head, '--before', ci, '--pr', '5', '--lookup', '--output', output], { env, api }),
    ).toBe(0);
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
    expect(code).not.toBe(docs);
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
