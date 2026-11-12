/**
 * Suite `ci-policy` (TASK-007): US-005 acceptance tests AT-US-005-01..06 plus the CI parts of SEC-TC-32, SEC-TC-45 and
 * SEC-TC-64, asserted over the committed `.github/workflows/ci.yml` (lane A) and the workflow policy checker.
 *
 * Lane A is the only hosted lane this task delivers. Lane C (workflow_dispatch: integration, images, e2e, iac) and the
 * coverage/contract-drift steps are TASK-015; the test titles say which part each test proves.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';
import { checkWorkflow } from './check-workflow-policy.mjs';
import { isMap, parseYamlSubset } from './yaml-subset.mjs';
import type { YamlMap, YamlNode } from './yaml-subset.mjs';

const repoRoot = findRepoRoot();
const ciText = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
const parsed = parseYamlSubset(ciText).value ?? undefined;
/** ci.yml without its comment lines (the header comment names what the file must NOT do). */
const ciCode = ciText
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

function map(node: YamlNode | undefined, what: string): YamlMap {
  if (!isMap(node)) throw new Error(`${what} is not a mapping`);
  return node;
}

const str = (node: YamlNode | undefined): string => (typeof node === 'string' ? node : '');
const ci = map(parsed, 'ci.yml');
const jobs = map(ci.jobs, 'jobs');
const fastLane = map(jobs['fast-lane'], 'fast-lane');
const steps = (Array.isArray(fastLane.steps) ? fastLane.steps : []).map((step, index) => map(step, `step ${index}`));
const stepText = (step: YamlMap) => `${str(step.name)}\n${str(step.run)}\n${str(step.uses)}`;
const indexOf = (pattern: RegExp): number => {
  const index = steps.findIndex((step) => pattern.test(stepText(step)));
  if (index < 0) throw new Error(`no fast-lane step matches ${String(pattern)}`);
  return index;
};
const triggers = map(ci.on, 'on');
const scans = map(jobs.scans, 'scans');
const scanSteps = (Array.isArray(scans.steps) ? scans.steps : []).map((step, index) => map(step, `scans step ${index}`));
const scanIndexOf = (pattern: RegExp): number => {
  const index = scanSteps.findIndex((step) => pattern.test(stepText(step)));
  if (index < 0) throw new Error(`no scans step matches ${String(pattern)}`);
  return index;
};
const scanOrder = [/GITLEAKS_IMAGE/, /GATE_RUN_SEMGREP/, /GATE_CHECK_SECURITY_OWNED_PATHS/].map(scanIndexOf);

describe('ci-policy: US-005 CI pipeline skeleton', () => {
  it('AT-US-005-01: the PR fast lane runs install, lint/format, typecheck, unit and build in the documented order on ubuntu-24.04 with Node from .node-version; the security scans run in the parallel, isolated scans job that ci-gate needs (coverage and contract-drift steps join in TASK-015)', () => {
    expect(map(triggers.pull_request, 'pull_request').types).toEqual(['opened', 'synchronize', 'reopened', 'ready_for_review']);
    expect(fastLane['runs-on']).toBe('ubuntu-24.04');
    expect(scans['runs-on']).toBe('ubuntu-24.04');
    const setupNode = steps.find((step) => str(step.uses).startsWith('actions/setup-node@'));
    expect(map(setupNode?.with, 'setup-node with')['node-version-file']).toBe('.node-version');
    const order = [
      indexOf(/Classify changed paths/),
      indexOf(/npm ci --ignore-scripts/),
      indexOf(/npm run deps:rebuild/),
      indexOf(/npm run lint/),
      indexOf(/npm run format:check/),
      indexOf(/npm run typecheck/),
      indexOf(/npm run test:unit$/m),
      indexOf(/npm run build/),
      indexOf(/GATE_CHECK_PORCELAIN/),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(order[0]).toBe(2); // checkout, setup-node, then the in-lane classifier (review m5 (a): no separate job)
    expect(scanOrder).toEqual([...scanOrder].sort((a, b) => a - b));
    expect(Object.keys(jobs)).toEqual(['fast-lane', 'scans', 'ci-gate']);
  });

  it('AT-US-005-01 / PR10-SEC-02: licences, registry signatures and the advisory audit run right after the install, before deps:rebuild and any head code', () => {
    const install = indexOf(/npm ci --ignore-scripts/);
    const rebuild = indexOf(/npm run deps:rebuild/);
    for (const gate of [/GATE_LICENCE_CHECK/, /npm audit signatures/, /GATE_CHECK_AUDIT/]) {
      expect(indexOf(gate)).toBeGreaterThan(install);
      expect(indexOf(gate)).toBeLessThan(rebuild);
    }
  });

  it('PR10-SEC-02: the scans job runs no npm, nothing from node_modules or the workspace, and takes a literal Node version without cache', () => {
    const text = scanSteps.map(stepText).join('\n');
    expect(text).not.toMatch(/(?:^|[\s;&|(])(?:npm|npx)\s/m);
    expect(text).not.toMatch(/node_modules/);
    expect(text).not.toMatch(/\$GITHUB_WORKSPACE\/[^"\s]*\.m?[jt]s/);
    const setupNode = map(scanSteps.find((step) => str(step.uses).startsWith('actions/setup-node@'))?.with, 'scans setup-node with');
    expect(setupNode).toEqual({ 'node-version': '24' });
    expect(checkWorkflow(ciText, 'ci.yml')).toEqual([]);
  });

  it('PR10-SEC-01 / review M2: gitleaks mounts only .git, ignores inline allow markers, diffs merges against the first parent and has no network', () => {
    const run = str(scanSteps[scanIndexOf(/GITLEAKS_IMAGE/)]?.run);
    expect(run).toContain('-v "$GITHUB_WORKSPACE/.git:/repo/.git:ro"');
    expect(run).not.toMatch(/-v "\$GITHUB_WORKSPACE:/);
    expect(run).toContain('--ignore-gitleaks-allow');
    expect(run).toContain('--log-opts="--diff-merges=first-parent $range"');
    expect(run).toContain('docker run --rm --network none');
    expect(run).toContain('-v "$GATES_DIR/.gitleaks.toml:/config/gitleaks.toml:ro"');
  });

  it('PR10-SEC-03 / review m3: Semgrep takes its rules, .semgrepignore and .gitignore from the base ref', () => {
    const extract = str(scanSteps[scanIndexOf(/Gate tooling and scan configuration from the base ref/)]?.run);
    expect(extract).toContain('for path in tools/ci .semgrep .gitleaks.toml .semgrepignore .gitignore; do');
    expect(str(scanSteps[scanIndexOf(/GATE_RUN_SEMGREP/)]?.run)).toContain('--rules-from "$GATES_DIR/.semgrep" --ignore-from "$GATES_DIR"');
  });

  it('PR10-SEC-04: the record check binds to the PR number on pull requests and is not evaluated on push', () => {
    const run = str(scanSteps[scanIndexOf(/GATE_CHECK_SECURITY_OWNED_PATHS/)]?.run);
    expect(run).toContain('--pr "$PR_NUMBER"');
    expect(run).toMatch(/if \[ "\$EVENT" = "pull_request" \]; then/);
    expect(run).toContain('not evaluated on push');
  });

  it('review m3 / m2 / D-ORCH-018: the base-ref lint fixture step takes the suite, harness (lint-fixtures.mjs, fixture-expectations.mjs, tools/test-support) and Jest config from the base and runs exactly that suite under that config in no-weakening mode; the classifier treats jest.config.ts and tools/test-support as lint controls', () => {
    const step = steps[indexOf(/Lint negative fixtures from the base ref/)];
    const run = str(step?.run);
    expect(run).toContain('config=tools/lint/jest.base-fixtures.config.json\n');
    expect(run).toContain('for path in tools/lint/lint-fixtures.mjs tools/lint/fixture-expectations.mjs "$config" tools/test-support; do');
    expect(run).toContain('jest.js \\\n  --config "$config" --runTestsByPath "$suite" || status=$?\n');
    expect(run).toMatch(
      /\ngit checkout HEAD -- "\$suite" tests\/fixtures\/lint tools\/test-support tools\/lint\/lint-fixtures\.mjs \\\n\s+tools\/lint\/fixture-expectations\.mjs "\$config"\n/,
    );
    expect(run.trimEnd().endsWith('\nexit "$status"')).toBe(true);
    expect(map(step?.env, 'base-ref lint fixture step env')).toEqual({ LINT_FIXTURE_MODE: 'no-weakening' });
    expect(run).not.toMatch(/--testNamePattern|--test-name-pattern|\s-t|--selectProjects/);
    // The base config runs the one suite, with no filter, swcrc lookup or cache the head could steer (review m2).
    const baseConfig = JSON.parse(readFileSync(join(repoRoot, 'tools', 'lint', 'jest.base-fixtures.config.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(Object.keys(baseConfig).sort()).toEqual(
      ['cache', 'displayName', 'moduleNameMapper', 'rootDir', 'roots', 'testEnvironment', 'testMatch', 'transform'].sort(),
    );
    expect(baseConfig).toMatchObject({ rootDir: '../..', testMatch: ['**/tools/lint/negative-fixtures.test.ts'], cache: false });
    // Only the base-ref step selects the mode: not the workflow, the job, another step, a script or the Jest config.
    expect(ciCode.match(/LINT_FIXTURE_MODE/g)).toHaveLength(1);
    for (const file of ['package.json', 'jest.config.ts']) {
      expect(readFileSync(join(repoRoot, file), 'utf8')).not.toContain('LINT_FIXTURE_MODE');
    }
    const classify = str(steps[indexOf(/Classify changed paths/)]?.run);
    expect(classify).toContain('jest\\.config\\.ts');
    expect(classify).toContain('test-support');
    expect(classify).toContain('git diff --name-only --no-renames "$RANGE_BASE...$RANGE_HEAD"');
    expect(classify).toContain("grep -qxF '.claude/settings.json'");
  });

  it('AT-US-005-01: integration, images and e2e jobs are not scheduled for pull requests (D-ORCH-001)', () => {
    expect(Object.keys(jobs).filter((id) => /integration|image|e2e|iac|deploy/.test(id))).toEqual([]);
    expect(ciText).not.toMatch(/npm run test:(?:integration|e2e)/);
  });

  it('AT-US-005-02 (lane A part): push to main re-runs only lane A behind CI_MAIN_FAST_LANE, skipping docs-only pushes; ci.yml has no schedule; the full stages run in lane C on workflow_dispatch (TASK-015)', () => {
    const push = map(triggers.push, 'push');
    expect(push.branches).toEqual(['main']);
    expect(push['paths-ignore']).toEqual(['docs/**', '.claude/**', '**/*.md']);
    for (const job of [fastLane, scans]) expect(str(job.if)).toContain("vars.CI_MAIN_FAST_LANE == 'true'");
    expect(Object.keys(triggers)).not.toContain('schedule');
    expect(Object.keys(triggers).sort()).toEqual(['pull_request', 'push']);
  });

  it('review m5 (b): pull-request runs share a per-PR group and cancel superseded runs; every push to main gets its own group, so none is cancelled', () => {
    const concurrency = map(ci.concurrency, 'concurrency');
    expect(concurrency.group).toBe('ci-${{ github.event.pull_request.number || github.sha }}');
    expect(concurrency['cancel-in-progress']).toBe('true');
  });

  it('AT-US-005-03: any failing stage fails the run: no continue-on-error, no always()/failure() steps, a failing unit test skips build; ci-gate runs unless cancelled and fails unless both lanes succeeded (a skipped lane is not green)', () => {
    expect(ciText).not.toMatch(/continue-on-error/);
    for (const step of [...steps, ...scanSteps]) expect(str(step.if)).not.toMatch(/always\(\)|failure\(\)|cancelled\(\)/);
    const unit = indexOf(/npm run test:unit$/m);
    expect(indexOf(/npm run build/)).toBeGreaterThan(unit);
    const gate = map(jobs['ci-gate'], 'ci-gate');
    expect(gate.needs).toEqual(['fast-lane', 'scans']);
    expect(str(gate.if)).toBe("${{ !cancelled() && (github.event_name == 'pull_request' || vars.CI_MAIN_FAST_LANE == 'true') }}");
    const gateRun = str(map((gate.steps as YamlNode[])[0], 'ci-gate step').run);
    expect(gateRun).toMatch(/"\$FAST_LANE" != "success"/);
    expect(gateRun).toMatch(/"\$SCANS" != "success"/);
    expect(gateRun).toMatch(/exit 1/);
  });

  it('AT-US-005-04 (lane A part): a pull request run pushes no image; the policy allows image pushes only in an `images` job gated on dispatch/main/tags (lane C images job: TASK-015)', () => {
    expect(checkWorkflow(ciText, 'ci.yml')).toEqual([]);
    expect(ciText).not.toMatch(/docker\s+push|--push\b|push:\s*true|packages:\s*write/);
    const fixture = (name: string) => readFileSync(join(repoRoot, 'tools', 'ci', 'fixtures', 'workflow-policy', name), 'utf8');
    expect(checkWorkflow(fixture('ci-docker-push.yml'), 'ci.yml').map((f) => f.rule)).toContain('ci-no-release');
    expect(checkWorkflow(fixture('ci-images-guarded.yml'), 'ci.yml')).toEqual([]);
  });

  it('AT-US-005-05: ci.yml has no terraform apply and no job that assumes an AWS role (deploy/canary jobs belong to cd.yml, which no lane A trigger runs)', () => {
    expect(ciCode).not.toMatch(/terraform|tofu\s|aws-actions\/configure-aws-credentials|role-to-assume|id-token:\s*write/);
    const fixture = (name: string) => readFileSync(join(repoRoot, 'tools', 'ci', 'fixtures', 'workflow-policy', name), 'utf8');
    expect(checkWorkflow(fixture('ci-terraform-apply.yml'), 'ci.yml').map((f) => f.rule)).toContain('ci-no-release');
    expect(checkWorkflow(fixture('ci-aws-role.yml'), 'ci.yml').map((f) => f.rule)).toContain('ci-no-release');
    expect(existsSync(join(repoRoot, '.github', 'workflows', 'cd.yml'))).toBe(false);
  });

  it('AT-US-005-06 (static part): integration is not scheduled in lane A; the Jest integration project runs *.int.test.ts with Testcontainers PostgreSQL and Redis-compatible modules (hosted run: lane C, TASK-015; JUnit evidence under docs/05-quality: lane B, TASK-011)', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.scripts['test:integration']).toContain('--selectProjects integration');
    expect(Object.keys(pkg.devDependencies)).toEqual(
      expect.arrayContaining(['testcontainers', '@testcontainers/postgresql', '@testcontainers/redis']),
    );
    expect(readFileSync(join(repoRoot, 'jest.config.ts'), 'utf8')).toMatch(
      /displayName: 'integration',\s*testMatch: \['\*\*\/\*\.int\.test\.\{ts,tsx\}'\]/,
    );
    expect(ciText).not.toMatch(/test:integration/);
  });
});

describe('ci-policy: supply chain (SEC-TC-32, SEC-TC-45, SEC-TC-64 CI parts)', () => {
  it('SEC-TC-32: read-only token, no pull_request_target, actions pinned by SHA, every install --ignore-scripts, npm audit signatures with the scope override', () => {
    expect(ci.permissions).toEqual({ contents: 'read' });
    expect(Object.keys(triggers)).not.toContain('pull_request_target');
    const uses = [...steps, ...scanSteps].map((step) => str(step.uses)).filter((u) => u !== '');
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
    expect(ciText.match(/npm (?:ci|install)\b[^\n]*/g)?.every((line) => line.includes('--ignore-scripts'))).toBe(true);
    expect(ciText).toContain('npm audit signatures --@platform:registry=https://registry.npmjs.org/');
  });

  it('SEC-TC-45 (CI part): scripts are off at workflow and job level; lockfile provenance and the 7-day cooldown run before the install', () => {
    expect(map(ci.env, 'env').NPM_CONFIG_IGNORE_SCRIPTS).toBe('true');
    expect(map(fastLane.env, 'fast-lane env').NPM_CONFIG_IGNORE_SCRIPTS).toBe('true');
    const install = indexOf(/npm ci --ignore-scripts/);
    expect(indexOf(/GATE_CHECK_LOCKFILE/)).toBeLessThan(install);
    expect(indexOf(/GATE_CHECK_DEP_AGE/)).toBeLessThan(install);
  });

  it('SEC-TC-64 (CI part): gate tooling runs from the base ref when the base has it; tools run as `npm exec --no --`, never npx', () => {
    const baseStep = steps[indexOf(/Gate tooling from the base ref/)];
    expect(str(baseStep?.run)).toMatch(/git archive "\$RANGE_BASE"/);
    for (const tool of [
      'CHECK_WORKFLOW_POLICY',
      'CHECK_INSTALL_FLAGS',
      'CHECK_LOCKFILE',
      'CHECK_DEP_AGE',
      'LICENCE_CHECK',
      'CHECK_AUDIT',
      'CHECK_PORCELAIN',
      'RUN_SEMGREP',
      'CHECK_SECURITY_OWNED_PATHS',
    ]) {
      expect(ciText).toContain(`"$GATE_${tool}"`);
    }
    expect(ciText).not.toMatch(/(?:^|\s)npx\s/m);
    expect(ciText).toContain('npm exec --no -- commitlint');
  });

  it('D-TASK007-08: commitlint gates the PR title (the squash header) via env, never interpolated into the script; a commit-msg hook lints every local commit', () => {
    const step = steps.find((candidate) => str(candidate.name).startsWith('Commit messages'));
    const env = map(step?.env, 'commitlint env');
    expect(env.PR_TITLE).toBe('${{ github.event.pull_request.title }}');
    expect(str(step?.run)).toContain('"$PR_TITLE" | npm exec --no -- commitlint');
    expect(str(step?.run)).not.toContain('${{');
    expect(step?.['continue-on-error']).toBeUndefined();
    const hook = readFileSync(join(repoRoot, 'tools', 'hooks', 'commit-msg'), 'utf8');
    expect(hook).toContain('npm exec --no -- commitlint --edit "$1"');
  });

  it('PR1-SEC-02 item 5 / D-ARCH-041 (e): the Prisma engine cache is keyed by enginesVersion and runner OS and restored before deps:rebuild re-verifies it', () => {
    const cache = steps.find((step) => str(step.uses).startsWith('actions/cache@'));
    expect(map(cache?.with, 'cache with').key).toBe('prisma-engines-${{ runner.os }}-${{ steps.engines.outputs.version }}');
    expect(steps.indexOf(cache as YamlMap)).toBeLessThan(indexOf(/npm run deps:rebuild/));
    expect(steps.indexOf(cache as YamlMap)).toBeGreaterThan(indexOf(/npm ci --ignore-scripts/));
  });

  it('D-ARCH-010: every job has a timeout and lane A uses no secrets', () => {
    for (const job of Object.values(jobs)) expect(map(job, 'job')['timeout-minutes']).toBeDefined();
    expect(ciText).not.toMatch(/secrets\./);
  });
});
