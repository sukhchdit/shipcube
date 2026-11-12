/**
 * Assertion modes of the seeded lint fixture suite (tools/lint/negative-fixtures.test.ts; PR2-SEC-08, D-ORCH-018).
 *
 *  - `exact` (default, the head run inside `npm run test:unit`): every `bad-*` fixture reports exactly its expected
 *    rule(s), every `ok-*` fixture lints clean and every local platform/* rule has a fixture.
 *  - `no-weakening` (only lane A's "Lint negative fixtures from the base ref" step sets it, through the step `env:`;
 *    tools/ci/check-workflow-policy.mjs keeps it out of every other env): the BASE ref's suite, fixtures and harness run
 *    against the HEAD's lint configs. Every finding a base fixture expects must still be reported (same rule id,
 *    severity error, same message fragment); findings beyond those come from rules the head adds or widens, which is
 *    strengthening, so they are listed, not failed. Positive assertions (clean fixtures, case-table completeness) are
 *    the head suite's job and are skipped.
 *
 * The step takes this module from the base ref together with the suite, so a PR cannot change what its own base run
 * accepts.
 */

/** Environment variable that selects the mode. */
export const LINT_FIXTURE_MODE_ENV = 'LINT_FIXTURE_MODE';

/** @typedef {'exact' | 'no-weakening'} FixtureMode */
/** @typedef {{ ruleId: string | null; message: string; severity: 'error' | 'warning' }} Finding */

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
 * No-weakening comparison for one fixture: each expected rule occurrence must be matched by a distinct finding with
 * that rule id, severity `error` and a message containing `message`. Unmatched findings are returned as `extras`.
 * @param {readonly Finding[]} findings what the head configs reported for the fixture
 * @param {string | readonly string[]} ruleIds the expected rule, or the exact set of rules (one entry per finding)
 * @param {string} message fragment every expected finding's message contains ('' matches any message)
 * @returns {{ missing: string[]; extras: Finding[] }} `missing` is empty when the head still reports every expected finding
 */
export function noWeakening(findings, ruleIds, message) {
  const expected = typeof ruleIds === 'string' ? [ruleIds] : [...ruleIds];
  const unmatched = [...findings];
  /** @type {string[]} */
  const missing = [];
  for (const ruleId of expected) {
    const index = unmatched.findIndex(
      (finding) => finding.ruleId === ruleId && finding.severity === 'error' && finding.message.includes(message),
    );
    if (index === -1) {
      const reported = findings.length === 0 ? 'nothing' : findings.map(describeFinding).join('; ');
      missing.push(`${ruleId} (error, message containing ${JSON.stringify(message)}) is no longer reported; reported: ${reported}`);
    } else {
      unmatched.splice(index, 1);
    }
  }
  return { missing, extras: unmatched };
}

/**
 * One line per extra finding, for the job log and the step summary.
 * @param {readonly { file: string; finding: Finding }[]} extras
 * @param {ReadonlySet<string>} knownRules rule ids the base case tables expect somewhere
 * @returns {string[]}
 */
export function formatExtras(extras, knownRules) {
  return extras.map(({ file, finding }) => {
    const origin = finding.ruleId !== null && knownRules.has(finding.ruleId) ? 'rule known to the base' : 'rule new to the base';
    return `${file}: ${describeFinding(finding)} [${origin}]`;
  });
}
