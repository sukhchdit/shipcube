// The idempotency key store's state machine (TASK-040; data-model §6.2 protocol; ADR-0014; api/README §5), through
// the real TenantDb guard and systemDelegates port over an in-memory table (tests/memory-keys.ts).
import { describe, expect, it } from '@jest/globals';

import type { AppDb } from '../db/index.js';
import type { Principal, RouteResult } from '../routing/define-route.js';
import { ANONYMOUS, readonlySet } from '../routing/route-state.js';
import { createBodyCipher, IdempotencyReplayError } from './body-cipher.js';
import { bodyKeyOf, idempotencyStoreFrom } from './from-config.js';
import type { IdempotencyRequest } from './request.js';
import {
  type BeginOutcome,
  createIdempotencyStore,
  IDEMPOTENCY_LEASE_MS,
  IDEMPOTENCY_TTL_MS,
  IdempotencyClaimLostError,
  type IdempotencyClaim,
  type IdempotencyStore,
  isStoredStatus,
} from './store.js';
import { AppError } from '@platform/shared';

import { storedProblemOf } from './problem.js';
import { MemoryKeys, memoryRunner, recordingLog, SILENT_IDEMPOTENCY_LOG, TEST_BODY_KEY, TEST_NETWORK_KEY } from './tests/memory-keys.js';

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
const CTX = { orgId: ORG, actorId: USER, actorScope: 'TENANT' as const, guestTokenHash: '', correlationId: 'c' };

const request = (fingerprintByte = 1, key = 'key-1'): IdempotencyRequest => ({
  key,
  method: 'POST',
  path: '/api/v1/orders',
  fingerprint: new Uint8Array(32).fill(fingerprintByte),
});

function setup(start = Date.UTC(2026, 10, 20, 12)) {
  const keys = new MemoryKeys();
  const runner = memoryRunner(keys);
  const clock = { now: start };
  const log = recordingLog();
  const store = createIdempotencyStore({
    cipher: createBodyCipher(TEST_BODY_KEY),
    networkKey: TEST_NETWORK_KEY,
    log,
    now: () => clock.now,
  });
  const inTx = <R>(fn: (db: AppDb) => Promise<R>): Promise<R> => runner.withTenantTx(CTX, (db) => fn(db as AppDb));
  const begin = (req = request(), leaseMs?: number): Promise<BeginOutcome> =>
    inTx((db) => store.begin(db, { request: req, principal, clientIp: '', ...(leaseMs === undefined ? {} : { leaseMs }) }));
  const claimOf = (outcome: BeginOutcome): IdempotencyClaim => {
    if (outcome.kind !== 'execute') throw new Error(`expected execute, got ${outcome.kind}`);
    return outcome.claim;
  };
  return { keys, runner, clock, store, inTx, begin, claimOf, log };
}

const created: RouteResult = {
  status: 201,
  body: { id: 'ord_1', total: '12.50' },
  headers: { Location: '/api/v1/orders/ord_1', etag: '"v1"', 'Cache-Control': 'no-store', 'X-Other': 'x' },
};

describe('idempotency store protocol (data-model §6.2)', () => {
  it('claims a new key IN_PROGRESS with a 30 s lease and a 24 h expiry, and records scope, actor, method and path', async () => {
    const { keys, begin, claimOf, clock } = setup();
    const claim = claimOf(await begin());
    expect(claim.version).toBe(1);
    const row = keys.rows.get(claim.id);
    expect(row).toMatchObject({
      status: 'IN_PROGRESS',
      scopeOrgId: ORG,
      actorId: USER,
      method: 'POST',
      path: '/api/v1/orders',
      idemKey: 'key-1',
      responseStatus: null,
    });
    expect(row?.leaseUntil.getTime()).toBe(clock.now + IDEMPOTENCY_LEASE_MS);
    expect(row?.expiresAt.getTime()).toBe(clock.now + IDEMPOTENCY_TTL_MS);
    expect(row?.scopeHash).toHaveLength(32);
  });

  it('[AT-US-038-01] a completed key replays the stored status, the allow-listed headers and the decrypted body', async () => {
    const { keys, begin, claimOf, inTx, store } = setup();
    const claim = claimOf(await begin());
    await inTx((db) => store.complete(db, claim, created));
    const row = keys.rows.get(claim.id);
    expect(row).toMatchObject({ status: 'COMPLETED', responseStatus: 201, responseBodyKeyId: 'idempotency-body-v1', version: 2 });
    expect(row?.responseHeaders).toEqual({ Location: '/api/v1/orders/ord_1', ETag: '"v1"' });
    // [SEC-TC-04] the stored body is ciphertext.
    expect(
      Buffer.from(row?.responseBody ?? new Uint8Array())
        .toString('latin1')
        .includes('ord_1'),
    ).toBe(false);
    expect(await begin()).toEqual({
      kind: 'replay',
      result: {
        status: 201,
        headers: { Location: '/api/v1/orders/ord_1', ETag: '"v1"', 'Idempotent-Replayed': 'true' },
        body: { id: 'ord_1', total: '12.50' },
      },
    });
  });

  it('a stored response without a body (204) replays without one', async () => {
    const { keys, begin, claimOf, inTx, store } = setup();
    const claim = claimOf(await begin());
    await inTx((db) => store.complete(db, claim, { status: 204 }));
    expect(keys.rows.get(claim.id)).toMatchObject({ responseBody: null, responseBodyKeyId: null, responseHeaders: {} });
    expect(await begin()).toEqual({ kind: 'replay', result: { status: 204, headers: { 'Idempotent-Replayed': 'true' } } });
  });

  it('[AT-US-038-04] the same key with another fingerprint is reused, completed or not', async () => {
    const { begin, claimOf, inTx, store } = setup();
    const claim = claimOf(await begin());
    expect(await begin(request(2))).toEqual({ kind: 'reused' });
    await inTx((db) => store.complete(db, claim, created));
    expect(await begin(request(2))).toEqual({ kind: 'reused' });
  });

  it('[AT-US-038-05] the same key while the first request runs is in-progress', async () => {
    const { begin, claimOf } = setup();
    claimOf(await begin());
    expect(await begin()).toEqual({ kind: 'in-progress' });
  });

  it('an IN_PROGRESS key whose lease expired (a crashed request) is taken over; the old claim can no longer complete', async () => {
    const { keys, begin, claimOf, clock, inTx, store } = setup();
    const first = claimOf(await begin());
    clock.now += IDEMPOTENCY_LEASE_MS + 1;
    const second = claimOf(await begin());
    expect(second).toMatchObject({ id: first.id, version: 2 });
    expect(keys.rows.get(first.id)?.leaseUntil.getTime()).toBe(clock.now + IDEMPOTENCY_LEASE_MS);
    await expect(inTx((db) => store.complete(db, first, created))).rejects.toThrow(IdempotencyClaimLostError);
    await expect(inTx((db) => store.complete(db, second, created))).resolves.toBeUndefined();
  });

  it('[AT-US-038-09] a key stored 24 h and 1 s ago is processed as new (deleted, then claimed again)', async () => {
    const { keys, begin, claimOf, clock, inTx, store } = setup();
    const claim = claimOf(await begin());
    await inTx((db) => store.complete(db, claim, created));
    clock.now += IDEMPOTENCY_TTL_MS + 1_000;
    const again = claimOf(await begin(request(2)));
    expect(again.id).not.toBe(claim.id);
    expect([...keys.rows.values()].map((row) => row.status)).toEqual(['IN_PROGRESS']);
    expect(keys.statements).toEqual(expect.arrayContaining(['deleteMany']));
  });

  it('[AT-US-038-06] a released key is free again: the retry claims it and executes', async () => {
    const { keys, begin, claimOf, inTx, store } = setup();
    const claim = claimOf(await begin());
    await inTx((db) => store.release(db, claim));
    expect(keys.rows.size).toBe(0);
    expect((await begin()).kind).toBe('execute');
  });

  it('a claim rolled back with its transaction leaves no row', async () => {
    const { keys, runner, store } = setup();
    await expect(
      runner.withTenantTx(CTX, async (db) => {
        await store.begin(db as AppDb, { request: request(), principal, clientIp: '' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(keys.rows.size).toBe(0);
  });

  it('refuses to store a status that is never stored, and a replay whose body cannot be read is an error', async () => {
    const { keys, begin, claimOf, inTx, store, log } = setup();
    const claim = claimOf(await begin());
    await expect(inTx((db) => store.complete(db, claim, { status: 500 }))).rejects.toThrow('never stored');
    await inTx((db) => store.complete(db, claim, created));
    const row = keys.rows.get(claim.id);
    if (row !== undefined) row.responseBodyKeyId = 'idempotency-body-v7';
    await expect(begin()).rejects.toThrow(IdempotencyReplayError);
    // n4 / D-PM-081 (b): an ERROR-level operational event, class and fixed reason only (no key, no body, no scope).
    expect(log.lines).toEqual([
      {
        level: 'error',
        event: 'api.idempotency_replay_unreadable',
        fields: { error: 'IdempotencyReplayError', reason: 'unknown body key id' },
      },
    ]);
    expect(JSON.stringify(log.lines)).not.toMatch(/key-1|ord_1|12\.50/u);
    if (row !== undefined) row.responseStatus = null;
    await expect(begin()).rejects.toThrow('stored status missing');
  });

  it('[m5] a row released twice between the insert and the read ends the claim as in-progress after two rounds', async () => {
    const { keys, begin } = setup();
    keys.phantomConflicts = 2;
    expect(await begin()).toEqual({ kind: 'in-progress' });
    expect(keys.statements).toEqual(['createManyAndReturn', 'findUnique', 'createManyAndReturn', 'findUnique']);
    expect(keys.rows.size).toBe(0);
  });

  it('[m4] the claim takes the lease it is given; renew extends it, bumps the version, and fails once the claim is lost', async () => {
    const { keys, begin, claimOf, clock, inTx, store } = setup();
    const claim = claimOf(await begin(request(), 90_000));
    expect(keys.rows.get(claim.id)?.leaseUntil.getTime()).toBe(clock.now + 90_000);
    clock.now += 60_000;
    const renewed = await inTx((db) => store.renew(db, claim, 90_000));
    expect(renewed).toEqual({ ...claim, version: 2 });
    expect(keys.rows.get(claim.id)?.leaseUntil.getTime()).toBe(clock.now + 90_000);
    await expect(inTx((db) => store.renew(db, claim, 90_000))).rejects.toThrow(IdempotencyClaimLostError);
    await inTx((db) => store.complete(db, renewed, created));
    await expect(inTx((db) => store.renew(db, renewed, 90_000))).rejects.toThrow(IdempotencyClaimLostError);
  });

  it('[D-ARCH-195] a stored thrown 4xx replays as its stored document, byte for byte', async () => {
    const { begin, claimOf, inTx, store } = setup();
    const claim = claimOf(await begin());
    const issue = { pointer: '/body/qty', code: 'OUT_OF_RANGE', message: 'Field is out of range.' };
    const stored = storedProblemOf(new AppError('VALIDATION_ERROR', { errors: [issue] }), {
      correlationId: 'first',
      url: '/api/v1/orders',
    });
    if (stored === undefined) throw new Error('not stored');
    await inTx((db) => store.complete(db, claim, stored.result, 'slot-problem'));
    const replay = await begin();
    if (replay.kind !== 'replay-problem') throw new Error(`expected replay-problem, got ${replay.kind}`);
    expect(replay.error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, replayed: true, body: stored.error.body });
  });

  it('[R3-M1] a returned problem+json result replays as returned; only a slot-sealed origin replays as a problem', async () => {
    const { keys, begin, claimOf, inTx, store } = setup();
    const returned = {
      status: 409,
      headers: { 'Content-Type': 'application/problem+json' },
      body: { type: 'about:blank', title: 'Conflict', status: 409, conflicting_id: 'x' },
    };
    const claim = claimOf(await begin());
    await inTx((db) => store.complete(db, claim, returned));
    expect(await begin()).toEqual({
      kind: 'replay',
      result: { ...returned, headers: { 'Content-Type': 'application/problem+json', 'Idempotent-Replayed': 'true' } },
    });
    // The origin is inside the sealed envelope: the ciphertext authenticates it (no column carries it).
    expect(Object.keys(keys.rows.get(claim.id)?.responseHeaders as object)).toEqual(['Content-Type']);
    const second = claimOf(await begin(request(1, 'key-2')));
    await expect(inTx((db) => store.complete(db, second, { status: 409 }, 'slot-problem'))).rejects.toThrow('has a body');
  });

  it('[n6] an anonymous caller without a client network is unscoped: nothing is claimed', async () => {
    const { keys, inTx, store } = setup();
    expect(await inTx((db) => store.begin(db, { request: request(), principal: ANONYMOUS, clientIp: '' }))).toEqual({ kind: 'unscoped' });
    expect(keys.statements).toEqual([]);
  });

  it('isStoredStatus: 2xx and 4xx except 429', () => {
    expect([200, 201, 204, 400, 404, 409, 422].every(isStoredStatus)).toBe(true);
    expect([100, 302, 304, 429, 500, 503].some(isStoredStatus)).toBe(false);
  });
});

describe('idempotencyStoreFrom (ADR-0018 key register row idempotency-body)', () => {
  const version = (keyId: string, bytes: Uint8Array, localOnly = false) => ({ keyId, localOnly, material: { reveal: () => bytes } });
  const log = SILENT_IDEMPOTENCY_LOG;

  it('is undefined without IDEMPOTENCY_BODY_KEY, and a store over the key (and its previous twin) otherwise', () => {
    expect(idempotencyStoreFrom({}, log)).toBeUndefined();
    const store: IdempotencyStore | undefined = idempotencyStoreFrom(
      {
        IDEMPOTENCY_BODY_KEY: version('idempotency-body-v2', new Uint8Array(32).fill(4)),
        IDEMPOTENCY_BODY_KEY_PREVIOUS: version('idempotency-body-v1', new Uint8Array(32).fill(5)),
      },
      log,
      () => 0,
    );
    expect(store?.log).toBe(log);
  });

  it('derives 32 key bytes from a local-only marker, per key id; a deployed key is its material', () => {
    const marker = new TextEncoder().encode('local-only-idempotency');
    const derived = bodyKeyOf(version('idempotency-body-v1', marker, true));
    expect(derived.key).toHaveLength(32);
    expect(Buffer.from(bodyKeyOf(version('idempotency-body-v2', marker, true)).key).equals(Buffer.from(derived.key))).toBe(false);
    const material = new Uint8Array(32).fill(6);
    expect(bodyKeyOf(version('idempotency-body-v1', material)).key).toBe(material);
  });

  it('a malformed key throws at composition (fail fast before listening)', () => {
    expect(() => idempotencyStoreFrom({ IDEMPOTENCY_BODY_KEY: version('idempotency-body-v1', new Uint8Array(8)) }, log)).toThrow(
      'must be 32 bytes',
    );
  });
});
