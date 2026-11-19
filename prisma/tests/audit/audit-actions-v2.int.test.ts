/**
 * Audit action vocabulary v2 on PostgreSQL 18 (AT-US-087-07, CHECK half; REQ-AUDIT-002; D-ARCH-119, ADR-0007 amendment
 * 11 item 4; D-TASK025-03; TASK-285): prisma/bootstrap/91-audit-actions-v2.sql widens `ck_audit_entries__action` from
 * the 18 values of 10-audit.sql to the 20 REQ-AUDIT-002 actions.
 *
 * What it proves, on a FRESH database (the default lane, 91 applied after 90) and on an EXISTING one (a database that
 * applied 10-audit.sql and 90-audit-ddl-guard.sql before the file existed, then runs the lane again):
 *  - an entry with action MFA_RECOVERY_USED and one with SESSION_REVOKED are written through the writer (as
 *    platform_app, in the real tenant transaction runner) and read back; before the upgrade the database refused them;
 *  - the CHECK still refuses an unknown action (23514) and the entries stay immutable (no UPDATE/DELETE/TRUNCATE);
 *  - the effective constraint equals packages/audit AUDIT_ENTRY_ACTIONS value for value and in order, on the parent and
 *    on every audit_entries_YYYY_MM partition (inherited, not local), including partitions created after the upgrade;
 *  - the identity guard of 90 admits the ALTER only as platform_audit_owner: the same statement as the superuser
 *    without SET ROLE (guard) or as the migrator (not the owner) is refused with 42501;
 *  - the ledger records the file once; a second run is a no-op; with its ledger row removed the file re-applies cleanly
 *    and leaves the same constraint (idempotent).
 *
 * Stays with other tasks: the emitters (TASK-059 SESSION_REVOKED, TASK-061 MFA_RECOVERY_USED); the generated audit and
 * immutability-per-role suites (TASK-033).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  AUDIT_ENTRY_ACTIONS,
  type AppendedEntry,
  type AuditEntryAction,
  type AuditEntryInput,
  type AuditRowDraft,
  type AuditWriter,
  createAuditWriter,
  createPrismaAuditStore,
  prepareEntry,
} from '@platform/audit';
import pg from 'pg';

import { createDatabaseClient } from '../../../apps/api/src/platform/db/client.js';
import { DbError } from '../../../apps/api/src/platform/db/map-db-error.js';
import type { TenantDb } from '../../../apps/api/src/platform/db/tenant-db.js';
import { createWithTenantTx, type TenantTxRunner } from '../../../apps/api/src/platform/db/with-tenant-tx.js';
import { DEFAULT_BOOTSTRAP_DIR, LEDGER_TABLE } from '../../../tools/db/bootstrap.js';
import { quoteLiteral } from '../../../tools/db/sql-text.js';
import { PRISMA_TREE_LOCK, withReadLock } from '../../../tools/test-support/fs-lock.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { PlatformPostgres } from '../harness/postgres.js';

type AppTransactionClient = Prisma.TransactionClient;
type Db = TenantDb<AppTransactionClient>;

const WIDENING_FILE = '91-audit-actions-v2.sql';
const NEW_ACTIONS = ['MFA_RECOVERY_USED', 'SESSION_REVOKED'] as const satisfies readonly AuditEntryAction[];
const LOCK_TIMEOUT_MS = 250;
const GUARD_MESSAGE = 'audit objects are immutable (SEC-P3-03)';
/** The one ALTER TABLE statement of the widening file, exactly as the lane runs it. */
const WIDENING_DDL = ((): string => {
  const sql = readFileSync(join(DEFAULT_BOOTSTRAP_DIR, WIDENING_FILE), 'utf8');
  const start = sql.indexOf('ALTER TABLE public.audit_entries');
  return sql.slice(start, sql.indexOf(';', start) + 1);
})();

/** RFC 9562 UUIDv7 (48-bit Unix milliseconds, version 7, variant 10, random tail). */
function uuidv7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const USER = uuidv7();

interface Stack {
  readonly database: string;
  readonly admin: pg.Client;
  readonly client: PrismaClient;
  readonly runner: TenantTxRunner<AppTransactionClient>;
}

let pgh: PlatformPostgres | undefined;
let workDir: string | undefined;
let PrismaCtor: typeof PrismaClient | undefined;
const stacks: Stack[] = [];
let fresh: Stack;

const store = createPrismaAuditStore();
const writer: AuditWriter = createAuditWriter({ store, lockTimeoutMs: LOCK_TIMEOUT_MS });

const cluster = (): PlatformPostgres => {
  if (pgh === undefined) throw new Error('PostgreSQL container not started');
  return pgh;
};

/** A superuser connection, a Prisma client as platform_app and the real tenant transaction runner on `database`. */
async function openStack(database: string): Promise<Stack> {
  if (PrismaCtor === undefined) throw new Error('Prisma client not loaded');
  const admin = await cluster().superuser(database);
  const client = createDatabaseClient(PrismaCtor, {
    connectionString: cluster().appUrl(database),
    poolMax: 4,
    applicationName: 'audit-actions-v2-it',
  });
  const runner = createWithTenantTx(
    client,
    {
      statementTimeoutMs: 10_000,
      lockTimeoutMs: 2_000,
      idleInTransactionTimeoutMs: 15_000,
      poolConnectionTimeoutMs: 10_000,
      admission: { maxConcurrentTx: 4, waitMs: 1_000 },
    },
    {
      onSecurityEvent: () => undefined,
      countSessionContextLeak: () => undefined,
      markNotReady: () => undefined,
      scopeClient: () => client,
    },
  );
  const stack = { database, admin, client, runner };
  stacks.push(stack);
  return stack;
}

const tenant = (orgId: string) => ({
  orgId,
  actorId: USER,
  actorScope: 'TENANT' as const,
  guestTokenHash: '',
  correlationId: `v2-${randomUUID()}`,
});

/** A complete entry without personal values (no IP, no user agent), so no tokeniser is involved. */
const entry = (orgId: string, action: AuditEntryAction): AuditEntryInput => ({
  action,
  outcome: 'SUCCESS',
  entityName: action === 'MFA_RECOVERY_USED' ? 'mfa_recovery_code' : 'session',
  entityId: randomUUID(),
  orgId,
  actor: { type: 'USER', userId: USER, roles: ['Owner'], sessionId: uuidv7() },
  origin: { sourceApp: 'web', correlationId: `v2-${randomUUID()}`, httpMethod: 'POST', route: '/auth/v2-probe' },
});

const write = (stack: Stack, orgId: string, action: AuditEntryAction): Promise<AppendedEntry> =>
  stack.runner.withTenantTx(tenant(orgId), (db) => writer.write(db, entry(orgId, action)));

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the operation to be rejected');
}

interface StoredRow {
  readonly action: string;
  readonly outcome: string;
  readonly entity_name: string;
  readonly stream_seq: string;
  readonly entry_hash: string;
}

async function stored(stack: Stack, id: string): Promise<StoredRow[]> {
  const result = await stack.admin.query<StoredRow>(
    `SELECT action, outcome, entity_name, stream_seq::text, encode(entry_hash, 'hex') AS entry_hash
       FROM public.audit_entries WHERE id = $1`,
    [id],
  );
  return result.rows;
}

/** The quoted values of a deparsed `= ANY (ARRAY['A'::text, …])` CHECK, in order. */
const values = (def: string): string[] => [...def.matchAll(/'((?:[^']|'')*)'::/g)].map((match) => match[1] as string);

interface ConstraintRow {
  readonly relname: string;
  readonly conislocal: boolean | null;
  readonly coninhcount: number | null;
  readonly convalidated: boolean | null;
  readonly def: string | null;
}

/** `ck_audit_entries__action` on the parent (first row) and on every partition (attached, by name). */
async function actionConstraints(stack: Stack): Promise<{ parent: ConstraintRow; partitions: ConstraintRow[] }> {
  const sql = `
    SELECT c.relname, k.conislocal, k.coninhcount, k.convalidated, pg_catalog.pg_get_constraintdef(k.oid) AS def
      FROM pg_catalog.pg_class c
      LEFT JOIN pg_catalog.pg_constraint k ON k.conrelid = c.oid AND k.conname = 'ck_audit_entries__action'
     WHERE c.oid = 'public.audit_entries'::regclass
        OR c.oid IN (SELECT i.inhrelid FROM pg_catalog.pg_inherits i WHERE i.inhparent = 'public.audit_entries'::regclass)
     ORDER BY c.relname = 'audit_entries' DESC, c.relname`;
  const [parent, ...partitions] = (await stack.admin.query<ConstraintRow>(sql)).rows;
  if (parent === undefined) throw new Error('public.audit_entries not found');
  return { parent, partitions };
}

/** Asserts the widened CHECK on the parent and its propagation to every partition; returns the partition names. */
async function expectWidened(stack: Stack): Promise<string[]> {
  const { parent, partitions } = await actionConstraints(stack);
  expect(parent).toMatchObject({ relname: 'audit_entries', conislocal: true, coninhcount: 0, convalidated: true });
  expect(values(parent.def ?? '')).toEqual([...AUDIT_ENTRY_ACTIONS]);
  expect(partitions.length).toBeGreaterThanOrEqual(4);
  for (const { relname, ...constraint } of partitions) {
    expect(relname).toMatch(/^audit_entries_\d{4}_\d{2}$/);
    // inherited from the parent (never a local copy), so the next DROP/ADD on the parent reaches it too
    expect(constraint).toEqual({
      conislocal: false,
      coninhcount: 1,
      convalidated: true,
      def: parent.def,
    });
  }
  return partitions.map((partition) => partition.relname);
}

async function ledger(stack: Stack): Promise<string[]> {
  const result = await stack.admin.query<{ file_name: string }>(`SELECT file_name FROM ${LEDGER_TABLE} ORDER BY applied_at, file_name`);
  return result.rows.map((row) => row.file_name);
}

/** SQLSTATE and message of `sql` in a transaction that is always rolled back; `none` when it succeeds. */
async function attempt(config: pg.ClientConfig, statements: readonly string[]): Promise<{ code: string; message: string }> {
  const client = new pg.Client(config);
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const statement of statements) await client.query(statement);
    return { code: 'none', message: '' };
  } catch (error) {
    return { code: String((error as { code?: unknown }).code), message: (error as Error).message };
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'audit-actions-v2-'));
  pgh = await PlatformPostgres.start();
  ({ PrismaClient: PrismaCtor } = await withReadLock(PRISMA_TREE_LOCK, () => import('../../generated/prisma/client.js')));
  fresh = await openStack(await pgh.clone(await pgh.template({ migrated: false })));
}, 240_000);

afterAll(async () => {
  for (const stack of stacks) {
    await stack.client.$disconnect();
    await stack.admin.end();
  }
  await pgh?.stop();
  if (workDir !== undefined) rmSync(workDir, { recursive: true, force: true });
}, 60_000);

describe('[AT-US-087-07] a fresh database: the lane applies 91-audit-actions-v2.sql after the guard', () => {
  it('the ledger ends with the widening file; the CHECK equals AUDIT_ENTRY_ACTIONS on the parent and every partition', async () => {
    const files = await ledger(fresh);
    expect(files.slice(-3)).toEqual(['10-audit.sql', '90-audit-ddl-guard.sql', WIDENING_FILE]);
    expect(files.filter((name) => name === WIDENING_FILE)).toHaveLength(1);
    await expectWidened(fresh);
  });

  it.each(NEW_ACTIONS)('an entry with action %s is written through the writer and read back', async (action) => {
    const org = uuidv7();
    const written = await write(fresh, org, action);
    expect(await stored(fresh, written.id)).toEqual([
      {
        action,
        outcome: 'SUCCESS',
        entity_name: action === 'MFA_RECOVERY_USED' ? 'mfa_recovery_code' : 'session',
        stream_seq: '1',
        entry_hash: written.entryHash,
      },
    ]);
  });

  it('[AT-US-087-05] the CHECK still refuses an unknown action (23514) and nothing persists', async () => {
    const org = uuidv7();
    const forgedId = uuidv7();
    const valid = prepareEntry(entry(org, 'SESSION_REVOKED'), { id: forgedId, systemShard: 0 }).complete([]);
    const forged = { ...valid, action: 'FOO' } as unknown as AuditRowDraft;
    const error = await rejection(
      fresh.runner.withTenantTx(tenant(org), (db) => store.appendBatch(db, [forged], { lockTimeoutMs: LOCK_TIMEOUT_MS, actorStamp: USER })),
    );
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ status: 500, sqlState: '23514' });
    expect((await fresh.admin.query('SELECT 1 FROM public.audit_entries WHERE id = $1', [forgedId])).rowCount).toBe(0);
  });

  it('immutability holds for the new actions: no UPDATE/DELETE for platform_app; the triggers refuse even the superuser', async () => {
    const org = uuidv7();
    const written = await write(fresh, org, 'SESSION_REVOKED');
    for (const statement of [
      (db: Db) => db.$executeRaw`UPDATE public.audit_entries SET action = 'LOGOUT' WHERE id = ${written.id}::uuid`,
      (db: Db) => db.$executeRaw`DELETE FROM public.audit_entries WHERE id = ${written.id}::uuid`,
    ]) {
      const error = await rejection(fresh.runner.withTenantTx(tenant(org), statement));
      expect(error).toMatchObject({ status: 500, reason: 'DB_PRIVILEGE_DENIED', sqlState: '42501' });
    }
    const superuser = cluster().bootstrapConnection(fresh.database);
    for (const sql of [
      `UPDATE public.audit_entries SET action = 'LOGOUT' WHERE id = ${quoteLiteral(written.id)}`,
      `DELETE FROM public.audit_entries WHERE id = ${quoteLiteral(written.id)}`,
      'TRUNCATE public.audit_entries',
    ]) {
      const outcome = await attempt(superuser, [sql]);
      expect(outcome.code).toBe('42501');
      expect(outcome.message).toMatch(/^AUDIT_IMMUTABLE: /);
    }
    expect(await stored(fresh, written.id)).toEqual([
      expect.objectContaining({ action: 'SESSION_REVOKED', entry_hash: written.entryHash }),
    ]);
  });

  it('the guard admits the widening only as platform_audit_owner: the superuser without SET ROLE and the migrator are refused (42501)', async () => {
    expect(WIDENING_DDL).toMatch(
      /^ALTER TABLE public\.audit_entries\s+DROP CONSTRAINT IF EXISTS ck_audit_entries__action,\s+ADD CONSTRAINT/,
    );
    const superuser = cluster().bootstrapConnection(fresh.database);
    const unrolled = await attempt(superuser, [WIDENING_DDL]);
    expect(unrolled.code).toBe('42501');
    expect(unrolled.message).toBe(GUARD_MESSAGE);
    const migrator = await attempt(cluster().migratorConnection(fresh.database), [WIDENING_DDL]);
    expect(migrator.code).toBe('42501');
    expect(migrator.message).toMatch(/^must be owner of table audit_entries$/);
    expect(await attempt(superuser, ['SET ROLE platform_audit_owner', WIDENING_DDL])).toEqual({ code: 'none', message: '' });
    await expectWidened(fresh);
  });
});

describe('[AT-US-087-07] an existing database: 10-audit.sql and 90-audit-ddl-guard.sql applied before the widening existed', () => {
  let existing: Stack;
  let before: Awaited<ReturnType<typeof actionConstraints>>;

  beforeAll(async () => {
    const lane = mkdtempSync(join(workDir ?? tmpdir(), 'lane-v1-'));
    cpSync(DEFAULT_BOOTSTRAP_DIR, lane, { recursive: true });
    rmSync(join(lane, WIDENING_FILE));
    const database = `v1_${randomBytes(3).toString('hex')}`;
    await cluster().createDatabase(database);
    const v1 = await cluster().bootstrap(database, lane);
    expect(v1.applied.slice(-2)).toEqual(['10-audit.sql', '90-audit-ddl-guard.sql']);
    existing = await openStack(database);
    before = await actionConstraints(existing);
  }, 240_000);

  it('before the upgrade the 18-value CHECK refuses both new actions (23514), although the writer accepts them', async () => {
    expect(values(before.parent.def ?? '')).toEqual(
      AUDIT_ENTRY_ACTIONS.filter((action) => !(NEW_ACTIONS as readonly string[]).includes(action)),
    );
    for (const action of NEW_ACTIONS) {
      const error = await rejection(write(existing, uuidv7(), action));
      expect(error).toBeInstanceOf(DbError);
      expect((error as DbError).toJSON()).toMatchObject({ status: 500, code: 'AUDIT_WRITE_FAILED', sqlState: '23514' });
    }
  });

  it('the lane applies only the widening file (the guard admits it), and a second run is a no-op', async () => {
    const upgrade = await cluster().bootstrap(existing.database);
    expect(upgrade.applied).toEqual([WIDENING_FILE]);
    expect(upgrade.skipped).not.toContain(WIDENING_FILE);
    const again = await cluster().bootstrap(existing.database);
    expect(again.applied).toEqual([]);
    expect(again.skipped.at(-1)).toBe(WIDENING_FILE);
    const files = await ledger(existing);
    expect(files.at(-1)).toBe(WIDENING_FILE);
    expect(files.filter((name) => name === WIDENING_FILE)).toHaveLength(1);
    // the guard is still installed and enabled ALWAYS after the upgrade
    const triggers = await existing.admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_catalog.pg_event_trigger WHERE evtenabled = 'A'`,
    );
    expect(triggers.rows[0]?.n).toBe(2);
    const partitions = await expectWidened(existing);
    expect(partitions).toEqual(before.partitions.map((partition) => partition.relname));
  });

  it.each(NEW_ACTIONS)('after the upgrade an entry with action %s is written through the writer and read back', async (action) => {
    const written = await write(existing, uuidv7(), action);
    expect(await stored(existing, written.id)).toEqual([
      expect.objectContaining({ action, outcome: 'SUCCESS', entry_hash: written.entryHash }),
    ]);
  });

  it('partitions created after the upgrade (ensure_audit_partitions) inherit the widened CHECK', async () => {
    const created = await existing.admin.query<{ n: number }>('SELECT platform.ensure_audit_partitions(6) AS n');
    expect(created.rows[0]?.n).toBe(3);
    const partitions = await expectWidened(existing);
    expect(partitions.length).toBe(before.partitions.length + 3);
  });

  it('with its ledger row removed the file re-applies cleanly and leaves the same constraint (idempotent)', async () => {
    const { parent } = await actionConstraints(existing);
    await existing.admin.query(`DELETE FROM ${LEDGER_TABLE} WHERE file_name = $1`, [WIDENING_FILE]);
    const rerun = await cluster().bootstrap(existing.database);
    expect(rerun.applied).toEqual([WIDENING_FILE]);
    expect((await actionConstraints(existing)).parent.def).toBe(parent.def);
    await expectWidened(existing);
  });
});
