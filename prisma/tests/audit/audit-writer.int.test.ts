/**
 * The audit writer core against a real PostgreSQL 18 with the bootstrap lane applied (prisma/bootstrap/10-audit.sql:
 * partitioned `audit_entries`, stream heads, vault, triggers and grants), connected as `platform_app` through the real
 * `withTenantTx` runner (REQ-AUDIT-002/003/004/010/011; ADR-0007 §Capture and amendment 10; data-model §5.4; US-087,
 * US-088; TASK-025).
 *
 * What it proves: the entry joins the business transaction it is handed (both commit or neither does); an audit
 * failure maps to 500 AUDIT_WRITE_FAILED and a head-row lock timeout to 503 with Retry-After, the business row rolled
 * back in both cases; the stored row carries every field and its hash recomputes from the DATABASE representation
 * (jsonb, inet, bytea, timestamps); the chain links and stays gap-free under a concurrent rollback; the vault batch
 * dedupes; the database refuses an unknown action and every mutation of an entry.
 *
 * Stays with other tasks: the exact statement sequence and round-trip budget, 50 parallel writers and the token plan
 * against a 100 k-row vault (TASK-030 E1-E4); the descriptor-driven capture middleware (TASK-029); the generated audit
 * and immutability-per-role suites (TASK-033). The HTTP mapping of the same failures (problem+json, Retry-After) is
 * apps/api/src/platform/audit/audit-failure.api.test.ts.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  type AppendedEntry,
  type AuditEntryInput,
  type AuditRowDraft,
  type AuditWriter,
  coarseNetwork,
  computeEntryHash,
  createAuditWriter,
  createPrismaAuditStore,
  type PiiTokeniser,
  prepareEntry,
  type VaultRow,
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

type AppTransactionClient = Prisma.TransactionClient;
type Db = TenantDb<AppTransactionClient>;

/** RFC 9562 UUIDv7 (48-bit Unix milliseconds, version 7, variant 10, random tail). */
function uuidv7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const LOCK_TIMEOUT_MS = 250;
const TX_LOCK_TIMEOUT_MS = 2_000;
const USER = uuidv7();
const CONTACT = uuidv7();

let pgh: PlatformPostgres;
let database: string;
let admin: pg.Client;
let client: PrismaClient;
let runner: TenantTxRunner<AppTransactionClient>;
let writer: AuditWriter;

const tenant = (orgId: string, correlationId = `it-${randomUUID()}`) => ({
  orgId,
  actorId: USER,
  actorScope: 'TENANT' as const,
  guestTokenHash: '',
  correlationId,
});

/**
 * Test double of the TASK-028 tokeniser: resolves subjects to seeded `data_subjects` rows, uses SHA-256 as the HMAC and
 * random bytes as the "ciphertext", and writes through the real store batch (statements 1 and 1b).
 */
const subjects = new Map<string, string>();
const tokeniser: PiiTokeniser = {
  tokenise: (db, values) => {
    const rows: VaultRow[] = values.map((value) => ({
      token: uuidv7(),
      subjectId: subjects.get(value.subject === null ? `CONTACT:${CONTACT}` : `${value.subject.kind}:${value.subject.refId}`) ?? '',
      classification: value.classification,
      entityName: value.entityName,
      field: value.field,
      valueHmac: createHash('sha256').update(value.value).digest(),
      valueHmacKeyId: 'test-hmac-v1',
      ciphertext: randomBytes(40),
      ciphertextKeyId: 'test-key-v1',
    }));
    return store.insertVaultRows(db, rows, USER);
  },
};
const store = createPrismaAuditStore();

const login = (orgId: string, overrides: Partial<AuditEntryInput> = {}): AuditEntryInput => ({
  action: 'LOGIN',
  outcome: 'SUCCESS',
  entityName: 'session',
  entityId: randomUUID(),
  orgId,
  actor: { type: 'USER', userId: USER, roles: ['Owner', 'Shipper'], sessionId: uuidv7() },
  origin: {
    sourceApp: 'web',
    correlationId: `login-${randomUUID()}`,
    ip: '203.0.113.77',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:146.0) Gecko/20100101 Firefox/146.0',
    uaParsed: 'Firefox 146 / Windows',
    httpMethod: 'POST',
    route: '/auth/login',
  },
  ...overrides,
});

const createAddress = (orgId: string, id: string, overrides: Partial<AuditEntryInput> = {}): AuditEntryInput => ({
  action: 'CREATE',
  outcome: 'SUCCESS',
  entityName: 'address',
  entityId: id,
  orgId,
  actor: { type: 'USER', userId: USER, roles: ['Shipper'] },
  origin: { sourceApp: 'web', correlationId: `addr-${randomUUID()}`, httpMethod: 'POST', route: '/addresses' },
  newValue: { city: 'Pune', country: 'IN' },
  ...overrides,
});

const insertAddress = (db: Db, orgId: string, id: string): Promise<number> =>
  db.$executeRaw`INSERT INTO public.writer_it_addresses (id, org_id, city) VALUES (${id}::uuid, ${orgId}::uuid, 'Pune')`;

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

interface StoredEntry {
  readonly [column: string]: unknown;
}

/** Every column of the entries of `entityId` (or a stream), read back as the verifier would read it. */
async function stored(where: string, value: string): Promise<StoredEntry[]> {
  const result = await admin.query<StoredEntry>(
    `SELECT id::text, ((extract(epoch FROM occurred_at) * 1000000)::bigint)::text AS occurred_us, stream_id::text, stream_seq::text,
            org_id::text, target_org_id::text, scope_org_id::text, on_behalf_of_org_id::text, actor_type, user_id::text,
            api_key_id::text, job_name, actor_roles, session_id::text, ip_token::text, encode(ip_hash, 'hex') AS ip_hash,
            ip_hash_key_id, ip_coarse::text, user_agent_token::text, ua_parsed, source_app, correlation_id, action, entity_name,
            entity_id, outcome, reason_token::text, reauth_proof_id::text, signature_meaning, http_method, route, old_value,
            new_value, details, pii_token_count, hash_version, encode(prev_hash, 'hex') AS prev_hash,
            encode(entry_hash, 'hex') AS entry_hash, occurred_at AT TIME ZONE 'UTC' AS occurred_utc
       FROM public.audit_entries WHERE ${where} = $1 ORDER BY stream_id, stream_seq`,
    [value],
  );
  return result.rows;
}

/** The hash recomputed from the DATABASE representation of a row (what TASK-116's verifier does). */
function recomputed(row: StoredEntry): string {
  const draft = {
    id: row['id'],
    streamId: row['stream_id'],
    orgId: row['org_id'],
    targetOrgId: row['target_org_id'],
    onBehalfOfOrgId: row['on_behalf_of_org_id'],
    actorType: row['actor_type'],
    userId: row['user_id'],
    apiKeyId: row['api_key_id'],
    jobName: row['job_name'],
    actorRoles: row['actor_roles'],
    sessionId: row['session_id'],
    ipToken: row['ip_token'],
    ipHash: row['ip_hash'],
    ipHashKeyId: row['ip_hash_key_id'],
    ipCoarse: row['ip_coarse'],
    userAgentToken: row['user_agent_token'],
    uaParsed: row['ua_parsed'],
    sourceApp: row['source_app'],
    correlationId: row['correlation_id'],
    action: row['action'],
    entityName: row['entity_name'],
    entityId: row['entity_id'],
    outcome: row['outcome'],
    reasonToken: row['reason_token'],
    reauthProofId: row['reauth_proof_id'],
    signatureMeaning: row['signature_meaning'],
    httpMethod: row['http_method'],
    route: row['route'],
    oldValue: row['old_value'],
    newValue: row['new_value'],
    details: row['details'],
    piiTokenCount: row['pii_token_count'],
    hashVersion: row['hash_version'],
  } as unknown as AuditRowDraft;
  const position = { streamSeq: Number(row['stream_seq']), occurredAtMicros: BigInt(String(row['occurred_us'])) };
  return computeEntryHash(draft, position, String(row['prev_hash']));
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeAll(async () => {
  pgh = await PlatformPostgres.start();
  database = await pgh.clone(await pgh.template({ migrated: false }));
  admin = await pgh.superuser(database);
  await admin.query(`CREATE TABLE public.writer_it_addresses (id uuid PRIMARY KEY, org_id uuid NOT NULL, city text NOT NULL);
                     GRANT SELECT, INSERT ON public.writer_it_addresses TO platform_app;`);
  for (const [kind, ref] of [
    ['USER', USER],
    ['CONTACT', CONTACT],
  ] as const) {
    const id = uuidv7();
    await admin.query(`INSERT INTO public.data_subjects (id, created_by, updated_by, kind, ref_id) VALUES ($1, $2, $2, $3, $4)`, [
      id,
      USER,
      kind,
      ref,
    ]);
    subjects.set(`${kind}:${ref}`, id);
  }
  const { PrismaClient: PrismaCtor } = await withReadLock(PRISMA_TREE_LOCK, () => import('../../generated/prisma/client.js'));
  client = createDatabaseClient(PrismaCtor, { connectionString: pgh.appUrl(database), poolMax: 6, applicationName: 'audit-writer-it' });
  runner = createWithTenantTx(
    client,
    {
      statementTimeoutMs: 5_000,
      lockTimeoutMs: TX_LOCK_TIMEOUT_MS,
      idleInTransactionTimeoutMs: 15_000,
      poolConnectionTimeoutMs: 5_000,
      admission: { maxConcurrentTx: 4, waitMs: 250 },
    },
    {
      onSecurityEvent: () => undefined,
      countSessionContextLeak: () => undefined,
      markNotReady: () => undefined,
      scopeClient: () => client,
    },
  );
  writer = createAuditWriter({
    store,
    lockTimeoutMs: LOCK_TIMEOUT_MS,
    tokeniser,
    ipIndex: { keyId: 'audit-index-v1', hash: (ip) => createHash('sha256').update(`idx:${ip}`).digest() },
  });
}, 240_000);

afterAll(async () => {
  await (client as PrismaClient | undefined)?.$disconnect();
  await (admin as pg.Client | undefined)?.end();
  await (pgh as PlatformPostgres | undefined)?.stop();
}, 60_000);

describe('[US-087] complete entry fields on PostgreSQL 18 (REQ-AUDIT-003/011)', () => {
  it('[AT-US-087-01] a LOGIN entry stores every field; the IP and raw user agent are vault tokens; the hash recomputes from the stored row', async () => {
    const org = uuidv7();
    const entry = login(org);
    const before = Date.now();
    const written = await runner.withTenantTx(tenant(org), (db) => writer.write(db, entry));
    const [row] = await stored('id', written.id);
    expect(row).toMatchObject({
      id: written.id,
      stream_id: org,
      stream_seq: '1',
      org_id: org,
      scope_org_id: org,
      on_behalf_of_org_id: null,
      actor_type: 'USER',
      user_id: USER,
      actor_roles: ['Owner', 'Shipper'],
      session_id: (entry.actor as { sessionId: string }).sessionId,
      ip_coarse: '203.0.113.0/24',
      ip_hash_key_id: 'audit-index-v1',
      ua_parsed: 'Firefox 146 / Windows',
      source_app: 'web',
      correlation_id: entry.origin.correlationId,
      action: 'LOGIN',
      entity_name: 'session',
      entity_id: entry.entityId,
      outcome: 'SUCCESS',
      pii_token_count: 2,
      hash_version: 1,
      prev_hash: ZERO_HASH_HEX,
      entry_hash: written.entryHash,
    });
    expect(row?.['ip_token']).toMatch(/^[0-9a-f-]{36}$/);
    expect(row?.['user_agent_token']).toMatch(/^[0-9a-f-]{36}$/);
    expect(row?.['ip_hash']).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain('203.0.113.77');
    expect(JSON.stringify(row)).not.toContain('Gecko');
    // database clock, UTC, taken under the lock
    const occurredMs = Number(BigInt(String(row?.['occurred_us'])) / 1000n);
    expect(occurredMs).toBeGreaterThanOrEqual(before - 5_000);
    expect(occurredMs).toBeLessThanOrEqual(Date.now() + 5_000);
    expect(written.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    expect(recomputed(row as StoredEntry)).toBe(written.entryHash);
    // the vault holds the two values for the USER subject, never in clear
    const vault = await admin.query<{ field: string; subject_id: string }>(
      'SELECT field, subject_id::text FROM public.audit_pii_vault WHERE token = ANY($1::uuid[]) ORDER BY field',
      [[row?.['ip_token'], row?.['user_agent_token']]],
    );
    expect(vault.rows).toEqual([
      { field: 'ip', subject_id: subjects.get(`USER:${USER}`) },
      { field: 'user_agent', subject_id: subjects.get(`USER:${USER}`) },
    ]);
  });

  it('[AT-US-087-02] a STATE_TRANSITION entry records the old and the new state', async () => {
    const org = uuidv7();
    const shipment = randomUUID();
    await runner.withTenantTx(tenant(org), (db) =>
      writer.write(db, {
        ...createAddress(org, shipment),
        action: 'STATE_TRANSITION',
        entityName: 'shipment',
        oldValue: { state: 'DRAFT' },
        newValue: { state: 'QUOTED' },
      }),
    );
    const [row] = await stored('entity_id', shipment);
    expect(row).toMatchObject({ action: 'STATE_TRANSITION', old_value: { state: 'DRAFT' }, new_value: { state: 'QUOTED' } });
    expect(recomputed(row as StoredEntry)).toBe(row?.['entry_hash']);
  });

  it('[AT-US-087-03] a worker job entry is SYSTEM_JOB with its job name and originating correlation id; a guest entry is ANONYMOUS with IP and user agent and no user id', async () => {
    const org = uuidv7();
    const jobEntity = randomUUID();
    await runner.withTenantTx({ ...tenant(org), actorId: '' }, (db) =>
      writer.write(db, {
        action: 'UPDATE',
        outcome: 'SUCCESS',
        entityName: 'shipment',
        entityId: jobEntity,
        orgId: org,
        actor: { type: 'SYSTEM_JOB', jobName: 'tracking-poll' },
        origin: { sourceApp: 'worker', correlationId: 'origin-request-0042' },
        newValue: { tracking: 'IN_TRANSIT' },
      }),
    );
    expect((await stored('entity_id', jobEntity))[0]).toMatchObject({
      actor_type: 'SYSTEM_JOB',
      job_name: 'tracking-poll',
      user_id: '00000000-0000-7000-8000-000000000001',
      correlation_id: 'origin-request-0042',
      source_app: 'worker',
    });

    const quote = randomUUID();
    const guest = await runner.withTenantTx(
      { orgId: '', actorId: '', actorScope: 'TENANT', guestTokenHash: '', correlationId: 'guest-0001' },
      (db) =>
        writer.write(db, {
          action: 'CREATE',
          outcome: 'SUCCESS',
          entityName: 'quote',
          entityId: quote,
          orgId: null,
          actor: { type: 'ANONYMOUS' },
          origin: { sourceApp: 'web', correlationId: 'guest-quote-0001', ip: '2001:db8:abcd:12::1', userAgent: 'curl/8.11' },
        }),
    );
    const [row] = await stored('entity_id', quote);
    expect(row).toMatchObject({
      actor_type: 'ANONYMOUS',
      user_id: null,
      org_id: null,
      scope_org_id: null,
      ip_coarse: '2001:db8:abcd::/48',
    });
    expect(row?.['ip_token']).not.toBeNull();
    expect(row?.['user_agent_token']).not.toBeNull();
    expect(guest.streamId).toMatch(/^00000000-0000-0000-0000-00000000000[0-9a-f]$/);
    expect(recomputed(row as StoredEntry)).toBe(guest.entryHash);
  });

  it('[AT-US-087-05] the database refuses an unknown action (CHECK ck_audit_entries__action) and nothing persists', async () => {
    const org = uuidv7();
    await runner.withTenantTx(tenant(org), (db) => writer.write(db, createAddress(org, randomUUID())));
    // Bypass the writer's own refusal: hand the store a row whose action the type system and the writer would reject.
    const forgedId = uuidv7();
    const valid = prepareEntry(createAddress(org, randomUUID()), { id: forgedId, systemShard: 0 }).complete([]);
    const forged = { ...valid, action: 'FOO' } as unknown as AuditRowDraft;
    const error = await rejection(
      runner.withTenantTx(tenant(org), (db) => store.appendBatch(db, [forged], { lockTimeoutMs: LOCK_TIMEOUT_MS, actorStamp: USER })),
    );
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ status: 500, sqlState: '23514' });
    expect(await count('public.audit_entries WHERE id = $1', [forgedId])).toBe(0);
    expect(await count('public.audit_entries WHERE stream_id = $1', [org])).toBe(1);
  });

  it('[AT-US-087-06] a failed login for an unknown account is ANONYMOUS, DENIED and has no user id', async () => {
    const correlation = `failed-${randomUUID()}`;
    await runner.withTenantTx({ orgId: '', actorId: '', actorScope: 'TENANT', guestTokenHash: '', correlationId: correlation }, (db) =>
      writer.write(db, {
        action: 'LOGIN_FAILED',
        outcome: 'DENIED',
        entityName: 'session',
        orgId: null,
        actor: { type: 'ANONYMOUS' },
        origin: { sourceApp: 'web', correlationId: correlation, ip: '198.51.100.20' },
      }),
    );
    expect((await stored('correlation_id', correlation))[0]).toMatchObject({
      action: 'LOGIN_FAILED',
      actor_type: 'ANONYMOUS',
      outcome: 'DENIED',
      user_id: null,
    });
  });

  it('the coarse network text equals what PostgreSQL prints for inet (it is hashed)', async () => {
    for (const ip of [
      '203.0.113.77',
      '2001:db8:abcd:12::1',
      '2001:0db8:0000:0000::1',
      '2001:0:5::9',
      '0:5:0::1',
      '::1',
      'fe80::1',
      '64:ff9b:1::192.0.2.33',
    ]) {
      const coarse = coarseNetwork(ip);
      const printed = await admin.query<{ text: string }>('SELECT $1::inet::text AS text', [coarse]);
      expect([ip, printed.rows[0]?.text]).toEqual([ip, coarse]);
    }
  });
});

describe('[US-088] same-transaction writes and outcome semantics (REQ-AUDIT-004/010)', () => {
  it('a mutation and its entry commit together inside one tenant transaction', async () => {
    const org = uuidv7();
    const id = randomUUID();
    await runner.withTenantTx(tenant(org), async (db) => {
      await insertAddress(db, org, id);
      return writer.write(db, createAddress(org, id));
    });
    expect(await count('public.writer_it_addresses WHERE id = $1', [id])).toBe(1);
    expect(await count('public.audit_entries WHERE entity_id = $1', [id])).toBe(1);
  });

  it('[AT-US-088-01] the audit insert fails -> 500 AUDIT_WRITE_FAILED and the business row does not exist', async () => {
    const org = uuidv7();
    const id = randomUUID();
    // A real failure of the audit INSERT itself: the injected hasher yields text that decode(…, 'hex') rejects (22023).
    const failing = createAuditWriter({ store: createPrismaAuditStore({ hash: () => 'not-hex' }), lockTimeoutMs: LOCK_TIMEOUT_MS });
    const error = await rejection(
      runner.withTenantTx(tenant(org), async (db) => {
        await insertAddress(db, org, id);
        return failing.write(db, createAddress(org, id));
      }),
    );
    expect(error).toBeInstanceOf(DbError);
    expect((error as DbError).toJSON()).toEqual({
      status: 500,
      code: 'AUDIT_WRITE_FAILED',
      reason: 'AUDIT_WRITE_FAILED',
      retryable: false,
      sqlState: '22023',
    });
    expect(await count('public.writer_it_addresses WHERE id = $1', [id])).toBe(0);
    expect(await count('public.audit_entries WHERE entity_id = $1', [id])).toBe(0);
  });

  it('[AT-US-088-02] the business insert fails after the entry was written -> no audit entry exists', async () => {
    const org = uuidv7();
    const id = randomUUID();
    await runner.withTenantTx(tenant(org), async (db) => {
      await insertAddress(db, org, id);
      return writer.write(db, createAddress(org, id));
    });
    const correlation = `dup-${randomUUID()}`;
    const error = await rejection(
      runner.withTenantTx(tenant(org, correlation), async (db) => {
        await writer.write(db, createAddress(org, randomUUID(), { origin: { sourceApp: 'web', correlationId: correlation } }));
        return insertAddress(db, org, id); // duplicate key: 23505
      }),
    );
    expect(error).toMatchObject({ status: 500, sqlState: '23505' });
    expect(await count('public.audit_entries WHERE correlation_id = $1', [correlation])).toBe(0);
    const head = await admin.query<{ n: string }>('SELECT entry_count::text AS n FROM public.audit_stream_heads WHERE stream_id = $1', [
      org,
    ]);
    expect(head.rows[0]?.n).toBe('1');
  });

  it('[AT-US-088-03] a head-row lock timeout is 503 with Retry-After, fails fast, rolls back; the retry creates the change and exactly one entry', async () => {
    const org = uuidv7();
    await runner.withTenantTx(tenant(org), (db) => writer.write(db, createAddress(org, randomUUID())));
    const holder = await pgh.superuser(database);
    const id = randomUUID();
    const mutate = () =>
      runner.withTenantTx(tenant(org), async (db) => {
        await insertAddress(db, org, id);
        return writer.write(db, createAddress(org, id));
      });
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM public.audit_stream_heads WHERE stream_id = $1 FOR UPDATE', [org]);
      const started = performance.now();
      const error = await rejection(mutate());
      const elapsed = performance.now() - started;
      expect(error).toBeInstanceOf(DbError);
      expect((error as DbError).toJSON()).toEqual({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        reason: 'AUDIT_LOCK_TIMEOUT',
        retryable: true,
        retryAfterSeconds: 1,
        sqlState: '55P03',
      });
      // bounded by the audit lock_timeout (250 ms), not by the transaction's 2 s lock_timeout
      expect(elapsed).toBeLessThan(TX_LOCK_TIMEOUT_MS - 500);
      expect(await count('public.writer_it_addresses WHERE id = $1', [id])).toBe(0);
    } finally {
      await holder.query('ROLLBACK');
      await holder.end();
    }
    await mutate();
    expect(await count('public.writer_it_addresses WHERE id = $1', [id])).toBe(1);
    expect(await count('public.audit_entries WHERE entity_id = $1', [id])).toBe(1);
  });

  it('[AT-US-088-04] an authorised mutation that ends in failure gets a FAILED entry written in a separate transaction', async () => {
    const org = uuidv7();
    const id = randomUUID();
    const conflict = await rejection(
      runner.withTenantTx(tenant(org), async (db) => {
        await insertAddress(db, org, id);
        throw new Error('409 CONFLICT from the service');
      }),
    );
    expect(conflict).toBeInstanceOf(Error);
    await runner.withTenantTx(tenant(org), (db) =>
      writer.write(db, createAddress(org, id, { outcome: 'FAILED', newValue: null, details: { status: 409 } })),
    );
    expect(await count('public.writer_it_addresses WHERE id = $1', [id])).toBe(0);
    expect((await stored('entity_id', id))[0]).toMatchObject({ outcome: 'FAILED', details: { status: 409 } });
  });

  it('[AT-US-088-06] a permission denial is recorded with outcome DENIED', async () => {
    const org = uuidv7();
    const target = randomUUID();
    await runner.withTenantTx(tenant(org), (db) =>
      writer.write(
        db,
        createAddress(org, target, {
          action: 'PERMISSION_DENIED',
          outcome: 'DENIED',
          newValue: null,
          details: { permission: 'address:create' },
        }),
      ),
    );
    expect((await stored('entity_id', target))[0]).toMatchObject({
      action: 'PERMISSION_DENIED',
      outcome: 'DENIED',
      details: { permission: 'address:create' },
    });
  });

  it('[AT-US-088-07] no partition for occurred_at -> 500 AUDIT_WRITE_FAILED and nothing persists (fail closed)', async () => {
    const org = uuidv7();
    await runner.withTenantTx(tenant(org), (db) => writer.write(db, createAddress(org, randomUUID())));
    // The head says the stream's last entry is in 2099, so the next occurred_at falls outside every partition.
    await admin.query(`UPDATE public.audit_stream_heads SET head_occurred_at = '2099-06-01T00:00:00Z' WHERE stream_id = $1`, [org]);
    const id = randomUUID();
    let kind: unknown;
    const error = await rejection(
      runner.withTenantTx(tenant(org), async (db) => {
        await insertAddress(db, org, id);
        try {
          return await writer.write(db, createAddress(org, id));
        } catch (failure) {
          // R1-n9: the classification against the real driver message (the lc_messages prefix), not only the SQLSTATE.
          kind = (failure as { readonly kind?: unknown }).kind;
          throw failure;
        }
      }),
    );
    expect(kind).toBe('PARTITION_MISSING');
    expect((error as DbError).toJSON()).toEqual({
      status: 500,
      code: 'AUDIT_WRITE_FAILED',
      reason: 'AUDIT_WRITE_FAILED',
      retryable: false,
      sqlState: '23514',
    });
    expect(await count('public.writer_it_addresses WHERE id = $1', [id])).toBe(0);
    expect(await count('public.audit_entries WHERE stream_id = $1', [org])).toBe(1);
  });

  it('[AT-US-088-08] two parallel mutations on one stream, one rolls back: only the committed one has an entry, and the chain has no gap', async () => {
    const org = uuidv7();
    const rolledBack = randomUUID();
    const committed = randomUUID();
    const wrote = deferred();
    const release = deferred();
    const slow = createAuditWriter({ store, lockTimeoutMs: TX_LOCK_TIMEOUT_MS - 500 });
    const first = rejection(
      runner.withTenantTx(tenant(org), async (db) => {
        await insertAddress(db, org, rolledBack);
        await slow.write(db, createAddress(org, rolledBack));
        wrote.resolve();
        await release.promise;
        throw new Error('rolled back after its audit append');
      }),
    );
    await wrote.promise;
    const second = runner.withTenantTx(tenant(org), async (db) => {
      await insertAddress(db, org, committed);
      return slow.write(db, createAddress(org, committed));
    });
    setTimeout(release.resolve, 100);
    await first;
    const appended = await second;
    expect(appended).toMatchObject({ streamSeq: 1, prevHash: ZERO_HASH_HEX });
    expect(await count('public.audit_entries WHERE entity_id = $1', [rolledBack])).toBe(0);
    expect(await count('public.audit_entries WHERE entity_id = $1', [committed])).toBe(1);
    expect(await count('public.writer_it_addresses WHERE id = ANY($1::uuid[])', [[rolledBack, committed]])).toBe(1);
  });

  it('entries chain per stream: dense sequence, each prev_hash is the predecessor hash, occurred_at strictly increasing', async () => {
    const org = uuidv7();
    const written: AppendedEntry[] = [];
    for (let i = 0; i < 3; i += 1)
      written.push(await runner.withTenantTx(tenant(org), (db) => writer.write(db, createAddress(org, randomUUID()))));
    const rows = await stored('stream_id', org);
    expect(rows.map((row) => row['stream_seq'])).toEqual(['1', '2', '3']);
    expect(rows.map((row) => row['prev_hash'])).toEqual([ZERO_HASH_HEX, written[0]?.entryHash, written[1]?.entryHash]);
    for (const row of rows) expect(recomputed(row)).toBe(row['entry_hash']);
    const micros = rows.map((row) => BigInt(String(row['occurred_us'])));
    expect(micros[0]! < micros[1]! && micros[1]! < micros[2]!).toBe(true);
    const head = await admin.query<{ n: string; hash: string }>(
      `SELECT entry_count::text AS n, encode(head_hash, 'hex') AS hash FROM public.audit_stream_heads WHERE stream_id = $1`,
      [org],
    );
    expect(head.rows[0]).toEqual({ n: '3', hash: written[2]?.entryHash });
  });

  it('the vault batch reuses the token of a repeated value for the same subject and field', async () => {
    const org = uuidv7();
    const entry = login(org, { origin: { sourceApp: 'web', correlationId: `vault-${randomUUID()}`, ip: '192.0.2.200' } });
    const a = await runner.withTenantTx(tenant(org), (db) => writer.write(db, entry));
    const b = await runner.withTenantTx(tenant(org), (db) => writer.write(db, { ...entry, entityId: randomUUID() }));
    const [rowA] = await stored('id', a.id);
    const [rowB] = await stored('id', b.id);
    expect(rowA?.['ip_token']).toBe(rowB?.['ip_token']);
  });

  it('entries are immutable: platform_app has no UPDATE/DELETE, and the trigger refuses even the superuser', async () => {
    const org = uuidv7();
    const written = await runner.withTenantTx(tenant(org), (db) => writer.write(db, createAddress(org, randomUUID())));
    for (const statement of [
      (db: Db) => db.$executeRaw`UPDATE public.audit_entries SET outcome = 'FAILED' WHERE id = ${written.id}::uuid`,
      (db: Db) => db.$executeRaw`DELETE FROM public.audit_entries WHERE id = ${written.id}::uuid`,
    ]) {
      const error = await rejection(runner.withTenantTx(tenant(org), statement));
      expect(error).toMatchObject({ status: 500, reason: 'DB_PRIVILEGE_DENIED', sqlState: '42501' });
    }
    const refused = await rejection(admin.query(`UPDATE public.audit_entries SET outcome = 'FAILED' WHERE id = $1`, [written.id]));
    expect(String((refused as Error).message)).toMatch(/^AUDIT_IMMUTABLE:/);
    expect((await stored('id', written.id))[0]).toMatchObject({ outcome: 'SUCCESS', entry_hash: written.entryHash });
  });
});

describe('[PR #42 fix cycle 1] rollback-only latch and string normalisation on PostgreSQL 18', () => {
  it('[PR42-SEC-02] a refusal raised before any SQL error and swallowed by the callback rolls the business row back (500)', async () => {
    const org = uuidv7();
    const id = randomUUID();
    const swallowed: unknown[] = [];
    const error = await rejection(
      runner.withTenantTx(tenant(org), async (db) => {
        await insertAddress(db, org, id);
        await writer
          .write(db, createAddress(org, id, { outcome: 'OK' as 'SUCCESS' }))
          .catch((failure: unknown) => void swallowed.push(failure));
        return 'business change done';
      }),
    );
    expect(swallowed).toEqual([expect.objectContaining({ kind: 'INVALID_ENTRY' })]);
    expect((error as DbError).toJSON()).toEqual({
      status: 500,
      code: 'AUDIT_WRITE_FAILED',
      reason: 'AUDIT_WRITE_FAILED',
      retryable: false,
    });
    expect(await count('public.writer_it_addresses WHERE id = $1', [id])).toBe(0);
    expect(await count('public.audit_entries WHERE entity_id = $1', [id])).toBe(0);
  });

  it('[PR42-SEC-02] a swallowed head-row lock timeout answers 503 instead of resolving, and nothing persists', async () => {
    const org = uuidv7();
    await runner.withTenantTx(tenant(org), (db) => writer.write(db, createAddress(org, randomUUID())));
    const holder = await pgh.superuser(database);
    const id = randomUUID();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM public.audit_stream_heads WHERE stream_id = $1 FOR UPDATE', [org]);
      const error = await rejection(
        runner.withTenantTx(tenant(org), async (db) => {
          await insertAddress(db, org, id);
          await writer.write(db, createAddress(org, id)).catch(() => undefined);
          return 'ok';
        }),
      );
      expect(error).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE', reason: 'AUDIT_LOCK_TIMEOUT', retryable: true });
      expect(await count('public.writer_it_addresses WHERE id = $1', [id])).toBe(0);
    } finally {
      await holder.query('ROLLBACK');
      await holder.end();
    }
    expect(await count('public.audit_entries WHERE entity_id = $1', [id])).toBe(0);
  });

  it('[PR42-SEC-12] a lone surrogate in business data is stored as U+FFFD and the hash recomputes from the stored row', async () => {
    const org = uuidv7();
    const id = randomUUID();
    const lone = String.fromCharCode(0xd800);
    const written = await runner.withTenantTx(tenant(org), (db) =>
      writer.write(db, createAddress(org, id, { newValue: { city: `Pune${lone}`, [`k${lone}`]: 1 } })),
    );
    const [row] = await stored('entity_id', id);
    const fffd = String.fromCharCode(0xfffd);
    expect(row?.['new_value']).toEqual({ city: `Pune${fffd}`, [`k${fffd}`]: 1 });
    expect(recomputed(row as StoredEntry)).toBe(written.entryHash);
  });
});

describe('[PR #42 fix cycle 2] a write the callback starts but does not await, on PostgreSQL 18 (PR42-SEC-13)', () => {
  const later = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  /** The test tokeniser behind a delay, so the write is still in flight when the callback returns. */
  const slowWriter = (fail: boolean): AuditWriter =>
    createAuditWriter({
      store,
      lockTimeoutMs: LOCK_TIMEOUT_MS,
      tokeniser: {
        tokenise: async (db, values) => {
          await later(50);
          if (fail) throw new Error('vault unavailable');
          return tokeniser.tokenise(db, values);
        },
      },
    });

  it('a detached write whose tokeniser fails after the callback returned rolls the business row back: 0 rows, 500', async () => {
    const org = uuidv7();
    const id = randomUUID();
    const logged: unknown[] = [];
    const error = await rejection(
      runner.withTenantTx(tenant(org), async (db) => {
        await insertAddress(db, org, id);
        slowWriter(true)
          .write(db, login(org, { entityId: id }))
          .catch((failure: unknown) => void logged.push(failure));
        return 'business change done';
      }),
    );
    expect(logged).toEqual([expect.objectContaining({ kind: 'TOKENISER_FAILED' })]);
    expect((error as DbError).toJSON()).toEqual({
      status: 500,
      code: 'AUDIT_WRITE_FAILED',
      reason: 'AUDIT_WRITE_FAILED',
      retryable: false,
    });
    expect(await count('public.writer_it_addresses WHERE id = $1', [id])).toBe(0);
    expect(await count('public.audit_entries WHERE entity_id = $1', [id])).toBe(0);
  });

  it('a detached (`void`) write that succeeds is appended inside the transaction: the business row exists only with its entry', async () => {
    const org = uuidv7();
    const id = randomUUID();
    await runner.withTenantTx(tenant(org), async (db) => {
      await insertAddress(db, org, id);
      void slowWriter(false).write(db, login(org, { entityId: id }));
      return 'business change done';
    });
    expect(await count('public.writer_it_addresses WHERE id = $1', [id])).toBe(1);
    const [row] = await stored('entity_id', id);
    expect(row?.['stream_id']).toBe(org);
    expect(row?.['ip_token']).not.toBeNull();
    expect(recomputed(row as StoredEntry)).toBe(row?.['entry_hash']);
  });
});
