// Unit tests for the in-house Ajv formats (US-034, REQ-API-004, api/README.md §16 item 1).
import { describe, expect, it } from '@jest/globals';
import { Ajv2020 } from 'ajv/dist/2020.js';
import fc from 'fast-check';

import {
  assertKnownFormats,
  CONTRACT_FORMATS,
  isDate,
  isDateTime,
  isEmail,
  isInt32,
  isInt64,
  isUri,
  isUuid,
  registerContractFormats,
} from './formats.js';

describe('contract formats', () => {
  it('date-time accepts RFC 3339 timestamps and rejects impossible ones', () => {
    for (const valid of ['2026-11-13T10:00:00Z', '2024-02-29T23:59:60.123+05:30', '2026-01-01t00:00:00.123456789z']) {
      expect(isDateTime(valid)).toBe(true);
    }
    for (const invalid of [
      '2026-02-29T10:00:00Z',
      '2026-11-13 10:00:00Z',
      '2026-11-13T24:00:00Z',
      '2026-11-13T10:00:00',
      '2026-11-13T10:00:60Z',
      '2026-11-13T10:00:00+24:00',
      `2026-11-13T10:00:00.${'1'.repeat(80)}Z`,
    ]) {
      expect(isDateTime(invalid)).toBe(false);
    }
  });

  it('date-time accepts every ISO string Date produces', () => {
    fc.assert(
      fc.property(fc.date({ min: new Date('1900-01-01'), max: new Date('2999-12-31'), noInvalidDate: true }), (date) =>
        isDateTime(date.toISOString()),
      ),
    );
  });

  it('date checks the calendar, including leap years', () => {
    expect(['2024-02-29', '2000-02-29', '2026-12-31'].every(isDate)).toBe(true);
    expect(['1900-02-29', '2026-04-31', '2026-13-01', '2026-1-01', '2026-11-13T00:00:00Z'].some(isDate)).toBe(false);
  });

  it('uuid accepts any version in either case', () => {
    expect(
      ['0193a5b2-7c1e-7d4a-9f3b-000000000f01', '00000000-0000-0000-0000-000000000000', 'C0FFEE00-1234-4ABC-9DEF-001122334455'].every(
        isUuid,
      ),
    ).toBe(true);
    expect(
      ['0193a5b2-7c1e-7d4a-9f3b-000000000f0', '0193a5b27c1e7d4a9f3b000000000f01', 'g193a5b2-7c1e-7d4a-9f3b-000000000f01'].some(isUuid),
    ).toBe(false);
  });

  it('email accepts dot-atom mailboxes and rejects malformed ones', () => {
    expect(['ada@example.com', 'first.last+tag@sub.example.co.uk', 'x@localhost'].every(isEmail)).toBe(true);
    const invalid = [
      'ada',
      '@example.com',
      'ada@',
      'a@b@example.com',
      '.ada@example.com',
      'ada..x@example.com',
      'ada@-example.com',
      'ada@example..com',
      `${'a'.repeat(65)}@example.com`,
      `a@${'b'.repeat(250)}.com`,
    ];
    expect(invalid.filter(isEmail)).toEqual([]);
  });

  it('uri requires an absolute URI with valid characters and percent-encodings', () => {
    expect(
      [
        'https://docs.platform.invalid/problems/NOT_FOUND',
        'urn:uuid:0193a5b2-7c1e-7d4a-9f3b-000000000f01',
        'https://x.invalid/a%20b?q=1#f',
      ].every(isUri),
    ).toBe(true);
    expect(
      ['/relative/path', 'https://x.invalid/a b', 'https://x.invalid/%zz', '1http://x.invalid', 'https://x.invalid/<script>'].some(isUri),
    ).toBe(false);
  });

  it('int32 and int64 bound integers', () => {
    expect(isInt32(2 ** 31 - 1) && isInt32(-(2 ** 31))).toBe(true);
    expect(isInt32(2 ** 31) || isInt32(1.5)).toBe(false);
    expect(isInt64(Number.MAX_SAFE_INTEGER) && isInt64(-(2 ** 62))).toBe(true);
    expect(isInt64(2 ** 63) || isInt64(0.5) || isInt64(Number.NaN)).toBe(false);
  });

  it('an unknown format fails the setup instead of being ignored', () => {
    expect(() => assertKnownFormats(['uuid', 'hostname', 'ipv4'])).toThrow(/format\(s\) with no validator .*: hostname, ipv4/);
    expect(() => assertKnownFormats(Object.keys(CONTRACT_FORMATS))).not.toThrow();
  });

  it('registers with Ajv strict mode, and Ajv rejects a schema with a format nobody registered', () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    registerContractFormats(ajv);
    const validate = ajv.compile({
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' }, n: { type: 'integer', format: 'int64' } },
    });
    expect(validate({ id: '0193a5b2-7c1e-7d4a-9f3b-000000000f01', n: 3 })).toBe(true);
    expect(validate({ id: 'nope', n: 1.5 })).toBe(false);
    expect(() => ajv.compile({ type: 'string', format: 'hostname' })).toThrow(/unknown format "hostname"/);
  });
});
