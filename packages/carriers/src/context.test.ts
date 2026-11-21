import { describe, expect, it } from '@jest/globals';

import { accountRefIssues, contextIssues, createCarrierContext } from './context.js';
import { CarrierContractError } from './errors.js';

const account = { id: 'acct-1', code: 'DHL_PLATFORM_SANDBOX', carrierCode: 'DHL_EXPRESS', environment: 'sandbox' } as const;
const input = { account, correlationId: 'corr-0123456789', deadlineAt: new Date('2026-11-19T12:00:04Z') };

describe('CarrierContext', () => {
  it('copies the environment from the account and defaults the locale to en', () => {
    const ctx = createCarrierContext(input);
    expect(ctx).toEqual({ account, environment: 'sandbox', correlationId: 'corr-0123456789', locale: 'en', deadlineAt: input.deadlineAt });
    expect(ctx.deadlineAt).not.toBe(input.deadlineAt);
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.account)).toBe(true);
    expect('mockScenario' in ctx).toBe(false);
  });

  it('keeps an explicit locale and a Mock scenario directive', () => {
    const ctx = createCarrierContext({ ...input, locale: 'fr', mockScenario: 'latency=6000' });
    expect(ctx.locale).toBe('fr');
    expect(ctx.mockScenario).toBe('latency=6000');
  });

  it('drops any extra property of the account reference (no credential can ride along)', () => {
    const ctx = createCarrierContext({ ...input, account: { ...account, secretRef: 'env:CARRIER_DHL', apiKey: 'x' } as typeof account });
    expect(Object.keys(ctx.account).sort()).toEqual(['carrierCode', 'code', 'environment', 'id']);
  });

  it('names every defect of the input', () => {
    try {
      createCarrierContext({
        account: { id: '', code: 'lower', carrierCode: 'x', environment: 'live' as 'sandbox' },
        correlationId: 'short',
        deadlineAt: new Date(Number.NaN),
        locale: 'english',
        mockScenario: 'x'.repeat(513),
      });
      throw new Error('expected a CarrierContractError');
    } catch (error) {
      expect(error).toBeInstanceOf(CarrierContractError);
      expect((error as CarrierContractError).issues).toEqual([
        'account.id must be 1..64 characters of [A-Za-z0-9-]',
        'account.code must match ^[A-Z][A-Z0-9_]{1,63}$',
        'account.carrierCode must match ^[A-Z][A-Z0-9_]{1,31}$',
        'account.environment must be "sandbox" or "production"',
        'correlationId must match the ADR-0016 §15 pattern',
        'deadlineAt must be a valid Date',
        'locale must be a language tag such as "en" or "en-US"',
        'mockScenario must be a string of at most 512 characters',
      ]);
    }
  });

  it('accountRefIssues refuses a non-object', () => {
    expect(accountRefIssues(undefined)).toEqual(['account must be an object']);
  });

  it('contextIssues checks the carrier, the environment pairing and the correlation ID', () => {
    const ctx = createCarrierContext(input);
    expect(contextIssues(ctx, 'DHL_EXPRESS')).toEqual([]);
    expect(contextIssues(ctx, 'UPS')).toEqual(['context account belongs to carrier DHL_EXPRESS, not UPS']);
    expect(contextIssues({ ...ctx, environment: 'production' }, 'DHL_EXPRESS')).toEqual([
      'context environment differs from the account environment',
    ]);
    expect(contextIssues({ ...ctx, account: {} }, 'DHL_EXPRESS')).toHaveLength(4);
    expect(contextIssues('ctx', 'DHL_EXPRESS')).toEqual(['context must be an object']);
  });
});
