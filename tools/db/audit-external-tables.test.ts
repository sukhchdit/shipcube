import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import {
  AUDIT_TABLES,
  AUDIT_WINDOW_MONTHS_AHEAD,
  BOOTSTRAP_LEDGER,
  auditPartitionName,
  auditPartitionWindow,
  externalTables,
} from './audit-external-tables.js';

describe('tables.external window (SPK-08 F-01, data-model §7.3, D-ARCH-077)', () => {
  it('[SPK-08 F-01] lists the ledger, the eight audit tables and every partition 2026-01 .. current month + 24', () => {
    const list = externalTables(new Date('2026-11-13T12:00:00Z'));
    expect(list.slice(0, 9)).toEqual([BOOTSTRAP_LEDGER, ...AUDIT_TABLES.map((table) => `public.${table}`)]);
    expect(list[9]).toBe('public.audit_entries_2026_01');
    expect(list.at(-1)).toBe('public.audit_entries_2028_11');
    expect(list).toHaveLength(9 + 35); // 2026-01 .. 2028-11
    expect(new Set(list).size).toBe(list.length);
  });

  it('uses the UTC month, not the local one, at a month boundary', () => {
    expect(auditPartitionWindow(new Date('2026-12-31T23:30:00-05:00')).at(-1)).toBe('audit_entries_2029_01');
    expect(auditPartitionWindow(new Date('2026-01-01T00:00:00Z'))).toHaveLength(AUDIT_WINDOW_MONTHS_AHEAD + 1);
  });

  it('every name matches the partition pattern and the window is contiguous (property)', () => {
    fc.assert(
      fc.property(fc.date({ min: new Date('2026-01-01T00:00:00Z'), max: new Date('2099-01-01T00:00:00Z'), noInvalidDate: true }), (now) => {
        const names = auditPartitionWindow(now);
        const months = now.getUTCFullYear() * 12 + now.getUTCMonth() - 2026 * 12 + AUDIT_WINDOW_MONTHS_AHEAD + 1;
        expect(names).toHaveLength(months);
        names.forEach((name, index) => {
          expect(name).toMatch(/^audit_entries_[0-9]{4}_[0-9]{2}$/u);
          expect(name).toBe(auditPartitionName(2026 + Math.floor(index / 12), (index % 12) + 1));
        });
      }),
    );
  });

  it('refuses an invalid clock', () => {
    expect(() => auditPartitionWindow(new Date(Number.NaN))).toThrow(RangeError);
  });
});
