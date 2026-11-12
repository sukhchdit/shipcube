/**
 * licence-check (TASK-007): CLAUDE.md section 3 LICENSE_ALLOWLIST; D-ARCH-003 rev 2 items 1-4, rev 3, rev 4;
 * ADR-0023 am. I item 7 and am. J item 3; PR1-SEC-05; PR1-SEC-10; PR2-SEC-07 items 1-2; AT-US-048-06 (GPL-3.0 fails,
 * MIT passes). Pure core against fixtures with an injected manifest reader; the CLI against the real repository.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { checkLicences, declaredLicence, loadLicenceRegister, parseSpdx, PRODUCTION_ALLOWED, satisfies } from './licence-check.mjs';
import type { Lockfile, LockEntry } from './dep-gates-lib.mjs';
import { findRepoRoot, runNode } from '../test-support/process.js';

const repoRoot = findRepoRoot();
const fixtures = join(repoRoot, 'tools', 'ci', 'fixtures', 'licence-check');
const register = loadLicenceRegister(JSON.parse(readFileSync(join(repoRoot, 'tools', 'ci', 'licence-exceptions.json'), 'utf8')));
const base = (): Lockfile => JSON.parse(readFileSync(join(fixtures, 'lockfile.json'), 'utf8')) as Lockfile;
const negatives = JSON.parse(readFileSync(join(fixtures, 'negative.json'), 'utf8')) as Record<
  string,
  { rules: string[]; packages: Record<string, LockEntry> } | string
>;
const manifests: Record<string, { license?: unknown; licenses?: unknown; private?: unknown }> = {
  'apps/api': { private: true, license: 'UNLICENSED' },
  'node_modules/svg-tags': { licenses: [{ type: 'MIT', url: 'http://www.opensource.org/licenses/MIT' }] },
};
const readManifest = (key: string) => manifests[key];
const run = (lock: Lockfile) => checkLicences(lock, { ...register, readManifest });
const withPackages = (packages: Record<string, LockEntry>): Lockfile => {
  const lock = base();
  return { ...lock, packages: { ...lock.packages, ...packages } };
};

describe('licence-check policy', () => {
  it('[AT-US-048-06] passes the fixture: MIT, legacy licenses array, png-js override, elkjs exception, CC-BY data in dev', () => {
    const result = run(base());
    expect(result.findings).toEqual([]);
    expect(result.notes.map((n) => n.rule).sort()).toEqual(['licence/attribution', 'licence/exception', 'licence/metadata-override']);
  });

  for (const [title, fixture] of Object.entries(negatives)) {
    if (typeof fixture === 'string') continue;
    it(`[${title}] fails with ${fixture.rules.join(', ')}`, () => {
      expect(run(withPackages(fixture.packages)).findings.map((f) => f.rule)).toEqual(fixture.rules);
    });
  }

  it('[PR2-SEC-07] svg-tags without any licence metadata in the lockfile or manifest fails (no silent pass)', () => {
    const result = checkLicences(base(), { ...register, readManifest: (key) => (key === 'apps/api' ? { private: true } : undefined) });
    expect(result.findings.map((f) => `${f.rule} ${f.location}`)).toEqual(['licence/missing node_modules/svg-tags']);
  });

  it('[D-ARCH-003 rev 2 item 3] a workspace that is not "private": true fails', () => {
    const result = checkLicences(base(), {
      ...register,
      readManifest: (key) => (key === 'apps/api' ? { license: 'UNLICENSED' } : manifests[key]),
    });
    expect(result.findings.map((f) => f.rule)).toEqual(['licence/workspace-not-private']);
  });

  it('[PR1-SEC-10] the png-js override is noted with its evidence and flagged once metadata appears', () => {
    expect(run(base()).notes.find((n) => n.location === 'node_modules/png-js')?.message).toContain('LICENSE');
    const result = run(withPackages({ 'node_modules/png-js': { version: '2.0.0', license: 'MIT' } }));
    expect(result.findings).toEqual([]);
    expect(result.notes.map((n) => n.rule)).toContain('licence/override-unneeded');
  });

  it('[PR1-SEC-05] the elkjs exception is accepted through the @prisma/client optional-peer edge (SEC-FU-PR1 note 2)', () => {
    const notes = run(base()).notes.filter((n) => n.rule === 'licence/exception');
    expect(notes.map((n) => n.message)).toEqual([
      expect.stringContaining('elkjs@0.11.1 EPL-2.0 admitted in the dev closure via prisma -> @prisma/studio-core (D-ARCH-003 rev 4)'),
    ]);
  });

  it('the committed register holds only the elkjs exception and the png-js metadata override', () => {
    expect(register.exceptions.map((e) => [e.name, e.version, e.licence, e.via, e.closure, e.decision])).toEqual([
      ['elkjs', '0.11.1', 'EPL-2.0', ['prisma', '@prisma/studio-core'], 'dev', 'D-ARCH-003 rev 4'],
    ]);
    expect(register.metadataOverrides.map((o) => [o.name, o.version, o.licence])).toEqual([['png-js', '2.0.0', 'MIT']]);
    expect(() =>
      loadLicenceRegister({ exceptions: [{ ...register.exceptions[0], closure: 'production' }], metadataOverrides: [] }),
    ).toThrow(/dev/);
  });
});

describe('SPDX evaluation (D-ARCH-003 rev 2 item 3)', () => {
  const allowed = (id: string) => PRODUCTION_ALLOWED.map((a) => a.toLowerCase()).includes(id.toLowerCase());
  it.each([
    ['MIT', true],
    ['(MIT OR GPL-3.0-only)', true],
    ['GPL-3.0-only OR Apache-2.0', true],
    ['MIT AND ISC', true],
    ['MIT and ISC', true],
    ['MIT AND GPL-2.0-only', false],
    ['(MIT OR GPL-3.0-only) AND BSD-3-Clause', true],
    ['MIT OR GPL-3.0-only AND LGPL-2.1-only', true],
    ['(MIT OR GPL-3.0-only) AND LGPL-2.1-only', false],
    ['GPL-2.0-only WITH Classpath-exception-2.0', false],
    ['Apache-2.0 WITH LLVM-exception', true],
    ['SEE LICENSE IN LICENSE.md', false],
  ])('%s -> %s', (expression, expected) => {
    let ok = false;
    try {
      ok = satisfies(parseSpdx(expression), allowed);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
    expect(ok).toBe(expected);
  });

  it('reads legacy license objects and licenses arrays (alternatives become OR)', () => {
    expect(declaredLicence({ license: { type: 'MIT' } })).toBe('MIT');
    expect(declaredLicence({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe('(MIT OR Apache-2.0)');
    expect(declaredLicence({ licenses: [] })).toBeUndefined();
  });
});

describe('licence-check CLI', () => {
  it('passes on the real repository (positive control; reads installed manifests)', () => {
    const result = runNode([join(repoRoot, 'tools', 'ci', 'licence-check.mjs'), '--root', repoRoot, '--json'], { cwd: repoRoot });
    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout) as { pass: boolean; notes: Array<{ rule: string; location: string }> };
    expect(json.pass).toBe(true);
    expect(json.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'licence/exception', location: 'node_modules/elkjs' }),
        expect.objectContaining({ rule: 'licence/metadata-override', location: 'node_modules/png-js' }),
      ]),
    );
  });
});
