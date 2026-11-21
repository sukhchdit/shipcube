import { createHash } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';
import { money } from '@platform/shared';

import { price } from '../engine.js';
import { marginRules } from '../lines/margin.js';
import { pricingInput } from '../tests/fixtures.js';
import { canonicalJson } from './canonical-json.js';
import { SAMPLE_PRICING_CONFIG, SAMPLE_PRICING_CONFIG_SHA256, SAMPLE_PRICING_CONFIG_VERSION } from './sample.js';

describe('sample pricing configuration (A-060, D-010)', () => {
  const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

  it('pins its content hash: the SHA-256 of its canonical JSON text, as the seed row stores it (D-TASK080-15)', () => {
    expect(SAMPLE_PRICING_CONFIG_SHA256).toBe(sha256(canonicalJson(SAMPLE_PRICING_CONFIG)));
    expect(SAMPLE_PRICING_CONFIG.version).toBe(SAMPLE_PRICING_CONFIG_VERSION);
  });

  it('[R1-m2] a copy built in another key order (as US-152 builds it from rule rows) has the same hash', () => {
    const rebuilt = {
      marginRules: SAMPLE_PRICING_CONFIG.marginRules.map((rule) => ({
        isDefault: rule.isDefault,
        rate: rule.rate,
        serviceCode: rule.serviceCode,
        carrierCode: rule.carrierCode,
        priority: rule.priority,
        ruleKey: rule.ruleKey,
      })),
      version: SAMPLE_PRICING_CONFIG.version,
    };
    expect(JSON.stringify(rebuilt)).not.toBe(JSON.stringify(SAMPLE_PRICING_CONFIG));
    expect(sha256(canonicalJson(rebuilt))).toBe(SAMPLE_PRICING_CONFIG_SHA256);
  });

  it('holds exactly one valid default rule of 15 % at priority -1000, deep-frozen', () => {
    expect(marginRules(SAMPLE_PRICING_CONFIG)).toEqual([
      { ruleKey: 'default-margin', priority: -1000, carrierCode: null, serviceCode: null, rate: { bps: 1500 }, isDefault: true },
    ]);
    expect(Object.isFrozen(SAMPLE_PRICING_CONFIG)).toBe(true);
    expect(Object.isFrozen(SAMPLE_PRICING_CONFIG.marginRules)).toBe(true);
    expect(Object.isFrozen(SAMPLE_PRICING_CONFIG.marginRules[0]?.rate)).toBe(true);
  });

  it('[AT-US-140-01] golden: a 2000 USD Mock cost priced with the sample configuration is MARGIN 300, net 2300', () => {
    const result = price({ ...pricingInput(2000), config: SAMPLE_PRICING_CONFIG });
    expect(result.configVersion).toBe('pricing-2026.11.0');
    expect(result.lines.map((line) => [line.code, line.amount])).toEqual([
      ['BASE_FREIGHT', money(2000, 'USD')],
      ['MARGIN', money(300, 'USD')],
    ]);
    expect(result.totals.net).toEqual(money(2300, 'USD'));
  });
});
