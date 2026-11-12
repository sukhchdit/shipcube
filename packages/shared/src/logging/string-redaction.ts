// Key and string redaction for log lines (US-008 AT-US-008-04/05, REQ-PLAT-012, NFR-PRIV-001; SEC-TC-31; PR6-SEC-02
// item 3, PR6-SEC-03 item 1; TASK-010). Pure and linear-time: every regex is either anchored or a single character
// class run, inputs are capped at MAX_STRING_LENGTH, and the `key: value` scan advances monotonically. Re-exported by
// redaction.ts; the error serializers import this module directly so the value walker can call them without a cycle.

export const REDACTED = '[REDACTED]';
export const OMITTED = '[OMITTED]';
/** Longest string the redactor keeps; longer strings are cut and end with TRUNCATION_SUFFIX. */
export const MAX_STRING_LENGTH = 8192;
export const TRUNCATION_SUFFIX = '…[truncated]';
/** Longest object key written to a line. */
export const MAX_KEY_LENGTH = 128;

/**
 * Substrings of a normalised key that make its value sensitive. `reauthproof` covers the X-Reauth-Proof header (a
 * step-up proof is a bearer credential).
 */
const SENSITIVE_KEY_PARTS: readonly string[] = [
  'password',
  'passwd',
  'passphrase',
  'secret',
  'token',
  'authorization',
  'cookie',
  'apikey',
  'totp',
  'recoverycode',
  'cardnumber',
  'privatekey',
  'credential',
  'signature',
  'reauthproof',
];

/** Short names that are sensitive only as the whole normalised key (`pin`, not `spinner`). */
const SENSITIVE_EXACT_KEYS: ReadonlySet<string> = new Set(['pan', 'cvc', 'cvv', 'otp', 'pin', 'ssn']);

/** Bodies and URLs are never logged, whatever they contain (PR6-SEC-02 item 3, PR6-SEC-03 item 1). */
const OMITTED_KEYS: ReadonlySet<string> = new Set([
  'body',
  'rawbody',
  'requestbody',
  'responsebody',
  'payload',
  'url',
  'urlfull',
  'urlpath',
  'urlquery',
  'href',
  'originalurl',
  'query',
  'querystring',
  'search',
]);

/** Lower-case with every non-alphanumeric removed: `Set-Cookie` -> `setcookie`, `url.full` -> `urlfull`. */
export function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** True when the value under `key` must be written as REDACTED, whatever its type. */
export function isSensitiveKey(key: string): boolean {
  const normalised = normaliseKey(key);
  return SENSITIVE_EXACT_KEYS.has(normalised) || SENSITIVE_KEY_PARTS.some((part) => normalised.includes(part));
}

/** True when the value under `key` is a body or a URL and is written as OMITTED. */
export function isOmittedKey(key: string): boolean {
  return OMITTED_KEYS.has(normaliseKey(key));
}

// --- String values -----------------------------------------------------------------------------------------------

/** `Bearer <credential>` / `Basic <credential>` (case-insensitive scheme, as in HTTP). */
const AUTH_SCHEME = /\b(bearer|basic)[ \t]+[^\s"',;]+/gi;

/** `key` + separator of a `key=value`, `key: value` or `"key":"value"` pair; the value is scanned by hand. */
const KEY_SEPARATOR = /([A-Za-z0-9_.-]{1,64})(["']?)[ \t]{0,3}[:=][ \t]{0,3}/g;

/** A word: a maximal run of characters that are not whitespace, quotes or structural punctuation. */
const WORD = /[^\s"'`,;:()[\]{}<>=|\\/&?#]+/g;

/** Characters that end an unquoted value of a sensitive pair. */
const VALUE_END = /[\s"'&,;<>(){}[\]]/;

/** Words shaped like credentials: JWTs and payment-gateway keys / client secrets. Prefix-anchored. */
const SECRET_SHAPE =
  /^(?:eyJ[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]|rk_[A-Za-z0-9]|whsec_[A-Za-z0-9]|(?:pi|seti)_[A-Za-z0-9]+_secret_[A-Za-z0-9])/;

/** Upper-case catalogue identifiers (`QUOTE_TOKEN_EXPIRED`) name a failure, never carry one: kept readable. */
const CATALOGUE_IDENTIFIER = /^[A-Z]+(?:_[A-Z]+)+$/;

/** Domain part of an e-mail address, anchored at the character after `@`. */
const EMAIL_DOMAIN = /^[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})+/;

function isAlphanumeric(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/** The word without leading/trailing punctuation (`password.` -> `password`). */
function trimPunctuation(word: string): string {
  let start = 0;
  let end = word.length;
  while (start < end && !isAlphanumeric(word.charCodeAt(start))) start += 1;
  while (end > start && !isAlphanumeric(word.charCodeAt(end - 1))) end -= 1;
  return word.slice(start, end);
}

/** A word that contains a sensitive keyword and is more than that keyword (or its plural). */
function isSensitiveWord(word: string): boolean {
  const core = trimPunctuation(word);
  if (CATALOGUE_IDENTIFIER.test(core)) return false;
  const lower = core.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => lower.includes(part) && lower !== part && lower !== `${part}s`);
}

/** `alice@example.com` -> `a***@example.com`; undefined when the word is not an address. */
function maskEmailWord(word: string, at: number): string | undefined {
  if (!EMAIL_DOMAIN.test(word.slice(at + 1))) return undefined;
  const first = String.fromCodePoint(word.codePointAt(0) ?? 42);
  return `${first}***@${word.slice(at + 1)}`;
}

function maskEmailInWord(word: string): string {
  const at = word.indexOf('@');
  return at > 0 ? (maskEmailWord(word, at) ?? word) : word;
}

function redactWord(word: string): string {
  if (SECRET_SHAPE.test(word)) return REDACTED;
  const at = word.indexOf('@');
  if (at > 0) {
    const masked = maskEmailWord(word, at);
    if (masked !== undefined) return isSensitiveWord(word.slice(at + 1)) ? REDACTED : masked;
  }
  return isSensitiveWord(word) ? REDACTED : word;
}

/** End index (exclusive) of the value that starts at `start`: a quoted string or a run up to a delimiter. */
function valueEnd(text: string, start: number): number {
  const quote = text[start];
  if (quote === '"' || quote === "'") {
    let index = start + 1;
    while (index < text.length && text[index] !== quote && text[index] !== '\n') {
      index += text[index] === '\\' ? 2 : 1;
    }
    return Math.min(index + 1, text.length);
  }
  let index = start;
  while (index < text.length && !VALUE_END.test(text.charAt(index))) index += 1;
  return index;
}

/** Replaces the value of every `key=value` / `key: value` / `"key":"value"` pair whose key is sensitive. */
function redactPairs(text: string): string {
  const pattern = new RegExp(KEY_SEPARATOR.source, 'g');
  let output = '';
  let copied = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const key = match[1] ?? '';
    if (!isSensitiveKey(key)) continue;
    const start = match.index + match[0].length;
    const end = valueEnd(text, start);
    if (end === start) continue;
    output += `${text.slice(copied, start)}${REDACTED}`;
    copied = end;
    pattern.lastIndex = end;
  }
  return copied === 0 ? text : output + text.slice(copied);
}

function capped(value: string): { readonly text: string; readonly truncated: boolean } {
  return value.length > MAX_STRING_LENGTH
    ? { text: value.slice(0, MAX_STRING_LENGTH), truncated: true }
    : { text: value, truncated: false };
}

/**
 * Redacts a free-text string (field values, error messages, stacks): authorisation schemes, sensitive pairs,
 * credential-shaped words and words containing a sensitive keyword become REDACTED; e-mail addresses are masked.
 */
export function redactString(value: string): string {
  const { text, truncated } = capped(value);
  const redacted = redactPairs(text.replace(AUTH_SCHEME, (_match, scheme: string) => `${scheme} ${REDACTED}`)).replace(WORD, redactWord);
  return truncated ? redacted + TRUNCATION_SUFFIX : redacted;
}

/** Masks every e-mail address (`alice@example.com` -> `a***@example.com`, AT-US-008-05); nothing else changes. */
export function maskEmails(value: string): string {
  const { text, truncated } = capped(value);
  const masked = text.replace(WORD, maskEmailInWord);
  return truncated ? masked + TRUNCATION_SUFFIX : masked;
}

/** An object key as written to a line: capped and with e-mail addresses masked (keys may be data, e.g. a map). */
export function sanitiseKey(key: string): string {
  return maskEmails(key.length > MAX_KEY_LENGTH ? key.slice(0, MAX_KEY_LENGTH) : key);
}
