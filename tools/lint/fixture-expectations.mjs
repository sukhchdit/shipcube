/**
 * Assertion modes of the seeded lint fixture suite (tools/lint/negative-fixtures.test.ts; PR2-SEC-08, D-ORCH-018).
 *
 *  - `exact` (default, the head run inside `npm run test:unit`): every `bad-*` fixture reports exactly its expected
 *    rule(s), every `ok-*` fixture lints clean and every local platform/* rule has a fixture.
 *  - `no-weakening` (only lane A's "Lint negative fixtures from the base ref" step sets it, through the step `env:`;
 *    tools/ci/check-workflow-policy.mjs flags literal mentions anywhere else): the BASE ref's suite, fixtures and
 *    harness run against the HEAD's lint configs. Every finding a base fixture expects must still be reported (same
 *    rule id, at least the expected severity, same message fragment). Further findings WITH a rule id come from rules
 *    the head adds or widens, which is strengthening, so they are listed, not failed. Findings WITHOUT a rule id fail:
 *    ESLint reports an unused `eslint-disable` directive when a rule the fixture suppresses stopped reporting there,
 *    and a parse error or an ignored-file warning means the fixture is no longer linted. Clean fixtures follow the
 *    same rule. Head-only completeness checks (case tables, rule coverage) are skipped.
 *
 * The step takes this module, the suite, the fixtures, the harness and its Jest config from the base ref, so a PR
 * cannot change what its own base run accepts through those files. The step is still an accident guard
 * (PR10-SEC-02): head code that runs earlier in the fast lane, owned configuration (`tools/deps/npm-cli.mjs`, lint
 * configs and rules, the lockfile) and the step text itself (a required gate pinned by the base workflow-policy
 * checker) can change its outcome; owned paths need a security review record.
 */

/** Environment variable that selects the mode. */
export const LINT_FIXTURE_MODE_ENV = 'LINT_FIXTURE_MODE';

/** @typedef {'exact' | 'no-weakening'} FixtureMode */
/** @typedef {'error' | 'warning'} Severity */
/** @typedef {{ ruleId: string | null; message: string; severity: Severity }} Finding */

/** Severity order: a finding satisfies an expectation when it is at least as severe. */
const SEVERITY_RANK = Object.freeze({ warning: 1, error: 2 });

/** Lines of the job-summary extras list before it is cut (PR17-SEC-05). */
export const SUMMARY_LINE_CAP = 200;

/**
 * Reads the mode; unset or empty is `exact`. Any other value throws, so a typo cannot select a weaker mode silently.
 * @param {Record<string, string | undefined>} env
 * @returns {FixtureMode}
 */
export function fixtureMode(env) {
  const value = env[LINT_FIXTURE_MODE_ENV];
  if (value === undefined || value === '' || value === 'exact') return 'exact';
  if (value === 'no-weakening') return 'no-weakening';
  throw new Error(`${LINT_FIXTURE_MODE_ENV} must be unset, "exact" or "no-weakening" (got ${JSON.stringify(value)})`);
}

/** @param {Finding} finding */
const describeFinding = (finding) => `${finding.ruleId ?? '(no rule id)'} (${finding.severity}): ${finding.message}`;

/**
 * No-weakening comparison for one fixture. Each expected rule occurrence must be matched by a distinct finding with
 * that rule id, a severity of at least `minSeverity` and a message containing `message`. Every unmatched finding
 * without a rule id is a failure (unused disable directive, parse error, ignored file); the other unmatched findings
 * are returned as `extras`. With no expected rules this is the check for a fixture that must lint clean.
 * @param {readonly Finding[]} findings what the head configs reported for the fixture
 * @param {string | readonly string[]} ruleIds the expected rule, or the exact set of rules (one entry per finding)
 * @param {string} message fragment every expected finding's message contains ('' matches any message)
 * @param {{ minSeverity?: Severity }} [options] `minSeverity` defaults to `error`; a `warning` case also accepts an
 *   error (raising a warning is strengthening) but fails when the rule is off
 * @returns {{ failures: string[]; extras: Finding[] }} `failures` is empty when nothing was weakened
 */
export function noWeakening(findings, ruleIds, message, options = {}) {
  const minSeverity = options.minSeverity ?? 'error';
  const expected = typeof ruleIds === 'string' ? [ruleIds] : [...ruleIds];
  const unmatched = [...findings];
  /** @type {string[]} */
  const failures = [];
  for (const ruleId of expected) {
    const index = unmatched.findIndex(
      (finding) =>
        finding.ruleId === ruleId && SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[minSeverity] && finding.message.includes(message),
    );
    if (index === -1) {
      const reported = findings.length === 0 ? 'nothing' : findings.map(describeFinding).join('; ');
      const severity = minSeverity === 'error' ? 'error' : `at least ${minSeverity}`;
      failures.push(`${ruleId} (${severity}, message containing ${JSON.stringify(message)}) is no longer reported; reported: ${reported}`);
    } else {
      unmatched.splice(index, 1);
    }
  }
  for (const finding of unmatched) {
    if (finding.ruleId === null) {
      failures.push(
        `a finding without a rule id is reported (an unused disable directive means a rule the fixture relies on stopped reporting; a parse error or an ignored-file warning means the fixture is no longer linted): ${describeFinding(finding)}`,
      );
    }
  }
  return { failures, extras: unmatched.filter((finding) => finding.ruleId !== null) };
}

/**
 * Base lint-script steps the head `npm run lint` no longer runs, in order (PR17-SEC-04). Every matcher must match a
 * step after the step that matched the previous one; extra head steps are allowed.
 * @param {readonly string[]} steps the head script split on `&&`, trimmed
 * @param {readonly RegExp[]} matchers the base steps
 * @returns {string[]} the sources of the matchers without a step
 */
export function missingSteps(steps, matchers) {
  /** @type {string[]} */
  const missing = [];
  let next = 0;
  for (const matcher of matchers) {
    const index = steps.findIndex((step, position) => position >= next && matcher.test(step));
    if (index === -1) missing.push(String(matcher));
    else next = index + 1;
  }
  return missing;
}

/**
 * One line per extra finding, for the job log and the step summary.
 * @param {readonly { file: string; finding: Finding }[]} extras
 * @param {ReadonlySet<string>} knownRules rule ids the base case tables expect somewhere
 * @returns {string[]}
 */
export function formatExtras(extras, knownRules) {
  return extras.map(({ file, finding }) => {
    const origin =
      finding.ruleId === null ? 'no rule id' : knownRules.has(finding.ruleId) ? 'rule known to the base' : 'rule new to the base';
    return `${file}: ${describeFinding(finding)} [${origin}]`;
  });
}

/**
 * Log text: a line starting with `::` would be read by the runner as a workflow command, so the colons are split.
 * @param {readonly string[]} lines
 * @returns {string}
 */
export function logText(lines) {
  return lines
    .join('\n')
    .split('\n')
    .map((line) => line.replace(/^(\s*):(?=:)/u, '$1: '))
    .join('\n');
}

/**
 * Markdown for `$GITHUB_STEP_SUMMARY` (PR17-SEC-05): the fence is longer than any backtick run in the text, so head
 * rule messages cannot close it and render markdown, and the list stops after `cap` lines.
 * @param {string} heading
 * @param {readonly string[]} lines
 * @param {number} [cap]
 * @returns {string}
 */
export function summaryMarkdown(heading, lines, cap = SUMMARY_LINE_CAP) {
  const shown = lines.length > cap ? [...lines.slice(0, cap), `... ${String(lines.length - cap)} more (see the job log)`] : [...lines];
  const text = [heading, ...shown].join('\n');
  const longestRun = Math.max(0, ...[...text.matchAll(/`+/gu)].map((match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return ['', `${fence}text`, text, fence, ''].join('\n');
}
