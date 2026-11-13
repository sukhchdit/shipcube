// @ts-check
/**
 * JUnit XML writer for the lane B heavy run (TASK-011; ADR-0023 am. B, G; TEST-STRATEGY section 9). Every suite of a
 * run, whatever its native tool, is reported as one `<suite>.junit.xml` produced here, so `quality:check-evidence`
 * parses a single dialect. Pure: no I/O.
 *
 * Output shape: `<testsuites>` with the totals, one `<testsuite>` with the same totals, one `<testcase>` per case.
 * Status `failed` -> `<failure>`, `error` -> `<error>`, `skipped` -> `<skipped/>`.
 */

/** @typedef {'passed' | 'failed' | 'error' | 'skipped'} CaseStatus */
/**
 * @typedef {object} JUnitCase
 * @property {string} name
 * @property {string} [classname]
 * @property {number} [time] seconds
 * @property {CaseStatus} status
 * @property {string} [message] failure/error/skip text (truncated to MAX_MESSAGE)
 */

/** Longest failure text kept per case: evidence is capped at 5 MB per run directory. */
export const MAX_MESSAGE = 4000;

/**
 * Characters that are not allowed in XML 1.0 at all (C0 controls except TAB/LF/CR, lone surrogates, U+FFFE/U+FFFF).
 * They are dropped rather than escaped: XML 1.0 has no escape for them.
 */
// The class is built from code points so that no control character appears in the source.
const INVALID_XML_CHARS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}\\uFFFE\\uFFFF]|[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]`,
  'gu',
);

/**
 * Escapes text for an XML attribute or text node.
 * @param {string} value
 * @returns {string}
 */
export function escapeXml(value) {
  return value
    .replace(INVALID_XML_CHARS, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replaceAll('\r', '&#13;')
    .replaceAll('\n', '&#10;')
    .replaceAll('\t', '&#9;');
}

/**
 * @param {string | undefined} message
 * @returns {string}
 */
function truncate(message) {
  const text = message ?? '';
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)} [truncated]` : text;
}

/** @param {number | undefined} seconds */
function formatTime(seconds) {
  return Number.isFinite(seconds) && /** @type {number} */ (seconds) >= 0 ? /** @type {number} */ (seconds).toFixed(3) : '0.000';
}

/**
 * Counts per status.
 * @param {readonly JUnitCase[]} cases
 * @returns {{ tests: number, failures: number, errors: number, skipped: number }}
 */
export function countCases(cases) {
  let failures = 0;
  let errors = 0;
  let skipped = 0;
  for (const c of cases) {
    if (c.status === 'failed') failures += 1;
    else if (c.status === 'error') errors += 1;
    else if (c.status === 'skipped') skipped += 1;
  }
  return { tests: cases.length, failures, errors, skipped };
}

/**
 * @param {{ suite: string, cases: readonly JUnitCase[], time?: number }} input
 * @returns {string} the complete JUnit XML document
 */
export function toJUnit({ suite, cases, time }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(suite)) throw new Error(`toJUnit: invalid suite id ${JSON.stringify(suite)}`);
  const counts = countCases(cases);
  const totals = `tests="${counts.tests}" failures="${counts.failures}" errors="${counts.errors}" skipped="${counts.skipped}" time="${formatTime(time)}"`;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${escapeXml(suite)}" ${totals}>`,
    `  <testsuite name="${escapeXml(suite)}" ${totals}>`,
  ];
  for (const c of cases) {
    const open = `    <testcase name="${escapeXml(c.name)}" classname="${escapeXml(c.classname ?? suite)}" time="${formatTime(c.time)}"`;
    const message = escapeXml(truncate(c.message));
    if (c.status === 'passed') lines.push(`${open}/>`);
    else if (c.status === 'skipped') lines.push(`${open}>`, `      <skipped message="${message}"/>`, '    </testcase>');
    else {
      const tag = c.status === 'failed' ? 'failure' : 'error';
      const firstLine = escapeXml(truncate(c.message).split(/\r?\n/, 1)[0] ?? '');
      lines.push(`${open}>`, `      <${tag} message="${firstLine}">${message}</${tag}>`, '    </testcase>');
    }
  }
  lines.push('  </testsuite>', '</testsuites>', '');
  return lines.join('\n');
}
