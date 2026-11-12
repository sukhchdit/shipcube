/**
 * check-audit (TASK-007): US-048 / AT-US-048-06 (Critical/High fail in any closure), AT-US-048-07 (waiver with an
 * expiry; an expired waiver fails again), PR2-SEC-06 (watchlist), D-ARCH-003 rev 4 item 4 (a maintenance-excepted
 * package with a High/Critical advisory fails regardless). Fixtures are hand-written samples in the npm 11 audit
 * report v2 and osv-scanner v2 JSON formats; apart from the three PR2-SEC-06 GHSAs the advisories are synthetic.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { auditMarkdown, checkAudit, fromNpmAudit, fromOsv, loadWatchlist, mergeAdvisories } from './check-audit.mjs';
import { loadMaintenance } from './check-dep-age.mjs';
import type { Lockfile } from './dep-gates-lib.mjs';
import { findRepoRoot, runNode } from '../test-support/process.js';

const repoRoot = findRepoRoot();
const fixtures = join(repoRoot, 'tools', 'ci', 'fixtures', 'check-audit');
const NOW = new Date('2026-11-12T12:00:00Z');
const readFixture = (name: string): unknown => JSON.parse(readFileSync(join(fixtures, name), 'utf8'));
const lock = readFixture('lockfile.json') as Lockfile;
const committed = loadWatchlist(JSON.parse(readFileSync(join(repoRoot, 'tools', 'ci', 'advisory-watchlist.json'), 'utf8')));
const maintenance = loadMaintenance(JSON.parse(readFileSync(join(repoRoot, 'tools', 'ci', 'maintenance-exceptions.json'), 'utf8')));
const clean = () => mergeAdvisories(fromNpmAudit(readFixture('npm-audit.clean.json'), lock));
const high = () => mergeAdvisories(fromNpmAudit(readFixture('npm-audit.high.json'), lock));
const waiver = (id: string, pkg: string, expires: string) => ({
  id,
  package: pkg,
  reason: 'tracked upstream',
  decision: 'D-TEST-003',
  expires,
});

describe('advisory normalisation', () => {
  it('reads npm audit v2: advisories from object `via` entries only, closure from `nodes`', () => {
    expect(clean().map((a) => [a.id, a.package, a.severity, a.production, a.fixAvailable])).toEqual([
      ['GHSA-3g3m-2fjr-6pw4', 'glob', 'moderate', false, true],
      ['GHSA-g3hv-75wg-m249', 'minimatch', 'moderate', false, true],
      ['GHSA-gcqx-w48m-w2h4', 'deepmerge', 'low', false, false],
    ]);
  });

  it('reads osv-scanner v2, rates by GHSA severity or the group CVSS score, and merges with npm audit by GHSA', () => {
    const osv = fromOsv(readFixture('osv.json'), lock);
    expect(osv.map((a) => [a.id, a.package, a.severity, a.production, a.fixAvailable])).toEqual([
      ['GHSA-g3hv-75wg-m249', 'minimatch', 'moderate', false, true],
      ['GHSA-hjrf-2m68-5959', 'bcrypt', 'high', true, false],
    ]);
    const merged = mergeAdvisories([...fromNpmAudit(readFixture('npm-audit.clean.json'), lock), ...osv]);
    expect(merged.find((a) => a.package === 'minimatch')?.sources).toEqual(['npm audit', 'osv-scanner']);
  });

  it('rejects input that is not an npm audit v2 report or osv-scanner JSON (exit 2 path)', () => {
    expect(() => fromNpmAudit({ auditReportVersion: 1, advisories: {} }, lock)).toThrow(/auditReportVersion 2/);
    expect(() => fromOsv({ vulns: [] }, lock)).toThrow(/results/);
  });
});

describe('gating', () => {
  it('[PR2-SEC-06] the committed watchlist reports the three dev-only GHSAs as watched and passes', () => {
    const result = checkAudit(clean(), { ...committed, maintenance, now: NOW });
    expect(result.findings).toEqual([]);
    expect(result.notes.filter((n) => n.rule === 'audit/watched').map((n) => n.message.split(' ')[0])).toEqual([
      'GHSA-3g3m-2fjr-6pw4',
      'GHSA-g3hv-75wg-m249',
      'GHSA-gcqx-w48m-w2h4',
    ]);
    expect(committed.watch.map((w) => w.id).sort()).toEqual(['GHSA-3g3m-2fjr-6pw4', 'GHSA-g3hv-75wg-m249', 'GHSA-gcqx-w48m-w2h4']);
    expect(committed.waivers).toEqual([]);
  });

  it('[AT-US-048-06] a High vulnerability with a fix (production) and a Critical (dev) fail; moderates in production are highlighted', () => {
    const result = checkAudit(high(), { ...committed, maintenance, now: NOW });
    expect(result.findings.map((f) => `${f.rule} ${f.message.split(':')[0]}`)).toEqual([
      'audit/high GHSA-f5x3-32g6-xq36 tar-legacy (critical, dev closure, no fix)',
      'audit/high GHSA-rhx6-c78j-4q9w path-to-regexp (high, production closure, fix available)',
    ]);
    expect(result.notes.map((n) => n.rule)).toContain('audit/production-moderate');
  });

  it('[AT-US-048-07] a waiver with a future expiry passes the finding and tracks its due date', () => {
    const waivers = [
      waiver('GHSA-f5x3-32g6-xq36', 'tar-legacy', '2026-12-31'),
      waiver('GHSA-rhx6-c78j-4q9w', 'path-to-regexp', '2026-11-30'),
    ];
    const result = checkAudit(high(), { watch: [], waivers, now: NOW });
    expect(result.findings).toEqual([]);
    expect(result.notes.filter((n) => n.rule === 'audit/waived').map((n) => n.message)).toEqual([
      expect.stringContaining('due 2026-12-31 (48 days)'),
      expect.stringContaining('due 2026-11-30'),
    ]);
  });

  it('[AT-US-048-07] a waiver with a past expiry date fails the finding again', () => {
    const result = checkAudit(high(), { watch: [], waivers: [waiver('GHSA-f5x3-32g6-xq36', 'tar-legacy', '2026-11-01')], now: NOW });
    expect(result.findings.map((f) => f.rule).sort()).toEqual(['audit/high', 'audit/waiver-expired']);
  });

  it('[D-ARCH-003 rev 4] a High advisory on a maintenance-excepted package fails even with a waiver', () => {
    const advisories = mergeAdvisories(fromOsv(readFixture('osv.json'), lock));
    const result = checkAudit(advisories, {
      watch: [],
      waivers: [waiver('GHSA-hjrf-2m68-5959', 'bcrypt', '2027-01-01')],
      maintenance,
      now: NOW,
    });
    expect(result.findings.map((f) => f.rule)).toEqual(['audit/maintenance-exception']);
  });

  it('a watch entry never waives a re-rated High advisory', () => {
    const advisories = clean().map((a) => (a.package === 'glob' ? { ...a, severity: 'high' as const } : a));
    expect(checkAudit(advisories, { ...committed, now: NOW }).findings.map((f) => f.rule)).toEqual(['audit/high']);
  });

  it('a watch entry past its review date is reported for review', () => {
    expect(checkAudit(clean(), { ...committed, now: new Date('2027-03-01T00:00:00Z') }).notes.map((n) => n.rule)).toContain(
      'audit/watch-review-due',
    );
  });

  it('renders a Markdown summary with counts and closures', () => {
    const advisories = high();
    const markdown = auditMarkdown(advisories, checkAudit(advisories, { now: NOW }));
    expect(markdown).toContain('critical 1 · high 1 · moderate 1');
    expect(markdown).toContain('| GHSA-rhx6-c78j-4q9w | `path-to-regexp` | high | **production** | yes |');
  });
});

describe('check-audit CLI', () => {
  const temp = mkdtempSync(join(tmpdir(), 'check-audit-'));
  afterAll(() => rmSync(temp, { recursive: true, force: true }));
  const script = join(repoRoot, 'tools', 'ci', 'check-audit.mjs');
  mkdirSync(join(temp, 'tools', 'ci'), { recursive: true });
  writeFileSync(join(temp, 'package.json'), '{"name":"fixture","private":true}\n');
  copyFileSync(join(fixtures, 'lockfile.json'), join(temp, 'package-lock.json'));
  for (const file of ['advisory-watchlist.json', 'maintenance-exceptions.json'])
    copyFileSync(join(repoRoot, 'tools', 'ci', file), join(temp, 'tools', 'ci', file));

  it('[PR2-SEC-06] exits 0 on the clean report plus osv minimatch only', () => {
    const result = runNode([script, '--root', temp, '--npm-audit', join(fixtures, 'npm-audit.clean.json'), '--now', '2026-11-12'], {
      cwd: temp,
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('note audit/watched: GHSA-g3hv-75wg-m249');
  });

  it('[AT-US-048-06] exits 1 on High/Critical findings from npm audit and osv-scanner', () => {
    const result = runNode(
      [
        script,
        '--root',
        temp,
        '--npm-audit',
        join(fixtures, 'npm-audit.high.json'),
        '--osv',
        join(fixtures, 'osv.json'),
        '--now',
        '2026-11-12',
      ],
      { cwd: temp },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^audit\/maintenance-exception: GHSA-hjrf-2m68-5959 bcrypt/m);
    expect(result.stderr).toMatch(/^audit\/high: GHSA-rhx6-c78j-4q9w path-to-regexp/m);
  });

  it('exits 2 without --npm-audit', () => {
    expect(runNode([script, '--root', temp], { cwd: temp }).status).toBe(2);
  });
});
