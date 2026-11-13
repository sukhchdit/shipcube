/**
 * JUnit writer (TASK-011; ADR-0023 am. G item 1): every document it writes is read back by the verifier's parser with
 * equal counts, and hostile text in names and messages cannot break the XML.
 */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { parseJUnit } from './junit.mjs';
import { countCases, escapeXml, MAX_MESSAGE, toJUnit } from './junit-write.mjs';

type Status = 'passed' | 'failed' | 'error' | 'skipped';

describe('toJUnit (TASK-011)', () => {
  it('[R-ARCH-16] writes one testcase per case with totals the verifier parser reproduces', () => {
    const cases = [
      { name: 'a passes', status: 'passed' as const, time: 0.5 },
      { name: 'b fails', status: 'failed' as const, message: 'expected 1\nreceived 2' },
      { name: 'c errors', status: 'error' as const, message: 'boom' },
      { name: 'd skipped', status: 'skipped' as const },
    ];
    const xml = toJUnit({ suite: 'integration', cases, time: 3.25 });
    expect(
      xml.startsWith(
        '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="integration" tests="4" failures="1" errors="1" skipped="1" time="3.250">',
      ),
    ).toBe(true);
    const parsed = parseJUnit(xml);
    expect({ tests: parsed.tests, failures: parsed.failures, errors: parsed.errors, skipped: parsed.skipped }).toEqual(countCases(cases));
    expect(parsed.cases.map((c) => [c.name, c.status])).toEqual(cases.map((c) => [c.name, c.status]));
  });

  it('[R-ARCH-16] escapes markup, quotes and drops characters XML 1.0 cannot carry', () => {
    const nasty = `<x a="1">&amp; ' ${String.fromCharCode(0)}${String.fromCharCode(27)} ]]> </testsuite>`;
    expect(escapeXml(nasty)).toBe('&lt;x a=&quot;1&quot;&gt;&amp;amp; &apos;  ]]&gt; &lt;/testsuite&gt;');
    const parsed = parseJUnit(toJUnit({ suite: 'api', cases: [{ name: nasty, classname: nasty, status: 'failed', message: nasty }] }));
    expect(parsed.cases[0]?.name).toBe(nasty.replace(String.fromCharCode(0), '').replace(String.fromCharCode(27), ''));
    expect(parsed.failures).toBe(1);
  });

  it('[R-ARCH-16] truncates long failure messages (5 MB run-directory cap)', () => {
    const xml = toJUnit({ suite: 'unit', cases: [{ name: 'long', status: 'failed', message: 'x'.repeat(MAX_MESSAGE * 3) }] });
    expect(xml.length).toBeLessThan(MAX_MESSAGE * 2 + 1000);
    expect(xml).toContain('[truncated]');
  });

  it('[R-ARCH-16] rejects a suite id outside the manifest id grammar', () => {
    expect(() => toJUnit({ suite: '../evil', cases: [] })).toThrow(/invalid suite id/);
  });

  it('[R-ARCH-16] round-trips arbitrary names and statuses through the verifier parser (property)', () => {
    const status = fc.constantFrom<Status>('passed', 'failed', 'error', 'skipped');
    fc.assert(
      fc.property(
        fc.array(fc.record({ name: fc.string({ maxLength: 40 }), status, message: fc.string({ maxLength: 40 }) }), { maxLength: 20 }),
        (cases) => {
          const parsed = parseJUnit(toJUnit({ suite: 'prop', cases }));
          expect(parsed.cases.map((c) => c.status)).toEqual(cases.map((c) => c.status));
          expect(parsed.tests).toBe(cases.length);
        },
      ),
      { numRuns: 200 },
    );
  });
});
