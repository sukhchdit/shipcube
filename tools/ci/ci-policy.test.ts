/**
 * Suite `ci-policy` (TASK-007): US-005 acceptance tests AT-US-005-01..06 plus the CI parts of SEC-TC-32, SEC-TC-45 and
 * SEC-TC-64, asserted over the committed `.github/workflows/ci.yml` (lane A) and the workflow policy checker.
 *
 * Lane A is the only hosted lane this task delivers. Lane C (workflow_dispatch: integration, images, e2e, iac) and the
 * coverage/contract-drift steps are TASK-015; the test titles say which part each test proves. Since TASK-286 (ADR-0023
 * am. L item 3, D-ARCH-128) ci.yml has the stage-2 topology: the isolated scans are steps of `ci-gate`; the stage-1
 * mutants below run against `tools/ci/fixtures/stage-1/ci.yml`, which the base-ref policy still holds to its pins.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';
import {
  CI_GATE_ENV,
  CI_GATE_ENV_TESTED_BASE,
  CI_GATE_RUN,
  CI_GATE_RUN_TESTED_BASE,
  CLASSIFY_ENV,
  CLASSIFY_RUN,
  FAST_LANE_OUTPUTS_STAGE_2,
  LANE_B_EVIDENCE_SCRIPT_TESTED_BASE,
  LANE_SCOPE_ENV,
  LANE_SCOPE_RUN,
  LANE_SCOPE_RUN_TESTED_BASE,
  SCANS_IF_STAGE_2,
  SECURITY_INTEGRATION_IF_STAGE_2,
  SECURITY_INTEGRATION_NEEDS_STAGE_2,
  SECURITY_INTEGRATION_SCRIPT_TESTED_BASE,
  checkWorkflow,
  commandLines,
  laneBEvidenceProblems,
} from './check-workflow-policy.mjs';
import { LINT_CONTROL_PATHS } from './lane-scope.mjs';
import { isMap, parseYamlSubset } from './yaml-subset.mjs';
import type { YamlMap, YamlNode } from './yaml-subset.mjs';

const repoRoot = findRepoRoot();
const ciText = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
/** The stage-1 workflow (before TASK-286), still accepted and pinned by the base-ref policy. */
const stage1Text = readFileSync(join(repoRoot, 'tools', 'ci', 'fixtures', 'stage-1', 'ci.yml'), 'utf8');
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
/** Stage 2 (D-ARCH-128): the isolated scans are steps of ci-gate. */
const scans = map(jobs['ci-gate'], 'ci-gate');
const scanSteps = (Array.isArray(scans.steps) ? scans.steps : []).map((step, index) => map(step, `ci-gate step ${index}`));
const scanIndexOf = (pattern: RegExp): number => {
  const index = scanSteps.findIndex((step) => pattern.test(stepText(step)));
  if (index < 0) throw new Error(`no ci-gate step matches ${String(pattern)}`);
  return index;
};
/** The arguments of the lane B verifier invocation (PR #23 R1-m2, R1-m3). */
const LANE_B_ARGS =
  '--root "$GITHUB_WORKSPACE" --base "$RANGE_BASE" --head "$RANGE_HEAD" --event "$GITHUB_EVENT_NAME" --summary "$GITHUB_STEP_SUMMARY"';

const scanOrder = [/GITLEAKS_IMAGE/, /GATE_RUN_SEMGREP/, /GATE_CHECK_SECURITY_OWNED_PATHS/].map(scanIndexOf);

describe('ci-policy: US-005 CI pipeline skeleton', () => {
  it('AT-US-005-01: the PR fast lane runs install, lint/format, typecheck, unit and build in the documented order on ubuntu-24.04 with Node from .node-version; the security scans run in ci-gate, the isolated last job (stage 2, D-ARCH-128; coverage and contract-drift steps join in TASK-015)', () => {
    expect(map(triggers.pull_request, 'pull_request').types).toEqual(['opened', 'synchronize', 'reopened', 'ready_for_review']);
    expect(fastLane['runs-on']).toBe('ubuntu-24.04');
    expect(scans['runs-on']).toBe('ubuntu-24.04');
    const setupNode = steps.find((step) => str(step.uses).startsWith('actions/setup-node@'));
    expect(map(setupNode?.with, 'setup-node with')['node-version-file']).toBe('.node-version');
    const order = [
      indexOf(/Classify changed paths and look up proofs/),
      indexOf(/npm ci --ignore-scripts/),
      indexOf(/npm run deps:rebuild/),
      indexOf(/npm run lint/),
      indexOf(/^Lint must not mutate the tree/),
      indexOf(/npm run format:check/),
      indexOf(/npm run typecheck/),
      indexOf(/npm run test:unit$/m),
      indexOf(/npm run build/),
      indexOf(/^Build must not mutate the tree/),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // checkout, setup-node, the tested-base tooling, then the in-lane classifier (review m5 (a): no separate job)
    expect(order[0]).toBe(3);
    expect(scanOrder).toEqual([...scanOrder].sort((a, b) => a - b));
    expect(Object.keys(jobs)).toEqual(['fast-lane', 'security-integration', 'ci-gate']);
  });

  it('the lint step runs with a 4 GB heap and no other step env (type-aware ESLint exceeds the hosted runner default heap; a size only, never a preload)', () => {
    const lint = steps[indexOf(/^npm run lint$/m)];
    expect(map(lint?.env, 'lint env')).toEqual({ NODE_OPTIONS: '--max-old-space-size=4096' });
    expect(str(lint?.run)).toBe('npm run lint');
  });

  it('[PR4-SEC-13] a porcelain gate runs straight after Lint and before Type-check, with the post-build gate command', () => {
    const lint = indexOf(/npm run lint/);
    const afterLint = indexOf(/^Lint must not mutate the tree/);
    const afterBuild = indexOf(/^Build must not mutate the tree/);
    expect(afterLint).toBe(lint + 1);
    expect(afterLint).toBeLessThan(indexOf(/npm run typecheck/));
    expect(str(steps[afterLint]?.run)).toBe('node "${GATE_CHECK_PORCELAIN:?}" --root "$GITHUB_WORKSPACE" --summary "$GITHUB_STEP_SUMMARY"');
    expect(str(steps[afterLint]?.run)).toBe(str(steps[afterBuild]?.run));
    expect(str(steps[afterLint]?.if)).toBe("env.CODE == 'true'");
    // Mutation: dropping the post-lint step leaves the post-build gate alone, which required-gates reports.
    const dropped = ciText.replace(/ {6}- name: Lint must not mutate the tree[^\n]*\n(?: {8}[^\n]*\n)+/u, '');
    expect(dropped).not.toContain('Lint must not mutate the tree');
    expect(checkWorkflow(dropped, 'ci.yml', { requiredGates: true }).map((f) => f.message)).toContain(
      'ci.yml job fast-lane must keep the porcelain after lint gate step',
    );
  });

  it('[R1-m6] [PR #33 R1-M1] [D-ARCH-128] ci-gate runs the openapi-breaking gate after Semgrep and before the record step (so its first real run is not hidden by a missing record), unless a docs push has a code proof, from the tested-base tool set', () => {
    const index = scanIndexOf(/GATE_OPENAPI_BREAKING/);
    expect(index).toBe(scanIndexOf(/GATE_RUN_SEMGREP/) + 1);
    expect(index + 1).toBe(scanIndexOf(/GATE_CHECK_SECURITY_OWNED_PATHS/));
    expect(index + 3).toBe(scanSteps.length);
    expect(scanSteps[index]?.if).toBe(SCANS_IF_STAGE_2);
    expect(scanSteps[scanIndexOf(/GATE_RUN_SEMGREP/)]?.if).toBe(SCANS_IF_STAGE_2);
    expect(scanSteps[index]?.env).toBeUndefined();
    expect(ciText).toMatch(/for tool in run-semgrep check-security-owned-paths openapi-breaking lane-scope; do/u);
    const dropped = ciText.replace(/--image "\$OASDIFF_IMAGE"/u, '');
    expect(checkWorkflow(dropped, 'ci.yml', { requiredGates: true }).map((f) => f.message)).toEqual([
      expect.stringContaining('ci.yml openapi-breaking gate step: the run: must be exactly'),
    ]);
  });

  it('AT-US-005-01 / PR10-SEC-02: licences, registry signatures and the advisory audit run right after the install, before deps:rebuild and any head code', () => {
    const install = indexOf(/npm ci --ignore-scripts/);
    const rebuild = indexOf(/npm run deps:rebuild/);
    for (const gate of [/GATE_LICENCE_CHECK/, /npm audit signatures/, /GATE_CHECK_AUDIT/]) {
      expect(indexOf(gate)).toBeGreaterThan(install);
      expect(indexOf(gate)).toBeLessThan(rebuild);
    }
  });

  it('PR10-SEC-02: ci-gate (with the folded scans) runs no npm, nothing from node_modules or the workspace, and takes a literal Node version without cache', () => {
    const text = scanSteps.map(stepText).join('\n');
    expect(text).not.toMatch(/(?:^|[\s;&|(])(?:npm|npx)\s/m);
    expect(text).not.toMatch(/node_modules/);
    expect(text).not.toMatch(/\$GITHUB_WORKSPACE\/[^"\s]*\.m?[jt]s/);
    const setupNode = map(scanSteps.find((step) => str(step.uses).startsWith('actions/setup-node@'))?.with, 'ci-gate setup-node with');
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

  it('PR10-SEC-03 / review m3 / PR46-SEC-17: Semgrep takes its rules, .semgrepignore and .gitignore from the tested base', () => {
    const extract = str(scanSteps[scanIndexOf(/Gate tooling and scan configuration from the tested base/)]?.run);
    expect(extract).toContain('git archive "$tools_ref" "$path" | tar -x -C "$gates/base"');
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
    expect(map(step?.env, 'base-ref lint fixture step env')).toEqual({
      LINT_FIXTURE_MODE: 'no-weakening',
      TOOLS_REF: '${{ steps.classify.outputs.tools_ref }}',
    });
    expect(run).toContain('git checkout "$TOOLS_REF" -- "${base_paths[@]}"');
    expect(run).not.toMatch(/--testNamePattern|--test-name-pattern|\s-t|--selectProjects/);
    // The base config runs the one suite, with no filter, swcrc lookup or cache the head could steer (review m2).
    const baseConfig = JSON.parse(readFileSync(join(repoRoot, 'tools', 'lint', 'jest.base-fixtures.config.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(Object.keys(baseConfig).sort()).toEqual(
      [
        'cache',
        'displayName',
        'moduleNameMapper',
        'modulePathIgnorePatterns',
        'rootDir',
        'roots',
        'testEnvironment',
        'testMatch',
        'transform',
      ].sort(),
    );
    expect(baseConfig).toMatchObject({ rootDir: '../..', testMatch: ['**/tools/lint/negative-fixtures.test.ts'], cache: false });
    // Only the base-ref step selects the mode: not the workflow, the job, another step, a script or the Jest config.
    expect(ciCode.match(/LINT_FIXTURE_MODE/g)).toHaveLength(1);
    for (const file of ['package.json', 'jest.config.ts']) {
      expect(readFileSync(join(repoRoot, file), 'utf8')).not.toContain('LINT_FIXTURE_MODE');
    }
    // D-ARCH-126 / D-ARCH-128: CODE and LINT_CONTROLS come from the tested base's lane-scope (push range; lint controls
    // over the PR range, jest.config.ts and tools/test-support among them), written by the pinned classify step, which
    // alone holds the token and runs before any head code.
    const classify = steps[indexOf(/Classify changed paths and look up proofs/)];
    expect(str(classify?.run)).toBe(CLASSIFY_RUN);
    expect(map(classify?.env, 'classify env')).toEqual(CLASSIFY_ENV);
    expect(classify?.id).toBe('classify');
    for (const path of ['jest.config.ts', 'tools/test-support/process.ts', 'tests/fixtures/lint/x.ts', 'package.json'])
      expect(LINT_CONTROL_PATHS.test(path)).toBe(true);
    expect(LINT_CONTROL_PATHS.test('apps/api/package.json')).toBe(false);
  });

  it('AT-US-005-01: integration, images and e2e jobs are not scheduled for pull requests (D-ORCH-001); the one exception is security-integration (ADR-0023 am. G item 5)', () => {
    expect(Object.keys(jobs).filter((id) => /integration|image|e2e|iac|deploy/.test(id))).toEqual(['security-integration']);
    expect(ciText).not.toMatch(/npm run test:(?:integration|e2e)/);
  });

  it('[ADR-0023 am. G item 5, am. L items 2-3] [RR-4] [RR-5] [PR46-SEC-01] [PR46-SEC-17] security-integration: once per code tree on merge-candidate heads, after fast-lane and the supply-chain gates, tested-base manifests only, required by ci-gate (pinned exactly)', () => {
    const job = map(jobs['security-integration'], 'security-integration');
    expect(job.needs).toEqual([...SECURITY_INTEGRATION_NEEDS_STAGE_2]);
    expect(str(job.if)).toBe(SECURITY_INTEGRATION_IF_STAGE_2);
    expect(map(job.permissions, 'permissions')).toEqual({ contents: 'read' });
    expect(map(fastLane.outputs, 'fast-lane outputs')).toEqual(FAST_LANE_OUTPUTS_STAGE_2);
    expect(map(fastLane.permissions, 'fast-lane permissions')).toEqual({ contents: 'read', actions: 'read', 'pull-requests': 'read' });
    expect(map(scans.permissions, 'ci-gate permissions')).toEqual({ contents: 'read', actions: 'read', 'pull-requests': 'read' });
    const lane = scanIndexOf(/GATE_LANE_SCOPE:\?\}" --root/);
    expect(lane).toBeLessThan(scanIndexOf(/GITLEAKS_IMAGE/));
    expect(scanSteps[lane]?.id).toBe('lane-scope');
    expect(str(scanSteps[lane]?.run)).toBe(LANE_SCOPE_RUN_TESTED_BASE);
    expect(map(scanSteps[lane]?.env, 'lane scope env')).toEqual(LANE_SCOPE_ENV);
    const suites = (job.steps as YamlNode[])
      .map((step) => map(step, 'step'))
      .find((step) => /^Security integration suites/u.test(str(step.name)));
    expect(commandLines(str(suites?.run))).toEqual([...SECURITY_INTEGRATION_SCRIPT_TESTED_BASE]);
    expect(map(suites?.env, 'suites env')).toEqual({ TOOLS_REF: '${{ needs.fast-lane.outputs.tools_ref }}' });
  });

  describe('[PR46-SEC-03] [review m1] [TASK-286] the base-ref policy still kills every stage-1 security-integration / ci-gate mutant of both r1 reviews (tools/ci/fixtures/stage-1/ci.yml)', () => {
    const findingsOf = (text: string) => checkWorkflow(text, 'ci.yml', { requiredGates: true }).map((f) => `${f.rule}: ${f.message}`);
    const swap = (from: string, to: string) => {
      expect(stage1Text.split(from)).toHaveLength(2);
      return stage1Text.replace(from, () => to);
    };
    const suitesLine =
      'node tools/ci/security-integration.mjs --root "$GITHUB_WORKSPACE" --manifest "$manifests/required-suites.json" --runners "$manifests/suite-runners.json" --out "$RUNNER_TEMP/security-integration" --summary "$GITHUB_STEP_SUMMARY"';
    it('the stage-1 workflow passes', () => {
      expect(findingsOf(stage1Text)).toEqual([]);
    });
    it.each([
      ['W1 --dry-run appended to the suites step', suitesLine, `${suitesLine} --dry-run`, 'required-gates'],
      ['C9 || true after the suites runner', suitesLine, `${suitesLine} || true`, 'required-gates'],
      [
        'W3 -z -> -n: the base manifests never used',
        'if [ -z "$RANGE_BASE" ] || ! git cat-file',
        'if [ -n "$RANGE_BASE" ] || ! git cat-file',
        'required-gates',
      ],
      [
        'C5 head manifests (cp of the head copy)',
        '            git show "$RANGE_BASE:tools/quality/$name.json" > "$manifests/$name.json"',
        '            cp "tools/quality/$name.json" "$manifests/$name.json"',
        'required-gates',
      ],
      [
        'C2 / W4 classifier replaced by echo false',
        LANE_SCOPE_RUN,
        'echo "security_integration_due=false" >> "$GITHUB_OUTPUT"',
        'required-gates',
      ],
      [
        'C3 base = head in the classifier',
        LANE_SCOPE_RUN,
        LANE_SCOPE_RUN.replace('--base "$RANGE_BASE"', '--base "$RANGE_HEAD"'),
        'required-gates',
      ],
      ['classifier without --lookup', LANE_SCOPE_RUN, LANE_SCOPE_RUN.replace(' --lookup', ''), 'required-gates'],
      [
        'scans outputs from the old security-paths step',
        'security_paths: ${{ steps.lane-scope.outputs.security_paths }}',
        'security_paths: ${{ steps.security-paths.outputs.security_paths }}',
        'required-gates',
      ],
      [
        'scans job env base swapped',
        '      RANGE_HEAD: ${{ github.event.pull_request.head.sha || github.sha }}\n      EVENT:',
        '      RANGE_HEAD: ${{ github.event.pull_request.base.sha }}\n      EVENT:',
        'required-gates',
      ],
      ['W2 / C4 ci-gate accepts a failure (aggregation masked)', CI_GATE_RUN, `${CI_GATE_RUN} || true`, 'required-gates'],
      ['ci-gate aggregation replaced by an echo', CI_GATE_RUN, 'echo "Lane A green."', 'required-gates'],
      [
        'ci-gate fed a literal success',
        'SECURITY_INTEGRATION: ${{ needs.security-integration.result }}',
        'SECURITY_INTEGRATION: success',
        'required-gates',
      ],
      [
        'ci-gate tooling from the head working tree',
        '          echo "GATE_LANE_SCOPE=$gates/tools/ci/lane-scope.mjs" >> "$GITHUB_ENV"',
        '          echo "GATE_LANE_SCOPE=$GITHUB_WORKSPACE/tools/ci/lane-scope.mjs" >> "$GITHUB_ENV"',
        'required-gates',
      ],
      [
        'security-integration selected by security paths alone (once-per-tree dropped)',
        "needs.scans.outputs.security_integration_due == 'true'",
        "needs.scans.outputs.security_paths == 'true'",
        'required-gates',
      ],
      ['PR46-SEC-01 fast-lane success condition dropped', " && needs.fast-lane.result == 'success'", '', 'required-gates'],
      ['PR46-SEC-01 fast-lane dropped from needs', 'needs: [scans, fast-lane]', 'needs: [scans]', 'required-gates'],
      ['RR-7 cancel-in-progress back to true', 'cancel-in-progress: false', 'cancel-in-progress: true', 'required-gates'],
      [
        'RR-8 (ii) actions: read on fast-lane',
        '    permissions:\n      contents: read\n    outputs:\n      # light',
        '    permissions:\n      contents: read\n      actions: read\n    outputs:\n      # light',
        'permissions',
      ],
      [
        'RR-8 (ii) ci-gate without actions: read',
        '    timeout-minutes: 3\n    permissions:\n      contents: read\n      actions: read\n',
        '    timeout-minutes: 3\n    permissions:\n      contents: read\n',
        'required-gates',
      ],
      [
        'RR-8 (i) the token on the security-integration job',
        "    env:\n      NPM_CONFIG_IGNORE_SCRIPTS: 'true'\n      RANGE_BASE: ${{ github.event.pull_request.base.sha }}\n",
        "    env:\n      NPM_CONFIG_IGNORE_SCRIPTS: 'true'\n      RANGE_BASE: ${{ github.event.pull_request.base.sha }}\n      GH_TOKEN: ${{ github.token }}\n",
        'gh-token',
      ],
      ['RR-8 (i) the token at workflow level', 'env:\n  # D-ARCH-044', 'env:\n  GH_TOKEN: ${{ github.token }}\n  # D-ARCH-044', 'gh-token'],
      [
        'RR-8 (i) the token on the classify step of fast-lane',
        '        env:\n          RANGE_BEFORE: ${{ github.event.before }}\n        run: |\n          set -euo pipefail\n          lane=',
        '        env:\n          GH_TOKEN: ${{ github.token }}\n          RANGE_BEFORE: ${{ github.event.before }}\n        run: |\n          set -euo pipefail\n          lane=',
        'gh-token',
      ],
      ['ci-gate runs npm (isolation)', CI_GATE_RUN, `npm ci --ignore-scripts && ${CI_GATE_RUN}`, 'scans-isolation'],
      ['fast-lane mode output pinned', 'mode: ${{ steps.classify.outputs.mode }}', 'mode: full', 'required-gates'],
      ['R2-M1 pull_request base filter dropped', '  pull_request:\n    branches: [main]\n', '  pull_request:\n', 'required-gates'],
      [
        'R2-M1 pull_request base filter widened',
        '    branches: [main]\n    types:',
        '    branches: [main, weak]\n    types:',
        'required-gates',
      ],
      [
        'R2-M1 pull_request base filter replaced by a glob',
        '    branches: [main]\n    types:',
        "    branches: ['**']\n    types:",
        'required-gates',
      ],
      [
        'R2-M1 branches-ignore next to the base filter',
        '    branches: [main]\n    types:',
        '    branches: [main]\n    branches-ignore: [main]\n    types:',
        'required-gates',
      ],
      [
        'R2-M1 --head-ref dropped from the lane-scope step',
        LANE_SCOPE_RUN,
        LANE_SCOPE_RUN.replace(' --head-ref "$HEAD_REF"', ''),
        'required-gates',
      ],
      [
        'R2-M1 scans without pull-requests: read (the binding calls would fail: every docs push without a proof)',
        '      actions: read\n      pull-requests: read\n',
        '      actions: read\n',
        'required-gates',
      ],
      ['R2-M1 pull-requests: write on scans', '      pull-requests: read\n', '      pull-requests: write\n', 'permissions'],
      ['R2-M1 HEAD_REF from the base branch', 'HEAD_REF: ${{ github.head_ref }}', 'HEAD_REF: ${{ github.base_ref }}', 'required-gates'],
    ])('%s', (_title, from, to, rule) => {
      expect(findingsOf(swap(from, to)).some((finding) => finding.startsWith(`${rule}:`))).toBe(true);
    });
  });

  it('AT-US-005-02 (lane A part): push to main re-runs only lane A behind CI_MAIN_FAST_LANE, skipping docs-only pushes; ci.yml has no schedule; the full stages run in lane C on workflow_dispatch (TASK-015)', () => {
    const push = map(triggers.push, 'push');
    expect(push.branches).toEqual(['main']);
    expect(push['paths-ignore']).toEqual(['docs/**', '.claude/**', '**/*.md']);
    for (const job of [fastLane, scans]) expect(str(job.if)).toContain("vars.CI_MAIN_FAST_LANE == 'true'"); // scans = ci-gate
    expect(Object.keys(triggers)).not.toContain('schedule');
    expect(Object.keys(triggers).sort()).toEqual(['pull_request', 'push']);
    // R2-M1 / PR46-SEC-13: pull requests into main only (CI_PULL_REQUEST_BRANCHES).
    expect(map(triggers.pull_request, 'pull_request').branches).toEqual(['main']);
  });

  it('review m5 (b) / RR-7: pull-request runs share a per-PR group and queue (a running full run is never cancelled, so a docs push finds its proof); every push to main gets its own group', () => {
    const concurrency = map(ci.concurrency, 'concurrency');
    expect(concurrency.group).toBe('ci-${{ github.event.pull_request.number || github.sha }}');
    expect(concurrency['cancel-in-progress']).toBe('false');
  });

  it('AT-US-005-03: any failing stage fails the run: no continue-on-error, no always()/failure() steps, a failing unit test skips build; ci-gate runs unless cancelled and fails unless both lanes succeeded (a skipped lane is not green)', () => {
    expect(ciText).not.toMatch(/continue-on-error/);
    for (const step of [...steps, ...scanSteps]) expect(str(step.if)).not.toMatch(/always\(\)|failure\(\)|cancelled\(\)/);
    const unit = indexOf(/npm run test:unit$/m);
    expect(indexOf(/npm run build/)).toBeGreaterThan(unit);
    const gate = map(jobs['ci-gate'], 'ci-gate');
    expect(gate.needs).toEqual(['fast-lane', 'security-integration']);
    expect(str(gate.if)).toBe("${{ !cancelled() && (github.event_name == 'pull_request' || vars.CI_MAIN_FAST_LANE == 'true') }}");
    // RR-6 / D-ARCH-128: the aggregation is the tested base's lane-scope --gate (rules (a)-(c), (e)-(g); lane-scope tests).
    const gateSteps = (gate.steps as YamlNode[]).map((step) => map(step, 'ci-gate step'));
    const aggregate = gateSteps.at(-1);
    expect(str(aggregate?.name)).toBe('Aggregate lane A');
    expect(str(aggregate?.run)).toBe(CI_GATE_RUN_TESTED_BASE);
    expect(map(aggregate?.env, 'aggregate env')).toEqual(CI_GATE_ENV_TESTED_BASE);
    expect(aggregate?.if).toBeUndefined();
    expect(map(gate.permissions, 'ci-gate permissions')).toEqual({ contents: 'read', actions: 'read', 'pull-requests': 'read' });
    expect(gate['timeout-minutes']).toBe('15');
    // The stage-1 pins (CI_GATE_RUN / CI_GATE_ENV) are not used by the committed workflow any more.
    expect(ciText).not.toContain(CI_GATE_RUN);
    expect(Object.keys(CI_GATE_ENV)).toContain('SCANS');
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

  it('SEC-TC-64 (CI part) / PR46-SEC-17 / PR33-SEC-09: gate tooling runs from the tested base (HEAD^1 of the test merge) when it has it, each gate as "${GATE_*:?}"; tools run as `npm exec --no --`, never npx', () => {
    const baseStep = steps[indexOf(/Gate tooling from the tested base/)];
    expect(str(baseStep?.run)).toMatch(/git archive "\$tools_ref" "\$path"/);
    expect(str(baseStep?.run)).toContain('tools_ref=$(git rev-parse --verify --quiet "HEAD^1^{commit}" || true)');
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
      expect(ciText).toContain(`"\${GATE_${tool}:?}"`);
      expect(ciText).not.toContain(`"$GATE_${tool}"`);
    }
    expect(ciText).not.toMatch(/(?:^|\s)npx\s/m);
    expect(ciText).toContain('npm exec --no -- commitlint');
  });

  it('SEC-TC-48 (CI part, TASK-011; PR23-SEC-06; PR46-SEC-17): lane B evidence is verified only by the tested base tools/quality, after npm ci and before any head code', () => {
    const index = indexOf(/Lane B evidence \(quality:check-evidence\)/);
    const run = str(steps[index]?.run);
    expect(steps[index]?.if).toBeUndefined();
    expect(map(steps[index]?.env, 'evidence env')).toEqual({ TOOLS_REF: '${{ steps.classify.outputs.tools_ref }}' });
    // The R2-n3 tripwire now lives in the base-ref checker (laneBEvidenceProblems); this head test only confirms it holds.
    expect(laneBEvidenceProblems(run, LANE_B_EVIDENCE_SCRIPT_TESTED_BASE)).toEqual([]);
    expect(run).toContain('git archive "$TOOLS_REF" tools/quality | tar -x -C "$quality/base"');
    expect(run).toContain(`node "$quality/base/tools/quality/check-evidence.mjs" ${LANE_B_ARGS}`);
    expect(run).not.toMatch(/--report-only|\$quality\/head|\|\| true/);
    expect(run.match(/--event "\$GITHUB_EVENT_NAME"/g)).toHaveLength(1);
    expect(index).toBeGreaterThan(indexOf(/npm ci --ignore-scripts/));
    expect(index).toBeLessThan(indexOf(/npm run deps:rebuild/));
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
