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
import { isMap, parseYamlSubset } from './yaml-subset.mjs';

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

/** A finding as gitleaks' global allowlists see it (git mode): commit, path, rule id and the full flagged line. */
interface GitleaksFinding {
  commit: string;
  path: string;
  rule: string;
  line: string;
}
/**
 * Gitleaks v8 `[[allowlists]]` semantics for the keys this config uses (every block is `condition = "AND"` with
 * `regexTarget = "line"`, asserted below): `targetRules` scopes the entry to those rules; then every present check must
 * hold (the commit equals one of `commits`, a `paths` regex matches the path, a `regexes` regex matches the full line).
 * The pinned gitleaks image gave the same decisions over the real commit (D-ORCH-068 reproduction in the PR record).
 */
function allowedBy(block: string, finding: GitleaksFinding): boolean {
  const targetRules = literals(block, 'targetRules');
  if (targetRules.length > 0 && !targetRules.includes(finding.rule)) return false;
  const commits = literals(block, 'commits');
  return (
    (commits.length === 0 || commits.includes(finding.commit)) &&
    literals(block, 'paths').some((source) => new RegExp(source).test(finding.path)) &&
    literals(block, 'regexes').some((source) => new RegExp(source).test(finding.line))
  );
}
const allowedByAny = (finding: GitleaksFinding) => allowlists.some((block) => allowedBy(block, finding));
/** A random `effect/<Name>` module-namespace string, generated at run time (never committed). */
const effectNamespaced = () =>
  `effect/${Array.from({ length: 12 + Math.floor(Math.random() * 12) }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.charAt(Math.floor(Math.random() * 52))).join('')}`;

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
      '"${GATE_CHECK_AUDIT:?}"',
      '"${GATE_LICENCE_CHECK:?}"',
      '"${GATE_RUN_SEMGREP:?}"',
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

  it('[PR25-SEC-01] the gitleaks-full baseline holds exactly the 22 recorded fingerprints and nothing else', () => {
    const lines = read('tools', 'quality', 'gitleaks-baseline.txt')
      .split(/\r?\n/u)
      .filter((line) => line !== '' && !line.startsWith('#'));
    expect(lines).toHaveLength(22);
    for (const line of lines) expect(line).toMatch(/^[0-9a-f]{40}:[^:\s]+:generic-api-key:[1-9]\d*$/u);
    expect(new Set(lines).size).toBe(22);
    expect([...new Set(lines.map((line) => line.slice(0, 7)))].sort()).toEqual([
      '0ccdd00',
      '63accea',
      'aade267',
      'b8f805f',
      'c33e5e9',
      'd5cdfa2',
      'd7585e7',
      'ed15691',
    ]);
    expect(lines.filter((line) => line.includes(':docs/03-architecture/api/openapi.yaml:'))).toHaveLength(15);
    // PR080-SEC-07 (D-SECPR080-03, D-ORCH-168): exactly these two commit-bound fingerprints, never a path-only entry.
    expect(lines.filter((line) => /^(d7585e7|ed15691)/u.test(line))).toEqual([
      'd7585e78786e01bf772609d44f1f923203e58c5e:docs/sdlc/DECISIONS.md:generic-api-key:7697',
      'ed156913c734f0bc18945e7e7172fc4666331ad2:.claude/agent-memory/security-analyst/project_p5_task051.md:generic-api-key:23',
    ]);
    // PR080-SEC-07 branch-only merges (D-DEVOPS-001/-002): TASK-044, 040-B and 041-B, one exact line each.
    expect(lines.filter((line) => /^(c33e5e9|0ccdd00|aade267)/u.test(line))).toEqual([
      'c33e5e927f903847daf59ca5f2aa5440562401ef:docs/sdlc/DECISIONS.md:generic-api-key:7697',
      '0ccdd009acfe4eab53adb2bb69064aa0d537a6d9:docs/sdlc/DECISIONS.md:generic-api-key:7697',
      'aade267273af4bb868a4e4c4578aeb4f7378a261:docs/sdlc/DECISIONS.md:generic-api-key:7697',
    ]);
  });

  const PR39_COMMIT = 'dd7a2ddcad30ba422152300f21d7df5f105d283e';
  const PR39_PATH = 'tools/docker/scan-image-secrets.mjs';
  /**
   * Why a commit-bound block is not exact: one full SHA, one rule, one anchored path, anchored full-line regexes. A line
   * pattern starts `^\n?` because gitleaks' git-mode line target carries the preceding newline (bare `^` never matched
   * with the pinned image) and ends `$`.
   */
  function commitBoundViolations(block: string): string[] {
    const out: string[] = [];
    const commits = literals(block, 'commits');
    if (commits.length !== 1 || !/^[0-9a-f]{40}$/u.test(commits[0] ?? '')) out.push('commits: exactly one full 40-hex SHA');
    if (literals(block, 'targetRules').length !== 1) out.push('targetRules: exactly one rule');
    const paths = literals(block, 'paths');
    if (paths.length !== 1 || !paths.every((p) => p.startsWith('^') && p.endsWith('$'))) out.push('paths: one anchored path');
    const regexes = literals(block, 'regexes');
    if (regexes.length === 0 || !regexes.every((r) => r.startsWith('^\\n?') && !r.startsWith('^\\n?.') && r.endsWith('$')))
      out.push('regexes: anchored full lines');
    return out;
  }

  it('[D-ORCH-068] .gitleaks.toml holds exactly the two reviewed allowlists; a commit-bound entry names one full SHA, one rule, one anchored path and anchored full-line patterns', () => {
    // Deliberate shape pin: a new allowlist (or a widened one) changes this test and needs its own security review.
    const descriptions = allowlists.map((block) => /^description = "(.*)"$/mu.exec(block)?.[1]);
    expect(descriptions).toEqual(['PR1-SEC-11 agent docs prose', 'D-ORCH-068 PR #39 dd7a2dd effect symbol-key comment']);
    for (const block of allowlists) {
      expect(block).toMatch(/^condition = "AND"$/m);
      expect(block).toMatch(/^regexTarget = "line"$/m);
      if (literals(block, 'commits').length > 0) expect(commitBoundViolations(block)).toEqual([]);
    }
    const entry = allowlists[1] ?? '';
    expect(literals(entry, 'commits')).toEqual([PR39_COMMIT]);
    expect(literals(entry, 'targetRules')).toEqual(['generic-api-key']);
    expect(literals(entry, 'paths')).toEqual(['^tools/docker/scan-image-secrets\\.mjs$']);
    expect(literals(entry, 'regexes')).toHaveLength(2);
    // The exact fingerprints are recorded next to the entry (values are never quoted).
    expect(gitleaks).toContain(`${PR39_COMMIT}:${PR39_PATH}:generic-api-key:272 and :273`);
    // Mutations: dropping the commit, the rule scope or an anchor is refused by the same guard.
    const dropRule = entry.replace(/^targetRules = .*$/mu, '');
    const shortSha = entry.replace(PR39_COMMIT, PR39_COMMIT.slice(0, 7));
    const unanchoredPath = entry.replace("'''^tools/docker/scan-image-secrets\\.mjs$'''", "'''scan-image-secrets'''");
    const twoCommits = entry.replace(`'''${PR39_COMMIT}'''`, `'''${PR39_COMMIT}''', '''${'0'.repeat(40)}'''`);
    const unanchoredLine = entry.replace("'''^\\n?  // effect", "'''  // effect");
    const openEndedLine = entry.replace("src copies\\.$'''", "src copies'''");
    for (const mutated of [dropRule, shortSha, unanchoredPath, twoCommits, unanchoredLine, openEndedLine]) {
      expect(mutated).not.toBe(entry);
      expect(commitBoundViolations(mutated)).not.toEqual([]);
    }
  });

  it('[D-ORCH-068] the dd7a2dd entry admits only the two flagged comment lines at that commit, path and rule; any other commit, path, rule or line is still reported (negative controls)', () => {
    const line272 = (value: string) => `  // effect 3.20.0 (a dependency of @prisma/config): \`IntervalSymbolKey = "${value}"\` and`;
    const line273 = (value: string) => `  // \`IntervalsSymbolKey = "${value}"\`, in the cjs, esm and src copies.`;
    const at = (line: string, over: Partial<GitleaksFinding> = {}): GitleaksFinding => ({
      commit: PR39_COMMIT,
      path: PR39_PATH,
      rule: 'generic-api-key',
      line,
      ...over,
    });
    // Both forms of the line target: as gitleaks hands it over (preceding newline included) and bare.
    for (const line of [line272(effectNamespaced()), line273(effectNamespaced())]) {
      expect(allowedByAny(at(`\n${line}`))).toBe(true);
      expect(allowedByAny(at(line))).toBe(true);
    }

    const flagged = line272(effectNamespaced());
    const controls: Record<string, GitleaksFinding> = {
      'same line, the follow-up commit': at(flagged, { commit: 'f'.repeat(40) }),
      'same line, abbreviated SHA': at(flagged, { commit: PR39_COMMIT.slice(0, 7) }),
      'same line, the test file': at(flagged, { path: 'tools/docker/scan-image-secrets.test.ts' }),
      'same line, a nested copy of the path': at(flagged, { path: `apps/api/${PR39_PATH}` }),
      'same line, a suffixed path': at(flagged, { path: `${PR39_PATH}.bak` }),
      'same line, another rule': at(flagged, { rule: 'aws-access-token' }),
      'another line: an api key assignment': at(`const apiKey = "${awsKeyShaped()}";`),
      'another line: the comment holding an AWS-shaped value': at(line272(awsKeyShaped())),
      'another line: the second comment holding an AWS-shaped value': at(line273(awsKeyShaped())),
      'another line: a secret appended to the comment': at(`${flagged} token = ${awsKeyShaped()}`),
      'another line: the comment re-indented': at(flagged.trimStart()),
      'another line: text before the comment': at(`const token = "${awsKeyShaped()}";\n${flagged}`),
      'another line: a second newline before the comment': at(`\n\n${flagged}`),
    };
    const wronglyAllowed = Object.entries(controls)
      .filter(([, finding]) => allowedByAny(finding))
      .map(([label]) => label);
    expect(wronglyAllowed).toEqual([]);
  });

  it('D-ORCH-027: Dependabot ignores TypeScript semver-major (ADR-0001 pin ~6.0.3, TS 7 deferred) and keeps the cooldown', () => {
    const dependabot = read('.github', 'dependabot.yml');
    expect(dependabot).toMatch(/- dependency-name: typescript\n\s+update-types: \['version-update:semver-major'\]/);
    // npm, github-actions, docker and docker-compose (PR #39 R2): one 7-day cooldown per ecosystem.
    expect(dependabot.match(/cooldown:\n\s+default-days: 7/g)).toHaveLength(4);
  });

  it('[PR25-SEC-02] Dependabot, parsed: per ecosystem the ignore list, cooldown, groups, limit and schedule are exact (M8, M9)', () => {
    const doc = parseYamlSubset(read('.github', 'dependabot.yml')).value;
    const updates = isMap(doc) ? doc['updates'] : undefined;
    expect(Array.isArray(updates)).toBe(true);
    const byEcosystem = new Map(
      (Array.isArray(updates) ? updates : [])
        .filter(isMap)
        .map((u) => [typeof u['package-ecosystem'] === 'string' ? u['package-ecosystem'] : '', u]),
    );
    expect([...byEcosystem.keys()]).toEqual(['npm', 'github-actions', 'docker', 'docker-compose']);
    expect(byEcosystem.get('npm')).toEqual({
      'package-ecosystem': 'npm',
      directory: '/',
      schedule: { interval: 'monthly' },
      cooldown: { 'default-days': '7' },
      // D-ORCH-078 P3 (TASK-286): one open npm group PR at a time.
      'open-pull-requests-limit': '1',
      ignore: [{ 'dependency-name': '@platform/*' }, { 'dependency-name': 'typescript', 'update-types': ['version-update:semver-major'] }],
      groups: { 'npm-minor-and-patch': { 'update-types': ['minor', 'patch'] } },
      'commit-message': { prefix: 'chore(deps)' },
    });
    expect(byEcosystem.get('github-actions')).toEqual({
      'package-ecosystem': 'github-actions',
      directory: '/',
      schedule: { interval: 'monthly' },
      cooldown: { 'default-days': '7' },
      'open-pull-requests-limit': '2',
      groups: { 'github-actions': { patterns: ['*'] } },
      'commit-message': { prefix: 'ci(deps)' },
    });
    // PR #39 R2, PR39-SEC-06: the base images of every image Dockerfile in ONE group, so the node build base and the
    // debian runtime base (D-TASK014-02, D-ARCH-116 rule 3) are bumped in the same PR; compose service images likewise.
    expect(byEcosystem.get('docker')).toEqual({
      'package-ecosystem': 'docker',
      directories: ['/apps/api', '/apps/worker', '/apps/web', '/apps/admin', '/prisma'],
      schedule: { interval: 'monthly' },
      cooldown: { 'default-days': '7' },
      'open-pull-requests-limit': '2',
      groups: { 'docker-images': { patterns: ['*'] } },
      'commit-message': { prefix: 'build(deps)' },
    });
    expect(byEcosystem.get('docker-compose')).toEqual({
      'package-ecosystem': 'docker-compose',
      directory: '/',
      schedule: { interval: 'monthly' },
      cooldown: { 'default-days': '7' },
      'open-pull-requests-limit': '2',
      // D-SECPOST-01 O-1, D-DEVOPS-001: Valkey stays on the ADR-0001 major (8) and the harness digest; 9 needs an ADR.
      ignore: [{ 'dependency-name': 'valkey/valkey', 'update-types': ['version-update:semver-major'] }],
      groups: { 'compose-images': { patterns: ['*'] } },
      'commit-message': { prefix: 'build(deps)' },
    });
  });

  it('[PR25-SEC-02] .gitleaks.toml top level is exactly title, [extend] and [[allowlists]] tables: no [[rules]], [[rules.allowlists]] or [allowlist] (M10)', () => {
    const tablesOf = (text: string) =>
      text
        .split(/\r?\n/)
        .filter((line) => /^\s*\[/.test(line))
        .map((line) => line.trim());
    const tables = tablesOf(gitleaks);
    expect(new Set(tables)).toEqual(new Set(['[extend]', '[[allowlists]]']));
    expect(tables.filter((table) => table === '[extend]')).toHaveLength(1);
    const preamble = gitleaks.split(/^\s*\[/m)[0] ?? '';
    const keys = preamble
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
      .map((line) => line.split('=')[0]?.trim());
    expect(keys).toEqual(['title']);
    // M10: a default rule re-declared with its own allowlist would extend that rule silently; the table check sees it.
    const mutated = `${gitleaks}\n[[rules]]\nid = "generic-api-key"\n[[rules.allowlists]]\nregexes = ['''x''']\n`;
    expect(new Set(tablesOf(mutated))).not.toEqual(new Set(['[extend]', '[[allowlists]]']));
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
