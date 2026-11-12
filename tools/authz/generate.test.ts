/**
 * The committed authz artefacts equal the generator output (AT-US-066-02 matrix document; seed migration drift), the
 * released seed version is pinned and cannot be rewritten in place (PR8-SEC-01, D-SEC-PR8-01), and the seed IDs are
 * deterministic UUIDv7 values (data-model P1, NFR-DATA-002).
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';
import { CATALOGUE_VERSION, PERMISSION_DEFINITIONS, ROLES } from '@platform/authz';

import { lintMigrationDir } from '../db/lint-migrations.js';
import {
  artefacts,
  type CatalogueSource,
  checkMessages,
  drifted,
  main,
  pinnedDrift,
  REPO_ROOT,
  SEED_MIGRATIONS,
  SEED_SOURCE,
  seedId,
  sha256,
} from './generate.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const V1 = SEED_MIGRATIONS[1];
const V1_FILES = ['migration.sql', 'down.sql'] as const;

/** The shipped source with one grant removed from the customer Viewer and the version left unchanged. */
const grantEditedInPlace: CatalogueSource = {
  ...SEED_SOURCE,
  roles: SEED_SOURCE.roles.map((role) => (role.key === 'CUSTOMER_VIEWER' ? { ...role, permissions: role.permissions.slice(1) } : role)),
};

describe('authz:generate (ADR-0008 §2, REQ-RBAC-002)', () => {
  const scratch: string[] = [];
  afterAll(() => scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  /** A temporary root holding a freshly written copy of the artefacts. */
  const freshRoot = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'authz-generate-'));
    scratch.push(root);
    expect(main([], root)).toBe(0);
    return root;
  };

  it('[AT-US-066-02] the committed matrix document and seed migration match the generator output (`npm run authz:generate`)', () => {
    expect(drifted()).toEqual([]);
    expect(checkMessages()).toEqual([]);
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

  it('catalogue v1 is released: both seed files are pinned to the SHA-256 of the committed files', () => {
    expect(V1?.sha256).toBeDefined();
    for (const file of V1_FILES) {
      const pin = file === 'migration.sql' ? V1?.sha256?.up : V1?.sha256?.down;
      expect(sha256(readFileSync(join(REPO_ROOT, String(V1?.dir), file)))).toBe(pin);
    }
    expect(pinnedDrift()).toEqual([]);
  });

  it('a grant change without a version bump fails --check with "catalogue changed" and the write run refuses to rewrite v1', () => {
    const root = freshRoot();
    expect(checkMessages(root)).toEqual([]);
    const messages = checkMessages(root, grantEditedInPlace);
    expect(messages.filter((m) => m.startsWith('catalogue changed:')).length).toBe(2);
    expect(messages.join('\n')).toContain('Bump CATALOGUE_VERSION and add a seed migration');
    expect(messages.join('\n')).not.toMatch(/migration\.sql is out of date; run/);
    expect(main(['--check'], root, grantEditedInPlace)).toBe(1);
    expect(main([], root, grantEditedInPlace)).toBe(1);
    for (const file of V1_FILES) {
      expect(readFileSync(join(root, String(V1?.dir), file), 'utf8')).toBe(readFileSync(join(REPO_ROOT, String(V1?.dir), file), 'utf8'));
    }
    expect(main(['--check'], root)).toBe(0);
  });

  it('a hand edit of a pinned seed file fails --check, naming the released version', () => {
    const root = freshRoot();
    appendFileSync(join(root, String(V1?.dir), 'down.sql'), '-- edited\n');
    expect(pinnedDrift(root)).toEqual([expect.stringContaining('down.sql belongs to released catalogue v1')]);
    expect(main(['--check'], root)).toBe(1);
  });

  it('a version above 1 is refused until a delta seed renderer exists (the full renderer would delete every v1 row on down)', () => {
    expect(() => artefacts({ ...SEED_SOURCE, version: 2 })).toThrow(/needs a delta seed renderer/);
    expect(() => main(['--check'], REPO_ROOT, { ...SEED_SOURCE, version: 2 })).toThrow(/needs a delta seed renderer/);
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
    const dir = SEED_MIGRATIONS[CATALOGUE_VERSION]?.dir;
    expect(dir).toBeDefined();
    expect(lintMigrationDir(join(REPO_ROOT, String(dir)))).toEqual([]);
  });
});
