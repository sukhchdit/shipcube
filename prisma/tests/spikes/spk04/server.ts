/**
 * SPK-04 (TASK-018; R-ARCH-04; NFR-AUDIT-005) THROWAWAY benchmark replica: a minimal `node:http` server (not product
 * code, no Express) that runs five request shapes through the production database path — the runtime role
 * `platform_app` (NOSUPERUSER NOBYPASSRLS), `createDatabaseRuntime` and `withTenantTx` (Prisma 7 + adapter-pg) — with
 * the audit write of data-model §5.4 in one of three modes chosen at process start by the runner:
 *
 *   SPK04_AUDIT=off      business statements only (the equivalent of the build-time `-bench` image of ADR-0007 item 4;
 *                        the product has NO runtime audit switch — this env variable exists only in this harness)
 *   SPK04_AUDIT=on       data-model §5.4 exactly: per PII value INSERT … ON CONFLICT DO NOTHING + SELECT token; the
 *                        per-stream advisory lock; head INSERT … ON CONFLICT DO NOTHING + SELECT; entry INSERT; head
 *                        UPDATE asserting one row
 *   SPK04_AUDIT=batched  the FALLBACK candidate: one multi-row vault INSERT … SELECT FROM unnest(…) + one multi-row token
 *                        SELECT; the lock (own statement, before the head read's snapshot); head SELECT (create only when
 *                        absent); entry INSERT + head UPDATE in ONE statement (CTE)
 *
 * The audit statements are the last work before COMMIT (READ COMMITTED). Fail-closed reads (detail, list) write their
 * VIEW entry in a separate short transaction after the read and before the response (data-model §5.4 last paragraph).
 * Round trips are counted per request (BEGIN, the context statement and COMMIT count as three per transaction).
 * `GET /__stats` and `POST /__reset` serve the runner on loopback. Errors return 500 without details, counted by kind.
 */
import { createCipheriv, createHmac, randomBytes, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';

import { createDatabaseRuntime } from '../../../../apps/api/src/platform/db/runtime.js';
import type { TenantDb } from '../../../../apps/api/src/platform/db/tenant-db.js';
import type { TenantContext } from '../../../../apps/api/src/platform/db/with-tenant-tx.js';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import { type AuditEntry, entryHash, formatMicros, nextOccurredAt, uuidv7 } from './chain.js';

export type AuditMode = 'off' | 'on' | 'batched';
export const OPS = ['create', 'update', 'detail', 'list', 'login_failed'] as const;
export type Op = (typeof OPS)[number];

export interface SeedOrg {
  readonly id: string;
  readonly userId: string;
  readonly subjects: readonly string[];
  readonly orders: readonly string[];
}

export interface Seed {
  readonly orgs: readonly SeedOrg[];
  readonly systemShards: readonly string[];
}

/** Raw per-request samples of one op (milliseconds, 3 decimals). */
export interface OpSamples {
  total: number[];
  audit: number[];
  lock: number[];
  roundTrips: number[];
  hot: number[];
  errors: number;
}

export type StatsBody = Record<Op, OpSamples> & { errorsByKind: Record<string, number> };

type Db = TenantDb<Prisma.TransactionClient>;

const ENTITY = 'spk04_orders';
const SYSTEM_ACTOR = '00000000-0000-7000-8000-000000000001';
const STATUSES = ['DRAFT', 'QUOTED', 'BOOKED', 'CANCELLED'] as const;
const REPEAT_SHARE = 0.1;
const REPEAT_POOL = 8;

const env = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
};

const mode = env('SPK04_AUDIT') as AuditMode;
if (!['off', 'on', 'batched'].includes(mode)) throw new Error('SPK04_AUDIT must be off, on or batched');
const replica = env('SPK04_REPLICA');
const port = Number(env('SPK04_PORT'));
const seed = JSON.parse(readFileSync(env('SPK04_SEED'), 'utf8')) as Seed;

// Run-time random keys (never persisted). Key ids are per replica because each replica has its own keys.
const hmacKey = randomBytes(32);
const encKey = randomBytes(32);
const ipKey = randomBytes(32);
const KEY_ID = `spk04-${replica}-k1`;

const pick = <T>(items: readonly T[]): T => {
  const item = items[randomInt(items.length)];
  if (item === undefined) throw new Error('empty list');
  return item;
};
const hex = (n: number): string => randomBytes(n).toString('hex');
const ms = (value: number): number => Math.round(value * 1000) / 1000;

// --- PII values (random, with ~10 % repeats per org/field to exercise the vault's ON CONFLICT dedupe) --------------
const recent = new Map<string, string[]>();
function piiValue(orgId: string, field: string, fresh: () => string): string {
  const key = `${orgId}|${field}`;
  const pool = recent.get(key) ?? [];
  if (pool.length > 0 && Math.random() < REPEAT_SHARE) return pick(pool);
  const value = fresh();
  pool.push(value);
  if (pool.length > REPEAT_POOL) pool.shift();
  recent.set(key, pool);
  return value;
}
const freshName = (): string => `Name ${hex(6)}`;
const freshEmail = (): string => `u${hex(6)}@example.test`;
const freshPhone = (): string => `+1555${String(randomInt(1_000_000, 9_999_999))}`;

interface PiiInput {
  readonly field: string;
  readonly subjectId: string;
  readonly value: string;
}

interface VaultRow {
  readonly token: string;
  readonly subjectId: string;
  readonly field: string;
  readonly hmacHex: string;
  readonly ciphertextHex: string;
}

function vaultRow(input: PiiInput): VaultRow {
  const token = uuidv7();
  const hmacHex = createHmac('sha256', hmacKey).update(`${ENTITY}|${input.field}|${input.value}`).digest('hex');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey, nonce);
  cipher.setAAD(Buffer.from(`audit_pii_vault|ciphertext|${token}|${KEY_ID}`, 'utf8'));
  const body = Buffer.concat([cipher.update(input.value, 'utf8'), cipher.final()]);
  const ciphertextHex = Buffer.concat([nonce, body, cipher.getAuthTag()]).toString('hex');
  return { token, subjectId: input.subjectId, field: input.field, hmacHex, ciphertextHex };
}

// --- per-request probe ---------------------------------------------------------------------------------------------
class Probe {
  roundTrips = 0;
  auditMs = 0;
  lockMs = 0;
  /** One withTenantTx = BEGIN + context statement + COMMIT. */
  tx(): void {
    this.roundTrips += 3;
  }
  async rt<T>(run: () => PromiseLike<T>): Promise<T> {
    this.roundTrips += 1;
    return run();
  }
}

// --- audit write ----------------------------------------------------------------------------------------------------
interface AuditRequest {
  readonly streamId: string;
  readonly actor: string;
  readonly base: Omit<AuditEntry, 'id' | 'occurredAtMicros' | 'streamId' | 'streamSeq' | 'oldValue' | 'newValue' | 'piiTokenCount'>;
  readonly pii: readonly PiiInput[];
  /** Builds old/new values from the vault tokens (same order as `pii`). */
  readonly values: (tokens: readonly string[]) => { oldValue: AuditEntry['oldValue']; newValue: AuditEntry['newValue'] };
}

interface HeadRow {
  entry_count: string;
  head_hash: string;
  head_us: string | null;
  now_us: string;
}

const one = <T>(rows: readonly T[], what: string): T => {
  const [row] = rows;
  if (row === undefined || rows.length !== 1) throw new Error(`expected one ${what} row, got ${String(rows.length)}`);
  return row;
};

async function tokenizeOneByOne(db: Db, probe: Probe, actor: string, pii: readonly PiiInput[]): Promise<string[]> {
  const tokens: string[] = [];
  for (const input of pii) {
    const v = vaultRow(input);
    await probe.rt(
      () => db.$executeRaw`INSERT INTO public.audit_pii_vault (token, subject_id, classification, entity_name, field, value_hmac,
          value_hmac_key_id, ciphertext, ciphertext_key_id, created_at, updated_at, created_by, updated_by, version)
        VALUES (${v.token}::uuid, ${v.subjectId}::uuid, 'PERSONAL', ${ENTITY}, ${v.field}, pg_catalog.decode(${v.hmacHex}, 'hex'),
          ${KEY_ID}, pg_catalog.decode(${v.ciphertextHex}, 'hex'), ${KEY_ID}, pg_catalog.now(), pg_catalog.now(), ${actor}::uuid,
          ${actor}::uuid, 1)
        ON CONFLICT (subject_id, entity_name, field, value_hmac) DO NOTHING`,
    );
    const rows = await probe.rt(
      () => db.$queryRaw<Array<{ token: string }>>`SELECT token::text AS token FROM public.audit_pii_vault
        WHERE subject_id = ${v.subjectId}::uuid AND entity_name = ${ENTITY} AND field = ${v.field}
          AND value_hmac = pg_catalog.decode(${v.hmacHex}, 'hex')`,
    );
    tokens.push(one(rows, 'vault').token);
  }
  return tokens;
}

async function tokenizeBatched(db: Db, probe: Probe, actor: string, pii: readonly PiiInput[]): Promise<string[]> {
  if (pii.length === 0) return [];
  const rows = pii.map(vaultRow);
  const tokens = rows.map((r) => r.token);
  const subjects = rows.map((r) => r.subjectId);
  const fields = rows.map((r) => r.field);
  const hmacs = rows.map((r) => r.hmacHex);
  const cts = rows.map((r) => r.ciphertextHex);
  await probe.rt(
    () => db.$executeRaw`INSERT INTO public.audit_pii_vault (token, subject_id, classification, entity_name, field, value_hmac,
        value_hmac_key_id, ciphertext, ciphertext_key_id, created_at, updated_at, created_by, updated_by, version)
      SELECT t.token, t.subject_id, 'PERSONAL', ${ENTITY}, t.field, pg_catalog.decode(t.hmac, 'hex'), ${KEY_ID},
             pg_catalog.decode(t.ct, 'hex'), ${KEY_ID}, pg_catalog.now(), pg_catalog.now(), ${actor}::uuid, ${actor}::uuid, 1
        FROM unnest(${tokens}::uuid[], ${subjects}::uuid[], ${fields}::text[], ${hmacs}::text[], ${cts}::text[])
             AS t(token, subject_id, field, hmac, ct)
      ON CONFLICT (subject_id, entity_name, field, value_hmac) DO NOTHING`,
  );
  // A new statement (new snapshot under READ COMMITTED) sees rows a concurrent winner committed meanwhile.
  const found = await probe.rt(
    () => db.$queryRaw<Array<{ field: string; subject_id: string; hmac: string; token: string }>>`
      SELECT v.field, v.subject_id::text AS subject_id, pg_catalog.encode(v.value_hmac, 'hex') AS hmac, v.token::text AS token
        FROM public.audit_pii_vault v
        JOIN unnest(${subjects}::uuid[], ${fields}::text[], ${hmacs}::text[]) AS k(subject_id, field, hmac)
          ON v.subject_id = k.subject_id AND v.entity_name = ${ENTITY} AND v.field = k.field
         AND v.value_hmac = pg_catalog.decode(k.hmac, 'hex')`,
  );
  const byKey = new Map(found.map((f) => [`${f.subject_id}|${f.field}|${f.hmac}`, f.token]));
  return rows.map((r) => {
    const token = byKey.get(`${r.subjectId}|${r.field}|${r.hmacHex}`);
    if (token === undefined) throw new Error('vault token missing');
    return token;
  });
}

async function lockStream(db: Db, probe: Probe, streamId: string): Promise<void> {
  const started = performance.now();
  await probe.rt(
    () => db.$executeRaw`SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('audit:' || ${streamId}::uuid::text)::bigint)`,
  );
  probe.lockMs += performance.now() - started;
}

const selectHead = (db: Db, streamId: string): PromiseLike<HeadRow[]> =>
  db.$queryRaw<HeadRow[]>`SELECT entry_count::text AS entry_count, pg_catalog.encode(head_hash, 'hex') AS head_hash,
      ((extract(epoch FROM head_occurred_at) * 1000000)::bigint)::text AS head_us,
      ((extract(epoch FROM pg_catalog.clock_timestamp()) * 1000000)::bigint)::text AS now_us
    FROM public.audit_stream_heads WHERE stream_id = ${streamId}::uuid`;

const insertHead = (db: Db, streamId: string, actor: string): PromiseLike<number> =>
  db.$executeRaw`INSERT INTO public.audit_stream_heads (id, stream_id, entry_count, head_hash, last_verified_seq, last_verified_hash,
      created_at, updated_at, created_by, updated_by, version)
    VALUES (pg_catalog.uuidv7(), ${streamId}::uuid, 0, pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex'), 0,
      pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex'), pg_catalog.now(), pg_catalog.now(), ${actor}::uuid, ${actor}::uuid, 1)
    ON CONFLICT (stream_id) DO NOTHING`;

function buildEntry(request: AuditRequest, head: HeadRow, tokens: readonly string[]): { entry: AuditEntry; hash: string; prev: string } {
  const seq = Number(head.entry_count) + 1;
  const occurred = nextOccurredAt(BigInt(head.now_us), head.head_us === null ? null : BigInt(head.head_us));
  const { oldValue, newValue } = request.values(tokens);
  const entry: AuditEntry = {
    ...request.base,
    id: uuidv7(),
    occurredAtMicros: occurred,
    streamId: request.streamId,
    streamSeq: seq,
    oldValue,
    newValue,
    piiTokenCount: tokens.length,
  };
  return { entry, hash: entryHash(entry, head.head_hash), prev: head.head_hash };
}

const jsonOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : JSON.stringify(value));

async function appendOn(db: Db, probe: Probe, actor: string, e: AuditEntry, prev: string, hash: string): Promise<void> {
  const ts = formatMicros(e.occurredAtMicros);
  await probe.rt(
    () => db.$executeRaw`INSERT INTO public.audit_entries (id, occurred_at, stream_id, stream_seq, org_id, target_org_id,
        on_behalf_of_org_id, actor_type, user_id, api_key_id, job_name, actor_roles, session_id, ip_token, ip_hash, ip_hash_key_id,
        ip_coarse, user_agent_token, ua_parsed, source_app, correlation_id, action, entity_name, entity_id, outcome, reason_token,
        reauth_proof_id, signature_meaning, http_method, route, old_value, new_value, details, pii_token_count, hash_version,
        prev_hash, entry_hash)
      VALUES (${e.id}::uuid, ${ts}::timestamptz, ${e.streamId}::uuid, ${e.streamSeq}::bigint, ${e.orgId}::uuid, ${e.targetOrgId}::uuid,
        ${e.onBehalfOfOrgId}::uuid, ${e.actorType}, ${e.userId}::uuid, ${e.apiKeyId}::uuid, ${e.jobName}, ${[...e.actorRoles]}::text[],
        ${e.sessionId}::uuid, ${e.ipToken}::uuid, pg_catalog.decode(${e.ipHash}, 'hex'), ${e.ipHashKeyId}, ${e.ipCoarse}::inet,
        ${e.userAgentToken}::uuid, ${e.uaParsed}, ${e.sourceApp}, ${e.correlationId}, ${e.action}, ${e.entityName}, ${e.entityId},
        ${e.outcome}, ${e.reasonToken}::uuid, ${e.reauthProofId}::uuid, ${e.signatureMeaning}, ${e.httpMethod}, ${e.route},
        ${jsonOrNull(e.oldValue)}::jsonb, ${jsonOrNull(e.newValue)}::jsonb, ${jsonOrNull(e.details)}::jsonb, ${e.piiTokenCount}::integer,
        ${e.hashVersion}::smallint, pg_catalog.decode(${prev}, 'hex'), pg_catalog.decode(${hash}, 'hex'))`,
  );
  const updated = await probe.rt(
    () => db.$executeRaw`UPDATE public.audit_stream_heads
        SET entry_count = ${e.streamSeq}::bigint, head_entry_id = ${e.id}::uuid, head_occurred_at = ${ts}::timestamptz,
            head_hash = pg_catalog.decode(${hash}, 'hex'), updated_at = pg_catalog.now(), updated_by = ${actor}::uuid, version = version + 1
      WHERE stream_id = ${e.streamId}::uuid AND entry_count = ${e.streamSeq - 1}::bigint`,
  );
  if (updated !== 1) throw new Error('HEAD_MOVED');
}

async function appendBatched(db: Db, probe: Probe, actor: string, e: AuditEntry, prev: string, hash: string): Promise<void> {
  const ts = formatMicros(e.occurredAtMicros);
  const updated = await probe.rt(
    () => db.$executeRaw`WITH appended AS (
        INSERT INTO public.audit_entries (id, occurred_at, stream_id, stream_seq, org_id, target_org_id,
          on_behalf_of_org_id, actor_type, user_id, api_key_id, job_name, actor_roles, session_id, ip_token, ip_hash, ip_hash_key_id,
          ip_coarse, user_agent_token, ua_parsed, source_app, correlation_id, action, entity_name, entity_id, outcome, reason_token,
          reauth_proof_id, signature_meaning, http_method, route, old_value, new_value, details, pii_token_count, hash_version,
          prev_hash, entry_hash)
        VALUES (${e.id}::uuid, ${ts}::timestamptz, ${e.streamId}::uuid, ${e.streamSeq}::bigint, ${e.orgId}::uuid, ${e.targetOrgId}::uuid,
          ${e.onBehalfOfOrgId}::uuid, ${e.actorType}, ${e.userId}::uuid, ${e.apiKeyId}::uuid, ${e.jobName}, ${[...e.actorRoles]}::text[],
          ${e.sessionId}::uuid, ${e.ipToken}::uuid, pg_catalog.decode(${e.ipHash}, 'hex'), ${e.ipHashKeyId}, ${e.ipCoarse}::inet,
          ${e.userAgentToken}::uuid, ${e.uaParsed}, ${e.sourceApp}, ${e.correlationId}, ${e.action}, ${e.entityName}, ${e.entityId},
          ${e.outcome}, ${e.reasonToken}::uuid, ${e.reauthProofId}::uuid, ${e.signatureMeaning}, ${e.httpMethod}, ${e.route},
          ${jsonOrNull(e.oldValue)}::jsonb, ${jsonOrNull(e.newValue)}::jsonb, ${jsonOrNull(e.details)}::jsonb, ${e.piiTokenCount}::integer,
          ${e.hashVersion}::smallint, pg_catalog.decode(${prev}, 'hex'), pg_catalog.decode(${hash}, 'hex')))
      UPDATE public.audit_stream_heads
         SET entry_count = ${e.streamSeq}::bigint, head_entry_id = ${e.id}::uuid, head_occurred_at = ${ts}::timestamptz,
             head_hash = pg_catalog.decode(${hash}, 'hex'), updated_at = pg_catalog.now(), updated_by = ${actor}::uuid, version = version + 1
       WHERE stream_id = ${e.streamId}::uuid AND entry_count = ${e.streamSeq - 1}::bigint`,
  );
  if (updated !== 1) throw new Error('HEAD_MOVED');
}

/** The audit write, last work of the transaction. Accumulates its time into `probe.auditMs`. */
async function audit(db: Db, probe: Probe, request: AuditRequest): Promise<void> {
  if (mode === 'off') return;
  const started = performance.now();
  const { actor, streamId } = request;
  if (mode === 'on') {
    const tokens = await tokenizeOneByOne(db, probe, actor, request.pii);
    await lockStream(db, probe, streamId);
    await probe.rt(() => insertHead(db, streamId, actor));
    const head = one(await probe.rt(() => selectHead(db, streamId)), 'head');
    const built = buildEntry(request, head, tokens);
    await appendOn(db, probe, actor, built.entry, built.prev, built.hash);
  } else {
    const tokens = await tokenizeBatched(db, probe, actor, request.pii);
    await lockStream(db, probe, streamId);
    let heads = await probe.rt(() => selectHead(db, streamId));
    if (heads.length === 0) {
      await probe.rt(() => insertHead(db, streamId, actor));
      heads = await probe.rt(() => selectHead(db, streamId));
    }
    const built = buildEntry(request, one(heads, 'head'), tokens);
    await appendBatched(db, probe, actor, built.entry, built.prev, built.hash);
  }
  probe.auditMs += performance.now() - started;
}

// --- database runtime -----------------------------------------------------------------------------------------------
const { PrismaClient: Client } = await import('../../../generated/prisma/client.js');
const quiet = (): void => undefined;
const runtime = createDatabaseRuntime<Prisma.TransactionClient, PrismaClient>({
  database: { connectionString: env('SPK04_DATABASE_URL'), poolMax: 10, applicationName: `spk04-${replica}` },
  tx: { statementTimeoutMs: 5_000, lockTimeoutMs: 2_000, idleInTransactionTimeoutMs: 15_000, poolConnectionTimeoutMs: 5_000 },
  log: { info: quiet, warn: quiet, error: (event) => process.stderr.write(`spk04 ${replica} ${event}\n`) },
  Client,
});
await runtime.startup();
const built = runtime.tenantTx;
if (built === undefined) throw new Error('tenant runner not built');
const runner = built;

// --- ops ------------------------------------------------------------------------------------------------------------
interface Request {
  readonly org: SeedOrg;
  readonly correlationId: string;
}

const tenantCtx = (r: Request): TenantContext => ({
  orgId: r.org.id,
  actorId: r.org.userId,
  actorScope: 'TENANT',
  guestTokenHash: '',
  correlationId: r.correlationId,
});

function clientIp(): { ipHash: string; ipCoarse: string } {
  const octets = [randomInt(1, 224), randomInt(256), randomInt(256), randomInt(1, 255)];
  return {
    ipHash: createHmac('sha256', ipKey).update(octets.join('.')).digest('hex'),
    ipCoarse: `${String(octets[0])}.${String(octets[1])}.${String(octets[2])}.0/24`,
  };
}

function userBase(r: Request, action: string, method: string, route: string, entityId: string | null, details: AuditEntry['details']) {
  const ip = clientIp();
  return {
    orgId: r.org.id,
    targetOrgId: null,
    onBehalfOfOrgId: null,
    actorType: 'USER' as const,
    userId: r.org.userId,
    apiKeyId: null,
    jobName: null,
    actorRoles: ['Shipper'],
    sessionId: null,
    ipToken: null,
    ipHash: ip.ipHash,
    ipHashKeyId: KEY_ID,
    ipCoarse: ip.ipCoarse,
    userAgentToken: null,
    uaParsed: 'k6',
    sourceApp: 'api' as const,
    correlationId: r.correlationId,
    action,
    entityName: ENTITY,
    entityId,
    outcome: 'SUCCESS' as const,
    reasonToken: null,
    reauthProofId: null,
    signatureMeaning: null,
    httpMethod: method,
    route,
    details,
    hashVersion: 1,
  };
}

async function opCreate(r: Request, probe: Probe): Promise<void> {
  const id = uuidv7();
  const name = piiValue(r.org.id, 'sender_name', freshName);
  const email = piiValue(r.org.id, 'sender_email', freshEmail);
  const phone = piiValue(r.org.id, 'receiver_phone', freshPhone);
  const weight = randomInt(100, 30_000);
  const sender = pick(r.org.subjects);
  const receiver = pick(r.org.subjects);
  probe.tx();
  await runner.withTenantTx(tenantCtx(r), async (db) => {
    await probe.rt(
      () => db.$executeRaw`INSERT INTO public.spk04_orders (id, org_id, created_by, updated_by, status, origin_country, dest_country,
          weight_grams, sender_name, sender_email, receiver_phone)
        VALUES (${id}::uuid, ${r.org.id}::uuid, ${r.org.userId}::uuid, ${r.org.userId}::uuid, 'DRAFT', 'US', 'IN', ${weight}::integer,
          ${name}, ${email}, ${phone})`,
    );
    await audit(db, probe, {
      streamId: r.org.id,
      actor: r.org.userId,
      base: userBase(r, 'CREATE', 'POST', '/orders', id, null),
      pii: [
        { field: 'sender_name', subjectId: sender, value: name },
        { field: 'sender_email', subjectId: sender, value: email },
        { field: 'receiver_phone', subjectId: receiver, value: phone },
      ],
      values: ([t1, t2, t3]) => ({
        oldValue: null,
        newValue: {
          id,
          status: 'DRAFT',
          origin_country: 'US',
          dest_country: 'IN',
          weight_grams: weight,
          sender_name: { $pii: t1 ?? '' },
          sender_email: { $pii: t2 ?? '' },
          receiver_phone: { $pii: t3 ?? '' },
        },
      }),
    });
  });
}

async function opUpdate(r: Request, probe: Probe): Promise<void> {
  const orderId = pick(r.org.orders);
  const email = piiValue(r.org.id, 'sender_email', freshEmail);
  const status = pick(STATUSES);
  const subject = pick(r.org.subjects);
  probe.tx();
  await runner.withTenantTx(tenantCtx(r), async (db) => {
    const old = one(
      await probe.rt(
        () => db.$queryRaw<Array<{ status: string }>>`SELECT status FROM public.spk04_orders WHERE id = ${orderId}::uuid FOR UPDATE`,
      ),
      'order',
    );
    await probe.rt(
      () => db.$executeRaw`UPDATE public.spk04_orders SET status = ${status}, sender_email = ${email}, updated_at = pg_catalog.now(),
          updated_by = ${r.org.userId}::uuid, version = version + 1 WHERE id = ${orderId}::uuid`,
    );
    await audit(db, probe, {
      streamId: r.org.id,
      actor: r.org.userId,
      base: userBase(r, 'UPDATE', 'PATCH', '/orders/:id', orderId, null),
      pii: [{ field: 'sender_email', subjectId: subject, value: email }],
      values: ([t1]) => ({
        oldValue: { status: old.status, sender_email: '[REDACTED]' },
        newValue: { status, sender_email: { $pii: t1 ?? '' } },
      }),
    });
  });
}

/** Fail-closed read: the VIEW entry is written and committed in its own short transaction before the response. */
async function viewEntry(r: Request, probe: Probe, entityId: string | null, route: string, details: AuditEntry['details']): Promise<void> {
  if (mode === 'off') return;
  const started = performance.now();
  const before = probe.auditMs;
  probe.tx();
  await runner.withTenantTx(tenantCtx(r), (db) =>
    audit(db, probe, {
      streamId: r.org.id,
      actor: r.org.userId,
      base: userBase(r, 'VIEW', 'GET', route, entityId, details),
      pii: [],
      values: () => ({ oldValue: null, newValue: null }),
    }),
  );
  // the whole second transaction is audit cost (audit() itself added its in-transaction part)
  probe.auditMs = before + (performance.now() - started);
}

async function opDetail(r: Request, probe: Probe): Promise<void> {
  const orderId = pick(r.org.orders);
  probe.tx();
  await runner.withTenantTx(tenantCtx(r), async (db) => {
    one(
      await probe.rt(
        () => db.$queryRaw<Array<{ id: string }>>`SELECT id::text AS id, status, origin_country, dest_country, weight_grams, sender_name,
            sender_email, receiver_phone, version FROM public.spk04_orders WHERE id = ${orderId}::uuid`,
      ),
      'order',
    );
  });
  await viewEntry(r, probe, orderId, '/orders/:id', null);
}

async function opList(r: Request, probe: Probe): Promise<void> {
  probe.tx();
  const rows = await runner.withTenantTx(tenantCtx(r), (db) =>
    probe.rt(
      () => db.$queryRaw<Array<{ id: string }>>`SELECT id::text AS id, status, created_at FROM public.spk04_orders
          WHERE org_id = ${r.org.id}::uuid ORDER BY created_at DESC, id DESC LIMIT 50`,
    ),
  );
  await viewEntry(r, probe, null, '/orders', { page: 'first', count: rows.length });
}

async function opLoginFailed(correlationId: string, probe: Probe): Promise<void> {
  const shard = Number.parseInt(createHmac('sha256', 'shard').update(correlationId).digest('hex').slice(0, 8), 16) % 16;
  const streamId = seed.systemShards[shard] ?? SYSTEM_ACTOR;
  const ip = clientIp();
  probe.tx();
  await runner.withTenantTx({ orgId: '', actorId: '', actorScope: 'TENANT', guestTokenHash: '', correlationId }, async (db) => {
    // stand-in for the credential lookup of a failed login
    await probe.rt(() => db.$executeRaw`SELECT 1`);
    await audit(db, probe, {
      streamId,
      actor: SYSTEM_ACTOR,
      base: {
        orgId: null,
        targetOrgId: null,
        onBehalfOfOrgId: null,
        actorType: 'ANONYMOUS',
        userId: null,
        apiKeyId: null,
        jobName: null,
        actorRoles: [],
        sessionId: null,
        ipToken: null,
        ipHash: ip.ipHash,
        ipHashKeyId: KEY_ID,
        ipCoarse: ip.ipCoarse,
        userAgentToken: null,
        uaParsed: 'k6',
        sourceApp: 'web',
        correlationId,
        action: 'LOGIN_FAILED',
        entityName: 'session',
        entityId: null,
        outcome: 'FAILED',
        reasonToken: null,
        reauthProofId: null,
        signatureMeaning: null,
        httpMethod: 'POST',
        route: '/auth/login',
        details: { reason: 'INVALID_CREDENTIALS' },
        hashVersion: 1,
      },
      pii: [],
      values: () => ({ oldValue: null, newValue: null }),
    });
  });
}

// --- stats ----------------------------------------------------------------------------------------------------------
const emptySamples = (): OpSamples => ({ total: [], audit: [], lock: [], roundTrips: [], hot: [], errors: 0 });
let stats: StatsBody = newStats();
function newStats(): StatsBody {
  return {
    create: emptySamples(),
    update: emptySamples(),
    detail: emptySamples(),
    list: emptySamples(),
    login_failed: emptySamples(),
    errorsByKind: {},
  };
}

function errorKind(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const e = error as { name?: unknown; code?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const name = typeof e.name === 'string' ? e.name : 'Error';
  const message = typeof e.message === 'string' && /^[A-Z_]+$/.test(e.message) ? e.message : '';
  return [name, code, message].filter(Boolean).join(':');
}

const send = (res: ServerResponse, status: number, body: string, type = 'text/plain'): void => {
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
  res.end(body);
};

const CORRELATION = /^[A-Za-z0-9-]{8,64}$/;

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/__health') return send(res, 200, 'ok');
  if (url.pathname === '/__stats' && req.method === 'GET') return send(res, 200, JSON.stringify(stats), 'application/json');
  if (url.pathname === '/__reset' && req.method === 'POST') {
    stats = newStats();
    return send(res, 204, '');
  }
  const op = url.pathname.startsWith('/op/') ? (url.pathname.slice(4) as Op) : undefined;
  if (op === undefined || !OPS.includes(op)) return send(res, 404, 'not found');
  const orgIndex = Number(url.searchParams.get('org') ?? '0');
  const org = seed.orgs[orgIndex];
  const header = req.headers['x-correlation-id'];
  const correlationId = typeof header === 'string' && CORRELATION.test(header) ? header : `spk04-${hex(8)}`;
  if (org === undefined) return send(res, 400, 'bad org');
  const started = performance.now();
  const probe = new Probe();
  const r: Request = { org, correlationId };
  const samples = stats[op];
  try {
    if (op === 'create') await opCreate(r, probe);
    else if (op === 'update') await opUpdate(r, probe);
    else if (op === 'detail') await opDetail(r, probe);
    else if (op === 'list') await opList(r, probe);
    else await opLoginFailed(correlationId, probe);
  } catch (error) {
    samples.errors += 1;
    const kind = errorKind(error);
    stats.errorsByKind[kind] = (stats.errorsByKind[kind] ?? 0) + 1;
    return send(res, 500, 'error');
  }
  samples.total.push(ms(performance.now() - started));
  samples.audit.push(ms(probe.auditMs));
  samples.lock.push(ms(probe.lockMs));
  samples.roundTrips.push(probe.roundTrips);
  samples.hot.push(orgIndex === 0 && op !== 'login_failed' ? 1 : 0);
  send(res, 200, 'ok');
}

const server = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    handle(req, res).catch(() => send(res, 500, 'error'));
  });
});
server.keepAliveTimeout = 65_000;
server.listen(port, process.env['SPK04_BIND'] ?? '127.0.0.1', () => {
  process.stdout.write(`spk04 replica ${replica} mode ${mode} listening on ${String(port)}\n`);
});
const shutdown = (): void => {
  server.close();
  runtime.resources.forEach((r) => void r.close());
  setTimeout(() => process.exit(0), 500).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
