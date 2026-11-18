/**
 * Redaction on the row the writer hashes and stores (REQ-AUDIT-008, NFR-PRIV-002, DR-A09; US-091; TASK-028):
 * AT-US-091-01/-02 end to end through `prepareEntry` and `computeEntryHash`, and AT-US-091-05 (the entry hash is
 * computed over the redacted content). The database side (the row as stored) is the writer integration suite's.
 */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { type AuditEntryInput, PiiValue, prepareEntry } from '../entry.js';
import { computeEntryHash } from '../entry-hash.js';
import { AuditWriteError } from '../errors.js';
import { REDACTED, REDACTED_KEY, SECRET_KEY_EXAMPLES } from './denylist.js';
import { REQUIRED_SECRET_STEMS, REQUIRED_SECRET_WORDS, stemSpellings, wordSpellings } from './tests/spellings.js';

const ORG = '0190c3a4-5b6c-7d8e-9f00-aabbccddeeff';
const USER = '0190c3a4-5b6c-7d8e-9f00-112233445566';
const ID = '0190c3a4-5b6c-7d8e-9f00-000000000001';
const SENTINEL = 'S3NTINEL-raw-secret-value';
const POSITION = { streamSeq: 1, occurredAtMicros: 1_700_000_000_000_000n };
const ZERO = '0'.repeat(64);

const entry = (values: Pick<AuditEntryInput, 'oldValue' | 'newValue' | 'details'>): AuditEntryInput => ({
  action: 'UPDATE',
  outcome: 'SUCCESS',
  entityName: 'user_credential',
  entityId: 'u-1',
  orgId: ORG,
  actor: { type: 'USER', userId: USER },
  origin: { sourceApp: 'api', correlationId: 'corr-redaction-1' },
  ...values,
});

/** The row as the writer would store it (tokens are fixed UUIDs). */
function row(input: AuditEntryInput) {
  const prepared = prepareEntry(input, { id: ID, systemShard: 0 });
  return {
    prepared,
    row: prepared.complete(prepared.piiValues.map((_value, index) => `0190c3a4-5b6c-7d8e-9f00-${String(index).padStart(12, '0')}`)),
  };
}

describe('[AT-US-091-01] the writer stores [REDACTED] for each denylisted value', () => {
  it('password, TOTP secret, recovery codes, API token and Authorization header: no raw value in any column', () => {
    const { row: stored, prepared } = row(
      entry({
        oldValue: { password_hash: `${SENTINEL}-old`, totp_secret: `${SENTINEL}-totp` },
        newValue: { password_hash: `${SENTINEL}-new`, recovery_codes: [`${SENTINEL}-rc`], api_token: `${SENTINEL}-api` },
        details: { headers: { Authorization: `Bearer ${SENTINEL}` }, note: `Bearer ${SENTINEL}-loose` },
      }),
    );
    expect(stored.oldValue).toEqual({ password_hash: REDACTED, totp_secret: REDACTED });
    expect(stored.newValue).toEqual({ api_token: REDACTED, password_hash: REDACTED, recovery_codes: REDACTED });
    expect(stored.details).toEqual({ headers: { Authorization: REDACTED }, note: REDACTED });
    expect(JSON.stringify(stored)).not.toContain(SENTINEL);
    expect(prepared.piiValues).toEqual([]);
  });

  it('a personal value under a secret key, or holding a credential, is redacted and never tokenised', () => {
    const marked = (value: string) => new PiiValue({ entityName: 'user', field: 'name', classification: 'PERSONAL', value, subject: null });
    const { row: stored, prepared } = row(entry({ newValue: { secret: marked('Jane'), name: marked(`Basic ${SENTINEL}`) } }));
    expect(stored.newValue).toEqual({ name: REDACTED, secret: REDACTED });
    expect(prepared.piiValues).toEqual([]);
  });
});

/** Generated spellings of every word and stem (PR #61 R1-M1), plus the examples. */
const SPELLINGS = [
  ...REQUIRED_SECRET_WORDS.flatMap(wordSpellings),
  ...REQUIRED_SECRET_STEMS.flatMap(stemSpellings),
  ...SECRET_KEY_EXAMPLES,
];

describe('[AT-US-091-02] property: denylisted keys at random depth never persist their raw value (writer row)', () => {
  it('holds for generated spellings of every word and stem of the denylist', () => {
    const path = fc.array(fc.constantFrom('a', 'b', 'items', 'meta'), { maxLength: 6 });
    fc.assert(
      fc.property(fc.constantFrom(...SPELLINGS), path, fc.constantFrom('oldValue', 'newValue', 'details'), (key, keys, slot) => {
        let value: Record<string, unknown> = { [key]: SENTINEL, keep: 'visible' };
        for (const step of [...keys].reverse()) value = step === 'items' ? { items: [value] } : { [step]: value };
        const { row: stored } = row(entry({ [slot]: value }));
        const text = JSON.stringify(stored);
        expect(text).not.toContain(SENTINEL);
        expect(text).toContain(REDACTED);
        expect(text).toContain('visible');
      }),
      { numRuns: 300 },
    );
  });
});

describe('[AT-US-091-05] redaction happens before hashing', () => {
  it('the entry hash equals the hash of the explicitly redacted entry, and differs per raw value never', () => {
    const raw = row(entry({ newValue: { password: `${SENTINEL}-1`, city: 'Pune' } })).row;
    const otherSecret = row(entry({ newValue: { password: `${SENTINEL}-2`, city: 'Pune' } })).row;
    const redacted = row(entry({ newValue: { password: REDACTED, city: 'Pune' } })).row;
    const hash = (stored: typeof raw) => computeEntryHash(stored, POSITION, ZERO);
    expect(hash(raw)).toBe(hash(redacted));
    expect(hash(otherSecret)).toBe(hash(raw));
    // Control: a non-secret change does change the hash.
    expect(hash(row(entry({ newValue: { password: REDACTED, city: 'Delhi' } })).row)).not.toBe(hash(raw));
  });
});

/**
 * A PEM private-key block built at run time from parts, so no private-key literal sits in the source or its history
 * (the gitleaks `private-key` rule, PR33-SEC-08). `kind` is `` or e.g. `EC ` / `RSA `.
 */
const pemBlock = (kind: string, body: string): string =>
  `${['-----BEGIN', `${kind}PRIVATE`, 'KEY-----'].join(' ')}\n${body}\n${['-----END', `${kind}PRIVATE`, 'KEY-----'].join(' ')}`;

describe('[PR61-SEC-01] [PR61 R1-m1] the writer row: value shapes, record shapes and credential keys', () => {
  it.each([
    `Bearer\t${SENTINEL}`,
    `  Bearer ${SENTINEL}`,
    `see Authorization: Bearer ${SENTINEL}`,
    `DPoP ${SENTINEL}`,
    `https://app.example.test/invite?token=${SENTINEL}`,
    `sk_live_${SENTINEL}`,
    `otpauth://totp/x?secret=${SENTINEL}`,
    pemBlock('RSA ', SENTINEL),
  ])('a credential-shaped value under an innocuous key: %s', (text) => {
    const { row: stored } = row(entry({ details: { note: text, items: [text] } }));
    expect(stored.details).toEqual({ items: [REDACTED], note: REDACTED });
  });

  it('record shapes and credential keys reach the row redacted', () => {
    const { row: stored } = row(
      entry({
        newValue: {
          headers: [{ name: 'X-Api-Key', value: SENTINEL }, ['X-Reauth-Proof', SENTINEL]],
          setting: { key: 'refresh_token', value: SENTINEL },
          whsec_A1b2C3d4E5f6: 'x',
        },
      }),
    );
    expect(stored.newValue).toEqual({
      headers: [{ name: 'X-Api-Key', value: REDACTED }, ['X-Reauth-Proof', REDACTED]],
      setting: { key: 'refresh_token', value: REDACTED },
      [`${REDACTED_KEY}#1`]: REDACTED,
    });
    expect(JSON.stringify(stored)).not.toContain(SENTINEL);
  });

  it('[dup-review R1-n5] a value under a secret key is never read: a non-JSON value there is stored as [REDACTED], not refused', () => {
    const { row: stored } = row(entry({ details: { password: new Date(0), token: (): number => 1, secret: Symbol('x') } as never }));
    expect(stored.details).toEqual({ password: REDACTED, secret: REDACTED, token: REDACTED });
  });
});

describe('[PR61-SEC-05] the clear-text entity_id never holds a credential', () => {
  it('a JWS-shaped entity id is refused (INVALID_ENTRY entityId); an ordinary id is kept', () => {
    const jws = `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.${SENTINEL}`;
    expect(() => row({ ...entry({}), entityId: jws })).toThrow(AuditWriteError);
    expect(() => row({ ...entry({}), entityId: `sk_live_${SENTINEL}` })).toThrow(AuditWriteError);
    expect(row({ ...entry({}), entityId: 'shp_01J9ZQ' }).row.entityId).toBe('shp_01J9ZQ');
  });
});

describe('[PR61-SEC-09] a credential typed into the reason is tokenised as the marker', () => {
  it('the reason value handed to the tokeniser is [REDACTED]; an ordinary reason is kept', () => {
    const secret = prepareEntry({ ...entry({}), reason: `Bearer ${SENTINEL}0123456789` }, { id: ID, systemShard: 0 });
    expect(secret.piiValues.map((value) => [value.field, value.value])).toEqual([['reason', REDACTED]]);
    const plain = prepareEntry({ ...entry({}), reason: 'customer asked by phone' }, { id: ID, systemShard: 0 });
    expect(plain.piiValues.map((value) => value.value)).toEqual(['customer asked by phone']);
  });
});
