/**
 * Required-suite manifest reader and selection (TASK-011; ADR-0023 amendments C and G; TEST-STRATEGY sections 4.3 and
 * 9.2; D-QA-001). The real manifest is loaded too, so a malformed qa-lead edit fails here first.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../../test-support/process.js';
import {
  AGENT_MEMORY_GLOB,
  CHECKPOINTS,
  ManifestError,
  checkpointsReached,
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
  stalenessAllowedChange,
  type Manifest,
} from './manifest.mjs';

const repoRoot = findRepoRoot();

function suite(status: 'planned' | 'active' | 'opt-in', extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { lane: ['B'], security: false, zero_skip: false, status, min_tests: 1, required_cases: [], ...extra };
}

/** Overrides that keep every fixture suite and set the required_cases of unit. */
function unitCases(cases: string[]): Record<string, unknown> {
  return { suites: { ...(fixture().suites as Record<string, unknown>), unit: suite('active', { required_cases: cases }) } };
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
        globs: ['docs/**', '.github/**', AGENT_MEMORY_GLOB],
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

  it('stalenessAllowed = docs/** minus the API contract minus tooling_inputs, plus the agent notes', () => {
    expect(stalenessAllowed('docs/sdlc/STATUS.md', manifest)).toBe(true);
    expect(stalenessAllowed('docs/03-architecture/api/openapi.yaml', manifest)).toBe(false);
    expect(stalenessAllowed('docs/01-requirements/stories/US-001.md', manifest)).toBe(false);
    expect(stalenessAllowed('apps/api/x.ts', manifest)).toBe(false);
    expect(stalenessAllowed('.github/workflows/ci.yml', manifest)).toBe(false);
  });
});

type Change = { path: string; oldMode: string; newMode: string };
type StaleCase = { title: string; path: string; newMode?: string; allowed: boolean };

/** The 13 cases of the PR #28 security record (section 6, probe table) for the exact pattern `.claude/agent-memory/*` + `/*.md`. */
const AGENT_NOTE_CASES: StaleCase[] = [
  { title: 'an agent note', path: '.claude/agent-memory/qa-lead/zz.md', allowed: true },
  { title: 'the MEMORY.md index of an agent', path: '.claude/agent-memory/qa-lead/MEMORY.md', allowed: true },
  { title: 'settings.json (hooks, permissions)', path: '.claude/settings.json', allowed: false },
  { title: 'an agent definition', path: '.claude/agents/zz.md', allowed: false },
  { title: 'a command', path: '.claude/commands/zz.md', allowed: false },
  { title: 'a .sh file in an agent directory', path: '.claude/agent-memory/qa-lead/zz.sh', allowed: false },
  { title: 'a .mjs file in an agent directory', path: '.claude/agent-memory/qa-lead/zz.mjs', allowed: false },
  { title: 'a .json file in an agent directory', path: '.claude/agent-memory/qa-lead/zz.json', allowed: false },
  { title: 'a nested note', path: '.claude/agent-memory/qa-lead/sub/zz.md', allowed: false },
  { title: 'a note with no agent directory', path: '.claude/agent-memory/zz.md', allowed: false },
  { title: 'a sibling directory prefix', path: '.claude/agent-memory-x/qa-lead/zz.md', allowed: false },
  { title: 'a file in a worktree', path: '.claude/worktrees/w/apps/api/src/zz.ts', allowed: false },
  { title: 'an agent note that is a symlink (mode 120000)', path: '.claude/agent-memory/qa-lead/zz.md', newMode: '120000', allowed: false },
];

const toChange = (c: StaleCase): Change => ({ path: c.path, oldMode: '100644', newMode: c.newMode ?? '100644' });

/** Titles of the table cases a `stalenessAllowedChange` implementation gets wrong. */
function tableFailures(allowedChange: (change: Change, m: Manifest) => boolean): string[] {
  return AGENT_NOTE_CASES.filter((c) => allowedChange(toChange(c), manifest) !== c.allowed).map((c) => c.title);
}

const tempDirs: string[] = [];
afterAll(() => tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** manifest.mjs with the AGENT_MEMORY_GLOB constant replaced, loaded from a temp file: a mutant of the real module. */
async function mutantChange(glob: string): Promise<(change: Change, m: Manifest) => boolean> {
  const source = readFileSync(join(repoRoot, 'tools', 'quality', 'lib', 'manifest.mjs'), 'utf8');
  const line = `export const AGENT_MEMORY_GLOB = '${AGENT_MEMORY_GLOB}';`;
  expect(source.split(line)).toHaveLength(2);
  const dir = mkdtempSync(join(tmpdir(), 'manifest-mutant-'));
  tempDirs.push(dir);
  const file = join(dir, `mutant-${tempDirs.length}.mjs`);
  writeFileSync(
    file,
    source.replace(line, () => `export const AGENT_MEMORY_GLOB = '${glob}';`),
  );
  const mutant = (await import(pathToFileURL(file).href)) as { stalenessAllowedChange: typeof stalenessAllowedChange };
  return mutant.stalenessAllowedChange;
}

describe('staleness allow-list for agent notes (D-SEC-PR28-01, PR28-SEC-03)', () => {
  it('the constant is exactly the agent-note shape', () => {
    expect(AGENT_MEMORY_GLOB).toBe('.claude/agent-memory/*/*.md');
  });

  it.each(AGENT_NOTE_CASES)('table: $title -> allowed $allowed', (c) => {
    expect(stalenessAllowedChange(toChange(c), manifest)).toBe(c.allowed);
  });

  it('the table has the 13 cases of the record and the real implementation passes all of them', () => {
    expect(AGENT_NOTE_CASES).toHaveLength(13);
    expect(tableFailures(stalenessAllowedChange)).toEqual([]);
  });

  it('mutation control: an unchanged mutant loaded from a temp file passes the table', async () => {
    expect(tableFailures(await mutantChange(AGENT_MEMORY_GLOB))).toEqual([]);
  });

  it.each([
    ['.claude/**'],
    ['.claude/agent-memory/**'],
    ['.claude/agent-memory/**/*.md'],
    ['.claude/agent-memory/*/*'],
    ['.claude/agent-memory*/*/*.md'],
    ['**/*.md'],
  ])('mutation: widening the constant to %s makes the table fail', async (glob) => {
    expect(tableFailures(await mutantChange(glob)).length).toBeGreaterThan(0);
  });

  it.each([
    ['a symlink', '120000'],
    ['a submodule', '160000'],
    ['an executable', '100755'],
  ])('the mode guard refuses %s on an allowed path, on the new or the old side', (_what, mode) => {
    for (const path of ['.claude/agent-memory/qa-lead/zz.md', 'docs/sdlc/STATUS.md']) {
      expect(stalenessAllowedChange({ path, oldMode: '100644', newMode: mode }, manifest)).toBe(false);
      expect(stalenessAllowedChange({ path, oldMode: mode, newMode: '000000' }, manifest)).toBe(false);
    }
  });

  it('an added (old mode absent) or deleted (new mode absent) regular file is allowed', () => {
    const path = '.claude/agent-memory/qa-lead/zz.md';
    expect(stalenessAllowedChange({ path, oldMode: '000000', newMode: '100644' }, manifest)).toBe(true);
    expect(stalenessAllowedChange({ path, oldMode: '100644', newMode: '000000' }, manifest)).toBe(true);
  });

  it.each([
    ['.claude/agent-memory/qa-lead\\zz.md'],
    ['.claude\\agent-memory\\qa-lead\\zz.md'],
    ['.claude/agent-memory//zz.md'],
    ['.claude/agent-memory/./zz.md'],
    ['.claude/agent-memory/../zz.md'],
    ['.Claude/agent-memory/qa-lead/zz.md'],
    ['.claude/agent-memory/qa-lead/zz.md/'],
  ])('an irregular spelling of the path is stale: %s', (path) => {
    expect(stalenessAllowed(path, manifest)).toBe(false);
  });

  it('the pattern is in the docs-or-ci-only rule, so a memory-only change selects no suite', () => {
    const paths = ['.claude/agent-memory/qa-lead/zz.md', '.claude/agent-memory/senior-developer/MEMORY.md'];
    expect(selectSuites(manifest, { profile: 'pr', changedPaths: paths })).toEqual({ required: [], planned: [], rules: [] });
    expect(selectSuites(manifest, { profile: 'pr', changedPaths: ['.claude/settings.json'] }).required).toEqual(['unit']);
    expect(selectSuites(manifest, { profile: 'pr', changedPaths: [...paths, 'apps/api/src/app.ts'] }).required).toContain('integration');
  });

  it('the real manifest lists the constant in docs-or-ci-only exactly once and mentions .claude nowhere else', () => {
    const real = loadManifest(manifestFile(repoRoot));
    const docsRule = real.path_rules.find((rule) => rule.id === 'docs-or-ci-only');
    expect(docsRule?.globs.filter((glob) => glob === AGENT_MEMORY_GLOB)).toHaveLength(1);
    const elsewhere = [
      ...real.path_rules.filter((rule) => rule.id !== 'docs-or-ci-only').flatMap((rule) => [...rule.globs, ...rule.exclude]),
      ...(docsRule?.globs.filter((glob) => glob !== AGENT_MEMORY_GLOB) ?? []),
      ...(docsRule?.exclude ?? []),
      ...real.tooling_inputs,
      ...real.security_critical_paths,
      ...real.rules.clean_tree_paths,
    ];
    expect(elsewhere.filter((glob) => glob.includes('.claude'))).toEqual([]);
    expect(real.path_rules.filter((rule) => rule.globs.includes(AGENT_MEMORY_GLOB)).map((rule) => rule.id)).toEqual(['docs-or-ci-only']);
  });

  it('with the real manifest, a memory-only change at profile pr needs no lane B suite and settings.json does', () => {
    const real = loadManifest(manifestFile(repoRoot));
    // `unit` is `planned` or `active` depending on the activation state of the manifest: count both as selected.
    const selected = (path: string): string[] => {
      const { required, planned } = selectSuites(real, { profile: 'pr', changedPaths: [path] });
      return [...required, ...planned];
    };
    expect(selected('.claude/agent-memory/qa-lead/MEMORY.md')).toEqual([]);
    expect(selected('.claude/settings.json')).toContain('unit');
  });
});

describe('required_cases_pending (D-QA-014, PR28-SEC-01)', () => {
  const entry = { case: 'SEC-TC-14', owner: 'TASK-049', checkpoint: 'v0.1.0-m0' };

  it('is optional and defaults to empty', () => {
    expect(manifest.required_cases_pending).toEqual({});
  });

  it('parses entries, skips $comment and keeps an optional decision ID', () => {
    const withDecision = { ...entry, case: 'SEC-TC-55', decision: 'D-QA-099' };
    const parsed = parseManifest(fixture({ required_cases_pending: { $comment: 'x', unit: [entry, withDecision] } }));
    expect(parsed.required_cases_pending['unit']).toEqual([entry, withDecision]);
  });

  it.each([
    ['a bad case ID', { unit: [{ ...entry, case: 'TC-14' }] }],
    ['a bad checkpoint', { unit: [{ ...entry, checkpoint: 'someday' }] }],
    ['an empty owner', { unit: [{ ...entry, owner: ' ' }] }],
    ['a bad decision ID', { unit: [{ ...entry, decision: 'because' }] }],
    ['an unknown suite', { nope: [entry] }],
    ['a non-array entry list', { unit: entry }],
    ['a non-object entry', { unit: ['SEC-TC-14'] }],
    ['a non-object value', ['SEC-TC-14']],
  ])('throws on %s', (_title, pending) => {
    expect(() => parseManifest(fixture({ required_cases_pending: pending }))).toThrow(ManifestError);
  });

  it('checkpointsReached: pr none, wave the Wave-0 exit, gate all', () => {
    expect(checkpointsReached('pr')).toEqual([]);
    expect(checkpointsReached('wave')).toEqual(['Wave-0 exit']);
    expect(checkpointsReached('gate')).toEqual([...CHECKPOINTS]);
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
    ['coverage case without a metric', unitCases(['coverage gate: overall'])],
    ['coverage case with an inactive suffix', unitCases(['coverage gate: packages/audit (inactive)'])],
    ['coverage case outside the gate prefix', unitCases(['coverage merge: project unit measured'])],
  ])('throws on %s', (_title, override) => {
    expect(() => parseManifest(fixture(override))).toThrow(ManifestError);
  });

  it('[PR33-SEC-06] required_cases accept SEC-TC IDs and the exact US-006 gate case names', () => {
    const ids = ['SEC-TC-01', 'coverage gate: overall lines', 'coverage gate: packages/authz branches'];
    expect(parseManifest(fixture(unitCases(ids))).suites['unit']?.required_cases).toEqual(ids);
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
