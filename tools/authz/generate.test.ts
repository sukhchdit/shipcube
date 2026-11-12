/**
 * The committed authz artefacts equal the generator output (AT-US-066-02 matrix document; seed migration drift) and
 * the seed IDs are deterministic UUIDv7 values (data-model P1, NFR-DATA-002).
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';
import { CATALOGUE_VERSION, PERMISSION_DEFINITIONS, ROLES } from '@platform/authz';

import { lintMigrationDir } from '../db/lint-migrations.js';
import { artefacts, drifted, main, REPO_ROOT, SEED_MIGRATIONS, seedId } from './generate.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('authz:generate (ADR-0008 §2, REQ-RBAC-002)', () => {
  const scratch: string[] = [];
  afterAll(() => scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it('[AT-US-066-02] the committed matrix document and seed migration match the generator output (`npm run authz:generate`)', () => {
    expect(drifted()).toEqual([]);
    expect(main(['--check'])).toBe(0);
  });

  it('[AT-US-066-02] --check fails for a missing or edited artefact, and a write run regenerates them identically', () => {
    const root = mkdtempSync(join(tmpdir(), 'authz-generate-'));
    scratch.push(root);
    expect(main(['--check'], root)).toBe(1);
    expect(main([], root)).toBe(0);
    expect(drifted(root)).toEqual([]);
    for (const { path } of artefacts()) expect(readFileSync(join(root, path), 'utf8')).toBe(readFileSync(join(REPO_ROOT, path), 'utf8'));
  });

  it('seed IDs are deterministic, unique UUIDv7 values', () => {
    const keys = [
      ...PERMISSION_DEFINITIONS.map((p) => seedId('permission', p.key)),
      ...ROLES.map((r) => seedId('role', r.key)),
      ...ROLES.flatMap((r) => r.permissions.map((p) => seedId('role_permission', `${r.key}|${p}`))),
    ];
    expect(keys.filter((id) => !UUID_V7.test(id))).toEqual([]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(seedId('role', 'CUSTOMER_OWNER')).toBe(seedId('role', 'CUSTOMER_OWNER'));
  });

  it('the seed migration of the current catalogue version passes the migration linter', () => {
    const dir = SEED_MIGRATIONS[CATALOGUE_VERSION];
    expect(dir).toBeDefined();
    expect(lintMigrationDir(join(REPO_ROOT, String(dir)))).toEqual([]);
  });
});
