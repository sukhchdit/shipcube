/**
 * Workflow policy (TASK-007; SEC-TC-32, SEC-TC-51, SEC-TC-64; PR1-SEC-02/-08/-12, PR4-SEC-08, PR5-SEC-07; D-ARCH-041,
 * D-ARCH-044; AT-US-005-04/-05). Every negative fixture under fixtures/workflow-policy/ has its own test.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { FORBIDDEN_ENGINE_ENV } from '../deps/prisma-engines.mjs';
import { LINT_FIXTURE_MODE_ENV as LINT_FIXTURE_MODE_SUITE_ENV } from '../lint/fixture-expectations.mjs';
import {
  CI_REQUIRED_GATES,
  FORBIDDEN_ENV,
  LINT_FIXTURE_MODE_ENV,
  REQUIRED_CODEOWNED_PATHS,
  checkCodeowners,
  checkWorkflow,
  checkWorkflowPolicy,
  mentionsOf,
  shellSegments,
} from './check-workflow-policy.mjs';
import { YamlSubsetError, parseYamlSubset } from './yaml-subset.mjs';

const repoRoot = findRepoRoot();
const fixtureDir = join(repoRoot, 'tools', 'ci', 'fixtures', 'workflow-policy');
const script = join(repoRoot, 'tools', 'ci', 'check-workflow-policy.mjs');

/** Fixtures named `ci-*.yml` are checked as `ci.yml` (the AT-US-005-04/-05 rules apply to ci.yml only). */
function rulesFor(fixture: string): string[] {
  const text = readFileSync(join(fixtureDir, fixture), 'utf8');
  return checkWorkflow(text, fixture.startsWith('ci-') ? 'ci.yml' : fixture).map((finding) => finding.rule);
}

describe('check-workflow-policy: negative fixtures', () => {
  it.each([
    ['SEC-TC-32: an action pinned by tag fails', 'unpinned-tag.yml', 'pinned-action'],
    ['SEC-TC-32: a SHA pin without its "# vX.Y.Z" comment fails', 'sha-without-comment.yml', 'pinned-action'],
    ['SEC-TC-32: pull_request_target is rejected', 'pull-request-target.yml', 'forbidden-trigger'],
    ['SEC-TC-32: top-level write-all permissions fail', 'write-all-permissions.yml', 'permissions'],
    ['SEC-TC-32: a job-level write grant outside the allow-list fails', 'job-write-permission.yml', 'permissions'],
    ['D-ARCH-044: a workflow without SCARF_ANALYTICS at workflow level fails', 'missing-workflow-env.yml', 'workflow-env'],
    ['PR1-SEC-02 / D-ARCH-041: PRISMA_ENGINES_MIRROR in a step env fails', 'prisma-engines-mirror.yml', 'forbidden-env'],
    [
      'PR1-SEC-02 / D-ARCH-041: PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING exported in a run script fails',
      'prisma-checksum-ignore-in-run.yml',
      'forbidden-env',
    ],
    ['D-ARCH-041: npm_config_ignore_scripts=false (mixed case) fails', 'ignore-scripts-false.yml', 'ignore-scripts'],
    ['PR4-SEC-08: PLAYWRIGHT_DOWNLOAD_HOST fails', 'playwright-download-host.yml', 'forbidden-env'],
    ['PR5-SEC-07: NODE_OPTIONS with a --require preload fails', 'node-options-preload.yml', 'node-options-preload'],
    ['PR5-SEC-07: NODE_TLS_REJECT_UNAUTHORIZED=0 fails', 'node-tls-reject.yml', 'tls-verify-disabled'],
    ['PR1-SEC-12: npm ci --@platform:registry=… fails', 'platform-registry-on-npm-ci.yml', 'platform-registry'],
    ['PR1-SEC-12: an npm_config_@platform:registry env entry fails', 'platform-registry-env.yml', 'platform-registry'],
    ['PR1-SEC-12: npm audit signatures || true fails', 'audit-signatures-or-true.yml', 'audit-signatures-masked'],
    ['PR1-SEC-12: continue-on-error on a gate step fails', 'continue-on-error.yml', 'continue-on-error'],
    ['SEC-TC-64: npx fails (npm exec --no -- only)', 'npx.yml', 'npx'],
    ['SEC-TC-64: npm exec without --no fails', 'npm-exec-without-no.yml', 'npx'],
    [
      'SEC-TC-51: secrets.CARRIER_* in a job without environment carrier-sandbox fails',
      'carrier-secret-without-environment.yml',
      'sandbox-secrets',
    ],
    [
      'SEC-TC-51: a pull_request workflow referencing environment carrier-sandbox fails',
      'carrier-environment-on-pull-request.yml',
      'sandbox-secrets',
    ],
    ['ADR-0023 am. H: a pull_request job using a repository secret fails', 'pull-request-secret.yml', 'pr-secrets'],
    ['ADR-0023 am. H: toJSON(secrets) fails', 'secrets-dump.yml', 'secrets-dump'],
    ['AT-US-005-04: docker push in ci.yml outside the gated images job fails', 'ci-docker-push.yml', 'ci-no-release'],
    ['AT-US-005-04: npm publish in ci.yml fails', 'ci-npm-publish.yml', 'ci-no-release'],
    ['AT-US-005-05: terraform apply in ci.yml fails', 'ci-terraform-apply.yml', 'ci-no-release'],
    ['AT-US-005-05: assuming an AWS role in ci.yml fails', 'ci-aws-role.yml', 'ci-no-release'],
    ['every job needs timeout-minutes', 'missing-timeout.yml', 'job-timeout'],
    ['docker run by tag (no digest) fails', 'docker-run-by-tag.yml', 'image-digest'],
    ['YAML outside the supported subset (anchor) fails closed', 'yaml-anchor.yml', 'yaml-subset'],
    ['review M1: npm ci --ignore-scripts false (bare boolean value) fails', 'ignore-scripts-bare-false.yml', 'ignore-scripts'],
    ['review M1: npm clean-install --ig false (alias + abbreviated flag) fails', 'ignore-scripts-abbreviated.yml', 'ignore-scripts'],
    ['review M1: npm cit --no-ignore-scripts fails', 'ignore-scripts-negated-alias.yml', 'ignore-scripts'],
    ['review M1: npm config set ignore-scripts false fails', 'ignore-scripts-config-set.yml', 'ignore-scripts'],
    ['review M1: writing ignore-scripts=false into .npmrc fails', 'ignore-scripts-npmrc-write.yml', 'ignore-scripts'],
    ['review M1: npm rebuild --ignore-scripts=false in a workflow fails', 'ignore-scripts-rebuild.yml', 'ignore-scripts'],
    ['PR10-SEC-01: gitleaks without --ignore-gitleaks-allow fails', 'gitleaks-allow-honoured.yml', 'gitleaks-hardening'],
    ['PR10-SEC-01: gitleaks without --diff-merges=first-parent fails', 'gitleaks-no-merge-diffs.yml', 'gitleaks-hardening'],
    ['PR10-SEC-01: gitleaks with network access fails', 'gitleaks-network.yml', 'gitleaks-hardening'],
    [
      'PR10-SEC-01: gitleaks mounting the whole workspace (.gitleaksignore reachable) fails',
      'gitleaks-workspace-mount.yml',
      'gitleaks-hardening',
    ],
    ['PR10-SEC-07: the PR title interpolated into run: fails', 'untrusted-expression-title.yml', 'untrusted-expression'],
    ['PR10-SEC-07: github.head_ref interpolated into run: fails', 'untrusted-expression-head-ref.yml', 'untrusted-expression'],
    ['PR10-SEC-07: the PR body interpolated into github-script fails', 'untrusted-expression-github-script.yml', 'untrusted-expression'],
    ['PR10-SEC-07: on: issue_comment is rejected', 'issue-comment-trigger.yml', 'forbidden-trigger'],
    ['PR10-SEC-07: on: pull_request_review is rejected', 'pull-request-review-trigger.yml', 'forbidden-trigger'],
    ['PR10-SEC-02: npm in ci.yml job scans fails', 'ci-scans-npm.yml', 'scans-isolation'],
    ['PR10-SEC-02: a workspace script in ci.yml job scans fails', 'ci-scans-workspace-script.yml', 'scans-isolation'],
    ['PR10-SEC-02: setup-node with cache/.node-version in ci.yml job scans fails', 'ci-scans-setup-node-cache.yml', 'scans-isolation'],
    [
      'D-ORCH-018: LINT_FIXTURE_MODE in a job env fails (the head unit-test run stays exact)',
      'lint-fixture-mode-job-env.yml',
      'lint-fixture-mode',
    ],
    ['D-ORCH-018: LINT_FIXTURE_MODE written to $GITHUB_ENV fails', 'ci-lint-fixture-mode-github-env.yml', 'lint-fixture-mode'],
  ])('%s', (_title, fixture, rule) => {
    expect(rulesFor(fixture)).toContain(rule);
  });

  it.each([
    ['valid.yml: pinned actions, read-only token, workflow env, npm audit signatures with the scope override'],
    ['carrier-sandbox-dispatch.yml: SEC-TC-51 positive control (workflow_dispatch + environment carrier-sandbox)'],
    ['ci-images-guarded.yml: AT-US-005-04 positive control (images job gated on workflow_dispatch)'],
    ['gitleaks-hardened.yml: PR10-SEC-01 positive control (.git-only mount, --ignore-gitleaks-allow, first-parent, no network)'],
    ['safe-expression.yml: PR10-SEC-07 positive control (github.sha, runner.*, steps.*.outputs.*)'],
  ])('positive control %s', (title) => {
    const fixture = title.split(':')[0] ?? '';
    expect(rulesFor(fixture)).toEqual([]);
  });
});

describe('check-workflow-policy: repository', () => {
  it('SEC-TC-32 / PR1-SEC-12 positive control: the committed workflows pass, including npm audit signatures with the scope override', () => {
    const { findings, checked } = checkWorkflowPolicy(repoRoot);
    expect(findings).toEqual([]);
    expect(checked).toContain('.github/workflows/ci.yml');
    expect(readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8')).toContain(
      'npm audit signatures --@platform:registry=https://registry.npmjs.org/',
    );
  });

  it('PR10-SEC-01: a committed .gitleaksignore anywhere in the tree fails (repository mode)', () => {
    const root = mkdtempSync(join(tmpdir(), 'workflow-policy-'));
    try {
      mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
      mkdirSync(join(root, 'docs', 'x'), { recursive: true });
      cpSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), join(root, '.github', 'workflows', 'ci.yml'));
      cpSync(join(repoRoot, '.github', 'CODEOWNERS'), join(root, '.github', 'CODEOWNERS'));
      expect(checkWorkflowPolicy(root).findings).toEqual([]);
      writeFileSync(join(root, '.gitleaksignore'), 'abc:docs/x.md:aws-access-token:1\n');
      writeFileSync(join(root, 'docs', 'x', '.gitleaksignore'), '\n');
      expect(checkWorkflowPolicy(root).findings.map((f) => `${f.rule} ${f.location}`)).toEqual([
        'gitleaksignore .gitleaksignore',
        'gitleaksignore docs/x/.gitleaksignore',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('PR10-SEC-07 required-gates: the repository ci.yml keeps every gate; dropping or guarding one fails; ci.yml must exist', () => {
    const ci = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(checkWorkflow(ci, 'ci.yml', { requiredGates: true })).toEqual([]);
    const dropped = ci.replace('"$GITLEAKS_IMAGE" git /repo', '"$GITLEAKS_IMAGE" version');
    expect(checkWorkflow(dropped, 'ci.yml', { requiredGates: true }).map((f) => f.rule)).toContain('required-gates');
    const guarded = ci.replace('      - name: Workflow policy\n', "      - name: Workflow policy\n        if: env.CODE == 'true'\n");
    expect(checkWorkflow(guarded, 'ci.yml', { requiredGates: true }).map((f) => f.message)).toEqual([
      expect.stringContaining('workflow policy gate step must be unconditional'),
    ]);
    const ungated = ci.replace('needs: [fast-lane, scans]', 'needs: [fast-lane]');
    expect(checkWorkflow(ungated, 'ci.yml', { requiredGates: true }).map((f) => f.message)).toEqual(['ci.yml ci-gate must need scans']);
    expect(CI_REQUIRED_GATES.length).toBeGreaterThanOrEqual(21);
    const root = mkdtempSync(join(tmpdir(), 'workflow-policy-'));
    try {
      mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
      cpSync(join(repoRoot, '.github', 'CODEOWNERS'), join(root, '.github', 'CODEOWNERS'));
      expect(checkWorkflowPolicy(root).findings.map((f) => f.rule)).toEqual(['required-gates']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('D-ORCH-018 required-gates: the base-ref lint fixture step keeps its no-weakening env, its guard and an unfiltered Jest run; the mode variable lives on that step only', () => {
    const ci = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    const messages = (text: string) => checkWorkflow(text, 'ci.yml', { requiredGates: true }).map((f) => `${f.rule}: ${f.message}`);
    const modeEntry = '        env:\n          LINT_FIXTURE_MODE: no-weakening\n';
    const mustSet = 'required-gates: ci.yml base-ref lint negative fixtures gate step must set env LINT_FIXTURE_MODE: no-weakening';
    const onlyHere = "lint-fixture-mode: LINT_FIXTURE_MODE may be set only in the env of ci.yml's base-ref lint fixture step";
    expect(ci.split(modeEntry)).toHaveLength(2);

    expect(messages(ci.replace(modeEntry, ''))).toEqual([mustSet]);
    expect(messages(ci.replace(modeEntry, modeEntry.replace('no-weakening', 'exact')))).toEqual([mustSet]);
    for (const filter of [" --testNamePattern 'x'", " -t 'x'", ' --passWithNoTests', ' --testPathIgnorePatterns negative']) {
      const filtered = ci.replace('--selectProjects unit || status=$?', `--selectProjects unit${filter} || status=$?`);
      expect(filtered).not.toBe(ci);
      // The step no longer counts as the gate, so its env entry is a stray mention too.
      expect(messages(filtered)).toEqual(
        ['required-gates: ci.yml job fast-lane must keep the base-ref lint negative fixtures gate step', onlyHere].sort(),
      );
    }
    const guard = "        if: env.CODE == 'true' && env.LINT_CONTROLS == 'true'\n" + modeEntry;
    expect(messages(ci.replace(guard, guard.replace("LINT_CONTROLS == 'true'", "LINT_CONTROLS == 'never'")))).toEqual([
      expect.stringContaining('base-ref lint negative fixtures gate step must be guarded only by'),
    ]);

    expect(messages(ci.replace('        run: npm run test:unit\n', `${modeEntry}        run: npm run test:unit\n`))).toEqual([onlyHere]);
    expect(
      messages(ci.replace('--selectProjects unit || status=$?', '--selectProjects unit || status=$?\n          echo "$LINT_FIXTURE_MODE"')),
    ).toEqual([onlyHere]);
    expect(mentionsOf({ a: ['x', { LINT_FIXTURE_MODE: 'y' }], b: 'LINT_FIXTURE_MODE=1' }, 'LINT_FIXTURE_MODE')).toEqual([
      ['a', '1', 'LINT_FIXTURE_MODE'],
      ['b'],
    ]);
    expect(LINT_FIXTURE_MODE_ENV).toBe(LINT_FIXTURE_MODE_SUITE_ENV);
  });

  it('D-ARCH-041: the forbidden list covers every engine variable deps:rebuild refuses', () => {
    expect([...FORBIDDEN_ENV]).toEqual(expect.arrayContaining([...FORBIDDEN_ENGINE_ENV]));
  });

  it('CLI: exit 1 with "<rule>: <message> (<location>)" lines on a negative fixture, 0 on the positive control', () => {
    const bad = runNode([script, '--root', repoRoot, 'tools/ci/fixtures/workflow-policy/npx.yml'], { cwd: repoRoot });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/^npx: .+ \(tools\/ci\/fixtures\/workflow-policy\/npx\.yml:\d+ jobs\.build\.steps\.0\.run\)$/m);
    const good = runNode([script, '--root', repoRoot, 'tools/ci/fixtures/workflow-policy/valid.yml'], { cwd: repoRoot });
    expect(good.status).toBe(0);
    expect(runNode([script, '--bogus'], { cwd: repoRoot }).status).toBe(2);
  });
});

describe('CODEOWNERS coverage (PR5-SEC-04, PR8-SEC-11, PR8-SEC-13)', () => {
  it('[PR5-SEC-04] the repository CODEOWNERS covers every required path', () => {
    expect(checkCodeowners(readFileSync(join(findRepoRoot(), '.github', 'CODEOWNERS'), 'utf8'))).toEqual([]);
  });

  it('[PR5-SEC-04] a missing CODEOWNERS fails', () => {
    expect(checkCodeowners(undefined).map((f) => f.rule)).toEqual(['codeowners-missing']);
  });

  it('[PR8-SEC-13] an uncovered path, a commented line or a line without an owner fails coverage', () => {
    const text = REQUIRED_CODEOWNED_PATHS.filter((path) => path !== 'prisma/migrations/')
      .map((path) => `/${path} @owner`)
      .concat(['# /prisma/migrations/ @owner', '/prisma/migrations/'])
      .join('\n');
    expect(checkCodeowners(text).map((f) => f.message)).toEqual([expect.stringContaining('prisma/migrations/')]);
  });

  it('a parent folder or a /** pattern covers a nested required path', () => {
    const text = [
      '/.github/ @o',
      '/tools/ @o',
      '/packages/authz/** @o',
      '/prisma/ @o',
      '/eslint.config.mjs @o',
      '/.semgrep/ @o',
      '/.gitleaks.toml @o',
      '/.gitleaksignore @o',
      '/.semgrepignore @o',
      '/.gitignore @o',
      '/.prettierignore @o',
      '/jest.config.ts @o',
      '/tsconfig.json @o',
      '/tsconfig.base.json @o',
      '/commitlint.config.mjs @o',
      '/.node-version @o',
      '/CLAUDE.md @o',
      '/.claude/ @o',
    ].join('\n');
    expect(checkCodeowners(text)).toEqual([]);
  });

  it('review M2/m4, PR10-SEC-04: the gitleaks ignore file, gate configuration and the agent control plane are required paths', () => {
    expect(REQUIRED_CODEOWNED_PATHS).toEqual(
      expect.arrayContaining([
        '.gitleaksignore',
        'jest.config.ts',
        'tsconfig.base.json',
        'commitlint.config.mjs',
        '.node-version',
        'tools/test-support/',
        'CLAUDE.md',
        '.claude/settings.json',
        '.claude/agents/',
      ]),
    );
  });
});

describe('shellSegments', () => {
  it('splits on operators outside quotes and keeps the following operator', () => {
    expect(shellSegments("a --x='1|2' || true\nb && c; d | e")).toEqual([
      { text: "a --x='1|2'", next: '||' },
      { text: 'true', next: '' },
      { text: 'b', next: '&&' },
      { text: 'c', next: ';' },
      { text: 'd', next: '|' },
      { text: 'e', next: '' },
    ]);
  });

  it('joins backslash continuations', () => {
    expect(shellSegments('npm audit \\\n  signatures || true')[0]).toEqual({ text: 'npm audit    signatures', next: '||' });
  });
});

describe('yaml-subset', () => {
  it('parses block mappings, sequences, `- key:` items, quoted keys, flow sequences, {} and block scalars', () => {
    const text = [
      'on:',
      '  push:',
      '    branches: [main, "release/*"]',
      "'quoted:key': x # comment",
      'empty: {}',
      'list:',
      '- a',
      '- name: b',
      '  run: |',
      '    echo "a: b" # kept',
      '',
      '    echo two',
      'folded: >-',
      '  one',
      '  two',
    ].join('\n');
    expect(parseYamlSubset(text).value).toEqual({
      on: { push: { branches: ['main', 'release/*'] } },
      'quoted:key': 'x',
      empty: {},
      list: ['a', { name: 'b', run: 'echo "a: b" # kept\n\necho two\n' }],
      folded: 'one two',
    });
  });

  it.each([
    ['anchor', 'a: &x 1'],
    ['alias', 'a: *x'],
    ['merge key', '<<: x'],
    ['flow mapping', 'a: {b: 1}'],
    ['duplicate key', 'a: 1\na: 2'],
    ['document marker', '---\na: 1'],
    ['tab indentation', 'a:\n\tb: 1'],
    ['multi-line plain scalar', 'a: one\n  two'],
    ['unquoted ": " in a plain scalar', 'a: b: c'],
  ])('rejects %s', (_name, text) => {
    expect(() => parseYamlSubset(text)).toThrow(YamlSubsetError);
  });
});
