import { randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import {
  BINARY,
  CIRCULAR,
  isOmittedKey,
  isSensitiveKey,
  maskEmails,
  MAX_DEPTH,
  MAX_ITEMS,
  MAX_KEYS,
  MAX_STRING_LENGTH,
  MORE_KEY,
  normaliseKey,
  OMITTED,
  REDACTED,
  redactString,
  redactValue,
  TRUNCATED,
  TRUNCATION_SUFFIX,
  UNREADABLE,
  UNSUPPORTED,
} from './redaction.js';

const hex = (bytes = 8): string => randomBytes(bytes).toString('hex');
const sentinel = (): string => `sentinel-${hex()}`;
const json = (value: unknown): string => JSON.stringify(value);
/** Credential-shaped words built at run time (no secret-shaped literal in the source). */
const jwtShaped = (): string => [`eyJ${hex()}`, `eyJ${hex()}`, hex(16)].join('.');
const gatewayKey = (mode: string): string => ['sk', mode, hex(12)].join('_');

const SENSITIVE_KEYS = [
  'password',
  'newPassword',
  'passwd',
  'passphrase',
  'secret',
  'client_secret',
  'child_secret',
  'token',
  'access_token',
  'refresh_token',
  'x-quote-token',
  'x-reauth-proof',
  'x-api-key',
  'apiKey',
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'totpCode',
  'recoveryCode',
  'cardNumber',
  'privateKey',
  'credentials',
  'stripe-signature',
  'pan',
  'CVC',
  'cvv',
  'otp',
  'pin',
  'ssn',
];

describe('key classification', () => {
  it('normalises keys to lower-case alphanumerics', () => {
    expect(normaliseKey('Set-Cookie')).toBe('setcookie');
    expect(normaliseKey('url.full')).toBe('urlfull');
  });

  it.each(SENSITIVE_KEYS)('%s is sensitive', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(['spinner', 'pane', 'status', 'carrier_code', 'otpEnabled', 'name'])('%s is not sensitive', (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });

  it.each(['body', 'rawBody', 'requestBody', 'response_body', 'payload', 'url', 'url.full', 'url.path', 'url.query'])(
    '%s is omitted',
    (key) => {
      expect(isOmittedKey(key)).toBe(true);
    },
  );

  it.each(['href', 'originalUrl', 'query', 'queryString', 'search'])('%s is omitted', (key) => {
    expect(isOmittedKey(key)).toBe(true);
  });

  it('keeps ordinary keys', () => {
    expect(isOmittedKey('route_template')).toBe(false);
  });
});

describe('redactString', () => {
  it('[AT-US-008-05] masks e-mail addresses as first character, *** and the domain', () => {
    expect(redactString('sent to alice@example.com.')).toBe('sent to a***@example.com.');
    expect(redactString('<bob.smith+x@mail.example.co.uk>')).toBe('<b***@mail.example.co.uk>');
    expect(redactString('user=carol@example.org')).toBe('user=c***@example.org');
  });

  it('leaves words with @ that are not addresses', () => {
    expect(redactString('@platform/shared and a@b')).toBe('@platform/shared and a@b');
  });

  it('redacts an address whose domain carries a sensitive word', () => {
    expect(redactString('x alice@secret-token.example')).toBe(`x ${REDACTED}`);
  });

  it('replaces Bearer and Basic credentials', () => {
    const value = sentinel();
    expect(redactString(`Bearer ${value}`)).toBe(`Bearer ${REDACTED}`);
    expect(redactString(`header basic ${value}, next`)).toBe(`header basic ${REDACTED}, next`);
  });

  it('redacts JWT-shaped words', () => {
    const token = jwtShaped();
    expect(redactString(`got ${token} here`)).toBe(`got ${REDACTED} here`);
  });

  it('redacts payment-gateway key shapes', () => {
    for (const word of [
      gatewayKey('live'),
      gatewayKey('test'),
      `rk_${hex()}`,
      `whsec_${hex()}`,
      `pi_${hex()}_secret_${hex()}`,
      `seti_${hex()}_secret_${hex()}`,
    ]) {
      expect(redactString(`key ${word}`)).toBe(`key ${REDACTED}`);
    }
  });

  it('redacts the value of sensitive key=value, key: value and JSON pairs', () => {
    const value = sentinel();
    expect(redactString(`password=${value}&next=1`)).toBe(`password=${REDACTED}&next=1`);
    // An unquoted sensitive value runs to `&`, `,`, `;` or the end of the line (PR20-SEC-12): multi-word values never leak.
    expect(redactString(`token: ${value} ok`)).toBe(`token: ${REDACTED}`);
    expect(redactString(`{"secret":"${value} with spaces","a":1}`)).toBe(`{"secret":${REDACTED},"a":1}`);
    expect(redactString(`{'pin': '${value}'}`)).toBe(`{'pin': ${REDACTED}}`);
    expect(redactString(`{"secret":"${value} \\" escaped"}`)).toBe(`{"secret":${REDACTED}}`);
    expect(redactString(`api_key=${value}:more`)).toBe(`api_key=${REDACTED}`);
  });

  it('examines a pair whose value is itself a sensitive key', () => {
    const value = sentinel();
    expect(redactString(`a=password=${value}`)).toBe(`a=password=${REDACTED}`);
    expect(redactString(`config: password: ${value}`)).toBe(`config: password: ${REDACTED}`);
  });

  it('keeps non-sensitive pairs and empty values', () => {
    expect(redactString('status=ok code: 42')).toBe('status=ok code: 42');
    expect(redactString('token= ')).toBe('token= ');
  });

  it('redacts words containing a keyword but keeps the bare keyword readable', () => {
    expect(redactString('failed for secret-token-123 now')).toBe(`failed for ${REDACTED} now`);
    expect(redactString('value my_api_token')).toBe(`value ${REDACTED}`);
    expect(redactString('invalid password.')).toBe('invalid password.');
    expect(redactString('token expired; Passwords and tokens')).toBe('token expired; Passwords and tokens');
    expect(redactString('POST /auth/password/reset')).toBe('POST /auth/password/reset');
    expect(redactString('code QUOTE_TOKEN_EXPIRED')).toBe('code QUOTE_TOKEN_EXPIRED');
  });

  it('caps strings at MAX_STRING_LENGTH', () => {
    const output = redactString('a'.repeat(MAX_STRING_LENGTH + 10));
    expect(output).toBe('a'.repeat(MAX_STRING_LENGTH) + TRUNCATION_SUFFIX);
  });

  it.each([
    ['eyJ-', 'eyJ-'],
    ['a', 'a'],
    ['password=', 'password='],
    ['a@', 'a@'],
    ['password: "', 'password: "'],
    ['x'.repeat(63) + ':', 'long keys'],
  ])('a pathological 100 kB input (%s) finishes without catastrophic slowdown', (unit) => {
    const input = unit.repeat(Math.ceil(100_000 / unit.length));
    const started = performance.now();
    redactString(input);
    maskEmails(input);
    expect(performance.now() - started).toBeLessThan(2000); // catastrophic guard only; growth is asserted in string-redaction.test.ts
  });

  it('property: an e-mail address never appears unmasked', () => {
    fc.assert(
      fc.property(
        fc.emailAddress().filter((email) => /^[A-Za-z0-9._%+-]+@/.test(email)),
        fc.string({ maxLength: 20 }),
        (email, noise) => {
          expect(redactString(`${noise} ${email} ${noise}`)).not.toContain(email);
          expect(maskEmails(`${email},${noise}`)).not.toContain(email);
        },
      ),
    );
  });
});

describe('maskEmails', () => {
  it('masks addresses only', () => {
    expect(maskEmails('alice@example.com secret-token-1')).toBe('a***@example.com secret-token-1');
  });

  it('caps long input', () => {
    expect(maskEmails('b'.repeat(MAX_STRING_LENGTH + 1)).endsWith(TRUNCATION_SUFFIX)).toBe(true);
  });
});

describe('redactValue', () => {
  it('redacts sensitive keys whatever the value type and omits bodies and URLs', () => {
    const value = sentinel();
    const output = redactValue({
      password: { nested: value },
      token: [value],
      pin: 1234,
      body: { anything: value },
      'url.full': `https://example.com/?q=${value}`,
      status: 200,
      ok: true,
      note: null,
    });
    expect(output).toEqual({
      password: REDACTED,
      token: REDACTED,
      pin: REDACTED,
      body: OMITTED,
      'url.full': OMITTED,
      status: 200,
      ok: true,
      note: null,
    });
    expect(json(output)).not.toContain(value);
  });

  it('redacts string values and masks e-mail keys', () => {
    expect(redactValue({ 'alice@example.com': 'reach alice@example.com' })).toEqual({
      'a***@example.com': 'reach a***@example.com',
    });
  });

  it('caps depth', () => {
    let nested: unknown = { leaf: 'x' };
    for (let level = 0; level < MAX_DEPTH + 2; level += 1) nested = { next: nested };
    let cursor: unknown = redactValue(nested);
    for (let level = 0; level < MAX_DEPTH; level += 1) cursor = (cursor as Record<string, unknown>)['next'];
    expect(cursor).toBe(TRUNCATED);
  });

  it('caps keys per object and items per array', () => {
    const wide = Object.fromEntries(Array.from({ length: MAX_KEYS + 5 }, (_, index) => [`k${String(index)}`, index]));
    const output = redactValue(wide) as Record<string, unknown>;
    expect(Object.keys(output)).toHaveLength(MAX_KEYS + 1);
    expect(output[MORE_KEY]).toBe('[+5 more]');
    const long = redactValue(Array.from({ length: MAX_ITEMS + 3 }, (_, index) => index)) as unknown[];
    expect(long).toHaveLength(MAX_ITEMS + 1);
    expect(long.at(-1)).toBe('[+3 more]');
  });

  it('bounds the total number of values', () => {
    const grid = Array.from({ length: MAX_ITEMS }, () => Array.from({ length: MAX_ITEMS }, () => 1));
    expect(json(redactValue(grid))).toContain(TRUNCATED);
  });

  it('marks cycles but not shared references', () => {
    const shared = { id: 1 };
    const cyclic: Record<string, unknown> = { a: shared, b: shared };
    cyclic['self'] = cyclic;
    expect(redactValue(cyclic)).toEqual({ a: { id: 1 }, b: { id: 1 }, self: CIRCULAR });
  });

  it('maps special values', () => {
    const output = redactValue({
      buffer: Buffer.from('x'),
      typed: new Uint8Array(2),
      raw: new ArrayBuffer(4),
      fn: () => 1,
      sym: Symbol('s'),
      date: new Date(Date.UTC(2026, 10, 13, 1, 2, 3, 4)),
      invalidDate: new Date(Number.NaN),
      big: 10n,
      map: new Map(),
      set: new Set(),
      list: [undefined, () => 1],
    });
    expect(output).toEqual({
      buffer: BINARY,
      typed: BINARY,
      raw: BINARY,
      date: '2026-11-13T01:02:03.004Z',
      invalidDate: 'Invalid Date',
      big: '10',
      map: UNSUPPORTED,
      set: UNSUPPORTED,
      list: [undefined, undefined],
    });
  });

  it('serialises errors and error-like objects', () => {
    const error = new Error('failed for secret-token-123');
    const output = redactValue({ error, like: { message: 'm', stack: 'S' } }) as Record<string, Record<string, unknown>>;
    expect(output['error']?.['name']).toBe('Error');
    expect(output['error']?.['message']).toBe(`failed for ${REDACTED}`);
    // The stack header is rebuilt from name and message (PR20-SEC-09); `S` has no frames to keep.
    expect(output['like']).toEqual({ name: 'Error', message: 'm', stack: 'Error: m' });
    expect(redactValue({ message: 'plain', count: 1 })).toEqual({ message: 'plain', count: 1 });
  });

  it('never invokes getters and survives hostile proxies', () => {
    let calls = 0;
    const withGetter = {
      visible: 1,
      get hidden(): string {
        calls += 1;
        throw new Error('getter invoked');
      },
    };
    expect(redactValue(withGetter)).toEqual({ visible: 1 });
    expect(calls).toBe(0);
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('trap');
        },
      },
    );
    expect(redactValue({ hostile })).toEqual({ hostile: UNREADABLE });
  });

  it('keeps a __proto__ key as data', () => {
    const parsed: unknown = JSON.parse('{"__proto__":{"polluted":true},"a":1}');
    const output = redactValue(parsed);
    expect(json(output)).toBe('{"__proto__":{"polluted":true},"a":1}');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('property: a sensitive key at any depth never leaks its value', () => {
    const safeKey = fc.string({ minLength: 1, maxLength: 8 }).filter((key) => !isSensitiveKey(key) && !isOmittedKey(key));
    fc.assert(
      fc.property(
        fc.array(safeKey, { maxLength: 7 }),
        fc.constantFrom(...SENSITIVE_KEYS),
        fc.constantFrom('', '_', '-'),
        fc.boolean(),
        fc.constantFrom('string', 'object', 'array'),
        fc.jsonValue({ maxDepth: 2 }),
        (path, key, prefix, upper, shape, noise) => {
          const secret = sentinel();
          const held = shape === 'string' ? secret : shape === 'object' ? { inner: secret } : [1, secret];
          const sensitiveKey = `${prefix}${upper ? key.toUpperCase() : key}`;
          let value: unknown = { [sensitiveKey]: held, noise };
          for (const step of [...path].reverse()) value = { [step]: value, sibling: noise };
          expect(json(redactValue(value))).not.toContain(secret);
        },
      ),
    );
  });
});

describe('redactValue: { name | key, value } records (PR20-SEC-19)', () => {
  it('redacts the value of HAR header records, parsed Set-Cookie and tough-cookie records and { Name, Value } parameters', () => {
    const apiKey = sentinel();
    const proof = sentinel();
    const refresh = sentinel();
    const jar = sentinel();
    const parameter = sentinel();
    const output = redactValue({
      headers: [
        { name: 'X-Api-Key', value: apiKey },
        { name: 'X-Reauth-Proof', value: proof },
        { name: 'Accept', value: 'application/json' },
      ],
      parsed: { name: '__Host-rt_ab12', value: refresh, path: '/', secure: true },
      tough: { key: '__Host-rt_ab12', value: jar, httpOnly: true },
      sdk: [{ Name: 'ClientSecret', Value: parameter }],
    });
    for (const leaked of [apiKey, proof, refresh, jar, parameter]) expect(json(output)).not.toContain(leaked);
    // `name` is itself a PII key, so a record's name is redacted as before (`key` stays readable); a neutral record
    // keeps its value.
    expect(output).toEqual({
      headers: [
        { name: REDACTED, value: REDACTED },
        { name: REDACTED, value: REDACTED },
        { name: REDACTED, value: 'application/json' },
      ],
      parsed: { name: REDACTED, value: REDACTED, path: '/', secure: true },
      tough: { key: '__Host-rt_ab12', value: REDACTED, httpOnly: true },
      sdk: [{ Name: REDACTED, Value: REDACTED }],
    });
  });

  it('classifies by the name like the array pair rule: PII → REDACTED, an omitted key → OMITTED, any key case', () => {
    const value = sentinel();
    expect(redactValue({ NAME: 'email', VALUE: `${value}@example.com` })).toEqual({ NAME: REDACTED, VALUE: REDACTED });
    expect(redactValue({ key: 'query', value })).toEqual({ key: 'query', value: OMITTED });
    expect(redactValue({ Key: 'Authorization', Value: { scheme: 'Bearer', token: value } })).toEqual({
      Key: 'Authorization',
      Value: REDACTED,
    });
    // Both name keys present: the stronger marker wins whatever the key order.
    expect(redactValue({ key: 'query', name: 'password', value })).toEqual({ key: 'query', name: REDACTED, value: REDACTED });
  });

  it('leaves records with a neutral or non-string name, and objects without a value key, as they were', () => {
    expect(redactValue({ name: 'carrier', value: 'DHL' })).toEqual({ name: REDACTED, value: 'DHL' });
    expect(redactValue({ key: 'theme', value: 'dark', count: 2 })).toEqual({ key: 'theme', value: 'dark', count: 2 });
    expect(redactValue({ name: 42, value: 'kept' })).toEqual({ name: REDACTED, value: 'kept' });
    expect(redactValue({ name: 'password', amount: 3 })).toEqual({ name: REDACTED, amount: 3 });
    // A record's name is read as an own data property only: a getter is never invoked.
    let invoked = false;
    const record = Object.defineProperty({ value: 'kept' }, 'name', {
      enumerable: true,
      get: () => {
        invoked = true;
        return 'password';
      },
    });
    expect(redactValue(record)).toEqual({ value: 'kept' });
    expect(invoked).toBe(false);
  });
});
