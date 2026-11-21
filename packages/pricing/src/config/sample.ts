/**
 * The sample pricing configuration (D-010, ADR-0015 §4 and §7, A-060, REQ-PRICE-003; US-140, TASK-080): configuration as
 * versioned seed data until US-152 seeds the rule tables and the M2 pricing admin replaces it. Values are ASSUMED seed
 * data (GAP-B-05): one default margin rule of 15 % over carrier cost, priority -1000, matching everything.
 *
 * The reference seed writes the row of this version into `pricing_config_versions`
 * (`prisma/seed/reference/pricing-sample.ts`) with `content_sha256` = {@link SAMPLE_PRICING_CONFIG_SHA256}, the SHA-256
 * of `JSON.stringify(SAMPLE_PRICING_CONFIG)`. Both literals are pinned by tests: a rule change here needs a new version
 * key and a new hash, because a published version is insert-only (data-model §9.1).
 */
import type { PricingConfigSnapshot } from '../types.js';

export const SAMPLE_PRICING_CONFIG_VERSION = 'pricing-2026.11.0';

export const SAMPLE_PRICING_CONFIG: PricingConfigSnapshot = Object.freeze({
  version: SAMPLE_PRICING_CONFIG_VERSION,
  marginRules: Object.freeze([
    Object.freeze({
      ruleKey: 'default-margin',
      priority: -1000,
      carrierCode: null,
      serviceCode: null,
      rate: Object.freeze({ bps: 1500 }),
      isDefault: true,
    }),
  ]),
});

/** Lower-case hex SHA-256 of `JSON.stringify(SAMPLE_PRICING_CONFIG)` (config/sample.test.ts). */
export const SAMPLE_PRICING_CONFIG_SHA256 = 'b56b94db94655393ce39a4bfe16b3aef857d68249705a6949167080edfdb1436';
