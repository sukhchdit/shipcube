import { describe, expect, it } from '@jest/globals';

import { chainStatus, createAuditChainCheck } from './audit-chain.js';
import { intervalCache } from './catalog-reader.js';

const reader = (rows: readonly unknown[]) => ({ query: () => Promise.resolve({ rows }) });
const signal = new AbortController().signal;

describe('audit_chain readiness (PR #9 m2, D-TASK006-02, D-ARCH-074)', () => {
  it.each([
    [undefined, 'degraded'],
    ['PASSED', 'ok'],
    ['FAILED', 'degraded'],
    ['ERROR', 'degraded'],
  ] as const)('latest finished run %s → %s', (latest, expected) => {
    expect(chainStatus(latest)).toBe(expected);
  });

  it('[AT-US-012-04] no verification yet → resolves "degraded" (never ok, PR9-SEC-11)', async () => {
    await expect(createAuditChainCheck(reader([])).check(signal)).resolves.toBe('degraded');
  });

  it('a passed latest run → ok; a failed one → degraded', async () => {
    await expect(createAuditChainCheck(reader([{ status: 'PASSED' }])).check(signal)).resolves.toBeUndefined();
    await expect(createAuditChainCheck(reader([{ status: 'FAILED' }])).check(signal)).resolves.toBe('degraded');
  });

  it('is never critical, and refuses an unexpected row shape', async () => {
    const check = createAuditChainCheck(reader([42]));
    expect(check.critical).toBe(false);
    await expect(check.check(signal)).rejects.toThrow(TypeError);
  });
});

describe('intervalCache', () => {
  it('shares one in-flight load, reuses a result within the interval and never caches a rejection', async () => {
    let clock = 0;
    let loads = 0;
    const cache = intervalCache<number>(100, () => clock);
    const load = () => Promise.resolve((loads += 1));
    expect(await Promise.all([cache.get(load), cache.get(load)])).toEqual([1, 1]);
    clock = 99;
    expect(await cache.get(load)).toBe(1);
    clock = 100;
    expect(await cache.get(load)).toBe(2);
    const failing = intervalCache<number>(100, () => clock);
    await expect(failing.get(() => Promise.reject(new Error('down')))).rejects.toThrow('down');
    expect(await failing.get(load)).toBe(3);
  });
});
