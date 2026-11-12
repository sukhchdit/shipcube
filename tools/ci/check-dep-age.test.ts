/**
 * check-dep-age (TASK-007): 7-day release cooldown (ADR-0023 am. F item 2, SEC-TC-32/45) and the 18-month
 * freshness/maintenance gate (D-ARCH-003 rev 2 item 6, rev 4 items 3-4; am. J item 4; D-ARCH-042/043; PR1-SEC-12
 * freshness half; PR2-SEC-07 item 3; PR4-SEC-09). Registry data comes from fixtures; the fetch step runs against an
 * injected fake `fetch`, never the network. The clock is fixed.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import type { RegistryTimes } from './check-dep-age.mjs';
import { checkDepAge, fetchRegistryTimes, freshnessReport, loadMaintenance, loadTimes } from './check-dep-age.mjs';
import { loadOverrides } from './check-lockfile.mjs';
import type { Lockfile } from './dep-gates-lib.mjs';
import { findRepoRoot, runNode } from '../test-support/process.js';

const repoRoot = findRepoRoot();
const fixtures = join(repoRoot, 'tools', 'ci', 'fixtures', 'check-dep-age');
const NOW = new Date('2026-11-12T12:00:00Z');
const lock = JSON.parse(readFileSync(join(fixtures, 'lockfile.json'), 'utf8')) as Lockfile;
const times = (): RegistryTimes => loadTimes(JSON.parse(readFileSync(join(fixtures, 'times.json'), 'utf8')));
const maintenance = loadMaintenance(JSON.parse(readFileSync(join(repoRoot, 'tools', 'ci', 'maintenance-exceptions.json'), 'utf8')));
const rules = (result: ReturnType<typeof checkDepAge>) => result.findings.map((f) => f.rule);

describe('release cooldown (SEC-TC-32, SEC-TC-45)', () => {
  it('passes the fixture lockfile with the committed registers', () => {
    expect(checkDepAge(lock, { times: times(), now: NOW, maintenance }).findings).toEqual([]);
  });

  it('[SEC-TC-32] [SEC-TC-45] a version younger than 7 days is rejected', () => {
    const data = times();
    data.versions['fresh-lib@1.0.0'] = { published: '2026-11-08T09:00:00.000Z' };
    const result = checkDepAge(lock, { times: data, now: NOW, maintenance });
    expect(rules(result)).toEqual(['dep-age/cooldown']);
    expect(result.findings[0]?.message).toContain('fresh-lib@1.0.0');
  });

  it('[SEC-TC-32] a version exactly 7 days old passes (boundary)', () => {
    const data = times();
    data.versions['fresh-lib@1.0.0'] = { published: '2026-11-05T12:00:00.000Z' };
    expect(checkDepAge(lock, { times: data, now: NOW, maintenance }).findings).toEqual([]);
  });

  it('[SEC-TC-32] the reference is the earlier lockfile commit time when given', () => {
    const data = times();
    data.versions['fresh-lib@1.0.0'] = { published: '2026-11-05T12:00:00.000Z' };
    expect(checkDepAge(lock, { times: data, now: NOW, maintenance }).findings).toEqual([]);
    const result = checkDepAge(lock, { times: data, now: NOW, cooldownReference: new Date('2026-11-12T00:00:00Z'), maintenance });
    expect(result.findings.map((f) => `${f.rule} ${f.location}`)).toEqual(['dep-age/cooldown node_modules/fresh-lib']);
  });

  it('[SEC-TC-32] a security-fix cooldown override admits the version until it expires', () => {
    const data = times();
    data.versions['fresh-lib@1.0.0'] = { published: '2026-11-10T09:00:00.000Z' };
    const overrides = loadOverrides({
      overrides: [
        {
          package: 'fresh-lib@1.0.0',
          kind: 'cooldown',
          decision: 'D-TEST-002',
          reason: 'security fix',
          granted: '2026-11-10',
          expires: '2026-11-15',
        },
      ],
    });
    expect(checkDepAge(lock, { times: data, now: NOW, maintenance, overrides }).findings).toEqual([]);
    expect(
      rules(checkDepAge(lock, { times: data, now: new Date('2026-11-15T00:00:00Z'), cooldownReference: NOW, maintenance, overrides })),
    ).toEqual(['dep-age/cooldown']);
  });

  it('with a delta scope only the new tuples are checked (PR lane)', () => {
    const data = times();
    data.versions['fresh-lib@1.0.0'] = { published: '2026-11-10T09:00:00.000Z' };
    expect(checkDepAge(lock, { times: data, now: NOW, maintenance, scope: new Set(['size-limit@11.0.0']) }).findings).toEqual([]);
  });

  it('fails closed when the times file lacks a tuple in scope', () => {
    const data = times();
    delete data.versions['fresh-lib@1.0.0'];
    expect(rules(checkDepAge(lock, { times: data, now: NOW, maintenance }))).toEqual(['dep-age/no-data']);
  });
});

describe('freshness and maintenance register (D-ARCH-003 rev 4, am. J item 4)', () => {
  it('[PR1-SEC-06] [PR1-SEC-07] without the register, stale direct bcrypt and deprecated production node-abort-controller fail', () => {
    const result = checkDepAge(lock, { times: times(), now: NOW, maintenance: [] });
    expect(result.findings.map((f) => `${f.rule} ${f.location}`).sort()).toEqual([
      'freshness/deprecated-production node_modules/node-abort-controller',
      'freshness/direct node_modules/bcrypt',
    ]);
  });

  it('[D-ARCH-042] an expired maintenance exception fails (bcrypt on 2027-05-11)', () => {
    const later = new Date('2027-05-11T00:00:00Z');
    const data = times();
    const result = checkDepAge(lock, { times: data, now: later, maintenance });
    expect(result.findings.filter((f) => f.rule === 'maintenance/expired').map((f) => f.message)).toEqual([
      expect.stringContaining('bcrypt@6.0.0 (D-ARCH-042) expired on 2027-05-11'),
    ]);
  });

  it('a deprecated transitive in the production closure that is not registered fails', () => {
    const data = times();
    data.versions['old-polyfill@1.0.0'] = { published: '2025-09-01T09:00:00.000Z', deprecated: 'use the built-in' };
    expect(rules(checkDepAge(lock, { times: data, now: NOW, maintenance }))).toEqual(['freshness/deprecated-production']);
  });

  it('a stale direct dependency fails in the dev closure too', () => {
    const data = times();
    data.packages['size-limit'] = { latest: '11.0.0', latestPublished: '2024-01-01T00:00:00.000Z' };
    expect(rules(checkDepAge(lock, { times: data, now: NOW, maintenance }))).toEqual(['freshness/direct']);
  });

  it('[PR4-SEC-09] [PR2-SEC-07] stale and deprecated dev-only transitives are report-only and listed in the freshness report', () => {
    const result = checkDepAge(lock, { times: times(), now: NOW, maintenance });
    expect(result.findings).toEqual([]);
    expect(result.report.stale.map((r) => r.id)).toEqual(['nanospinner@1.2.2']);
    expect(result.report.deprecatedDev.map((r) => r.id)).toEqual(['whatwg-encoding@3.1.1']);
    const report = freshnessReport(result, maintenance, NOW, 'whole lockfile');
    expect(report).toContain('| `nanospinner@1.2.2` | dev | 1.2.2 | 2024-12-09 |');
    expect(report).toContain('| `bcrypt@6.0.0` | direct-stale | D-ARCH-042 |');
    expect(report).toMatch(/\| `bcrypt@6\.0\.0` .*\| 2027-05-11 \| 179 \|/);
    expect(report).toMatch(/\| `node-abort-controller@3\.1\.1` \| deprecated-transitive \| D-ARCH-043 \|/);
  });

  it('the committed register holds exactly bcrypt@6.0.0 and node-abort-controller@3.1.1 with decisions and expiries', () => {
    expect(maintenance.map((e) => [`${e.name}@${e.version}`, e.kind, e.decision, e.expires, e.via])).toEqual([
      ['bcrypt@6.0.0', 'direct-stale', 'D-ARCH-042', '2027-05-11', ['@platform/api']],
      ['node-abort-controller@3.1.1', 'deprecated-transitive', 'D-ARCH-043', '2027-05-12', ['bullmq']],
    ]);
  });

  it('rejects a register entry without a decision ID or with an unknown kind', () => {
    const base = {
      name: 'a',
      version: '1.0.0',
      kind: 'direct-stale',
      via: ['x'],
      reason: 'r',
      decision: 'D-ARCH-1',
      review_by: 'monthly',
      expires: '2027-01-01',
      exit_criteria: 'e',
    };
    expect(() => loadMaintenance({ exceptions: [{ ...base, decision: 'none' }] })).toThrow(/DECISIONS/);
    expect(() => loadMaintenance({ exceptions: [{ ...base, kind: 'forever' }] })).toThrow(/kind/);
    expect(() => loadMaintenance({ exceptions: [{ ...base, expires: 'someday' }] })).toThrow(/expires/);
  });
});

describe('registry fetch step (CI only; injected transport here)', () => {
  type Call = string;
  const packument = (name: string) => ({
    name,
    'dist-tags': { latest: '2.0.0' },
    time: {
      created: '2020-01-01T00:00:00.000Z',
      modified: '2026-11-01T00:00:00.000Z',
      '1.0.0': '2021-01-01T00:00:00.000Z',
      '2.0.0': '2024-02-02T00:00:00.000Z',
    },
    versions: { '1.0.0': { deprecated: 'old' }, '2.0.0': {} },
  });

  it('[PR1-SEC-12] reads one packument per name, skips @platform names, encodes scopes and extracts times and deprecation', async () => {
    const calls: Call[] = [];
    const fetchImpl = ((url: string | URL | Request) => {
      const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      calls.push(href);
      const name = decodeURIComponent(href.replace('https://registry.npmjs.org/', ''));
      return Promise.resolve(Response.json(packument(name)));
    }) as typeof fetch;
    const out = await fetchRegistryTimes(
      [
        { name: 'a', version: '1.0.0' },
        { name: '@s/b', version: '2.0.0' },
        { name: '@platform/shared', version: '0.0.0' },
      ],
      { fetchImpl, now: NOW, concurrency: 2 },
    );
    expect(calls.sort()).toEqual(['https://registry.npmjs.org/@s%2fb', 'https://registry.npmjs.org/a']);
    expect(out.versions).toEqual({
      'a@1.0.0': { published: '2021-01-01T00:00:00.000Z', deprecated: 'old' },
      '@s/b@2.0.0': { published: '2024-02-02T00:00:00.000Z' },
    });
    expect(out.packages.a).toEqual({ latest: '2.0.0', latestPublished: '2024-02-02T00:00:00.000Z' });
  });

  it('retries a 503 with backoff and fails on a 404 without retrying', async () => {
    let attempts = 0;
    const flaky = (() => {
      attempts += 1;
      return Promise.resolve(attempts < 2 ? new Response('busy', { status: 503 }) : Response.json(packument('a')));
    }) as typeof fetch;
    await fetchRegistryTimes([{ name: 'a', version: '2.0.0' }], { fetchImpl: flaky, retryDelayMs: 1 });
    expect(attempts).toBe(2);
    let missing = 0;
    const gone = (() => {
      missing += 1;
      return Promise.resolve(new Response('nope', { status: 404 }));
    }) as typeof fetch;
    await expect(fetchRegistryTimes([{ name: 'a', version: '2.0.0' }], { fetchImpl: gone, retryDelayMs: 1 })).rejects.toThrow(/HTTP 404/);
    expect(missing).toBe(1);
  });
});

describe('check-dep-age CLI', () => {
  const temp = mkdtempSync(join(tmpdir(), 'check-dep-age-'));
  afterAll(() => rmSync(temp, { recursive: true, force: true }));
  const script = join(repoRoot, 'tools', 'ci', 'check-dep-age.mjs');
  mkdirSync(join(temp, 'tools', 'ci'), { recursive: true });
  writeFileSync(join(temp, 'package.json'), '{"name":"fixture","private":true}\n');
  copyFileSync(join(fixtures, 'lockfile.json'), join(temp, 'package-lock.json'));
  for (const file of ['maintenance-exceptions.json', 'dependency-overrides.json'])
    copyFileSync(join(repoRoot, 'tools', 'ci', file), join(temp, 'tools', 'ci', file));

  it('[PR4-SEC-09] passes the fixture and writes the freshness report listing nanospinner 1.2.2', () => {
    const report = join(temp, 'freshness.md');
    const result = runNode(
      [script, '--root', temp, '--times', join(fixtures, 'times.json'), '--now', '2026-11-12T12:00:00Z', '--report', report],
      { cwd: temp },
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(readFileSync(report, 'utf8')).toContain('`nanospinner@1.2.2`');
  });

  it('[SEC-TC-45] exits 1 on a version younger than 7 days', () => {
    const data = times();
    data.versions['fresh-lib@1.0.0'] = { published: '2026-11-11T00:00:00.000Z' };
    const file = join(temp, 'young.json');
    writeFileSync(file, JSON.stringify(data));
    const result = runNode([script, '--root', temp, '--times', file, '--now', '2026-11-12T12:00:00Z'], { cwd: temp });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^dep-age\/cooldown: fresh-lib@1\.0\.0 was published .* \(node_modules\/fresh-lib\)$/m);
  });

  it('exits 2 without --times and on a malformed times file', () => {
    expect(runNode([script, '--root', temp, '--now', '2026-11-12T12:00:00Z'], { cwd: temp }).status).toBe(2);
    const file = join(temp, 'bad.json');
    writeFileSync(file, '{"schema":"other"}');
    expect(runNode([script, '--root', temp, '--times', file, '--now', '2026-11-12T12:00:00Z'], { cwd: temp }).status).toBe(2);
  });
});
