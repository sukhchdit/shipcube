/**
 * Authz catalogue tables and the versioned role seed on PostgreSQL 18 (TASK-013; REQ-RBAC-002/003/013, data-model
 * §3.3, ADR-0008 §2). The database after `migrate deploy` must equal the packages/authz catalogue exactly (catalogue
 * and database drift fails CI), the seed must be idempotent (AT-US-066-01) and the runtime role must not write.
 * Up -> down -> up of these migrations is covered by prisma/tests/migrations/up-down-up.int.test.ts (all migrations).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { SEED_MIGRATIONS, SEED_SOURCE } from '../../../tools/authz/generate.js';
import { findRepoRoot } from '../../../tools/test-support/process.js';
import { PlatformPostgres } from '../harness/postgres.js';

const { version: CATALOGUE_VERSION, permissions: PERMISSION_DEFINITIONS, roles: ROLES } = SEED_SOURCE;
const TABLES = ['permissions', 'roles', 'role_permissions'] as const;
const seedSql = readFileSync(join(findRepoRoot(), String(SEED_MIGRATIONS[CATALOGUE_VERSION]), 'migration.sql'), 'utf8');

let db: PlatformPostgres;
let database: string;

beforeAll(async () => {
  db = await PlatformPostgres.start();
  database = await db.clone(await db.template({ migrated: true }));
}, 300_000);

afterAll(async () => {
  await db?.stop();
});

async function withClient<T>(config: pg.ClientConfig, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(config);
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

interface Snapshot {
  permissions: Array<{ key: string; category: string; operator_only: boolean }>;
  roles: Array<{ key: string; scope: string; name_key: string }>;
  links: string[];
}

async function snapshot(client: pg.Client): Promise<Snapshot> {
  // COLLATE "C" = code-unit order, the order of the JavaScript comparison used for `expected`.
  const permissions = await client.query<Snapshot['permissions'][number]>(
    'SELECT key, category, operator_only FROM permissions ORDER BY key COLLATE "C"',
  );
  const roles = await client.query<Snapshot['roles'][number]>('SELECT key, scope, name_key FROM roles ORDER BY key COLLATE "C"');
  const links = await client.query<{ link: string }>(
    `SELECT r.key || '|' || p.key AS link FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id ORDER BY (r.key || '|' || p.key) COLLATE "C"`,
  );
  return { permissions: permissions.rows, roles: roles.rows, links: links.rows.map((row) => row.link) };
}

const expected: Snapshot = {
  permissions: PERMISSION_DEFINITIONS.map((p) => ({ key: p.key, category: p.category, operator_only: p.operatorOnly })).sort((a, b) =>
    a.key < b.key ? -1 : 1,
  ),
  roles: ROLES.map((r) => ({ key: r.key, scope: r.scope, name_key: r.nameKey })).sort((a, b) => (a.key < b.key ? -1 : 1)),
  links: ROLES.flatMap((r) => r.permissions.map((p) => `${r.key}|${p}`)).sort((a, b) => (a < b ? -1 : 1)),
};

describe('authz tables and role seed (REQ-RBAC-002, data-model §3.3)', () => {
  it('after migrate deploy the three tables equal the packages/authz catalogue exactly (catalogue/database drift fails CI)', async () => {
    const actual = await withClient(db.migratorConnection(database), snapshot);
    expect(actual).toEqual(expected);
  });

  it('[AT-US-066-01] running the role seed twice leaves 8 operator, 5 customer and 4 partner roles once each and widens no role', async () => {
    await withClient(db.migratorConnection(database), async (client) => {
      const before = await snapshot(client);
      await client.query(seedSql);
      const after = await snapshot(client);
      expect(after).toEqual(before);
      const scopes = await client.query<{ scope: string; roles: string }>(
        'SELECT scope, count(*)::text AS roles FROM roles GROUP BY scope ORDER BY scope',
      );
      expect(scopes.rows).toEqual([
        { scope: 'CUSTOMER', roles: '5' },
        { scope: 'OPERATOR', roles: '8' },
        { scope: 'PARTNER', roles: '4' },
      ]);
    });
  });

  it('the runtime role platform_app reads but cannot insert, update or delete role or permission rows (REQ-RBAC-013)', async () => {
    await withClient(db.appConnection(database), async (client) => {
      for (const table of TABLES) {
        const rows = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
        expect(Number(rows.rows[0]?.n)).toBeGreaterThan(0);
        for (const statement of [
          `INSERT INTO ${table} (created_by, updated_by) VALUES (gen_random_uuid(), gen_random_uuid())`,
          `UPDATE ${table} SET version = version + 1`,
          `DELETE FROM ${table}`,
          `TRUNCATE ${table}`,
        ]) {
          await expect(client.query(statement)).rejects.toMatchObject({ code: '42501' });
        }
      }
    });
  });

  it('the tables are GLOBAL: no RLS, and the key format CHECK rejects a malformed permission', async () => {
    await withClient(db.migratorConnection(database), async (client) => {
      const rls = await client.query<{ relname: string; relrowsecurity: boolean }>(
        `SELECT relname, relrowsecurity FROM pg_catalog.pg_class WHERE relname = ANY($1) AND relnamespace = 'public'::regnamespace ORDER BY relname`,
        [[...TABLES]],
      );
      expect(rls.rows).toEqual(
        TABLES.map((relname) => ({ relname, relrowsecurity: false })).sort((a, b) => (a.relname < b.relname ? -1 : 1)),
      );
      await expect(
        client.query(
          `INSERT INTO permissions (key, description, category, created_by, updated_by) VALUES ('Shipment:Create', 'x', 'shipment', $1, $1)`,
          ['00000000-0000-7000-8000-000000000001'],
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'ck_permissions__key_format' });
    });
  });
});
