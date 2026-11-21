import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import {
  CARRIER_ERROR_CODES,
  canonicalServiceCode,
  CONTENT_TYPES,
  DIRECTIONS,
  DOCUMENT_FORMATS,
  isCarrierCode,
  isSurchargeCode,
  SERVICE_TIERS,
  SURCHARGE_CODES,
  TRACKING_STATUSES,
} from './codes.js';

const REQUIREMENTS = join(import.meta.dirname, '..', '..', '..', '..', 'docs', '01-requirements', 'REQUIREMENTS.md');
const DATA_MODEL = join(import.meta.dirname, '..', '..', '..', '..', 'docs', '03-architecture', 'data-model.md');

/** The row of a requirements table whose first cell is `id`. */
function tableRow(file: string, id: string): string {
  const row = readFileSync(file, 'utf8')
    .split(/\r?\n/u)
    .find((line) => line.startsWith(`| ${id} |`));
  if (row === undefined) throw new Error(`${id} not found in ${file}`);
  return row;
}

/** The comma-separated SCREAMING_SNAKE list after `label:` up to the next full stop or semicolon. */
function listAfter(text: string, label: string): string[] {
  const match = new RegExp(`${label}:\\s*([A-Z_, ]+)[.;]`, 'u').exec(text);
  if (match?.[1] === undefined) throw new Error(`no "${label}:" list`);
  return match[1].split(',').map((entry) => entry.trim());
}

describe('[AT-US-124-05] the canonical catalogue equals DR-B30 and the data-model enums', () => {
  const drB30 = tableRow(REQUIREMENTS, 'DR-B30');

  it('[AT-US-124-05] service tiers, surcharge codes and error codes are exactly the DR-B30 lists', () => {
    expect([...SERVICE_TIERS]).toEqual(listAfter(drB30, 'Service tiers'));
    expect([...SURCHARGE_CODES]).toEqual(listAfter(drB30, 'Surcharges'));
    expect([...CARRIER_ERROR_CODES]).toEqual(listAfter(drB30, 'Errors'));
  });

  it('[AT-US-124-05] tracking statuses, document formats, directions and content types are the data-model enums', () => {
    const enumRow = (name: string): string => {
      const row = readFileSync(DATA_MODEL, 'utf8')
        .split(/\r?\n/u)
        .find((line) => line.startsWith(`| \`${name}\` |`) || line.includes(`/ \`${name}\` |`));
      if (row === undefined) throw new Error(`enum ${name} not found`);
      return row;
    };
    const values = (text: string): string[] => [...text.matchAll(/`([A-Z][A-Z0-9_]+)`/gu)].map((match) => match[1] ?? '');
    expect(values(enumRow('tracking_status'))).toEqual([...TRACKING_STATUSES]);
    const documentRow = values(enumRow('document_format'));
    expect(documentRow.slice(-DOCUMENT_FORMATS.length)).toEqual([...DOCUMENT_FORMATS]);
    const directionRow = values(enumRow('package_type'));
    expect(directionRow.slice(0, DIRECTIONS.length + CONTENT_TYPES.length)).toEqual([...DIRECTIONS, ...CONTENT_TYPES]);
  });
});

describe('canonical service codes (DR-B30: carrier code plus service code)', () => {
  it('joins the carrier code and the upper-cased service code', () => {
    expect(canonicalServiceCode('MOCK', 'EXPRESS')).toBe('MOCK_EXPRESS');
    expect(canonicalServiceCode('DHL_EXPRESS', 'p')).toBe('DHL_EXPRESS_P');
    expect(canonicalServiceCode('FEDEX', 'INTERNATIONAL_PRIORITY')).toBe('FEDEX_INTERNATIONAL_PRIORITY');
  });

  it('refuses shapes that cannot form a code', () => {
    expect(() => canonicalServiceCode('mock', 'EXPRESS')).toThrow('invalid carrier code');
    expect(() => canonicalServiceCode('UPS', '')).toThrow('invalid service code');
    expect(() => canonicalServiceCode('UPS', 'a b')).toThrow('invalid service code');
    expect(() => canonicalServiceCode('UPS', `${'A'.repeat(33)}`)).toThrow('invalid service code');
  });

  it('property: the canonical code always starts with the carrier code and an underscore', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z][A-Z0-9_]{1,31}$/u),
        fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/u),
        (carrier, service) => {
          const code = canonicalServiceCode(carrier, service);
          expect(code.startsWith(`${carrier}_`)).toBe(true);
          expect(code).toBe(code.toUpperCase());
        },
      ),
    );
  });

  it('type guards accept members only', () => {
    expect(isCarrierCode('DHL_EXPRESS')).toBe(true);
    expect(isCarrierCode('dhl')).toBe(false);
    expect(isSurchargeCode('FUEL')).toBe(true);
    expect(isSurchargeCode('fuel')).toBe(false);
    expect(isSurchargeCode(undefined)).toBe(false);
  });
});
