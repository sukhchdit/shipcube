import { describe, expect, it } from '@jest/globals';

import { CARRIER_ERROR_CODES, CARRIER_ERROR_MESSAGES, carrierErrorMessageKey } from './canonical/codes.js';
import { CarrierContractError, CarrierError, isCarrierError } from './errors.js';

describe('CarrierError', () => {
  it('takes its message from the canonical code and serialises the safe subset only', () => {
    const cause = new Error('socket hang up');
    const error = new CarrierError('TIMEOUT', { carrier: 'UPS', operation: 'getRates', carrierErrorCode: '250003', cause });
    expect(error.message).toBe(CARRIER_ERROR_MESSAGES.TIMEOUT);
    expect(error.cause).toBe(cause);
    expect(error.toJSON()).toEqual({ code: 'TIMEOUT', carrier: 'UPS', operation: 'getRates', carrierErrorCode: '250003' });
    expect(JSON.stringify(error)).not.toContain('socket hang up');
    expect(isCarrierError(error)).toBe(true);
    expect(isCarrierError(new Error('x'))).toBe(false);
  });

  it('drops a carrier error code that is not a short, safe code (it may echo personal data)', () => {
    const error = new CarrierError('INVALID_ADDRESS', { carrierErrorCode: 'Street 1 of Jane Doe is invalid' });
    expect(error.carrierErrorCode).toBeUndefined();
    expect(error.toJSON()).toEqual({ code: 'INVALID_ADDRESS' });
    expect(new CarrierError('RATE_LIMITED').cause).toBeUndefined();
  });

  it('every canonical error code has a customer-facing message and an i18n key', () => {
    for (const code of CARRIER_ERROR_CODES) {
      expect(CARRIER_ERROR_MESSAGES[code]).toMatch(/^[A-Z].+\.$/u);
      expect(carrierErrorMessageKey(code)).toBe(`carrierErrors.${code}`);
    }
    expect(Object.keys(CARRIER_ERROR_MESSAGES).sort()).toEqual([...CARRIER_ERROR_CODES].sort());
  });
});

describe('CarrierContractError', () => {
  it('lists every issue in the message and keeps a frozen copy', () => {
    const issues = ['a', 'b'];
    const error = new CarrierContractError('subject', issues);
    issues.push('c');
    expect(error.message).toBe('subject: a; b');
    expect(error.issues).toEqual(['a', 'b']);
    expect(Object.isFrozen(error.issues)).toBe(true);
  });
});
