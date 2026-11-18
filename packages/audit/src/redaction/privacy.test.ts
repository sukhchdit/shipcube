/**
 * The audit privacy composition from configuration key versions (D-SEC-PR56-01 condition 1, D-ARCH-141; TASK-028).
 */
import { createHash, randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { auditKeyOf, type AuditKeyVersion, createAuditPrivacy } from './privacy.js';
import { parseUserAgent } from './user-agent.js';

const version = (keyId: string, material: Uint8Array, localOnly = false): AuditKeyVersion => ({
  keyId,
  localOnly,
  material: { reveal: () => material.slice() },
});

describe('[ADR-0018] auditKeyOf', () => {
  it('a deployed key is its material', () => {
    const material = new Uint8Array(randomBytes(32));
    const key = auditKeyOf(version('vault-v1', material));
    expect(key.keyId).toBe('vault-v1');
    expect(Buffer.from(key.key).equals(Buffer.from(material))).toBe(true);
  });

  it('a local-only marker derives 32 bytes, deterministic per marker and key id, never the marker itself', () => {
    const marker = new Uint8Array(Buffer.from('local-only-audit-vault-key', 'utf8'));
    const key = auditKeyOf(version('vault-v1', marker, true));
    expect(key.key).toHaveLength(32);
    expect(Buffer.from(key.key).equals(Buffer.from(auditKeyOf(version('vault-v1', marker, true)).key))).toBe(true);
    expect(Buffer.from(key.key).equals(Buffer.from(auditKeyOf(version('vault-v2', marker, true)).key))).toBe(false);
    const expected = createHash('sha256').update('platform-audit-local-key\0vault-v1\0', 'utf8').update(marker).digest();
    expect(Buffer.from(key.key).equals(expected)).toBe(true);
  });
});

describe('[D-SEC-PR56-01] createAuditPrivacy', () => {
  it('builds the tokeniser, the IP index under the index key id and the in-house parser', () => {
    const privacy = createAuditPrivacy({
      vaultKey: version('vault-v1', new Uint8Array(randomBytes(32))),
      vaultHmacKey: version('vault-hmac-v1', new Uint8Array(randomBytes(32))),
      indexKey: version('audit-index-v1', new Uint8Array(Buffer.from('local-only-audit-index-key')), true),
    });
    expect(typeof privacy.tokeniser.tokenise).toBe('function');
    expect(privacy.ipIndex.keyId).toBe('audit-index-v1');
    expect(privacy.ipIndex.hash('203.0.113.7')).toHaveLength(32);
    expect(privacy.parseUserAgent).toBe(parseUserAgent);
    expect(Object.isFrozen(privacy)).toBe(true);
  });

  it('fails fast at boot for a malformed key', () => {
    expect(() =>
      createAuditPrivacy({
        vaultKey: version('vault-v1', new Uint8Array(16)),
        vaultHmacKey: version('vault-hmac-v1', new Uint8Array(randomBytes(32))),
        indexKey: version('audit-index-v1', new Uint8Array(randomBytes(32))),
      }),
    ).toThrow('AUDIT vault key must be 32 bytes');
  });
});
