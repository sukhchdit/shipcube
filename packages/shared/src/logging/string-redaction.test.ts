import { randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import {
  escapeLineBreakers,
  isOmittedKey,
  isPiiKey,
  isSensitiveChildKey,
  isSensitiveKey,
  maskEmails,
  MAX_STRING_LENGTH,
  normaliseKey,
  OMITTED,
  REDACTED,
  REDACTED_KEY,
  redactString,
  sanitiseKey,
} from './string-redaction.js';

const hex = (bytes = 8): string => randomBytes(bytes).toString('hex');
/** Alphanumeric sentinel built at run time (no secret-shaped literal in the source). */
const sentinel = (): string => `sentinel${hex()}`;
const jwtShaped = (): string => [`eyJ${hex()}`, `eyJ${hex()}`, hex(16)].join('.');
const gatewayKey = (): string => ['sk', 'live', hex(12)].join('_');
const char = (code: number): string => String.fromCharCode(code);
const NBSP = char(0xa0);

/** Sensitive keys as word lists, rendered below as snake, camel, kebab, upper and space-separated forms. */
const SENSITIVE_KEY_WORDS: readonly (readonly string[])[] = [
  ['password'],
  ['new', 'password'],
  ['passcode'],
  ['pwd'],
  ['client', 'secret'],
  ['access', 'token'],
  ['x', 'quote', 'token'],
  ['x', 'reauth', 'proof'],
  ['x', 'api', 'key'],
  ['api', 'key'],
  ['private', 'key'],
  ['secret', 'key'],
  ['proxy', 'authorization'],
  ['cookie'],
  ['set', 'cookie'],
  ['otp', 'code'],
  ['mfa', 'code'],
  ['verification', 'code'],
  ['security', 'code'],
  ['recovery', 'code'],
  ['card', 'number'],
  ['cvv2'],
  ['jwt'],
  ['private', 'jwk'],
  ['dsn'],
  ['connection', 'string'],
  ['code', 'verifier'],
  ['session', 'id'],
  ['otp'],
  ['pin'],
  ['pass'],
  ['sid'],
  ['session'],
  ['auth'],
  ['ssn'],
];

const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);
const KEY_FORMS: Readonly<Record<string, (words: readonly string[]) => string>> = {
  snake: (words) => words.join('_'),
  camel: (words) => words.map((word, index) => (index === 0 ? word : capitalise(word))).join(''),
  kebab: (words) => words.join('-'),
  upper: (words) => words.join('_').toUpperCase(),
  space: (words) => words.join(' '),
};

const blanks = fc.array(fc.constantFrom(' ', '\t', NBSP), { maxLength: 16 }).map((run) => run.join(''));

/** Separator forms: `key=v`, `key : v` with blanks, JSON, escaped JSON, next line, Joi. */
const pairForms = fc.oneof(
  fc.constant((key: string, value: string) => `${key}=${value}`),
  fc.tuple(blanks, blanks).map(
    ([before, after]) =>
      (key: string, value: string) =>
        `${key}${before}:${after}${value}`,
  ),
  fc.tuple(blanks, blanks).map(
    ([before, after]) =>
      (key: string, value: string) =>
        `{"${key}"${before}:${after}"${value}"}`,
  ),
  fc.constant((key: string, value: string) => String.raw`{\"${key}\":\"${value}\"}`),
  fc.constantFrom('\n', '\r\n').map((lineBreak) => (key: string, value: string) => `${key}:${lineBreak}    ${value}`),
  fc.constant((key: string, value: string) => `"${key}" with value "${value}"`),
);

describe('string-redaction: key classes', () => {
  it('folds full-width keys with NFKC before comparing', () => {
    const fullWidth = [...'password'].map((letter) => char(letter.charCodeAt(0) + 0xfee0)).join('');
    expect(normaliseKey(fullWidth)).toBe('password');
    expect(isSensitiveKey(fullWidth)).toBe(true);
  });

  it('[PR20-SEC-07] classifies a 1 MiB key from its first MAX_KEY_LENGTH characters, cheaply', () => {
    const huge = `password${'a'.repeat(2 ** 20)}`;
    const started = performance.now();
    expect(isSensitiveKey(huge)).toBe(true);
    isOmittedKey(huge);
    isPiiKey(huge);
    expect(performance.now() - started).toBeLessThan(50);
  });

  it.each(['otpCode', 'mfa_code', 'verificationCode', 'passcode', 'pwd', 'jwt', 'privateJwk', 'dsn', 'connectionString'])(
    '[PR20 m4 / PR20-SEC-02] %s is sensitive',
    (key) => {
      expect(isSensitiveKey(key)).toBe(true);
    },
  );

  it.each(['proof', 'code_verifier', 'securityCode', 'cvv2', 'cvc2', 'sessionId', 'pass', 'sid', 'session', 'auth', 'otp'])(
    '[PR20-SEC-02] %s is sensitive',
    (key) => {
      expect(isSensitiveKey(key)).toBe(true);
    },
  );

  it.each(['footprint', 'bypass', 'sidebar', 'author', 'fullName', 'email', 'number'])('%s is not a credential key', (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });

  it.each([
    ['card', 'number'],
    ['paymentMethod', 'expMonth'],
    ['credit_card', 'exp_year'],
    ['payment-card', 'cvc'],
    ['card', 'cvv'],
  ])('[PR20-SEC-02 item 3] %s.%s is card data', (parent, key) => {
    expect(isSensitiveChildKey(parent, key)).toBe(true);
  });

  it.each([
    ['shipment', 'number'],
    ['card', 'brand'],
    ['card', 'last4'],
    ['address', 'expiry'],
  ])('%s.%s is not card data', (parent, key) => {
    expect(isSensitiveChildKey(parent, key)).toBe(false);
  });

  it.each([
    'fullName',
    'personName',
    'attention_name',
    'contactName',
    'firstName',
    'lastName',
    'givenName',
    'familyName',
    'surname',
    'companyName',
    'requestorName',
    'phoneNumber',
    'mobile',
    'fax',
    'email',
    'addressLine1',
    'streetLines',
    'postalCode',
    'postcode',
    'zipCode',
    'taxId',
    'vatNumber',
    'vat_id',
    'gstin',
    'registrationNumber',
    'dateOfBirth',
    'birthDate',
    'passportNumber',
    'nationalId',
    'name',
    'ip',
    'zip',
    'tin',
    'tins',
    'vat',
    'ein',
    'iec',
    'dob',
  ])('[PR20-SEC-02 item 1] %s is a PII key', (key) => {
    expect(isPiiKey(key)).toBe(true);
    expect(isSensitiveKey(key)).toBe(false);
  });

  it.each([
    'method',
    'route',
    'route_template',
    'status',
    'duration_ms',
    'port',
    'error',
    'event',
    'carrier_code',
    'account_id',
    'operation',
    'error_code',
    'correlation_id',
    'request_id',
    'client_correlation_id',
    'sql_state',
    'queue',
    'job_name',
    'job_id',
    'reason',
    'count',
    'origin',
    'host',
    'provider',
    'entity',
    'window',
    'threshold',
    'used',
    'quota',
    'share_pct',
    'code',
    'kind',
    'stack',
    'message',
    'version',
    'service',
    'level',
    'timestamp',
    'org_id',
    'actor_id',
    'destination',
    'private',
    'piece',
    'gzip',
  ])('%s is not a PII key', (key) => {
    expect(isPiiKey(key)).toBe(false);
  });

  it('accepts that distinct_address_count matches the PII part `address` (fails closed)', () => {
    expect(isPiiKey('distinct_address_count')).toBe(true);
  });

  it.each(['rawHeaders', 'rawTrailers', '_parsedUrl', 'labelUrl', 'redirectUri', 'documentUrl', 'trackingLink', 'self_href'])(
    '[PR20-SEC-01 item 3 / PR20-SEC-03 item 2] %s is omitted',
    (key) => {
      expect(isOmittedKey(key)).toBe(true);
    },
  );
});

describe('string-redaction: sensitive pairs in free text', () => {
  it('property: no sensitive key form x separator form leaks its value', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SENSITIVE_KEY_WORDS),
        fc.constantFrom(...Object.values(KEY_FORMS)),
        pairForms,
        fc.stringMatching(/^[A-Za-z0-9]{1,16}$/),
        fc.constantFrom('', 'login failed ', 'config: ', 'a=1&'),
        (words, form, pair, random, prefix) => {
          const value = `${random}${hex(6)}`;
          const output = redactString(`${prefix}${pair(form(words), value)} tail`);
          expect(output).not.toContain(value);
        },
      ),
    );
  });

  it('property: a non-sensitive key keeps its value in every separator form', () => {
    fc.assert(
      fc.property(fc.constantFrom('status', 'carrier', 'route', 'operation', 'count'), pairForms, (key, pair) => {
        const value = hex();
        expect(redactString(pair(key, value))).toContain(value);
      }),
    );
  });

  it('[PR20 m4 (a)] more than three blanks or an NBSP around the separator', () => {
    const value = sentinel();
    expect(redactString(`password:    ${value}`)).toBe(`password:    ${REDACTED}`);
    expect(redactString(`password${' '.repeat(16)}:${' '.repeat(16)}${value}`)).not.toContain(value);
    expect(redactString(`password${NBSP}=${NBSP}${value}`)).not.toContain(value);
    expect(redactString(`password: ${' '.repeat(40)}${value}`)).not.toContain(value);
  });

  it('[PR20 m4 (b)] the value on the next line', () => {
    const value = sentinel();
    expect(redactString(`password:\n  ${value}\nnext: 1`)).toBe(`password:\n  ${REDACTED}\nnext: 1`);
    expect(redactString(`secret =\r\n\t${value}`)).not.toContain(value);
  });

  it('[PR20 m4 (c) / PR20-SEC-01 item 4] a Cookie line with the refresh cookie second redacts to the end of the line', () => {
    const session = sentinel();
    const refresh = sentinel();
    const line = `Cookie: theme=dark; sid=${session}; __Host-rt_${hex(4)}=${refresh}\nAccept: */*`;
    expect(redactString(line)).toBe(`Cookie: ${REDACTED}\nAccept: */*`);
    const setCookie = redactString(`set-cookie: a=1; Path=/, __Host-rt_x=${refresh}; HttpOnly`);
    // `set-cookie` is itself more than the keyword `cookie`, so the word pass redacts the name too (fails closed).
    expect(setCookie).toBe(`${REDACTED}: ${REDACTED}`);
    expect(redactString(`{"cookie":"a=1; rt=${refresh}","ok":1}`)).toBe(`{"cookie":${REDACTED},"ok":1}`);
  });

  it('[PR20 m4 (d) / PR20-SEC-12] escaped JSON inside a string', () => {
    const value = sentinel();
    expect(redactString(String.raw`{\"password\":\"${value}\"}`)).toBe(String.raw`{\"password\":${REDACTED}}`);
    const inner = String.raw`{\"password\":\"a\\\"${value}\",\"x\":1}`;
    expect(redactString(inner)).toBe(String.raw`{\"password\":${REDACTED},\"x\":1}`);
  });

  it('[PR20 m4 (e)] a two-word key such as API key', () => {
    const value = sentinel();
    expect(redactString(`API key: ${value}`)).toBe(`API key: ${REDACTED}`);
    expect(redactString(`Private Key = ${value}`)).toBe(`Private Key = ${REDACTED}`);
    expect(redactString(`the secret key: ${value}`)).toBe(`the secret key: ${REDACTED}`);
    expect(redactString(`user pin: ${value}`)).toBe(`user pin: ${REDACTED}`);
  });

  it('[PR20-SEC-12] a multi-word unquoted value ends at & , ; or the line end, not at a blank', () => {
    const value = sentinel();
    expect(redactString(`password=correct horse ${value}&next=1`)).toBe(`password=${REDACTED}&next=1`);
  });

  it('[PR20-SEC-12] the Joi "<key>" with value "<v>" form', () => {
    const value = sentinel();
    expect(redactString(`"password" with value "${value}" fails to match the required pattern`)).toBe(
      `"password" with value ${REDACTED} fails to match the required pattern`,
    );
  });
});

describe('string-redaction: authorisation schemes', () => {
  it.each(['Bearer', 'basic', 'DPoP', 'NTLM', 'apikey', 'Token', 'Negotiate'])('[PR20-SEC-01 item 5] %s credential', (scheme) => {
    const value = sentinel();
    expect(redactString(`header ${scheme} ${value}, next`)).toBe(`header ${scheme} ${REDACTED}, next`);
  });

  it.each([
    ['Digest', (value: string) => `username="u", realm="r", nonce="n", uri="/", response="${value}"`],
    ['HOBA', (value: string) => `result="${value}"`],
    ['AWS4-HMAC-SHA256', (value: string) => `Credential=${value}/x, SignedHeaders=host, Signature=${value}`],
  ])('[PR20 m4 (f) / PR20-SEC-01 item 5] %s parameter list is redacted to the end of the line', (scheme, parameters) => {
    const value = sentinel();
    expect(redactString(`${scheme} ${parameters(value)}\nnext`)).toBe(`${scheme} ${REDACTED}\nnext`);
    expect(redactString(`Authorization: ${scheme} ${parameters(value)}`)).toBe(`Authorization: ${REDACTED}`);
  });

  it('keeps English uses of token, negotiate and digest readable', () => {
    expect(redactString('token expired; negotiate later')).toBe('token expired; negotiate later');
    expect(redactString('digest mismatch for file')).toBe('digest mismatch for file');
  });
});

describe('string-redaction: URLs', () => {
  it('[PR20-SEC-03 item 1] a connection URI with a dotless host loses its userinfo', () => {
    const value = sentinel();
    expect(redactString(`connect postgres://app:${value}@db:5432/platform failed`)).toBe(
      `connect postgres://${REDACTED}@db:5432/platform failed`,
    );
    expect(redactString(`ssh://${value}@host/x`)).toBe(`ssh://${REDACTED}@host/x`);
    expect(redactString(String.raw`\"redis:\/\/u:${value}@cache:6379\/0\"`)).not.toContain(value);
  });

  it('[PR20-SEC-03 item 1] a query string or fragment never survives', () => {
    const value = sentinel();
    expect(redactString(`GET https://carrier.example/track?recipientPhone=${value}&x=1 -> 500`)).toBe(
      `GET https://carrier.example/track?${OMITTED} -> 500`,
    );
    expect(redactString(`see http://a.example/p#${value}`)).toBe(`see http://a.example/p?${OMITTED}`);
  });

  it('keeps stack-frame file URLs readable', () => {
    expect(redactString('at run (file:///app/dist/main.js:12:3)')).toBe('at run (file:///app/dist/main.js:12:3)');
  });
});

describe('string-redaction: e-mail addresses', () => {
  it('[PR20 m4 (g)] masks an IDN address', () => {
    expect(redactString('to alice@exämple.com.')).toBe('to a***@exämple.com.');
    expect(maskEmails('alice@例え.テスト')).toBe('a***@例え.テスト');
  });

  it('[PR20-SEC-03 item 3] masks a %40-encoded address', () => {
    expect(redactString('to alice%40example.com')).toBe('to a***%40example.com');
    expect(maskEmails('alice%40example.com')).toBe('a***%40example.com');
  });

  it('[PR20 m4 (h)] masks a quoted local part', () => {
    expect(redactString('to "alice smith"@example.com')).toBe('to "***"@example.com');
    expect(maskEmails('"alice smith"@example.com')).toBe('"***"@example.com');
  });
});

describe('string-redaction: line integrity and keys', () => {
  const controls = [0x7f, 0x80, 0x85, 0x9b, 0x9f, 0x2028, 0x2029];

  it('[PR20-SEC-08 (a)] escapeLineBreakers writes DEL, C1 controls, U+2028 and U+2029 as visible escapes', () => {
    const input = controls.map((code) => `x${char(code)}`).join('');
    const expected = controls.map((code) => `x\\u${code.toString(16).padStart(4, '0')}`).join('');
    expect(escapeLineBreakers(input)).toBe(expected);
    expect(escapeLineBreakers('plain é ü ✓')).toBe('plain é ü ✓');
  });

  it('[PR20-SEC-08 (a)] redactString, maskEmails and sanitiseKey escape them as the final step', () => {
    for (const code of controls) {
      const raw = `a${char(code)}b`;
      const escaped = `a\\u${code.toString(16).padStart(4, '0')}b`;
      expect(redactString(raw)).toBe(escaped);
      expect(maskEmails(raw)).toBe(escaped);
      expect(sanitiseKey(raw)).toBe(escaped);
    }
  });

  it('[PR20 n1] writes a JWT- or gateway-key-shaped key as REDACTED_KEY', () => {
    expect(sanitiseKey(jwtShaped())).toBe(REDACTED_KEY);
    expect(sanitiseKey(gatewayKey())).toBe(REDACTED_KEY);
    expect(sanitiseKey(`Bearer ${jwtShaped()}`)).toBe(REDACTED_KEY);
    expect(sanitiseKey('alice@example.com')).toBe('a***@example.com');
    expect(sanitiseKey('carrier_code')).toBe('carrier_code');
  });
});

describe('string-redaction: linear time', () => {
  const families: readonly (readonly [string, string])[] = [
    ['a://', 'a://'],
    ['a@', 'a@'],
    ['password: + 16 blanks', `password:${' '.repeat(16)}`],
    ['password + 16 blanks', `password${' '.repeat(16)}`],
    ['escaped quote', String.raw`\"`],
    ['password escaped quote', String.raw`password:\"`],
    ['cookie=', 'cookie='],
    ['digest ', 'digest '],
    ['digest a=', 'digest a='],
    ['token + blank', 'token '],
    ['%40', '%40'],
    ['a%40', 'a%40'],
    ['quoted local part', `"${'x'.repeat(64)}`],
    ['two-word keys', 'ab cd '],
    ['long key run', `${'x'.repeat(63)} `],
    ['next-line separator', 'password:\n'],
    ['with value', '"k" with value '],
    ['NBSP', NBSP],
  ];

  it.each(families)('%s repeated to 8 KiB is redacted in < 50 ms', (_name, unit) => {
    const input = unit.repeat(Math.ceil(MAX_STRING_LENGTH / unit.length)).slice(0, MAX_STRING_LENGTH);
    const started = performance.now();
    redactString(input);
    maskEmails(input);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
