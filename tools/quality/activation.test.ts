/**
 * Suite activation invariants (W0-ACT-1; COND-PR23-2 / PR23-SEC-02; D-ARCH-082, D-ORCH-030, D-QA-014; TEST-STRATEGY
 * section 9.3). A suite may be `active` in tools/quality/required-suites.json (qa-lead) only when
 * tools/quality/suite-runners.json (devops-engineer) can run it: `quality:heavy` reports an active suite without a
 * runner entry as an error, which would FAIL every PR whose paths select that suite. SEC-TC IDs parked in
 * `required_cases_pending` must stay disjoint from `required_cases` and belong to active suites.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';
import { RUNNERS_PATH, parseRunners } from './heavy.mjs';
import { loadManifest, manifestFile, parseManifest, MANIFEST_PATH, type Manifest } from './lib/manifest.mjs';

const repoRoot = findRepoRoot();

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(repoRoot, ...relativePath.split('/')), 'utf8')) as unknown;
}

/** Active manifest suites that have no runner entry. */
function activeWithoutRunner(manifest: Manifest, runnerIds: ReadonlySet<string>): string[] {
  return Object.entries(manifest.suites)
    .filter(([id, suite]) => suite.status === 'active' && !runnerIds.has(id))
    .map(([id]) => id)
    .sort();
}

const CHECKPOINTS = new Set(['Wave-0 exit', 'v0.1.0-m0', 'G3']);
const CASE_ID = /^SEC-TC-[0-9]{2,3}$/;

type PendingEntry = { case: string; owner: string; checkpoint: string };

/** `required_cases_pending` of the raw manifest, without its `$comment`. */
function pendingCases(raw: unknown): Record<string, PendingEntry[]> {
  const value = (raw as { required_cases_pending?: Record<string, unknown> }).required_cases_pending ?? {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$comment')) as Record<string, PendingEntry[]>;
}

const manifest = loadManifest(manifestFile(repoRoot));
const runners = parseRunners(readJson(RUNNERS_PATH));
const runnerIds = new Set(Object.keys(runners.suites));

describe('suite activation (COND-PR23-2, D-ARCH-082)', () => {
  it('[COND-PR23-2] every active suite of the manifest has a suite-runners.json entry', () => {
    expect(activeWithoutRunner(manifest, runnerIds)).toEqual([]);
  });

  it('[COND-PR23-2] the check fires on an active suite without a runner entry', () => {
    const raw = readJson(MANIFEST_PATH) as { suites: Record<string, Record<string, unknown>> };
    const mutated = { ...raw, suites: { ...raw.suites, lint: { ...raw.suites['lint'], status: 'active' } } };
    expect(runnerIds.has('lint')).toBe(false);
    expect(activeWithoutRunner(parseManifest(mutated), runnerIds)).toContain('lint');
  });

  it('every runner entry names a manifest suite', () => {
    expect([...runnerIds].filter((id) => !Object.hasOwn(manifest.suites, id))).toEqual([]);
  });

  it('at least the W0-ACT-1 suites are active (unit, integration, api, catalog-c1-c14, migrations)', () => {
    for (const id of ['unit', 'integration', 'api', 'catalog-c1-c14', 'migrations'])
      expect({ id, status: manifest.suites[id]?.status }).toEqual({ id, status: 'active' });
  });
});

describe('required_cases_pending (D-QA-014)', () => {
  const pending = pendingCases(readJson(MANIFEST_PATH));

  it('lists only active suites, well-formed IDs, an owner and a D-ARCH-082 checkpoint', () => {
    for (const [suite, entries] of Object.entries(pending)) {
      expect({ suite, status: manifest.suites[suite]?.status }).toEqual({ suite, status: 'active' });
      for (const entry of entries) {
        expect(entry.case).toMatch(CASE_ID);
        expect(entry.owner.length).toBeGreaterThan(0);
        expect(CHECKPOINTS.has(entry.checkpoint)).toBe(true);
      }
    }
  });

  it('a pending ID is never also required, and is listed once', () => {
    const seen = new Set<string>();
    for (const [suite, entries] of Object.entries(pending))
      for (const entry of entries) {
        expect(manifest.suites[suite]?.required_cases ?? []).not.toContain(entry.case);
        expect(seen.has(entry.case)).toBe(false);
        seen.add(entry.case);
      }
  });
});
