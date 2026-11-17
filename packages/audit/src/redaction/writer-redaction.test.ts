/**
 * Redaction on the row the writer hashes and stores (REQ-AUDIT-008, NFR-PRIV-002, DR-A09; US-091; TASK-028):
 * AT-US-091-01/-02 end to end through `prepareEntry` and `computeEntryHash`, and AT-US-091-05 (the entry hash is
 * computed over the redacted content). The database side (the row as stored) is the writer integration suite's.
 */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { type AuditEntryInput, PiiValue, prepareEntry } from '../entry.js';
import { computeEntryHash } from '../entry-hash.js';
import { REDACTED, SECRET_KEY_EXAMPLES } from './denylist.js';

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

describe('[AT-US-091-02] property: denylisted keys at random depth never persist their raw value (writer row)', () => {
  it('holds for every key of the denylist examples', () => {
    const path = fc.array(fc.constantFrom('a', 'b', 'items', 'meta'), { maxLength: 6 });
    fc.assert(
      fc.property(fc.constantFrom(...SECRET_KEY_EXAMPLES), path, fc.constantFrom('oldValue', 'newValue', 'details'), (key, keys, slot) => {
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
