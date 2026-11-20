/**
 * Catalog C16 (tenant-bound references and tenant-scoped unique indexes) and P9-CK (`ck_…` names are CHECKs) against
 * the bootstrapped and migrated schema on PostgreSQL 18 (data-model §4.6 C16, §4.7, §1.1 P9/P12; D-ARCH-154, ADR-0005
 * am. 13 items 27-28; PR65-SEC-01, D-SEC-PR65-01/02; PR #66 code review R1-n2, D-SEC-PR66-02; SEC-TC-76; TASK-293).
 * The queries, exception maps and planted probes live in ./tenant-keys.ts. Every planted probe runs as the superuser
 * inside a transaction that is rolled back, so the committed schema is never changed.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type pg from 'pg';

import { loadTableClasses } from '../../../tools/db/table-classes.js';
import { PlatformPostgres } from '../harness/postgres.js';
import {
  CHECK_NAMED_SQL,
  PLANT_CHECK_NAMES,
  PLANT_PR65_MUTANTS,
  PLANT_REFERENCES,
  PLANT_UNIQUE_INDEXES,
  PLANTED_CHECK_FINDINGS,
  PLANTED_REFERENCE_FINDINGS,
  PLANTED_UNIQUE_FINDINGS,
  TENANT_REFERENCE_EXCEPTIONS,
  TENANT_REFERENCES_SQL,
  TENANT_UNIQUE_EXCEPTIONS,
  TENANT_UNIQUE_INDEXES_SQL,
  checkNameFindings,
  tenantReferenceFindings,
  tenantUniqueFindings,
  type CheckNamedConstraint,
  type TenantReference,
  type TenantUniqueIndex,
} from './tenant-keys.js';

/** C16 (b) scope: the TENANT tables of the table-class manifests (those with an `org_id` column are checked). */
const TENANT_TABLES = loadTableClasses()
  .filter((entry) => entry.class === 'TENANT')
  .map((entry) => entry.name);

let db: PlatformPostgres;
let database: string;

beforeAll(async () => {
  db = await PlatformPostgres.start();
  database = await db.clone(await db.template({ migrated: true }));
}, 300_000);

afterAll(async () => {
  await db?.stop();
}, 60_000);

async function rolledBack<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = await db.superuser(database);
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

async function plant(client: pg.Client, statements: readonly string[]): Promise<void> {
  for (const statement of statements) await client.query(statement);
}

const references = async (client: pg.ClientBase): Promise<TenantReference[]> =>
  (await client.query<TenantReference>(TENANT_REFERENCES_SQL)).rows;
const uniqueIndexes = async (client: pg.ClientBase, tables: readonly string[]): Promise<TenantUniqueIndex[]> =>
  (await client.query<TenantUniqueIndex>(TENANT_UNIQUE_INDEXES_SQL, [tables])).rows;
const checkNamed = async (client: pg.ClientBase): Promise<CheckNamedConstraint[]> =>
  (await client.query<CheckNamedConstraint>(CHECK_NAMED_SQL)).rows;
/** The object name a finding starts with. */
const named = (findings: readonly string[]): string[] => findings.map((finding) => finding.split(/[: ]/)[0] ?? '').sort();

describe('catalog C16: tenant-bound references and tenant-scoped unique indexes (D-ARCH-154; PR65-SEC-01)', () => {
  it('[SEC-TC-76] C16 (a) committed: every foreign key between two org_id tables is bound through org_id at the same key position (T1, or T2 beside a nullable org_id); the exception map is empty; the TASK-037 instances are seen', async () => {
    const rows = await rolledBack(references);
    expect(TENANT_REFERENCE_EXCEPTIONS.size).toBe(0);
    expect(tenantReferenceFindings(rows)).toEqual([]);
    // Not vacuous: the two composite keys of data-model §4.7 are in scope and compliant.
    expect(rows.filter((row) => row.composite).map((row) => row.conname)).toEqual(
      expect.arrayContaining(['fk_membership_roles__membership_id', 'fk_memberships__invitation_id']),
    );
  });

  it('[SEC-TC-76] C16 (a) planted: a single-column key, a composite key at the wrong position, a nullable-org key without a composite sibling and a single key beside a composite one on a NOT NULL org_id are reported; the composite key, the T2 pair and a key to a GLOBAL table are not', async () => {
    const findings = await rolledBack(async (client) => {
      await plant(client, PLANT_REFERENCES);
      return tenantReferenceFindings(await references(client));
    });
    expect(named(findings)).toEqual([...PLANTED_REFERENCE_FINDINGS]);
  });

  it('[SEC-TC-76] C16 (b) committed (PR65-SEC-01): every unique index of a TENANT table with org_id has org_id among its key columns, except the primary keys and the listed global digests; every exception is live', async () => {
    const rows = await rolledBack((client) => uniqueIndexes(client, TENANT_TABLES));
    expect(tenantUniqueFindings(rows)).toEqual([]);
    // The map cannot hide a compliant or vanished index: each entry exists, in scope, without org_id.
    const live = rows.filter((row) => !row.has_org_id).map((row) => row.index);
    expect([...TENANT_UNIQUE_EXCEPTIONS.keys()].filter((name) => !live.includes(name))).toEqual([]);
    // Not vacuous: the live-grant index of PR65-SEC-01 is in scope and compliant.
    expect(rows.find((row) => row.index === 'ux_membership_roles__membership_role_live')?.has_org_id).toBe(true);
  });

  it('[SEC-TC-76] C16 (b) planted: a unique index without org_id, with org_id only as an INCLUDE column and over an org_id expression is reported; org_id as a later key column, the (org_id, id) constraint and the primary key are not', async () => {
    const findings = await rolledBack(async (client) => {
      await plant(client, [...PLANT_REFERENCES, ...PLANT_UNIQUE_INDEXES]);
      return {
        scoped: tenantUniqueFindings(await uniqueIndexes(client, [...TENANT_TABLES, 'c16_parent'])),
        unscoped: tenantUniqueFindings(await uniqueIndexes(client, TENANT_TABLES)),
      };
    });
    expect(named(findings.scoped)).toEqual([...PLANTED_UNIQUE_FINDINGS]);
    expect(findings.unscoped).toEqual([]); // a table outside the TENANT class is out of scope
  });

  it('[SEC-TC-76] C16 mutants of PR #65 (rolled back): the single-column membership key of D-ARCH-154 and the live-grant index without org_id of PR65-SEC-01 are both reported', async () => {
    const findings = await rolledBack(async (client) => {
      await plant(client, PLANT_PR65_MUTANTS);
      return {
        references: tenantReferenceFindings(await references(client)),
        unique: tenantUniqueFindings(await uniqueIndexes(client, TENANT_TABLES)),
      };
    });
    expect(findings).toEqual({
      references: ['fk_membership_roles__membership_id: membership_roles -> memberships is not bound through org_id (T1)'],
      unique: ['ux_membership_roles__membership_role_live on membership_roles has no org_id key column (PR65-SEC-01)'],
    });
  });
});

describe('catalog P9-CK: every constraint named ck_… is a CHECK (PR #66 R1-n2; D-SEC-PR66-02)', () => {
  it('[PR #66 R1-n2] committed: every ck_ constraint of a non-system schema (tables, partitions and domains) has contype c, so the shadow KEEP form of isCheckReplacement replaces a CHECK', async () => {
    const rows = await rolledBack(checkNamed);
    expect(checkNameFindings(rows)).toEqual([]);
    // Not vacuous: both lanes are read (a migration CHECK and the bootstrap-lane CHECK the KEEP form replaces).
    expect(rows.map((row) => `${row.conname} ${row.owner}`)).toEqual(
      expect.arrayContaining(['ck_users__is_system public.users', 'ck_audit_entries__action public.audit_entries']),
    );
  });

  it('[PR #66 R1-n2] planted: a primary key and a unique key named ck_… are reported; a domain CHECK named ck_… is not', async () => {
    const findings = await rolledBack(async (client) => {
      await plant(client, PLANT_CHECK_NAMES);
      return checkNameFindings(await checkNamed(client));
    });
    expect(findings).toEqual([...PLANTED_CHECK_FINDINGS]);
  });
});
