/**
 * The audit secret denylist (REQ-AUDIT-008, NFR-PRIV-002; US-091; TASK-028, PR #61 R1-M1 / PR61-SEC-01, R1-m1).
 * The key rules are proven on the audit's own half alone ({@link isAuditSecretKey}) with generated spellings of every
 * word and stem, so removing any one entry fails a case only it covers; the union with the log matcher is pinned with
 * keys only the log catches; the reviewers' probe corpora (code review `pr61/deny.mts`, security P1/P2/P7) are cases.
 */
import { describe, expect, it } from '@jest/globals';
import { isSensitiveKey } from '@platform/shared/logging';

import {
  isAuditSecretKey,
  isSecretKey,
  isSecretPair,
  isSecretText,
  keyWords,
  pairedSecretMembers,
  SECRET_KEY_EXAMPLES,
} from './denylist.js';
import { REQUIRED_SECRET_STEMS, REQUIRED_SECRET_WORDS, stemSpellings, wordSpellings } from './tests/spellings.js';

describe('[PR61 R1-M1] keyWords: one pass, camel, acronym and letter/digit boundaries', () => {
  it.each([
    ['TOTPSecret', ['totp', 'secret']],
    ['APIToken', ['api', 'token']],
    ['X-CSRFToken', ['x', 'csrf', 'token']],
    ['password2', ['password', '2']],
    ['token1', ['token', '1']],
    ['access_token2', ['access', 'token', '2']],
    ['ccNumber', ['cc', 'number']],
    ['otpauthUrl', ['otpauth', 'url']],
    ['__Host-rt_web', ['host', 'rt', 'web']],
    ['v2Key', ['v', '2', 'key']],
    ['', []],
  ])('%s -> %j', (key, words) => {
    expect(keyWords(key)).toEqual(words);
  });
});

describe('[PR61 R1-M1] generated spellings: every word and every stem catches on its own', () => {
  it.each(REQUIRED_SECRET_WORDS)('word "%s": every spelling is secret for the audit half alone', (word) => {
    for (const key of wordSpellings(word)) expect([key, isAuditSecretKey(key)]).toEqual([key, true]);
  });

  it.each(REQUIRED_SECRET_STEMS)('stem "%s": every spelling is secret for the audit half alone', (stem) => {
    for (const key of stemSpellings(stem)) expect([key, isAuditSecretKey(key)]).toEqual([key, true]);
  });

  it('key-material names: <x>_key is secret, identifier names and *_key_id are not', () => {
    for (const key of ['AUDIT_VAULT_KEY', 'signing_key', 'csrfKey', 'RECOVERY_KEY', 'private_keys'])
      expect(isAuditSecretKey(key)).toBe(true);
    for (const key of [
      'idempotency_key',
      'name_key',
      'object_key',
      'archive_object_key',
      'cache_key',
      'key',
      'key_id',
      'ciphertext_key_id',
    ]) {
      expect([key, isAuditSecretKey(key)]).toEqual([key, false]);
    }
  });
});

describe('[PR61-SEC-01] the union with the log matcher', () => {
  it('keys only the log catches are secret through isSecretKey (the log half is consulted)', () => {
    for (const key of ['__Host-rt_web', '__Secure-x', 'connect.sid']) {
      expect([key, isSensitiveKey(key) || isAuditSecretKey(key), isSecretKey(key)]).toEqual([key, true, true]);
    }
    expect(isAuditSecretKey('__Host-rt_web')).toBe(false);
    expect(isSensitiveKey('__Host-rt_web')).toBe(true);
  });

  it('keys only the audit catches are secret through isSecretKey (the audit half is consulted)', () => {
    for (const key of ['cc_number', 'csc', 'cvn', 'hmac', 'otpauth_url', 'provisioning_uri', 'AUDIT_VAULT_KEY']) {
      expect([key, isSensitiveKey(key), isSecretKey(key)]).toEqual([key, false, true]);
    }
  });
});

/** The reviewers' probe corpora: every key must be secret. */
const CORPUS = [
  ...SECRET_KEY_EXAMPLES,
  // Code review R1-M1 (pr61/deny.mts).
  'TOTPSecret',
  'OTPSecret',
  'APIToken',
  'JWTSecret',
  'password2',
  'token1',
  'secret2',
  'cc_number',
  'ccNumber',
  'csc',
  'cvn',
  'otpauth_url',
  'otpauthUrl',
  'provisioning_uri',
  'passcode',
  // Security review PR61-SEC-01 (P1, P7).
  'CSRFToken',
  'X-CSRFToken',
  'IDToken',
  'JWTToken',
  'MFASecret',
  'OTPCode',
  'AWSSecret',
  'APISecret',
  'SAMLToken',
  'SSOToken',
  'PINCode',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authtoken',
  'sessiontoken',
  'csrftoken',
  'newpassword',
  'oldpassword',
  'userpassword',
  'passwordhash',
  'clientsecret',
  'apisecret',
  'apitoken',
  'bearertoken',
  'creditcard',
  'token2',
  'access_token2',
  'secret1',
  'pass',
  'pass_phrase',
  'X-Reauth-Proof',
  'reauthProof',
  'reauth_proof',
  '__Host-rt_web',
  '__Host-rt_admin',
  'session_id',
  'sessionId',
  'sid',
  'signature',
  'stripe-signature',
  'dsn',
  'connectionString',
  'manual_key',
  'code_verifier',
  'private_jwk',
  'connect.sid',
  'hmac',
  'CSRF_KEY',
  'RECOVERY_KEY',
  'IDEMPOTENCY_BODY_KEY',
  // D-ORCH-COORD-02 additions (neither redactor caught them before).
  'codes',
  'mfa_seed',
  'pw',
  'whsec',
  'csrf',
  'privateJwk',
  'jwk',
  'proof',
  'session',
  'OUTBOX_PAYLOAD_KEY',
  'DATABASE_URL',
];

describe('[PR61-SEC-01] [AT-US-091-01] the probe corpora are secret keys', () => {
  it.each(CORPUS)('"%s"', (key) => {
    expect(isSecretKey(key)).toBe(true);
  });

  it.each([
    'city',
    'country_code',
    'postcode',
    'email',
    'status',
    'required_permission',
    'result_count',
    'filter',
    'code',
    'description',
    'company',
    'ip_coarse',
    'entity_id',
    'org_id',
    'name_key',
    'idempotency_key',
    'passport_number',
    'tracking_number',
    'author',
    'bypass',
    'footprint',
    'key',
    '',
  ])('"%s" is not a secret key (problem codes and identifiers stay readable)', (key) => {
    expect(isSecretKey(key)).toBe(false);
  });
});

const S = 'S3NTINEL0rawSecretValue42';

/**
 * A PEM private-key block built at run time from parts, so no private-key literal sits in the source or its history
 * (the gitleaks `private-key` rule, PR33-SEC-08). `kind` is `` or e.g. `EC ` / `RSA `.
 */
const pemBlock = (kind: string, body: string): string =>
  `${['-----BEGIN', `${kind}PRIVATE`, 'KEY-----'].join(' ')}\n${body}\n${['-----END', `${kind}PRIVATE`, 'KEY-----'].join(' ')}`;

describe('[PR61-SEC-01] [PR61 R1-m1] credential-shaped values, whatever the key', () => {
  it.each([
    ['Bearer with a TAB', `Bearer\t${S}`],
    ['Bearer after leading white space', `  Bearer ${S}`],
    ['an Authorization line inside text', `request failed: Authorization: Bearer ${S}`],
    ['the Token scheme (16+ characters)', `Token ${S}`],
    ['the DPoP scheme', `DPoP ${S}`],
    ['the NTLM scheme', `NTLM ${S}`],
    ['the Basic scheme', `Basic ${S}`],
    ['the Digest scheme', `Digest username="u", response="${S}"`],
    ['a token in a URL query', `https://app.example.test/reset?token=${S}`],
    ['an S3 presigned URL', `https://bucket.s3.amazonaws.com/doc.pdf?X-Amz-Signature=${S}`],
    ['a database URL with a password', `postgresql://app:${S}@db.example.test/platform`],
    ['a Stripe secret key', `sk_live_${S}`],
    ['a webhook secret', `whsec_${S}`],
    ['a payment-intent client secret', `pi_123_secret_${S}`],
    ['an otpauth URI', `otpauth://totp/Platform:jane?secret=${S}&issuer=Platform`],
    ['a PEM private key', pemBlock('', S)],
    ['an EC PEM private key', pemBlock('EC ', S)],
    ['a compact JWS', `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.${S}`],
    ['a compact JWS with an empty payload', `eyJhbGciOiJIUzI1NiJ9..${S}`],
    ['a credential past the log cap (overlapping windows)', `${'a '.repeat(6_000)}Bearer ${S}`],
  ])('%s', (_label, value) => {
    expect(isSecretText(value)).toBe(true);
  });

  it.each([
    'Pune',
    'jane@example.com',
    'please reset your password',
    'QUOTE_TOKEN_EXPIRED',
    'https://example.com/path',
    'Bearer',
    'eyJ',
    'Order 12345 shipped',
    'Basic plan',
    'Bearer of bad news',
    'session:manage',
    'reset_password',
    'refresh_token',
    'a'.repeat(20_000),
    '',
  ])('"%s" is not a secret value (e-mail masking alone does not count)', (value) => {
    expect(isSecretText(value)).toBe(false);
  });
});

describe('[PR61-SEC-01] record shapes', () => {
  it('{ name|key|header|field: <secret>, value|values|content|data } pairs its value members', () => {
    expect(pairedSecretMembers({ name: 'X-Api-Key', value: S })).toEqual(['value']);
    expect(pairedSecretMembers({ key: 'refresh_token', value: S, data: S })).toEqual(['value', 'data']);
    expect(pairedSecretMembers({ header: 'Authorization', values: [S] })).toEqual(['values']);
    expect(pairedSecretMembers({ field: 'password', content: S })).toEqual(['content']);
    expect(pairedSecretMembers({ name: 'city', value: 'Pune' })).toEqual([]);
    expect(pairedSecretMembers({ name: 7, value: S })).toEqual([]);
    expect(pairedSecretMembers(Object.create({ name: 'password', value: S }) as Record<string, unknown>)).toEqual([]);
  });

  it('a two-element [<secret name>, value] array is a secret pair', () => {
    expect(isSecretPair(['X-Api-Key', S])).toBe(true);
    expect(isSecretPair(['city', 'Pune'])).toBe(false);
    expect(isSecretPair(['X-Api-Key', S, 'x'])).toBe(false);
    expect(isSecretPair([1, S])).toBe(false);
  });
});
