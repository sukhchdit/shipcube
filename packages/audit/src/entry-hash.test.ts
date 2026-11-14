import { createHash } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import {
  type AuditRowDraft,
  canonicalEntry,
  type ChainPosition,
  computeEntryHash,
  formatMicros,
  jcs,
  type JsonValue,
  nextOccurredAt,
  ZERO_HASH_HEX,
} from './entry-hash.js';

/** The SPK-04 pinned vector (the harness chain test, SPK-04 §8 table), restated in this package's row shape. */
const ROW: AuditRowDraft = {
  id: '019a7c3e-0000-7000-8000-000000000001',
  streamId: '019a7c3e-0000-7000-8000-0000000000aa',
  orgId: '019a7c3e-0000-7000-8000-0000000000aa',
  targetOrgId: null,
  onBehalfOfOrgId: null,
  actorType: 'USER',
  userId: '019a7c3e-0000-7000-8000-0000000000bb',
  apiKeyId: null,
  jobName: null,
  actorRoles: ['Shipper'],
  sessionId: null,
  ipToken: null,
  ipHash: 'ab'.repeat(32),
  ipHashKeyId: 'k1',
  ipCoarse: '203.0.113.0/24',
  userAgentToken: null,
  uaParsed: null,
  sourceApp: 'api',
  correlationId: 'spk04-test-0001',
  action: 'CREATE',
  entityName: 'spk04_orders',
  entityId: 'o-1',
  outcome: 'SUCCESS',
  reasonToken: null,
  reauthProofId: null,
  signatureMeaning: null,
  httpMethod: 'POST',
  route: '/orders',
  oldValue: null,
  newValue: { status: 'DRAFT', sender_name: { $pii: '019a7c3e-0000-7000-8000-0000000000cc' } },
  details: null,
  piiTokenCount: 1,
  hashVersion: 1,
};
const POSITION: ChainPosition = { streamSeq: 1, occurredAtMicros: 1_763_000_000_123_456n };

/** The canonical text written out by hand (keys in code-unit order), independent of canonicalEntry. */
const EXPECTED_CANONICAL =
  '{"action":"CREATE","actor_roles":["Shipper"],"actor_type":"USER","api_key_id":null,"correlation_id":"spk04-test-0001",' +
  '"details":null,"entity_id":"o-1","entity_name":"spk04_orders","hash_version":1,"http_method":"POST",' +
  '"id":"019a7c3e-0000-7000-8000-000000000001","ip_coarse":"203.0.113.0/24",' +
  `"ip_hash":"${'ab'.repeat(32)}","ip_hash_key_id":"k1","ip_token":null,"job_name":null,` +
  '"new_value":{"sender_name":{"$pii":"019a7c3e-0000-7000-8000-0000000000cc"},"status":"DRAFT"},' +
  '"occurred_at":"2025-11-13T02:13:20.123456Z","old_value":null,"on_behalf_of_org_id":null,' +
  '"org_id":"019a7c3e-0000-7000-8000-0000000000aa","outcome":"SUCCESS","pii_token_count":1,"reason_token":null,' +
  '"reauth_proof_id":null,"route":"/orders","session_id":null,"signature_meaning":null,"source_app":"api",' +
  '"stream_id":"019a7c3e-0000-7000-8000-0000000000aa","stream_seq":1,"target_org_id":null,"ua_parsed":null,' +
  '"user_agent_token":null,"user_id":"019a7c3e-0000-7000-8000-0000000000bb"}';
/** SPK-04's PINNED_FIRST: the same definition gives the same hash. */
const PINNED_FIRST = 'efa5f37c0588d1af5e9fcd48e9376218b74cad32ce7559416f032fda91df898f';

describe('[US-087] entry hash (data-model §5.4 step 3, DR-A09)', () => {
  it('formats microsecond timestamps as YYYY-MM-DDTHH:MM:SS.ffffffZ and refuses pre-1970', () => {
    expect(formatMicros(1_763_000_000_123_456n)).toBe('2025-11-13T02:13:20.123456Z');
    expect(formatMicros(0n)).toBe('1970-01-01T00:00:00.000000Z');
    expect(formatMicros(1_000_001n)).toBe('1970-01-01T00:00:01.000001Z');
    expect(() => formatMicros(-1n)).toThrow(RangeError);
  });

  it('occurred_at is monotonic per stream (max of the database clock and head + 1 µs)', () => {
    expect(nextOccurredAt(10n, null)).toBe(10n);
    expect(nextOccurredAt(10n, 3n)).toBe(10n);
    expect(nextOccurredAt(10n, 10n)).toBe(11n);
    expect(nextOccurredAt(5n, 10n)).toBe(11n);
  });

  it('property: nextOccurredAt is strictly after the head and never before the clock', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 2n ** 60n }), fc.option(fc.bigInt({ min: 0n, max: 2n ** 60n })), (now, head) => {
        const next = nextOccurredAt(now, head);
        expect(next >= now).toBe(true);
        if (head !== null) expect(next > head).toBe(true);
      }),
      { seed: 25, numRuns: 200 },
    );
  });

  it('the canonical object covers every column except prev_hash, entry_hash and scope_org_id (35 keys)', () => {
    const keys = Object.keys(canonicalEntry(ROW, POSITION));
    expect(keys).toHaveLength(35);
    for (const absent of ['prev_hash', 'entry_hash', 'scope_org_id']) expect(keys).not.toContain(absent);
    expect(jcs(canonicalEntry(ROW, POSITION))).toBe(EXPECTED_CANONICAL);
  });

  it('entry_hash = SHA-256(UTF-8(JCS(canonical)) || prev_hash): reproduces the SPK-04 pinned vector', () => {
    const independent = createHash('sha256').update(Buffer.from(EXPECTED_CANONICAL, 'utf8')).update(Buffer.alloc(32)).digest('hex');
    const first = computeEntryHash(ROW, POSITION, ZERO_HASH_HEX);
    expect(first).toBe(independent);
    expect(first).toBe(PINNED_FIRST);
    const second = { streamSeq: 2, occurredAtMicros: POSITION.occurredAtMicros + 1n };
    expect(computeEntryHash(ROW, second, first)).not.toBe(computeEntryHash(ROW, second, ZERO_HASH_HEX));
  });

  it('refuses a malformed predecessor hash and values JCS cannot represent', () => {
    expect(() => computeEntryHash(ROW, POSITION, 'AB'.repeat(32))).toThrow(RangeError);
    expect(() => computeEntryHash(ROW, POSITION, '00')).toThrow(RangeError);
    expect(() => jcs(undefined as unknown as JsonValue)).toThrow(TypeError);
    expect(() => jcs({ n: Number.NaN })).toThrow();
  });

  it('property: any change of a hashed column changes the hash', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }), (entityId) => {
        fc.pre(entityId !== ROW.entityId);
        expect(computeEntryHash({ ...ROW, entityId }, POSITION, ZERO_HASH_HEX)).not.toBe(PINNED_FIRST);
      }),
      { seed: 87, numRuns: 100 },
    );
  });
});
