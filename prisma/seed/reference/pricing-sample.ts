/**
 * The sample pricing configuration version (data-model §9.2 `pricing_config_versions`; D-010, A-060, REQ-PRICE-003;
 * US-140, TASK-080): the first reference dataset. One published row, `source: 'SEED'` (ASSUMED seed values, GAP-B-05),
 * whose `content_sha256` is the hash of `SAMPLE_PRICING_CONFIG` in `packages/pricing/src/config/sample.ts`.
 *
 * `prisma` may not import `@platform/pricing` (no workspace manifest change), so the version key and the hash are
 * literals here; `pricing-sample.test.ts` proves they equal the pricing package's literals, which
 * `packages/pricing/src/config/sample.test.ts` proves against the configuration object itself.
 *
 * Insert-only and audited (data-model §9.1): a published version never changes in place. Changing the rules means a new
 * version key, a new hash and a new row here (and a new `version`); the same version with another hash fails the seed
 * with SEED_INSERT_ONLY_CHANGED, and a re-run of an unchanged dataset writes nothing.
 */
import type { Dataset } from '../framework/contracts.js';

/** = `SAMPLE_PRICING_CONFIG_VERSION` of `@platform/pricing`. */
export const PRICING_SAMPLE_VERSION_KEY = 'pricing-2026.11.0';

/** = `SAMPLE_PRICING_CONFIG_SHA256` of `@platform/pricing`: lower-case hex SHA-256 of the configuration's canonical JSON. */
export const PRICING_SAMPLE_CONTENT_SHA256 = 'c4be2d6d710090fc97ee1dfade50085ea09c62c611b12bfc58678dd4495c180b';

/** The instant the sample version takes effect and was published (fixed, so the dataset hash is stable). */
export const PRICING_SAMPLE_EFFECTIVE_FROM = new Date('2026-11-01T00:00:00.000Z');

/** A lower-case hex digest as the PostgreSQL bytea hex input (`\x…`) that `jsonb_populate_recordset` parses. */
export const byteaHex = (hex: string): string => {
  if (!/^[0-9a-f]{64}$/u.test(hex)) throw new Error('a SHA-256 digest is 64 lower-case hex digits');
  return `\\x${hex}`;
};

export const pricingSampleDataset: Dataset = Object.freeze({
  name: 'pricing_config_versions',
  version: PRICING_SAMPLE_VERSION_KEY,
  table: 'public.pricing_config_versions',
  naturalKey: Object.freeze(['version_key']),
  columns: Object.freeze(['version_key', 'effective_from', 'published_at', 'content_sha256', 'source', 'notes']),
  rows: Object.freeze([
    Object.freeze({
      version_key: PRICING_SAMPLE_VERSION_KEY,
      effective_from: PRICING_SAMPLE_EFFECTIVE_FROM,
      published_at: PRICING_SAMPLE_EFFECTIVE_FROM,
      content_sha256: byteaHex(PRICING_SAMPLE_CONTENT_SHA256),
      source: 'SEED',
      notes: 'Sample configuration (A-060, ASSUMED seed): one default margin rule of 15 %, priority -1000.',
    }),
  ]),
  insertOnly: true,
  audited: true,
});
