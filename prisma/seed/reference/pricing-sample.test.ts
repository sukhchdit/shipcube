import { readFileSync } from 'node:fs';

import { describe, expect, it } from '@jest/globals';

import { hashDataset } from '../framework/hash.js';
import { renderInsertOnly, rowsParameter } from '../framework/sql.js';
import { validateDataset } from '../framework/validate.js';
import {
  byteaHex,
  PRICING_SAMPLE_CONTENT_SHA256,
  PRICING_SAMPLE_EFFECTIVE_FROM,
  PRICING_SAMPLE_VERSION_KEY,
  pricingSampleDataset,
} from './pricing-sample.js';

/** The value of `export const <name> = '<literal>';` in a TypeScript source text. */
function literal(source: string, name: string): string | undefined {
  return new RegExp(`export const ${name} = '([^']*)';`, 'u').exec(source)?.[1];
}

describe('sample pricing configuration dataset (TASK-080, data-model §9.2)', () => {
  it('is a valid insert-only, audited dataset of one published SEED row keyed by version_key', () => {
    expect(() => validateDataset(pricingSampleDataset)).not.toThrow();
    expect(pricingSampleDataset).toMatchObject({
      name: 'pricing_config_versions',
      version: PRICING_SAMPLE_VERSION_KEY,
      table: 'public.pricing_config_versions',
      naturalKey: ['version_key'],
      insertOnly: true,
      audited: true,
    });
    expect(pricingSampleDataset.rows).toHaveLength(1);
    expect(pricingSampleDataset.rows[0]).toMatchObject({
      version_key: 'pricing-2026.11.0',
      effective_from: PRICING_SAMPLE_EFFECTIVE_FROM,
      published_at: PRICING_SAMPLE_EFFECTIVE_FROM,
      source: 'SEED',
    });
  });

  it('carries the hash as bytea hex input, which the insert statement types through the table row', () => {
    expect(pricingSampleDataset.rows[0]?.['content_sha256']).toBe(`\\x${PRICING_SAMPLE_CONTENT_SHA256}`);
    const parameter = JSON.parse(rowsParameter(pricingSampleDataset, pricingSampleDataset.rows)) as Record<string, unknown>[];
    expect(parameter[0]).toMatchObject({
      content_sha256: `\\x${PRICING_SAMPLE_CONTENT_SHA256}`,
      effective_from: '2026-11-01T00:00:00.000Z',
    });
    expect(renderInsertOnly(pricingSampleDataset)).toContain('jsonb_populate_recordset(NULL::"public"."pricing_config_versions"');
  });

  it('refuses a digest that is not 64 lower-case hex digits', () => {
    for (const bad of ['', 'AB'.repeat(32), 'ab'.repeat(31), `${'ab'.repeat(32)}0`, 'zz'.repeat(32)]) {
      expect(() => byteaHex(bad)).toThrow('a SHA-256 digest is 64 lower-case hex digits');
    }
  });

  it('pins the dataset hash: any edit of the published row (notes included) needs a new version key', () => {
    // A changed hash for the same version fails the next deploy's seed with SEED_INSERT_ONLY_CHANGED (data-model §9.1).
    expect(hashDataset(pricingSampleDataset)).toBe('f62578cb470bcb5b21bf5e8e3def5ae9391cf12bcbe18b645d04c84c249bbea9');
  });

  it('equals the literals of @platform/pricing (text-level cross-check: neither workspace may import the other)', () => {
    const source = readFileSync(new URL('../../../packages/pricing/src/config/sample.ts', import.meta.url), 'utf8');
    expect(literal(source, 'SAMPLE_PRICING_CONFIG_VERSION')).toBe(PRICING_SAMPLE_VERSION_KEY);
    expect(literal(source, 'SAMPLE_PRICING_CONFIG_SHA256')).toBe(PRICING_SAMPLE_CONTENT_SHA256);
  });
});
