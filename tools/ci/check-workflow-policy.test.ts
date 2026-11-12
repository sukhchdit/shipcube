/**
 * Workflow policy (TASK-007; SEC-TC-32, SEC-TC-51, SEC-TC-64; PR1-SEC-02/-08/-12, PR4-SEC-08, PR5-SEC-07; D-ARCH-041,
 * D-ARCH-044; AT-US-005-04/-05). Every negative fixture under fixtures/workflow-policy/ has its own test.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { FORBIDDEN_ENGINE_ENV } from '../deps/prisma-engines.mjs';
import { FORBIDDEN_ENV, checkWorkflow, checkWorkflowPolicy, shellSegments } from './check-workflow-policy.mjs';
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
  ])('%s', (_title, fixture, rule) => {
    expect(rulesFor(fixture)).toContain(rule);
  });

  it.each([
    ['valid.yml: pinned actions, read-only token, workflow env, npm audit signatures with the scope override'],
    ['carrier-sandbox-dispatch.yml: SEC-TC-51 positive control (workflow_dispatch + environment carrier-sandbox)'],
    ['ci-images-guarded.yml: AT-US-005-04 positive control (images job gated on workflow_dispatch)'],
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
