/**
 * Encryption of stored response bodies (SEC-TC-04; ADR-0014 amendment 1; ADR-0018 key register row `idempotency-body`
 * and amendment 1; data-model §3.5 `response_body`, §10.4; TASK-040). Pure: no I/O.
 *
 * `response_body` = AES-256-GCM(IDEMPOTENCY_BODY_KEY, 96-bit random nonce) of the UTF-8 JSON body, stored as
 * `nonce ‖ ciphertext ‖ 128-bit tag`, with `response_body_key_id` beside it and
 * AAD = UTF-8(JCS(["idempotency_keys", "response_body", hex(scope_hash), response_body_key_id])). A body copied to
 * another scope, or relabelled with another key id, fails authentication.
 *
 * Rotation (90 days, dual read 24 h): new bodies are written under the current key; a body is read under the key its
 * row names, the current or the `_PREVIOUS` one. A row lives 24 h, so after the dual-read window no row names the
 * retired key. A body that does not authenticate is never served: {@link IdempotencyReplayError} (a 500, logged by the
 * problem handler with its class only).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { jcs } from '@platform/audit';

/** One version of the body key: its `idempotency-body-v<n>` id and its 32 key bytes. */
export interface BodyKey {
  readonly keyId: string;
  readonly key: Uint8Array;
}

export interface SealedBody {
  readonly ciphertext: Uint8Array<ArrayBuffer>;
  readonly keyId: string;
}

export interface BodyCipher {
  /** The id of the key new bodies are written under. */
  readonly keyId: string;
  seal(scopeHash: Uint8Array<ArrayBuffer>, plaintext: string): SealedBody;
  /** The plaintext of a stored body; throws {@link IdempotencyReplayError} when it cannot be read. */
  open(scopeHash: Uint8Array<ArrayBuffer>, sealed: SealedBody): string;
}

/** A stored response that cannot be replayed (unknown key id, failed authentication, malformed row). */
export class IdempotencyReplayError extends Error {
  /** A fixed phrase of this module (never a value of the row): safe for the operational log. */
  readonly reason: string;

  constructor(reason: string) {
    super(`stored idempotent response cannot be replayed: ${reason}`);
    this.reason = reason;
    this.name = 'IdempotencyReplayError';
  }
}

const KEY_ID = /^idempotency-body-v[1-9][0-9]{0,5}$/;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function checkKey(key: BodyKey, what: string): void {
  if (typeof key.keyId !== 'string' || !KEY_ID.test(key.keyId)) throw new RangeError(`${what} key id must be idempotency-body-v<n>`);
  if (key.key.length !== KEY_BYTES) throw new RangeError(`${what} key must be ${String(KEY_BYTES)} bytes`);
}

const aadOf = (scopeHash: Uint8Array<ArrayBuffer>, keyId: string): Buffer =>
  Buffer.from(jcs(['idempotency_keys', 'response_body', Buffer.from(scopeHash).toString('hex'), keyId]), 'utf8');

/** The cipher over the current key and, during a rotation, the previous one (dual read). */
export function createBodyCipher(current: BodyKey, previous?: BodyKey): BodyCipher {
  checkKey(current, 'IDEMPOTENCY_BODY_KEY');
  if (previous !== undefined) {
    checkKey(previous, 'IDEMPOTENCY_BODY_KEY_PREVIOUS');
    if (previous.keyId === current.keyId) throw new RangeError('IDEMPOTENCY_BODY_KEY_PREVIOUS must have another key id');
  }
  const keys = new Map<string, Uint8Array>([[current.keyId, current.key]]);
  if (previous !== undefined) keys.set(previous.keyId, previous.key);

  return Object.freeze({
    keyId: current.keyId,
    seal(scopeHash: Uint8Array<ArrayBuffer>, plaintext: string): SealedBody {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', current.key, nonce, { authTagLength: TAG_BYTES });
      cipher.setAAD(aadOf(scopeHash, current.keyId));
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return { ciphertext: new Uint8Array(Buffer.concat([nonce, body, cipher.getAuthTag()])), keyId: current.keyId };
    },
    open(scopeHash: Uint8Array<ArrayBuffer>, sealed: SealedBody): string {
      const key = keys.get(sealed.keyId);
      if (key === undefined) throw new IdempotencyReplayError('unknown body key id');
      const data = Buffer.from(sealed.ciphertext);
      if (data.length < NONCE_BYTES + TAG_BYTES) throw new IdempotencyReplayError('ciphertext too short');
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, NONCE_BYTES), { authTagLength: TAG_BYTES });
        decipher.setAAD(aadOf(scopeHash, sealed.keyId));
        decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
        return Buffer.concat([decipher.update(data.subarray(NONCE_BYTES, data.length - TAG_BYTES)), decipher.final()]).toString('utf8');
      } catch {
        throw new IdempotencyReplayError('authentication failed');
      }
    },
  });
}
