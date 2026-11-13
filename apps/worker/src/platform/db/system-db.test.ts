import { describe, expect, it } from '@jest/globals';

import { bindSystemDelegates, SystemDbBindingError, systemDelegates } from './system-db.js';

describe('worker SYSTEM accessor twin (PR19-SEC-01, D-ARCH-080)', () => {
  it('[PR19-SEC-01] fails closed until bound, forwards to the bound api accessor, and binds only once', () => {
    const tx = { handle: 1 };
    expect(() => systemDelegates(tx)).toThrow(SystemDbBindingError);
    const seen: object[] = [];
    const delegates = { processedEvent: {} };
    bindSystemDelegates((handle) => {
      seen.push(handle);
      return delegates;
    });
    expect(systemDelegates(tx)).toBe(delegates);
    expect(seen).toEqual([tx]);
    expect(() => {
      bindSystemDelegates(() => ({}));
    }).toThrow(new SystemDbBindingError('the worker SYSTEM accessor is bound once'));
  });
});
