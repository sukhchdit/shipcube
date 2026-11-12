/**
 * Key and secret register (ADR-0018 amendment item 1, SEC-P3-08; platform.md §9.3) and the parser for key
 * variables.
 *
 * Every application key variable holds `<key_id>:<base64>` with `key_id = <purpose>-v<n>`; an optional
 * `<NAME>_PREVIOUS` holds the retired key for dual reads during rotation. Key sets (`JWT_SIGNING_KEYS`,
 * `AUDIT_ANCHOR_PUBLIC_KEYS`) are comma-separated lists of such entries. In `APP_ENV ∈ {local, test}` the
 * material may be a visible `local-only-*` marker (compose.env); the placeholder guard refuses markers in staging
 * and production, and the key provider adapter of the consuming task derives local key bytes from the marker.
 *
 * Credential rows (database, Valkey, Stripe, carriers, storage and mail) carry a register `keyId` for rotation
 * records; their values are URLs or secret references, so the `key_id` is not embedded in the value.
 */
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';

import type { Service } from './environment.js';
import { LOCAL_ONLY_PREFIX } from './placeholders.js';
import { Secret } from './secret.js';

export type KeyMaterialKind = 'hmac-sha256' | 'aes-256-gcm' | 'es256-key-set' | 'ecdsa-p256-private' | 'credential';

export type KeyHolder = Service | 'migrate' | 'bootstrap';

export interface KeyRegisterEntry {
  /** `key_id` purpose: values are identified as `<keyId>-v<n>`. */
  readonly keyId: string;
  /** Environment variables that hold this key or credential. */
  readonly variables: readonly string[];
  readonly material: KeyMaterialKind;
  readonly algorithm: string;
  readonly purpose: string;
  readonly holders: readonly KeyHolder[];
  /** Services whose start-up fails without the key (the remaining holders load it when their feature needs it). */
  readonly requiredFor: readonly Service[];
  readonly storage: string;
  readonly rotation: string;
  /** `<NAME>_PREVIOUS` is accepted for dual reads during rotation. */
  readonly dualRead: boolean;
  readonly blastRadius: string;
}

const API: readonly Service[] = ['api'];
const BOTH: readonly Service[] = ['api', 'worker'];
const NONE: readonly Service[] = [];

const SM = 'env ref → Secrets Manager';
const KMS = 'env ref → KMS envelope';

/** The 25 rows of the ADR-0018 key register, in ADR order. */
export const KEY_REGISTER: readonly KeyRegisterEntry[] = Object.freeze(
  (
    [
      {
        keyId: 'jwt-signing',
        variables: ['JWT_SIGNING_KEYS'],
        material: 'es256-key-set',
        algorithm: 'ES256 key pair set (two kids)',
        purpose: 'access tokens',
        holders: ['api', 'worker'],
        requiredFor: API,
        storage: SM,
        rotation: '90 d · add new kid, publish public key, switch issuer after 15 min, retire old after 15 min',
        dualRead: false,
        blastRadius: 'forge access tokens ≤ 15 min; revocation set still applies',
      },
      {
        keyId: 'csrf',
        variables: ['CSRF_KEY'],
        material: 'hmac-sha256',
        algorithm: 'HMAC-SHA-256',
        purpose: 'CSRF token',
        holders: ['api'],
        requiredFor: API,
        storage: SM,
        rotation: '180 d · dual verify 24 h',
        dualRead: true,
        blastRadius: 'CSRF on refresh/logout only (Origin and SameSite still hold)',
      },
      {
        keyId: 'recovery',
        variables: ['RECOVERY_KEY'],
        material: 'hmac-sha256',
        algorithm: 'HMAC-SHA-256',
        purpose: 'recovery-code lookup',
        holders: ['api'],
        requiredFor: API,
        storage: SM,
        rotation: 'on demand · key_id per code row; retired key kept until all codes under it are consumed or regenerated',
        dualRead: true,
        blastRadius: 'offline guessing of recovery codes (≈ 50 bits each)',
      },
      {
        keyId: 'mfa',
        variables: ['MFA_ENCRYPTION_KEY'],
        material: 'aes-256-gcm',
        algorithm: 'AES-256-GCM',
        purpose: 'TOTP secrets',
        holders: ['api'],
        requiredFor: API,
        storage: KMS,
        rotation: '1 y · re-encrypt job by key_id',
        dualRead: true,
        blastRadius: 'TOTP secrets of all users (with DB access)',
      },
      {
        keyId: 'vault',
        variables: ['AUDIT_VAULT_KEY'],
        material: 'aes-256-gcm',
        algorithm: 'AES-256-GCM',
        purpose: 'audit_pii_vault.ciphertext (AAD uses the token)',
        holders: ['api', 'worker'],
        requiredFor: BOTH,
        storage: KMS,
        rotation: '1 y · re-encrypt job',
        dualRead: true,
        blastRadius: 'personal data in audit values',
      },
      {
        keyId: 'audit-index',
        variables: ['AUDIT_INDEX_KEY'],
        material: 'hmac-sha256',
        algorithm: 'HMAC-SHA-256',
        purpose: 'ip_hash',
        holders: ['api', 'worker'],
        requiredFor: BOTH,
        storage: SM,
        rotation: '1 y · new rows under new key_id; IP filters query both ids for 90 d',
        dualRead: true,
        blastRadius: 're-identification of hashed IPs',
      },
      {
        keyId: 'audit-anchor',
        variables: ['AUDIT_ANCHOR_SIGNING_KEY'],
        material: 'ecdsa-p256-private',
        algorithm: 'ECDSA P-256 private',
        purpose: 'anchor signatures (ADR-0007 am. 7); verifiers use AUDIT_ANCHOR_PUBLIC_KEYS',
        holders: ['worker'],
        requiredFor: ['worker'],
        storage: 'key file → KMS ECC_NIST_P256, non-exportable',
        rotation: '1 y · new key_id; old public keys kept forever (anchors are permanent)',
        dualRead: false,
        blastRadius: 'forge future anchors (past anchors in the locked sink remain valid evidence)',
      },
      {
        keyId: 'tracking-index',
        variables: ['TRACKING_INDEX_KEY'],
        material: 'hmac-sha256',
        algorithm: 'HMAC-SHA-256',
        purpose: 'tracking_index',
        holders: ['api', 'worker'],
        requiredFor: BOTH,
        storage: SM,
        rotation: '1 y · dual compute',
        dualRead: true,
        blastRadius: 'brute-force of tracking numbers from the index',
      },
      {
        keyId: 'outbox-payload',
        variables: ['OUTBOX_PAYLOAD_KEY'],
        material: 'aes-256-gcm',
        algorithm: 'AES-256-GCM',
        purpose: 'token_enc in outbox payloads',
        holders: ['api', 'worker'],
        requiredFor: BOTH,
        storage: KMS,
        rotation: '90 d · dual read 7 d',
        dualRead: true,
        blastRadius: 'one-time e-mail tokens in flight (≤ hours)',
      },
      {
        keyId: 'idempotency-body',
        variables: ['IDEMPOTENCY_BODY_KEY'],
        material: 'aes-256-gcm',
        algorithm: 'AES-256-GCM',
        purpose: 'stored responses (AAD uses scope_hash)',
        holders: ['api'],
        requiredFor: API,
        storage: KMS,
        rotation: '90 d · dual read 24 h',
        dualRead: true,
        blastRadius: 'replay bodies (≤ 24 h)',
      },
      {
        keyId: 'cursor',
        variables: ['CURSOR_KEY'],
        material: 'hmac-sha256',
        algorithm: 'HMAC-SHA-256',
        purpose: 'pagination cursors',
        holders: ['api'],
        requiredFor: API,
        storage: SM,
        rotation: '30 d · dual verify 1 h',
        dualRead: true,
        blastRadius: 'forged cursors (still RLS-bound)',
      },
      {
        keyId: 'login-counter',
        variables: ['LOGIN_COUNTER_KEY'],
        material: 'hmac-sha256',
        algorithm: 'HMAC-SHA-256',
        purpose: 'auth:fail:<hash> identifiers',
        holders: ['api'],
        requiredFor: API,
        storage: SM,
        rotation: '30 d · counters live ≤ 15 min, no dual',
        dualRead: false,
        blastRadius: 'linking lockout counters to identifiers',
      },
      {
        keyId: 'carrier-token-cache',
        variables: ['CARRIER_TOKEN_CACHE_KEY'],
        material: 'aes-256-gcm',
        algorithm: 'AES-256-GCM',
        purpose: 'carrier OAuth tokens in Redis (AAD = carrier_token ‖ account_id ‖ key_id)',
        holders: ['api', 'worker'],
        requiredFor: BOTH,
        storage: KMS,
        rotation: '90 d · dual read 1 h',
        dualRead: true,
        blastRadius: 'carrier sandbox tokens (≤ 1 h)',
      },
      {
        keyId: 'identifier',
        variables: ['IDENTIFIER_ENCRYPTION_KEY'],
        material: 'aes-256-gcm',
        algorithm: 'AES-256-GCM',
        purpose: 'shipment_party_identifiers.value_ciphertext and organisation_tax_references (AAD uses the row id)',
        holders: ['api', 'worker'],
        requiredFor: BOTH,
        storage: KMS,
        rotation: '1 y · re-encrypt job by key_id',
        dualRead: true,
        blastRadius: 'tax and identity references of all parties (with DB access)',
      },
      {
        keyId: 'vault-hmac',
        variables: ['AUDIT_VAULT_HMAC_KEY'],
        material: 'hmac-sha256',
        algorithm: 'HMAC-SHA-256',
        purpose: 'audit_pii_vault.value_hmac dedupe index',
        holders: ['api', 'worker'],
        requiredFor: BOTH,
        storage: SM,
        rotation: '1 y · dual compute by key_id',
        dualRead: true,
        blastRadius: 'equality oracle on vault values (no plaintext)',
      },
      {
        keyId: 'mfa-challenge-bind',
        variables: ['MFA_CHALLENGE_BIND_KEY'],
        material: 'hmac-sha256',
        algorithm: 'HMAC-SHA-256',
        purpose: 'IP-prefix binding of mfa_challenges',
        holders: ['api'],
        requiredFor: API,
        storage: SM,
        rotation: '90 d · challenges live 5 min, no dual',
        dualRead: false,
        blastRadius: 'none alone (challenge token still required)',
      },
      {
        keyId: 'mfa-enrolment-code',
        variables: ['MFA_ENROLMENT_CODE_KEY'],
        material: 'hmac-sha256',
        algorithm: 'HMAC-SHA-256',
        purpose: 'mfa_enrolment_codes lookup (ADR-0006 am. 14)',
        holders: ['api'],
        requiredFor: API,
        storage: SM,
        rotation: '90 d · codes live 10 min, no dual',
        dualRead: false,
        blastRadius: 'offline guessing of 6-digit codes (attempt counter still applies)',
      },
      {
        keyId: 'pepper',
        variables: ['PASSWORD_PEPPER'],
        material: 'hmac-sha256',
        algorithm: 'HMAC-SHA-256',
        purpose: 'bcrypt pre-hash (reserved; adopted by the SEC-P3-16 backlog item)',
        holders: ['api'],
        requiredFor: NONE,
        storage: SM,
        rotation: 'on demand · re-hash at next login',
        dualRead: true,
        blastRadius: 'none alone (bcrypt still applies)',
      },
      {
        keyId: 'mock-gateway-webhook',
        variables: ['MOCK_GATEWAY_WEBHOOK_SECRET'],
        material: 'hmac-sha256',
        algorithm: 'HMAC-SHA-256',
        purpose: 'Mock gateway webhooks (non-production only)',
        holders: ['api'],
        requiredFor: NONE,
        storage: 'env ref; non-production only',
        rotation: 'per environment',
        dualRead: false,
        blastRadius: 'forged mock payments outside production only',
      },
      {
        keyId: 'stripe-secret',
        variables: ['STRIPE_SECRET_KEY_REF'],
        material: 'credential',
        algorithm: 'restricted rk_test_ key (ADR-0012 am. 2)',
        purpose: 'Stripe API',
        holders: ['api', 'worker'],
        requiredFor: NONE,
        storage: SM,
        rotation: 'roll in the Stripe dashboard, update the reference',
        dualRead: false,
        blastRadius: 'test-mode payment operations within the restricted permissions',
      },
      {
        keyId: 'stripe-webhook',
        variables: ['STRIPE_WEBHOOK_SECRET_REF'],
        material: 'credential',
        algorithm: 'HMAC-SHA-256 · one per webhook endpoint and environment',
        purpose: 'Stripe webhook signatures',
        holders: ['api'],
        requiredFor: NONE,
        storage: SM,
        rotation: 'roll per endpoint',
        dualRead: false,
        blastRadius: 'forged webhooks (processor still retrieves the PaymentIntent)',
      },
      {
        keyId: 'carrier-credential',
        variables: ['CARRIER_DHL_SECRET_REF', 'CARRIER_FEDEX_SECRET_REF', 'CARRIER_UPS_SECRET_REF'],
        material: 'credential',
        algorithm: 'carrier credentials (sandbox)',
        purpose: 'carrier API access per account',
        holders: ['api', 'worker'],
        requiredFor: NONE,
        storage: `${SM} (partner accounts: per-tenant KMS, ADR-0011)`,
        rotation: 'per carrier portal',
        dualRead: false,
        blastRadius: 'sandbox account abuse / quota (SEC-P3-02 guard)',
      },
      {
        keyId: 'db',
        // ADR-0018 names DB_URL/DB_MIGRATOR_URL; data-model §7.1 and US-002 use the Prisma names below.
        variables: ['DATABASE_URL', 'DATABASE_MIGRATOR_URL', 'SHADOW_DATABASE_URL'],
        material: 'credential',
        algorithm: 'PostgreSQL logins platform_app, platform_migrator, cluster admin (bootstrap only, outside this schema)',
        purpose: 'database access',
        holders: ['api', 'worker', 'migrate', 'bootstrap'],
        requiredFor: BOTH,
        storage: `${SM} (RDS master = break-glass, ADR-0007 am. 7)`,
        rotation: '90 d (RDS rotation at M5)',
        dualRead: false,
        blastRadius: "data access within the role's RLS/ownership limits",
      },
      {
        keyId: 'redis',
        variables: ['REDIS_URL'],
        material: 'credential',
        algorithm: 'Valkey ACL users api, worker with key-prefix limits (ADR-0013 am. 4)',
        purpose: 'queues, cache, rate limits, revocation set',
        holders: ['api', 'worker'],
        requiredFor: BOTH,
        storage: 'compose.env local-only → ElastiCache RBAC',
        rotation: '90 d',
        dualRead: false,
        blastRadius: "queue/cache tampering limited to the user's prefixes",
      },
      {
        keyId: 'storage-mail',
        variables: ['STORAGE_ACCESS_KEY_ID_REF', 'STORAGE_SECRET_ACCESS_KEY_REF', 'MAIL_SMTP_PASSWORD_REF'],
        material: 'credential',
        algorithm: 'S3-compatible and SMTP credentials',
        purpose: 'object storage and mail transport',
        holders: ['api', 'worker'],
        requiredFor: NONE,
        storage: 'local-only → IAM task role (no static keys) / SES',
        rotation: 'n/a at M5 (roles)',
        dualRead: false,
        blastRadius: 'object or mail access',
      },
    ] satisfies KeyRegisterEntry[]
  ).map((entry) => Object.freeze({ ...entry, variables: Object.freeze([...entry.variables]), holders: Object.freeze([...entry.holders]) })),
);

/** Register entry that covers `variable`; throws for a variable outside the register (a programming error). */
export function registerEntryFor(variable: string): KeyRegisterEntry {
  const entry = KEY_REGISTER.find((candidate) => candidate.variables.includes(variable));
  if (entry === undefined) throw new Error(`${variable} is not in the key register`);
  return entry;
}

/** Suffix of the variable that holds the retired key during a dual-read rotation. */
export const PREVIOUS_SUFFIX = '_PREVIOUS';

/** One version of an application key. `material` is the decoded key (or the local-only marker bytes). */
export interface KeyVersion {
  readonly keyId: string;
  readonly purpose: string;
  readonly version: number;
  readonly localOnly: boolean;
  readonly material: Secret<Uint8Array>;
}

/** One version of a public verification key (not secret). */
export interface PublicKeyVersion {
  readonly keyId: string;
  readonly version: number;
  readonly localOnly: boolean;
  /** DER-encoded SubjectPublicKeyInfo, or the local-only marker bytes. */
  readonly spki: Uint8Array;
}

export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly rule: string };

const fail = <T>(rule: string): ParseResult<T> => ({ ok: false, rule });
const ok = <T>(value: T): ParseResult<T> => ({ ok: true, value });

const KEY_ID = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)-v([1-9][0-9]{0,5})$/;
const LOCAL_ONLY_MATERIAL = new RegExp(`^${LOCAL_ONLY_PREFIX}[a-z0-9]+(?:-[a-z0-9]+)*$`);
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Minimum symmetric key size (SEC-P3-08 item 1). */
export const MIN_SYMMETRIC_KEY_BYTES = 32;
/** Maximum entries in `JWT_SIGNING_KEYS` (current + next/retired kid). */
export const MAX_JWT_SIGNING_KEYS = 2;
const MAX_PUBLIC_KEYS = 32;

interface RawEntry {
  readonly keyId: string;
  readonly purpose: string;
  readonly version: number;
  readonly localOnly: boolean;
  readonly bytes: Uint8Array;
}

function splitEntry(raw: string, purpose: string): ParseResult<RawEntry> {
  const separator = raw.indexOf(':');
  if (separator <= 0) return fail('key.idMissing');
  const keyId = raw.slice(0, separator);
  const encoded = raw.slice(separator + 1);
  const match = KEY_ID.exec(keyId);
  if (match === null) return fail('key.idFormat');
  if (match[1] !== purpose) return fail('key.purpose');
  const version = Number(match[2]);
  if (LOCAL_ONLY_MATERIAL.test(encoded)) {
    return ok({ keyId, purpose, version, localOnly: true, bytes: new Uint8Array(Buffer.from(encoded, 'utf8')) });
  }
  if (encoded === '' || !BASE64.test(encoded)) return fail('key.encoding');
  return ok({ keyId, purpose, version, localOnly: false, bytes: new Uint8Array(Buffer.from(encoded, 'base64')) });
}

function isP256(create: () => { asymmetricKeyType?: string; asymmetricKeyDetails?: { namedCurve?: string } }): boolean {
  try {
    const key = create();
    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
  } catch {
    return false;
  }
}

const isP256PrivateKey = (der: Uint8Array): boolean =>
  isP256(() => createPrivateKey({ key: Buffer.from(der), format: 'der', type: 'pkcs8' }));

const isP256PublicKey = (der: Uint8Array): boolean => isP256(() => createPublicKey({ key: Buffer.from(der), format: 'der', type: 'spki' }));

function checkMaterial(kind: KeyMaterialKind, entry: RawEntry): string | undefined {
  if (entry.localOnly) return undefined;
  switch (kind) {
    case 'aes-256-gcm':
      return entry.bytes.length === MIN_SYMMETRIC_KEY_BYTES ? undefined : 'key.length';
    case 'hmac-sha256':
      return entry.bytes.length >= MIN_SYMMETRIC_KEY_BYTES ? undefined : 'key.length';
    case 'es256-key-set':
    case 'ecdsa-p256-private':
      return isP256PrivateKey(entry.bytes) ? undefined : 'key.type';
    case 'credential':
      return 'key.notAKey';
  }
}

const toKeyVersion = (entry: RawEntry): KeyVersion =>
  Object.freeze({
    keyId: entry.keyId,
    purpose: entry.purpose,
    version: entry.version,
    localOnly: entry.localOnly,
    material: new Secret(entry.bytes),
  });

/** Parses a single-key variable (`<key_id>:<base64>`) against its register entry. Rules carry no value. */
export function parseKeyVersion(entry: KeyRegisterEntry, raw: string): ParseResult<KeyVersion> {
  const split = splitEntry(raw, entry.keyId);
  if (!split.ok) return split;
  const rule = checkMaterial(entry.material, split.value);
  return rule === undefined ? ok(toKeyVersion(split.value)) : fail(rule);
}

function parseList<T extends { readonly keyId: string }>(
  raw: string,
  max: number,
  parseOne: (part: string) => ParseResult<T>,
): ParseResult<readonly T[]> {
  const parts = raw.split(',').map((part) => part.trim());
  if (parts.length > max || parts.some((part) => part === '')) return fail('key.count');
  const parsed: T[] = [];
  for (const part of parts) {
    const result = parseOne(part);
    if (!result.ok) return result;
    parsed.push(result.value);
  }
  const ids = new Set(parsed.map((item) => item.keyId));
  if (ids.size !== parsed.length) return fail('key.duplicateId');
  return ok(Object.freeze(parsed));
}

/** Parses `JWT_SIGNING_KEYS`: 1–2 comma-separated ES256 entries; the first entry is the current signing key. */
export function parseKeySet(entry: KeyRegisterEntry, raw: string): ParseResult<readonly KeyVersion[]> {
  return parseList<KeyVersion>(raw, MAX_JWT_SIGNING_KEYS, (part) => parseKeyVersion(entry, part));
}

/** Parses a comma-separated set of P-256 public keys (`<purpose>-v<n>:<base64 SPKI DER>`). */
export function parsePublicKeySet(purpose: string, raw: string): ParseResult<readonly PublicKeyVersion[]> {
  return parseList<PublicKeyVersion>(raw, MAX_PUBLIC_KEYS, (part) => {
    const split = splitEntry(part, purpose);
    if (!split.ok) return split;
    const { keyId, version, localOnly, bytes } = split.value;
    if (!localOnly && !isP256PublicKey(bytes)) return fail('key.type');
    return ok(Object.freeze({ keyId, version, localOnly, spki: bytes }));
  });
}

/** SHA-256 digest of key material, used only to compare keys for equality without handling them as strings. */
const fingerprint = (version: KeyVersion): string => createHash('sha256').update(version.material.reveal()).digest('hex');

/**
 * Names of the variables whose key material equals the material of another variable (or of another entry in the
 * same key set). Comparison is by digest; neither the material nor the digest leaves this function.
 */
export function findDuplicateKeyMaterial(keys: ReadonlyMap<string, readonly KeyVersion[]>): readonly string[] {
  const owners = new Map<string, string[]>();
  for (const [name, versions] of keys) {
    for (const version of versions) {
      const digest = fingerprint(version);
      owners.set(digest, [...(owners.get(digest) ?? []), name]);
    }
  }
  const duplicates = new Set<string>();
  for (const names of owners.values()) if (names.length > 1) names.forEach((name) => duplicates.add(name));
  return [...duplicates].sort();
}
