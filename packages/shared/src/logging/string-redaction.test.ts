import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';

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

// Timing helpers. Wall-clock assertions are flaky under host load, so the tests below assert growth (linearity) with
// best-of-N medians (scheduler noise only ever raises a ratio) plus a generous absolute ceiling as a catastrophic guard.
const GROWTH_LIMIT = 40; // 16x the input may take at most 40x the time (linear: ~16x; the quadratic re-scan: ~256x)
const CATASTROPHIC_CEILING_MS = 2000;
const perCall = (run: () => void, calls: number): number => {
  const started = performance.now();
  for (let call = 0; call < calls; call += 1) run();
  return (performance.now() - started) / calls;
};
const median = (samples: readonly number[]): number => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)] ?? 0;
/** Best of three rounds of the ratio between medians of the large and the small workload. */
const growthRatio = (small: () => void, large: () => void, smallCalls: number, largeCalls: number): number => {
  perCall(small, smallCalls);
  perCall(large, 2); // warm-up
  const ratios = [0, 1, 2].map(() => {
    const largeTime = median([0, 1, 2, 3, 4].map(() => perCall(large, largeCalls)));
    const smallTime = median([0, 1, 2, 3, 4].map(() => perCall(small, smallCalls)));
    return largeTime / Math.max(smallTime, 1e-6);
  });
  return Math.min(...ratios);
};

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

  it('[PR20-SEC-07] classifies a 1 MiB key from its first MAX_KEY_LENGTH characters, cheaply: cost does not grow with key length', () => {
    const keyOf = (length: number): string => `password${'a'.repeat(length)}`;
    const huge = keyOf(2 ** 20);
    const classify = (key: string) => () => {
      isSensitiveKey(key);
      isOmittedKey(key);
      isPiiKey(key);
    };
    expect(isSensitiveKey(huge)).toBe(true);
    expect(growthRatio(classify(keyOf(2 ** 16)), classify(huge), 64, 8)).toBeLessThanOrEqual(GROWTH_LIMIT);
    expect(perCall(classify(huge), 1)).toBeLessThan(CATASTROPHIC_CEILING_MS);
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

  it.each(['__Host-rt_a1b2', '__host-session', '__Secure-id', '__SECURE-x'])(
    '[PR20-SEC-13 item 1] %s (an RFC 6265bis cookie prefix) is sensitive',
    (key) => {
      expect(isSensitiveKey(key)).toBe(true);
    },
  );

  it.each(['host', 'x__Host-a', '_Host-a', '__Hostname', 'secure_flag'])('%s carries no cookie prefix', (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });

  it('[PR21-SEC-07 (b)] manual_key (the typed TOTP secret) is sensitive; label, rule, message and flag keys are not', () => {
    expect(isSensitiveKey('manual_key')).toBe(true);
    expect(isSensitiveKey('manualKey')).toBe(true);
    for (const key of ['label_key', 'rule_key', 'message_key', 'description_key', 'key']) expect(isSensitiveKey(key)).toBe(false);
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
    // PR #20 R2-m2 / PR20-SEC-14: the platform's own name keys and the IP-bearing keys.
    'display_name',
    'displayName',
    'receiver_name',
    'recipient_name',
    'sender_name',
    'shipper_name',
    'consignee_name',
    'username',
    'user_name',
    'legal_name',
    'client_ip',
    'clientIp',
    'remote_ip',
    'source_ip',
    'user_ip',
    'cf-connecting-ip',
    'true-client-ip',
    'x-forwarded-for',
    'X-Forwarded-For',
    'forwarded',
    'x-real-ip',
    'X-Real-IP',
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
    // R2-m2 negatives: no bare `ip` suffix, and operational names stay readable.
    'carrier_name',
    'service_name',
    'entity_name',
    'event_name',
    'queue_name',
    'relationship',
    'membership',
    'ship',
    'tip',
    'zip_file',
    'forwarded_count',
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
  // fast-check counterexample (seed 615476765): the `apikey` scheme rule took the separator `:` as its credential.
  it.each(['apiKey :', 'apiKey  =', 'APIKEY=', 'apikey\t: '])(
    '%s <value> is a pair, not a scheme with the separator as credential',
    (pair) => {
      const value = sentinel();
      expect(redactString(`${pair}${value} tail`)).not.toContain(value);
    },
  );

  it('property: no sensitive key form x separator form leaks its value', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SENSITIVE_KEY_WORDS),
        fc.constantFrom(...Object.values(KEY_FORMS)),
        pairForms,
        fc.stringMatching(/^[A-Za-z0-9]{1,16}$/),
        // R2-n6: the distinguishing suffix comes from fast-check too, so a reported seed replays the same value.
        fc.stringMatching(/^[0-9a-f]{6}$/),
        fc.constantFrom('', 'login failed ', 'config: ', 'a=1&'),
        (words, form, pair, random, suffix, prefix) => {
          const value = `${random}${suffix}`;
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

describe('string-redaction: raw header lists, cookie prefixes and request targets in text (PR20-SEC-13)', () => {
  /** A raw header list as Node keeps it (`req.rawHeaders`), with run-time sentinels; `secrets` are the four credentials. */
  function rawHeaders(): { readonly raw: string[]; readonly secrets: readonly string[] } {
    const [refresh, apiKey, csrf, quote] = [sentinel(), sentinel(), sentinel(), sentinel()];
    const raw = [
      'Host',
      'api.example',
      'Cookie',
      `theme=dark; __Host-rt_${hex(4)}=${refresh}`,
      'X-Api-Key',
      apiKey,
      'X-CSRF-Token',
      csrf,
      'X-Quote-Token',
      quote,
      'Accept',
      '*/*',
    ];
    return { raw, secrets: [refresh, apiKey, csrf, quote] };
  }

  it('[item 1] a bare __Host-/__Secure- cookie pair and a Set-Cookie value under a neutral key', () => {
    const value = sentinel();
    const name = `__Host-rt_${hex(4)}`;
    expect(redactString(`${name}=${value}; Path=/; Secure; HttpOnly`)).toBe(`${name}=${REDACTED}; Path=/; Secure; HttpOnly`);
    expect(redactString(`set ${name}=${value}`)).toBe(`set ${name}=${REDACTED}`);
    expect(redactString(`__Secure-id=${value}`)).not.toContain(value);
    expect(redactString(`hostname=${value}`)).toBe(`hostname=${value}`);
  });

  it('[item 2] JSON.stringify(rawHeaders): the item after each sensitive name is redacted, the rest stays', () => {
    const { raw, secrets } = rawHeaders();
    const output = redactString(JSON.stringify(raw));
    for (const secret of secrets) expect(output).not.toContain(secret);
    expect(output).toContain(`"Cookie",${REDACTED},"X-Api-Key",${REDACTED},`);
    expect(output).toContain('["Host","api.example",');
    expect(output).toContain('"Accept","*/*"]');
  });

  it('[item 2] util.inspect of the list: one line, one item per line, and column-padded', () => {
    const { raw, secrets } = rawHeaders();
    const short = ['Cookie', `a=${hex(2)}`, 'X-Auth', hex(2), 'Host', 'h', 'Accept', 'a', 'Dnt', '1'];
    const renderings = [inspect(raw), inspect(raw, { breakLength: Infinity }), inspect(short)];
    expect(renderings[0]).toContain(",\n  '");
    for (const rendering of renderings) {
      const output = redactString(rendering);
      for (const secret of secrets) expect(output).not.toContain(secret);
      expect(output).not.toContain(short[1]);
      expect(output).not.toContain(`'${short[3] ?? ''}'`);
    }
    expect(redactString(inspect(raw))).toContain("'Accept',\n  '*/*'");
  });

  it('[item 2] the JSON-escaped list inside a string', () => {
    const { raw, secrets } = rawHeaders();
    const output = redactString(JSON.stringify({ raw: JSON.stringify(raw) }));
    for (const secret of secrets) expect(output).not.toContain(secret);
  });

  it('[item 2] a quoted sensitive word followed by an object key never hides that key from the pair pass', () => {
    const value = sentinel();
    const output = redactString(`{"type":"token","password":"${value}","next":"x"}`);
    expect(output).toBe(`{"type":"token","password":${REDACTED},"next":"x"}`);
  });

  it('[item 2] a list of non-sensitive names keeps every item', () => {
    const list = '["Host","api.example","Accept","*/*","X-Request-Id","r-1"]';
    expect(redactString(list)).toBe(list);
  });

  it('[item 3] a scheme-less request target loses its query, keeps its path', () => {
    const value = sentinel();
    expect(redactString(`GET /api/v1/quotes?ref=${value}&page=2 failed`)).toBe(`GET /api/v1/quotes?${OMITTED} failed`);
    expect(redactString(`target=/x?q=${value}`)).toBe(`target=/x?${OMITTED}`);
    expect(redactString(`(/x/y?q=${value})`)).not.toContain(value);
    expect(redactString(`'/x?q=${value}'`)).toBe(`'/x?${OMITTED}'`);
    expect(redactString(`/x?q=${value}#frag`)).toBe(`/x?${OMITTED}`);
    expect(redactString(`open /app#/track?ref=${value}`)).toBe(`open /app#/track?${OMITTED}`);
  });

  it('[item 3] keeps prose question marks, fragments and relative paths (documented gap) readable', () => {
    expect(redactString('is it /health?')).toBe('is it /health?');
    expect(redactString('see /docs#intro')).toBe('see /docs#intro');
    expect(redactString('a/b?c=1')).toBe('a/b?c=1');
  });

  it('[item 3] a body, URL or query key in free text writes its value as OMITTED (util.inspect of a parsed URL)', () => {
    const value = sentinel();
    const parsed = inspect({ search: `?q=${value}`, query: `q=${value}`, pathname: '/x', href: `/x?q=${value}` });
    const output = redactString(parsed);
    expect(output).not.toContain(value);
    expect(output).toContain(`search: ${OMITTED}`);
    expect(output).toContain(`query: ${OMITTED}`);
    expect(output).toContain("pathname: '/x'");
    expect(redactString(`request url: /x?q=${value}`)).toBe(`request url: ${OMITTED}`);
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
    // PR20-SEC-13: the quoted-list pass, the cookie prefix and the request-target pass.
    ['quoted list item', '"a",'],
    ['sensitive quoted list item', '"token",'],
    ['quoted name, comma and column padding', `'a',${' '.repeat(64)}`],
    ['escaped quoted list item', String.raw`\"a\",`],
    ['quoted name, comma and line break', '"a",\n'],
    ['cookie prefix pair', '__Host-a='],
    ['request target lead', '(/'],
    ['request target, no query', '/a'],
    ['request target with query', '/a?'],
    ['omitted key pair', 'query: '],
  ];

  it.each(families)('%s repeated to 8 KiB is redacted in linear time (16x the input takes at most 40x the time)', (_name, unit) => {
    const repeated = (length: number): string => unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
    const run = (input: string) => () => {
      redactString(input);
      maskEmails(input);
    };
    const large = repeated(MAX_STRING_LENGTH);
    expect(growthRatio(run(repeated(MAX_STRING_LENGTH / 16)), run(large), 32, 4)).toBeLessThanOrEqual(GROWTH_LIMIT);
    expect(perCall(run(large), 1)).toBeLessThan(CATASTROPHIC_CEILING_MS);
  });

  // PR20-SEC-18: quoted sensitive names, each followed by a comma and an escaped quote, whose escaped values close only
  // at the end of the string (`\":`), so every item is an object key. An absolute bound cannot tell this shape apart
  // (the cap keeps the quadratic case near 30 ms), so the test asserts growth: 16x the input may take at most 40x the
  // time (linear: about 11x; the quadratic re-scan: about 100x). The limit is 40 per PR #20 review R4-m1 (D-SEC-PR20-04).
  it('[PR20-SEC-18] list items that close only at the end of the string: 16x the input takes at most 40x the time', () => {
    const unit = String.raw`"token",\"`;
    const closer = String.raw`\":`;
    const shaped = (length: number): string => `${unit.repeat(Math.ceil(length / unit.length)).slice(0, length - closer.length)}${closer}`;
    const small = shaped(MAX_STRING_LENGTH / 16);
    const large = shaped(MAX_STRING_LENGTH);
    expect(redactString(large)).toBe(large); // every item is an object key, so the pair pass sees it unchanged
    expect(
      growthRatio(
        () => redactString(small),
        () => redactString(large),
        64,
        4,
      ),
    ).toBeLessThanOrEqual(GROWTH_LIMIT);
    expect(perCall(() => redactString(large), 1)).toBeLessThan(CATASTROPHIC_CEILING_MS);
  });
});
