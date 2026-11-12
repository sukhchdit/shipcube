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

describe('ci-policy: US-005 CI pipeline skeleton', () => {
  it('AT-US-005-01: the PR fast lane runs install, lint/format, typecheck, unit, build and security in the documented order on ubuntu-latest with Node from .node-version (coverage and contract-drift steps join in TASK-015)', () => {
    expect(map(triggers.pull_request, 'pull_request').types).toEqual(['opened', 'synchronize', 'reopened', 'ready_for_review']);
    expect(fastLane['runs-on']).toBe('ubuntu-latest');
    const setupNode = steps.find((step) => str(step.uses).startsWith('actions/setup-node@'));
    expect(map(setupNode?.with, 'setup-node with')['node-version-file']).toBe('.node-version');
    const order = [
      indexOf(/npm ci --ignore-scripts/),
      indexOf(/npm run deps:rebuild/),
      indexOf(/npm run lint/),
      indexOf(/npm run format:check/),
      indexOf(/npm run typecheck/),
      indexOf(/npm run test:unit$/m),
      indexOf(/npm run build/),
      indexOf(/GATE_CHECK_PORCELAIN/),
      indexOf(/GITLEAKS_IMAGE/),
      indexOf(/GATE_RUN_SEMGREP/),
      indexOf(/GATE_CHECK_SECURITY_OWNED_PATHS/),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(Object.keys(jobs)).toEqual(['changes', 'fast-lane', 'ci-gate']);
  });

  it('AT-US-005-01: integration, images and e2e jobs are not scheduled for pull requests (D-ORCH-001)', () => {
    expect(Object.keys(jobs).filter((id) => /integration|image|e2e|iac|deploy/.test(id))).toEqual([]);
    expect(ciText).not.toMatch(/npm run test:(?:integration|e2e)/);
  });

  it('AT-US-005-02 (lane A part): push to main re-runs only the fast lane behind CI_MAIN_FAST_LANE; ci.yml has no schedule; the full stages run in lane C on workflow_dispatch (TASK-015)', () => {
    expect(map(triggers.push, 'push').branches).toEqual(['main']);
    expect(str(map(jobs.changes, 'changes').if)).toContain("vars.CI_MAIN_FAST_LANE == 'true'");
    expect(Object.keys(triggers)).not.toContain('schedule');
    expect(Object.keys(triggers).sort()).toEqual(['pull_request', 'push']);
  });

  it('AT-US-005-03: any failing stage fails the run: one sequential job, no continue-on-error, no always()/failure() steps, so a failing unit test skips build and scans; ci-gate fails unless every needed job succeeded', () => {
    expect(ciText).not.toMatch(/continue-on-error/);
    for (const step of steps) expect(str(step.if)).not.toMatch(/always\(\)|failure\(\)|cancelled\(\)/);
    const unit = indexOf(/npm run test:unit$/m);
    expect(indexOf(/npm run build/)).toBeGreaterThan(unit);
    expect(indexOf(/GATE_RUN_SEMGREP/)).toBeGreaterThan(unit);
    const gate = map(jobs['ci-gate'], 'ci-gate');
    expect(gate.needs).toEqual(['changes', 'fast-lane']);
    expect(str(gate.if)).toContain('always()');
    const gateRun = str(map((gate.steps as YamlNode[])[0], 'ci-gate step').run);
    expect(gateRun).toMatch(/"\$FAST_LANE" != "success"/);
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
    const uses = steps.map((step) => str(step.uses)).filter((u) => u !== '');
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
