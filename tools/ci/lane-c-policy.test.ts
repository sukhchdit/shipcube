/**
 * Suite `ci-policy`, lane C and nightly part (TASK-015 part 015-B; ADR-0023 amendments C and G items 5-6; D-ARCH-010
 * items 3-4; AT-US-005-02 lane C part; COND-E2E-FF; PR4-SEC-08): the committed `.github/workflows/lane-c.yml` and
 * `nightly.yml` are dispatch-only, hold the ADR's lane C jobs, release nothing, keep browser installs and the WebKit
 * repetition in lane C, and read gitleaks configuration through the gitleaks-full runner.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';
import { checkWorkflow } from './check-workflow-policy.mjs';
import { isMap, parseYamlSubset } from './yaml-subset.mjs';
import type { YamlMap, YamlNode } from './yaml-subset.mjs';

const repoRoot = findRepoRoot();
const read = (name: string): string => readFileSync(join(repoRoot, '.github', 'workflows', name), 'utf8');
const laneCText = read('lane-c.yml');
const nightlyText = read('nightly.yml');

function map(node: YamlNode | undefined, what: string): YamlMap {
  if (!isMap(node)) throw new Error(`${what} is not a mapping`);
  return node;
}
const str = (node: YamlNode | undefined): string => (typeof node === 'string' ? node : '');
const doc = (text: string, what: string): YamlMap => map(parseYamlSubset(text).value ?? undefined, what);
const laneC = doc(laneCText, 'lane-c.yml');
const nightly = doc(nightlyText, 'nightly.yml');
const jobsOf = (workflow: YamlMap): YamlMap => map(workflow.jobs, 'jobs');
const runsOf = (job: YamlNode | undefined): string =>
  (Array.isArray(map(job, 'job').steps) ? (map(job, 'job').steps as YamlNode[]) : [])
    .map((s) => str(map(s, 'step').run))
    .filter((run) => run !== '')
    .join('\n');
const code = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !/^\s*#/u.test(line))
    .join('\n');

describe('ci-policy: lane C (lane-c.yml)', () => {
  it('[D-ARCH-010 item 3] workflow_dispatch only, profiles wave-end | release-candidate, no ref input, no cancellation', () => {
    expect(Object.keys(map(laneC.on, 'on'))).toEqual(['workflow_dispatch']);
    const inputs = map(map(map(laneC.on, 'on').workflow_dispatch, 'dispatch').inputs, 'inputs');
    expect(Object.keys(inputs)).toEqual(['profile', 'since', 'webkit_repeat_each']);
    expect(map(inputs.profile, 'profile').options).toEqual(['wave-end', 'release-candidate']);
    expect(map(laneC.concurrency, 'concurrency')['cancel-in-progress']).toBe('false');
    expect(checkWorkflow(laneCText, 'lane-c.yml')).toEqual([]);
  });

  it('[ADR-0023 am. C] holds the lane C jobs and an aggregate that needs every one of them', () => {
    const jobs = jobsOf(laneC);
    expect(Object.keys(jobs)).toEqual(['static', 'integration', 'images', 'e2e-stack', 'iac', 'scans-full', 'inventory', 'lane-c-gate']);
    expect(map(jobs['lane-c-gate'], 'gate').needs).toEqual([
      'static',
      'integration',
      'images',
      'e2e-stack',
      'iac',
      'scans-full',
      'inventory',
    ]);
    expect(runsOf(jobs['lane-c-gate'])).toContain('if [ "$result" != "success" ]; then');
    // Whole-repository coverage (US-006) is lane C's, merged across the Jest projects, with the gate.
    expect(runsOf(jobs.integration)).toContain('npm run test:coverage -- --out "$out" --test-timeout 60000');
    expect(runsOf(jobs.integration)).toContain('npm run coverage:gate -- --summary "$out/coverage-summary.json"');
  });

  it('[COND-E2E-FF] e2e-stack: one shard per engine, mobile and desktop projects, WebKit --repeat-each from a 1|5 choice, browsers only through deps:rebuild', () => {
    const e2e = map(jobsOf(laneC)['e2e-stack'], 'e2e-stack');
    expect(map(map(e2e.strategy, 'strategy').matrix, 'matrix').engine).toEqual(['chromium', 'firefox', 'webkit']);
    expect(map(e2e.strategy, 'strategy')['fail-fast']).toBe('false');
    const run = runsOf(e2e);
    expect(run).toContain('npm run deps:rebuild -- "--playwright=$ENGINE"');
    expect(run).toContain('npm run test:e2e -- "--project=$ENGINE-mobile" "--project=$ENGINE-desktop" "--repeat-each=$repeat"');
    expect(run).toContain('case "$WEBKIT_REPEAT_EACH" in 1|5)');
    expect(map(map(map(laneC.on, 'on').workflow_dispatch, 'd').inputs, 'i').webkit_repeat_each).toMatchObject({ default: '5' });
    expect(code(laneCText)).not.toMatch(/playwright\s+install|PLAYWRIGHT_[A-Z_]*DOWNLOAD_HOST/u);
  });

  it('[AT-US-005-04/-05] releases nothing: no push, publish, apply, AWS role, OIDC token or secret; terraform only fmt/init -backend=false/validate', () => {
    const text = code(laneCText);
    expect(text).not.toMatch(/docker\s+push|--push\b|push:\s*true|packages:\s*write|id-token|secrets\.|npm\s+publish|role-to-assume/u);
    const tf = [...text.matchAll(/"\$TERRAFORM_IMAGE" (\S+)/gu)].map((m) => m[1]);
    expect(new Set(tf)).toEqual(new Set(['fmt', 'init', 'validate']));
    expect(text).toContain('init -backend=false -input=false -lockfile=readonly');
  });

  it('[PR25-SEC-01 / D-SEC-PR45-01] scans-full runs the gitleaks-full runner on the dispatched SHA (config and baseline from git), no npm', () => {
    const run = runsOf(jobsOf(laneC)['scans-full']);
    expect(run).toBe(
      'node tools/quality/gitleaks-full.mjs --root "$GITHUB_WORKSPACE" --ref "$GITHUB_SHA" --scan "$GITHUB_SHA" --report "$RUNNER_TEMP/gitleaks-full.json"',
    );
  });

  it('[ADR-0023 am. G item 6] inventory reads the lane C reports and validates the since input before use', () => {
    const run = runsOf(jobsOf(laneC).inventory);
    expect(run).toContain("grep -Eq '^[0-9a-f]{7,40}$'");
    expect(run).toContain('node tools/quality/inventory.mjs --root "$GITHUB_WORKSPACE" --jest "$reports/lane-c-integration/jest"');
    expect(str(map(jobsOf(laneC).inventory, 'inventory').if)).toBe('${{ !cancelled() }}');
  });
});

describe('ci-policy: nightly.yml', () => {
  it('[ADR-0023 am. C] workflow_dispatch only, no schedule; releases nothing; passes the workflow policy', () => {
    expect(Object.keys(map(nightly.on, 'on'))).toEqual(['workflow_dispatch']);
    expect(code(nightlyText)).not.toMatch(/schedule|cron|docker\s+push|npm\s+publish|terraform|secrets\./u);
    expect(checkWorkflow(nightlyText, 'nightly.yml')).toEqual([]);
    expect(Object.keys(jobsOf(nightly))).toEqual(['dependency-freshness', 'gitleaks-full']);
  });
});
