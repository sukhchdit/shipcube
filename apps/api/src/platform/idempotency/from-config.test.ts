// Key separation of the idempotency store (TASK-040 part 040-B; PR040-SEC-01, CWE-320; ADR-0014 amendment 15;
// ADR-0018 amendment 9): the configured IDEMPOTENCY_BODY_KEY material is HKDF-SHA256 input only, never a key itself.
import { createDecipheriv, createHmac } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';
import { jcs } from '@platform/audit';

import type { AppDb } from '../db/index.js';
import type { Principal } from '../routing/define-route.js';
import { ANONYMOUS, readonlySet } from '../routing/route-state.js';
import { IdempotencyReplayError } from './body-cipher.js';
import {
  BODY_KEY_INFO,
  bodyKeyOf,
  deriveIdempotencyKey,
  type IdempotencyKeys,
  idempotencyStoreFrom,
  NETWORK_KEY_INFO,
  networkKeyOf,
} from './from-config.js';
import { scopeOf } from './scope.js';
import type { BeginOutcome, IdempotencyStore } from './store.js';
import { MemoryKeys, memoryRunner, SILENT_IDEMPOTENCY_LOG } from './tests/memory-keys.js';

const version = (keyId: string, bytes: Uint8Array, localOnly = false) => ({ keyId, localOnly, material: { reveal: () => bytes } });
const MATERIAL = new Uint8Array(32).fill(6);
const PREVIOUS_MATERIAL = new Uint8Array(32).fill(5);
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/** RFC 5869 written out with HMAC-SHA256 (an oracle independent of `hkdfSync`): empty salt, one 32-byte block. */
function rfc5869(material: Uint8Array, info: string): string {
  const prk = createHmac('sha256', new Uint8Array(0)).update(material).digest();
  return createHmac('sha256', prk)
    .update(Buffer.concat([Buffer.from(info, 'utf8'), Buffer.from([1])]))
    .digest('hex');
}

/** Known answers over MATERIAL (32 bytes of 0x06), computed once and pinned (ADR-0014 amendment 15 labels). */
const VECTORS: ReadonlyArray<readonly [string, string]> = [
  ['platform-idempotency-body-v1', 'a63b94581ea42312baa4ef1b1207e8a03f03ad20bbf279faad2ed00e4f2005a6'],
  ['platform-idempotency-scope-network-v1', '43dd13fb70e0b338cf954ba3cac7630509da4b57e451e651bf0779202f39a0fa'],
];

describe('[PR040-SEC-01] the configured key only derives (HKDF-SHA256, empty salt, 32 bytes)', () => {
  it('the info labels are the ADR-0014 amendment 15 labels', () => {
    expect([BODY_KEY_INFO, NETWORK_KEY_INFO]).toEqual(VECTORS.map(([label]) => label));
  });

  it.each(VECTORS)('known answer for %s, equal to RFC 5869 written out with HMAC', (label, expected) => {
    expect(hex(deriveIdempotencyKey(MATERIAL, label))).toBe(expected);
    expect(rfc5869(MATERIAL, label)).toBe(expected);
  });

  it('neither derived key equals the material, and the body key and the network key differ', () => {
    const body = bodyKeyOf(version('idempotency-body-v1', MATERIAL));
    const network = networkKeyOf(version('idempotency-body-v1', MATERIAL));
    expect(body).toEqual({ keyId: 'idempotency-body-v1', key: deriveIdempotencyKey(MATERIAL, BODY_KEY_INFO) });
    expect(network).toEqual(deriveIdempotencyKey(MATERIAL, NETWORK_KEY_INFO));
    expect(new Set([hex(MATERIAL), hex(body.key), hex(network)]).size).toBe(3);
  });

  it('a local-only marker is digested first, then derived per label', () => {
    const marker = new TextEncoder().encode('local-only-idempotency');
    const body = bodyKeyOf(version('idempotency-body-v1', marker, true)).key;
    const network = networkKeyOf(version('idempotency-body-v1', marker, true));
    expect(body).toHaveLength(32);
    expect(hex(body)).not.toBe(hex(network));
  });

  it('a deployed key of another length than 32 bytes is refused, naming the variable', () => {
    expect(() => bodyKeyOf(version('idempotency-body-v1', new Uint8Array(31)))).toThrow('IDEMPOTENCY_BODY_KEY key must be 32 bytes');
    expect(() =>
      idempotencyStoreFrom(
        {
          IDEMPOTENCY_BODY_KEY: version('idempotency-body-v2', MATERIAL),
          IDEMPOTENCY_BODY_KEY_PREVIOUS: version('idempotency-body-v1', new Uint8Array(33)),
        },
        SILENT_IDEMPOTENCY_LOG,
      ),
    ).toThrow('IDEMPOTENCY_BODY_KEY_PREVIOUS key must be 32 bytes');
  });

  it('a body sealed by the store opens under the derived body key and never under the configured material', async () => {
    const keys = new MemoryKeys();
    await completeOnce(keys, storeOver({ IDEMPOTENCY_BODY_KEY: version('idempotency-body-v1', MATERIAL) }));
    const row = [...keys.rows.values()][0];
    if (row === undefined || row.responseBody === null) throw new Error('no body');
    const sealed = Buffer.from(row.responseBody);
    const open = (key: Uint8Array): string => {
      const data = sealed;
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12), { authTagLength: 16 });
      decipher.setAAD(
        Buffer.from(jcs(['idempotency_keys', 'response_body', Buffer.from(row.scopeHash).toString('hex'), 'idempotency-body-v1'])),
      );
      decipher.setAuthTag(data.subarray(data.length - 16));
      return Buffer.concat([decipher.update(data.subarray(12, data.length - 16)), decipher.final()]).toString('utf8');
    };
    expect(JSON.parse(open(deriveIdempotencyKey(MATERIAL, BODY_KEY_INFO)))).toMatchObject({ status: 201, body: { id: 'ord_1' } });
    // The P1 probe of the part 040-A security round ("the AES key is the material") now fails.
    expect(() => open(MATERIAL)).toThrow();
  });

  it('the anonymous network scope is keyed by the derived network key, not by the material', () => {
    const request = { key: 'k', method: 'POST' as const, path: '/api/v1/consents', fingerprint: new Uint8Array(32) };
    const derived = scopeOf(ANONYMOUS, '203.0.113.7', request, networkKeyOf(version('idempotency-body-v1', MATERIAL)));
    const raw = scopeOf(ANONYMOUS, '203.0.113.7', request, MATERIAL);
    expect(derived?.ownerKind).toBe('network');
    expect(hex(derived?.scopeHash ?? new Uint8Array())).not.toBe(hex(raw?.scopeHash ?? new Uint8Array()));
  });

  it('the previous key is derived like the current one: a body of v1 replays under v2 + previous v1 (dual read)', async () => {
    const keys = new MemoryKeys();
    await completeOnce(keys, storeOver({ IDEMPOTENCY_BODY_KEY: version('idempotency-body-v1', PREVIOUS_MATERIAL) }));
    const rotated = storeOver({
      IDEMPOTENCY_BODY_KEY: version('idempotency-body-v2', MATERIAL),
      IDEMPOTENCY_BODY_KEY_PREVIOUS: version('idempotency-body-v1', PREVIOUS_MATERIAL),
    });
    expect(await beginOnce(keys, rotated)).toEqual({
      kind: 'replay',
      result: { status: 201, headers: { 'Idempotent-Replayed': 'true' }, body: { id: 'ord_1' } },
    });
    // The same key id over other material does not authenticate: the previous key is derived, not reused as is.
    const wrong = storeOver({
      IDEMPOTENCY_BODY_KEY: version('idempotency-body-v2', MATERIAL),
      IDEMPOTENCY_BODY_KEY_PREVIOUS: version('idempotency-body-v1', MATERIAL),
    });
    await expect(beginOnce(keys, wrong)).rejects.toThrow(IdempotencyReplayError);
  });
});

const PRINCIPAL: Principal = {
  ...ANONYMOUS,
  credential: 'session',
  authenticated: true,
  actorId: '0193a5b2-7c1e-7d4a-9f3b-0000000000a1',
  orgId: '0193a5b2-7c1e-7d4a-9f3b-0000000000a0',
  permissions: readonlySet([]),
};
const CTX = { orgId: PRINCIPAL.orgId, actorId: PRINCIPAL.actorId, actorScope: 'TENANT' as const, guestTokenHash: '', correlationId: 'c' };
const REQUEST = { key: 'k', method: 'POST' as const, path: '/api/v1/orders', fingerprint: new Uint8Array(32).fill(1) };

function storeOver(config: IdempotencyKeys): IdempotencyStore {
  const store = idempotencyStoreFrom(config, SILENT_IDEMPOTENCY_LOG, () => 0);
  if (store === undefined) throw new Error('no store');
  return store;
}

function beginOnce(keys: MemoryKeys, store: IdempotencyStore): Promise<BeginOutcome> {
  return memoryRunner(keys).withTenantTx(CTX, (db) => store.begin(db as AppDb, { request: REQUEST, principal: PRINCIPAL, clientIp: '' }));
}

/** Claims REQUEST and completes it with a 201 `{ id: 'ord_1' }`. */
async function completeOnce(keys: MemoryKeys, store: IdempotencyStore): Promise<void> {
  const begun = await beginOnce(keys, store);
  if (begun.kind !== 'execute') throw new Error(begun.kind);
  await memoryRunner(keys).withTenantTx(CTX, (db) => store.complete(db as AppDb, begun.claim, { status: 201, body: { id: 'ord_1' } }));
}
