/**
 * The idempotency store against PostgreSQL 18 (TASK-040 fix cycle 1, code review m6; REQ-API-009..011, DR-A20;
 * data-model §6.2): `store.ts` itself, not a copy of its statements, over the production database runtime
 * (`databaseRuntimeFromConfig`: the generated client, the standard-columns scoping, the guarded TenantDb and the
 * `systemDelegates` port) as `platform_app`, on a database migrated as the Compose migrate job migrates it
 * (tests/migrated-postgres.ts). Lane B only.
 * - begin -> complete -> replay: the stored body is ciphertext under its key id and decrypts for the same scope;
 * - two concurrent `begin` calls on one scope: exactly one claims, the other answers in-progress (AT-US-038-05);
 * - lease renewal, takeover after the lease (the old claim can no longer complete), release, expiry;
 * - a stored thrown 4xx replays as the problem to rethrow (code review M2).
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { Config } from '@platform/config';
import { AppError } from '@platform/shared';

import type { AppDb, AppTransactionClient, TenantContext } from '../db/index.js';
import { type ActiveDatabaseRuntime, databaseRuntimeFromConfig } from '../db/runtime.js';
import type { Principal } from '../routing/define-route.js';
import { ANONYMOUS, readonlySet } from '../routing/route-state.js';
import { createRuntimeLog } from '../runtime/log.js';
import { TEST_LANE_TX_IDLE_TIMEOUT_MS } from '../tx/tests/runtime-twin.js';
import { createBodyCipher } from './body-cipher.js';
import { storedProblemOf } from './problem.js';
import type { IdempotencyRequest } from './request.js';
import {
  type BeginOutcome,
  createIdempotencyStore,
  IDEMPOTENCY_LEASE_MS,
  IDEMPOTENCY_TTL_MS,
  type IdempotencyClaim,
  IdempotencyClaimLostError,
} from './store.js';
import { type MigratedPostgres, startMigratedPostgres } from './tests/migrated-postgres.js';
import { recordingLog, TEST_BODY_KEY, TEST_NETWORK_KEY } from './tests/memory-keys.js';

const ORG = '0193a5b2-7c1e-7d4a-9f3b-0000000000a0';
const USER = '0193a5b2-7c1e-7d4a-9f3b-0000000000a1';
const principal: Principal = {
  ...ANONYMOUS,
  credential: 'session',
  authenticated: true,
  actorId: USER,
  orgId: ORG,
  permissions: readonlySet([]),
};
const CTX: TenantContext = { orgId: ORG, actorId: USER, actorScope: 'TENANT', guestTokenHash: '', correlationId: 'store-it' };

const configFor = (url: string): Config =>
  ({
    DATABASE_URL: { reveal: () => url },
    DB_POOL_MAX: 4,
    DB_IDLE_TIMEOUT_MS: 10_000,
    DB_CONNECTION_TIMEOUT_MS: 5_000,
    DB_STATEMENT_TIMEOUT_MS: 25_000,
    DB_TX_STATEMENT_TIMEOUT_MS: 5_000,
    DB_TX_LOCK_TIMEOUT_MS: 4_000,
    DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: TEST_LANE_TX_IDLE_TIMEOUT_MS,
  }) as unknown as Config;

let postgres: MigratedPostgres;
let runtime: ActiveDatabaseRuntime<AppTransactionClient>;
/** Added to the real clock (lease and expiry tests move the store's application clock forward). */
let offsetMs = 0;
const log = recordingLog();
const store = createIdempotencyStore({
  cipher: createBodyCipher(TEST_BODY_KEY),
  networkKey: TEST_NETWORK_KEY,
  log,
  now: () => Date.now() + offsetMs,
});

const inTx = <R>(fn: (db: AppDb) => Promise<R>): Promise<R> => runtime.tenantTx.withTenantTx(CTX, (db) => fn(db));
let counter = 0;
const request = (fingerprintByte = 1, key = `store-it-${String((counter += 1))}`): IdempotencyRequest => ({
  key,
  method: 'POST',
  path: '/api/v1/orders',
  fingerprint: new Uint8Array(32).fill(fingerprintByte),
});
const begin = (req: IdempotencyRequest): Promise<BeginOutcome> => inTx((db) => store.begin(db, { request: req, principal, clientIp: '' }));
const claimOf = (outcome: BeginOutcome): IdempotencyClaim => {
  if (outcome.kind !== 'execute') throw new Error(`expected execute, got ${outcome.kind}`);
  return outcome.claim;
};

async function stored(id: string): Promise<Record<string, unknown> | undefined> {
  const admin = await postgres.superuser();
  try {
    const result = await admin.query(
      'SELECT status, version, created_by::text, response_status, response_body, response_body_key_id FROM public.idempotency_keys WHERE id = $1',
      [id],
    );
    return result.rows[0] as Record<string, unknown> | undefined;
  } finally {
    await admin.end();
  }
}

beforeAll(async () => {
  postgres = await startMigratedPostgres();
  runtime = databaseRuntimeFromConfig(configFor(postgres.appUrl), 'api', createRuntimeLog('api', { write: () => true }));
  await runtime.startup();
}, 400_000);

afterAll(async () => {
  for (const resource of (runtime as ActiveDatabaseRuntime<AppTransactionClient> | undefined)?.resources ?? []) await resource.close();
  await (postgres as MigratedPostgres | undefined)?.stop();
}, 60_000);

describe('[REQ-API-011] the idempotency store on PostgreSQL 18 (store.ts over the production runtime)', () => {
  it('[AT-US-038-01] [SEC-TC-04] begin, complete and replay; the stored body is ciphertext under its key id', async () => {
    const req = request();
    const claim = claimOf(await begin(req));
    await inTx((db) => store.complete(db, claim, { status: 201, body: { id: 'ord_store_it' }, headers: { Location: '/api/v1/orders/1' } }));
    const row = await stored(claim.id);
    expect(row).toMatchObject({
      status: 'COMPLETED',
      version: 2,
      created_by: USER,
      response_status: 201,
      response_body_key_id: 'idempotency-body-v1',
    });
    expect(Buffer.from(row?.['response_body'] as Buffer).toString('latin1')).not.toContain('ord_store_it');
    expect(await begin(req)).toEqual({
      kind: 'replay',
      result: { status: 201, headers: { Location: '/api/v1/orders/1', 'Idempotent-Replayed': 'true' }, body: { id: 'ord_store_it' } },
    });
    expect(await begin({ ...req, fingerprint: new Uint8Array(32).fill(2) })).toEqual({ kind: 'reused' });
  });

  it('[AT-US-038-05] two concurrent begin calls on one scope: exactly one claims, the other is in-progress', async () => {
    const req = request();
    const outcomes = await Promise.all([begin(req), begin(req)]);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(['execute', 'in-progress']);
  });

  it('[m4] renew extends the lease; after the lease a takeover claims the key and the old claim can neither renew nor complete', async () => {
    const req = request();
    const first = claimOf(await begin(req));
    const renewed = await inTx((db) => store.renew(db, first, IDEMPOTENCY_LEASE_MS));
    expect(renewed.version).toBe(2);
    expect(await begin(req)).toEqual({ kind: 'in-progress' });
    offsetMs = IDEMPOTENCY_LEASE_MS + 5_000;
    try {
      const second = claimOf(await begin(req));
      expect(second).toMatchObject({ id: first.id, version: 3 });
      await expect(inTx((db) => store.renew(db, renewed, IDEMPOTENCY_LEASE_MS))).rejects.toThrow(IdempotencyClaimLostError);
      await expect(inTx((db) => store.complete(db, renewed, { status: 201 }))).rejects.toThrow(IdempotencyClaimLostError);
      await inTx((db) => store.complete(db, second, { status: 204 }));
    } finally {
      offsetMs = 0;
    }
  });

  it('[AT-US-038-06] release deletes the claim, so the retry claims again', async () => {
    const req = request();
    const claim = claimOf(await begin(req));
    await inTx((db) => store.release(db, claim));
    expect(await stored(claim.id)).toBeUndefined();
    expect((await begin(req)).kind).toBe('execute');
  });

  it('[AT-US-038-09] a key older than 24 h is deleted and claimed as new', async () => {
    const req = request();
    const claim = claimOf(await begin(req));
    await inTx((db) => store.complete(db, claim, { status: 201, body: { old: true } }));
    offsetMs = IDEMPOTENCY_TTL_MS + 1_000;
    try {
      const again = claimOf(await begin({ ...req, fingerprint: new Uint8Array(32).fill(9) }));
      expect(again.id).not.toBe(claim.id);
      expect(await stored(claim.id)).toBeUndefined();
    } finally {
      offsetMs = 0;
    }
  });

  it('[D-ARCH-195] a stored thrown 4xx replays as its stored document', async () => {
    const req = request();
    const claim = claimOf(await begin(req));
    const problem = storedProblemOf(new AppError('ORG_TYPE_NOT_ALLOWED', { detail: 'Not for this organisation type.' }), {
      correlationId: 'store-it-first',
      url: '/api/v1/orders',
    });
    if (problem === undefined) throw new Error('not stored');
    await inTx((db) => store.complete(db, claim, problem.result, 'slot-problem'));
    const replay = await begin(req);
    if (replay.kind !== 'replay-problem') throw new Error(`expected replay-problem, got ${replay.kind}`);
    expect(replay.error).toMatchObject({ code: 'ORG_TYPE_NOT_ALLOWED', status: 422, replayed: true, body: problem.error.body });
    expect(log.lines).toEqual([]);
  });
});
