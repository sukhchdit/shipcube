/**
 * SPK-08 anchor spike (TASK-012, specialist 12B; SEC-TC-44; ADR-0007 amendments 7 and 8; data-model.md §3.4,
 * §5.2, §5.4-§5.6 and the §5.6 amendment): the hourly checkpoint with an ECDSA P-256/SHA-256 signed, chained anchor
 * and the verifier's tamper detection, on PostgreSQL 18.
 *
 * Throwaway spike code. The reduced audit schema below is created inside the test (as `platform_audit_owner`, on a
 * clone of a template bootstrapped with the pre-audit files `0N-*.sql` only) and is never a migration or a
 * bootstrap-lane script. Lifecycle (SPK-08 §8): TASK-116's PR ports this suite and `spk08/anchor-prototype.ts` into
 * `packages/audit` and its verifier suite, then deletes both. The writer and the
 * verifier connect as `platform_app`; the tampering attacker is the cluster superuser with
 * `session_replication_role = replica` (which skips the append-only triggers).
 *
 * The signing key is generated in memory per run and never exported, written or printed. Only public material (the
 * SPKI PEM, signatures, hashes) reaches disk, in a temp directory deleted in `afterAll`.
 * Set `SPK08_ANCHOR_REPORT=<file>` to write the measured values.
 */
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomUUID, webcrypto, type KeyObject } from 'node:crypto';
import {
  closeSync,
  cpSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { findRepoRoot } from '../../../tools/test-support/process.js';
import { PlatformPostgres } from '../harness/postgres.js';
import {
  ALGORITHM,
  SYSTEM_SHARD_0,
  ZERO32,
  anchorHash,
  derToP1363,
  entryHash,
  headsDigest,
  readAnchors,
  readStream,
  reconstructHeads,
  sinkLine,
  signAnchorHash,
  snapshotHeads,
  sqlTimestampText,
  verifyAnchorLog,
  verifyAnchorSignature,
  verifyAnchorSignatures,
  verifyAnchoredHeads,
  verifyStreamChain,
  type AnchorRecord,
  type Failure,
  type Json,
} from './spk08/anchor-prototype.js';

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const KEY_ID = 'audit-anchor-v1';
const BOOTSTRAP_DIR = join(findRepoRoot(), 'prisma', 'bootstrap');
const ANCHOR_TEMPLATE = 'spk08_anchor_tpl';

/** Reduced spike schema: the columns that matter for chaining and anchoring (data-model §3.4, §5.1, §5.2, §5.5). */
const SPIKE_DDL = `
SET ROLE platform_audit_owner;
CREATE TABLE public.audit_entries (
  id           uuid        NOT NULL,
  occurred_at  timestamptz NOT NULL,
  stream_id    uuid        NOT NULL,
  stream_seq   bigint      NOT NULL CHECK (stream_seq >= 1),
  action       text        NOT NULL,
  entity_name  text        NOT NULL CHECK (entity_name ~ '^[a-z][a-z0-9_]*$'),
  entity_id    text,
  new_value    jsonb,
  hash_version smallint    NOT NULL DEFAULT 1,
  prev_hash    bytea       NOT NULL CHECK (octet_length(prev_hash) = 32),
  entry_hash   bytea       NOT NULL CHECK (octet_length(entry_hash) = 32),
  PRIMARY KEY (occurred_at, id),
  UNIQUE (entry_hash, occurred_at)
) PARTITION BY RANGE (occurred_at);
CREATE TABLE public.audit_entries_default PARTITION OF public.audit_entries DEFAULT;
CREATE INDEX ix_audit__stream_seq ON public.audit_entries (stream_id, stream_seq);

CREATE TABLE public.audit_stream_heads (
  stream_id        uuid        PRIMARY KEY,
  entry_count      bigint      NOT NULL DEFAULT 0,
  head_entry_id    uuid,
  head_occurred_at timestamptz,
  head_hash        bytea       NOT NULL CHECK (octet_length(head_hash) = 32)
);

CREATE TABLE public.audit_checkpoint_heads (
  id                  uuid        PRIMARY KEY DEFAULT pg_catalog.uuidv7(),
  checkpoint_entry_id uuid        NOT NULL,
  stream_id           uuid        NOT NULL,
  entry_count         bigint      NOT NULL,
  head_hash           bytea       NOT NULL CHECK (octet_length(head_hash) = 32),
  head_occurred_at    timestamptz,
  created_at          timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE UNIQUE INDEX ux_audit_checkpoint_heads__checkpoint_stream ON public.audit_checkpoint_heads (checkpoint_entry_id, stream_id);
CREATE INDEX ix_audit_checkpoint_heads__stream_checkpoint ON public.audit_checkpoint_heads (stream_id, checkpoint_entry_id DESC);

CREATE TABLE public.audit_anchors (
  anchor_seq          bigint      PRIMARY KEY CHECK (anchor_seq >= 1),
  checkpoint_entry_id uuid        NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL,
  heads_digest        bytea       NOT NULL CHECK (octet_length(heads_digest) = 32),
  prev_anchor_hash    bytea       NOT NULL CHECK (octet_length(prev_anchor_hash) = 32),
  anchor_hash         bytea       NOT NULL UNIQUE CHECK (octet_length(anchor_hash) = 32),
  algorithm           text        NOT NULL CHECK (algorithm = 'ECDSA_P256_SHA256'),
  key_id              text        NOT NULL CHECK (key_id ~ '^[a-z][a-z0-9-]*-v[0-9]+$'),
  signature           bytea       NOT NULL CHECK (octet_length(signature) BETWEEN 8 AND 72)
);

CREATE FUNCTION platform.audit_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '42501',
    MESSAGE = pg_catalog.format('AUDIT_IMMUTABLE: %s on %s is not permitted', TG_OP, TG_TABLE_NAME);
END $$;
CREATE TRIGGER trg_audit_entries__no_update_delete BEFORE UPDATE OR DELETE ON public.audit_entries
  FOR EACH ROW EXECUTE FUNCTION platform.audit_forbid_mutation();
CREATE TRIGGER trg_audit_entries__no_truncate BEFORE TRUNCATE ON public.audit_entries
  FOR EACH STATEMENT EXECUTE FUNCTION platform.audit_forbid_mutation();
CREATE TRIGGER trg_audit_checkpoint_heads__immutable BEFORE UPDATE OR DELETE ON public.audit_checkpoint_heads
  FOR EACH ROW EXECUTE FUNCTION platform.audit_forbid_mutation();
CREATE TRIGGER trg_audit_checkpoint_heads__no_truncate BEFORE TRUNCATE ON public.audit_checkpoint_heads
  FOR EACH STATEMENT EXECUTE FUNCTION platform.audit_forbid_mutation();
CREATE TRIGGER trg_audit_anchors__immutable BEFORE UPDATE OR DELETE ON public.audit_anchors
  FOR EACH ROW EXECUTE FUNCTION platform.audit_forbid_mutation();
CREATE TRIGGER trg_audit_anchors__no_truncate BEFORE TRUNCATE ON public.audit_anchors
  FOR EACH STATEMENT EXECUTE FUNCTION platform.audit_forbid_mutation();

GRANT SELECT, INSERT ON public.audit_entries, public.audit_checkpoint_heads, public.audit_anchors TO platform_app;
GRANT SELECT, INSERT, UPDATE ON public.audit_stream_heads TO platform_app;
RESET ROLE;
`;

interface Signer {
  readonly keyId: string;
  readonly privateKey: KeyObject;
}

interface World {
  readonly database: string;
  /** Writer and verifier session (`platform_app`). */
  readonly app: pg.Client;
  /** Attacker session (cluster superuser). */
  readonly su: pg.Client;
  readonly sinkPath: string;
}

interface EntryInput {
  readonly action: string;
  readonly entityName: string;
  readonly entityId: string | null;
  readonly newValue: Json;
}

const report: Record<string, unknown> = {};
const worlds: World[] = [];

let pgContainer: PlatformPostgres | undefined;
let template: string;
let tempDir: string;
let signer: Signer;
let publicKeyPem: string;
let publicKeys: ReadonlyMap<string, string>;

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

async function sqlState(action: Promise<unknown>): Promise<{ code: string | undefined; message: string }> {
  try {
    await action;
  } catch (error) {
    const e = error as { code?: string; message?: string };
    return { code: e.code, message: e.message ?? '' };
  }
  return { code: 'NO_ERROR', message: '' };
}

async function newWorld(): Promise<World> {
  const db = must(pgContainer, 'PostgreSQL container');
  const database = await db.clone(template);
  const su = await db.superuser(database);
  await su.query(SPIKE_DDL);
  const app = new pg.Client(db.appConnection(database));
  await app.connect();
  const world: World = { database, app, su, sinkPath: join(tempDir, `${database}.jsonl`) };
  writeFileSync(world.sinkPath, '');
  worlds.push(world);
  return world;
}

/** data-model §5.4 steps 2-5, inside the caller's transaction. */
async function appendEntryInTx(client: pg.ClientBase, streamId: string, input: EntryInput, fixedId?: string): Promise<Buffer> {
  await client.query(`SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('audit:' || $1::text)::bigint)`, [streamId]);
  await client.query(
    `INSERT INTO public.audit_stream_heads (stream_id, entry_count, head_hash) VALUES ($1, 0, $2) ON CONFLICT (stream_id) DO NOTHING`,
    [streamId, ZERO32],
  );
  const { rows } = await client.query<{ entry_count: string; head_hash: Buffer; occurred_at: string; new_id: string }>(
    `SELECT entry_count::text AS entry_count, head_hash,
            ${sqlTimestampText(`GREATEST(pg_catalog.clock_timestamp(), head_occurred_at + interval '1 microsecond')`)} AS occurred_at,
            pg_catalog.uuidv7()::text AS new_id
       FROM public.audit_stream_heads WHERE stream_id = $1`,
    [streamId],
  );
  const head = must(rows[0], 'stream head');
  const content = {
    id: fixedId ?? head.new_id,
    occurredAt: head.occurred_at,
    streamId,
    streamSeq: BigInt(head.entry_count) + 1n,
    action: input.action,
    entityName: input.entityName,
    entityId: input.entityId,
    newValue: input.newValue,
    hashVersion: 1,
  };
  const hash = entryHash(content, head.head_hash);
  await client.query(
    `INSERT INTO public.audit_entries (id, occurred_at, stream_id, stream_seq, action, entity_name, entity_id, new_value,
                                       hash_version, prev_hash, entry_hash)
     VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8::jsonb, 1, $9, $10)`,
    [
      content.id,
      content.occurredAt,
      streamId,
      content.streamSeq.toString(),
      input.action,
      input.entityName,
      input.entityId,
      JSON.stringify(input.newValue),
      head.head_hash,
      hash,
    ],
  );
  const advanced = await client.query(
    `UPDATE public.audit_stream_heads SET entry_count = $2, head_entry_id = $3, head_occurred_at = $4::timestamptz, head_hash = $5
      WHERE stream_id = $1 AND entry_count = $2 - 1`,
    [streamId, content.streamSeq.toString(), content.id, content.occurredAt, hash],
  );
  if (advanced.rowCount !== 1) throw new Error('stream head did not advance');
  return hash;
}

async function appendEntry(client: pg.ClientBase, streamId: string, input: EntryInput): Promise<void> {
  await client.query('BEGIN');
  try {
    await appendEntryInTx(client, streamId, input);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function appendToSink(path: string, line: string): void {
  const fd = openSync(path, 'a');
  try {
    writeSync(fd, `${line}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** data-model §5.5 procedure: one transaction as platform_app, then the sink append after COMMIT. */
async function checkpoint(w: World, by: Signer = signer, options: { writeSink?: boolean } = {}): Promise<AnchorRecord> {
  const c = w.app;
  await c.query('BEGIN');
  try {
    await c.query(`SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('audit:anchors')::bigint)`);
    const last = await c.query<{ anchor_seq: string; anchor_hash: Buffer }>(
      // qualified ORDER BY: a bare `anchor_seq` would sort by the ::text output alias and pick '9' over '10'
      'SELECT a.anchor_seq::text AS anchor_seq, a.anchor_hash FROM public.audit_anchors a ORDER BY a.anchor_seq DESC LIMIT 1',
    );
    const prevSeq = BigInt(last.rows[0]?.anchor_seq ?? '0');
    const prevAnchorHash = last.rows[0]?.anchor_hash ?? ZERO32;
    const heads = await snapshotHeads(c);
    const digest = headsDigest(heads);
    const meta = await c.query<{ id: string; created_at: string }>(
      `SELECT pg_catalog.uuidv7()::text AS id, ${sqlTimestampText('pg_catalog.clock_timestamp()')} AS created_at`,
    );
    const { id: checkpointEntryId, created_at: createdAt } = must(meta.rows[0], 'checkpoint metadata');
    const anchorSeq = prevSeq + 1n;
    const hash = anchorHash({ anchorSeq, createdAt, headsDigest: digest, prevAnchorHash });
    const signature = signAnchorHash(hash, by.privateKey);
    const delta = await c.query(
      `INSERT INTO public.audit_checkpoint_heads (checkpoint_entry_id, stream_id, entry_count, head_hash, head_occurred_at)
       SELECT $1, s.stream_id, s.entry_count, s.head_hash, s.head_occurred_at
         FROM unnest($2::uuid[], $3::bigint[], $4::bytea[], $5::timestamptz[]) AS s(stream_id, entry_count, head_hash, head_occurred_at)
         LEFT JOIN LATERAL (SELECT ch.entry_count FROM public.audit_checkpoint_heads ch
                             WHERE ch.stream_id = s.stream_id ORDER BY ch.checkpoint_entry_id DESC LIMIT 1) prev ON true
        WHERE prev.entry_count IS DISTINCT FROM s.entry_count`,
      [
        checkpointEntryId,
        heads.map((h) => h.streamId),
        heads.map((h) => h.entryCount.toString()),
        heads.map((h) => h.headHash),
        heads.map((h) => h.headOccurredAt),
      ],
    );
    const record: AnchorRecord = {
      anchorSeq,
      checkpointEntryId,
      createdAt,
      headsDigest: digest,
      prevAnchorHash,
      anchorHash: hash,
      algorithm: ALGORITHM,
      keyId: by.keyId,
      signature,
    };
    await c.query(
      `INSERT INTO public.audit_anchors (anchor_seq, checkpoint_entry_id, created_at, heads_digest, prev_anchor_hash, anchor_hash, algorithm, key_id, signature)
       VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7, $8, $9)`,
      [anchorSeq.toString(), checkpointEntryId, createdAt, digest, prevAnchorHash, hash, ALGORITHM, by.keyId, signature],
    );
    await appendEntryInTx(
      c,
      SYSTEM_SHARD_0,
      {
        action: 'CREATE',
        entityName: 'chain_checkpoint',
        entityId: checkpointEntryId,
        newValue: {
          heads_digest: digest.toString('hex'),
          stream_count: heads.length,
          delta_count: delta.rowCount ?? 0,
          anchor_seq: Number(anchorSeq),
          as_of: createdAt,
        },
      },
      checkpointEntryId,
    );
    await c.query('COMMIT');
    if (options.writeSink ?? true) appendToSink(w.sinkPath, sinkLine(record));
    return record;
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  }
}

const sample = (n: number): EntryInput => ({
  action: 'UPDATE',
  entityName: 'shipment',
  entityId: `shp-${String(n)}`,
  newValue: { status: n % 2 === 0 ? 'BOOKED' : 'QUOTED', amount_minor: 1000 + n },
});

/** Two org streams, then `checkpoints` rounds of (entries in both streams → checkpoint). */
async function seededWorld(checkpoints: number): Promise<World> {
  const w = await newWorld();
  let n = 0;
  for (let round = 0; round < checkpoints; round += 1) {
    for (let i = 0; i < 3; i += 1) await appendEntry(w.app, ORG_A, sample((n += 1)));
    for (let i = 0; i < 2; i += 1) await appendEntry(w.app, ORG_B, sample((n += 1)));
    await checkpoint(w);
  }
  return w;
}

/**
 * The verifier in its nightly shape: a full chain walk of every stream from seq 1, then steps (i)-(iii). Runs as
 * platform_app. The production hourly run walks incrementally (data-model §5.6); a rewrite behind an intact anchored
 * head row is caught only by this full walk, within 24 h (PR12-SEC-05, SPK-08 AF-9/AF-12).
 */
async function verifyAll(w: World, keys: ReadonlyMap<string, string> = publicKeys, sinkRetryWindowOpen = false): Promise<Failure[]> {
  const failures: Failure[] = [];
  const streams = await w.app.query<{ stream_id: string }>(
    'SELECT stream_id::text AS stream_id FROM public.audit_stream_heads ORDER BY stream_id',
  );
  for (const { stream_id: streamId } of streams.rows) failures.push(...(await verifyStreamChain(w.app, streamId)));
  const anchors = await readAnchors(w.app);
  const sinkLines = readFileSync(w.sinkPath, 'utf8').split('\n');
  failures.push(...verifyAnchorLog({ tableRows: anchors, sinkLines, fromSeq: 1n, expectedPrevHash: ZERO32, sinkRetryWindowOpen }));
  failures.push(...verifyAnchorSignatures(anchors, keys));
  const latest = anchors.at(-1);
  if (latest !== undefined) failures.push(...(await verifyAnchoredHeads(w.app, latest)));
  return failures;
}

const kinds = (failures: readonly Failure[]): string[] => [...new Set(failures.map((f) => f.kind))].sort();
const steps = (failures: readonly Failure[]): string[] => [...new Set(failures.map((f) => `${f.kind}@${f.step}`))].sort();

// ------------------------------------------------------------------ attacker (cluster superuser) helpers

async function asReplica<T>(su: pg.Client, action: () => Promise<T>): Promise<T> {
  await su.query('BEGIN');
  try {
    await su.query('SET LOCAL session_replication_role = replica');
    const result = await action();
    await su.query('COMMIT');
    return result;
  } catch (error) {
    await su.query('ROLLBACK');
    throw error;
  }
}

/** Re-hashes a whole stream after `mutate`, rewrites the entries and the stream head; returns seq → new entry_hash. */
async function rechain(
  su: pg.Client,
  streamId: string,
  mutate: (seq: bigint, value: Json) => Json | undefined,
): Promise<Map<bigint, Buffer>> {
  const entries = await readStream(su, streamId);
  const hashes = new Map<bigint, Buffer>();
  let prev = ZERO32;
  for (const entry of entries) {
    const newValue = mutate(entry.streamSeq, entry.newValue) ?? entry.newValue;
    const hash = entryHash({ ...entry, newValue }, prev);
    await su.query(
      `UPDATE public.audit_entries SET new_value = $1::jsonb, prev_hash = $2, entry_hash = $3 WHERE occurred_at = $4::timestamptz AND id = $5`,
      [JSON.stringify(newValue), prev, hash, entry.occurredAt, entry.id],
    );
    hashes.set(entry.streamSeq, hash);
    prev = hash;
  }
  await su.query('UPDATE public.audit_stream_heads SET head_hash = $1 WHERE stream_id = $2', [prev, streamId]);
  return hashes;
}

/**
 * SEC-TC-44 base tamper: change ORG_A entry seq 2 (older than every anchor), recompute ORG_A's chain, its stream head
 * and its audit_checkpoint_heads rows, then rewrite the latest checkpoint entry's `new_value.heads_digest` (re-chaining
 * SYSTEM shard 0) so every in-database cross-check agrees. Returns the forged digest of the latest checkpoint.
 */
async function tamperBehindAnchor(w: World, latest: AnchorRecord): Promise<Buffer> {
  return asReplica(w.su, async () => {
    const hashes = await rechain(w.su, ORG_A, (seq, value) =>
      seq === 2n ? { ...(value as Record<string, Json>), amount_minor: 1 } : undefined,
    );
    for (const [seq, hash] of hashes) {
      await w.su.query('UPDATE public.audit_checkpoint_heads SET head_hash = $1 WHERE stream_id = $2 AND entry_count = $3', [
        hash,
        ORG_A,
        seq.toString(),
      ]);
    }
    const forged = headsDigest(await reconstructHeads(w.su, latest.checkpointEntryId));
    const shard0 = await readStream(w.su, SYSTEM_SHARD_0);
    const lastSeq = must(shard0.at(-1), 'checkpoint entry').streamSeq;
    await rechain(w.su, SYSTEM_SHARD_0, (seq, value) =>
      seq === lastSeq ? { ...(value as Record<string, Json>), heads_digest: forged.toString('hex') } : undefined,
    );
    return forged;
  });
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'spk08-anchor-'));
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  signer = { keyId: KEY_ID, privateKey: pair.privateKey };
  publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  publicKeys = new Map([[KEY_ID, publicKeyPem]]);
  const started = performance.now();
  pgContainer = await PlatformPostgres.start();
  // Only the pre-audit bootstrap files (`0N-*.sql`): SPIKE_DDL creates its own audit tables, so TASK-021's real
  // `10-audit.sql` / `90-*.sql` must not be applied underneath it (SPK-08 §8 lifecycle).
  const bootstrapDir = join(tempDir, 'bootstrap');
  mkdirSync(bootstrapDir);
  for (const name of readdirSync(BOOTSTRAP_DIR)) {
    if (/^0\d-[a-z0-9-]+\.sql$/.test(name)) cpSync(join(BOOTSTRAP_DIR, name), join(bootstrapDir, name));
  }
  report['bootstrap_files'] = readdirSync(bootstrapDir).sort();
  template = ANCHOR_TEMPLATE;
  await pgContainer.createDatabase(ANCHOR_TEMPLATE);
  await pgContainer.bootstrap(ANCHOR_TEMPLATE, bootstrapDir);
  report['container_and_template_ms'] = Math.round(performance.now() - started);
}, 300_000);

afterAll(async () => {
  for (const w of worlds) {
    await w.app.end().catch(() => undefined);
    await w.su.end().catch(() => undefined);
  }
  await pgContainer?.stop();
  rmSync(tempDir, { recursive: true, force: true });
  const out = process.env['SPK08_ANCHOR_REPORT'];
  if (out) writeFileSync(out, `${JSON.stringify(report, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2)}\n`);
}, 120_000);

describe('SPK-08 anchor (SEC-TC-44): signed, chained hourly checkpoint anchors on PostgreSQL 18', () => {
  it('SPK-08-ANCHOR-01 keys: in-memory P-256 key, DER signature over anchor_hash, verified by public key only (Node, WebCrypto, openssl)', async () => {
    expect(signer.privateKey.type).toBe('private');
    expect(signer.privateKey.asymmetricKeyDetails?.namedCurve).toBe('prime256v1');

    // golden vectors pin the byte layouts for TASK-033 / TASK-116
    const emptyDigest = headsDigest([]);
    expect(emptyDigest.toString('hex')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    const vectorHeads = headsDigest([
      { streamId: '00000000-0000-0000-0000-000000000002', entryCount: 2n, headHash: Buffer.alloc(32, 0x22), headOccurredAt: null },
      { streamId: '00000000-0000-0000-0000-000000000001', entryCount: 1n, headHash: Buffer.alloc(32, 0x11), headOccurredAt: null },
    ]);
    const vectorAnchor = anchorHash({
      anchorSeq: 1n,
      createdAt: '2026-11-12T10:00:00.000000Z',
      headsDigest: vectorHeads,
      prevAnchorHash: ZERO32,
    });
    report['vector_heads_digest'] = vectorHeads.toString('hex');
    report['vector_anchor_hash'] = vectorAnchor.toString('hex');
    // pinned: SPK-08 §5.2 publishes these for TASK-116's unit tests (recomputed independently in the PR #12 review)
    expect(vectorHeads.toString('hex')).toBe('0425126b6f48a8a14993da0de8d42d83f1625e62b687cd46d6d70bfc154cafc6');
    expect(vectorAnchor.toString('hex')).toBe('3bf63296f767bb8bd33b648d2aa65a991fe99cce26aafa527c0ef73594a2a9b5');

    const signature = signAnchorHash(vectorAnchor, signer.privateKey);
    expect(signature[0]).toBe(0x30); // DER SEQUENCE
    expect(signature.length).toBeGreaterThanOrEqual(8);
    expect(signature.length).toBeLessThanOrEqual(72);
    expect(verifyAnchorSignature(vectorAnchor, signature, publicKeyPem)).toBe(true);
    expect(verifyAnchorSignature(Buffer.alloc(32, 1), signature, publicKeyPem)).toBe(false);
    report['der_signature_length'] = signature.length;

    // WebCrypto (in-browser verifier) accepts only IEEE P1363 r‖s: the DER must be converted first
    const subtle = webcrypto.subtle;
    const spkiDer = new Uint8Array(Buffer.from(publicKeyPem.replace(/-----[^-]+-----|\s/g, ''), 'base64'));
    const spki = await subtle.importKey('spki', spkiDer, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const algorithm = { name: 'ECDSA', hash: 'SHA-256' };
    const message = new Uint8Array(vectorAnchor);
    expect(await subtle.verify(algorithm, spki, new Uint8Array(derToP1363(signature)), message)).toBe(true);
    expect(await subtle.verify(algorithm, spki, new Uint8Array(signature), message)).toBe(false);

    // third-party check with the openssl CLI, public material only (anchor_hash.bin, sig.der, pub.pem)
    const probe = spawnSync('openssl', ['version'], { encoding: 'utf8', timeout: 10_000 });
    if (probe.status === 0) {
      const dir = mkdtempSync(join(tempDir, 'openssl-'));
      writeFileSync(join(dir, 'pub.pem'), publicKeyPem);
      writeFileSync(join(dir, 'sig.der'), signature);
      writeFileSync(join(dir, 'anchor_hash.bin'), vectorAnchor);
      const run = spawnSync(
        'openssl',
        ['dgst', '-sha256', '-verify', join(dir, 'pub.pem'), '-signature', join(dir, 'sig.der'), join(dir, 'anchor_hash.bin')],
        {
          encoding: 'utf8',
          timeout: 10_000,
        },
      );
      expect(run.stdout.trim()).toBe('Verified OK');
      report['openssl'] = { version: probe.stdout.trim(), result: run.stdout.trim() };
    } else {
      // SPK08_REQUIRE_OPENSSL=1 turns the silent skip into a failure (n5)
      expect({ openssl: 'not available', required: process.env['SPK08_REQUIRE_OPENSSL'] === '1' }).toEqual({
        openssl: 'not available',
        required: false,
      });
      report['openssl'] = 'NOT AVAILABLE on this host; Node and WebCrypto checks only';
    }
  });

  it('SPK-08-ANCHOR-02 happy path: entries in two streams → checkpoints → dense, chained anchors in table and sink; verifier (i)-(iii) pass', async () => {
    const w = await seededWorld(3);
    const anchors = await readAnchors(w.app);
    expect(anchors.map((a) => a.anchorSeq)).toEqual([1n, 2n, 3n]);
    expect(anchors[0]?.prevAnchorHash.equals(ZERO32)).toBe(true);
    expect(anchors[1]?.prevAnchorHash.equals(must(anchors[0], 'anchor 1').anchorHash)).toBe(true);
    expect(anchors[2]?.prevAnchorHash.equals(must(anchors[1], 'anchor 2').anchorHash)).toBe(true);
    const sink = readFileSync(w.sinkPath, 'utf8').trim().split('\n');
    expect(sink).toEqual(anchors.map(sinkLine));

    // delta rows: first checkpoint stores every stream; later ones only streams whose entry_count moved
    const deltas = await w.app.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.audit_checkpoint_heads GROUP BY checkpoint_entry_id ORDER BY checkpoint_entry_id`,
    );
    expect(deltas.rows.map((r) => r.n)).toEqual(['2', '3', '3']); // cp1: A, B; cp2/3: A, B and shard 0
    const idle = await checkpoint(w);
    const idleDelta = await w.app.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM public.audit_checkpoint_heads WHERE checkpoint_entry_id = $1',
      [idle.checkpointEntryId],
    );
    expect(idleDelta.rows[0]?.n).toBe('1'); // only shard 0 moved (the previous checkpoint entry)

    expect(await verifyAll(w)).toEqual([]);

    // the newest anchor may be absent from the sink only while the writer's sink retry is running
    await appendEntry(w.app, ORG_B, sample(99));
    await checkpoint(w, signer, { writeSink: false });
    expect(await verifyAll(w, publicKeys, true)).toEqual([]);
    expect(steps(await verifyAll(w, publicKeys, false))).toEqual(['ANCHOR_MISSING@i']);
  }, 120_000);

  it('SEC-TC-44 (a) superuser rewrites an anchored entry, chain, heads, checkpoint heads AND the anchor heads_digest → CHECKPOINT_SIGNATURE_INVALID', async () => {
    const w = await seededWorld(2);
    const latest = must((await readAnchors(w.app)).at(-1), 'latest anchor');
    const forged = await tamperBehindAnchor(w, latest);
    const forgedHash = anchorHash({ ...latest, headsDigest: forged });
    await asReplica(w.su, () =>
      w.su.query('UPDATE public.audit_anchors SET heads_digest = $1, anchor_hash = $2 WHERE anchor_seq = $3', [
        forged,
        forgedHash,
        latest.anchorSeq.toString(),
      ]),
    );
    // sink untouched (the M5 locked sink): signature AND table/sink disagreement
    const withLockedSink = await verifyAll(w);
    expect(withLockedSink.filter((f) => f.step === 'chain')).toEqual([]); // the chain walk alone is fooled
    expect(steps(withLockedSink)).toEqual(['ANCHOR_MISSING@i', 'CHECKPOINT_SIGNATURE_INVALID@ii']);

    // the attacker also rewrites the (unlocked, local file) sink line: the signature alone still catches it
    const lines = readFileSync(w.sinkPath, 'utf8').trim().split('\n');
    lines[lines.length - 1] = sinkLine({ ...latest, headsDigest: forged, anchorHash: forgedHash });
    writeFileSync(w.sinkPath, `${lines.join('\n')}\n`);
    const withForgedSink = await verifyAll(w);
    expect(steps(withForgedSink)).toEqual(['CHECKPOINT_SIGNATURE_INVALID@ii']);
    report['tc44_a'] = { locked_sink: steps(withLockedSink), forged_sink: steps(withForgedSink) };
  }, 120_000);

  it('SEC-TC-44 (b) same tamper, anchor untouched → CHECKPOINT_HEAD_MISMATCH', async () => {
    const w = await seededWorld(2);
    const latest = must((await readAnchors(w.app)).at(-1), 'latest anchor');
    await tamperBehindAnchor(w, latest);
    const failures = await verifyAll(w);
    expect(failures.filter((f) => f.step === 'chain')).toEqual([]);
    expect(steps(failures)).toEqual(['CHECKPOINT_HEAD_MISMATCH@iii-a']);
    expect(kinds(failures)).toEqual(['CHECKPOINT_HEAD_MISMATCH']);

    // a lazier attacker who leaves audit_checkpoint_heads alone is caught by the per-stream probe (iii)(b) as well
    const w2 = await seededWorld(2);
    await asReplica(w2.su, () =>
      rechain(w2.su, ORG_A, (seq, value) => (seq === 2n ? { ...(value as Record<string, Json>), amount_minor: 1 } : undefined)),
    );
    const lazy = await verifyAll(w2);
    expect(lazy.filter((f) => f.step === 'chain')).toEqual([]);
    expect(lazy.some((f) => f.kind === 'CHECKPOINT_HEAD_MISMATCH' && f.step === 'iii-b' && f.streamId === ORG_A)).toBe(true);
    report['tc44_b'] = { thorough: steps(failures), lazy: steps(lazy) };
  }, 180_000);

  it('SEC-TC-44 (c) deleted or reordered anchor rows (and a reordered sink) → ANCHOR_MISSING', async () => {
    const results: Record<string, string[]> = {};

    const middle = await seededWorld(3);
    await asReplica(middle.su, () => middle.su.query('DELETE FROM public.audit_anchors WHERE anchor_seq = 2'));
    results['deleted_middle'] = steps(await verifyAll(middle));

    const newest = await seededWorld(3);
    await asReplica(newest.su, () => newest.su.query('DELETE FROM public.audit_anchors WHERE anchor_seq = 3'));
    results['deleted_newest'] = steps(await verifyAll(newest));
    results['deleted_newest_retry_window_open'] = steps(await verifyAll(newest, publicKeys, true));

    const swapped = await seededWorld(3);
    await asReplica(swapped.su, async () => {
      await swapped.su.query('UPDATE public.audit_anchors SET anchor_seq = 1000 WHERE anchor_seq = 2');
      await swapped.su.query('UPDATE public.audit_anchors SET anchor_seq = 2 WHERE anchor_seq = 3');
      await swapped.su.query('UPDATE public.audit_anchors SET anchor_seq = 3 WHERE anchor_seq = 1000');
    });
    results['reordered_rows'] = steps(await verifyAll(swapped));

    const sinkSwap = await seededWorld(3);
    const lines = readFileSync(sinkSwap.sinkPath, 'utf8').trim().split('\n');
    writeFileSync(sinkSwap.sinkPath, `${[lines[0], lines[2], lines[1]].join('\n')}\n`);
    results['reordered_sink'] = steps(await verifyAll(sinkSwap));

    report['tc44_c'] = results;
    for (const [variant, found] of Object.entries(results)) {
      expect({ variant, anchorMissing: found.includes('ANCHOR_MISSING@i') }).toEqual({ variant, anchorMissing: true });
    }
  }, 240_000);

  it('SPK-08-ANCHOR-06 append-only: platform_app and the owner cannot UPDATE/DELETE/TRUNCATE audit_anchors; unknown key_id → CHECKPOINT_SIGNATURE_INVALID', async () => {
    const w = await seededWorld(1);
    const asApp = {
      update: await sqlState(w.app.query(`UPDATE public.audit_anchors SET key_id = 'audit-anchor-v2'`)),
      delete: await sqlState(w.app.query('DELETE FROM public.audit_anchors')),
      truncate: await sqlState(w.app.query('TRUNCATE public.audit_anchors')),
    };
    const asOwner = async (sql: string): Promise<{ code: string | undefined; message: string }> => {
      await w.su.query('BEGIN');
      try {
        await w.su.query('SET LOCAL ROLE platform_audit_owner');
        return await sqlState(w.su.query(sql));
      } finally {
        await w.su.query('ROLLBACK');
      }
    };
    const owner = {
      update: await asOwner(`UPDATE public.audit_anchors SET key_id = 'audit-anchor-v2'`),
      delete: await asOwner('DELETE FROM public.audit_anchors'),
      truncate: await asOwner('TRUNCATE public.audit_anchors'),
    };
    report['append_only'] = { platform_app: asApp, platform_audit_owner: owner };
    for (const result of [...Object.values(asApp), ...Object.values(owner)]) expect(result.code).toBe('42501');
    for (const result of Object.values(owner)) expect(result.message).toMatch(/^AUDIT_IMMUTABLE: /);
    expect((await readAnchors(w.app)).length).toBe(1);

    // an anchor signed under a key_id that is not in AUDIT_ANCHOR_PUBLIC_KEYS, correctly chained and in the sink
    const rogue: Signer = { keyId: 'audit-anchor-v9', privateKey: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey };
    await appendEntry(w.app, ORG_A, sample(50));
    const forged = await checkpoint(w, rogue);
    const unknown = await verifyAll(w);
    expect(steps(unknown)).toEqual(['CHECKPOINT_SIGNATURE_INVALID@ii']);
    expect(unknown[0]?.detail).toBe('unknown key_id audit-anchor-v9');

    // the same anchor claimed under the registered key_id: the signature does not verify
    const claimed = verifyAnchorSignatures([{ ...forged, keyId: KEY_ID }], publicKeys);
    expect(claimed.map((f) => f.detail)).toEqual(['signature does not verify']);
  }, 120_000);

  it('SPK-08-ANCHOR-07 measure: sign+verify one anchor; read and verify 1,000 anchors (steps i and ii)', async () => {
    const rounds = 200;
    const hash = anchorHash({ anchorSeq: 1n, createdAt: '2026-11-12T10:00:00.000000Z', headsDigest: ZERO32, prevAnchorHash: ZERO32 });
    const t0 = performance.now();
    for (let i = 0; i < rounds; i += 1) {
      if (!verifyAnchorSignature(hash, signAnchorHash(hash, signer.privateKey), publicKeyPem)) throw new Error('round-trip failed');
    }
    const signVerifyMs = (performance.now() - t0) / rounds;

    const w = await newWorld();
    const records: AnchorRecord[] = [];
    let prev = ZERO32;
    const base = Date.UTC(2026, 10, 1);
    for (let seq = 1n; seq <= 1000n; seq += 1n) {
      const createdAt = `${new Date(base + Number(seq) * 3_600_000).toISOString().slice(0, 19)}.000000Z`;
      const digest = headsDigest([
        { streamId: ORG_A, entryCount: seq, headHash: Buffer.alloc(32, Number(seq % 256n)), headOccurredAt: null },
      ]);
      const h = anchorHash({ anchorSeq: seq, createdAt, headsDigest: digest, prevAnchorHash: prev });
      records.push({
        anchorSeq: seq,
        checkpointEntryId: randomUUID(),
        createdAt,
        headsDigest: digest,
        prevAnchorHash: prev,
        anchorHash: h,
        algorithm: ALGORITHM,
        keyId: KEY_ID,
        signature: signAnchorHash(h, signer.privateKey),
      });
      prev = h;
    }
    await w.app.query(
      `INSERT INTO public.audit_anchors (anchor_seq, checkpoint_entry_id, created_at, heads_digest, prev_anchor_hash, anchor_hash, algorithm, key_id, signature)
       SELECT * FROM unnest($1::bigint[], $2::uuid[], $3::timestamptz[], $4::bytea[], $5::bytea[], $6::bytea[], $7::text[], $8::text[], $9::bytea[])`,
      [
        records.map((r) => r.anchorSeq.toString()),
        records.map((r) => r.checkpointEntryId),
        records.map((r) => r.createdAt),
        records.map((r) => r.headsDigest),
        records.map((r) => r.prevAnchorHash),
        records.map((r) => r.anchorHash),
        records.map((r) => r.algorithm),
        records.map((r) => r.keyId),
        records.map((r) => r.signature),
      ],
    );
    writeFileSync(w.sinkPath, `${records.map(sinkLine).join('\n')}\n`);

    const t1 = performance.now();
    const anchors = await readAnchors(w.app);
    const t2 = performance.now();
    const failures = [
      ...verifyAnchorLog({
        tableRows: anchors,
        sinkLines: readFileSync(w.sinkPath, 'utf8').split('\n'),
        fromSeq: 1n,
        expectedPrevHash: ZERO32,
        sinkRetryWindowOpen: false,
      }),
      ...verifyAnchorSignatures(anchors, publicKeys),
    ];
    const t3 = performance.now();
    expect(failures).toEqual([]);
    expect(t3 - t1).toBeLessThan(30_000);
    report['measure'] = {
      sign_plus_verify_one_anchor_ms: Number(signVerifyMs.toFixed(3)),
      read_1000_anchors_ms: Math.round(t2 - t1),
      verify_1000_anchors_steps_i_ii_ms: Math.round(t3 - t2),
      node: process.version,
    };

    // regression for the ORDER BY alias trap: the writer must chain anchor 1001 to anchor 1000, not to '999'
    const next = await checkpoint(w);
    expect(next.anchorSeq).toBe(1001n);
    expect(next.prevAnchorHash.equals(must(records.at(-1), 'anchor 1000').anchorHash)).toBe(true);
  }, 180_000);
});
