import { describe, expect, it } from '@jest/globals';

import type { Dataset, SeedRow } from './contracts.js';
import { chunk, CHUNK_SIZE, renderChangedCount, renderInsertOnly, renderUpsert, rowsParameter } from './sql.js';

const dataset: Dataset = {
  name: 'countries',
  version: '1',
  table: 'public.countries',
  naturalKey: ['code'],
  columns: ['code', 'name_en', 'source'],
  rows: [{ code: 'US', name_en: 'United States', source: 'ISO' }],
};

describe('renderUpsert', () => {
  const sql = renderUpsert(dataset);

  it('is one parameterised statement: actor and rows, with quoted identifiers and no value in the text', () => {
    expect(sql).toContain('INSERT INTO "public"."countries" AS cur ("code", "name_en", "source", "created_by", "updated_by")');
    expect(sql).toContain('jsonb_populate_recordset(NULL::"public"."countries", $2::pg_catalog.jsonb)');
    expect(sql).toContain('$1::pg_catalog.uuid');
    expect(sql).not.toContain('United States');
  });

  it('writes only on drift, bumps the row version and reports whether the row was inserted', () => {
    expect(sql).toContain('ON CONFLICT ("code") DO UPDATE SET "name_en" = EXCLUDED."name_en", "source" = EXCLUDED."source"');
    expect(sql).toContain('"version" = cur."version" + 1');
    expect(sql).toContain('WHERE (cur."name_en", cur."source") IS DISTINCT FROM (EXCLUDED."name_en", EXCLUDED."source")');
    expect(sql).toContain('RETURNING (cur.xmax = 0) AS inserted');
  });

  it('degrades to DO NOTHING when every column is part of the natural key', () => {
    const keysOnly = renderUpsert({ ...dataset, naturalKey: ['code', 'name_en', 'source'] });
    expect(keysOnly).toContain('DO NOTHING');
    expect(keysOnly).not.toContain('DO UPDATE');
  });

  it('refuses an unvalidated identifier', () => {
    expect(() => renderUpsert({ ...dataset, columns: ['code', 'source', 'x"; DROP TABLE y; --'] })).toThrow(/unvalidated SQL identifier/);
    expect(() => renderUpsert({ ...dataset, table: 'countries' })).toThrow(/unqualified table/);
  });
});

describe('insert-only statements', () => {
  it('inserts new keys only and counts changed existing rows by joining on the natural key', () => {
    expect(renderInsertOnly(dataset)).toContain('ON CONFLICT ("code") DO NOTHING');
    const count = renderChangedCount(dataset);
    expect(count).toContain('JOIN "public"."countries" AS cur ON cur."code" = v."code"');
    expect(count).toContain('IS DISTINCT FROM (v."name_en", v."source")');
    expect(renderChangedCount({ ...dataset, naturalKey: ['code', 'name_en', 'source'] })).toContain('WHERE false');
  });
});

describe('rowsParameter and chunk', () => {
  it('serialises only the dataset columns, in column order, dates as ISO text', () => {
    const row = { source: 'SEED', code: 'X', name_en: 'x', extra: 1, at: new Date('2026-01-01T00:00:00Z') } as unknown as SeedRow;
    const parameter = rowsParameter({ ...dataset, columns: ['code', 'at', 'source'] }, [row]);
    expect(parameter).toBe('[{"code":"X","at":"2026-01-01T00:00:00.000Z","source":"SEED"}]');
  });

  it('chunks at most 500 rows per statement', () => {
    const items = Array.from({ length: 1201 }, (_, index) => index);
    expect(chunk(items).map((part) => part.length)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 201]);
    expect(chunk([])).toEqual([]);
  });
});
