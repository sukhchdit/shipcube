/**
 * Stage 2 of ADR-0023 amendment L item 3 (D-ARCH-128; ruling rulings/wave-0-ci-minutes.md section 3 (4), section 5
 * TASK-286): the base-ref policy accepts the folded topology, `tools/ci/fixtures/stage-2/ci.yml` (the workflow the
 * second, workflow PR installs as .github/workflows/ci.yml), holds it to its own pins in full, and kills every mutant of
 * those pins; the routed security items PR46-SEC-11/-12/-15/-17 and PR42-SEC-18 are pinned with it. The stage-1
 * ci.yml keeps passing under the same checker (ci-policy.test.ts), and no mixture of the two passes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';
import {
  CI_GATE_RUN_TESTED_BASE,
  CI_GATE_STEPS_STAGE_2,
  CLASSIFY_RUN,
  LANE_SCOPE_RUN_TESTED_BASE,
  TOPOLOGIES,
  checkWorkflow,
  requiredGatesFor,
  topologyOf,
} from './check-workflow-policy.mjs';
import { proofSteps } from './lane-scope.mjs';
import { isMap, parseYamlSubset } from './yaml-subset.mjs';
import type { YamlMap, YamlNode } from './yaml-subset.mjs';

const repoRoot = findRepoRoot();
const stage2 = readFileSync(join(repoRoot, 'tools', 'ci', 'fixtures', 'stage-2', 'ci.yml'), 'utf8');
const stage1 = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
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
  it('the stage-2 fixture passes with 0 findings, and so does the live stage-1 ci.yml (both topologies, each in full)', () => {
    expect(findingsOf(stage2)).toEqual([]);
    expect(findingsOf(stage1)).toEqual([]);
    expect(TOPOLOGIES).toEqual(['stage-1', 'stage-2']);
    expect(topologyOf(parseYamlSubset(stage1).value)).toBe('stage-1');
    expect(topologyOf(parseYamlSubset(stage2).value)).toBe('stage-2');
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
    expect(requiredGatesFor(parseYamlSubset(stage2).value).filter((gate) => gate.job === 'scans')).toEqual([]);
  });

  it('commitlint, actionlint and the install may be CODE-gated; signatures and the advisory audit are unconditional (PR46-SEC-11)', () => {
    const gates = requiredGatesFor(parseYamlSubset(stage2).value);
    const ifsOf = (gate: string) => gates.find((candidate) => candidate.job === 'fast-lane' && candidate.gate === gate)?.ifs;
    expect(ifsOf('commitlint')).toEqual(["env.CODE == 'true'"]);
    expect(ifsOf('actionlint')).toEqual(["env.CODE == 'true'"]);
    expect(ifsOf('install')).toEqual(["env.CODE == 'true'"]);
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

  it('proof step names come from the topology: CODE-gated fast-lane steps (commitlint, actionlint, install) and the scans in ci-gate', () => {
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
        'Install (npm ci --ignore-scripts)',
        'Commit messages (commitlint; PR title = squash subject, pushed range on main)',
        'actionlint',
        'Unit tests',
        'Build',
      ]),
    );
    expect(names).not.toContain('Registry signatures and provenance (PR1-SEC-12)');
    expect(names).not.toContain('Vulnerability audit (npm audit + osv-scanner)');
    const stage1Steps = proofSteps(stage1);
    if ('problem' in stage1Steps) throw new Error(stage1Steps.problem);
    expect(stage1Steps.scansJob).toBe('scans');
  });
});

describe('[TASK-286] the stage-2 pins kill every mutant (PR46-SEC-11/-12/-15/-17, PR42-SEC-18, D-ARCH-128)', () => {
  const tooling = 'tools_ref=$(git rev-parse --verify --quiet "HEAD^1^{commit}" || true)';
  const ciGateEnvFast = 'FAST_LANE_CLASSIFICATION: ${{ needs.fast-lane.outputs.classification }}';
  /** The openings of the two tested-base blocks (fast-lane's, ci-gate's), which make each mutant unambiguous. */
  const fastLaneOpen =
    '          set -euo pipefail\n          tools_ref=""\n          if [ "$GITHUB_EVENT_NAME" = "pull_request" ]; then\n';
  const ciGateOpen =
    '          mkdir -p "$gates/base" "$gates/head"\n          tools_ref=""\n          if [ "$GITHUB_EVENT_NAME" = "pull_request" ]; then\n';
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

  it('[mixture] the live stage-1 ci.yml without its scans job is held to the stage-2 pins and fails', () => {
    const start = stage1.indexOf('  scans:\n');
    const end = stage1.indexOf('  # ADR-0023 am. G item 5 as amended by am. L item 2');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const withoutScans = stage1.slice(0, start) + stage1.slice(end);
    expect(findingsOf(withoutScans).filter((finding) => finding.startsWith('required-gates:')).length).toBeGreaterThan(5);
  });
});

describe('[PR46-SEC-12] [TASK-286] stage 1 while it is live: the scans tooling step is pinned and nothing re-points a gate', () => {
  const swap1 = (from: string, to: string) => {
    expect(stage1.split(from)).toHaveLength(2);
    return stage1.replace(from, () => to);
  };
  it.each<[string, string, string, string]>([
    [
      'X3 every scans GATE_* from the head extract',
      '            if [ -f "$gates/base/tools/ci/$tool.mjs" ]; then\n              echo "$var=$gates/base',
      '            if false; then\n              echo "$var=$gates/base',
      'required-gates',
    ],
    [
      'X4 a step re-points GATE_LANE_SCOPE before the lane-scope step',
      '      # ADR-0023 am. L items 1-2 (D-ARCH-126/127, RR-4)',
      '      - name: Re-point\n        run: echo "GATE_LANE_SCOPE=/tmp/x.mjs" >> "$GITHUB_ENV"\n\n      # ADR-0023 am. L items 1-2 (D-ARCH-126/127, RR-4)',
      'required-gates',
    ],
    [
      'X4b a later scans step writes $GITHUB_ENV',
      '            "$GITLEAKS_IMAGE" git /repo',
      '            "$GITLEAKS_IMAGE" git /repo',
      'none',
    ],
    [
      'security paths from the head copy',
      'run: node "$GATE_SECURITY_PATHS" --root',
      'run: node "$GITHUB_WORKSPACE/tools/ci/security-paths.mjs" --root',
      'required-gates',
    ],
    [
      'a run step before the scans tooling step',
      "      - name: Set up Node (literal version, no cache)\n        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0\n        with:\n          node-version: '24'\n\n      - name: Gate tooling and scan configuration",
      "      - name: Set up Node (literal version, no cache)\n        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0\n        with:\n          node-version: '24'\n\n      - name: Early\n        run: echo early\n\n      - name: Gate tooling and scan configuration",
      'required-gates',
    ],
  ])('%s', (_title, from, to, rule) => {
    const findings = findingsOf(swap1(from, to));
    if (rule === 'none') {
      // Control: an identity swap gives no finding (the pins do not fire on the committed text).
      expect(findings).toEqual([]);
      return;
    }
    expect(findings.some((finding) => finding.startsWith(`${rule}:`))).toBe(true);
  });

  it('X4b a later scans step that writes $GITHUB_ENV is a gate-env finding', () => {
    const from =
      '      - name: Semgrep (rules, .semgrepignore and .gitignore from the base ref; --disable-nosem)\n        run: node "$GATE_RUN_SEMGREP"';
    const to =
      '      - name: Semgrep (rules, .semgrepignore and .gitignore from the base ref; --disable-nosem)\n        run: echo "GATES_DIR=/tmp" >> "$GITHUB_ENV" && node "$GATE_RUN_SEMGREP"';
    expect(findingsOf(swap1(from, to)).some((finding) => finding.startsWith('gate-env:'))).toBe(true);
  });
});
