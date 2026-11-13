/**
 * Suite `sec-static` (TASK-007): US-048 acceptance tests AT-US-048-01..07, wired to the lane A gates through their
 * exported functions: the Gitleaks configuration (.gitleaks.toml), the .env.example parity checks (tools/config), the
 * configuration loader (@platform/config), check-audit and licence-check (TASK-007 dependency gates) and the Semgrep runner.
 *
 * Trivy image scanning and the CycloneDX SBOM belong to lane C's `images` job (TASK-015) and are not asserted here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { ConfigValidationError, loadConfig } from '@platform/config';
import { createTestEnv } from '@platform/config/testing';

import { checkEnvExampleParity } from '../config/env-file.js';
import { findRepoRoot } from '../test-support/process.js';
import { checkAudit } from './check-audit.mjs';
import { checkLicences } from './licence-check.mjs';

const repoRoot = findRepoRoot();
const read = (...parts: string[]) => readFileSync(join(repoRoot, ...parts), 'utf8');
const ciText = read('.github', 'workflows', 'ci.yml');
const gitleaks = read('.gitleaks.toml');
const envExample = read('.env.example');
const NOW = new Date('2026-11-12T12:00:00Z');

/** The `[[allowlists]]` tables of .gitleaks.toml as raw text blocks. */
const allowlists = gitleaks.split(/^\[\[allowlists\]\]\s*$/m).slice(1);
/** Literal ('''…''') strings of one TOML key inside a block. */
function literals(block: string, key: string): string[] {
  const match = new RegExp(`^${key}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*$`, 'm').exec(block);
  return [...(match?.[1] ?? '').matchAll(/'''(.*?)'''/g)].map((m) => m[1] ?? '');
}

/** A random AWS-access-key-shaped value, generated at run time (never committed). */
const awsKeyShaped = () =>
  `AKIA${Array.from({ length: 16 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.charAt(Math.floor(Math.random() * 32))).join('')}`;

const advisory = (overrides: Partial<Parameters<typeof checkAudit>[0][number]>) => ({
  id: 'GHSA-aaaa-bbbb-cccc',
  package: 'fixture-pkg',
  severity: 'high' as const,
  title: 'fixture advisory',
  fixAvailable: true,
  production: true,
  sources: ['npm-audit'],
  ...overrides,
});

const licenceLock = (licence: string) => ({
  lockfileVersion: 3,
  packages: {
    '': { name: 'fixture-root', dependencies: { 'fixture-pkg': '1.0.0' } },
    'node_modules/fixture-pkg': {
      version: '1.0.0',
      resolved: 'https://registry.npmjs.org/fixture-pkg/-/fixture-pkg-1.0.0.tgz',
      integrity: 'sha512-AAAA',
      license: licence,
    },
  },
});

describe('sec-static: US-048 secrets hygiene and CI security scanning', () => {
  it('AT-US-048-01 (lane A part): the security stage runs Gitleaks, npm audit + osv-scanner, licence check and Semgrep, each as a gate (Trivy and the SBOM are lane C, TASK-015)', () => {
    for (const gate of [
      '"$GITLEAKS_IMAGE"',
      '"$OSV_SCANNER_IMAGE"',
      'npm audit --json',
      '"$GATE_CHECK_AUDIT"',
      '"$GATE_LICENCE_CHECK"',
      '"$GATE_RUN_SEMGREP"',
    ]) {
      expect(ciText).toContain(gate);
    }
    expect(ciText).toMatch(/--exit-code 1/);
    expect(checkAudit([], { watch: [], waivers: [], now: NOW }).findings).toEqual([]);
    expect(checkLicences(licenceLock('MIT')).findings).toEqual([]);
  });

  it('AT-US-048-02: a config key missing from .env.example fails, naming the key', () => {
    const withoutKey = envExample.replace(/^APP_PORT=.*$/m, '');
    expect(checkEnvExampleParity(withoutKey).missing).toEqual(['APP_PORT']);
  });

  it('AT-US-048-03: .env.example contains only placeholder values', () => {
    const report = checkEnvExampleParity(envExample);
    expect(report.secretLookingValues).toEqual([]);
    expect(report.secretsWithoutPlaceholder).toEqual([]);
  });

  it('AT-US-048-04: Gitleaks keeps its default rules, every allowlist is path AND line scoped, and none admits an AWS-key-shaped value; lane A scans the PR commit range and fails on a finding', () => {
    expect(gitleaks).toMatch(/^\[extend\]\s*\nuseDefault = true$/m);
    expect(gitleaks).not.toMatch(/^\[allowlist\]$/m);
    expect(allowlists.length).toBeGreaterThan(0);
    const leak = `aws_access_key_id = ${awsKeyShaped()}`;
    for (const block of allowlists) {
      expect(block).toMatch(/^condition = "AND"$/m);
      expect(literals(block, 'paths').length).toBeGreaterThan(0);
      const regexes = literals(block, 'regexes');
      expect(regexes.length).toBeGreaterThan(0);
      for (const source of regexes) expect(new RegExp(source).test(`  ${leak}`)).toBe(false);
      for (const source of literals(block, 'paths')) expect(new RegExp(source).test('apps/api/src/config.ts')).toBe(false);
    }
    // PR10-SEC-01: .git-only mount, inline markers inert, merge commits diffed against their first parent.
    expect(ciText).toContain('-v "$GITHUB_WORKSPACE/.git:/repo/.git:ro"');
    expect(ciText).toMatch(
      /git \/repo --config \/config\/gitleaks\.toml \\\n\s+--log-opts="--diff-merges=first-parent \$range" --ignore-gitleaks-allow \\\n\s+--redact --no-banner --exit-code 1/,
    );
  });

  it('PR10-SEC-08: no allowlist path admits the OpenAPI contract (its EXAMPLE_ markers need none), so secret-shaped examples fail', () => {
    const contract = 'docs/03-architecture/api/openapi.yaml';
    for (const block of allowlists) {
      for (const source of literals(block, 'paths')) expect(new RegExp(source).test(contract)).toBe(false);
    }
    expect(gitleaks).not.toContain('PR1-SEC-11 OpenAPI');
  });

  it('[PR25-SEC-01] lane A gitleaks neither mounts nor references the baseline, a .gitleaksignore or an ignore-path flag', () => {
    const start = ciText.indexOf('- name: Gitleaks (PR commit range)');
    expect(start).toBeGreaterThan(-1);
    const next = ciText.indexOf('- name:', start + 1);
    const step = ciText.slice(start, next === -1 ? undefined : next);
    expect(step).toContain('"$GITLEAKS_IMAGE" git /repo');
    const forbidden = /gitleaksignore|gitleaks-baseline|--gitleaks-ignore-path|\s-i[\s=]/u;
    expect(step).not.toMatch(forbidden);
    expect(step.match(/-v "/gu)).toHaveLength(2);
    // Mutation: a step that mounts the baseline is caught by the same pin.
    const mutated = step.replace('--ignore-gitleaks-allow', '--ignore-gitleaks-allow --gitleaks-ignore-path /b/.gitleaksignore');
    expect(mutated).toMatch(forbidden);
  });

  it('[PR25-SEC-01] the gitleaks-full baseline holds exactly the 17 recorded fingerprints and nothing else', () => {
    const lines = read('tools', 'quality', 'gitleaks-baseline.txt')
      .split(/\r?\n/u)
      .filter((line) => line !== '' && !line.startsWith('#'));
    expect(lines).toHaveLength(17);
    for (const line of lines) expect(line).toMatch(/^[0-9a-f]{40}:[^:\s]+:generic-api-key:[1-9]\d*$/u);
    expect(new Set(lines).size).toBe(17);
    expect([...new Set(lines.map((line) => line.slice(0, 7)))].sort()).toEqual(['63accea', 'b8f805f', 'd5cdfa2']);
    expect(lines.filter((line) => line.includes(':docs/03-architecture/api/openapi.yaml:'))).toHaveLength(15);
  });

  it('D-ORCH-027: Dependabot ignores TypeScript semver-major (ADR-0001 pin ~6.0.3, TS 7 deferred) and keeps the cooldown', () => {
    const dependabot = read('.github', 'dependabot.yml');
    expect(dependabot).toMatch(/- dependency-name: typescript\n\s+update-types: \['version-update:semver-major'\]/);
    expect(dependabot.match(/cooldown:\n\s+default-days: 7/g)).toHaveLength(2);
  });

  it('AT-US-048-05: with APP_ENV=production and a placeholder JWT signing key, start-up fails naming JWT_SIGNING_KEYS only (the ES256 successor of JWT_SECRET)', () => {
    const env = { ...createTestEnv({ appEnv: 'production' }), JWT_SIGNING_KEYS: 'jwt-signing-v1:CHANGE_ME' };
    let caught: unknown;
    try {
      loadConfig(env, { service: 'api' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
    const error = caught as ConfigValidationError;
    expect(error.issues).toContainEqual(expect.objectContaining({ key: 'JWT_SIGNING_KEYS', code: 'placeholder' }));
    expect(error.message).not.toContain('CHANGE_ME');
  });

  it('AT-US-048-06-1: a High vulnerability with a fix available fails', () => {
    expect(checkAudit([advisory({})], { watch: [], waivers: [], now: NOW }).findings.map((f) => f.rule)).toContain('audit/high');
  });

  it('AT-US-048-06-2: a Critical vulnerability with no fix fails until it is tracked with a dated waiver, then passes and reports its due date', () => {
    const critical = advisory({ id: 'GHSA-dddd-eeee-ffff', severity: 'critical', fixAvailable: false });
    expect(checkAudit([critical], { watch: [], waivers: [], now: NOW }).findings).not.toEqual([]);
    const waiver = {
      id: critical.id,
      package: critical.package,
      reason: 'no fix upstream',
      decision: 'D-SEC-FIXTURE',
      granted: '2026-11-01',
      expires: '2026-12-31',
    };
    const tracked = checkAudit([critical], { watch: [], waivers: [waiver], now: NOW });
    expect(tracked.findings).toEqual([]);
    expect(tracked.notes.some((note) => note.rule === 'audit/waived' && note.message.includes('2026-12-31'))).toBe(true);
  });

  it('AT-US-048-06-3: a GPL-3.0 licence fails', () => {
    expect(checkLicences(licenceLock('GPL-3.0')).findings).not.toEqual([]);
  });

  it('AT-US-048-06-4: an MIT licence passes', () => {
    expect(checkLicences(licenceLock('MIT')).findings).toEqual([]);
  });

  it('AT-US-048-07: a waiver with a past expiry date fails the finding again', () => {
    const waiver = {
      id: 'GHSA-aaaa-bbbb-cccc',
      package: 'fixture-pkg',
      reason: 'temporary',
      decision: 'D-SEC-FIXTURE',
      granted: '2026-10-01',
      expires: '2026-11-01',
    };
    expect(checkAudit([advisory({})], { watch: [], waivers: [waiver], now: NOW }).findings.map((f) => f.rule)).toContain(
      'audit/waiver-expired',
    );
  });
});
