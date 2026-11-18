/**
 * The secret denylist of the audit trail (REQ-AUDIT-008, NFR-PRIV-002; ADR-0007 §Redaction and classification;
 * data-model §1.2 `SEC`; US-091; TASK-028, PR #61 R1-M1 / PR61-SEC-01). A value under a denylisted key, at any depth of
 * `old_value`, `new_value` or `details`, becomes the literal {@link REDACTED} BEFORE the entry is hashed or stored (the
 * writer applies it while it snapshots the entry, entry.ts), so the hash is computed over the redacted content and the
 * secret never exists in the row (DR-A09). The audit row is immutable and archived, so this matcher must be at least
 * as strong as the platform log's: it is the UNION of the log's `isSensitiveKey` / credential-shape redaction
 * (`@platform/shared/logging`) and the audit's own word rules below. Over-redaction is the safe direction.
 *
 * Keys ({@link isSecretKey}):
 *  - the log's `isSensitiveKey` (normalised substrings, exact short names, `__Host-` / `__Secure-` cookies, the reauth
 *    proof, session ids);
 *  - the audit's words, split in ONE pass at every non-alphanumeric character, at a lower-to-upper camel boundary, at
 *    an acronym boundary (`APIToken` -> api, token; `TOTPSecret` -> totp, secret) and at letter/digit boundaries
 *    (`password2` -> password, 2): one word in the word list, or the joined words containing a stem, or a key-material
 *    name (`<x>_key`, except identifier names such as `idempotency_key`).
 *  A bare `code` is deliberately NOT secret: it would wipe the problem codes in `details.code`; the TOTP and recovery
 *  codes are covered by their compound stems.
 * Records ({@link pairedSecretMembers}, {@link isSecretPair}): `{ name|key|header|field: <secret key>,
 * value|values|content|data: v }` and a two-string `[<secret key>, v]` redact `v` (header lists and form fields).
 * Values ({@link isSecretText}): a PEM private key, an `otpauth:` URI, a compact JWS, or the log's credential shapes
 * (`hasCredentialShape`: authorisation schemes with any leading or inner white space, `Authorization: Bearer` inside
 * text, URLs with userinfo or a query, presigned URLs, `sk_live_` / `whsec_` / `pi_…_secret_` gateway shapes). Words
 * that merely contain a keyword (`reset_password`, `session:manage`) are business values and are kept; their KEYS are
 * what the key rules judge. Long texts are scanned in overlapping windows.
 * No regular expression in this file; the log's patterns are linear (TASK-010).
 */
import { hasCredentialShape, isSensitiveKey, MAX_STRING_LENGTH } from '@platform/shared/logging';

/** The marker that replaces a secret (part of the hashed content, DR-A09). */
export const REDACTED = '[REDACTED]';
/** The marker that replaces a credential-shaped object KEY (the key itself would carry the secret). */
export const REDACTED_KEY = '[REDACTED_KEY]';

/** Whole words that make a key secret (passwords, hashes, tokens, TOTP, authorisation, cookies, card and PIN data). */
const SECRET_WORDS: ReadonlySet<string> = new Set([
  'password',
  'passwords',
  'passwd',
  'passphrase',
  'passcode',
  'pwd',
  'pw',
  'pass',
  'secret',
  'secrets',
  'token',
  'tokens',
  'hash',
  'hashes',
  'hmac',
  'salt',
  'pepper',
  'otp',
  'totp',
  'csrf',
  'whsec',
  'hotp',
  'authorization',
  'authorisation',
  'auth',
  'bearer',
  'jwt',
  'jwk',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'cvv',
  'cvc',
  'csc',
  'cvn',
  'pan',
  'pin',
  'card',
  'signature',
  'proof',
  'verifier',
  'dsn',
  'sid',
  'codes',
]);

/** Substrings of the joined words that make a key secret (`apiKey`, `x-api-key`, `recoveryCodes`, `otpauth_url`). */
const SECRET_STEMS: readonly string[] = [
  'password',
  'passwd',
  'passphrase',
  'passcode',
  'secret',
  'token',
  'credential',
  'cookie',
  'authoriz',
  'authoris',
  'bearer',
  'apikey',
  'privatekey',
  'secretkey',
  'accesskey',
  'signingkey',
  'encryptionkey',
  'manualkey',
  'recoverycode',
  'backupcode',
  'mfacode',
  'otpcode',
  'pincode',
  'mfaseed',
  'otpseed',
  'totpseed',
  'verificationcode',
  'resetcode',
  'securitycode',
  'cardnumber',
  'ccnumber',
  'creditcard',
  'paymentmethod',
  'otpauth',
  'provisioninguri',
  'reauthproof',
  'sessionid',
  'connectionstring',
  'databaseurl',
];

/** `<x>_key` names that are identifiers, not key material (a last word `key` otherwise redacts). */
const NON_SECRET_KEY_NAMES: ReadonlySet<string> = new Set([
  'idempotencykey',
  'namekey',
  'objectkey',
  'archiveobjectkey',
  'cachekey',
  'sortkey',
  'partitionkey',
  'primarykey',
  'foreignkey',
  'templatekey',
  'messagekey',
]);

/** Keys the unit tests feed (one per REQ-AUDIT-008 group); the property tests generate spellings of every list entry. */
export const SECRET_KEY_EXAMPLES: readonly string[] = Object.freeze([
  'password',
  'newPassword',
  'password_hash',
  'password2',
  'token_hash',
  'refresh_token',
  'accessToken',
  'APIToken',
  'TOTPSecret',
  'client_secret',
  'secret_ref',
  'totp_secret',
  'otp',
  'otpauth_url',
  'provisioning_uri',
  'recovery_codes',
  'api_key',
  'x-api-key',
  'Authorization',
  'X-Reauth-Proof',
  '__Host-rt_web',
  'cookie',
  'Set-Cookie',
  'card_number',
  'cc_number',
  'csc',
  'passcode',
  'gateway_token',
  'payment_method_token',
  'credentials',
  'private_key',
  'AUDIT_VAULT_KEY',
]);

/** The audit's own word list and stems, for the generated-spelling property tests. */
export const DENYLIST_WORDS: readonly string[] = Object.freeze([...SECRET_WORDS]);
export const DENYLIST_STEMS: readonly string[] = Object.freeze([...SECRET_STEMS]);

const isUpper = (code: number): boolean => code >= 65 && code <= 90;
const isLower = (code: number): boolean => code >= 97 && code <= 122;
const isDigit = (code: number): boolean => code >= 48 && code <= 57;
const isLetter = (code: number): boolean => isUpper(code) || isLower(code);

/** Does a word boundary fall before `key[index]`? (camel, acronym and letter/digit boundaries; constant look-around). */
function boundaryBefore(key: string, index: number): boolean {
  if (index === 0) return false;
  const code = key.charCodeAt(index);
  const previous = key.charCodeAt(index - 1);
  if (isUpper(code) && (isLower(previous) || isDigit(previous))) return true;
  if (isUpper(code) && isUpper(previous) && isLower(key.charCodeAt(index + 1))) return true;
  return (isDigit(code) && isLetter(previous)) || (isLetter(code) && isDigit(previous));
}

/**
 * The lower-case words of a key, in one pass: split at every non-alphanumeric character, at a lower/digit-to-upper
 * boundary, at an acronym boundary (`APIToken` -> api, token) and at letter/digit boundaries (`token1` -> token, 1).
 */
export function keyWords(key: string): string[] {
  const words: string[] = [];
  let current = '';
  for (let index = 0; index < key.length; index += 1) {
    const code = key.charCodeAt(index);
    const alphanumeric = isLetter(code) || isDigit(code);
    if ((!alphanumeric || boundaryBefore(key, index)) && current !== '') {
      words.push(current);
      current = '';
    }
    if (alphanumeric) current += String.fromCharCode(isUpper(code) ? code + 32 : code);
  }
  if (current !== '') words.push(current);
  return words;
}

/** `AUDIT_VAULT_KEY`, `signing_key`: at least two words, the last one `key`/`keys`, not an identifier name. */
function isKeyMaterialName(words: readonly string[]): boolean {
  const last = words[words.length - 1];
  return words.length >= 2 && (last === 'key' || last === 'keys') && !NON_SECRET_KEY_NAMES.has(words.join(''));
}

/** The audit's own key rules (without the log's): exported so a test can prove each half on its own. */
export function isAuditSecretKey(key: string): boolean {
  const words = keyWords(key);
  if (words.some((word) => SECRET_WORDS.has(word))) return true;
  const joined = words.join('');
  return SECRET_STEMS.some((stem) => joined.includes(stem)) || isKeyMaterialName(words);
}

/** REQ-AUDIT-008: true when a value under `key` must become {@link REDACTED} (the union described in the header). */
export const isSecretKey = (key: string): boolean => isSensitiveKey(key) || isAuditSecretKey(key);

const WHITESPACE: ReadonlySet<string> = new Set([' ', '\t', '\n', '\r', '\f', '\v']);

function trimLeading(value: string): string {
  let start = 0;
  while (start < value.length && WHITESPACE.has(value.charAt(start))) start += 1;
  return start === 0 ? value : value.slice(start);
}

/** A compact JWS (`eyJ<header>.<payload>.<signature>`, the payload may be empty). */
function isCompactJws(text: string): boolean {
  if (!text.startsWith('eyJ')) return false;
  const first = text.indexOf('.');
  return first > 3 && text.indexOf('.', first + 1) > first;
}

/** The log's credential-shape predicate over one window (its patterns, without the e-mail or keyword-word rules). */
const logRedacts = (window: string): boolean => hasCredentialShape(window);

/** Window and stride of the scan of a text longer than the log's cap (shapes up to half a window are never split). */
const WINDOW = MAX_STRING_LENGTH;
const STRIDE = MAX_STRING_LENGTH / 2;

/** True for a credential-shaped text, whatever key it sits under (see the header). */
export function isSecretText(value: string): boolean {
  const text = trimLeading(value);
  if (text.includes('-----BEGIN') && text.includes('PRIVATE KEY')) return true;
  if (text.slice(0, 8).toLowerCase() === 'otpauth:') return true;
  if (isCompactJws(text)) return true;
  if (value.length <= WINDOW) return logRedacts(value);
  for (let start = 0; start < value.length; start += STRIDE) {
    if (logRedacts(value.slice(start, start + WINDOW))) return true;
    if (start + WINDOW >= value.length) break;
  }
  return false;
}

const PAIR_NAMES: readonly string[] = ['name', 'key', 'header', 'field'];
const PAIR_VALUES: readonly string[] = ['value', 'values', 'content', 'data'];

/**
 * The members of a `{ name, value }`-shaped record whose value is a secret because the record's NAME member names a
 * secret (`{ name: 'X-Api-Key', value: v }`, `{ key: 'refresh_token', value: v }`). Empty for any other record.
 */
export function pairedSecretMembers(record: Readonly<Record<string, unknown>>): readonly string[] {
  const named = PAIR_NAMES.some((member) => {
    const name = Object.hasOwn(record, member) ? record[member] : undefined;
    return typeof name === 'string' && isSecretKey(name);
  });
  return named ? PAIR_VALUES.filter((member) => Object.hasOwn(record, member)) : [];
}

/** True for a two-element `[name, value]` array whose name names a secret (`['X-Api-Key', v]`). */
export function isSecretPair(items: readonly unknown[]): boolean {
  return items.length === 2 && typeof items[0] === 'string' && isSecretKey(items[0]);
}
