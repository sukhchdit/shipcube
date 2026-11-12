import { describe, expect, it } from '@jest/globals';

import { SeedRefusedError, type Dataset, type SeedRow } from './contracts.js';
import { validateDataset, validateDatasets } from './validate.js';

const rows: SeedRow[] = [
  { code: 'US', name_en: 'United States', source: 'ISO' },
  { code: 'IN', name_en: 'India', source: 'ISO' },
];

const valid: Dataset = {
  name: 'countries',
  version: '1',
  table: 'public.countries',
  naturalKey: ['code'],
  columns: ['code', 'name_en', 'source'],
  rows,
};

function refusal(dataset: Dataset): SeedRefusedError {
  try {
    validateDataset(dataset);
  } catch (error) {
    if (error instanceof SeedRefusedError) return error;
    throw error;
  }
  throw new Error('expected a SeedRefusedError');
}

describe('validateDataset', () => {
  it('accepts a valid dataset, an empty one and a namespaced name', () => {
    expect(() => {
      validateDataset(valid);
      validateDataset({ ...valid, rows: [] });
      validateDataset({ ...valid, name: 'compliance_pack:IN' });
    }).not.toThrow();
  });

  it.each([
    ['a table without a schema', { table: 'countries' }],
    ['an injected table', { table: 'public.countries; DROP TABLE x' }],
    ['an upper-case table', { table: 'public.Countries' }],
    ['an injected column', { columns: ['code', 'source', 'name_en", "x'] }],
    ['a duplicate column', { columns: ['code', 'source', 'code'] }],
    ['a standard column', { columns: ['code', 'source', 'version'] }],
    ['an empty natural key', { naturalKey: [] }],
    ['a natural key outside the columns', { naturalKey: ['alpha3'] }],
    ['a duplicate natural-key column', { naturalKey: ['code', 'code'] }],
    ['columns without source', { columns: ['code', 'name_en'] }],
    ['a bad name', { name: 'Countries!' }],
    ['an empty version', { version: '' }],
  ] as const)('refuses %s with SEED_INVALID_DATASET naming the dataset', (_label, override) => {
    const error = refusal({ ...valid, ...override });
    expect(error.code).toBe('SEED_INVALID_DATASET');
    expect(error.subjects).toEqual([(override as { name?: string }).name ?? 'countries']);
  });

  it('refuses duplicate natural keys without printing row values', () => {
    const error = refusal({ ...valid, rows: [...rows, { code: 'US', name_en: 'Secretland', source: 'ISO' }] });
    expect(error.code).toBe('SEED_INVALID_DATASET');
    expect(error.message).toContain('rows 0 and 2 share a natural key');
    expect(error.message).not.toContain('Secretland');
  });

  it('refuses a row with a missing column, an extra column, a bad source or a null natural key', () => {
    expect(refusal({ ...valid, rows: [{ code: 'US', source: 'ISO' } as unknown as SeedRow] }).message).toContain(
      'no value for column "name_en"',
    );
    expect(refusal({ ...valid, rows: [{ ...rows[0], extra: 1 } as SeedRow] }).message).toContain('"extra"');
    expect(refusal({ ...valid, rows: [{ ...rows[0], source: 'LEGACY' } as unknown as SeedRow] }).message).toContain('invalid source');
    expect(refusal({ ...valid, rows: [{ ...rows[0], code: null } as unknown as SeedRow] }).message).toContain('null natural-key');
  });

  it('refuses a non-finite number in a row', () => {
    const error = refusal({ ...valid, columns: [...valid.columns, 'rank'], rows: [{ ...rows[0], rank: Number.NaN } as SeedRow] });
    expect(error.code).toBe('SEED_INVALID_DATASET');
  });
});

describe('validateDatasets', () => {
  it('refuses two datasets with the same name', () => {
    expect(() => {
      validateDatasets([valid, valid]);
    }).toThrow(/used by another dataset/);
  });
});
