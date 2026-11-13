import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { SeedRefusedError, type Dataset, type SeedRow } from './contracts.js';
import { canonicalValue, hashDataset } from './hash.js';

const dataset = (rows: readonly SeedRow[], overrides: Partial<Dataset> = {}): Dataset => ({
  name: 'probe',
  version: '1',
  table: 'public.probe',
  naturalKey: ['code'],
  columns: ['code', 'name_en', 'source'],
  rows,
  ...overrides,
});

const rowArbitrary = fc.record({
  code: fc.string({ minLength: 1, maxLength: 6 }),
  name_en: fc.string({ maxLength: 12 }),
  source: fc.constantFrom('ISO', 'SEED', 'SAMPLE'),
});

const uniqueRows = fc.uniqueArray(rowArbitrary, { selector: (row) => row.code, maxLength: 12 });

describe('hashDataset (canonical content hash)', () => {
  it('is a lower-case hex SHA-256', () => {
    expect(hashDataset(dataset([]))).toMatch(/^[0-9a-f]{64}$/);
  });

  it('property: row order never changes the hash', () => {
    const rowsAndShuffle = uniqueRows.chain((rows) =>
      fc.shuffledSubarray(rows, { minLength: rows.length, maxLength: rows.length }).map((shuffled) => ({ rows, shuffled })),
    );
    fc.assert(
      fc.property(rowsAndShuffle, ({ rows, shuffled }) => {
        expect(hashDataset(dataset(shuffled))).toBe(hashDataset(dataset(rows)));
        expect(hashDataset(dataset([...rows].reverse()))).toBe(hashDataset(dataset(rows)));
      }),
    );
  });

  it('property: column order in the declaration and key order in the rows never change the hash', () => {
    fc.assert(
      fc.property(uniqueRows, (rows) => {
        const reordered = rows.map((row) => ({ source: row.source, name_en: row.name_en, code: row.code }));
        const columns = ['source', 'code', 'name_en'];
        expect(hashDataset(dataset(reordered, { columns }))).toBe(hashDataset(dataset(rows)));
      }),
    );
  });

  it('property: changing any seeded value changes the hash', () => {
    fc.assert(
      fc.property(
        uniqueRows.filter((rows) => rows.length > 0),
        fc.nat(),
        (rows, index) => {
          const target = index % rows.length;
          const changed = rows.map((row, i) => (i === target ? { ...row, name_en: `${row.name_en}!` } : row));
          expect(hashDataset(dataset(changed))).not.toBe(hashDataset(dataset(rows)));
        },
      ),
    );
  });

  it('distinguishes values of different types and structured values by content, not key order', () => {
    const base = (value: SeedRow['x']) =>
      hashDataset(dataset([{ code: 'a', source: 'SEED', x: value }], { columns: ['code', 'source', 'x'] }));
    expect(base(1)).not.toBe(base('1'));
    expect(base(null)).not.toBe(base('null'));
    expect(base(true)).not.toBe(base('true'));
    expect(base(new Date('2026-01-01T00:00:00Z'))).not.toBe(base('2026-01-01T00:00:00.000Z'));
    expect(base({ a: 1, b: [1, 2] })).toBe(base({ b: [1, 2], a: 1 }));
    expect(base(['a', 'b'])).not.toBe(base(['b', 'a']));
  });

  it('depends on the table and the natural key, not on the dataset name or version label', () => {
    const rows: SeedRow[] = [{ code: 'a', name_en: 'A', source: 'ISO' }];
    expect(hashDataset(dataset(rows, { name: 'other', version: '2' }))).toBe(hashDataset(dataset(rows)));
    expect(hashDataset(dataset(rows, { table: 'public.other' }))).not.toBe(hashDataset(dataset(rows)));
    expect(hashDataset(dataset(rows, { naturalKey: ['code', 'name_en'] }))).not.toBe(hashDataset(dataset(rows)));
  });
});

describe('canonicalValue', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['an invalid date', new Date('nope')],
    ['undefined', undefined],
    ['a bigint', 1n],
    ['a nested undefined', { a: undefined }],
  ])('refuses %s with SEED_INVALID_DATASET', (_label, value) => {
    expect(() => canonicalValue(value, 'probe', 'col')).toThrow(SeedRefusedError);
    try {
      canonicalValue(value, 'probe', 'col');
    } catch (error) {
      expect(error).toMatchObject({ code: 'SEED_INVALID_DATASET', subjects: ['probe'] });
    }
  });
});
