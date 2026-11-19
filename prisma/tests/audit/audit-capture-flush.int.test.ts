/**
 * One flush per transaction against a real PostgreSQL 18 with the bootstrap lane, as `platform_app` through the real
 * `withTenantTx` (ADR-0007 amendment 11 item 3, D-ARCH-122 I1-I4; ADR-0007 am. 10 items 2-3; PR42-SEC-17; TASK-029).
 *
 * What it proves on the database: N entries recorded in one transaction land with ONE head lock and ONE append on
 * their stream (consecutive `stream_seq`, each `prev_hash` the predecessor's `entry_hash`); two streams are locked in
 * ascending `stream_id` order before the first append; a head row held FOR UPDATE by a second session makes the flush
 * fail fast with 503 AUDIT_LOCK_TIMEOUT and makes a concurrent request of the same tenant fail with 503
 * TENANT_CONCURRENCY_LIMIT, the business row absent in both; an unflushed record (I3) and a foreign-organisation entry
 * (STREAM_MISMATCH) roll back; a deferred "read, then write" block commits only together with its entry (PR42-SEC-17).
 * The HTTP side of the same flows (problem+json, Retry-After, the capture middleware) is
 * apps/api/src/platform/audit/capture.api.test.ts. TASK-030 moves the statements into chain/** and owns E1-E4.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  type AuditEntryInput,
  type AuditSqlPort,
  type AuditWriter,
  createAuditWriter,
  createPrismaAuditStore,
  ZERO_HASH_HEX,
} from '@platform/audit';
import type pg from 'pg';

import { createDatabaseClient } from '../../../apps/api/src/platform/db/client.js';
import { DbError } from '../../../apps/api/src/platform/db/map-db-error.js';
import type { TenantDb } from '../../../apps/api/src/platform/db/tenant-db.js';
import { createWithTenantTx, type TenantTxRunner } from '../../../apps/api/src/platform/db/with-tenant-tx.js';
import { PRISMA_TREE_LOCK, withReadLock } from '../../../tools/test-support/fs-lock.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { PlatformPostgres } from '../harness/postgres.js';

type Db = TenantDb<Prisma.TransactionClient>;

/** RFC 9562 UUIDv7 (48-bit Unix milliseconds, version 7, variant 10, random tail). */
function uuidv7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const AUDIT_LOCK_TIMEOUT_MS = 250;
const USER = uuidv7();

let pgh: PlatformPostgres;
let admin: pg.Client;
let holder: pg.Client;
let client: PrismaClient;
let appUrl: string;
let runner: TenantTxRunner<Prisma.TransactionClient>;
const store = createPrismaAuditStore();
const writer: AuditWriter = createAuditWriter({ store, lockTimeoutMs: AUDIT_LOCK_TIMEOUT_MS });

const tenant = (orgId: string) => ({
  orgId,
  actorId: USER,
  actorScope: 'TENANT' as const,
  guestTokenHash: '',
  correlationId: `it-${randomUUID()}`,
});

/** An entry without personal values (no IP, user agent or reason), so no tokeniser is involved. */
const update = (orgId: string | null, entityId: string): AuditEntryInput => ({
  action: 'UPDATE',
  outcome: 'SUCCESS',
  entityName: 'address',
  entityId,
  orgId,
  actor: { type: 'USER', userId: USER, roles: ['Shipper'] },
  origin: { sourceApp: 'api', correlationId: `flush-${randomUUID()}`, httpMethod: 'PATCH', route: '/api/v1/address-book/:addressId' },
  newValue: { city: 'Pune' },
});

const insertAddress = (db: Db, orgId: string, id: string): Promise<number> =>
  db.$executeRaw`INSERT INTO public.flush_it_addresses (id, org_id, city) VALUES (${id}::uuid, ${orgId}::uuid, 'Pune')`;

async function count(sql: string, values: unknown[] = []): Promise<number> {
  const result = await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return result.rows[0]?.n ?? -1;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the operation to be rejected');
}

/** A port over the transaction's TenantDb that records the kind and stream of every audit statement (a query spy). */
function spied(db: Db): { port: AuditSqlPort; seen: string[] } {
  const seen: string[] = [];
  const kind = (strings: TemplateStringsArray, values: unknown[]): string => {
    const text = strings.join('?');
    if (text.includes('FOR UPDATE OF h')) return `lock ${String(values[1])}`;
    if (text.startsWith('INSERT INTO public.audit_stream_heads')) return `create-head ${String(values[0])}`;
    if (text.startsWith('WITH appended AS')) return `append ${String(values[0])}`;
    return 'other';
  };
  const port: AuditSqlPort = {
    $queryRaw: (strings, ...values) => {
      seen.push(kind(strings, values));
      return db.$queryRaw(strings, ...values);
    },
    $executeRaw: (strings, ...values) => {
      seen.push(kind(strings, values));
      return db.$executeRaw(strings, ...values);
    },
    markRollbackOnly: (failure) => db.markRollbackOnly(failure),
    track: (work) => db.track(work),
    beforeCommit: (check) => db.beforeCommit(check),
    contextOrgId: () => db.contextOrgId(),
  };
  return { port, seen };
}

interface Stored {
  readonly stream_id: string;
  readonly stream_seq: string;
  readonly entity_id: string;
  readonly prev_hash: string;
  readonly entry_hash: string;
  readonly occurred_us: string;
}

const stored = async (streamId: string): Promise<Stored[]> =>
  (
    await admin.query<Stored>(
      `SELECT stream_id::text, stream_seq::text, entity_id, encode(prev_hash, 'hex') AS prev_hash, encode(entry_hash, 'hex') AS entry_hash,
              ((extract(epoch FROM occurred_at) * 1000000)::bigint)::text AS occurred_us
         FROM public.audit_entries WHERE stream_id = $1 ORDER BY stream_seq`,
      [streamId],
    )
  ).rows;

function runnerWith(admission: { maxConcurrentTx: number; waitMs: number }): TenantTxRunner<Prisma.TransactionClient> {
  return createWithTenantTx(
    client,
    { statementTimeoutMs: 5_000, lockTimeoutMs: 2_000, idleInTransactionTimeoutMs: 15_000, poolConnectionTimeoutMs: 5_000, admission },
    {
      onSecurityEvent: () => undefined,
      countSessionContextLeak: () => undefined,
      markNotReady: () => undefined,
      scopeClient: () => client,
    },
  );
}

/** Takes the head row of `streamId` FOR UPDATE in a second session (creating it first); returns the release. */
async function holdHead(streamId: string): Promise<() => Promise<void>> {
  await runner.withTenantTx(tenant(streamId), (db) => writer.write(db, update(streamId, 'seed')));
  await holder.query('BEGIN');
  await holder.query('SELECT 1 FROM public.audit_stream_heads WHERE stream_id = $1 FOR UPDATE', [streamId]);
  return async () => {
    await holder.query('ROLLBACK');
  };
}

beforeAll(async () => {
  pgh = await PlatformPostgres.start();
  const database = await pgh.clone(await pgh.template({ migrated: false }));
  admin = await pgh.superuser(database);
  holder = await pgh.superuser(database);
  await admin.query(`CREATE TABLE public.flush_it_addresses (id uuid PRIMARY KEY, org_id uuid NOT NULL, city text NOT NULL);
                     GRANT SELECT, INSERT ON public.flush_it_addresses TO platform_app;`);
  appUrl = pgh.appUrl(database);
  const { PrismaClient: PrismaCtor } = await withReadLock(PRISMA_TREE_LOCK, () => import('../../generated/prisma/client.js'));
  client = createDatabaseClient(PrismaCtor, { connectionString: appUrl, poolMax: 6, applicationName: 'audit-flush-it' });
  runner = runnerWith({ maxConcurrentTx: 4, waitMs: 250 });
}, 240_000);

afterAll(async () => {
  await (client as PrismaClient | undefined)?.$disconnect();
  await (holder as pg.Client | undefined)?.end();
  await (admin as pg.Client | undefined)?.end();
  await (pgh as PlatformPostgres | undefined)?.stop();
}, 60_000);

describe('[D-ARCH-122] one flush per transaction on PostgreSQL 18', () => {
  it('two entries on one stream: one head lock, one append, consecutive seq, chained hashes, committed with the business row', async () => {
    const org = uuidv7();
    const address = uuidv7();
    let seen: string[] = [];
    await runner.withTenantTx(tenant(org), async (db) => {
      await insertAddress(db, org, address);
      const spy = spied(db);
      writer.record(spy.port, update(org, 'a-1'));
      writer.record(spy.port, update(org, 'a-2'));
      await writer.flush(spy.port);
      seen = spy.seen;
    });
    // first entries of a new stream: lock (empty) -> create head -> lock -> ONE append for both entries
    expect(seen).toEqual([`lock ${org}`, `create-head ${org}`, `lock ${org}`, `append ${org}`]);
    const rows = await stored(org);
    expect(rows.map((row) => [row.stream_seq, row.entity_id])).toEqual([
      ['1', 'a-1'],
      ['2', 'a-2'],
    ]);
    expect(rows[0]?.prev_hash).toBe(ZERO_HASH_HEX);
    expect(rows[1]?.prev_hash).toBe(rows[0]?.entry_hash);
    expect(BigInt(rows[1]?.occurred_us ?? '0')).toBeGreaterThan(BigInt(rows[0]?.occurred_us ?? '0'));
    const head = await admin.query<{ n: string; h: string }>(
      `SELECT entry_count::text AS n, encode(head_hash, 'hex') AS h FROM public.audit_stream_heads WHERE stream_id = $1`,
      [org],
    );
    expect(head.rows[0]).toEqual({ n: '2', h: rows[1]?.entry_hash });
    expect(await count('public.flush_it_addresses WHERE id = $1', [address])).toBe(1);

    // the next transaction on the same (now existing) stream: one lock, one append (the two-round-trip budget)
    let again: string[] = [];
    await runner.withTenantTx(tenant(org), async (db) => {
      const spy = spied(db);
      writer.record(spy.port, update(org, 'a-3'));
      writer.record(spy.port, update(org, 'a-4'));
      await writer.flush(spy.port);
      again = spy.seen;
    });
    expect(again).toEqual([`lock ${org}`, `append ${org}`]);
    const all = await stored(org);
    expect(all.map((row) => row.stream_seq)).toEqual(['1', '2', '3', '4']);
    expect(all[2]?.prev_hash).toBe(all[1]?.entry_hash);
  });

  it('two streams (the organisation and a SYSTEM shard): every head lock in ascending stream_id order before the first append', async () => {
    const org = 'ffffffff-ffff-7fff-bfff-' + randomBytes(6).toString('hex');
    const shard = '00000000-0000-0000-0000-000000000003';
    const system = createAuditWriter({ store, lockTimeoutMs: AUDIT_LOCK_TIMEOUT_MS, systemShard: () => 3 });
    let seen: string[] = [];
    await runner.withTenantTx(tenant(org), async (db) => {
      const spy = spied(db);
      system.record(spy.port, update(org, 'org-entry'));
      system.record(spy.port, update(null, 'shard-entry'));
      await system.flush(spy.port);
      seen = spy.seen;
    });
    const appendsAt = seen.findIndex((statement) => statement.startsWith('append'));
    const locks = seen.slice(0, appendsAt).filter((statement) => statement.startsWith('lock'));
    expect(locks.at(0)).toBe(`lock ${shard}`);
    expect(locks.at(-1)).toBe(`lock ${org}`);
    expect(seen.slice(appendsAt)).toEqual([`append ${shard}`, `append ${org}`]);
    expect((await stored(org)).map((row) => row.entity_id)).toEqual(['org-entry']);
    expect((await stored(shard)).some((row) => row.entity_id === 'shard-entry')).toBe(true);
  });

  it('[I3] entries recorded but never flushed: 500 AUDIT_WRITE_FAILED, neither the business row nor an entry persists', async () => {
    const org = uuidv7();
    const address = uuidv7();
    const error = await rejection(
      runner.withTenantTx(tenant(org), async (db) => {
        await insertAddress(db, org, address);
        writer.record(db, update(org, 'never-flushed'));
      }),
    );
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ status: 500, code: 'AUDIT_WRITE_FAILED' });
    expect(await count('public.flush_it_addresses WHERE id = $1', [address])).toBe(0);
    expect(await count('public.audit_entries WHERE stream_id = $1', [org])).toBe(0);
  });

  it('[STREAM_MISMATCH] a transaction of organisation A cannot write the stream of organisation B (audit_entries has no RLS)', async () => {
    const orgA = uuidv7();
    const orgB = uuidv7();
    const address = uuidv7();
    const error = await rejection(
      runner.withTenantTx(tenant(orgA), async (db) => {
        await insertAddress(db, orgA, address);
        try {
          writer.record(db, update(orgB, 'forged'));
        } catch {
          // swallowed on purpose: the latch still rolls the transaction back
        }
        await writer.flush(db);
      }),
    );
    expect(error).toMatchObject({ status: 500, code: 'AUDIT_WRITE_FAILED' });
    expect(await count('public.audit_entries WHERE stream_id = $1', [orgB])).toBe(0);
    expect(await count('public.flush_it_addresses WHERE id = $1', [address])).toBe(0);
  });

  it('[PR42-SEC-17] a detached "read, then write" block commits only together with its entry', async () => {
    const org = uuidv7();
    const address = uuidv7();
    await runner.withTenantTx(tenant(org), async (db) => {
      await insertAddress(db, org, address);
      void (async () => {
        await db.$queryRaw`SELECT city FROM public.flush_it_addresses WHERE id = ${address}::uuid`;
        await writer.write(db, update(org, address));
      })().catch(() => undefined);
    });
    expect(await count('public.flush_it_addresses WHERE id = $1', [address])).toBe(1);
    expect(await count('public.audit_entries WHERE stream_id = $1 AND entity_id = $2', [org, address])).toBe(1);
  });
});

describe('[ADR-0007 am. 10 items 2-3] a second session holding the head row FOR UPDATE', () => {
  it('AUDIT_LOCK_TIMEOUT: the flush fails within the audit lock timeout with a retryable 503 and the business row is absent', async () => {
    const org = uuidv7();
    const release = await holdHead(org);
    try {
      const address = uuidv7();
      const started = Date.now();
      const error = await rejection(
        runner.withTenantTx(tenant(org), async (db) => {
          await insertAddress(db, org, address);
          writer.record(db, update(org, address));
          await writer.flush(db);
        }),
      );
      const elapsed = Date.now() - started;
      expect(error).toBeInstanceOf(DbError);
      expect(error).toMatchObject({ status: 503, reason: 'AUDIT_LOCK_TIMEOUT', retryable: true, retryAfterSeconds: 1 });
      // bounded by the audit lock timeout, not the 2 s transaction lock_timeout (generous slack for a loaded host)
      expect(elapsed).toBeLessThan(1_900);
      expect(await count('public.flush_it_addresses WHERE id = $1', [address])).toBe(0);
    } finally {
      await release();
    }
  });

  it('TENANT_CONCURRENCY_LIMIT: while one request of the tenant waits on the held head, the next is refused with a retryable 503; its business row is absent', async () => {
    const org = uuidv7();
    const release = await holdHead(org);
    const narrow = runnerWith({ maxConcurrentTx: 1, waitMs: 50 });
    const patient = createAuditWriter({ store, lockTimeoutMs: 1_500 });
    const first = uuidv7();
    const second = uuidv7();
    // settles either way: a lock timeout (503) or, if the release came first, a commit
    const waiting = narrow
      .withTenantTx(tenant(org), async (db) => {
        await insertAddress(db, org, first);
        await patient.write(db, update(org, first));
      })
      .then(
        () => 'committed',
        () => 'rolled back',
      );
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const refused = await rejection(
        narrow.withTenantTx(tenant(org), async (db) => {
          await insertAddress(db, org, second);
          await patient.write(db, update(org, second));
        }),
      );
      expect(refused).toBeInstanceOf(DbError);
      expect(refused).toMatchObject({ status: 503, reason: 'TENANT_CONCURRENCY_LIMIT', retryable: true });
      expect(await count('public.flush_it_addresses WHERE id = $1', [second])).toBe(0);
    } finally {
      await release();
    }
    // the waiting request then times out on the audit lock (or commits if the release came first): never half-written
    expect(['committed', 'rolled back']).toContain(await waiting);
    const firstRows = await count('public.flush_it_addresses WHERE id = $1', [first]);
    const firstEntries = await count('public.audit_entries WHERE stream_id = $1 AND entity_id = $2', [org, first]);
    expect(firstEntries).toBe(firstRows);
  });
});

describe('[D-ARCH-122 (a)] a flush with personal values tokenises every entry in ONE batch, before any head lock', () => {
  it('two entries with IPs: one vault insert and one lookup, then the lock', async () => {
    const org = uuidv7();
    const subject = uuidv7();
    await admin.query(`INSERT INTO public.data_subjects (id, created_by, updated_by, kind, ref_id) VALUES ($1, $2, $2, 'USER', $2)`, [
      subject,
      USER,
    ]);
    const batches: number[] = [];
    const tokenising = createAuditWriter({
      store,
      lockTimeoutMs: AUDIT_LOCK_TIMEOUT_MS,
      tokeniser: {
        tokenise: (db, values) => {
          batches.push(values.length);
          return store.insertVaultRows(
            db,
            values.map((value) => ({
              token: uuidv7(),
              subjectId: subject,
              classification: value.classification,
              entityName: value.entityName,
              field: value.field,
              valueHmac: createHash('sha256').update(value.value).digest(),
              valueHmacKeyId: 'test-hmac-v1',
              ciphertext: randomBytes(40),
              ciphertextKeyId: 'test-key-v1',
            })),
            USER,
          );
        },
      },
    });
    let seen: string[] = [];
    await runner.withTenantTx(tenant(org), async (db) => {
      const spy = spied(db);
      tokenising.record(spy.port, { ...update(org, 'p-1'), origin: { ...update(org, 'p-1').origin, ip: '203.0.113.7' } });
      tokenising.record(spy.port, { ...update(org, 'p-2'), origin: { ...update(org, 'p-2').origin, ip: '203.0.113.8' } });
      await tokenising.flush(spy.port);
      seen = spy.seen;
    });
    expect(batches).toEqual([2]);
    expect(seen).toEqual(['other', 'other', `lock ${org}`, `create-head ${org}`, `lock ${org}`, `append ${org}`]);
    expect(await count('public.audit_entries WHERE stream_id = $1 AND ip_token IS NOT NULL', [org])).toBe(2);
  });
});
