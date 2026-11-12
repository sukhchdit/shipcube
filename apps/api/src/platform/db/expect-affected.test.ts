import { describe, expect, it } from '@jest/globals';

import { expectAffected } from './expect-affected.js';
import { DbError } from './map-db-error.js';

function thrown(fn: () => unknown): DbError {
  try {
    fn();
  } catch (error) {
    if (error instanceof DbError) return error;
    throw error;
  }
  throw new Error('expected a DbError');
}

describe('expectAffected (ADR-0005 am.10 item 15)', () => {
  it('ADR-0005 am.10 item 15: 0 affected rows throws NOT_FOUND (404) for updateMany results and $executeRaw counts', () => {
    for (const result of [{ count: 0 }, 0]) {
      expect(thrown(() => expectAffected(result)).toJSON()).toEqual({
        status: 404,
        code: 'NOT_FOUND',
        reason: 'NOT_FOUND',
        retryable: false,
      });
    }
  });

  it('ADR-0005 am.10 item 15: exactly the expected count passes and returns it', () => {
    expect(expectAffected({ count: 1 })).toBe(1);
    expect(expectAffected(1)).toBe(1);
    expect(expectAffected({ count: 3 }, 3)).toBe(3);
  });

  it('ADR-0005 am.10 item 15: more rows than expected throws CONFLICT (409); fewer but not none is also a CONFLICT', () => {
    expect(thrown(() => expectAffected({ count: 2 })).toJSON()).toEqual({
      status: 409,
      code: 'CONFLICT',
      reason: 'CONFLICT',
      retryable: false,
    });
    expect(thrown(() => expectAffected(2, 3)).reason).toBe('CONFLICT');
  });

  it('rejects malformed counts and expectations', () => {
    expect(() => expectAffected({ count: -1 })).toThrow(RangeError);
    expect(() => expectAffected(1.5)).toThrow(RangeError);
    expect(() => expectAffected(1, 0)).toThrow(RangeError);
    expect(() => expectAffected(1, 1.5)).toThrow(RangeError);
  });
});
