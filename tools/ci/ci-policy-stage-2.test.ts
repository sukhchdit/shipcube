/**
 * Stage 2 of ADR-0023 amendment L item 3 (D-ARCH-128; ruling rulings/wave-0-ci-minutes.md section 3 (4), section 5
 * TASK-286): the base-ref policy accepts the folded topology, the committed `.github/workflows/ci.yml` since the workflow
 * PR, holds it to its own pins in full, and kills every mutant of those pins; the routed security items
 * PR46-SEC-11/-12/-15/-17 and PR42-SEC-18 are pinned with it. Since TASK-287 part 287-A the stage-1 topology is retired
 * (PR55-SEC-10, D-TASK286-01a): a ci.yml that restores a `scans` job is a finding.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';
import {
  CHECKOUT_IS_EVENT_SHA,
  STAGE_2_ACTION_COMMITS,
  STAGE_2_ACTION_STEP_KEYS,
  TEST_LOCKS_DIR,
  cacheHygieneFindings,
  CI_GATE_ENV_FAST_LANE_OUTPUTS,
  CI_GATE_RUN_TESTED_BASE,
  CI_GATE_STEPS_STAGE_2,
  CI_GATE_TOOLING_SCRIPT_TESTED_BASE,
  CI_GATE_TOOLING_SCRIPT_TESTED_BASE_V2,
  CLASSIFY_RUN,
  FAST_LANE_TOOLING_SCRIPT_V2,
  LANE_SCOPE_RUN_TESTED_BASE,
  checkWorkflow,
  requiredGatesFor,
} from './check-workflow-policy.mjs';
import { proofSteps } from './lane-scope.mjs';
import { isMap, parseYamlSubset } from './yaml-subset.mjs';
import type { YamlMap, YamlNode } from './yaml-subset.mjs';

const repoRoot = findRepoRoot();
const stage2 = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
function map(node: YamlNode | undefined, what: string): YamlMap {
  if (!isMap(node)) throw new Error(`${what} is not a mapping`);
  return node;
}
const jobsOf = (text: string) => map(map(parseYamlSubset(text).value ?? undefined, 'ci.yml').jobs, 'jobs');
const stepsOf = (jobs: YamlMap, job: string) =>
  (Array.isArray(map(jobs[job], job).steps) ? (map(jobs[job], job).steps as YamlNode[]) : []).map((step) => map(step, `${job} step`));
const findingsOf = (text: string) => checkWorkflow(text, 'ci.yml', { requiredGates: true }).map((f) => `${f.rule}: ${f.message}`);
/** The stage-2 text with exactly one occurrence of `from` replaced (the mutant must be unambiguous). */
const swap = (from: string, to: string) => {
  expect(stage2.split(from)).toHaveLength(2);
  return stage2.replace(from, () => to);
};

describe('[TASK-286] [D-ARCH-128] stage-2 topology accepted by the base-ref policy (two-step, policy first)', () => {
  it('the committed stage-2 ci.yml passes with 0 findings; a ci.yml that restores a scans job is refused (stage 1 retired, PR55-SEC-10)', () => {
    expect(findingsOf(stage2)).toEqual([]);
    const jobKey = '  security-integration:\n';
    expect(stage2.split(jobKey)).toHaveLength(2);
    const scansJob = '  scans:\n    runs-on: ubuntu-24.04\n    permissions:\n      contents: read\n    steps:\n      - run: echo scans\n\n';
    const restored = stage2.replace(jobKey, () => scansJob + jobKey);
    expect(findingsOf(restored)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^required-gates: ci\.yml must not have a scans job: the stage-1 topology is retired/u),
      ]),
    );
  });

  it('the stage-2 jobs: scans folded into ci-gate, security-integration needs fast-lane only, ci-gate needs fast-lane and security-integration', () => {
    const jobs = jobsOf(stage2);
    expect(Object.keys(jobs)).toEqual(['fast-lane', 'security-integration', 'ci-gate']);
    expect(map(jobs['security-integration'], 'security-integration').needs).toEqual(['fast-lane']);
    expect(map(jobs['ci-gate'], 'ci-gate').needs).toEqual(['fast-lane', 'security-integration']);
    const names = (job: string) => stepsOf(jobs, job).map((step) => (typeof step.name === 'string' ? step.name : ''));
    expect(names('ci-gate').slice(2)).toEqual([
      'Gate tooling and scan configuration from the tested base (SEC-P3-31, PR10-SEC-03, PR46-SEC-17)',
      'Lane scope and proofs (D-ARCH-126/127)',
      'Gitleaks (PR commit range)',
      'Semgrep (rules, .semgrepignore and .gitignore from the base ref; --disable-nosem)',
      'OpenAPI breaking changes against the latest release tag (oasdiff, NFR-MAINT-004)',
      'Security-owned paths need a review record (PR5-SEC-04, PR10-SEC-04)',
      'Aggregate lane A',
    ]);
    expect(CI_GATE_STEPS_STAGE_2).toHaveLength(7);
    expect(requiredGatesFor().filter((gate) => gate.job === 'scans')).toEqual([]);
  });

  it('commitlint and actionlint are CODE-gated; the install, signatures and the advisory audit are unconditional (PR46-SEC-11, D-TASK286-03, R1-n5)', () => {
    const gates = requiredGatesFor();
    const ifsOf = (gate: string) => gates.find((candidate) => candidate.job === 'fast-lane' && candidate.gate === gate)?.ifs;
    expect(ifsOf('commitlint')).toEqual(["env.CODE == 'true'"]);
    expect(ifsOf('actionlint')).toEqual(["env.CODE == 'true'"]);
    expect(ifsOf('install')).toEqual([]);
    expect(ifsOf('registry signatures')).toEqual([]);
    expect(ifsOf('vulnerability audit')).toEqual([]);
    const fastLaneSteps = stepsOf(jobsOf(stage2), 'fast-lane');
    const step = (name: RegExp) => fastLaneSteps.find((s) => name.test(typeof s.name === 'string' ? s.name : ''));
    expect(step(/^Commit messages/)?.if).toBe("env.CODE == 'true'");
    expect(step(/^actionlint$/)?.if).toBe("env.CODE == 'true'");
    // D-TASK286-03: the install stays unconditional (the evidence verifier and the audit read the installed tree).
    expect(step(/^Install/)?.if).toBeUndefined();
    expect(step(/^Registry signatures/)?.if).toBeUndefined();
    expect(step(/^Vulnerability audit/)?.if).toBeUndefined();
  });

  it('proof step names come from the topology: CODE-gated fast-lane steps (commitlint, actionlint) and the scans in ci-gate', () => {
    const steps = proofSteps(stage2);
    if ('problem' in steps) throw new Error(steps.problem);
    expect(steps.scansJob).toBe('ci-gate');
    expect(steps.scans).toEqual([
      'Gitleaks (PR commit range)',
      'Semgrep (rules, .semgrepignore and .gitignore from the base ref; --disable-nosem)',
      'OpenAPI breaking changes against the latest release tag (oasdiff, NFR-MAINT-004)',
    ]);
    const names = steps.fastLane.map((step) => step.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Commit messages (commitlint; PR title = squash subject, pushed range on main)',
        'actionlint',
        'Unit tests',
        'Build',
      ]),
    );
    // The install is unconditional (D-TASK286-03, R1-n5): a successful fast-lane job ran it, a CODE step it is not.
    expect(names).not.toContain('Install (npm ci --ignore-scripts)');
    expect(names).not.toContain('Registry signatures and provenance (PR1-SEC-12)');
    expect(names).not.toContain('Vulnerability audit (npm audit + osv-scanner)');
  });
});

describe('[TASK-286] the stage-2 pins kill every mutant (PR46-SEC-11/-12/-15/-17, PR42-SEC-18, D-ARCH-128)', () => {
  const tooling = 'tools_ref=$(git rev-parse --verify --quiet "HEAD^1^{commit}" || true)';
  const ciGateEnvFast = 'FAST_LANE_CLASSIFICATION: ${{ needs.fast-lane.outputs.classification }}';
  /** The openings of the two tested-base blocks (fast-lane's, ci-gate's), which make each mutant unambiguous. */
  /** The event-commit check both tooling steps carry since TASK-287 part 287-B (PR59-SEC-01, V2). */
  const eventCheckLines = CHECKOUT_IS_EVENT_SHA.map((line) => `          ${line}\n`).join('');
  const fastLaneOpen = `          set -euo pipefail\n${eventCheckLines}          tools_ref=""\n          if [ "$GITHUB_EVENT_NAME" = "pull_request" ]; then\n`;
  const ciGateOpen = `          mkdir -p "$gates/base" "$gates/head"\n${eventCheckLines}          tools_ref=""\n          if [ "$GITHUB_EVENT_NAME" = "pull_request" ]; then\n`;
  const headCheck = `            ${tooling}\n            merged=$(git rev-parse --verify --quiet "HEAD^2^{commit}" || true)\n            if [ -z "$tools_ref" ] || [ "$merged" != "$RANGE_HEAD" ] || ! git merge-base`;
  it.each<[string, string, string, string]>([
    // PR46-SEC-17: the tested base.
    [
      'T1 tools from the PR head (HEAD^2) in fast-lane',
      `${fastLaneOpen}            ${tooling}`,
      `${fastLaneOpen}            ${tooling.replace('HEAD^1', 'HEAD^2')}`,
      'required-gates',
    ],
    [
      'T2 the HEAD^2 = head check dropped in ci-gate',
      `${ciGateOpen}${headCheck}`,
      `${ciGateOpen}${headCheck.replace(' || [ "$merged" != "$RANGE_HEAD" ]', '')}`,
      'required-gates',
    ],
    [
      'T3 the ancestry check dropped',
      ' || ! git merge-base --is-ancestor "$RANGE_BASE" "$tools_ref"; then\n              echo "::error title=Tested base::the checkout is not the test merge of the PR head into a descendant of its base (fail closed, PR46-SEC-17)"\n              exit 1\n            fi\n          elif [ -n "$RANGE_BASE" ] && [ "$RANGE_BASE" != "0000000000000000000000000000000000000000" ] && git cat-file -e "$RANGE_BASE^{commit}" 2>/dev/null; then\n            tools_ref="$RANGE_BASE"\n          fi\n          base_dir',
      '; then\n              echo "::error title=Tested base::the checkout is not the test merge of the PR head into a descendant of its base (fail closed, PR46-SEC-17)"\n              exit 1\n            fi\n          elif [ -n "$RANGE_BASE" ] && [ "$RANGE_BASE" != "0000000000000000000000000000000000000000" ] && git cat-file -e "$RANGE_BASE^{commit}" 2>/dev/null; then\n            tools_ref="$RANGE_BASE"\n          fi\n          base_dir',
      'required-gates',
    ],
    [
      'T4 (X3) every GATE_* from the head extract',
      '            if [ -f "$base_dir/tools/ci/$tool.mjs" ]; then',
      '            if false; then',
      'required-gates',
    ],
    [
      'T5 fast-lane gate tools from the head working tree',
      '              echo "$var=$head_dir/tools/ci/$tool.mjs" >> "$GITHUB_ENV"',
      '              echo "$var=$GITHUB_WORKSPACE/tools/ci/$tool.mjs" >> "$GITHUB_ENV"',
      'required-gates',
    ],
    [
      'T6 ci-gate tools from the merge base (the pre-TASK-286 bootstrap)',
      '            tools_ref=$(git rev-parse --verify --quiet "HEAD^1^{commit}" || true)\n            merged=$(git rev-parse --verify --quiet "HEAD^2^{commit}" || true)\n            if [ -z "$tools_ref" ] || [ "$merged" != "$RANGE_HEAD" ] || ! git merge-base --is-ancestor "$RANGE_BASE" "$tools_ref"; then\n              echo "::error title=Tested base::the checkout is not the test merge of the PR head into a descendant of its base (fail closed, PR46-SEC-17)"\n              exit 1\n            fi\n          elif [ -n "$RANGE_BASE" ] && [ "$RANGE_BASE" != "0000000000000000000000000000000000000000" ] && git cat-file -e "$RANGE_BASE^{commit}" 2>/dev/null; then\n            tools_ref="$RANGE_BASE"\n          fi\n          {\n            echo "## Lane A (ci-gate)"',
      '            tools_ref="$RANGE_BASE"\n          fi\n          {\n            echo "## Lane A (ci-gate)"',
      'required-gates',
    ],
    [
      'T7 evidence verifier from the merge base',
      '          git archive "$TOOLS_REF" tools/quality | tar -x -C "$quality/base"',
      '          git archive "$RANGE_BASE" tools/quality | tar -x -C "$quality/base"',
      'required-gates',
    ],
    [
      'T8 evidence TOOLS_REF from the event base',
      '      - name: Lane B evidence (quality:check-evidence)\n        env:\n          TOOLS_REF: ${{ steps.classify.outputs.tools_ref }}',
      '      - name: Lane B evidence (quality:check-evidence)\n        env:\n          TOOLS_REF: ${{ github.event.pull_request.base.sha }}',
      'required-gates',
    ],
    [
      'T9 security-integration manifests from the head',
      '            git show "$TOOLS_REF:tools/quality/$name.json" > "$manifests/$name.json"',
      '            cp "tools/quality/$name.json" "$manifests/$name.json"',
      'required-gates',
    ],
    [
      'T10 security-integration TOOLS_REF from the event base',
      '          TOOLS_REF: ${{ needs.fast-lane.outputs.tools_ref }}',
      '          TOOLS_REF: ${{ github.event.pull_request.base.sha }}',
      'required-gates',
    ],
    [
      'T11 lint fixtures TOOLS_REF env dropped',
      '          LINT_FIXTURE_MODE: no-weakening\n          TOOLS_REF: ${{ steps.classify.outputs.tools_ref }}\n',
      '          LINT_FIXTURE_MODE: no-weakening\n',
      'required-gates',
    ],
    [
      'T12 fast-lane tools_ref output rewritten',
      'tools_ref: ${{ steps.classify.outputs.tools_ref }}',
      'tools_ref: ${{ github.event.pull_request.base.sha }}',
      'required-gates',
    ],
    // PR46-SEC-12: pinned tooling and classify steps, "${GATE_*:?}", no inserted steps, the compare in ci-gate.
    [
      'C1 (X4) a step between fast-lane tooling and classify re-points GATE_LANE_SCOPE',
      '      # D-ARCH-126/127/128 (RR-3, RR-4), pinned exactly',
      '      - name: Re-point\n        run: echo "GATE_LANE_SCOPE=$GITHUB_WORKSPACE/x.mjs" >> "$GITHUB_ENV"\n\n      # D-ARCH-126/127/128 (RR-3, RR-4), pinned exactly',
      'required-gates',
    ],
    [
      'C2 a run step before the fast-lane tooling step',
      '      # PR46-SEC-17 / PR46-SEC-12 (pinned line by line',
      '      - name: Early\n        run: echo early\n\n      # PR46-SEC-17 / PR46-SEC-12 (pinned line by line',
      'required-gates',
    ],
    [
      'C3 classify without "${GATE_LANE_SCOPE:?}"',
      CLASSIFY_RUN,
      CLASSIFY_RUN.replace('"${GATE_LANE_SCOPE:?}"', '"$GATE_LANE_SCOPE"'),
      'required-gates',
    ],
    ['C4 classify without --lookup', CLASSIFY_RUN, CLASSIFY_RUN.replace(' --lookup', ''), 'required-gates'],
    [
      'C5 classify with the merge base as tested base',
      CLASSIFY_RUN,
      CLASSIFY_RUN.replace('--tools-ref "$TOOLS_REF"', '--tools-ref "$RANGE_BASE"'),
      'required-gates',
    ],
    [
      'C6 classify without --env (CODE never set: every step runs, but unpinned)',
      CLASSIFY_RUN,
      CLASSIFY_RUN.replace(' --env "$GITHUB_ENV"', ''),
      'required-gates',
    ],
    ['C7 classify replaced by an echo', CLASSIFY_RUN, 'echo "mode=light" >> "$GITHUB_OUTPUT"', 'required-gates'],
    [
      'C8 classify HEAD_REF from the base branch',
      '          HEAD_REF: ${{ github.head_ref }}\n          PR_NUMBER',
      '          HEAD_REF: ${{ github.base_ref }}\n          PR_NUMBER',
      'required-gates',
    ],
    [
      'C9 ci-gate lane scope without --lookup',
      LANE_SCOPE_RUN_TESTED_BASE,
      LANE_SCOPE_RUN_TESTED_BASE.replace(' --lookup', ''),
      'required-gates',
    ],
    [
      'C10 ci-gate lane scope with a head copy',
      LANE_SCOPE_RUN_TESTED_BASE,
      LANE_SCOPE_RUN_TESTED_BASE.replace('"${GATE_LANE_SCOPE:?}"', '"$GITHUB_WORKSPACE/tools/ci/lane-scope.mjs"'),
      'required-gates',
    ],
    [
      'C11 (X4) a step inserted in ci-gate before the aggregation',
      '      # RR-6 + D-ARCH-128 + PR46-SEC-12',
      '      - name: Re-point\n        run: echo "GATE_LANE_SCOPE=/tmp/x.mjs" >> "$GITHUB_ENV"\n\n      # RR-6 + D-ARCH-128 + PR46-SEC-12',
      'required-gates',
    ],
    ['C12 aggregation masked', CI_GATE_RUN_TESTED_BASE, `${CI_GATE_RUN_TESTED_BASE} || true`, 'required-gates'],
    [
      'C13 aggregation compares fast-lane with itself',
      'CLASSIFICATION: ${{ steps.lane-scope.outputs.classification }}',
      'CLASSIFICATION: ${{ needs.fast-lane.outputs.classification }}',
      'required-gates',
    ],
    ['C14 aggregation without fast-lane classification', `          ${ciGateEnvFast}\n`, '', 'required-gates'],
    [
      'C15 aggregation fed a literal security-integration success',
      'SECURITY_INTEGRATION: ${{ needs.security-integration.result }}',
      'SECURITY_INTEGRATION: success',
      'required-gates',
    ],
    [
      'C16 aggregation made conditional',
      '      - name: Aggregate lane A\n',
      '      - name: Aggregate lane A\n        if: ${{ success() }}\n',
      'required-gates',
    ],
    [
      'C17 a fast-lane step after head code writes CODE',
      '        run: npm run build\n',
      '        run: npm run build && echo "CODE=false" >> "$GITHUB_ENV"\n',
      'gate-env',
    ],
    ['C18 ci-gate runs npm', CI_GATE_RUN_TESTED_BASE, `npm ci --ignore-scripts && ${CI_GATE_RUN_TESTED_BASE}`, 'scans-isolation'],
    [
      'C19 ci-gate setup-node with an npm cache',
      "      - name: Set up Node (literal version, no cache)\n        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0\n        with:\n          node-version: '24'\n\n      - name: Gate tooling and scan",
      "      - name: Set up Node (literal version, no cache)\n        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0\n        with:\n          node-version: '24'\n          cache: npm\n\n      - name: Gate tooling and scan",
      'scans-isolation',
    ],
    [
      'C20 classify step id changed',
      '        id: classify\n        env:\n          GH_TOKEN',
      '        id: scope\n        env:\n          GH_TOKEN',
      'required-gates',
    ],
    // PR46-SEC-15 and the gh-token rule (lane-scope steps only).
    [
      'P1 fast-lane pull-requests: write',
      '    permissions:\n      contents: read\n      actions: read\n      pull-requests: read\n    # The classify',
      '    permissions:\n      contents: read\n      actions: read\n      pull-requests: write\n    # The classify',
      'permissions',
    ],
    [
      'P2 ci-gate without pull-requests: read (every binding fails)',
      '      actions: read\n      pull-requests: read\n    env:\n      RANGE_BASE: ${{ github.event.pull_request.base.sha || github.event.before }}\n      RANGE_HEAD: ${{ github.event.pull_request.head.sha || github.sha }}\n      EVENT',
      '      actions: read\n    env:\n      RANGE_BASE: ${{ github.event.pull_request.base.sha || github.event.before }}\n      RANGE_HEAD: ${{ github.event.pull_request.head.sha || github.sha }}\n      EVENT',
      'required-gates',
    ],
    [
      'P3 security-integration holds actions: read',
      "    permissions:\n      contents: read\n    env:\n      NPM_CONFIG_IGNORE_SCRIPTS: 'true'\n    steps:\n      - name: Checkout (full history for the tested-base",
      "    permissions:\n      contents: read\n      actions: read\n    env:\n      NPM_CONFIG_IGNORE_SCRIPTS: 'true'\n    steps:\n      - name: Checkout (full history for the tested-base",
      'permissions',
    ],
    [
      'P4 security-integration holds pull-requests: read',
      "    permissions:\n      contents: read\n    env:\n      NPM_CONFIG_IGNORE_SCRIPTS: 'true'\n    steps:\n      - name: Checkout (full history for the tested-base",
      "    permissions:\n      contents: read\n      pull-requests: read\n    env:\n      NPM_CONFIG_IGNORE_SCRIPTS: 'true'\n    steps:\n      - name: Checkout (full history for the tested-base",
      'permissions',
    ],
    [
      'P5 pull-requests: read at workflow level',
      'permissions:\n  contents: read\n\n# Pull requests share',
      'permissions:\n  contents: read\n  pull-requests: read\n\n# Pull requests share',
      'permissions',
    ],
    [
      'P6 the token on the fast-lane unit-test step',
      "      - name: Unit tests\n        if: env.CODE == 'true'\n",
      "      - name: Unit tests\n        if: env.CODE == 'true'\n        env:\n          GH_TOKEN: ${{ github.token }}\n",
      'gh-token',
    ],
    [
      'P7 the token on the ci-gate gitleaks step',
      '      - name: Gitleaks (PR commit range)\n',
      '      - name: Gitleaks (PR commit range)\n        env:\n          GH_TOKEN: ${{ github.token }}\n',
      'gh-token',
    ],
    [
      'P8 the token at fast-lane job level',
      "      NPM_CONFIG_IGNORE_SCRIPTS: 'true'\n      RANGE_BASE: ${{ github.event.pull_request.base.sha || github.event.before }}\n      RANGE_HEAD: ${{ github.event.pull_request.head.sha || github.sha }}\n    steps:\n      - name: Checkout (full history for the base ref",
      "      NPM_CONFIG_IGNORE_SCRIPTS: 'true'\n      RANGE_BASE: ${{ github.event.pull_request.base.sha || github.event.before }}\n      RANGE_HEAD: ${{ github.event.pull_request.head.sha || github.sha }}\n      GH_TOKEN: ${{ github.token }}\n    steps:\n      - name: Checkout (full history for the base ref",
      'gh-token',
    ],
    // D-ARCH-128 topology and selection.
    [
      'J1 security-integration also needs ci-gate (cycle) / not fast-lane only',
      'needs: [fast-lane]\n    if:',
      'needs: [fast-lane, ci-gate]\n    if:',
      'required-gates',
    ],
    ['J2 ci-gate does not need security-integration', 'needs: [fast-lane, security-integration]', 'needs: [fast-lane]', 'required-gates'],
    ['J3 security-integration without the fast-lane success condition', " && needs.fast-lane.result == 'success'", '', 'required-gates'],
    [
      'J4 security-integration selected by the security paths alone',
      "needs.fast-lane.outputs.security_integration_due == 'true'",
      "needs.fast-lane.outputs.mode == 'full'",
      'required-gates',
    ],
    [
      'J5 a scans job added back next to the folded scans (mixture)',
      '  # ADR-0023 am. G item 5 as amended by am. L items 2-3',
      '  scans:\n    name: scans\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    permissions:\n      contents: read\n    steps:\n      - run: echo scans\n\n  # ADR-0023 am. G item 5 as amended by am. L items 2-3',
      'required-gates',
    ],
    ['J6 cancel-in-progress true', 'cancel-in-progress: false', 'cancel-in-progress: true', 'required-gates'],
    ['J7 pull_request base filter dropped', '  pull_request:\n    branches: [main]\n', '  pull_request:\n', 'required-gates'],
    [
      'J8 fast-lane job env base swapped',
      "      NPM_CONFIG_IGNORE_SCRIPTS: 'true'\n      RANGE_BASE: ${{ github.event.pull_request.base.sha || github.event.before }}\n      RANGE_HEAD: ${{ github.event.pull_request.head.sha || github.sha }}\n    steps:\n      - name: Checkout (full history for the base ref",
      "      NPM_CONFIG_IGNORE_SCRIPTS: 'true'\n      RANGE_BASE: ${{ github.event.pull_request.head.sha }}\n      RANGE_HEAD: ${{ github.event.pull_request.head.sha || github.sha }}\n    steps:\n      - name: Checkout (full history for the base ref",
      'required-gates',
    ],
    [
      'J9 ci-gate job env EVENT literal',
      '      EVENT: ${{ github.event_name }}\n      PR_NUMBER: ${{ github.event.pull_request.number }}\n    steps:\n      - name: Checkout (full history for the tested base',
      '      EVENT: push\n      PR_NUMBER: ${{ github.event.pull_request.number }}\n    steps:\n      - name: Checkout (full history for the tested base',
      'required-gates',
    ],
    // Scan conditions (Semgrep/oasdiff run unless a docs push has a code proof; gitleaks and the record always).
    [
      'S1 Semgrep skipped on every docs push, proof or not',
      "        if: steps.lane-scope.outputs.code_changed != 'false' || steps.lane-scope.outputs.code_proof == ''\n        run: node \"${GATE_RUN_SEMGREP:?}\"",
      '        if: steps.lane-scope.outputs.code_changed != \'false\'\n        run: node "${GATE_RUN_SEMGREP:?}"',
      'required-gates',
    ],
    [
      'S2 oasdiff never runs',
      "        if: steps.lane-scope.outputs.code_changed != 'false' || steps.lane-scope.outputs.code_proof == ''\n        run: node \"${GATE_OPENAPI_BREAKING:?}\"",
      '        if: false\n        run: node "${GATE_OPENAPI_BREAKING:?}"',
      'required-gates',
    ],
    [
      'S3 gitleaks made conditional',
      '      - name: Gitleaks (PR commit range)\n        run:',
      "      - name: Gitleaks (PR commit range)\n        if: steps.lane-scope.outputs.code_changed == 'true'\n        run:",
      'required-gates',
    ],
    [
      'S4 the record step made conditional',
      '      - name: Security-owned paths need a review record (PR5-SEC-04, PR10-SEC-04)\n        run:',
      "      - name: Security-owned paths need a review record (PR5-SEC-04, PR10-SEC-04)\n        if: steps.lane-scope.outputs.code_changed == 'true'\n        run:",
      'required-gates',
    ],
    // PR46-SEC-11: signatures and audit on every push.
    [
      'A1 the advisory audit CODE-gated again',
      '      - name: Vulnerability audit (npm audit + osv-scanner)\n        run:',
      "      - name: Vulnerability audit (npm audit + osv-scanner)\n        if: env.CODE == 'true'\n        run:",
      'required-gates',
    ],
    [
      'A2 registry signatures CODE-gated again',
      '      - name: Registry signatures and provenance (PR1-SEC-12)\n        run:',
      "      - name: Registry signatures and provenance (PR1-SEC-12)\n        if: env.CODE == 'true'\n        run:",
      'required-gates',
    ],
    [
      'A3 commitlint guarded by something else',
      "      - name: Commit messages (commitlint; PR title = squash subject, pushed range on main)\n        if: env.CODE == 'true'",
      "      - name: Commit messages (commitlint; PR title = squash subject, pushed range on main)\n        if: env.LINT_CONTROLS == 'true'",
      'required-gates',
    ],
    [
      'A4 the install skipped',
      '(PR46-SEC-11).\n      - name: Install (npm ci --ignore-scripts)\n        run:',
      "(PR46-SEC-11).\n      - name: Install (npm ci --ignore-scripts)\n        if: env.CODE == 'false'\n        run:",
      'required-gates',
    ],
    // PR42-SEC-18: the Lint step env.
    [
      'L1 BASH_ENV beside the heap line',
      '          NODE_OPTIONS: --max-old-space-size=4096\n        run: npm run lint',
      '          NODE_OPTIONS: --max-old-space-size=4096\n          BASH_ENV: ./x.sh\n        run: npm run lint',
      'required-gates',
    ],
    [
      'L2 NODE_OPTIONS from the PR title',
      '          NODE_OPTIONS: --max-old-space-size=4096\n        run: npm run lint',
      '          NODE_OPTIONS: ${{ github.event.pull_request.title }}\n        run: npm run lint',
      'node-options-preload',
    ],
  ])('%s', (_title, from, to, rule) => {
    const findings = findingsOf(swap(from, to));
    expect(findings.some((finding) => finding.startsWith(`${rule}:`))).toBe(true);
  });
});

describe('[PR #55 r1] [C1] PR55-SEC-01/-02/-09, R1-m1, R1-m3, R1-n5: the review probes are findings now', () => {
  const laneC = readFileSync(join(repoRoot, '.github', 'workflows', 'lane-c.yml'), 'utf8');
  const semgrepRun =
    '        run: node "${GATE_RUN_SEMGREP:?}" --root "$GITHUB_WORKSPACE" --rules-from "$GATES_DIR/.semgrep" --ignore-from "$GATES_DIR" --summary "$GITHUB_STEP_SUMMARY"\n';
  const auditGate =
    '          node "${GATE_CHECK_AUDIT:?}" --root "$GITHUB_WORKSPACE" --npm-audit "$RUNNER_TEMP/npm-audit.json" --osv "$RUNNER_TEMP/osv.json" --summary "$GITHUB_STEP_SUMMARY"\n';
  const policyStep =
    '      - name: Workflow policy\n        run: node "${GATE_CHECK_WORKFLOW_POLICY:?}" --root "$GITHUB_WORKSPACE" --summary "$GITHUB_STEP_SUMMARY"\n';
  const installFlags = '        run: node "${GATE_CHECK_INSTALL_FLAGS:?}" --root "$GITHUB_WORKSPACE" --summary "$GITHUB_STEP_SUMMARY"\n';
  const gitleaksName = '      - name: Gitleaks (PR commit range)\n        run: |\n';
  const recordName = '      - name: Security-owned paths need a review record (PR5-SEC-04, PR10-SEC-04)\n        run: |\n';
  const semgrepIf =
    "        if: steps.lane-scope.outputs.code_changed != 'false' || steps.lane-scope.outputs.code_proof == ''\n" + semgrepRun;
  const buildPorcelain =
    '      - name: Build must not mutate the tree (git status --porcelain)\n        if: env.CODE == \'true\'\n        run: node "${GATE_CHECK_PORCELAIN:?}" --root "$GITHUB_WORKSPACE" --summary "$GITHUB_STEP_SUMMARY"\n';
  const lateStep = (body: string) => `${buildPorcelain}\n      - name: Late step\n${body}`;
  const workflowEnv = "  NPM_CONFIG_IGNORE_SCRIPTS: 'true'\n  CHECKPOINT_DISABLE: '1'\n";

  it.each<[string, string, string, string]>([
    // PR55-SEC-02 / R1-m1: ci-gate's scans are exact.
    ['R1 Semgrep || true', semgrepRun, semgrepRun.replace('\n', ' || true\n'), 'required-gates'],
    ['R2 gitleaks --exit-code 0', '--redact --no-banner --exit-code 1', '--redact --no-banner --exit-code 0', 'required-gates'],
    [
      'R3 the record step forced to --report-only',
      '          if [ "$RECORD_MODE" = "report-only" ]; then mode=(--report-only); fi\n          if [ "$EVENT"',
      '          mode=(--report-only)\n          if [ "$EVENT"',
      'required-gates',
    ],
    [
      'R4 Semgrep as a block that re-points GATE_LANE_SCOPE through an indirect $GITHUB_ENV write (X4 in-step)',
      semgrepRun,
      '        run: |\n          v=GITHUB_; v="${v}EN""V"; echo "GATE_LANE_SCOPE=/tmp/x.mjs" >> "${!v}"\n' +
        semgrepRun.replace('        run: ', '          '),
      'required-gates',
    ],
    ['R5 ; exit 0 after the workflow policy', policyStep, policyStep.replace(/"\n$/u, '"; exit 0\n'), 'required-gates'],
    // PR55-SEC-02 item 2/3: fast-lane's gates before head code are exact.
    ['A4b check-audit || true', auditGate, auditGate.replace('\n', ' || true\n'), 'required-gates'],
    [
      'A7 check-audit replaced by --version; exit 0',
      auditGate,
      '          node "${GATE_CHECK_AUDIT:?}" --version; exit 0\n',
      'required-gates',
    ],
    [
      'A8 signatures ; true',
      '        run: npm audit signatures --@platform:registry=https://registry.npmjs.org/\n',
      '        run: npm audit signatures --@platform:registry=https://registry.npmjs.org/; true\n',
      'required-gates',
    ],
    [
      'B4 an indirect $GITHUB_ENV write in the install-flags step',
      installFlags,
      `        run: |\n          x=GITHUB_ENV; echo "CODE=false" >> "\${!x}"\n${installFlags.replace('        run: ', '          ')}`,
      'required-gates',
    ],
    [
      'B10 an exporting action between classify and the policy step',
      policyStep,
      "      - name: Export\n        uses: actions/github-script@60a0d83039c74a4aee543508d2ffcb1c3799cdea # v7.0.1\n        with:\n          script: core.exportVariable('CODE', 'false')\n\n" +
        policyStep,
      'required-gates',
    ],
    [
      'B12 a run step between classify and the policy step (the pre-head-code chain is contiguous)',
      policyStep,
      '      - name: Note\n        run: echo "between classify and the gates"\n\n' + policyStep,
      'required-gates',
    ],
    [
      'B11 an exporting action after the build (uses allow-list)',
      buildPorcelain,
      lateStep(
        "        uses: actions/github-script@60a0d83039c74a4aee543508d2ffcb1c3799cdea # v7.0.1\n        with:\n          script: core.exportVariable('X', '1')\n",
      ),
      'required-gates',
    ],
    // R1-n5 / PR55-SEC-08 (a): the install is unconditional.
    [
      'A3 the install CODE-gated',
      '(PR46-SEC-11).\n      - name: Install (npm ci --ignore-scripts)\n        run:',
      "(PR46-SEC-11).\n      - name: Install (npm ci --ignore-scripts)\n        if: env.CODE == 'true'\n        run:",
      'required-gates',
    ],
    // PR55-SEC-01: env into the scans and the gates (preload variables, expression maps, step env).
    [
      'F1 BASH_ENV on gitleaks',
      gitleaksName,
      gitleaksName.replace('        run: |\n', '        env:\n          BASH_ENV: docs/x.sh\n        run: |\n'),
      'preload-env',
    ],
    [
      'F2 BASH_ENV on Semgrep',
      semgrepIf,
      semgrepIf.replace('        run: ', '        env:\n          BASH_ENV: docs/x.sh\n        run: '),
      'preload-env',
    ],
    [
      'F3 BASH_ENV on the record step',
      recordName,
      recordName.replace('        run: |\n', '        env:\n          BASH_ENV: docs/x.sh\n        run: |\n'),
      'preload-env',
    ],
    [
      'F3b a harmless-looking step env on the record step (RECORD_MODE)',
      recordName,
      recordName.replace('        run: |\n', '        env:\n          RECORD_MODE: report-only\n        run: |\n'),
      'required-gates',
    ],
    [
      'F4 an expression env map on the record step',
      recordName,
      recordName.replace('        run: |\n', '        env: ${{ fromJSON(github.event.pull_request.title) }}\n        run: |\n'),
      'env-expression',
    ],
    [
      'F6 BASH_ENV on the workflow policy',
      policyStep,
      policyStep.replace('        run: ', '        env:\n          BASH_ENV: docs/x.sh\n        run: '),
      'preload-env',
    ],
    [
      'F7 BASH_ENV on the audit',
      '      - name: Vulnerability audit (npm audit + osv-scanner)\n        run: |\n',
      '      - name: Vulnerability audit (npm audit + osv-scanner)\n        env:\n          BASH_ENV: docs/x.sh\n        run: |\n',
      'preload-env',
    ],
    [
      'F8 PATH into the workspace on Semgrep',
      semgrepIf,
      semgrepIf.replace('        run: ', '        env:\n          PATH: /home/runner/work/x/x/docs:/usr/bin\n        run: '),
      'preload-env',
    ],
    ['F10 workflow-level BASH_ENV', workflowEnv, `${workflowEnv}  BASH_ENV: docs/x.sh\n`, 'preload-env'],
    ['F11 workflow-level LD_PRELOAD', workflowEnv, `${workflowEnv}  LD_PRELOAD: docs/x.so\n`, 'preload-env'],
    ['F11b a function export at workflow level', workflowEnv, `${workflowEnv}  BASH_FUNC_node%%: '() { true; }'\n`, 'preload-env'],
    [
      'F12 ENV on gitleaks',
      gitleaksName,
      gitleaksName.replace('        run: |\n', '        env:\n          ENV: docs/x.sh\n        run: |\n'),
      'preload-env',
    ],
    ['F13 an extra workflow-level env key', workflowEnv, `${workflowEnv}  RECORD_MODE: report-only\n`, 'required-gates'],
    [
      'E1 an expression env map on the unit tests',
      "      - name: Unit tests\n        if: env.CODE == 'true'\n        run: npm run test:unit\n",
      "      - name: Unit tests\n        if: env.CODE == 'true'\n        env: ${{ fromJSON(github.event.pull_request.title) }}\n        run: npm run test:unit\n",
      'env-expression',
    ],
    [
      'E2 an expression env map at fast-lane job level',
      "    env:\n      # PR1-SEC-03 (c): job level as well, so an out-of-graph nested install inherits it.\n      NPM_CONFIG_IGNORE_SCRIPTS: 'true'\n",
      '    env: ${{ fromJSON(github.event.pull_request.body) }}\n    x-unused:\n',
      'env-expression',
    ],
    // PR55-SEC-09 / R1-m3: the token is bound to the classify, lane-scope and aggregation steps.
    [
      'T1 (P11) the token on a fast-lane step after head code that names the lane-scope tool',
      buildPorcelain,
      lateStep('        env:\n          GH_TOKEN: ${{ github.token }}\n        run: node "${GATE_LANE_SCOPE:?}" --help; npm run build\n'),
      'gh-token',
    ],
    [
      'T1b the same step with exactly the classify command',
      buildPorcelain,
      lateStep(`        env:\n          GH_TOKEN: \${{ github.token }}\n        run: ${CLASSIFY_RUN}\n`),
      'gh-token',
    ],
    [
      'P10 the token on a security-integration step that names the lane-scope tool',
      '      - name: Allow-listed install steps (deps:rebuild)\n        run: npm run deps:rebuild\n\n      # The manifest',
      '      - name: Allow-listed install steps (deps:rebuild)\n        run: npm run deps:rebuild\n\n      - name: Lookup\n        env:\n          GH_TOKEN: ${{ github.token }}\n        run: node "${GATE_LANE_SCOPE:?}" --help\n\n      # The manifest',
      'gh-token',
    ],
    [
      'T1c the token on a second step with id classify and the classify command (bound to the gate position)',
      buildPorcelain,
      lateStep(`        id: classify\n        env:\n          GH_TOKEN: \${{ github.token }}\n        run: ${CLASSIFY_RUN}\n`),
      'gh-token',
    ],
  ])('%s', (_title, from, to, rule) => {
    const findings = findingsOf(swap(from, to));
    expect(findings.some((finding) => finding.startsWith(`${rule}:`))).toBe(true);
  });

  it('the preload and expression-map rules apply to lane-c.yml as well (E5)', () => {
    const install = '      - name: Install (npm ci --ignore-scripts)\n        run: npm ci --ignore-scripts --no-audit --no-fund\n';
    expect(laneC.split(install).length).toBeGreaterThan(1);
    const laneFindings = (text: string) => checkWorkflow(text, 'lane-c.yml').map((f) => `${f.rule}: ${f.message}`);
    expect(laneFindings(laneC)).toEqual([]);
    const e5 = laneC.replace(install, install.replace('        run:', '        env: ${{ fromJSON(inputs.x) }}\n        run:'));
    expect(laneFindings(e5).some((finding) => finding.startsWith('env-expression:'))).toBe(true);
    const bash = laneC.replace(install, install.replace('        run:', '        env:\n          BASH_ENV: docs/x.sh\n        run:'));
    expect(laneFindings(bash).some((finding) => finding.startsWith('preload-env:'))).toBe(true);
  });
});

describe('[PR #55 r2] PR55-SEC-11, R2-n1, R2-n2, R2-n4: the follow-ups taken into the workflow PR', () => {
  const laneC = readFileSync(join(repoRoot, '.github', 'workflows', 'lane-c.yml'), 'utf8');
  const install = '      - name: Install (npm ci --ignore-scripts)\n        run: npm ci --ignore-scripts --no-audit --no-fund\n';
  const laneFindings = (text: string) => checkWorkflow(text, 'lane-c.yml').map((f) => `${f.rule}: ${f.message}`);
  const withStepEnv = (body: string) => laneC.replace(install, install.replace('        run:', `        env:\n${body}        run:`));

  it.each([
    'GIT_CONFIG_PARAMETERS',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_KEY_0',
    'GIT_CONFIG_VALUE_12',
    'GIT_EXTERNAL_DIFF',
    'HOME',
    'XDG_CONFIG_HOME',
    'NPM_CONFIG_SCRIPT_SHELL',
    'npm_config_script_shell',
    'NPM_CONFIG_USERCONFIG',
    'npm_config_globalconfig',
    'npm_config_node_options',
    // R2-n4: a lower-case spelling of an original entry (N16).
    'bash_env',
  ])('[R2-n1] %s at step level of lane-c.yml is preload-env', (name) => {
    expect(laneC.split(install).length).toBeGreaterThan(1);
    expect(laneFindings(withStepEnv(`          ${name}: docs/x\n`)).some((finding) => finding.startsWith('preload-env:'))).toBe(true);
  });

  it('[R2-n1] controls: NODE_OPTIONS (the lint heap) and a GIT_CONFIG_ name that is not KEY/VALUE_<n> are not preload-env', () => {
    const findings = laneFindings(withStepEnv("          NODE_OPTIONS: --max-old-space-size=4096\n          GIT_CONFIG_NOSYSTEM: '1'\n"));
    expect(findings.filter((finding) => finding.startsWith('preload-env:'))).toEqual([]);
  });

  it('[R2-n2] an empty env: is an absent map (no env-expression)', () => {
    expect(laneFindings(laneC)).toEqual([]);
    const empty = laneC.replace(install, install.replace('        run:', '        env:\n        run:'));
    expect(empty).not.toBe(laneC);
    expect(laneFindings(empty)).toEqual([]);
  });

  it('[PR55-SEC-11] the workflow env is held to the exact key set (the stage-1 half ended with the retirement)', () => {
    const workflowEnv = "  NPM_CONFIG_IGNORE_SCRIPTS: 'true'\n  CHECKPOINT_DISABLE: '1'\n";
    expect(stage2.split(workflowEnv)).toHaveLength(2);
    for (const extra of ['DOCKER_HOST: tcp://evil:2375', "ACTIONS_ALLOW_UNSECURE_COMMANDS: 'true'"]) {
      const mutated = stage2.replace(workflowEnv, `${workflowEnv}  ${extra}\n`);
      expect(findingsOf(mutated)).toEqual(
        expect.arrayContaining([expect.stringMatching(/^required-gates: ci\.yml workflow env must have exactly the keys/u)]),
      );
    }
  });
});

describe('[PR59-SEC-01] [PR62-SEC-02] [TASK-287] checkout, setup-node and cache inputs are pinned; the tooling steps carry the event-commit check (V2 only)', () => {
  const pin = (name: string, action: string) => `      - name: ${name}\n        uses: ${action}`;
  const fastCheckout = pin('Checkout (full history for the base ref and the PR commit range)', 'actions/checkout@');
  const siCheckout = pin('Checkout (full history for the tested-base manifests)', 'actions/checkout@');
  const gateCheckout = pin('Checkout (full history for the tested base and the PR commit range)', 'actions/checkout@');
  const checkoutWith = '        with:\n          fetch-depth: 0\n          persist-credentials: false\n';
  /** The block from a step's name line through its with: map (exactly one occurrence in ci.yml). */
  const block = (head: string, withMap: string) => {
    const start = stage2.indexOf(head);
    expect(start).toBeGreaterThan(0);
    const end = stage2.indexOf(withMap, start) + withMap.length;
    return stage2.slice(start, end);
  };
  const eventCheck = CHECKOUT_IS_EVENT_SHA.map((line) => `          ${line}`).join('\n');
  const fastV2 = `          set -euo pipefail\n${eventCheck}\n          tools_ref=""\n`;
  const gateV2 = `          mkdir -p "$gates/base" "$gates/head"\n${eventCheck}\n          tools_ref=""\n`;

  it('the committed ci.yml carries V2 in both tooling steps and passes; V1 (no check) in either step is refused (PR62-SEC-02)', () => {
    expect(stage2.split(fastV2)).toHaveLength(2);
    expect(stage2.split(gateV2)).toHaveLength(2);
    expect(findingsOf(stage2)).toEqual([]);
    expect(FAST_LANE_TOOLING_SCRIPT_V2.slice(1, 1 + CHECKOUT_IS_EVENT_SHA.length)).toEqual([...CHECKOUT_IS_EVENT_SHA]);
    expect(CI_GATE_TOOLING_SCRIPT_TESTED_BASE_V2).toHaveLength(CI_GATE_TOOLING_SCRIPT_TESTED_BASE.length + CHECKOUT_IS_EVENT_SHA.length);
    const fastV1 = stage2.replace(fastV2, () => '          set -euo pipefail\n          tools_ref=""\n');
    const gateV1 = stage2.replace(gateV2, () => '          mkdir -p "$gates/base" "$gates/head"\n          tools_ref=""\n');
    for (const [label, text, job] of [
      ['fast-lane V1', fastV1, 'gate tooling'],
      ['ci-gate V1', gateV1, 'ci-gate tooling'],
    ] as const) {
      expect([label, findingsOf(text)]).toEqual([
        label,
        [expect.stringMatching(new RegExp(`^required-gates: ci\\.yml ${job} gate step: the run: must be exactly the pinned script`, 'u'))],
      ]);
    }
    // A V2 whose check does not fail the step is refused too.
    const exitZero = stage2.split('  exit 1\n          fi\n          tools_ref=""').join('  exit 0\n          fi\n          tools_ref=""');
    expect(exitZero).not.toBe(stage2);
    expect(findingsOf(exitZero).some((finding) => finding.startsWith('required-gates:'))).toBe(true);
  });

  it.each<[string, string, string]>([
    [
      'fast-lane checkout ref: the PR head (a tested base of its choosing)',
      fastCheckout,
      '          ref: ${{ github.event.pull_request.head.sha }}\n',
    ],
    ['ci-gate checkout repository: another repository', gateCheckout, '          repository: someone/else\n'],
    ['security-integration checkout persist-credentials: true', siCheckout, ''],
    ['fast-lane checkout fetch-depth: 1', fastCheckout, ''],
    ['G3 fast-lane checkout repository: another repository', fastCheckout, '          repository: someone/else\n'],
    ['G6 fast-lane checkout path: a subdirectory', fastCheckout, '          path: sub\n'],
    ['security-integration checkout submodules: recursive', siCheckout, '          submodules: recursive\n'],
    ['G7 security-integration checkout repository: another repository', siCheckout, '          repository: someone/else\n'],
    ['ci-gate checkout path: a subdirectory', gateCheckout, '          path: sub\n'],
  ])('%s', (title, head, extra) => {
    const original = block(head, checkoutWith);
    let mutated = original;
    if (extra !== '') mutated = original + extra;
    else if (title.includes('persist-credentials')) mutated = original.replace('persist-credentials: false', 'persist-credentials: true');
    else mutated = original.replace('fetch-depth: 0', 'fetch-depth: 1');
    expect(mutated).not.toBe(original);
    const findings = findingsOf(stage2.replace(original, () => mutated));
    expect(findings).toEqual(
      expect.arrayContaining([expect.stringMatching(/^required-gates: .*actions\/checkout with: must be exactly .*PR59-SEC-01/u)]),
    );
  });

  it('setup-node and the engine cache inputs are pinned per job; an unlisted action is refused', () => {
    const fastSetup = block(
      pin('Set up Node from .node-version', 'actions/setup-node@'),
      '          cache-dependency-path: package-lock.json\n',
    );
    const noCache = stage2.replace(fastSetup, () => fastSetup.replace('          cache: npm\n', ''));
    expect(findingsOf(noCache)).toEqual(expect.arrayContaining([expect.stringMatching(/actions\/setup-node with: must be exactly/u)]));
    const gateSetup = block(pin('Set up Node (literal version, no cache)', 'actions/setup-node@'), "          node-version: '24'\n");
    const gateNode = stage2.replace(gateSetup, () => gateSetup.replace("node-version: '24'", "node-version: '22'"));
    expect(findingsOf(gateNode)).toEqual(
      expect.arrayContaining([expect.stringMatching(/ci-gate actions\/setup-node with: must be exactly/u)]),
    );
    const key = '          key: prisma-engines-${{ runner.os }}-${{ steps.engines.outputs.version }}\n';
    expect(stage2.split(key)).toHaveLength(3);
    const poisoned = stage2.replace(key, () => '          key: prisma-engines-${{ github.head_ref }}\n');
    expect(findingsOf(poisoned)).toEqual(
      expect.arrayContaining([expect.stringMatching(/fast-lane actions\/cache with: must be exactly/u)]),
    );
    const build = "      - name: Build\n        if: env.CODE == 'true'\n        run: npm run build\n";
    expect(stage2.split(build)).toHaveLength(2);
    const upload = stage2.replace(
      build,
      () =>
        `${build}\n      - name: Upload\n        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2\n        with:\n          path: dist\n`,
    );
    expect(findingsOf(upload)).toEqual(
      expect.arrayContaining([expect.stringMatching(/fast-lane may not use actions\/upload-artifact \(PR59-SEC-01/u)]),
    );
  });
});

describe('[PR55-SEC-05] [PR62-SEC-02] [TASK-287 part 287-B] the aggregation carries the four fast-lane outputs, each exactly', () => {
  const entries = Object.entries(CI_GATE_ENV_FAST_LANE_OUTPUTS).map(([key, value]) => `          ${key}: ${value}\n`);

  it('the committed ci.yml carries all four with their exact values and passes', () => {
    expect(Object.keys(CI_GATE_ENV_FAST_LANE_OUTPUTS)).toEqual([
      'FAST_LANE_MODE',
      'FAST_LANE_CODE_PROOF',
      'FAST_LANE_SECURITY_INTEGRATION_DUE',
      'FAST_LANE_TOOLS_REF',
    ]);
    for (const entry of entries) expect(stage2.split(entry)).toHaveLength(2);
    expect(findingsOf(stage2)).toEqual([]);
  });

  it.each(Object.keys(CI_GATE_ENV_FAST_LANE_OUTPUTS))('dropping %s is a finding (required since 287-B)', (key) => {
    const entry = entries.find((line) => line.startsWith(`          ${key}:`)) ?? '';
    expect(findingsOf(stage2.replace(entry, ''))).toEqual([
      `required-gates: ci.yml ci-gate aggregate gate step must set env ${key}: ${String((CI_GATE_ENV_FAST_LANE_OUTPUTS as Record<string, string>)[key])}`,
    ]);
  });

  it('a wrong value (an output of another step or job) and an unlisted entry are findings', () => {
    const tools = entries.find((line) => line.startsWith('          FAST_LANE_TOOLS_REF:')) ?? '';
    expect(findingsOf(stage2.replace(tools, '          FAST_LANE_TOOLS_REF: ${{ steps.lane-scope.outputs.tools_ref }}\n'))).toEqual([
      'required-gates: ci.yml ci-gate aggregate gate step must set env FAST_LANE_TOOLS_REF: ${{ needs.fast-lane.outputs.tools_ref }}',
    ]);
    expect(findingsOf(stage2.replace(tools, `${tools}          FAST_LANE_EXTRA: \${{ needs.fast-lane.outputs.mode }}\n`))).toEqual([
      expect.stringContaining('required-gates: ci.yml ci-gate aggregate gate step must set no env but'),
    ]);
  });
});

describe('[PR62-SEC-01] [PR287B-SEC-02] [TASK-287 part 287-C1] action steps and stage-2 jobs are allow-lists', () => {
  const checkoutUses = `actions/checkout@${STAGE_2_ACTION_COMMITS['actions/checkout']}`;
  const fastCheckout = '      - name: Checkout (full history for the base ref and the PR commit range)\n';
  const gateSetupNode = '      - name: Set up Node (literal version, no cache)\n';
  const engineCache = '      - name: Restore the Prisma schema engine (re-verified by deps:rebuild)\n';
  const once = (from: string) => {
    expect(stage2.split(from).length).toBeGreaterThan(1);
    return from;
  };

  it('the committed ci.yml uses exactly the pinned commits, each also named by its upstream tag comment', () => {
    for (const [action, commit] of Object.entries(STAGE_2_ACTION_COMMITS)) expect(stage2).toContain(`uses: ${action}@${commit}`);
    expect(stage2).toContain(`uses: ${checkoutUses} # v7.0.1`);
    expect(findingsOf(stage2)).toEqual([]);
    expect(STAGE_2_ACTION_STEP_KEYS).toEqual(['name', 'uses', 'with']);
  });

  it.each<[string, string, string, RegExp]>([
    [
      'another 40-hex checkout commit (a fork-network commit resolves under the upstream name)',
      `uses: ${checkoutUses}`,
      `uses: actions/checkout@${'1'.repeat(40)}`,
      /actions\/checkout must be pinned to exactly/u,
    ],
    [
      'env: on a checkout step',
      `${fastCheckout}        uses:`,
      `${fastCheckout}        env:\n          GIT_DIR: /tmp/x\n        uses:`,
      /step must have only the keys name, uses, with \(found env/u,
    ],
    [
      'id: on a setup-node step',
      `${gateSetupNode}        uses:`,
      `${gateSetupNode}        id: node\n        uses:`,
      /step must have only the keys name, uses, with \(found id/u,
    ],
    [
      'if: on a checkout step',
      `${fastCheckout}        uses:`,
      `${fastCheckout}        if: always()\n        uses:`,
      /step must have only the keys name, uses, with \(found if/u,
    ],
    [
      'continue-on-error: on the engine cache',
      `${engineCache}`,
      `${engineCache}        continue-on-error: true\n`,
      /found continue-on-error/u,
    ],
  ])('%s is a finding', (_title, from, to, message) => {
    const mutated = stage2.replace(once(from), () => to);
    expect(mutated).not.toBe(stage2);
    expect(findingsOf(mutated)).toEqual(expect.arrayContaining([expect.stringMatching(message)]));
  });

  it("fast-lane's engine cache keeps exactly its CODE condition", () => {
    const guard = `${engineCache}        if: env.CODE == 'true'\n`;
    expect(stage2.split(guard)).toHaveLength(2);
    expect(findingsOf(stage2.replace(guard, `${engineCache}        if: always()\n`))).toEqual(
      expect.arrayContaining([expect.stringMatching(/fast-lane actions\/cache step if: must be exactly env\.CODE == 'true'/u)]),
    );
  });

  it.each(['fast-lane', 'security-integration', 'ci-gate'])(
    '%s: runs-on self-hosted, an environment: and a job concurrency: are findings',
    (job) => {
      const jobLine = `  ${job}:\n`;
      const start = stage2.indexOf(jobLine);
      expect(start).toBeGreaterThanOrEqual(0);
      const runsOn = '    runs-on: ubuntu-24.04\n';
      const at = stage2.indexOf(runsOn, start);
      const swapAt = (to: string) => stage2.slice(0, at) + to + stage2.slice(at + runsOn.length);
      expect(findingsOf(swapAt('    runs-on: self-hosted\n'))).toEqual(
        expect.arrayContaining([`required-gates: ci.yml job ${job} runs-on must be exactly ubuntu-24.04 (PR287B-SEC-02)`]),
      );
      expect(findingsOf(swapAt(`${runsOn}    environment: carrier-sandbox\n`))).toEqual(
        expect.arrayContaining([expect.stringMatching(new RegExp(`^required-gates: ci\\.yml job ${job} must not set environment`, 'u'))]),
      );
      expect(findingsOf(swapAt(`${runsOn}    concurrency: x\n`))).toEqual(
        expect.arrayContaining([expect.stringMatching(new RegExp(`^required-gates: ci\\.yml job ${job} must not set concurrency`, 'u'))]),
      );
    },
  );
});

describe('[D-SEC-PR57-02] [D-TASK287A-03] cache-hygiene: no CI cache restores the test-lock directory', () => {
  it.each<[string, number]>([
    ['node_modules', 1],
    ['./node_modules/**', 1],
    ['node_modules/.cache', 1],
    ['node_modules/.cache/**', 1],
    ['**/node_modules', 1],
    ['${{ github.workspace }}/node_modules', 1],
    [`node_modules\n!${TEST_LOCKS_DIR}`, 0],
    [`node_modules/.cache\n!${TEST_LOCKS_DIR}/**`, 0],
    ['node_modules/.cache/eslint', 0],
    ['node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x', 0],
    ['~/.npm', 0],
    ['apps/*/tsconfig.tsbuildinfo', 0],
  ])('path %j: %i finding(s)', (path, count) => {
    expect(cacheHygieneFindings(path)).toHaveLength(count);
  });

  it('the rule applies to any workflow (lane-c.yml here), on actions/cache, cache/restore and cache/save', () => {
    const laneC = readFileSync(join(repoRoot, '.github', 'workflows', 'lane-c.yml'), 'utf8');
    const install = '      - name: Install (npm ci --ignore-scripts)\n        run: npm ci --ignore-scripts --no-audit --no-fund\n';
    expect(laneC.split(install).length).toBeGreaterThan(1);
    for (const action of ['actions/cache', 'actions/cache/restore', 'actions/cache/save']) {
      const step = (path: string) =>
        `      - name: Cache\n        uses: ${action}@${STAGE_2_ACTION_COMMITS['actions/cache']} # v6.1.0\n        with:\n          path: ${path}\n          key: x\n\n`;
      const rules = (path: string) =>
        checkWorkflow(
          laneC.replace(install, () => step(path) + install),
          'lane-c.yml',
        ).map((f) => f.rule);
      expect([action, rules('node_modules')]).toEqual([action, ['cache-hygiene']]);
      expect([action, rules('node_modules/.cache/eslint')]).toEqual([action, []]);
    }
    expect(TEST_LOCKS_DIR).toBe('node_modules/.cache/shipqube-test-locks');
  });
});
