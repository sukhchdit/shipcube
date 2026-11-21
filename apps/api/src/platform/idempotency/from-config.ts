/**
 * The idempotency store from the validated configuration (ADR-0018 key register row `idempotency-body`; TASK-040):
 * `IDEMPOTENCY_BODY_KEY` (required for the API) and, during a rotation, `IDEMPOTENCY_BODY_KEY_PREVIOUS` (dual read).
 * The composition root calls it once and hands the store to the tx slot (`ExecuteOptions.idempotency`); a malformed
 * key throws here, before anything listens. Nothing derived is ever logged.
 *
 * Key bytes: a deployed key is its decoded material (32 bytes, validated by the config). A `local-only-*` marker
 * (APP_ENV local/test only; the placeholder guard refuses it elsewhere) is derived to 32 bytes the way the audit keys
 * are: SHA-256("platform-idempotency-local-key\0" ‖ key_id ‖ "\0" ‖ marker), deterministic per marker and key id.
 *
 * The scope network key (the HMAC of an anonymous caller's client network, scope.ts) is HKDF-SHA256 of the CURRENT
 * body key with its own info label, so the two uses never share a key (D-TASK040-04). A rotation therefore changes the
 * scope of anonymous keys: a retry spanning the switch executes again, like a key after 24 h.
 */
import { createHash, hkdfSync } from 'node:crypto';

import { type BodyKey, createBodyCipher } from './body-cipher.js';
import { createIdempotencyStore, type IdempotencyLog, type IdempotencyStore } from './store.js';

const NETWORK_KEY_INFO = 'platform-idempotency-scope-network-v1';
const LOCAL_KEY_CONTEXT = 'platform-idempotency-local-key';

/** The structural shape of `@platform/config`'s `KeyVersion` this module needs. */
export interface IdempotencyKeyVersion {
  readonly keyId: string;
  readonly localOnly: boolean;
  readonly material: { reveal(): Uint8Array };
}

export interface IdempotencyKeys {
  /** `IDEMPOTENCY_BODY_KEY`. */
  readonly IDEMPOTENCY_BODY_KEY?: IdempotencyKeyVersion | undefined;
  /** `IDEMPOTENCY_BODY_KEY_PREVIOUS` (rotation only). */
  readonly IDEMPOTENCY_BODY_KEY_PREVIOUS?: IdempotencyKeyVersion | undefined;
}

/** The key bytes of one key version (see the header for `local-only-*` markers). */
export function bodyKeyOf(version: IdempotencyKeyVersion): BodyKey {
  const material = version.material.reveal();
  if (!version.localOnly) return { keyId: version.keyId, key: material };
  const digest = createHash('sha256').update(`${LOCAL_KEY_CONTEXT}\0${version.keyId}\0`, 'utf8').update(material).digest();
  return { keyId: version.keyId, key: new Uint8Array(digest) };
}

/** The store over the configured keys, or `undefined` when the body key is absent (a partial test configuration). */
export function idempotencyStoreFrom(config: IdempotencyKeys, log: IdempotencyLog, now?: () => number): IdempotencyStore | undefined {
  const currentVersion = config.IDEMPOTENCY_BODY_KEY;
  if (currentVersion === undefined) return undefined;
  const current = bodyKeyOf(currentVersion);
  const previous = config.IDEMPOTENCY_BODY_KEY_PREVIOUS === undefined ? undefined : bodyKeyOf(config.IDEMPOTENCY_BODY_KEY_PREVIOUS);
  const networkKey = new Uint8Array(hkdfSync('sha256', current.key, new Uint8Array(0), NETWORK_KEY_INFO, 32));
  return createIdempotencyStore({
    cipher: createBodyCipher(current, previous),
    networkKey,
    log,
    ...(now === undefined ? {} : { now }),
  });
}
