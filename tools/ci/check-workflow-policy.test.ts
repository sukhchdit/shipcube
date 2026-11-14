/**
 * Workflow policy (TASK-007; SEC-TC-32, SEC-TC-51, SEC-TC-64; PR1-SEC-02/-08/-12, PR4-SEC-08, PR5-SEC-07; D-ARCH-041,
 * D-ARCH-044; AT-US-005-04/-05). Every negative fixture under fixtures/workflow-policy/ has its own test.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { FORBIDDEN_ENGINE_ENV } from '../deps/prisma-engines.mjs';
import { LINT_FIXTURE_MODE_ENV as LINT_FIXTURE_MODE_SUITE_ENV } from '../lint/fixture-expectations.mjs';
import {
  BASE_LINT_FIXTURES_SCRIPT,
  CI_REQUIRED_GATES,
  CI_TRIGGERS,
  FORBIDDEN_ENV,
  LANE_B_EVIDENCE_SCRIPT,
  LINT_FIXTURE_MODE_ENV,
  OPENAPI_BREAKING_RUN,
  PORCELAIN_RUN,
  REQUIRED_CODEOWNED_PATHS,
  checkCodeowners,
  checkJestManualMocks,
  checkWorkflow,
  checkWorkflowPolicy,
  commandLines,
  exactRunProblems,
  findDirsNamed,
  findFilesNamed,
  laneBEvidenceProblems,
  mentionsOf,
  nonAsciiProblem,
  shellSegments,
} from './check-workflow-policy.mjs';
import { OASDIFF_IMAGE } from './openapi-breaking.mjs';
import { YamlSubsetError, parseYamlSubset } from './yaml-subset.mjs';
import { EVENTS as EVIDENCE_EVENTS } from '../quality/check-evidence.mjs';

const repoRoot = findRepoRoot();
const fixtureDir = join(repoRoot, 'tools', 'ci', 'fixtures', 'workflow-policy');
const script = join(repoRoot, 'tools', 'ci', 'check-workflow-policy.mjs');

/**
 * Fixtures named `ci-*.yml`, `lane-c-*.yml` and `nightly-*.yml` are checked as `ci.yml`, `lane-c.yml` and `nightly.yml`
 * (the AT-US-005-04/-05 no-release rules, the dispatch-only rule and the Playwright install scope depend on the name).
 */
function checkedAs(fixture: string): string {
  if (fixture.startsWith('ci-')) return 'ci.yml';
  if (fixture.startsWith('lane-c-')) return 'lane-c.yml';
  if (fixture.startsWith('nightly-')) return 'nightly.yml';
  return fixture;
}

function rulesFor(fixture: string): string[] {
  const text = readFileSync(join(fixtureDir, fixture), 'utf8');
  return checkWorkflow(text, checkedAs(fixture)).map((finding) => finding.rule);
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
    ['D-ARCH-010 item 4: a schedule on lane-c.yml fails (dispatch only, hosted minutes)', 'lane-c-schedule.yml', 'dispatch-only'],
    ['D-ARCH-010 item 4: a push trigger on nightly.yml fails (dispatch only)', 'nightly-push.yml', 'dispatch-only'],
    ['AT-US-005-04: docker push in lane-c.yml fails (lane C never pushes)', 'lane-c-docker-push.yml', 'ci-no-release'],
    ['AT-US-005-05: terraform apply through "$TERRAFORM_IMAGE" in nightly.yml fails', 'nightly-terraform-apply.yml', 'ci-no-release'],
    ['PR4-SEC-08: a Playwright browser install in ci.yml fails (lane-c.yml only)', 'ci-playwright-install.yml', 'playwright-install'],
    [
      'PR4-SEC-08: DEPS_REBUILD_PLAYWRIGHT in a nightly.yml job env fails (lane-c.yml only)',
      'nightly-playwright-env.yml',
      'playwright-install',
    ],
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
    ['lane-c-valid.yml: D-ARCH-010 / PR4-SEC-08 positive control (dispatch only, browser install and terraform validate in lane-c.yml)'],
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
    const ungated = ci.replace('needs: [fast-lane, scans, security-integration]', 'needs: [fast-lane, security-integration]');
    expect(checkWorkflow(ungated, 'ci.yml', { requiredGates: true }).map((f) => f.message)).toEqual(['ci.yml ci-gate must need scans']);
    // ADR-0023 am. G item 5: the hosted security-integration job stays part of the lane A aggregate.
    const noSecurity = ci.replace('needs: [fast-lane, scans, security-integration]', 'needs: [fast-lane, scans]');
    expect(checkWorkflow(noSecurity, 'ci.yml', { requiredGates: true }).map((f) => f.message)).toEqual([
      'ci.yml ci-gate must need security-integration',
    ]);
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

  describe('D-ORCH-018 / PR17-SEC-03: the base-ref lint fixture step is a pinned required gate; the mode variable lives on that step only', () => {
    const ci = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    const messages = (text: string) => checkWorkflow(text, 'ci.yml', { requiredGates: true }).map((f) => `${f.rule}: ${f.message}`);
    const modeEntry = '        env:\n          LINT_FIXTURE_MODE: no-weakening\n';
    const guard = "        if: env.CODE == 'true' && env.LINT_CONTROLS == 'true'\n" + modeEntry;
    const jest = '          node --experimental-vm-modules --disable-warning=ExperimentalWarning node_modules/jest/bin/jest.js \\\n';
    const jestArgs = '            --config "$config" --runTestsByPath "$suite" || status=$?\n';
    const mustSet = 'required-gates: ci.yml base-ref lint negative fixtures gate step must set env LINT_FIXTURE_MODE: no-weakening';
    const onlyHere = "lint-fixture-mode: LINT_FIXTURE_MODE may be set only in the env of ci.yml's base-ref lint fixture step";
    // A changed step is no longer the gate, so its env entry is a stray mention too.
    const notTheGate = ['required-gates: ci.yml job fast-lane must keep the base-ref lint negative fixtures gate step', onlyHere].sort();
    const replaceOnce = (text: string, from: string, to: string) => {
      expect(text.split(from)).toHaveLength(2);
      return text.replace(from, to);
    };

    it('the committed step is the pinned script, and the pin ignores comment and blank lines only', () => {
      expect(ci.split(modeEntry)).toHaveLength(2);
      expect(ci.split(jest + jestArgs)).toHaveLength(2);
      const run = ci.slice(ci.indexOf('          set -euo pipefail\n          suite=tools/lint/negative-fixtures.test.ts'));
      expect(commandLines(run.slice(0, run.indexOf('\n\n'))).map((line) => line.replace(/^ {10}/u, ''))).toEqual([
        ...BASE_LINT_FIXTURES_SCRIPT,
      ]);
      expect(messages(replaceOnce(ci, jest, `          # a reworded comment\n\n${jest}`))).toEqual([]);
      // After a line continuation bash joins the next line to the command, so it is not skipped there.
      expect(messages(replaceOnce(ci, jest + jestArgs, `${jest}          #\n${jestArgs}`))).toEqual(notTheGate);
      expect(commandLines('a \\\n# x\nb\n\n# y\nc')).toEqual(['a \\', '# x', 'b', 'c']);
    });

    it('review m1 / PR17-SEC-03: any other Jest flag, spelling or tail is not the gate (allow-list, not a deny-list)', () => {
      const mutations: [string, string][] = [
        ['--testNamePattern', jestArgs.replace(' ||', " --testNamePattern 'x' ||")],
        ['--test-name-pattern (kebab)', jestArgs.replace(' ||', ' --test-name-pattern x ||')],
        ['-tx (attached)', jestArgs.replace(' ||', ' -tx ||')],
        [
          '--pass-with-no-tests --test-path-ignore-patterns',
          jestArgs.replace(' ||', ' --pass-with-no-tests --test-path-ignore-patterns negative ||'),
        ],
        ['--listTests', jestArgs.replace(' ||', ' --listTests ||')],
        ['--onlyChanged', jestArgs.replace(' ||', ' --onlyChanged ||')],
        ['-o', jestArgs.replace(' ||', ' -o ||')],
        ['--lastCommit', jestArgs.replace(' ||', ' --lastCommit ||')],
        ['--showConfig', jestArgs.replace(' ||', ' --showConfig ||')],
        ['--shard=2/2', jestArgs.replace(' ||', ' --shard=2/2 ||')],
        ['inline JSON --config', jestArgs.replace('--config "$config"', `--config '{"passWithNoTests":true}'`)],
        ['head jest.config.ts (no --config)', jestArgs.replace('--config "$config" ', '')],
        ['positional suite instead of --runTestsByPath', jestArgs.replace('--runTestsByPath "$suite"', '"$suite"')],
        ['--selectProjects unit', jestArgs.replace(' ||', ' --selectProjects unit ||')],
        ['|| true', jestArgs.replace('|| status=$?', '|| true')],
      ];
      for (const [title, args] of mutations) {
        expect([title, messages(replaceOnce(ci, jestArgs, args))]).toEqual([title, notTheGate]);
      }
      const tail = '          exit "$status"\n';
      expect(messages(replaceOnce(ci, tail, '          exit 0\n'))).toEqual(notTheGate);
      expect(messages(replaceOnce(ci, '          git checkout "$RANGE_BASE" -- "${base_paths[@]}"\n', '          true\n'))).toEqual(
        notTheGate,
      );
      expect(messages(replaceOnce(ci, jest, `          git checkout HEAD -- tools/lint/fixture-expectations.mjs\n${jest}`))).toEqual(
        notTheGate,
      );
    });

    it('PR17-SEC-03: shell:, working-directory:, defaults.run and any other step env fail; the env and guard are pinned', () => {
      expect(messages(replaceOnce(ci, guard, `${guard}        shell: 'true {0}'\n`))).toEqual([
        'required-gates: ci.yml base-ref lint negative fixtures gate step must not set shell',
      ]);
      expect(messages(replaceOnce(ci, guard, `${guard}        working-directory: apps\n`))).toEqual([
        'required-gates: ci.yml base-ref lint negative fixtures gate step must not set working-directory',
      ]);
      expect(messages(replaceOnce(ci, guard, `${guard}          RANGE_BASE: HEAD\n`))).toEqual([
        'required-gates: ci.yml base-ref lint negative fixtures gate step must set no env but LINT_FIXTURE_MODE (found RANGE_BASE)',
      ]);
      expect(messages(replaceOnce(ci, '  fast-lane:\n', "  fast-lane:\n    defaults:\n      run:\n        shell: 'true {0}'\n"))).toEqual([
        'required-gates: ci.yml job fast-lane must not set defaults.run (it would change how its gate steps run)',
      ]);
      expect(messages(replaceOnce(ci, '\njobs:\n', '\ndefaults:\n  run:\n    working-directory: apps\njobs:\n'))).toEqual([
        'required-gates: ci.yml must not set defaults.run (it would change how every gate step runs)',
      ]);
      expect(messages(ci.replace(modeEntry, ''))).toEqual([mustSet]);
      expect(messages(ci.replace(modeEntry, modeEntry.replace('no-weakening', 'exact')))).toEqual([mustSet]);
      expect(messages(ci.replace(guard, guard.replace("LINT_CONTROLS == 'true'", "LINT_CONTROLS == 'never'")))).toEqual([
        expect.stringContaining('base-ref lint negative fixtures gate step must be guarded only by'),
      ]);
    });

    it('lint-fixture-mode: the variable anywhere else fails, also split by quotes or a line continuation (review n3)', () => {
      expect(messages(ci.replace('        run: npm run test:unit\n', `${modeEntry}        run: npm run test:unit\n`))).toEqual([onlyHere]);
      const unitTests = '        run: npm run test:unit\n';
      for (const write of [
        'echo "LINT_FIXTURE_MODE=exact" >> "$GITHUB_ENV"',
        'echo "LINT_FIX""TURE_MODE=exact" >> "$GITHUB_ENV"',
        "export LINT_FIX'TURE_MODE'=exact",
        'echo LINT_FIX\\\n            TURE_MODE=exact >> "$GITHUB_ENV"',
      ]) {
        const text = replaceOnce(ci, unitTests, `        run: |\n          ${write}\n          npm run test:unit\n`);
        expect([write, messages(text)]).toEqual([
          write,
          [onlyHere, 'required-gates: ci.yml job fast-lane must keep the unit tests gate step'].sort(),
        ]);
      }
      expect(
        mentionsOf({ a: ['x', { LINT_FIXTURE_MODE: 'y' }], b: 'LINT_FIXTURE_MODE=1', c: 'LINT_FIX"TURE_MODE' }, 'LINT_FIXTURE_MODE'),
      ).toEqual([['a', '1', 'LINT_FIXTURE_MODE'], ['b'], ['c']]);
      expect(LINT_FIXTURE_MODE_ENV).toBe(LINT_FIXTURE_MODE_SUITE_ENV);
    });
  });

  it('PR17-SEC-01: a committed .swcrc anywhere in the tree fails (repository mode); nested checkouts and node_modules are not walked', () => {
    const root = mkdtempSync(join(tmpdir(), 'workflow-policy-'));
    try {
      mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
      cpSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), join(root, '.github', 'workflows', 'ci.yml'));
      cpSync(join(repoRoot, '.github', 'CODEOWNERS'), join(root, '.github', 'CODEOWNERS'));
      for (const dir of ['tools', 'node_modules/pkg', '.claude/worktrees/other']) mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, '.claude', 'worktrees', 'other', '.git'), 'gitdir: elsewhere\n');
      writeFileSync(join(root, '.claude', 'worktrees', 'other', '.swcrc'), '{}\n');
      writeFileSync(join(root, 'node_modules', 'pkg', '.swcrc'), '{}\n');
      expect(checkWorkflowPolicy(root).findings).toEqual([]);
      writeFileSync(join(root, '.swcrc'), '{}\n');
      writeFileSync(join(root, 'tools', '.swcrc'), '{"jsc":{"baseUrl":".","paths":{"@jest/globals":["./shim"]}}}\n');
      expect(checkWorkflowPolicy(root).findings.map((f) => `${f.rule} ${f.location}`)).toEqual(['swcrc .swcrc', 'swcrc tools/.swcrc']);
      expect(findFilesNamed(root, '.swcrc')).toEqual(['.swcrc', 'tools/.swcrc']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('[PR17-SEC-09] jest-manual-mocks: any __mocks__ directory and any tracked node_modules/ path fail (repository mode)', () => {
    const root = mkdtempSync(join(tmpdir(), 'workflow-policy-mocks-'));
    const git = (...args: string[]) => {
      const r = spawnSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args], {
        cwd: root,
        encoding: 'utf8',
        timeout: 30_000,
        windowsHide: true,
      });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    };
    try {
      mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
      cpSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), join(root, '.github', 'workflows', 'ci.yml'));
      cpSync(join(repoRoot, '.github', 'CODEOWNERS'), join(root, '.github', 'CODEOWNERS'));
      // An installed package's own __mocks__ (node_modules is not walked) and an untracked node_modules are fine.
      mkdirSync(join(root, 'node_modules', 'pkg', '__mocks__'), { recursive: true });
      writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), '\n');
      git('init', '-q');
      writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
      git('add', '-A');
      git('commit', '-q', '-m', 'base');
      expect(checkJestManualMocks(root)).toEqual([]);
      expect(checkWorkflowPolicy(root).findings).toEqual([]);
      mkdirSync(join(root, 'apps', 'x', '__mocks__'), { recursive: true });
      writeFileSync(join(root, 'apps', 'x', '__mocks__', 'pg.js'), "module.exports = 'planted';\n");
      mkdirSync(join(root, 'packages', 'p', 'node_modules', '@platform', 'authz'), { recursive: true });
      writeFileSync(join(root, 'packages', 'p', 'node_modules', '@platform', 'authz', 'index.js'), '\n');
      git('add', '-f', 'packages/p/node_modules/@platform/authz/index.js');
      expect(checkWorkflowPolicy(root).findings.map((f) => `${f.rule} ${f.location}`)).toEqual([
        'jest-manual-mocks apps/x/__mocks__/',
        'jest-manual-mocks packages/p/node_modules/@platform/authz/index.js',
      ]);
      expect(findDirsNamed(root, '__mocks__')).toEqual(['apps/x/__mocks__']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  describe('[PR23-SEC-06] lane B evidence step pin (D-SEC-PR23-02 (2), D-ORCH-032 (1), R2-n2, R2-n3)', () => {
    const ci = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    const baseLine =
      'node "$quality/base/tools/quality/check-evidence.mjs" --root "$GITHUB_WORKSPACE" --base "$RANGE_BASE" --head "$RANGE_HEAD" --event "$GITHUB_EVENT_NAME" --summary "$GITHUB_STEP_SUMMARY"';
    const stepName = '      - name: Lane B evidence (quality:check-evidence)\n';
    const pushGuard = '            if [ "$GITHUB_EVENT_NAME" = "push" ]; then\n';
    const swap = (from: string, to: string): string => {
      expect(ci).toContain(from);
      return ci.replace(from, () => to);
    };
    const messages = (text: string) => checkWorkflow(text, 'ci.yml', { requiredGates: true }).map((f) => `${f.rule}: ${f.message}`);

    it('[PR23-SEC-06] the committed step passes and equals LANE_B_EVIDENCE_SCRIPT', () => {
      expect(messages(ci)).toEqual([]);
      expect(laneBEvidenceProblems(LANE_B_EVIDENCE_SCRIPT.join('\n'))).toEqual([]);
    });

    it.each<[string, () => string, string]>([
      ['step removed', () => swap(stepName, '      - name: Evidence check\n'), 'must keep the lane B evidence gate step'],
      [
        'step made conditional',
        () => swap(stepName, `${stepName}        if: env.CODE == 'true'\n`),
        'lane B evidence gate step must be unconditional',
      ],
      [
        'head-copy bootstrap branch restored',
        () =>
          swap(
            `          ${baseLine}\n`,
            `          ${baseLine}\n          node "$quality/head/tools/quality/check-evidence.mjs" --report-only\n`,
          ),
        'head-copy bootstrap branch is refused',
      ],
      ['--report-only on the base-ref line (R2-n3)', () => swap(baseLine, `${baseLine} --report-only`), '--report-only is refused'],
      [
        'literal event value',
        () => swap(baseLine, baseLine.replace('"$GITHUB_EVENT_NAME"', 'pull_request')),
        '--event must be "$GITHUB_EVENT_NAME" (found pull_request)',
      ],
      [
        '--event= literal',
        () => swap(baseLine, baseLine.replace('--event "$GITHUB_EVENT_NAME"', '--event=push')),
        '--event must be "$GITHUB_EVENT_NAME" (found push)',
      ],
      [
        'inline assignment',
        () => swap(`          ${baseLine}`, `          GITHUB_EVENT_NAME=push ${baseLine}`),
        'GITHUB_EVENT_NAME must not be assigned',
      ],
      [
        'export in the script',
        () =>
          swap(
            '          set -euo pipefail\n          quality=',
            '          set -euo pipefail\n          export GITHUB_EVENT_NAME=push\n          quality=',
          ),
        'GITHUB_EVENT_NAME must not be assigned',
      ],
      [
        'step env key',
        () => swap(stepName, `${stepName}        env:\n          GITHUB_EVENT_NAME: push\n`),
        'must set no env but  (found GITHUB_EVENT_NAME)',
      ],
      [
        'job env key',
        () =>
          swap(
            '      RANGE_BASE: ${{ github.event.pull_request.base.sha',
            '      GITHUB_EVENT_NAME: push\n      RANGE_BASE: ${{ github.event.pull_request.base.sha',
          ),
        'reserved-env: GITHUB_EVENT_NAME',
      ],
      ['--event push with --profile wave', () => swap(baseLine, `${baseLine} --profile wave`), '--profile wave|gate is not a lane A run'],
      [
        'no-base branch exits 0 on pull_request',
        () => swap(pushGuard, '            if true; then\n'),
        'must be exactly LANE_B_EVIDENCE_SCRIPT',
      ],
      ['verifier made non-fatal', () => swap(baseLine, `${baseLine} || true`), 'must be exactly LANE_B_EVIDENCE_SCRIPT'],
      [
        'merge_group trigger added (R2-n2)',
        () => swap('\non:\n', '\non:\n  merge_group:\n'),
        'ci.yml trigger merge_group is not in CI_TRIGGERS',
      ],
      [
        'workflow_dispatch trigger added (R2-n2)',
        () => swap('\non:\n', '\non:\n  workflow_dispatch:\n'),
        'ci.yml trigger workflow_dispatch is not in CI_TRIGGERS',
      ],
    ])('[PR23-SEC-06] probe: %s is a finding', (_name, mutate, expected) => {
      const mutated = mutate();
      expect(mutated).not.toBe(ci);
      expect(messages(mutated)).toEqual(expect.arrayContaining([expect.stringContaining(expected)]));
    });

    it('[R2-n2] CI_TRIGGERS are exactly the check-evidence EVENTS', () => {
      expect([...CI_TRIGGERS]).toEqual([...EVIDENCE_EVENTS]);
    });

    it.each(['\u00a0', '\u2000', '\u2005', '\u200a', '\u3000'])(
      '[PR33-SEC-01] a "comment" line led by U+%s (bash runs it as a command) is a finding, not a skipped comment',
      (blank) => {
        const probe = swap(`          ${baseLine}\n`, `          ${blank}# || exit 0\n          ${baseLine}\n`);
        const found = messages(probe);
        expect(found.length).toBeGreaterThan(0);
        // U+00A0 is the reviewed probe (M06): the YAML subset accepts it, so the pin itself must refuse it.
        if (blank === '\u00a0')
          expect(found).toEqual(
            expect.arrayContaining([
              expect.stringContaining('lane B evidence gate step: non-ASCII character U+00A0'),
              expect.stringContaining('must be exactly LANE_B_EVIDENCE_SCRIPT'),
            ]),
          );
      },
    );
  });

  describe('[PR #33 R1-m2] [PR33-SEC-03] porcelain and openapi-breaking pins: exact command, no step env, fixed position', () => {
    const ci = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    const messages = (text: string) => checkWorkflow(text, 'ci.yml', { requiredGates: true }).map((f) => `${f.rule}: ${f.message}`);
    const swap = (text: string, from: string, to: string): string => {
      expect(text.split(from)).toHaveLength(2);
      return text.replace(from, () => to);
    };
    const oasRun = `        run: ${OPENAPI_BREAKING_RUN}\n`;
    const oasName = '      - name: OpenAPI breaking changes against the latest release tag (oasdiff, NFR-MAINT-004)\n';
    const afterLintStep = `      - name: Lint must not mutate the tree (git status --porcelain)\n        if: env.CODE == 'true'\n        run: ${PORCELAIN_RUN}\n\n`;
    const afterLintRun = `      - name: Lint must not mutate the tree (git status --porcelain)\n        if: env.CODE == 'true'\n        run: ${PORCELAIN_RUN}\n`;
    const afterBuildRun = `      - name: Build must not mutate the tree (git status --porcelain)\n        if: env.CODE == 'true'\n        run: ${PORCELAIN_RUN}\n`;
    const lintStep = '      - name: Lint (ESLint, Stylelint, suppressions)\n';
    const semgrepSelfTest = '      - name: Semgrep rule self-test (when rules or their fixtures change)\n';
    const otherDigest = `docker.io/tufin/oasdiff:v1.37.0@sha256:${'b'.repeat(64)}`;

    it('the committed steps pass and carry exactly the pinned lines', () => {
      expect(messages(ci)).toEqual([]);
      expect(ci.split(oasRun)).toHaveLength(2);
      expect(ci.split(afterLintRun)).toHaveLength(2);
      expect(ci.split(afterBuildRun)).toHaveLength(2);
      expect(exactRunProblems(PORCELAIN_RUN)(`${PORCELAIN_RUN}\n`)).toEqual([]);
      expect(exactRunProblems(PORCELAIN_RUN)(`# why\n${PORCELAIN_RUN}\n\n`)).toEqual([]);
    });

    it.each<[string, () => string, string]>([
      [
        'openapi: || true',
        () => swap(ci, oasRun, oasRun.replace(/\n$/u, ' || true\n')),
        'openapi-breaking gate step: the run: must be exactly',
      ],
      [
        'openapi: ; true',
        () => swap(ci, oasRun, oasRun.replace(/\n$/u, '; true\n')),
        'openapi-breaking gate step: the run: must be exactly',
      ],
      [
        'openapi: true || prefix',
        () => swap(ci, oasRun, oasRun.replace('run: node', 'run: true || node')),
        'openapi-breaking gate step: the run: must be exactly',
      ],
      [
        'openapi: output discarded',
        () => swap(ci, oasRun, oasRun.replace(/\n$/u, ' >/dev/null 2>&1\n')),
        'openapi-breaking gate step: the run: must be exactly',
      ],
      [
        'openapi: --base "$RANGE_HEAD"',
        () => swap(ci, oasRun, oasRun.replace('--base "$RANGE_BASE"', '--base "$RANGE_HEAD"')),
        'openapi-breaking gate step: the run: must be exactly',
      ],
      [
        'openapi: second line exit 0',
        () => swap(ci, oasRun, `        run: |\n          ${OPENAPI_BREAKING_RUN}\n          exit 0\n`),
        'openapi-breaking gate step: the run: must be exactly',
      ],
      [
        'openapi: trailing U+00A0',
        () => swap(ci, oasRun, oasRun.replace(/\n$/u, '\u00a0\n')),
        'ci.yml non-ASCII character U+00A0 outside a comment line',
      ],
      [
        'openapi: step env GATE_OPENAPI_BREAKING (head copy of the checker)',
        () => swap(ci, oasName, `${oasName}        env:\n          GATE_OPENAPI_BREAKING: ./evil.mjs\n`),
        'openapi-breaking gate step must set no env but  (found GATE_OPENAPI_BREAKING)',
      ],
      [
        'openapi: step env GATE_* is also a gate-env finding',
        () => swap(ci, oasName, `${oasName}        env:\n          GATE_OPENAPI_BREAKING: ./evil.mjs\n`),
        'gate-env: GATE_OPENAPI_BREAKING locates gate tooling',
      ],
      [
        'openapi: step env OASDIFF_IMAGE (M25)',
        () => swap(ci, oasName, `${oasName}        env:\n          OASDIFF_IMAGE: ${otherDigest}\n`),
        'openapi-breaking gate step must set no env but  (found OASDIFF_IMAGE)',
      ],
      [
        'openapi: workflow OASDIFF_IMAGE swapped (M26)',
        () => swap(ci, `  OASDIFF_IMAGE: ${OASDIFF_IMAGE}\n`, `  OASDIFF_IMAGE: ${otherDigest}\n`),
        'ci.yml workflow env OASDIFF_IMAGE must be',
      ],
      [
        'openapi: job env OASDIFF_IMAGE',
        () =>
          swap(
            ci,
            '      PR_NUMBER: ${{ github.event.pull_request.number }}\n',
            `      PR_NUMBER: \${{ github.event.pull_request.number }}\n      OASDIFF_IMAGE: ${OASDIFF_IMAGE}\n`,
          ),
        'ci.yml job scans must not set OASDIFF_IMAGE',
      ],
      [
        'openapi: job env GATES_DIR',
        () =>
          swap(
            ci,
            '      PR_NUMBER: ${{ github.event.pull_request.number }}\n',
            '      PR_NUMBER: ${{ github.event.pull_request.number }}\n      GATES_DIR: /tmp/x\n',
          ),
        'gate-env: GATES_DIR locates gate tooling',
      ],
      [
        'porcelain after lint: || true',
        () => swap(ci, afterLintRun, afterLintRun.replace(/\n$/u, ' || true\n')),
        'porcelain after lint gate step: the run: must be exactly',
      ],
      [
        'porcelain after lint: output discarded',
        () => swap(ci, afterLintRun, afterLintRun.replace(/\n$/u, ' >/dev/null\n')),
        'porcelain after lint gate step: the run: must be exactly',
      ],
      [
        'porcelain after lint: step env GATE_CHECK_PORCELAIN',
        () =>
          swap(
            ci,
            afterLintRun,
            afterLintRun.replace('        run:', '        env:\n          GATE_CHECK_PORCELAIN: ./x.mjs\n        run:'),
          ),
        'porcelain after lint gate step must set no env but  (found GATE_CHECK_PORCELAIN)',
      ],
      [
        'porcelain after lint: moved before Lint',
        () => swap(swap(ci, afterLintStep, ''), lintStep, `${afterLintStep}${lintStep}`),
        'porcelain after lint gate step must directly follow the lint gate step',
      ],
      [
        'porcelain after lint: moved to the end of the job',
        () => swap(swap(ci, afterLintStep, ''), semgrepSelfTest, `${afterLintStep}${semgrepSelfTest}`),
        'porcelain after lint gate step must directly follow the lint gate step',
      ],
      [
        'porcelain after build: || true',
        () => swap(ci, afterBuildRun, afterBuildRun.replace(/\n$/u, ' || true\n')),
        'porcelain gate step: the run: must be exactly',
      ],
      [
        'base-ref lint fixtures: a U+00A0-led comment line (PR33-SEC-01)',
        () =>
          swap(
            ci,
            '          git checkout "$RANGE_BASE" -- "${base_paths[@]}"\n',
            '          \u00a0# || exit 0\n          git checkout "$RANGE_BASE" -- "${base_paths[@]}"\n',
          ),
        'must keep the base-ref lint negative fixtures gate step',
      ],
      [
        'porcelain after build: moved before Build',
        () => swap(swap(ci, `${afterBuildRun}\n`, ''), '      - name: Build\n', `${afterBuildRun}\n      - name: Build\n`),
        'porcelain gate step must directly follow the build gate step',
      ],
    ])('probe: %s is a finding', (_name, mutate, expected) => {
      const mutated = mutate();
      expect(mutated).not.toBe(ci);
      expect(messages(mutated)).toEqual(expect.arrayContaining([expect.stringContaining(expected)]));
    });

    it('commandLines treats only ASCII blanks as blank (PR33-SEC-01)', () => {
      expect(commandLines('\u00a0# x\nb\n \t# y\n\u3000\n')).toEqual(['\u00a0# x', 'b', '\u3000']);
      expect(commandLines('a\u00a0\nb \t')).toEqual(['a\u00a0', 'b']);
      expect(nonAsciiProblem('plain ascii\t\n')).toBeNull();
      expect(nonAsciiProblem('x\u200ay')).toContain('U+200A');
    });
  });

  it('[PR17-SEC-09] the repository CODEOWNERS owns **/__mocks__/ and it is a required owned path', () => {
    const text = readFileSync(join(repoRoot, '.github', 'CODEOWNERS'), 'utf8');
    expect(text).toMatch(/^\*\*\/__mocks__\/\s+@\S+$/mu);
    expect(REQUIRED_CODEOWNED_PATHS).toContain('**/__mocks__/');
    expect(checkCodeowners(text.replace(/^\*\*\/__mocks__\/ .*$/mu, '')).map((f) => f.message)).toEqual([
      expect.stringContaining('**/__mocks__/'),
    ]);
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
    // `/prisma/` (PR24-SEC-04) would cover prisma/migrations/, so both lines are dropped and both must be reported.
    const text = REQUIRED_CODEOWNED_PATHS.filter((path) => path !== 'prisma/migrations/' && path !== 'prisma/')
      .map((path) => `/${path} @owner`)
      .concat(['# /prisma/migrations/ @owner', '/prisma/migrations/', '# /prisma/ @owner', '/prisma/'])
      .join('\n');
    expect(checkCodeowners(text).map((f) => f.message)).toEqual([
      expect.stringContaining('prisma/migrations/'),
      expect.stringContaining('prisma/ ('),
    ]);
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
      '/.swcrc @o',
      '**/.swcrc @o',
      '**/__mocks__/ @o',
      '/packages/shared/ @o',
      '**/package.json @o',
      '/tsconfig.json @o',
      '/tsconfig.base.json @o',
      '/commitlint.config.mjs @o',
      '/.node-version @o',
      '/prisma.config.ts @o',
      '/apps/ @o',
      '/tests/ @o',
      '/.gitattributes @o',
      '**/.gitattributes @o',
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
        'tools/test-dom/',
        'tools/quality/',
        '.swcrc',
        '**/.swcrc',
        'CLAUDE.md',
        '.claude/settings.json',
        '.claude/agents/',
      ]),
    );
  });

  it('PR17-SEC-01: the repository CODEOWNERS owns a root and a nested .swcrc', () => {
    const text = readFileSync(join(findRepoRoot(), '.github', 'CODEOWNERS'), 'utf8');
    expect(text).toMatch(/^\/\.swcrc\s+@\S+$/mu);
    expect(text).toMatch(/^\*\*\/\.swcrc\s+@\S+$/mu);
    expect(checkCodeowners(text.replace(/^\*\*\/\.swcrc .*$/mu, '')).map((f) => f.message)).toEqual([expect.stringContaining('**/.swcrc')]);
  });
});

describe('CODEOWNERS: tools/quality (PR #23 R1-M1, PR23-SEC-01)', () => {
  const repositoryText = (): string => readFileSync(join(findRepoRoot(), '.github', 'CODEOWNERS'), 'utf8');
  const qualityLine = /^\/tools\/quality\/\s+@\S+$/mu;

  it('the repository CODEOWNERS owns tools/quality and the path is required', () => {
    expect(REQUIRED_CODEOWNED_PATHS).toContain('tools/quality/');
    expect(repositoryText()).toMatch(qualityLine);
  });

  it('mutation: deleting the tools/quality line yields a codeowners finding for it', () => {
    const mutated = repositoryText().replace(qualityLine, '');
    expect(mutated).not.toMatch(qualityLine);
    const findings = checkCodeowners(mutated);
    expect(findings.map((f) => f.rule)).toEqual([expect.stringMatching(/^codeowners-/u)]);
    expect(findings.map((f) => f.message)).toEqual([expect.stringContaining('tools/quality/')]);
  });

  it('mutation: leaving the tools/quality line ownerless or commenting it out yields the same finding', () => {
    for (const replacement of ['/tools/quality/', '# /tools/quality/ @sukhchdit']) {
      const findings = checkCodeowners(repositoryText().replace(qualityLine, replacement));
      expect(findings.map((f) => f.message)).toEqual([expect.stringContaining('tools/quality/')]);
    }
  });

  it('a parent-folder pattern for tools/ would cover it, a sibling folder would not', () => {
    const without = repositoryText().replace(qualityLine, '');
    expect(checkCodeowners(`${without}\n/tools/ @sukhchdit\n`)).toEqual([]);
    expect(checkCodeowners(`${without}\n/tools/qualitys/ @sukhchdit\n`).map((f) => f.message)).toEqual([
      expect.stringContaining('tools/quality/'),
    ]);
  });
});

describe('CODEOWNERS: O4 oracles and pre-gate configs (PR24-SEC-04, PR4-SEC-13 item 3)', () => {
  const repositoryText = (): string => readFileSync(join(findRepoRoot(), '.github', 'CODEOWNERS'), 'utf8');
  const lineFor = (path: string): RegExp => new RegExp(`^/${path.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s+@\\S+$`, 'mu');
  const added = ['prisma/', 'tools/db/', 'prisma.config.ts', 'apps/api/src/platform/', 'apps/*/vite.config.ts'];

  it.each(added)('[PR24-SEC-04] %s is required and the repository CODEOWNERS owns it', (path) => {
    expect(REQUIRED_CODEOWNED_PATHS).toContain(path);
    expect(repositoryText()).toMatch(lineFor(path));
  });

  it.each(added)('[PR24-SEC-04] mutation: deleting, commenting out or un-owning the %s line yields one finding for it', (path) => {
    for (const replacement of ['', `# /${path} @sukhchdit`, `/${path}`]) {
      const mutated = repositoryText().replace(lineFor(path), replacement);
      expect(mutated).not.toMatch(lineFor(path));
      expect(checkCodeowners(mutated).map((f) => f.message)).toEqual([expect.stringContaining(`${path} (`)]);
    }
  });

  it('[PR24-SEC-04] the narrower prisma/tools-db lines are kept, so folding cannot drop coverage silently', () => {
    for (const path of ['prisma/bootstrap/', 'prisma/migrations/', 'tools/db/lint-migrations.ts', 'tools/db/audit-ddl-reviewers.json']) {
      expect(repositoryText()).toMatch(lineFor(path));
    }
  });
});

describe('CODEOWNERS: git attributes at any depth (PR40-SEC-01)', () => {
  const repositoryText = (): string => readFileSync(join(findRepoRoot(), '.github', 'CODEOWNERS'), 'utf8');
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const cases: readonly (readonly [string, string])[] = [
    ['.gitattributes', '/.gitattributes'],
    ['**/.gitattributes', '**/.gitattributes'],
  ];

  it.each(cases)('[PR40-SEC-01] %s is required and the repository CODEOWNERS owns it', (path, line) => {
    expect(REQUIRED_CODEOWNED_PATHS).toContain(path);
    expect(repositoryText()).toMatch(new RegExp(`^${escape(line)}\\s+@\\S+$`, 'mu'));
  });

  it.each(cases)('[PR40-SEC-01] mutation: deleting, commenting out or un-owning the %s line yields one finding for it', (path, line) => {
    const pattern = new RegExp(`^${escape(line)}\\s+@\\S+$`, 'mu');
    for (const replacement of ['', `# ${line} @sukhchdit`, line]) {
      const mutated = repositoryText().replace(pattern, replacement);
      expect(mutated).not.toMatch(pattern);
      expect(checkCodeowners(mutated).map((f) => f.message)).toEqual([expect.stringContaining(`to ${path} (`)]);
    }
  });
});

describe('CODEOWNERS: server-controlled ids and workspace manifests (PR26-SEC-07)', () => {
  const repositoryText = (): string => readFileSync(join(findRepoRoot(), '.github', 'CODEOWNERS'), 'utf8');
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const cases: readonly (readonly [string, string])[] = [
    ['packages/shared/src/ids/', '/packages/shared/src/ids/'],
    ['**/package.json', '**/package.json'],
  ];

  it.each(cases)('[PR26-SEC-07] %s is required and the repository CODEOWNERS owns it', (path, line) => {
    expect(REQUIRED_CODEOWNED_PATHS).toContain(path);
    expect(repositoryText()).toMatch(new RegExp(`^${escape(line)}\\s+@\\S+$`, 'mu'));
  });

  it.each(cases)('[PR26-SEC-07] mutation: deleting, commenting out or un-owning the %s line yields one finding for it', (path, line) => {
    const pattern = new RegExp(`^${escape(line)}\\s+@\\S+$`, 'mu');
    for (const replacement of ['', `# ${line} @sukhchdit`, line]) {
      const mutated = repositoryText().replace(pattern, replacement);
      expect(mutated).not.toMatch(pattern);
      expect(checkCodeowners(mutated).map((f) => f.message)).toEqual([expect.stringContaining(`${path} (`)]);
    }
  });
});

describe('CODEOWNERS: every app database platform, the credential predicate and the SEC-TC-29 oracles (PR38-SEC-02/-06)', () => {
  const repositoryText = (): string => readFileSync(join(findRepoRoot(), '.github', 'CODEOWNERS'), 'utf8');
  const lineFor = (path: string): RegExp => new RegExp(`^/${path.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s+@\\S+$`, 'mu');
  const added = [
    'apps/worker/src/platform/db/',
    'packages/shared/src/http/',
    'tests/api/helpers/cache-control.ts',
    'tests/api/helpers/contract-validator.ts',
    'tests/contract-stubs/',
  ];

  it.each(added)('[PR38-SEC-02/-06] %s is required and the repository CODEOWNERS owns it', (path) => {
    expect(REQUIRED_CODEOWNED_PATHS).toContain(path);
    expect(repositoryText()).toMatch(lineFor(path));
  });

  it.each(added)('[PR38-SEC-02/-06] mutation: deleting, commenting out or un-owning the %s line yields one finding for it', (path) => {
    for (const replacement of ['', `# /${path} @sukhchdit`, `/${path}`]) {
      const mutated = repositoryText().replace(lineFor(path), replacement);
      expect(mutated).not.toMatch(lineFor(path));
      expect(checkCodeowners(mutated).map((f) => f.message)).toEqual([expect.stringContaining(`${path} (`)]);
    }
  });
});

describe('CODEOWNERS: the O3 oracle, the RLS generator and the route enumeration source (PR43-SEC-04)', () => {
  const repositoryText = (): string => readFileSync(join(findRepoRoot(), '.github', 'CODEOWNERS'), 'utf8');
  const lineFor = (path: string): RegExp => new RegExp(`^/${path.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s+@\\S+$`, 'mu');
  const added = ['tests/generated/rls/', 'tests/generated/api-mounts.ts'];

  it.each(added)('[PR43-SEC-04] %s is required and the repository CODEOWNERS owns it', (path) => {
    expect(REQUIRED_CODEOWNED_PATHS).toContain(path);
    expect(repositoryText()).toMatch(lineFor(path));
  });

  it.each(added)('[PR43-SEC-04] mutation: deleting, commenting out or un-owning the %s line yields one finding for it', (path) => {
    for (const replacement of ['', `# /${path} @sukhchdit`, `/${path}`]) {
      const mutated = repositoryText().replace(lineFor(path), replacement);
      expect(mutated).not.toMatch(lineFor(path));
      expect(checkCodeowners(mutated).map((f) => f.message)).toEqual([expect.stringContaining(`${path} (`)]);
    }
  });

  it('[PR43-SEC-04] a sibling generated folder is not covered by the rls line', () => {
    const without = repositoryText().replace(lineFor('tests/generated/rls/'), '');
    expect(checkCodeowners(`${without}\n/tests/generated/rbac/ @sukhchdit\n`).map((f) => f.message)).toEqual([
      expect.stringContaining('tests/generated/rls/ ('),
    ]);
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
