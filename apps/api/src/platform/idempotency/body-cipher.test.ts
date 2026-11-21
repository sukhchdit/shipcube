// Stored response bodies are ciphertext (TASK-040; SEC-TC-04; data-model §3.5 `response_body`, §10.4; ADR-0018).
import { createDecipheriv } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';
import { jcs } from '@platform/audit';

import { createBodyCipher, IdempotencyReplayError } from './body-cipher.js';
import { TEST_BODY_KEY, TEST_NEXT_BODY_KEY } from './tests/memory-keys.js';

const SCOPE = new Uint8Array(32).fill(1);
const OTHER_SCOPE = new Uint8Array(32).fill(2);
const BODY = JSON.stringify({ id: 'ord_1', recipient: { name: 'Asha Rao', email: 'asha@example.test' } });

describe('[SEC-TC-04] response body encryption', () => {
  it('[SEC-TC-04] seals as nonce ‖ AES-256-GCM ciphertext ‖ tag under the current key id; no plaintext byte survives', () => {
    const cipher = createBodyCipher(TEST_BODY_KEY);
    const sealed = cipher.seal(SCOPE, BODY);
    expect(sealed.keyId).toBe('idempotency-body-v1');
    expect(sealed.ciphertext.length).toBe(12 + Buffer.byteLength(BODY) + 16);
    const text = Buffer.from(sealed.ciphertext).toString('latin1');
    for (const fragment of ['Asha', 'asha@example.test', 'ord_1', 'recipient']) expect(text.includes(fragment)).toBe(false);
    expect(cipher.open(SCOPE, sealed)).toBe(BODY);
    // Two seals of one body differ (random nonce).
    expect(Buffer.from(cipher.seal(SCOPE, BODY).ciphertext).equals(Buffer.from(sealed.ciphertext))).toBe(false);
  });

  it('[SEC-TC-04] the AAD is JCS(["idempotency_keys", "response_body", hex(scope_hash), key id])', () => {
    const sealed = createBodyCipher(TEST_BODY_KEY).seal(SCOPE, BODY);
    const data = Buffer.from(sealed.ciphertext);
    const decipher = createDecipheriv('aes-256-gcm', TEST_BODY_KEY.key, data.subarray(0, 12), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(jcs(['idempotency_keys', 'response_body', Buffer.from(SCOPE).toString('hex'), 'idempotency-body-v1'])));
    decipher.setAuthTag(data.subarray(data.length - 16));
    expect(Buffer.concat([decipher.update(data.subarray(12, data.length - 16)), decipher.final()]).toString('utf8')).toBe(BODY);
  });

  it('a body copied to another scope, relabelled with another key id or tampered with is never served', () => {
    const cipher = createBodyCipher(TEST_NEXT_BODY_KEY, TEST_BODY_KEY);
    const sealed = cipher.seal(SCOPE, BODY);
    expect(() => cipher.open(OTHER_SCOPE, sealed)).toThrow(IdempotencyReplayError);
    expect(() => cipher.open(SCOPE, { ...sealed, keyId: 'idempotency-body-v1' })).toThrow('authentication failed');
    const tampered = new Uint8Array(sealed.ciphertext);
    tampered[20] = (tampered[20] ?? 0) ^ 1;
    expect(() => cipher.open(SCOPE, { ...sealed, ciphertext: tampered })).toThrow(IdempotencyReplayError);
    expect(() => cipher.open(SCOPE, { ...sealed, keyId: 'idempotency-body-v9' })).toThrow('unknown body key id');
    expect(() => cipher.open(SCOPE, { keyId: sealed.keyId, ciphertext: new Uint8Array(10) })).toThrow('ciphertext too short');
  });

  it('rotation: a body written under the previous key is read during the dual-read window; new bodies use the current key', () => {
    const old = createBodyCipher(TEST_BODY_KEY).seal(SCOPE, BODY);
    const rotated = createBodyCipher(TEST_NEXT_BODY_KEY, TEST_BODY_KEY);
    expect(rotated.open(SCOPE, old)).toBe(BODY);
    expect(rotated.seal(SCOPE, BODY).keyId).toBe('idempotency-body-v2');
    expect(() => createBodyCipher(TEST_NEXT_BODY_KEY).open(SCOPE, old)).toThrow('unknown body key id');
  });

  it('refuses a malformed key at construction (fail fast at boot)', () => {
    expect(() => createBodyCipher({ keyId: 'idempotency-body-v1', key: new Uint8Array(16) })).toThrow('must be 32 bytes');
    expect(() => createBodyCipher({ keyId: 'vault-v1', key: new Uint8Array(32) })).toThrow('idempotency-body-v<n>');
    expect(() => createBodyCipher(TEST_BODY_KEY, { keyId: 'nope', key: new Uint8Array(32) })).toThrow('PREVIOUS key id');
    expect(() => createBodyCipher(TEST_BODY_KEY, TEST_BODY_KEY)).toThrow('another key id');
  });
});
