/**
 * Catalog C10 against the live schema (data-model §4.6 C10 and its 2026-11-12 amendment, §10.4; NFR-PRIV-003,
 * REQ-AUDIT-009; PR #11 code review m4 deferral; D-ARCH-074; TASK-028). Runs on a clone of the bootstrapped AND fully
 * migrated template, so the bootstrap-lane audit tables and the Prisma migrations are both present:
 *  - every column of every table in `public` and `platform` (`information_schema.columns`, partitions excluded: they
 *    carry their parent's columns) has a classification registry entry, and no entry names a missing column;
 *  - SYSTEM tables (table-class manifests) hold no PER/SPER column except `idempotency_keys.response_body` and the
 *    encrypted vault;
 *  - every ciphertext / HMAC column of data-model §10.4 that exists has its `<col>_key_id` sibling.
 * The rules themselves are proven on planted data in tools/db/classification.test.ts; this suite proves the schema.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type pg from 'pg';

import { c10Findings, KEY_ID_SIBLINGS, type LiveColumn } from '../../../tools/db/classification.js';
import { loadTableClasses } from '../../../tools/db/table-classes.js';
import { PlatformPostgres } from '../harness/postgres.js';

const STARTUP_TIMEOUT_MS = 240_000;

let db: PlatformPostgres;
let admin: pg.Client;
let columns: LiveColumn[] = [];

beforeAll(async () => {
  db = await PlatformPostgres.start();
  const database = await db.clone(await db.template({ migrated: true }));
  admin = await db.superuser(database);
  const result = await admin.query<{ schema: string; table: string; column: string }>(
    `SELECT c.table_schema AS schema, c.table_name AS table, c.column_name AS column
       FROM information_schema.columns c
       JOIN pg_catalog.pg_namespace n ON n.nspname = c.table_schema
       JOIN pg_catalog.pg_class r ON r.relnamespace = n.oid AND r.relname = c.table_name
      WHERE c.table_schema IN ('public', 'platform')
        AND r.relkind IN ('r', 'p')
        AND NOT r.relispartition
      ORDER BY 1, 2, c.ordinal_position`,
  );
  columns = result.rows;
}, STARTUP_TIMEOUT_MS);

afterAll(async () => {
  await admin?.end();
  await db?.stop();
}, STARTUP_TIMEOUT_MS);

describe('[C10] [NFR-PRIV-003] classification of the live schema (data-model §4.6)', () => {
  it('reads both lanes: the bootstrap audit tables, the migrated authz tables and the migration ledgers', () => {
    const tables = new Set(columns.map((column) => column.table));
    for (const table of [
      'audit_entries',
      'audit_pii_vault',
      'data_subjects',
      'permissions',
      'roles',
      'role_permissions',
      '_prisma_migrations',
    ]) {
      expect([table, tables.has(table)]).toEqual([table, true]);
    }
    // Partitions are excluded (their columns are the parent's).
    expect([...tables].some((table) => /^audit_entries_\d{4}_\d{2}$/.test(table))).toBe(false);
  });

  it('every column has a registry entry, no entry is stale, no SYSTEM table holds PER/SPER, every §10.4 column has its key id', () => {
    expect(c10Findings({ columns, tableClasses: loadTableClasses() })).toEqual([]);
  });

  it('the §10.4 key-id rule is exercised by the live audit store (the vault and ip_hash siblings exist)', () => {
    const present = new Set(columns.map(({ table, column }) => `${table}.${column}`));
    const live = KEY_ID_SIBLINGS.filter(([table, column]) => present.has(`${table}.${column}`));
    expect(live.map(([table, column]) => `${table}.${column}`)).toEqual(
      expect.arrayContaining(['audit_pii_vault.ciphertext', 'audit_pii_vault.value_hmac', 'audit_entries.ip_hash']),
    );
  });

  it('planted on the live list: a dropped key-id sibling and a new unclassified column are both reported', () => {
    const planted = [
      ...columns.filter(({ table, column }) => !(table === 'audit_entries' && column === 'ip_hash_key_id')),
      { schema: 'public', table: 'audit_entries', column: 'client_email' },
    ];
    expect(c10Findings({ columns: planted, tableClasses: loadTableClasses() })).toEqual([
      'audit_entries.client_email: no classification registry entry',
      'audit_entries.ip_hash: no sibling key-id column ip_hash_key_id (data-model §10.4)',
      'audit_entries.ip_hash_key_id: registry entry for a column that does not exist',
    ]);
  });
});
