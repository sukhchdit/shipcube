/**
 * Assertion modes of the lint fixture suite (PR2-SEC-08, D-ORCH-018): the base-ref run (`no-weakening`) fails when the
 * head configs drop or weaken an expected finding, or report a finding without a rule id, and passes, listing the
 * extras, when the head adds rules; the head run stays `exact`. The end-to-end counterpart is lane A's "Lint negative
 * fixtures from the base ref" step.
 */
import { describe, expect, it } from '@jest/globals';

import {
  LINT_FIXTURE_MODE_ENV,
  SUMMARY_LINE_CAP,
  fixtureMode,
  formatExtras,
  logText,
  missingSteps,
  noWeakening,
  summaryMarkdown,
} from './fixture-expectations.mjs';
import type { Finding } from './fixture-expectations.mjs';

const error = (ruleId: string | null, message = 'only repositories import Prisma'): Finding => ({ ruleId, message, severity: 'error' });
const warning = (ruleId: string | null, message = ''): Finding => ({ ruleId, message, severity: 'warning' });
const BOUNDARIES = 'boundaries/dependencies';
const FRAGMENT = 'only repositories import Prisma';
/** What ESLint reports under reportUnusedDisableDirectives when the suppressed rule stopped reporting (review M1). */
const UNUSED_DIRECTIVE = error(
  null,
  "Unused eslint-disable directive (no problems were reported from '@typescript-eslint/no-explicit-any').",
);
/** A fatal parse error: ESLint reports it without a rule id. */
const PARSE_ERROR = error(null, "Parsing error: ';' expected.");

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
    const { failures } = noWeakening([], BOUNDARIES, FRAGMENT);
    expect(failures).toEqual([`${BOUNDARIES} (error, message containing "${FRAGMENT}") is no longer reported; reported: nothing`]);
  });

  it('the rule is downgraded to a warning', () => {
    const { failures, extras } = noWeakening([{ ...error(BOUNDARIES), severity: 'warning' }], BOUNDARIES, FRAGMENT);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(`reported: ${BOUNDARIES} (warning)`);
    expect(extras).toHaveLength(1);
  });

  it('the policy that produced the expected message is gone (same rule id, other message)', () => {
    expect(noWeakening([error(BOUNDARIES, 'some other policy')], BOUNDARIES, FRAGMENT).failures).toHaveLength(1);
  });

  it('one of two independent controls is dropped (bcrypt: no-restricted-imports + boundaries)', () => {
    const { failures } = noWeakening([error(BOUNDARIES, 'bcrypt')], ['no-restricted-imports', BOUNDARIES], 'bcrypt');
    expect(failures).toEqual([expect.stringMatching(/^no-restricted-imports \(error/)]);
  });

  it('the expected rule is replaced by a different rule', () => {
    const { failures, extras } = noWeakening([error('platform/new-rule')], BOUNDARIES, FRAGMENT);
    expect(failures).toHaveLength(1);
    expect(extras).toEqual([error('platform/new-rule')]);
  });

  it('a rule expected twice must fire twice (one finding cannot satisfy two expectations)', () => {
    expect(noWeakening([error('a', 'x')], ['a', 'a'], 'x').failures).toHaveLength(1);
    expect(noWeakening([error('a', 'x'), error('a', 'x')], ['a', 'a'], 'x').failures).toEqual([]);
  });

  it('review M1: an "Unused eslint-disable directive" beside the expected finding fails (a suppressed rule stopped reporting)', () => {
    const { failures, extras } = noWeakening([error('platform/any-justification', ''), UNUSED_DIRECTIVE], 'platform/any-justification', '');
    expect(failures).toEqual([expect.stringContaining(`(no rule id) (error): ${UNUSED_DIRECTIVE.message}`)]);
    expect(extras).toEqual([]);
  });

  it('review M1: the no-explicit-any-off shape (expected rule gone, only the directive report left) fails twice over', () => {
    const { failures } = noWeakening([UNUSED_DIRECTIVE], 'platform/any-justification', '');
    expect(failures).toEqual([
      expect.stringMatching(/^platform\/any-justification \(error, .*is no longer reported; reported: \(no rule id\)/),
      expect.stringContaining('a finding without a rule id is reported'),
    ]);
  });

  it('review M1: a fatal parse error fails, also when the expected finding is still there', () => {
    expect(noWeakening([error(BOUNDARIES), PARSE_ERROR], BOUNDARIES, FRAGMENT).failures).toEqual([
      expect.stringContaining('Parsing error'),
    ]);
  });

  it('review M1: a ruleless warning (ESLint "File ignored because of a matching ignore pattern") fails', () => {
    expect(noWeakening([warning(null, 'File ignored because of a matching ignore pattern.')], [], '').failures).toHaveLength(1);
  });
});

describe('noWeakening with no expected rule: the clean-fixture check in no-weakening mode (review M1)', () => {
  it('a clean fixture stays clean', () => {
    expect(noWeakening([], [], '')).toEqual({ failures: [], extras: [] });
  });

  it('a ruleless finding on a clean fixture (ok-justified.ts with no-explicit-any off) fails', () => {
    expect(noWeakening([UNUSED_DIRECTIVE], [], '').failures).toHaveLength(1);
  });

  it('a finding with a rule id on a clean fixture is an extra (a rule the head adds), not a failure', () => {
    const added = error('platform/prisma-client-construction', 'construct PrismaClient only in the client factory');
    expect(noWeakening([added], [], '')).toEqual({ failures: [], extras: [added] });
  });
});

describe('noWeakening (m3): minimum severity per case', () => {
  const RULE = 'platform/expect-affected';

  it('a warning case passes on a warning and on an error (raised: strengthening)', () => {
    expect(noWeakening([warning(RULE)], RULE, '', { minSeverity: 'warning' })).toEqual({ failures: [], extras: [] });
    expect(noWeakening([error(RULE, '')], RULE, '', { minSeverity: 'warning' })).toEqual({ failures: [], extras: [] });
  });

  it('a warning case fails when the rule is off, and names the minimum', () => {
    expect(noWeakening([], RULE, '', { minSeverity: 'warning' }).failures).toEqual([
      `${RULE} (at least warning, message containing "") is no longer reported; reported: nothing`,
    ]);
  });

  it('the default minimum is error: a warning does not satisfy it', () => {
    expect(noWeakening([warning(RULE)], RULE, '').failures).toHaveLength(1);
    expect(noWeakening([warning(RULE)], RULE, '', { minSeverity: 'error' }).failures).toHaveLength(1);
  });
});

describe('noWeakening (b): a head config that adds a rule firing on a base fixture passes the base run', () => {
  it('PR #11 shape: the base fixture still reports its rule, plus two findings of a rule new to the base', () => {
    const newRule = error('platform/prisma-client-construction', 'construct PrismaClient only in the client factory');
    const { failures, extras } = noWeakening([error(BOUNDARIES), newRule, newRule], BOUNDARIES, FRAGMENT);
    expect(failures).toEqual([]);
    expect(extras).toEqual([newRule, newRule]);
  });

  it('extras with a rule id are listed, not failed: a known rule firing more widely, a new warning', () => {
    const findings: Finding[] = [error('platform/money-arith', ''), error(BOUNDARIES), warning('i18next/no-literal-string', 'literal')];
    const { failures, extras } = noWeakening(findings, 'platform/money-arith', '');
    expect(failures).toEqual([]);
    expect(extras).toEqual(findings.slice(1));
  });

  it('an empty message fragment matches any message', () => {
    expect(noWeakening([error('import-x/no-cycle', 'Dependency cycle detected.')], 'import-x/no-cycle', '').failures).toEqual([]);
  });

  it('formatExtras names the fixture and says whether the base case tables know the rule (review n2: no rule id is said so)', () => {
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
      'rules/z/bad.ts: (no rule id) (error): Unused eslint-disable directive [no rule id]',
    ]);
  });
});

describe('missingSteps (PR17-SEC-04): every base lint step still runs, in order; extra head steps are allowed', () => {
  const BASE = [/^eslint \. .*--max-warnings 0/u, /^stylelint .*--max-warnings 0/u, /^node tools\/lint\/check-suppressions\.mjs$/u];
  const ESLINT = 'eslint . --max-warnings 0';
  const STYLELINT = 'stylelint "**/*.css" --max-warnings 0';
  const COUNTER = 'node tools/lint/check-suppressions.mjs';

  it('the base script and a script with an extra step pass', () => {
    expect(missingSteps([ESLINT, STYLELINT, COUNTER], BASE)).toEqual([]);
    expect(missingSteps([ESLINT, 'node tools/lint/new-check.mjs', STYLELINT, COUNTER, 'echo done'], BASE)).toEqual([]);
  });

  it('a script without the suppression counter fails (PR2-SEC-01)', () => {
    expect(missingSteps([ESLINT, STYLELINT], BASE)).toEqual([String(BASE[2])]);
  });

  it('a reordered script or one without --max-warnings 0 fails', () => {
    expect(missingSteps([COUNTER, ESLINT, STYLELINT], BASE)).toEqual([String(BASE[2])]);
    expect(missingSteps(['eslint .', STYLELINT, COUNTER], BASE)).toEqual([String(BASE[0])]);
  });
});

describe('PR17-SEC-05 / review n1: the job summary keeps head text inside one code block', () => {
  it('a message with a backtick fence gets a longer fence', () => {
    const lines = ['rules/x/bad.ts: platform/x (error): ```\n[click](https://example.invalid) ```` end'];
    const markdown = summaryMarkdown('No-weakening run: 1 extra finding(s).', lines);
    expect(markdown.startsWith('\n`````text\n')).toBe(true);
    expect(markdown.endsWith('\n`````\n')).toBe(true);
    expect(markdown.split('\n').filter((line) => /^`{5}/u.test(line))).toHaveLength(2);
  });

  it('plain text gets the three-backtick fence', () => {
    expect(summaryMarkdown('heading', ['a'])).toBe('\n```text\nheading\na\n```\n');
  });

  it(`the list stops after ${String(SUMMARY_LINE_CAP)} lines and says how many more`, () => {
    const lines = Array.from({ length: SUMMARY_LINE_CAP + 5 }, (_unused, index) => `line ${String(index)}`);
    const body = summaryMarkdown('heading', lines).split('\n');
    expect(body).toContain(`line ${String(SUMMARY_LINE_CAP - 1)}`);
    expect(body).not.toContain(`line ${String(SUMMARY_LINE_CAP)}`);
    expect(body).toContain('... 5 more (see the job log)');
  });

  it('a log line starting with "::" cannot act as a workflow command', () => {
    expect(logText(['::error::all gates passed', '  ::warning::x', 'a::b', 'msg\n::notice::y'])).toBe(
      ': :error::all gates passed\n  : :warning::x\na::b\nmsg\n: :notice::y',
    );
  });
});

describe('(c) the head run keeps exact semantics', () => {
  it('without LINT_FIXTURE_MODE the suite runs exact (extras fail there: negative-fixtures.test.ts expectOnly)', () => {
    expect(fixtureMode({})).toBe('exact');
  });
});
