/**
 * The secret denylist of the audit trail (REQ-AUDIT-008, NFR-PRIV-002; ADR-0007 §Redaction and classification;
 * data-model §1.2 `SEC`; US-091; TASK-028). A value under a denylisted key, at any depth of `old_value`, `new_value` or
 * `details`, becomes the literal {@link REDACTED} BEFORE the entry is hashed or stored (the writer applies it while it
 * snapshots the entry, entry.ts), so the hash is computed over the redacted content and the secret never exists in
 * the row (DR-A09). Gateway tokens (saved payment methods) are secrets.
 *
 * Matching is by WORD, never by regular expression (linear time): a key is split into words at every non-alphanumeric
 * character and at lower-to-upper camel boundaries, lower-cased; it is secret when one word is in {@link SECRET_WORDS}
 * or the words joined contain one of {@link SECRET_COMPOUNDS}. Over-redaction is the safe direction (a key such as
 * `hash_version` is redacted too). A value is also redacted, whatever its key, when its text is an authorisation
 * credential (`Bearer ...`, `Basic ...`, `Digest ...`) or a compact JWS (`eyJ...` with two dots).
 */

/** The marker that replaces a secret (part of the hashed content, DR-A09). */
export const REDACTED = '[REDACTED]';

/** Passwords, hashes, tokens, secrets, TOTP, authorisation headers and cookies, card and gateway credentials. */
const SECRET_WORDS: ReadonlySet<string> = new Set([
  'password',
  'passwords',
  'passwd',
  'passphrase',
  'pwd',
  'secret',
  'secrets',
  'token',
  'tokens',
  'hash',
  'hashes',
  'salt',
  'pepper',
  'otp',
  'totp',
  'hotp',
  'authorization',
  'authorisation',
  'auth',
  'bearer',
  'jwt',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'cvv',
  'cvv2',
  'cvc',
  'cvc2',
  'pan',
  'pin',
  'card',
]);

/** Secret names written as one word or several (`apiKey`, `api_key`, `x-api-key`, `recoveryCodes`). */
const SECRET_COMPOUNDS: readonly string[] = [
  'apikey',
  'privatekey',
  'secretkey',
  'accesskey',
  'signingkey',
  'encryptionkey',
  'recoverycode',
  'backupcode',
  'mfacode',
  'verificationcode',
  'resetcode',
  'securitycode',
  'cardnumber',
  'paymentmethod',
];

/** Keys the unit and property tests feed (one per REQ-AUDIT-008 group, in several spellings). */
export const SECRET_KEY_EXAMPLES: readonly string[] = Object.freeze([
  'password',
  'newPassword',
  'password_hash',
  'passwordHash',
  'token_hash',
  'refresh_token',
  'accessToken',
  'client_secret',
  'secret_ref',
  'totp_secret',
  'otp',
  'recovery_codes',
  'recoveryCodes',
  'api_key',
  'x-api-key',
  'api_token',
  'Authorization',
  'cookie',
  'Set-Cookie',
  'card_number',
  'cvc',
  'pan',
  'gateway_token',
  'payment_method_token',
  'credentials',
  'private_key',
]);

const isUpper = (code: number): boolean => code >= 65 && code <= 90;
const isLower = (code: number): boolean => code >= 97 && code <= 122;
const isDigit = (code: number): boolean => code >= 48 && code <= 57;

/** The lower-case words of a key: split at every non-alphanumeric character and at a lower/digit-to-upper boundary. */
export function keyWords(key: string): string[] {
  const words: string[] = [];
  let current = '';
  let previous = 0;
  for (let index = 0; index < key.length; index += 1) {
    const code = key.charCodeAt(index);
    const alphanumeric = isUpper(code) || isLower(code) || isDigit(code);
    if (!alphanumeric || (isUpper(code) && (isLower(previous) || isDigit(previous)))) {
      if (current !== '') words.push(current);
      current = '';
    }
    if (alphanumeric) current += String.fromCharCode(isUpper(code) ? code + 32 : code);
    previous = code;
  }
  if (current !== '') words.push(current);
  return words;
}

/** REQ-AUDIT-008: true when a value under `key` must become {@link REDACTED}. */
export function isSecretKey(key: string): boolean {
  const words = keyWords(key);
  if (words.some((word) => SECRET_WORDS.has(word))) return true;
  const joined = words.join('');
  return SECRET_COMPOUNDS.some((compound) => joined.includes(compound));
}

const SCHEMES = ['bearer ', 'basic ', 'digest '];

/** True for an authorisation credential or a compact JWS, whatever key it sits under. */
export function isSecretText(value: string): boolean {
  const head = value.slice(0, 7).toLowerCase();
  if (SCHEMES.some((scheme) => head.startsWith(scheme))) return true;
  if (!value.startsWith('eyJ')) return false;
  const first = value.indexOf('.');
  return first > 3 && value.indexOf('.', first + 1) > first + 1;
}
