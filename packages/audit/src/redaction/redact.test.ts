/**
 * Audit redaction (REQ-AUDIT-008/009, NFR-PRIV-002; ADR-0007 §Redaction and classification; US-091; TASK-028): the
 * key/value denylist and the registry-driven record redaction. AT-US-091-01/-02/-03 at the unit level; the writer
 * suite proves the same on the row the writer hashes (AT-US-091-05).
 */
import { describe, expect, it } from '@jest/globals';
import type { ClassificationRegistry } from '@platform/shared';
import fc from 'fast-check';

import { PiiValue } from '../entry.js';
import { REDACTED, REDACTED_KEY, SECRET_KEY_EXAMPLES } from './denylist.js';
import { redactRecord, redactSecrets, UnclassifiedFieldError } from './redact.js';
import { REQUIRED_SECRET_STEMS, REQUIRED_SECRET_WORDS, stemSpellings, wordSpellings } from './tests/spellings.js';

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

  it('[PR61-SEC-01] record shapes: a { name, value } header, a [name, value] pair and a credential used as a key', () => {
    expect(redactSecrets({ headers: [{ name: 'X-Api-Key', value: SENTINEL }, ['Authorization', SENTINEL], ['accept', 'json']] })).toEqual({
      headers: [{ name: 'X-Api-Key', value: REDACTED }, ['Authorization', REDACTED], ['accept', 'json']],
    });
    expect(redactSecrets({ key: 'refresh_token', value: SENTINEL })).toEqual({ key: 'refresh_token', value: REDACTED });
    expect(redactSecrets({ sk_live_A1b2C3d4E5f6: 1, whsec_A1b2C3d4E5f6: 2, city: 'Pune' })).toEqual({
      [`${REDACTED_KEY}#1`]: 1,
      // `whsec` is itself a secret word: the key is hidden and its value redacted.
      [`${REDACTED_KEY}#2`]: REDACTED,
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

  /** Generated spellings of every word and stem, plus the examples (PR #61 R1-M1: no hand-picked list alone). */
  const SPELLINGS = [
    ...REQUIRED_SECRET_WORDS.flatMap(wordSpellings),
    ...REQUIRED_SECRET_STEMS.flatMap(stemSpellings),
    ...SECRET_KEY_EXAMPLES,
  ];

  it('for generated spellings of every word and stem of the denylist', () => {
    fc.assert(
      fc.property(tree, fc.constantFrom(...SPELLINGS), fc.array(fc.nat(8), { maxLength: 6 }), (value, secretKey, path) => {
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
    const credential = new PiiValue({
      entityName: 'user',
      field: 'note',
      classification: 'PERSONAL',
      value: 'Bearer abcdefgh1',
      subject: null,
    });
    const when = new Date(0);
    expect(redactSecrets(['Bearer abcdefgh1', credential, 7, true, undefined])).toEqual([REDACTED, REDACTED, 7, true, undefined]);
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

describe('[PR61-SEC-09] secrets inside personal values never reach the vault', () => {
  const registry: ClassificationRegistry = { contacts: { profile: 'PERSONAL', notes: 'SENSITIVE_PERSONAL' } };

  it.each([
    ['a password member', { name: 'Jane', password: SENTINEL }],
    ['an api_key member', { name: 'Jane', api_key: SENTINEL }],
    ['a nested Bearer value', { name: 'Jane', extra: { note: `Bearer ${SENTINEL}0123456789` } }],
    ['a { name, value } header pair', { headers: [{ name: 'X-Api-Key', value: SENTINEL }] }],
  ])('%s: the tokenised text is the redacted JSON', (_label, profile) => {
    const out = redactRecord('contacts', { profile, notes: [profile] }, { subject: null, registry }) as Record<string, PiiValue>;
    for (const field of ['profile', 'notes']) {
      expect(out[field]).toBeInstanceOf(PiiValue);
      expect(out[field]?.value).not.toContain(SENTINEL);
      expect(out[field]?.value).toContain(REDACTED);
    }
  });
});
