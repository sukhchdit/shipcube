/**
 * check-lockfile (TASK-007): ADR-0023 am. F item 3, am. I item 7, am. J item 1 (b); D-ARCH-040; PR1-SEC-13; R2-n4;
 * SEC-TC-45 / AT-US-048 (non-registry entry fails lane A). Pure core against fixtures; the CLI against the real
 * repository lockfile (positive control) and a temporary root (exit codes).
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { checkLockfile, deltaMarkdown, lockfileDelta, loadOverrides } from './check-lockfile.mjs';
import type { Lockfile, LockEntry } from './dep-gates-lib.mjs';
import { readBaseLockfile } from './dep-gates-lib.mjs';
import { findRepoRoot, runNode } from '../test-support/process.js';

const repoRoot = findRepoRoot();
const fixtures = join(repoRoot, 'tools', 'ci', 'fixtures', 'check-lockfile');
const NOW = new Date('2026-11-12T12:00:00Z');

const good = (): Lockfile => JSON.parse(readFileSync(join(fixtures, 'good.lockfile.json'), 'utf8')) as Lockfile;
const negatives = JSON.parse(readFileSync(join(fixtures, 'negative.json'), 'utf8')) as Record<
  string,
  { rules: string[]; packages: Record<string, LockEntry> } | string
>;
const withPackages = (packages: Record<string, LockEntry>): Lockfile => {
  const lock = good();
  return { ...lock, packages: { ...lock.packages, ...packages } };
};
const rulesOf = (lock: Lockfile, options: Parameters<typeof checkLockfile>[1] = { now: NOW }) =>
  checkLockfile(lock, options).findings.map((f) => f.rule);

describe('check-lockfile provenance and @platform rules', () => {
  it('passes the positive fixture (workspace links, alias, bundled entry)', () => {
    expect(checkLockfile(good(), { now: NOW }).findings).toEqual([]);
  });

  for (const [title, fixture] of Object.entries(negatives)) {
    if (typeof fixture === 'string') continue;
    it(`[${title}] fails with ${fixture.rules.join(', ')}`, () => {
      const rules = rulesOf(withPackages(fixture.packages));
      for (const rule of fixture.rules) expect(rules).toContain(rule);
    });
  }

  it('[PR1-SEC-13] a non-link entry whose key path contains node_modules/@platform/ fails even when nested', () => {
    const rules = rulesOf(
      withPackages({
        'node_modules/left-pad/node_modules/@platform/shared': {
          version: '0.0.0',
          resolved: 'https://registry.npmjs.org/@platform/shared/-/shared-0.0.0.tgz',
          integrity: good().packages?.['node_modules/is-number']?.integrity ?? '',
        },
      }),
    );
    expect(rules).toEqual(expect.arrayContaining(['platform/non-link', 'platform/resolved']));
  });

  it('[R2-n4] workspace link entries carry resolved = workspace directory and pass (npm lockfile v3 shape)', () => {
    const lock = good();
    expect(lock.packages?.['node_modules/@platform/shared']).toEqual({ resolved: 'packages/shared', link: true });
    expect(rulesOf(lock)).toEqual([]);
  });

  it('rejects a lockfile that is not version 3', () => {
    expect(rulesOf({ ...good(), lockfileVersion: 2 })).toContain('lockfile/version');
  });

  it('[SEC-TC-45] a registered, unexpired source override admits the entry; an expired one fails', () => {
    const fixture = negatives['SEC-TC-45 https tarball outside the registry'];
    if (typeof fixture !== 'object') throw new Error('fixture missing');
    const resolved = fixture.packages['node_modules/is-number']?.resolved;
    const overrides = loadOverrides({
      overrides: [
        {
          package: 'is-number@7.0.0',
          kind: 'source',
          resolved,
          decision: 'D-TEST-001',
          reason: 'test',
          granted: '2026-11-01',
          expires: '2026-11-20',
        },
      ],
    });
    expect(rulesOf(withPackages(fixture.packages), { overrides, now: NOW })).toEqual([]);
    expect(rulesOf(withPackages(fixture.packages), { overrides, now: new Date('2026-11-20T00:00:00Z') })).toContain('overrides/expired');
  });

  it('rejects overrides without a decision or with an expiry beyond 30 days (am. F item 2)', () => {
    expect(() =>
      loadOverrides({ overrides: [{ package: 'a@1.0.0', kind: 'cooldown', reason: 'r', granted: '2026-11-01', expires: '2026-11-02' }] }),
    ).toThrow(/decision/);
    expect(() =>
      loadOverrides({
        overrides: [{ package: 'a@1.0.0', kind: 'cooldown', decision: 'D-X-1', reason: 'r', granted: '2026-11-01', expires: '2026-12-15' }],
      }),
    ).toThrow(/30 days/);
    expect(() =>
      loadOverrides({
        overrides: [{ package: 'a', kind: 'cooldown', decision: 'D-X-1', reason: 'r', granted: '2026-11-01', expires: '2026-11-02' }],
      }),
    ).toThrow(/name@version/);
  });

  it('the committed dependency-overrides.json is valid and empty', () => {
    expect(loadOverrides(JSON.parse(readFileSync(join(repoRoot, 'tools', 'ci', 'dependency-overrides.json'), 'utf8')))).toEqual([]);
  });
});

describe('check-lockfile delta summary (PR1-SEC-13 remediation)', () => {
  it('reports new tuples, integrity changes and moves into the production closure', () => {
    const base = good();
    const head = good();
    const packages = head.packages ?? {};
    packages['node_modules/left-pad'] = { ...packages['node_modules/left-pad'], dev: false };
    packages['node_modules/is-number'] = { ...packages['node_modules/is-number'], integrity: `sha512-${'A'.repeat(86)}==` };
    packages['node_modules/new-dep'] = {
      version: '2.0.0',
      resolved: 'https://registry.npmjs.org/new-dep/-/new-dep-2.0.0.tgz',
      integrity: `sha512-${'B'.repeat(86)}==`,
    };
    const delta = lockfileDelta(base, head);
    expect(delta.added).toEqual([{ id: 'new-dep@2.0.0', production: true }]);
    expect(delta.integrityChanged.map((c) => c.id)).toEqual(['is-number@7.0.0']);
    expect(delta.movedToProduction).toEqual(['left-pad@1.3.0']);
    const markdown = deltaMarkdown(delta, 'origin/main');
    expect(markdown).toContain('`new-dep@2.0.0` | **production**');
    expect(markdown).toContain('moved into the production closure: **1**');
  });

  it('refuses a --base value shaped like an option (no git option injection)', () => {
    expect(() => readBaseLockfile(repoRoot, '--output=x')).toThrow(/invalid git ref/);
  });
});

describe('check-lockfile CLI', () => {
  const temp = mkdtempSync(join(tmpdir(), 'check-lockfile-'));
  afterAll(() => rmSync(temp, { recursive: true, force: true }));

  it('passes on the real repository lockfile (positive control)', () => {
    const result = runNode([join(repoRoot, 'tools', 'ci', 'check-lockfile.mjs'), '--root', repoRoot], { cwd: repoRoot });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('[SEC-TC-45] exits 1 and names the rule for a non-registry entry; --json and --summary are written', () => {
    const fixture = negatives['SEC-TC-45 git source'];
    if (typeof fixture !== 'object') throw new Error('fixture missing');
    mkdirSync(join(temp, 'tools', 'ci'), { recursive: true });
    writeFileSync(join(temp, 'package.json'), '{"name":"fixture","private":true}\n');
    writeFileSync(join(temp, 'package-lock.json'), JSON.stringify(withPackages(fixture.packages)));
    copyFileSync(join(repoRoot, 'tools', 'ci', 'dependency-overrides.json'), join(temp, 'tools', 'ci', 'dependency-overrides.json'));
    const summary = join(temp, 'summary.md');
    const result = runNode([join(repoRoot, 'tools', 'ci', 'check-lockfile.mjs'), '--root', temp, '--summary', summary], { cwd: temp });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^lockfile\/non-registry: git source: git\+ssh:.* \(node_modules\/is-number\)$/m);
    expect(readFileSync(summary, 'utf8')).toContain('check-lockfile: FAIL');
    const json = runNode([join(repoRoot, 'tools', 'ci', 'check-lockfile.mjs'), '--root', temp, '--json'], { cwd: temp });
    expect((JSON.parse(json.stdout) as { pass: boolean }).pass).toBe(false);
  });

  it('exits 2 on a usage error', () => {
    const result = runNode([join(repoRoot, 'tools', 'ci', 'check-lockfile.mjs'), '--unknown'], { cwd: repoRoot });
    expect(result.status).toBe(2);
  });
});
