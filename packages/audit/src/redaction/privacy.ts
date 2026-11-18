/**
 * The audit privacy composition (D-SEC-PR56-01 condition 1, PR56-SEC-08, D-ARCH-141; TASK-028): from the three key
 * versions of the validated configuration (`AUDIT_VAULT_KEY`, `AUDIT_VAULT_HMAC_KEY`, `AUDIT_INDEX_KEY`; ADR-0018
 * register) it builds what the capture needs to write entries with personal values: the vault tokeniser, the `ip_hash`
 * index and the user-agent parser. The API composition root (start-api.ts) calls it and hands the result to
 * `createApp` (AppDependencies.auditPrivacy -> defaultPipelineSlots -> createAuditCapture); the worker's job wrapper
 * (TASK-047) takes the same.
 *
 * Key bytes: a deployed key is its decoded material (validated by the config: AES exactly 32 bytes, HMAC ≥ 32). In
 * `APP_ENV ∈ {local, test}` the material may be a visible `local-only-*` marker (compose.env, ADR-0018 am. item 1;
 * refused in staging and production by the placeholder guard); its key bytes are derived here as
 * SHA-256("platform-audit-local-key\0" ‖ key_id ‖ "\0" ‖ marker), 32 bytes, deterministic per marker and key id, so a
 * local stack keeps reading its own vault across restarts. Nothing derived is ever logged.
 */
import { createHash } from 'node:crypto';

import type { IpIndex } from '../entry.js';
import type { PiiTokeniser } from '../writer.js';
import { parseUserAgent } from './user-agent.js';
import { type AuditKey, createIpIndex, createVaultTokeniser } from './vault.js';

/** The structural shape of `@platform/config`'s `KeyVersion` this package needs (no dependency on the config). */
export interface AuditKeyVersion {
  readonly keyId: string;
  readonly localOnly: boolean;
  readonly material: { reveal(): Uint8Array };
}

const LOCAL_KEY_CONTEXT = 'platform-audit-local-key';

/** The key bytes of one key version (see the header for `local-only-*` markers). */
export function auditKeyOf(version: AuditKeyVersion): AuditKey {
  const material = version.material.reveal();
  if (!version.localOnly) return { keyId: version.keyId, key: material };
  const digest = createHash('sha256').update(`${LOCAL_KEY_CONTEXT}\0${version.keyId}\0`, 'utf8').update(material).digest();
  return { keyId: version.keyId, key: new Uint8Array(digest) };
}

/** What the audit capture needs to write personal values (createAuditCapture `writer` + `parseUserAgent`). */
export interface AuditPrivacy {
  readonly tokeniser: PiiTokeniser;
  readonly ipIndex: IpIndex;
  readonly parseUserAgent: (userAgent: string) => string | null;
}

export interface AuditPrivacyKeys {
  /** `AUDIT_VAULT_KEY`. */
  readonly vaultKey: AuditKeyVersion;
  /** `AUDIT_VAULT_HMAC_KEY`. */
  readonly vaultHmacKey: AuditKeyVersion;
  /** `AUDIT_INDEX_KEY`. */
  readonly indexKey: AuditKeyVersion;
}

/** Builds the tokeniser, the IP index and the parser; throws (fail fast at boot) for a malformed key. */
export function createAuditPrivacy(keys: AuditPrivacyKeys): AuditPrivacy {
  return Object.freeze({
    tokeniser: createVaultTokeniser({ vaultKey: auditKeyOf(keys.vaultKey), hmacKey: auditKeyOf(keys.vaultHmacKey) }),
    ipIndex: createIpIndex(auditKeyOf(keys.indexKey)),
    parseUserAgent,
  });
}
