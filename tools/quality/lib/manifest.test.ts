/**
 * Required-suite manifest reader and selection (TASK-011; ADR-0023 amendments C and G; TEST-STRATEGY sections 4.3 and
 * 9.2; D-QA-001). The real manifest is loaded too, so a malformed qa-lead edit fails here first.
 */
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../../test-support/process.js';
import {
  ManifestError,
  gateBlockers,
  globsMatch,
  isCleanTreePath,
  loadManifest,
  manifestFile,
  matchGlob,
  parseManifest,
  profileSatisfies,
  selectSuites,
  stalenessAllowed,
  type Manifest,
} from './manifest.mjs';

const repoRoot = findRepoRoot();

function suite(status: 'planned' | 'active' | 'opt-in', extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { lane: ['B'], security: false, zero_skip: false, status, min_tests: 1, required_cases: [], ...extra };
}

function fixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    manifest_version: 1,
    rules: {
      invalid_env_prefixes: ['SKIP_'],
      recorded_env_prefixes: ['SKIP_', 'TEST_'],
      clean_tree_paths: ['apps/**', 'tools/**', '*.config.*', '.env*', '!.env.example', 'package*.json'],
    },
    tooling_inputs: ['docs/03-architecture/api/**', 'docs/01-requirements/stories/**'],
    deferred_at_gate: [],
    suites: {
      unit: suite('active'),
      integration: suite('active'),
      'rbac-matrix': suite('active', { security: true, zero_skip: true, required_cases: ['SEC-TC-01'] }),
      'e2e-chromium': suite('planned'),
      'contract-live': suite('opt-in'),
    },
    profiles: {
      pr: { always: ['unit'] },
      wave: { always: ['unit', 'integration', 'rbac-matrix'] },
      gate: { always: ['unit', 'integration', 'rbac-matrix', 'e2e-chromium'] },
    },
    path_rules: [
      {
        id: 'backend',
        globs: ['apps/api/**', 'packages/**', '!packages/ui/**'],
        profile_min: 'pr',
        suites: ['integration', 'rbac-matrix'],
      },
      { id: 'frontend', globs: ['apps/web/**', 'packages/ui/**'], profile_min: 'pr', suites: ['e2e-chromium'] },
      {
        id: 'docs-or-ci-only',
        globs: ['docs/**', '.github/**'],
        exclude: ['docs/03-architecture/api/**', 'docs/01-requirements/stories/**'],
        profile_min: 'none',
        suites: [],
      },
    ],
    ...overrides,
  };
}

const manifest: Manifest = parseManifest(fixture());

describe('matchGlob', () => {
  it.each([
    ['apps/api/src/x.ts', 'apps/api/**', true],
    ['apps/api', 'apps/api/**', true],
    ['apps/apix/a.ts', 'apps/api/**', false],
    ['jest.config.ts', '*.config.*', true],
    ['apps/jest.config.ts', '*.config.*', false],
    ['a/b/locales/en.json', '**/locales/**', true],
    ['locales/en.json', '**/locales/**', true],
    ['apps/api/src/modules/orders/repository/x.ts', 'apps/api/src/modules/*/repository/**', true],
    ['apps/api/src/modules/orders/sub/repository/x.ts', 'apps/api/src/modules/*/repository/**', false],
    ['infra/compose/web/Dockerfile.prod', '**/Dockerfile*', true],
    ['compose.override.yaml', 'compose*.yaml', true],
    ['.env.local', '.env*', true],
    ['apps\\api\\x.ts', 'apps/api/**', true],
  ])('%s against %s is %s', (path, glob, expected) => {
    expect(matchGlob(path, glob)).toBe(expected);
  });

  it('rejects a negated glob (callers apply negation)', () => {
    expect(() => matchGlob('a', '!a')).toThrow(ManifestError);
  });

  it('a pathological glob against a long path finishes quickly (no backtracking blow-up)', () => {
    const path = `${'a/'.repeat(500)}b`;
    const glob = `${'**/a*a*a*/'.repeat(10)}c`;
    const started = Date.now();
    expect(matchGlob(path, glob)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('globsMatch applies ! exclusions', () => {
    expect(globsMatch('.env', ['.env*', '!.env.example'])).toBe(true);
    expect(globsMatch('.env.example', ['.env*', '!.env.example'])).toBe(false);
    expect(globsMatch('packages/ui/a.ts', ['packages/**', '!packages/ui/**'])).toBe(false);
  });
});

describe('selectSuites (active-only required set)', () => {
  it('docs-only change selects nothing', () => {
    expect(selectSuites(manifest, { profile: 'pr', changedPaths: ['docs/sdlc/STATUS.md', '.github/workflows/ci.yml'] })).toEqual({
      required: [],
      planned: [],
      rules: [],
    });
  });

  it('a tooling input under docs is not lane-A-only: the pr always set applies', () => {
    expect(selectSuites(manifest, { profile: 'pr', changedPaths: ['docs/03-architecture/api/openapi.yaml'] }).required).toEqual(['unit']);
  });

  it('a backend change selects always + the backend rule', () => {
    expect(selectSuites(manifest, { profile: 'pr', changedPaths: ['apps/api/src/app.ts'] })).toEqual({
      required: ['integration', 'rbac-matrix', 'unit'],
      planned: [],
      rules: ['backend'],
    });
  });

  it('a ! exclusion keeps packages/ui out of the backend rule; planned suites are reported, not required', () => {
    expect(selectSuites(manifest, { profile: 'pr', changedPaths: ['packages/ui/button.tsx'] })).toEqual({
      required: ['unit'],
      planned: ['e2e-chromium'],
      rules: ['frontend'],
    });
  });

  it('wave and gate use the profile set; gateBlockers lists non-active suites without a deferral', () => {
    expect(selectSuites(manifest, { profile: 'gate', changedPaths: [] })).toEqual({
      required: ['integration', 'rbac-matrix', 'unit'],
      planned: ['e2e-chromium'],
      rules: [],
    });
    expect(gateBlockers(manifest)).toEqual(['e2e-chromium']);
    const deferred = parseManifest(fixture({ deferred_at_gate: [{ suite: 'e2e-chromium', decision: 'D-QA-099' }] }));
    expect(gateBlockers(deferred)).toEqual([]);
  });

  it('profileSatisfies orders pr < wave < gate', () => {
    expect(profileSatisfies('gate', 'pr')).toBe(true);
    expect(profileSatisfies('pr', 'wave')).toBe(false);
  });
});

describe('clean tree and staleness', () => {
  it('isCleanTreePath follows rules.clean_tree_paths', () => {
    expect(isCleanTreePath('tools/quality/x.mjs', manifest)).toBe(true);
    expect(isCleanTreePath('.env.example', manifest)).toBe(false);
    expect(isCleanTreePath('docs/README.md', manifest)).toBe(false);
  });

  it('stalenessAllowed = docs/** minus the API contract minus tooling_inputs', () => {
    expect(stalenessAllowed('docs/sdlc/STATUS.md', manifest)).toBe(true);
    expect(stalenessAllowed('docs/03-architecture/api/openapi.yaml', manifest)).toBe(false);
    expect(stalenessAllowed('docs/01-requirements/stories/US-001.md', manifest)).toBe(false);
    expect(stalenessAllowed('apps/api/x.ts', manifest)).toBe(false);
    expect(stalenessAllowed('.github/workflows/ci.yml', manifest)).toBe(false);
  });
});

describe('parseManifest structural validation', () => {
  it.each([
    ['unknown manifest_version', { manifest_version: 2 }],
    ['unknown suite in a profile', { profiles: { pr: { always: ['nope'] }, wave: { always: [] }, gate: { always: [] } } }],
    ['unknown status', { suites: { unit: suite('active', { status: 'maybe' }) } }],
    ['unsafe glob', { tooling_inputs: ['docs/../x'] }],
    ['deferral without a decision ID', { deferred_at_gate: [{ suite: 'unit', decision: 'because' }] }],
    ['malformed required case', { suites: { unit: suite('active', { required_cases: ['TC-1'] }) } }],
  ])('throws on %s', (_title, override) => {
    expect(() => parseManifest(fixture(override))).toThrow(ManifestError);
  });

  it('the repository manifest at its canonical location loads', () => {
    const real = loadManifest(manifestFile(repoRoot));
    expect(Object.keys(real.suites).length).toBeGreaterThanOrEqual(65);
    expect(real.path_rules.map((rule) => rule.id)).toContain('docs-or-ci-only');
  });

  it('loadManifest wraps unreadable files', () => {
    expect(() => loadManifest(join(repoRoot, 'tools', 'quality', 'does-not-exist.json'))).toThrow(ManifestError);
  });
});
