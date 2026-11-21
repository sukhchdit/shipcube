/**
 * Catalog C16 (tenant-bound references and owner-scoped unique keys) and P9-CK (`ck_…` names are CHECKs) against the
 * bootstrapped and migrated schema on PostgreSQL 18 (data-model §4.6 C16, §4.7, §1.1 P9/P12; D-ARCH-154, ADR-0005
 * am. 13 items 27-28; PR65-SEC-01, D-SEC-PR65-01/02; PR #66 code review R1-n2, D-SEC-PR66-02; SEC-TC-76; TASK-293;
 * amended by TASK-051 for R-ARCH-34: rulings/wave-1-r-arch-34-operator-rulings.md §2.6 and §8.1 to §8.3, D-ARCH-162,
 * D-ARCH-163, D-ARCH-207 to D-ARCH-209).
 * The queries, exception maps, finding rules and planted probes live in ./tenant-keys.ts (the rules are also proven
 * by the host unit test tenant-keys.test.ts). Every planted probe runs as the superuser inside a transaction that is
 * rolled back, so the committed schema is never changed.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type pg from 'pg';

import { loadTableClasses } from '../../../tools/db/table-classes.js';
import { PlatformPostgres } from '../harness/postgres.js';
import {
  CHECK_NAMED_SQL,
  PLANT_CHECK_NAMES,
  PLANT_GUEST_REFERENCES,
  PLANT_GUEST_UNIQUE_INDEXES,
  PLANT_PR65_MUTANTS,
  PLANT_REFERENCES,
  PLANT_UNIQUE_INDEXES,
  PLANTED_CHECK_FINDINGS,
  PLANTED_GUEST_REFERENCE_FINDINGS,
  PLANTED_GUEST_UNIQUE_FINDINGS,
  PLANTED_REFERENCE_FINDINGS,
  PLANTED_UNIQUE_FINDINGS,
  REFERENCE_CHECKS_SQL,
  TENANT_REFERENCES_SQL,
  TENANT_UNIQUE_INDEXES_SQL,
  checkNameFindings,
  exceptionCheckNames,
  orgOnlyCheckDefinition,
  referenceExceptionFindings,
  tenantReferenceFindings,
  tenantUniqueFindings,
  uniqueExceptionFindings,
  uniqueScope,
  type CheckNamedConstraint,
  type ReferenceException,
  type TenantCheck,
  type TenantReference,
  type TenantUniqueIndex,
} from './tenant-keys.js';

/** C16 (b) scope: the TENANT and GUEST_CAPABLE tables of the table-class manifests (those with `org_id` are read). */
const SCOPE = uniqueScope(loadTableClasses());

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
const referenceChecks = async (client: pg.ClientBase, names: readonly string[]): Promise<TenantCheck[]> =>
  (await client.query<TenantCheck>(REFERENCE_CHECKS_SQL, [names])).rows;
const checkNamed = async (client: pg.ClientBase): Promise<CheckNamedConstraint[]> =>
  (await client.query<CheckNamedConstraint>(CHECK_NAMED_SQL)).rows;
/** The object name a finding starts with. */
const named = (findings: readonly string[]): string[] => findings.map((finding) => finding.split(/[: ]/)[0] ?? '').sort();

/** The T2-O shape of the guest probe, as a ruled exception entry would name it (with c16_g_org_only_check). */
const T2O_PROBE = 'c16_g_org_only_parent';

describe('catalog C16: tenant-bound references and owner-scoped unique keys (D-ARCH-154; PR65-SEC-01; D-ARCH-162/163, D-ARCH-207..209)', () => {
  it('[SEC-TC-76] C16 (a) committed: every foreign key between two org_id tables follows T1, T2-N or T2-G; every exception entry is live; the TASK-037 instances are seen', async () => {
    const rows = await rolledBack(references);
    // The map may now hold T2-O entries (rulings §2.6), but each must name a key the rules would otherwise report and a
    // CHECK that passes the verification of rulings §8.3.
    const checks = await rolledBack((client) => referenceChecks(client, exceptionCheckNames()));
    expect(tenantReferenceFindings(rows, undefined, checks)).toEqual([]);
    expect(referenceExceptionFindings(rows, undefined, checks)).toEqual([]);
    // Not vacuous: the two composite keys of data-model §4.7 are in scope and org-bound.
    expect(rows.filter((row) => row.org_bound).map((row) => row.conname)).toEqual(
      expect.arrayContaining(['fk_membership_roles__membership_id', 'fk_memberships__invitation_id']),
    );
  });

  it('[SEC-TC-76] C16 (a) planted T1/T2-N: a single-column key, a composite key at the wrong position, a nullable-org key without a composite sibling and a single key beside a composite one on a NOT NULL org_id are reported; the composite key, the T2-N pair and a key to a GLOBAL table are not', async () => {
    const findings = await rolledBack(async (client) => {
      await plant(client, PLANT_REFERENCES);
      return tenantReferenceFindings(await references(client));
    });
    expect(named(findings)).toEqual([...PLANTED_REFERENCE_FINDINGS]);
  });

  it('[SEC-TC-76] [D-ARCH-162] [D-ARCH-207] C16 (a) planted T2-G: the owner-bound pair is not reported; a single-column key beside the pair, an org-bound key alone, a guest-bound key alone, a guest-bound key with its columns swapped and a key holding both owner columns are', async () => {
    const rows = await rolledBack(async (client) => {
      await plant(client, PLANT_GUEST_REFERENCES);
      return references(client);
    });
    expect(named(tenantReferenceFindings(rows))).toEqual([...PLANTED_GUEST_REFERENCE_FINDINGS]);
    // Not vacuous: the pair is read, one key org-bound and one guest-bound, with the same rest; the both-owner key is
    // read with both flags set.
    expect(
      rows
        .filter((row) => row.child === 'c16_g_pair' || row.child === 'c16_g_both')
        .map((row) => [row.conname, row.org_bound, row.guest_bound, row.rest]),
    ).toEqual([
      ['c16_g_both_parent', true, true, 'parent_id=id'],
      ['c16_g_pair_guest', false, true, 'parent_id=id'],
      ['c16_g_pair_org', true, false, 'parent_id=id'],
    ]);
  });

  describe('[SEC-TC-76] [D-ARCH-209] C16 (a) T2-O: an entry names its CHECK, which is verified (rulings §8.3)', () => {
    const T2O_CHECK = 'c16_g_org_only_check';
    const entry = (key: string): ReadonlyMap<string, ReferenceException> =>
      new Map([[key, { check: T2O_CHECK, reason: 'probe: only organisation rows hold the reference' }]]);
    /** Plants the guest probe, applies `variant` to it, and reads the findings of `map` (rolled back). */
    const findingsWith = (
      map: ReadonlyMap<string, ReferenceException>,
      variant: readonly string[] = [],
    ): Promise<{ reported: string[]; stale: string[] }> =>
      rolledBack(async (client) => {
        await plant(client, [...PLANT_GUEST_REFERENCES, ...variant]);
        const rows = await references(client);
        const checks = await referenceChecks(client, exceptionCheckNames(map));
        return { reported: named(tenantReferenceFindings(rows, map, checks)), stale: named(referenceExceptionFindings(rows, map, checks)) };
      });
    const DROP = `ALTER TABLE public.c16_g_org_only DROP CONSTRAINT ${T2O_CHECK}`;

    it('[SEC-TC-76] [D-ARCH-209] the entry with its validated CHECK hides the org-only key and is live', async () => {
      expect(await findingsWith(entry(T2O_PROBE))).toEqual({
        reported: PLANTED_GUEST_REFERENCE_FINDINGS.filter((name) => name !== T2O_PROBE),
        stale: [],
      });
    });

    it.each([
      ['the CHECK dropped', [DROP]],
      [
        'the CHECK replaced by parent_id IS NULL OR org_id IS NULL',
        [DROP, `ALTER TABLE public.c16_g_org_only ADD CONSTRAINT ${T2O_CHECK} CHECK (parent_id IS NULL OR org_id IS NULL)`],
      ],
      [
        'the CHECK added NOT VALID',
        [DROP, `ALTER TABLE public.c16_g_org_only ADD CONSTRAINT ${T2O_CHECK} CHECK (parent_id IS NULL OR org_id IS NOT NULL) NOT VALID`],
      ],
    ] as const)('[SEC-TC-76] [D-ARCH-209] %s: the key is reported and the entry is reported', async (_case, variant) => {
      expect(await findingsWith(entry(T2O_PROBE), variant)).toEqual({
        reported: [...PLANTED_GUEST_REFERENCE_FINDINGS],
        stale: [T2O_PROBE],
      });
    });

    it('[SEC-TC-76] [D-ARCH-209] an entry naming the single-column key c16_g_single_parent hides nothing and is reported; entries for the compliant pair or a missing key are not live', async () => {
      expect(await findingsWith(entry('c16_g_single_parent'))).toEqual({
        reported: [...PLANTED_GUEST_REFERENCE_FINDINGS],
        stale: ['c16_g_single_parent'],
      });
      const stale = new Map([...entry('c16_g_pair_org'), ...entry('c16_g_vanished')]);
      expect((await findingsWith(stale)).stale).toEqual(['c16_g_pair_org', 'c16_g_vanished']);
    });

    it('[SEC-TC-76] [D-ARCH-209] the planted CHECK prints as the T2-O predicate (the text C16 compares on this engine)', async () => {
      const checks = await rolledBack(async (client) => {
        await plant(client, PLANT_GUEST_REFERENCES);
        return referenceChecks(client, [T2O_CHECK]);
      });
      expect(checks).toEqual([
        { conname: T2O_CHECK, table: 'c16_g_org_only', contype: 'c', validated: true, definition: orgOnlyCheckDefinition('parent_id') },
      ]);
    });
  });

  it('[SEC-TC-76] C16 (b) committed (PR65-SEC-01; D-ARCH-163, D-ARCH-208): every non-primary unique index and exclusion constraint of a TENANT or GUEST_CAPABLE table with org_id holds an owner key column that separates owners, except the listed global digests; every exception is live', async () => {
    const rows = await rolledBack((client) => uniqueIndexes(client, SCOPE));
    expect(tenantUniqueFindings(rows)).toEqual([]);
    // The map cannot hide a compliant or vanished index: each entry exists, in scope, without an owner column.
    expect(uniqueExceptionFindings(rows)).toEqual([]);
    // Not vacuous: the live-grant index of PR65-SEC-01 is in scope, and its org_id key column is read as NOT NULL.
    const live = rows.find((row) => row.index === 'ux_membership_roles__membership_role_live');
    expect(live?.owner_columns).toEqual([{ column: 'org_id', not_null: true, equality: null }]);
    expect(live?.nulls_not_distinct).toBe(false);
  });

  it('[SEC-TC-76] [D-ARCH-208] C16 (b) planted on a TENANT-scoped table: a unique index without org_id, with org_id only as an INCLUDE column, over an org_id expression, and EXCLUDE (org_id WITH <>, code WITH =) are reported; org_id as a later key column, UNIQUE NULLS NOT DISTINCT (org_id, code) on the NOT NULL org_id, the (org_id, id) constraint and the primary key are not; an unscoped table is out of scope', async () => {
    const findings = await rolledBack(async (client) => {
      await plant(client, [...PLANT_REFERENCES, ...PLANT_UNIQUE_INDEXES]);
      return {
        scoped: tenantUniqueFindings(await uniqueIndexes(client, [...SCOPE, 'c16_parent'])),
        unscoped: tenantUniqueFindings(await uniqueIndexes(client, SCOPE)),
      };
    });
    expect(named(findings.scoped)).toEqual([...PLANTED_UNIQUE_FINDINGS]);
    expect(findings.unscoped).toEqual([]); // a table outside the TENANT and GUEST_CAPABLE classes is out of scope
  });

  it('[SEC-TC-76] [D-ARCH-163] [D-ARCH-208] C16 (b) planted on a GUEST_CAPABLE-scoped table: UNIQUE (code), EXCLUDE (code WITH =), UNIQUE NULLS NOT DISTINCT on either owner column and EXCLUDE (org_id WITH <>, code WITH =) are reported; UNIQUE (org_id, code), UNIQUE (guest_token_hash, code), EXCLUDE (org_id WITH =, code WITH =) through btree and through gist and the owner target keys are not; an entry naming an owner-scoped index is not live', async () => {
    const rows = await rolledBack(async (client) => {
      await plant(client, [...PLANT_GUEST_REFERENCES, ...PLANT_GUEST_UNIQUE_INDEXES]);
      return uniqueIndexes(client, [...SCOPE, 'c16_gparent']);
    });
    expect(named(tenantUniqueFindings(rows))).toEqual([...PLANTED_GUEST_UNIQUE_FINDINGS]);
    // Not vacuous: every exclusion constraint is read as an exclusion, with the equality fact of its owner column, and
    // both NULLS NOT DISTINCT indexes are read as such.
    expect(
      rows
        .filter((row) => row.kind === 'exclusion')
        .map((row) => [row.index, row.owner_columns.map((column) => `${column.column}:${String(column.equality)}`).join(',')]),
    ).toEqual([
      ['c16_gex_code', ''],
      ['c16_gex_gist_org_code', 'org_id:true'],
      ['c16_gex_org_code', 'org_id:true'],
      ['c16_gex_org_ne_code', 'org_id:false'],
    ]);
    expect(rows.filter((row) => row.nulls_not_distinct).map((row) => row.index)).toEqual([
      'c16_gux_guest_code_nnd',
      'c16_gux_org_code_nnd',
    ]);
    expect(uniqueExceptionFindings(rows, new Map([['c16_gux_guest_code', 'holds guest_token_hash']]))).toEqual([
      'c16_gux_guest_code: exception entry names no owner-free unique key in scope',
    ]);
  });

  it('[SEC-TC-76] C16 mutants of PR #65 (rolled back): the single-column membership key of D-ARCH-154 and the live-grant index without org_id of PR65-SEC-01 are both reported', async () => {
    const findings = await rolledBack(async (client) => {
      await plant(client, PLANT_PR65_MUTANTS);
      return {
        references: tenantReferenceFindings(await references(client)),
        unique: tenantUniqueFindings(await uniqueIndexes(client, SCOPE)),
      };
    });
    expect(findings).toEqual({
      references: ['fk_membership_roles__membership_id: membership_roles -> memberships is not bound through org_id (T1)'],
      unique: [
        'ux_membership_roles__membership_role_live (unique) on membership_roles has no owner column (org_id or guest_token_hash) among its key columns (PR65-SEC-01)',
      ],
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
