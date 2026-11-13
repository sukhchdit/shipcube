/**
 * Strict JUnit reader (TASK-011; TEST-STRATEGY section 9.2 rule 1; ADR-0023 amendment G item 1). XXE-safe by
 * construction: DOCTYPE/ENTITY declarations are rejected before parsing.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { JUnitError, MAX_JUNIT_BYTES, decodeEntities, parseJUnit, sha256Bytes, sha256File } from './junit.mjs';

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const JEST_JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="jest tests" tests="4" failures="1" errors="0" time="1.5">
  <testsuite name="authz" errors="0" failures="1" skipped="1" timestamp="2026-11-13T10:00:00" time="1.2" tests="4">
    <testcase classname="authz [SEC-TC-01] denies" name="authz [SEC-TC-01] denies &amp; logs" time="0.5">
    </testcase>
    <testcase classname="authz" name="fails" time="0.25">
      <failure message="expected &lt;1&gt;"><![CDATA[Error: <boom> & more]]></failure>
    </testcase>
    <testcase classname="authz" name="skipped one" time="0">
      <skipped/>
    </testcase>
    <testcase classname="authz" name="ok &#x41;&#66;" time="0.25"/>
  </testsuite>
</testsuites>
`;

describe('parseJUnit', () => {
  it('reads the jest-junit <testsuites> form with entities and CDATA', () => {
    const report = parseJUnit(JEST_JUNIT);
    expect(report).toMatchObject({ tests: 4, failures: 1, errors: 0, skipped: 1, time: 1 });
    expect(report.cases.map((c) => [c.name, c.status])).toEqual([
      ['authz [SEC-TC-01] denies & logs', 'passed'],
      ['fails', 'failed'],
      ['skipped one', 'skipped'],
      ['ok AB', 'passed'],
    ]);
  });

  it('reads a bare <testsuite> root; error outranks failure', () => {
    const report = parseJUnit(
      '<testsuite name="x"><testcase name="a"><failure/><error message="e"/></testcase><testcase name="b"/></testsuite>',
    );
    expect(report).toMatchObject({ tests: 2, failures: 0, errors: 1, skipped: 0 });
  });

  it('a declared count that disagrees with the test cases throws (an edited attribute cannot hide a failure)', () => {
    expect(() => parseJUnit('<testsuite tests="1" failures="0"><testcase name="a"><failure/></testcase></testsuite>')).toThrow(
      /declares failures="0" but contains 1/,
    );
    expect(() => parseJUnit('<testsuites tests="5"><testsuite><testcase name="a"/></testsuite></testsuites>')).toThrow(JUnitError);
  });

  it.each([
    [
      'DOCTYPE (XXE)',
      '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><testsuite><testcase name="&e;"/></testsuite>',
    ],
    ['ENTITY declaration', '<testsuite><!ENTITY e "x"></testsuite>'],
    ['an unknown entity', '<testsuite><testcase name="&nbsp;"/></testsuite>'],
    ['an unclosed element', '<testsuite><testcase name="a">'],
    ['a mismatched closing tag', '<testsuite></testsuites>'],
    ['a non-JUnit root', '<html></html>'],
    ['two roots', '<testsuite/><testsuite/>'],
    ['text outside the root', 'junk<testsuite/>'],
    ['a testcase outside a testsuite', '<testsuites><testcase name="a"/></testsuites>'],
    ['an unquoted attribute', '<testsuite tests=1/>'],
    ['a negative count', '<testsuite tests="-1"/>'],
    ['an empty document', ''],
  ])('rejects %s', (_title, xml) => {
    expect(() => parseJUnit(xml)).toThrow(JUnitError);
  });

  it('rejects input larger than the bound', () => {
    expect(() => parseJUnit(`<testsuite>${' '.repeat(MAX_JUNIT_BYTES)}</testsuite>`)).toThrow(/exceeds/);
  });

  it('decodeEntities handles the predefined five and numeric references', () => {
    expect(decodeEntities('&lt;&gt;&amp;&quot;&apos;&#65;&#x42;')).toBe('<>&"\'AB');
    expect(() => decodeEntities('&#x110000;')).toThrow(JUnitError);
  });
});

describe('sha256File', () => {
  it('hashes file bytes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'junit-sha-'));
    temps.push(dir);
    const file = join(dir, 'a.txt');
    writeFileSync(file, 'abc');
    expect(sha256File(file)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Bytes('abc')).toBe(sha256File(file));
  });
});
