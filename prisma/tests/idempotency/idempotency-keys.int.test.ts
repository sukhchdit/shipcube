/**
 * `idempotency_keys` on the real client and PostgreSQL 18 (REQ-API-009..011, DR-A20; ADR-0014; data-model §3.5, §6.2;
 * TASK-040): the statements of the idempotency store (apps/api/src/platform/idempotency/store.ts), issued exactly as it
 * issues them, through `systemDelegates(tx).idempotencyKey` inside tenant transactions opened on the client scoped by
 * `withStandardColumns` (the production scoping), so the standard-columns guard checks every row against the actor.
 * prisma/tests may import only the api database platform, so the store module itself is not imported here; its
 * protocol is unit- and API-tested in apps/api over the same port (store.test.ts, idempotency.api.test.ts).
 * - Claim: `createManyAndReturn` with `skipDuplicates` inserts once; a second claim of the scope inserts nothing.
 * - Two concurrent claims of one scope: the second waits on `ux_idempotency_keys__scope_hash` until the first commits,
 *   then inserts nothing and reads the IN_PROGRESS row (AT-US-038-05).
 * - Completion (`updateMany` conditional on id, version, IN_PROGRESS) bumps the version; a stale version matches nothing.
 * - Lease takeover (`updateManyAndReturn`) and the release / expiry deletes (`deleteMany`) with their conditions.
 * - The CHECKs and the grants: SELECT, INSERT, UPDATE, DELETE for platform_app (hard-delete allow-list).
 */
import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { createDatabaseClient } from '../../../apps/api/src/platform/db/client.js';
import { serverStamped, withStandardColumns } from '../../../apps/api/src/platform/db/index.js';
import { systemDelegates } from '../../../apps/api/src/platform/db/system-db.js';
import type { TenantDb } from '../../../apps/api/src/platform/db/tenant-db.js';
import { createWithTenantTx, type TenantContext } from '../../../apps/api/src/platform/db/with-tenant-tx.js';
import { PRISMA_TREE_LOCK, withReadLock } from '../../../tools/test-support/fs-lock.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { APP_ROLE, PlatformPostgres } from '../harness/postgres.js';

type Tx = Prisma.TransactionClient;

const ORG = '0193a5b2-7c1e-7d4a-9f3b-0000000000a0';
const USER = '0193a5b2-7c1e-7d4a-9f3b-0000000000a1';
/** The reserved ANONYMOUS actor (data-model §1.6; `ANONYMOUS_ACTOR_ID` of @platform/shared). */
const ANONYMOUS = '00000000-0000-7000-8000-000000000002';
const CALLER: TenantContext = { orgId: ORG, actorId: USER, actorScope: 'TENANT', guestTokenHash: '', correlationId: 'idem-it' };
const GUEST: TenantContext = { orgId: '', actorId: '', actorScope: 'TENANT', guestTokenHash: '', correlationId: 'idem-it' };

const LEASE_MS = 30_000;
const TTL_MS = 24 * 60 * 60 * 1_000;

let postgres: PlatformPostgres;
let database: string;
let client: PrismaClient;
let withTenantTx: <R>(ctx: TenantContext, fn: (db: TenantDb<Tx>) => Promise<R>) => Promise<R>;

const bytes = (): Uint8Array<ArrayBuffer> => new Uint8Array(randomBytes(32));

/** The store's claim statement: the inserted row, or undefined when the scope already has one. */
async function claim(db: TenantDb<Tx>, scopeHash: Uint8Array<ArrayBuffer>, fingerprint = new Uint8Array(32).fill(1), at = Date.now()) {
  const rows = await systemDelegates(db).idempotencyKey.createManyAndReturn({
    data: [
      serverStamped<Prisma.IdempotencyKeyCreateManyInput>({
        scopeHash,
        scopeOrgId: ORG,
        actorId: USER,
        method: 'POST',
        path: '/api/v1/orders',
        idemKey: randomUUID(),
        fingerprint,
        status: 'IN_PROGRESS',
        leaseUntil: new Date(at + LEASE_MS),
        expiresAt: new Date(at + TTL_MS),
      }),
    ],
    skipDuplicates: true,
    select: { id: true, version: true },
  });
  return rows[0];
}

async function rowOf(scopeHash: Uint8Array): Promise<Record<string, unknown> | undefined> {
  const admin = await postgres.superuser(database);
  try {
    const result = await admin.query(
      `SELECT id::text, status, version, created_by::text, updated_by::text, response_status, response_body, response_body_key_id,
              response_headers
         FROM public.idempotency_keys WHERE scope_hash = $1`,
      [Buffer.from(scopeHash)],
    );
    return result.rows[0] as Record<string, unknown> | undefined;
  } finally {
    await admin.end();
  }
}

beforeAll(async () => {
  postgres = await PlatformPostgres.start();
  database = await postgres.clone(await postgres.template({ migrated: true }));
  const { PrismaClient: PrismaCtor } = await withReadLock(PRISMA_TREE_LOCK, () => import('../../generated/prisma/client.js'));
  client = createDatabaseClient(PrismaCtor, {
    connectionString: postgres.appUrl(database),
    poolMax: 4,
    applicationName: 'idempotency-keys-it',
    connectionTimeoutMs: 5_000,
  });
  ({ withTenantTx } = createWithTenantTx(
    client,
    { statementTimeoutMs: 5_000, lockTimeoutMs: 4_000, idleInTransactionTimeoutMs: 15_000, poolConnectionTimeoutMs: 5_000 },
    {
      onSecurityEvent: () => undefined,
      countSessionContextLeak: () => undefined,
      markNotReady: () => undefined,
      scopeClient: (stamp) => withStandardColumns(client, stamp),
    },
  ));
}, 300_000);

afterAll(async () => {
  await client?.$disconnect();
  await postgres?.stop();
});

describe('[REQ-API-011] idempotency_keys statements (PostgreSQL 18)', () => {
  it('[AT-US-038-01] a claim inserts once, stamped with the caller; a second claim of the scope inserts nothing', async () => {
    const scope = bytes();
    const first = await withTenantTx(CALLER, (db) => claim(db, scope));
    expect(first).toEqual({ id: expect.any(String), version: 1 });
    expect(await withTenantTx(CALLER, (db) => claim(db, scope))).toBeUndefined();
    expect(await rowOf(scope)).toMatchObject({ status: 'IN_PROGRESS', version: 1, created_by: USER, updated_by: USER });
  });

  it('a guest (no actor) claim is stamped with the ANONYMOUS actor and accepted by the guard', async () => {
    const scope = bytes();
    expect(await withTenantTx(GUEST, (db) => claim(db, scope))).toBeDefined();
    expect(await rowOf(scope)).toMatchObject({ created_by: ANONYMOUS, updated_by: ANONYMOUS });
  });

  it('[AT-US-038-05] two concurrent claims of one scope: exactly one inserts; the other then reads IN_PROGRESS', async () => {
    const scope = bytes();
    const attempt = async (db: TenantDb<Tx>) => {
      const won = await claim(db, scope);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const row = await systemDelegates(db).idempotencyKey.findUnique({ where: { scopeHash: scope }, select: { status: true } });
      return { won: won !== undefined, status: row?.status };
    };
    const results = await Promise.all([withTenantTx(CALLER, attempt), withTenantTx(CALLER, attempt)]);
    expect(results.filter((result) => result.won)).toHaveLength(1);
    expect(results.map((result) => result.status)).toEqual(['IN_PROGRESS', 'IN_PROGRESS']);
  });

  it('[SEC-TC-04] completion stores status, headers and a ciphertext body with its key id, conditional on the claim version', async () => {
    const scope = bytes();
    const claimed = await withTenantTx(CALLER, (db) => claim(db, scope));
    if (claimed === undefined) throw new Error('claim failed');
    const ciphertext = new Uint8Array(randomBytes(64));
    const complete = (version: number) => (db: TenantDb<Tx>) =>
      systemDelegates(db).idempotencyKey.updateMany({
        where: { id: claimed.id, version, status: 'IN_PROGRESS' },
        data: {
          status: 'COMPLETED',
          responseStatus: 201,
          responseHeaders: { Location: '/api/v1/orders/1' },
          responseBody: ciphertext,
          responseBodyKeyId: 'idempotency-body-v1',
        },
      });
    expect(await withTenantTx(CALLER, complete(7))).toEqual({ count: 0 });
    expect(await withTenantTx(CALLER, complete(claimed.version))).toEqual({ count: 1 });
    const row = await rowOf(scope);
    expect(row).toMatchObject({ status: 'COMPLETED', version: 2, response_status: 201, response_body_key_id: 'idempotency-body-v1' });
    expect(Buffer.from(row?.['response_body'] as Buffer).equals(Buffer.from(ciphertext))).toBe(true);
    expect(row?.['response_headers']).toEqual({ Location: '/api/v1/orders/1' });
  });

  it('a lease takeover returns the new version; a release and an expired-key delete match only their conditions', async () => {
    const scope = bytes();
    const claimed = await withTenantTx(CALLER, (db) => claim(db, scope, undefined, Date.now() - 2 * LEASE_MS));
    if (claimed === undefined) throw new Error('claim failed');
    const taken = await withTenantTx(CALLER, (db) =>
      systemDelegates(db).idempotencyKey.updateManyAndReturn({
        where: { id: claimed.id, version: claimed.version, status: 'IN_PROGRESS' },
        data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
        select: { id: true, version: true },
      }),
    );
    expect(taken).toEqual([{ id: claimed.id, version: 2 }]);
    const release = (version: number) => (db: TenantDb<Tx>) =>
      systemDelegates(db).idempotencyKey.deleteMany({ where: { id: claimed.id, version, status: 'IN_PROGRESS' } });
    expect(await withTenantTx(CALLER, release(1))).toEqual({ count: 0 });
    expect(await withTenantTx(CALLER, release(2))).toEqual({ count: 1 });
    expect(await rowOf(scope)).toBeUndefined();

    const expiring = bytes();
    const old = await withTenantTx(CALLER, (db) => claim(db, expiring, undefined, Date.now() - TTL_MS - 1_000));
    if (old === undefined) throw new Error('claim failed');
    const purge = await withTenantTx(CALLER, (db) =>
      systemDelegates(db).idempotencyKey.deleteMany({ where: { id: old.id, expiresAt: { lte: new Date() } } }),
    );
    expect(purge).toEqual({ count: 1 });
    expect(await withTenantTx(CALLER, (db) => claim(db, expiring))).toBeDefined();
  });

  it('the CHECKs refuse a malformed key, a half-stored body, a stored 5xx or 429, and a completed row without a status', async () => {
    const app = new pg.Client({ connectionString: postgres.appUrl(database) });
    await app.connect();
    const insert = (columns: Record<string, unknown>) => {
      const base: Record<string, unknown> = {
        created_by: ANONYMOUS,
        updated_by: ANONYMOUS,
        scope_hash: randomBytes(32),
        method: 'POST',
        path: '/x',
        idem_key: 'k',
        fingerprint: randomBytes(32),
        status: 'IN_PROGRESS',
        lease_until: new Date(),
        expires_at: new Date(),
        ...columns,
      };
      const names = Object.keys(base);
      const values = names.map((name) => base[name]);
      return app.query(
        `INSERT INTO public.idempotency_keys (${names.join(', ')}) VALUES (${names.map((_n, i) => `$${String(i + 1)}`).join(', ')})`,
        values,
      );
    };
    try {
      await expect(insert({ idem_key: 'has space' })).rejects.toMatchObject({ code: '23514' });
      await expect(insert({ idem_key: 'k'.repeat(256) })).rejects.toMatchObject({ code: '23514' });
      await expect(insert({ scope_hash: randomBytes(16) })).rejects.toMatchObject({ code: '23514' });
      await expect(insert({ method: 'GET' })).rejects.toMatchObject({ code: '23514' });
      await expect(insert({ status: 'COMPLETED', response_status: 201, response_body: randomBytes(40) })).rejects.toMatchObject({
        code: '23514',
      });
      await expect(insert({ status: 'COMPLETED', response_status: 500 })).rejects.toMatchObject({ code: '23514' });
      await expect(insert({ status: 'COMPLETED', response_status: 429 })).rejects.toMatchObject({ code: '23514' });
      await expect(insert({ status: 'COMPLETED' })).rejects.toMatchObject({ code: '23514' });
      await expect(insert({ status: 'IN_PROGRESS', response_status: 201 })).rejects.toMatchObject({ code: '23514' });
      await expect(
        insert({ status: 'COMPLETED', response_status: 201, response_body: randomBytes(40), response_body_key_id: 'Bad Id' }),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        insert({ status: 'COMPLETED', response_status: 422, response_body: randomBytes(40), response_body_key_id: 'idempotency-body-v1' }),
      ).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await app.end();
    }
  });

  it('[PR19-SEC-01] platform_app holds SELECT, INSERT, UPDATE and DELETE (SYSTEM hard-delete allow-list), nothing else', async () => {
    const app = new pg.Client({ connectionString: postgres.appUrl(database) });
    await app.connect();
    try {
      const { rows } = await app.query(
        "SELECT privilege_type FROM information_schema.role_table_grants WHERE table_name = 'idempotency_keys' AND grantee = $1 ORDER BY 1",
        [APP_ROLE],
      );
      expect(rows.map((row: { privilege_type: string }) => row.privilege_type)).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
      await expect(app.query('TRUNCATE public.idempotency_keys')).rejects.toMatchObject({ code: '42501' });
    } finally {
      await app.end();
    }
  });
});
