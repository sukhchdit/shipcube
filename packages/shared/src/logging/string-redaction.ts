// Key and string redaction for log lines (US-008 AT-US-008-04/05, REQ-PLAT-012, NFR-PRIV-001; SEC-TC-31; PR6-SEC-02
// item 3, PR6-SEC-03 item 1; PR20-SEC-01/02/03/08/12, PR20 m4/n1; TASK-010). Pure and linear-time: every regex is
// anchored, bounded, or a single character-class run after disjoint classes; inputs are capped at MAX_STRING_LENGTH
// (keys at MAX_KEY_LENGTH) before any regex, and the `key: value` scan advances monotonically. Re-exported by
// redaction.ts; the error serializers import this module directly so the value walker can call them without a cycle.
//
// Free-text redaction is defence in depth: the structured key path (isSensitiveKey / isOmittedKey / isPiiKey) is the
// primary control. Over-redaction that fails closed is accepted (D-TASK010-01 (2)). Accepted residual gaps:
// - a free-text pair whose key is followed by more than 16 blanks before the separator, whose key is longer than 64
//   characters or has three or more words with the sensitive word outside the last two (`password for alice: v`);
// - an unquoted sensitive value that itself contains `&`, `,`, `;` or a line break keeps the part after it; a quoted
//   value that contains its own unescaped quote keeps the part after that quote;
// - free-text `key: value` pairs whose key is only personal data (`name: Alice`): the PII key class is structured-only;
// - scheme-less userinfo (`user:pw@db:5432`) and percent-encoded URLs (`https%3A%2F%2F`) are not recognised as URLs;
// - a Digest/HOBA/AWS4 parameter list without its scheme word (a bare `response="v"`);
// - double-encoded e-mails (`%2540`); a quoted local part longer than 64 characters;
// - a sensitive word beyond the first MAX_KEY_LENGTH characters of a key, and homoglyph keys NFKC does not fold
//   (Cyrillic `раssword`).

export const REDACTED = '[REDACTED]';
export const OMITTED = '[OMITTED]';
/** Written instead of an object key that is shaped like a credential (a JWT or a payment-gateway key). */
export const REDACTED_KEY = '[REDACTED_KEY]';
/** Longest string the redactor keeps; longer strings are cut and end with TRUNCATION_SUFFIX. */
export const MAX_STRING_LENGTH = 8192;
export const TRUNCATION_SUFFIX = '…[truncated]';
/** Longest object key written to a line, and the longest prefix of a key that is classified. */
export const MAX_KEY_LENGTH = 128;

// --- Key classes ---------------------------------------------------------------------------------------------------

/**
 * Substrings of a normalised key that make its value sensitive. `reauthproof` covers the X-Reauth-Proof header (a
 * step-up proof is a bearer credential). `otp` is exact-only (a part would hit `footprint`); `otpcode` is a part.
 */
const SENSITIVE_KEY_PARTS: readonly string[] = [
  'password',
  'passwd',
  'passphrase',
  'passcode',
  'pwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'apikey',
  'totp',
  'otpcode',
  'mfacode',
  'verificationcode',
  'securitycode',
  'recoverycode',
  'cardnumber',
  'cvv2',
  'cvc2',
  'privatekey',
  'privatejwk',
  'jwt',
  'jwk',
  'credential',
  'signature',
  'reauthproof',
  'proof',
  'verifier',
  'sessionid',
  'dsn',
  'connectionstring',
];

/** Short names that are sensitive only as the whole normalised key (`pin`, not `spinner`; `pass`, not `bypass`). */
const SENSITIVE_EXACT_KEYS: ReadonlySet<string> = new Set(['pan', 'cvc', 'cvv', 'otp', 'pin', 'ssn', 'pass', 'sid', 'session', 'auth']);

/** Parents whose `number` / `exp*` / `cvc*` / `cvv*` children are card data (PR20-SEC-02 item 3). */
const CARD_PARENT_KEYS: ReadonlySet<string> = new Set(['card', 'paymentcard', 'paymentmethod', 'creditcard']);
const CARD_CHILD_PREFIX = /^(?:exp|cvc|cvv)/;

/** Substrings of a normalised key whose value is personal data (PR20-SEC-02 item 1). */
const PII_KEY_PARTS: readonly string[] = [
  'fullname',
  'personname',
  'attentionname',
  'contactname',
  'firstname',
  'lastname',
  'givenname',
  'familyname',
  'surname',
  'companyname',
  'requestorname',
  'phone',
  'mobile',
  'fax',
  'email',
  'address',
  'streetline',
  'postalcode',
  'postcode',
  'zipcode',
  'taxid',
  'vatnumber',
  'vatid',
  'gstin',
  'registrationnumber',
  'dateofbirth',
  'birthdate',
  'passport',
  'nationalid',
];

/** Personal-data names that are substrings of common words (`tin` in destination, `zip` in gzip): exact only. */
const PII_EXACT_KEYS: ReadonlySet<string> = new Set(['name', 'ip', 'zip', 'tin', 'tins', 'vat', 'ein', 'iec', 'dob']);

/** Bodies, raw header lists and URLs are never logged, whatever they contain (PR6-SEC-02 item 3, PR6-SEC-03 item 1). */
const OMITTED_KEYS: ReadonlySet<string> = new Set([
  'body',
  'rawbody',
  'requestbody',
  'responsebody',
  'payload',
  'rawheaders',
  'rawtrailers',
  'url',
  'urlfull',
  'urlpath',
  'urlquery',
  'parsedurl',
  'href',
  'originalurl',
  'query',
  'querystring',
  'search',
]);

/** Keys ending like this hold a URL (`labelUrl`, `redirectUri`, `documentLink`) and are omitted (PR20-SEC-03 item 2). */
const OMITTED_KEY_SUFFIXES: readonly string[] = ['url', 'uri', 'href', 'link'];

/**
 * The key folded for comparison: the first MAX_KEY_LENGTH characters (so a 1 MiB key stays cheap), NFKC-folded
 * (full-width letters), lower-cased, with every non-alphanumeric removed: `Set-Cookie` -> `setcookie`, `url.full` ->
 * `urlfull`.
 */
export function normaliseKey(key: string): string {
  const head = key.length > MAX_KEY_LENGTH ? key.slice(0, MAX_KEY_LENGTH) : key;
  return head
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function matchesClass(normalised: string, exact: ReadonlySet<string>, parts: readonly string[]): boolean {
  return exact.has(normalised) || parts.some((part) => normalised.includes(part));
}

/** True when the value under `key` must be written as REDACTED, whatever its type (credentials; not PII). */
export function isSensitiveKey(key: string): boolean {
  return matchesClass(normaliseKey(key), SENSITIVE_EXACT_KEYS, SENSITIVE_KEY_PARTS);
}

/**
 * True when `key` holds card data because of its parent: `number`, `exp*`, `cvc*` and `cvv*` under a parent that
 * normalises to `card`, `paymentcard`, `paymentmethod` or `creditcard` (`card.number`, `paymentMethod.expMonth`).
 */
export function isSensitiveChildKey(parentKey: string, key: string): boolean {
  if (!CARD_PARENT_KEYS.has(normaliseKey(parentKey))) return false;
  const child = normaliseKey(key);
  return child === 'number' || CARD_CHILD_PREFIX.test(child);
}

/**
 * True when the value under `key` is personal data (names, phones, addresses, tax and identity numbers, dates of birth,
 * IPs). Separate from isSensitiveKey so the caller decides where it applies. Fails closed: `distinct_address_count`
 * matches `address`.
 */
export function isPiiKey(key: string): boolean {
  return matchesClass(normaliseKey(key), PII_EXACT_KEYS, PII_KEY_PARTS);
}

/** True when the value under `key` is a body, a raw header list or a URL and is written as OMITTED. */
export function isOmittedKey(key: string): boolean {
  const normalised = normaliseKey(key);
  return OMITTED_KEYS.has(normalised) || OMITTED_KEY_SUFFIXES.some((suffix) => normalised.endsWith(suffix));
}

// --- Patterns ------------------------------------------------------------------------------------------------------

/** A URI with an authority (`scheme://...`, also JSON-escaped `scheme:\/\/`), up to a blank, quote or angle bracket. */
const URL_PATTERN = /[a-z][a-z0-9+.-]{0,15}:\\?\/\\?\/[^\s"'<>]*/gi;
const URL_PREFIX = /^[a-z][a-z0-9+.-]{0,15}:\\?\/\\?\//i;

/**
 * Single-credential authorisation schemes (case-insensitive, as in HTTP). `token` and `negotiate` are English words,
 * so they count only before a credential-length run (16+ characters). The credential never starts with `:` or `=`:
 * `apiKey : v` is a key/value pair (the pair pass redacts `v`), not the scheme `apikey` with the credential `:`.
 */
const TOKEN68_SCHEME =
  /\b(bearer|basic|dpop|ntlm|apikey|(?:token|negotiate)(?=[ \t]{1,16}[^\s"',;:=][^\s"',;]{15}))[ \t]{1,16}[^\s"',;:=][^\s"',;]*/gi;

/** Parameter-list schemes (`Digest username="u", response="v"`): the whole rest of the line is the credential. */
const PARAMETER_SCHEME = /\b(digest|hoba|aws4-hmac-sha256)(?=[ \t]{1,16}[A-Za-z0-9_-]{1,32}[ \t]{0,16}=)[ \t]{1,16}[^\r\n]+/gi;

/**
 * `key` + separator of a `key=value`, `key: value`, `"key":"value"`, `\"key\":\"value\"` or Joi `"key" with value`
 * pair. The key may have two words (`API key`); up to 16 blanks (incl. NBSP) around the separator and one line break
 * after it are allowed. The value is scanned by hand.
 */
const KEY_SEPARATOR =
  /([A-Za-z0-9_.-]{1,64}(?:[ \t][A-Za-z0-9_.-]{1,64})?)(?:\\?["'])?(?:[ \t\u00a0]{0,16}[:=]|[ \t]with[ \t]value)[ \t\u00a0]{0,16}(?:(?:\r\n|\r|\n)[ \t\u00a0]{0,16})?/g;

/** Separators inside a free-text key; the last segment is classified too (`user_pin`, `x-auth`). */
const KEY_SEGMENT_SEPARATOR = /[ \t._-]/;

/** A word: a maximal run of characters that are not whitespace, quotes or structural punctuation. */
const WORD = /[^\s"'`,;:()[\]{}<>=|\\/&?#]+/g;

/** A quoted e-mail local part (`"a b"@example.com`); the domain follows the `@`. */
const QUOTED_LOCAL_PART = /"[^"\r\n@]{1,64}"(?=@)/g;

/** Words shaped like credentials: JWTs and payment-gateway keys / client secrets. Prefix-anchored. */
const SECRET_SHAPE =
  /^(?:eyJ[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]|rk_[A-Za-z0-9]|whsec_[A-Za-z0-9]|(?:pi|seti)_[A-Za-z0-9]+_secret_[A-Za-z0-9])/;

/** Upper-case catalogue identifiers (`QUOTE_TOKEN_EXPIRED`) name a failure, never carry one: kept readable. */
const CATALOGUE_IDENTIFIER = /^[A-Z]+(?:_[A-Z]+)+$/;

/** Domain part of an e-mail address (IDN labels allowed), anchored at the character after the `@`. */
const EMAIL_DOMAIN = /^[^\s.@"'<>()[\]{},;:]{1,63}(?:\.[^\s.@"'<>()[\]{},;:]{1,63})+/;

/**
 * DEL, C1 controls (incl. CSI U+009B) and the JS line/paragraph separators: escaped as visible text (PR20-SEC-08).
 * Built from an escaped string so neither the source nor the transpiled output holds a raw line terminator.
 */
const LINE_BREAKERS = new RegExp('[\\u007f-\\u009f\\u2028\\u2029]', 'g');

// --- Small helpers -------------------------------------------------------------------------------------------------

function capped(value: string): { readonly text: string; readonly truncated: boolean } {
  return value.length > MAX_STRING_LENGTH
    ? { text: value.slice(0, MAX_STRING_LENGTH), truncated: true }
    : { text: value, truncated: false };
}

function isAlphanumeric(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isLineBreak(char: string | undefined): boolean {
  return char === '\n' || char === '\r';
}

/**
 * Replaces DEL, C1 controls (U+0080-U+009F) and U+2028/U+2029 by their visible `\uXXXX` text, so a log line cannot be
 * split or carry terminal control sequences. Nothing else changes.
 */
export function escapeLineBreakers(value: string): string {
  return value.replace(LINE_BREAKERS, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

// --- URLs ----------------------------------------------------------------------------------------------------------

/** `scheme://user:pw@host/path?q#f` -> `scheme://[REDACTED]@host/path?[OMITTED]` (PR20-SEC-03 item 1). */
function redactUrl(url: string): string {
  const prefixLength = URL_PREFIX.exec(url)?.[0].length ?? 0;
  const rest = url.slice(prefixLength);
  const queryAt = rest.search(/[?#]/);
  const location = queryAt === -1 ? rest : rest.slice(0, queryAt);
  const pathAt = location.indexOf('/');
  const userinfoEnd = (pathAt === -1 ? location : location.slice(0, pathAt)).lastIndexOf('@');
  const withoutUserinfo = userinfoEnd === -1 ? location : `${REDACTED}${location.slice(userinfoEnd)}`;
  return `${url.slice(0, prefixLength)}${withoutUserinfo}${queryAt === -1 ? '' : `?${OMITTED}`}`;
}

// --- Authorisation schemes -----------------------------------------------------------------------------------------

function keepScheme(_match: string, scheme: string): string {
  return `${scheme} ${REDACTED}`;
}

function redactAuthSchemes(text: string): string {
  return text.replace(PARAMETER_SCHEME, keepScheme).replace(TOKEN68_SCHEME, keepScheme);
}

// --- Pairs ---------------------------------------------------------------------------------------------------------

/** A free-text pair key is sensitive as a whole (`api key`) or by its last segment (`user_pin`, `x-auth`). */
function isSensitivePairKey(key: string): boolean {
  if (isSensitiveKey(key)) return true;
  const segments = key.split(KEY_SEGMENT_SEPARATOR);
  return segments.length > 1 && isSensitiveKey(segments.at(-1) ?? '');
}

/** Cookie and Authorization header values run to the end of the line (`Cookie: a=1; __Host-rt_x=v`, `Digest a=1, b=2`). */
function isLineValuedKey(key: string): boolean {
  const normalised = normaliseKey(key);
  return normalised.includes('cookie') || normalised.includes('authorization');
}

/** End (exclusive) of a `"..."` / `'...'` value: its closing quote, honouring `\x` escapes, or the end of the line. */
function quotedEnd(text: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === quote) return index + 1;
    if (isLineBreak(char)) return index;
    index += char === '\\' ? 2 : 1;
  }
  return text.length;
}

/** Characters after an escaped closing quote (`\"`) that show the value really ended. */
function closesEscapedValue(char: string | undefined): boolean {
  return char === undefined || /[\s,;:&})\]]/.test(char);
}

/**
 * End (exclusive) of a `\"...\"` value (JSON inside a JSON string): the first `\"` followed by a structural character,
 * so a doubly-escaped inner quote (`\\\"x`) does not end it; otherwise the end of the line (fails closed).
 */
function escapedQuotedEnd(text: string, start: number): number {
  const quote = text[start + 1];
  let index = start + 2;
  while (index < text.length) {
    const char = text[index];
    if (isLineBreak(char)) return index;
    if (char === '\\' && text[index + 1] === quote && closesEscapedValue(text[index + 2])) return index + 2;
    index += 1;
  }
  return text.length;
}

/** End (exclusive) of an unquoted value: at `&`, `,`, `;` or a line break; line-valued keys only at a line break. */
function unquotedEnd(text: string, start: number, toLineEnd: boolean): number {
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (isLineBreak(char) || (!toLineEnd && (char === '&' || char === ',' || char === ';'))) return index;
    index += 1;
  }
  return index;
}

/** End index (exclusive) of the value that starts at `start`. */
function valueEnd(text: string, start: number, toLineEnd: boolean): number {
  const first = text[start];
  if (first === '\\' && (text[start + 1] === '"' || text[start + 1] === "'")) return escapedQuotedEnd(text, start);
  if (first === '"' || first === "'") return quotedEnd(text, start, first);
  return unquotedEnd(text, start, toLineEnd);
}

/** Replaces the value of every pair (see KEY_SEPARATOR) whose key is sensitive. */
function redactPairs(text: string): string {
  const pattern = new RegExp(KEY_SEPARATOR.source, 'g');
  let output = '';
  let copied = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const key = match[1] ?? '';
    if (!isSensitivePairKey(key)) continue;
    const start = match.index + match[0].length;
    const end = valueEnd(text, start, isLineValuedKey(key));
    if (end === start) continue;
    output += `${text.slice(copied, start)}${REDACTED}`;
    copied = end;
    pattern.lastIndex = end;
  }
  return copied === 0 ? text : output + text.slice(copied);
}

// --- Words and e-mail addresses ------------------------------------------------------------------------------------

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

/** Position and length of the `@` (or `%40`) of a word that may be an address; undefined when there is none. */
function addressSeparator(word: string): { readonly at: number; readonly length: number } | undefined {
  const plain = word.indexOf('@');
  const encoded = word.indexOf('%40');
  if (plain > 0 && (encoded <= 0 || plain < encoded)) return { at: plain, length: 1 };
  if (encoded > 0) return { at: encoded, length: 3 };
  return undefined;
}

/** `alice@example.com` -> `a***@example.com` (also `%40`); undefined when the word is not an address. */
function maskEmailWord(word: string): { readonly masked: string; readonly domain: string } | undefined {
  const separator = addressSeparator(word);
  if (separator === undefined) return undefined;
  const domain = word.slice(separator.at + separator.length);
  if (!EMAIL_DOMAIN.test(domain)) return undefined;
  const first = String.fromCodePoint(word.codePointAt(0) ?? 42);
  return { masked: `${first}***${word.slice(separator.at, separator.at + separator.length)}${domain}`, domain };
}

function maskEmailInWord(word: string): string {
  return maskEmailWord(word)?.masked ?? word;
}

function redactWord(word: string): string {
  if (SECRET_SHAPE.test(word)) return REDACTED;
  const email = maskEmailWord(word);
  if (email !== undefined) return isSensitiveWord(email.domain) ? REDACTED : email.masked;
  return isSensitiveWord(word) ? REDACTED : word;
}

function maskQuotedLocalParts(text: string): string {
  return text.replace(QUOTED_LOCAL_PART, '"***"');
}

// --- Public string functions ---------------------------------------------------------------------------------------

/**
 * Redacts a free-text string (field values, error messages, stacks), in order: URL userinfo and query strings;
 * authorisation-scheme credentials; values of sensitive pairs; credential-shaped words and words containing a sensitive
 * keyword become REDACTED; e-mail addresses are masked; line breakers are escaped. Capped at MAX_STRING_LENGTH.
 */
export function redactString(value: string): string {
  const { text, truncated } = capped(value);
  const withoutUrls = text.replace(URL_PATTERN, redactUrl);
  const withoutPairs = redactPairs(redactAuthSchemes(withoutUrls));
  const redacted = escapeLineBreakers(maskQuotedLocalParts(withoutPairs).replace(WORD, redactWord));
  return truncated ? redacted + TRUNCATION_SUFFIX : redacted;
}

/** Masks every e-mail address (`alice@example.com` -> `a***@example.com`, AT-US-008-05) and escapes line breakers. */
export function maskEmails(value: string): string {
  const { text, truncated } = capped(value);
  const masked = escapeLineBreakers(maskQuotedLocalParts(text).replace(WORD, maskEmailInWord));
  return truncated ? masked + TRUNCATION_SUFFIX : masked;
}

function hasSecretShapedWord(text: string): boolean {
  return (text.match(WORD) ?? []).some((word) => SECRET_SHAPE.test(word));
}

/**
 * An object key as written to a line (keys may be data, e.g. a map): capped at MAX_KEY_LENGTH; REDACTED_KEY when it
 * holds a credential-shaped word; otherwise with e-mail addresses masked and line breakers escaped.
 */
export function sanitiseKey(key: string): string {
  const head = key.length > MAX_KEY_LENGTH ? key.slice(0, MAX_KEY_LENGTH) : key;
  return hasSecretShapedWord(head) ? REDACTED_KEY : maskEmails(head);
}
