/**
 * Audit redaction (REQ-AUDIT-008/009, NFR-PRIV-002; ADR-0007 §Redaction and classification; US-091; TASK-028): the
 * key/value denylist and the registry-driven record redaction. AT-US-091-01/-02/-03 at the unit level; the writer
 * suite proves the same on the row the writer hashes (AT-US-091-05).
 */
import { describe, expect, it } from '@jest/globals';
import type { ClassificationRegistry } from '@platform/shared';
import fc from 'fast-check';

import { PiiValue } from '../entry.js';
import { isSecretKey, isSecretText, REDACTED, SECRET_KEY_EXAMPLES } from './denylist.js';
import { redactRecord, redactSecrets, UnclassifiedFieldError } from './redact.js';

describe('[REQ-AUDIT-008] the key denylist', () => {
  it.each(SECRET_KEY_EXAMPLES)('"%s" is a secret key', (key) => {
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
    'session_id',
    'ip_coarse',
    '',
  ])('"%s" is not a secret key', (key) => {
    expect(isSecretKey(key)).toBe(false);
  });

  it('matches words in snake, camel, kebab and header spellings, case-insensitively', () => {
    for (const key of [
      'passwordHash',
      'PASSWORD_HASH',
      'x-api-key',
      'X-Api-Key',
      'Set-Cookie',
      'refreshToken',
      'totpSecret',
      'cardNumber',
    ]) {
      expect(isSecretKey(key)).toBe(true);
    }
  });

  it('flags authorisation-shaped values whatever their key', () => {
    for (const value of [
      'Bearer abc.def',
      'bearer x',
      'Basic dXNlcjpwYXNz',
      'Digest username="a"',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
    ]) {
      expect(isSecretText(value)).toBe(true);
    }
    for (const value of ['Pune', 'Bearer', 'eyJ', 'basically fine', '']) expect(isSecretText(value)).toBe(false);
  });
});

describe('[AT-US-091-01] denylisted keys redacted (redactSecrets)', () => {
  it('a password change, TOTP secret, recovery codes, API token and Authorization header become [REDACTED]', () => {
    const captured = {
      password: 'hunter2-raw',
      totp_secret: 'JBSWY3DPEHPK3PXP',
      recovery_codes: ['aaaa-bbbb', 'cccc-dddd'],
      api_token: 'tok_live_raw',
      headers: { Authorization: 'Bearer raw.jwt.value', accept: 'application/json' },
      city: 'Pune',
    };
    expect(redactSecrets(captured)).toEqual({
      password: REDACTED,
      totp_secret: REDACTED,
      recovery_codes: REDACTED,
      api_token: REDACTED,
      headers: { Authorization: REDACTED, accept: 'application/json' },
      city: 'Pune',
    });
  });

  it('null stays null (nothing to hide); a value under a secret key is never read further', () => {
    expect(redactSecrets({ password: null, secret: { nested: 'raw' } })).toEqual({ password: null, secret: REDACTED });
  });

  it('a personal value under a secret key is redacted, not tokenised', () => {
    const marked = new PiiValue({ entityName: 'user', field: 'token', classification: 'PERSONAL', value: 'raw', subject: null });
    expect(redactSecrets({ token: marked })).toEqual({ token: REDACTED });
    expect(redactSecrets([marked])).toEqual([marked]);
  });
});

/** A value no denylist key and no secret-shaped text can produce by accident. */
const SENTINEL = 'S3NTINEL-raw-secret';

describe('[AT-US-091-02] property: each denylisted key at random depth, no raw value survives', () => {
  const plainKey = fc.constantFrom('city', 'items', 'meta', 'data', 'line', 'note', 'n');
  const tree = fc.letrec<{ node: unknown }>((tie) => ({
    node: fc.oneof(
      { depthSize: 'small', withCrossShrink: true },
      fc.constantFrom('x', 1, true, null),
      fc.array(tie('node'), { maxLength: 3 }),
      fc.dictionary(plainKey, tie('node'), { maxKeys: 3 }),
    ),
  })).node;

  /** Places `{ [secretKey]: SENTINEL }` somewhere inside `value` along a random path. */
  function plant(value: unknown, secretKey: string, path: readonly number[]): unknown {
    const [step, ...rest] = path;
    if (step === undefined || value === null || typeof value !== 'object') return { [secretKey]: SENTINEL, wrapped: value };
    if (Array.isArray(value)) {
      const items: readonly unknown[] = value;
      if (items.length === 0) return [{ [secretKey]: SENTINEL }];
      const index = step % items.length;
      return items.map((item, at) => (at === index ? plant(item, secretKey, rest) : item));
    }
    const keys = Object.keys(value);
    if (keys.length === 0) return { [secretKey]: SENTINEL };
    const key = keys[step % keys.length] as string;
    return { ...(value as Record<string, unknown>), [key]: plant((value as Record<string, unknown>)[key], secretKey, rest) };
  }

  it('for every key of the denylist examples', () => {
    fc.assert(
      fc.property(tree, fc.constantFrom(...SECRET_KEY_EXAMPLES), fc.array(fc.nat(8), { maxLength: 6 }), (value, secretKey, path) => {
        const redacted = redactSecrets(plant(value, secretKey, path));
        expect(JSON.stringify(redacted)).not.toContain(SENTINEL);
        expect(JSON.stringify(redacted)).toContain(REDACTED);
      }),
      { numRuns: 400 },
    );
  });
});

describe('[AT-US-091-03] classification tags from the registry (redactRecord)', () => {
  const registry: ClassificationRegistry = {
    users: { id: 'INTERNAL', email: 'PERSONAL', password_hash: 'SECRET', country_code: 'PUBLIC', tax_id: 'SENSITIVE_PERSONAL' },
    addresses: { id: 'INTERNAL', postcode: 'PERSONAL', settings: 'INTERNAL' },
  };
  const subject = { kind: 'USER', refId: '0190c3a4-5b6c-7d8e-9f00-112233445566' } as const;

  it('email PERSONAL and a tax id SENSITIVE_PERSONAL become personal values; password hash SECRET becomes [REDACTED]', () => {
    const out = redactRecord(
      'users',
      { id: 'u-1', email: 'jane@example.com', passwordHash: '$2b$12$raw', countryCode: 'IN', taxId: 'ABCDE1234F' },
      { subject, registry },
    ) as Record<string, unknown>;
    expect(out['id']).toBe('u-1');
    expect(out['country_code']).toBe('IN');
    expect(out['password_hash']).toBe(REDACTED);
    expect(out['email']).toEqual(
      new PiiValue({ entityName: 'users', field: 'email', classification: 'PERSONAL', value: 'jane@example.com', subject }),
    );
    expect(out['tax_id']).toEqual(
      new PiiValue({ entityName: 'users', field: 'tax_id', classification: 'SENSITIVE_PERSONAL', value: 'ABCDE1234F', subject }),
    );
  });

  it('postcode PERSONAL; a number is tokenised as its text; null stays null', () => {
    const out = redactRecord('addresses', { postcode: 411001, id: null }, { subject: null, registry }) as Record<string, unknown>;
    expect(out['postcode']).toEqual(
      new PiiValue({ entityName: 'addresses', field: 'postcode', classification: 'PERSONAL', value: '411001', subject: null }),
    );
    expect(out['id']).toBeNull();
  });

  it('a non-scalar PERSONAL value is tokenised as its JSON text; an INTERNAL object still has its secrets redacted', () => {
    const out = redactRecord(
      'addresses',
      { postcode: { a: 1 }, settings: { apiKey: SENTINEL, theme: 'dark' } },
      { subject: null, registry },
    ) as Record<string, unknown>;
    expect((out['postcode'] as PiiValue).value).toBe('{"a":1}');
    expect(out['settings']).toEqual({ apiKey: REDACTED, theme: 'dark' });
  });

  it('a denylisted key is redacted even when the registry classifies it lower (fail safe)', () => {
    const lax: ClassificationRegistry = { users: { reset_token: 'INTERNAL' } };
    expect(redactRecord('users', { resetToken: SENTINEL }, { subject: null, registry: lax })).toEqual({ reset_token: REDACTED });
  });

  it('[AT-US-091-04] an unclassified field fails closed, naming the entity and the field (never the value)', () => {
    let thrown: unknown;
    try {
      redactRecord('users', { nickname: SENTINEL }, { subject: null, registry });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UnclassifiedFieldError);
    expect((thrown as Error).message).toBe('audited entity users has no classification for field nickname (REQ-AUDIT-009)');
    expect((thrown as Error).message).not.toContain(SENTINEL);
    expect(() => redactRecord('ghosts', { id: 'x' }, { subject: null, registry })).toThrow(
      'audited entity ghosts has no classification for field id',
    );
  });

  it('the platform registry is the default', () => {
    expect(redactRecord('permissions', { key: 'quote:read', description: 'Read quotes' }, { subject: null })).toEqual({
      key: 'quote:read',
      description: 'Read quotes',
    });
  });
});

describe('redaction edge cases (branch coverage of the walks)', () => {
  it('redactSecrets: loose secret text, a credential inside a personal value, scalars and non-plain objects', () => {
    const credential = new PiiValue({ entityName: 'user', field: 'note', classification: 'PERSONAL', value: 'Bearer abc', subject: null });
    const when = new Date(0);
    expect(redactSecrets(['Bearer abc', credential, 7, true, undefined])).toEqual([REDACTED, REDACTED, 7, true, undefined]);
    // A non-plain object is returned as it is; the writer refuses it (INVALID_ENTRY) when it validates the entry.
    expect(redactSecrets({ when })).toEqual({ when });
    expect(redactSecrets(Object.assign(Object.create(null) as object, { secret: 'x' }))).toEqual({ secret: REDACTED });
  });

  it('redactRecord: an undefined field is null, a personal credential is redacted, camelCase keys map to columns', () => {
    const registry: ClassificationRegistry = { users: { email: 'PERSONAL', display_name: 'PUBLIC' } };
    expect(redactRecord('users', { email: 'Basic dXNlcjpwYXNz', displayName: undefined }, { subject: null, registry })).toEqual({
      email: REDACTED,
      display_name: null,
    });
  });
});
