/**
 * The idempotency store from the validated configuration (ADR-0018 key register row `idempotency-body` and amendment 9;
 * ADR-0014 amendment 15; TASK-040): `IDEMPOTENCY_BODY_KEY` (required for the API) and, during a rotation,
 * `IDEMPOTENCY_BODY_KEY_PREVIOUS` (dual read). The composition root calls it once and hands the store to the tx slot
 * (`ExecuteOptions.idempotency`); a malformed key throws here, before anything listens. Nothing derived is ever logged.
 *
 * Key separation (PR040-SEC-01, CWE-320; D-ARCH-204): the configured material is never a key itself. It is the input of
 * two HKDF-SHA256 derivations with an empty salt and 32 output bytes, one per use, told apart by their info labels:
 *  - `platform-idempotency-body-v1`: the AES-256-GCM key of the stored responses (body-cipher.ts), for the current key
 *    and, during a rotation, for the `_PREVIOUS` one;
 *  - `platform-idempotency-scope-network-v1`: the HMAC key of an anonymous caller's client network (scope.ts), from the
 *    CURRENT material only. A rotation therefore changes the scope of anonymous keys: a retry spanning the switch
 *    executes again, like a key after 24 h (EC-A47; D-TASK040-04 as amended by D-SECPR040-01).
 *
 * Material: a deployed key is its decoded material, exactly 32 bytes (refused otherwise). A `local-only-*` marker
 * (APP_ENV local/test only; the placeholder guard refuses it elsewhere) becomes 32 bytes the way the audit keys do,
 * SHA-256("platform-idempotency-local-key\0" ‖ key_id ‖ "\0" ‖ marker), deterministic per marker and key id; the two
 * derivations then run over that digest.
 */
import { createHash, hkdfSync } from 'node:crypto';

import { type BodyKey, createBodyCipher } from './body-cipher.js';
import { createIdempotencyStore, type IdempotencyLog, type IdempotencyStore } from './store.js';

/** HKDF info label of the AES-256-GCM body key (ADR-0014 amendment 15). */
export const BODY_KEY_INFO = 'platform-idempotency-body-v1';
/** HKDF info label of the client-network HMAC key of anonymous scopes (ADR-0014 amendment 15). */
export const NETWORK_KEY_INFO = 'platform-idempotency-scope-network-v1';
const LOCAL_KEY_CONTEXT = 'platform-idempotency-local-key';
const MATERIAL_BYTES = 32;
const DERIVED_BYTES = 32;

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

/** HKDF-SHA256(material, empty salt, info, 32 bytes). */
export function deriveIdempotencyKey(material: Uint8Array, info: string): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', material, new Uint8Array(0), info, DERIVED_BYTES));
}

/** The 32 input bytes of the derivations of one key version (see the header for `local-only-*` markers). */
function materialOf(version: IdempotencyKeyVersion, variable: string): Uint8Array {
  const material = version.material.reveal();
  if (version.localOnly) {
    return new Uint8Array(createHash('sha256').update(`${LOCAL_KEY_CONTEXT}\0${version.keyId}\0`, 'utf8').update(material).digest());
  }
  if (material.length !== MATERIAL_BYTES) throw new RangeError(`${variable} key must be ${String(MATERIAL_BYTES)} bytes`);
  return material;
}

/** The AES-256-GCM body key of one key version: derived, never the material itself (PR040-SEC-01). */
export function bodyKeyOf(version: IdempotencyKeyVersion, variable = 'IDEMPOTENCY_BODY_KEY'): BodyKey {
  return { keyId: version.keyId, key: deriveIdempotencyKey(materialOf(version, variable), BODY_KEY_INFO) };
}

/** The HMAC key of the client network of anonymous scopes, from the current key version (PR040-SEC-01). */
export function networkKeyOf(version: IdempotencyKeyVersion): Uint8Array {
  return deriveIdempotencyKey(materialOf(version, 'IDEMPOTENCY_BODY_KEY'), NETWORK_KEY_INFO);
}

/** The store over the configured keys, or `undefined` when the body key is absent (a partial test configuration). */
export function idempotencyStoreFrom(config: IdempotencyKeys, log: IdempotencyLog, now?: () => number): IdempotencyStore | undefined {
  const currentVersion = config.IDEMPOTENCY_BODY_KEY;
  if (currentVersion === undefined) return undefined;
  const previousVersion = config.IDEMPOTENCY_BODY_KEY_PREVIOUS;
  const previous = previousVersion === undefined ? undefined : bodyKeyOf(previousVersion, 'IDEMPOTENCY_BODY_KEY_PREVIOUS');
  return createIdempotencyStore({
    cipher: createBodyCipher(bodyKeyOf(currentVersion), previous),
    networkKey: networkKeyOf(currentVersion),
    log,
    ...(now === undefined ? {} : { now }),
  });
}
