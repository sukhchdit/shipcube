import { createHash } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { type AuditEntry, canonicalObject, entryHash, formatMicros, nextOccurredAt, uuidv7, ZERO_HASH_HEX } from './chain.js';

const ENTRY: AuditEntry = {
  id: '019a7c3e-0000-7000-8000-000000000001',
  occurredAtMicros: 1_763_000_000_123_456n,
  streamId: '019a7c3e-0000-7000-8000-0000000000aa',
  streamSeq: 1,
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

/** The canonical text written out by hand (keys in code-unit order), independent of canonicalObject. */
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

describe('SPK-04 chain', () => {
  it('formats microsecond timestamps as YYYY-MM-DDTHH:MM:SS.ffffffZ', () => {
    expect(formatMicros(1_763_000_000_123_456n)).toBe('2025-11-13T02:13:20.123456Z');
    expect(formatMicros(0n)).toBe('1970-01-01T00:00:00.000000Z');
    expect(formatMicros(1_000_001n)).toBe('1970-01-01T00:00:01.000001Z');
  });

  it('occurred_at is monotonic per stream', () => {
    expect(nextOccurredAt(10n, null)).toBe(10n);
    expect(nextOccurredAt(10n, 3n)).toBe(10n);
    expect(nextOccurredAt(10n, 10n)).toBe(11n);
    expect(nextOccurredAt(5n, 10n)).toBe(11n);
  });

  it('the canonical object covers every column except prev_hash, entry_hash and scope_org_id (35 keys)', () => {
    const keys = Object.keys(canonicalObject(ENTRY));
    expect(keys).toHaveLength(35);
    expect(keys).not.toEqual(expect.arrayContaining(['prev_hash']));
    expect(keys).not.toContain('entry_hash');
    expect(keys).not.toContain('scope_org_id');
  });

  it('entry_hash = SHA-256(UTF-8(JCS(canonical)) || prev_hash): pinned vector', () => {
    const independent = createHash('sha256').update(Buffer.from(EXPECTED_CANONICAL, 'utf8')).update(Buffer.alloc(32)).digest('hex');
    const first = entryHash(ENTRY, ZERO_HASH_HEX);
    expect(first).toBe(independent);
    expect(first).toBe(PINNED_FIRST);
    // chaining: the second entry hashes over the first entry's hash
    expect(entryHash({ ...ENTRY, streamSeq: 2 }, first)).not.toBe(entryHash({ ...ENTRY, streamSeq: 2 }, ZERO_HASH_HEX));
    expect(() => entryHash(ENTRY, 'AB'.repeat(32))).toThrow(RangeError);
  });

  it('uuidv7 sets the version and variant and the millisecond prefix', () => {
    const id = uuidv7(0x0190_0000_0001, Buffer.alloc(16, 0xff));
    expect(id).toBe('01900000-0001-7fff-bfff-ffffffffffff');
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

const PINNED_FIRST = 'efa5f37c0588d1af5e9fcd48e9376218b74cad32ce7559416f032fda91df898f';
