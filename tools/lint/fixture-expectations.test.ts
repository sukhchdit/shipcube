/**
 * Assertion modes of the lint fixture suite (PR2-SEC-08, D-ORCH-018): the base-ref run (`no-weakening`) fails when the
 * head configs drop or weaken an expected finding and passes, listing the extras, when the head adds rules; the head
 * run stays `exact`. The end-to-end counterpart is lane A's "Lint negative fixtures from the base ref" step.
 */
import { describe, expect, it } from '@jest/globals';

import { LINT_FIXTURE_MODE_ENV, fixtureMode, formatExtras, noWeakening } from './fixture-expectations.mjs';
import type { Finding } from './fixture-expectations.mjs';

const error = (ruleId: string | null, message = 'only repositories import Prisma'): Finding => ({ ruleId, message, severity: 'error' });
const BOUNDARIES = 'boundaries/dependencies';
const FRAGMENT = 'only repositories import Prisma';

describe('fixtureMode: the workflow step selects the mode; the default is exact', () => {
  it.each([
    ['unset', 'exact', {}],
    ['empty', 'exact', { [LINT_FIXTURE_MODE_ENV]: '' }],
    ['"exact"', 'exact', { [LINT_FIXTURE_MODE_ENV]: 'exact' }],
    ['"no-weakening"', 'no-weakening', { [LINT_FIXTURE_MODE_ENV]: 'no-weakening' }],
  ])('%s -> %s', (_title, mode, env: Record<string, string>) => {
    expect(fixtureMode(env)).toBe(mode);
  });

  it.each(['subset', 'No-Weakening', 'off', ' no-weakening'])('an unknown value (%j) throws instead of guessing', (value) => {
    expect(() => fixtureMode({ [LINT_FIXTURE_MODE_ENV]: value })).toThrow(/must be unset, "exact" or "no-weakening"/);
  });
});

describe('noWeakening (a): a head config that removes or weakens a rule fails the base run', () => {
  it('the expected rule no longer fires (rule removed or turned off)', () => {
    const { missing } = noWeakening([], BOUNDARIES, FRAGMENT);
    expect(missing).toEqual([`${BOUNDARIES} (error, message containing "${FRAGMENT}") is no longer reported; reported: nothing`]);
  });

  it('the rule is downgraded to a warning', () => {
    const { missing, extras } = noWeakening([{ ...error(BOUNDARIES), severity: 'warning' }], BOUNDARIES, FRAGMENT);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain(`reported: ${BOUNDARIES} (warning)`);
    expect(extras).toHaveLength(1);
  });

  it('the policy that produced the expected message is gone (same rule id, other message)', () => {
    const { missing } = noWeakening([error(BOUNDARIES, 'some other policy')], BOUNDARIES, FRAGMENT);
    expect(missing).toHaveLength(1);
  });

  it('one of two independent controls is dropped (bcrypt: no-restricted-imports + boundaries)', () => {
    const { missing } = noWeakening([error(BOUNDARIES, 'bcrypt')], ['no-restricted-imports', BOUNDARIES], 'bcrypt');
    expect(missing).toEqual([expect.stringMatching(/^no-restricted-imports \(error/)]);
  });

  it('the expected rule is replaced by a different rule', () => {
    const { missing, extras } = noWeakening([error('platform/new-rule')], BOUNDARIES, FRAGMENT);
    expect(missing).toHaveLength(1);
    expect(extras).toEqual([error('platform/new-rule')]);
  });

  it('a rule expected twice must fire twice (one finding cannot satisfy two expectations)', () => {
    expect(noWeakening([error('a', 'x')], ['a', 'a'], 'x').missing).toHaveLength(1);
    expect(noWeakening([error('a', 'x'), error('a', 'x')], ['a', 'a'], 'x').missing).toEqual([]);
  });
});

describe('noWeakening (b): a head config that adds a rule firing on a base fixture passes the base run', () => {
  it('PR #11 shape: the base fixture still reports its rule, plus two findings of a rule new to the base', () => {
    const newRule = error('platform/prisma-client-construction', 'construct PrismaClient only in the client factory');
    const { missing, extras } = noWeakening([error(BOUNDARIES), newRule, newRule], BOUNDARIES, FRAGMENT);
    expect(missing).toEqual([]);
    expect(extras).toEqual([newRule, newRule]);
  });

  it('extras of any kind are listed, not failed: a known rule firing more widely, a warning, a ruleless directive report', () => {
    const findings: Finding[] = [
      error('platform/money-arith', ''),
      error(BOUNDARIES),
      { ruleId: 'i18next/no-literal-string', message: 'literal', severity: 'warning' },
      error(null, 'Unused eslint-disable directive'),
    ];
    const { missing, extras } = noWeakening(findings, 'platform/money-arith', '');
    expect(missing).toEqual([]);
    expect(extras).toHaveLength(3);
  });

  it('an empty message fragment matches any message', () => {
    expect(noWeakening([error('import-x/no-cycle', 'Dependency cycle detected.')], 'import-x/no-cycle', '').missing).toEqual([]);
  });

  it('formatExtras names the fixture and says whether the base case tables know the rule', () => {
    const lines = formatExtras(
      [
        { file: 'layering/x/bad.ts', finding: error('platform/prisma-client-construction', 'msg') },
        { file: 'rules/y/bad.ts', finding: error(BOUNDARIES, 'msg') },
        { file: 'rules/z/bad.ts', finding: error(null, 'Unused eslint-disable directive') },
      ],
      new Set([BOUNDARIES]),
    );
    expect(lines).toEqual([
      'layering/x/bad.ts: platform/prisma-client-construction (error): msg [rule new to the base]',
      'rules/y/bad.ts: boundaries/dependencies (error): msg [rule known to the base]',
      'rules/z/bad.ts: (no rule id) (error): Unused eslint-disable directive [rule new to the base]',
    ]);
  });
});

describe('(c) the head run keeps exact semantics', () => {
  it('without LINT_FIXTURE_MODE the suite runs exact (extras fail there: negative-fixtures.test.ts expectOnly)', () => {
    expect(fixtureMode({})).toBe('exact');
  });
});
