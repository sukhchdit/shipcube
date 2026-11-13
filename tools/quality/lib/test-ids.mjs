// @ts-check
/**
 * Test-ID vocabulary and map readers (TASK-277, T-QA-02; TEST-STRATEGY section 6, rules D-QA-002). Shared by
 * `quality:trace` (trace.mjs), `quality:gherkin-map` (gen-gherkin-map.mjs) and their tests.
 *
 * ID forms (word-bounded; the square brackets of rule 1 are not required because existing titles carry bare IDs):
 * - `AT-US-NNN-nn[-row]`  acceptance test of scenario nn of a story (outline rows add `-<row>`);
 * - `NT-<CAT>-NNN-x`      part x of NFR-<CAT>-NNN (CAT may contain digits: A11Y, I18N);
 * - `SEC-TC-NN`           security test case;
 * - `J-<area>-NN[L]`      e2e journey (`J-M1-01L` is the live-sandbox variant).
 *
 * The readers are pure functions over the text of the committed maps; `readBounded` is the only file access and caps
 * the input size, so a hostile or corrupt file cannot exhaust memory.
 */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { MAX_JUNIT_BYTES } from './junit.mjs';

/** Upper bound for one map or story file (the largest committed map is ~200 KB). */
export const MAX_MAP_BYTES = MAX_JUNIT_BYTES;

/** Map locations relative to the repository root. */
export const MAP_PATHS = /** @type {const} */ ({
  gherkin: 'docs/05-quality/tests/gherkin-test-map.md',
  security: 'docs/05-quality/tests/security-test-cases.md',
  journeys: 'docs/05-quality/tests/e2e-journeys.md',
  nfr: 'docs/03-architecture/nfr-traceability.md',
});
/** Title suffix of a Scenario Outline row in gherkin-test-map.md. */
export const OUTLINE_SUFFIX = ' (outline: one test per Examples row, suffix -<row>)';
export const STORIES_DIR = 'docs/01-requirements/stories';
export const STORY_FILE = /^EPIC-(\d{2})-[a-z0-9-]+\.md$/;

/**
 * @typedef {'AT' | 'NT' | 'SEC-TC' | 'J'} IdFamily
 * @typedef {{ index: number, title: string, outline: boolean, liveSandbox: boolean }} Scenario
 * @typedef {{ id: string, title: string, moscow: string, dc: boolean, epic: string, file: string, scenarios: Scenario[] }} Story
 * @typedef {{ id: string, story: string, dc: boolean, title: string, suite: string, lane: string, g3: boolean, g3Text: string }} MapRow
 * @typedef {{ nfr: string, run: string, parts: string[] }} NfrRow
 */

export const ID_PATTERNS = /** @type {const} */ ({
  AT: 'AT-US-\\d{3}-\\d{2}(?:-\\d+)?',
  NT: 'NT-[A-Z][A-Z0-9]*-\\d{3}-[a-z]',
  'SEC-TC': 'SEC-TC-\\d{2}',
  J: 'J-[A-Za-z0-9]+-\\d{2}[A-Z]?',
});

const BOUND_START = '(?<![A-Za-z0-9_])';
const BOUND_END = '(?![A-Za-z0-9_])';
const ANY_ID = new RegExp(
  `${BOUND_START}(?:${ID_PATTERNS['SEC-TC']}|${ID_PATTERNS.AT}|${ID_PATTERNS.NT}|${ID_PATTERNS.J})${BOUND_END}`,
  'g',
);
const FAMILY_TESTS = /** @type {[IdFamily, RegExp][]} */ (
  /** @type {IdFamily[]} */ (['AT', 'NT', 'SEC-TC', 'J']).map((family) => [family, new RegExp(`^${ID_PATTERNS[family]}$`)])
);
const OUTLINE_ROW = /^(AT-US-\d{3}-\d{2})-(\d+)$/;

/**
 * Every test ID in a text, unique and sorted.
 * @param {string} text
 * @returns {string[]}
 */
export function extractIds(text) {
  return [...new Set(text.match(ANY_ID) ?? [])].sort();
}

const ID_LIKE = new RegExp(`${BOUND_START}(?:AT-US-|SEC-TC-|NT-[A-Z][A-Z0-9]*-|J-[A-Za-z0-9]+-)[A-Za-z0-9-]*`, 'g');
const ID_PREFIX = new RegExp(`^(?:${ID_PATTERNS['SEC-TC']}|${ID_PATTERNS.AT}|${ID_PATTERNS.NT}|${ID_PATTERNS.J})${BOUND_END}`);
/** Longest malformed token reported (a token is `[A-Za-z0-9-]*` only, so it cannot carry markup or a line break). */
const MAX_TOKEN = 40;

/**
 * ID-shaped tokens (`AT-US-`, `SEC-TC-`, `NT-<CAT>-`, `J-<area>-` at a word boundary) that do not start with a
 * well-formed ID, unique and sorted: `AT-US-66-01`, `AT-US-001-010`, `SEC-TC-1`. `AT-US-012-02-object-storage` is
 * fine (a well-formed ID followed by a hyphenated suffix). Such a typo would otherwise be neither credited nor reported
 * as an orphan (R1-m4).
 * @param {string} text
 * @returns {string[]}
 */
export function malformedIds(text) {
  const bad = new Set();
  for (const [token] of text.matchAll(ID_LIKE)) if (!ID_PREFIX.test(token)) bad.add(token.slice(0, MAX_TOKEN));
  return [...bad].sort();
}

/**
 * @param {string} id
 * @returns {IdFamily | undefined}
 */
export function idFamily(id) {
  return FAMILY_TESTS.find(([, pattern]) => pattern.test(id))?.[0];
}

/**
 * `AT-US-131-01-2` -> `{ outline: 'AT-US-131-01', row: 2 }`; anything else -> undefined.
 * @param {string} id
 */
export function outlineRow(id) {
  const match = OUTLINE_ROW.exec(id);
  return match === null ? undefined : { outline: /** @type {string} */ (match[1]), row: Number(match[2]) };
}

/** Thrown for unreadable or malformed map input; the message names the file relative to the root. */
export class MapError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'MapError';
  }
}

/**
 * Root-relative, `/`-separated path for messages (never an absolute host path).
 * @param {string} root
 * @param {string} path
 */
export function relPath(root, path) {
  return relative(root, path).split(sep).join('/');
}

/**
 * Reads a regular file (symlinks refused) of at most `limit` bytes as UTF-8.
 * @param {string} root
 * @param {string} path absolute path
 * @param {number} [limit]
 */
export function readBounded(root, path, limit = MAX_MAP_BYTES) {
  const name = relPath(root, path);
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new MapError(`${name}: cannot be read`);
  }
  if (!stat.isFile()) throw new MapError(`${name}: not a regular file`);
  if (stat.size > limit) throw new MapError(`${name}: exceeds ${limit} bytes`);
  return readFileSync(path, 'utf8');
}

/** @param {string} text */
export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Splits a Markdown table row into trimmed cells (outer pipes removed; `\|` is not a separator).
 * @param {string} line
 */
export function tableCells(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

const STORY_HEADING = /^### (US-\d{3}) — (.+)$/;
const SUMMARY_ROW = /^\| (US-\d{3}) \|/;
// `(.*)` plus trim(): linear on any line (PR35-SEC-02; a lazy group before `\s*$` backtracks quadratically).
const SCENARIO_LINE = /^\s*Scenario( Outline)?:(.*)$/;

/**
 * Parses one story file: the Story summary table (MoSCoW, DC flag in the last column) and, per `### US-nnn — title`
 * section, the scenarios of its ```gherkin blocks in order. `@live-sandbox` on the line before a scenario marks it.
 * @param {string} text
 * @param {string} file file name (for messages and the epic id)
 * @returns {Story[]}
 */
export function parseStoryFile(text, file) {
  const epicMatch = STORY_FILE.exec(file);
  if (epicMatch === null) throw new MapError(`${file}: not an EPIC-nn story file name`);
  const epic = `EPIC-${epicMatch[1]}`;
  const lines = text.split(/\r?\n/);
  /** @type {Map<string, { moscow: string, dc: boolean }>} */
  const summary = new Map();
  for (const line of lines) {
    if (!SUMMARY_ROW.test(line)) continue;
    const cells = tableCells(line);
    const id = /** @type {string} */ (cells[0]);
    if (summary.has(id)) throw new MapError(`${file}: ${id} appears twice in the story summary`);
    summary.set(id, { moscow: cells[3] ?? '', dc: cells.at(-1) === 'DC' });
  }
  /** @type {Story[]} */
  const stories = [];
  /** @type {Story | undefined} */
  let current;
  let inFence = false;
  let collect = false;
  let previous = '';
  for (const line of lines) {
    if (inFence) {
      if (/^\s*```/.test(line)) inFence = false;
      else if (collect && current !== undefined) {
        const scenario = SCENARIO_LINE.exec(line);
        if (scenario !== null)
          current.scenarios.push({
            index: current.scenarios.length + 1,
            title: /** @type {string} */ (scenario[2]).trim(),
            outline: scenario[1] !== undefined,
            liveSandbox: previous.trim().split(/\s+/).includes('@live-sandbox'),
          });
        if (line.trim() !== '') previous = line;
      }
      continue;
    }
    const heading = STORY_HEADING.exec(line);
    if (heading !== null || /^#{1,3} /.test(line)) {
      current = undefined;
      if (heading !== null) {
        const id = /** @type {string} */ (heading[1]);
        const row = summary.get(id);
        if (row === undefined) throw new MapError(`${file}: ${id} has no row in the story summary`);
        if (stories.some((s) => s.id === id)) throw new MapError(`${file}: ${id} has two story sections`);
        current = { id, title: /** @type {string} */ (heading[2]), moscow: row.moscow, dc: row.dc, epic, file, scenarios: [] };
        stories.push(current);
      }
      continue;
    }
    if (/^\s*```/.test(line)) {
      // Any fenced block is skipped as a unit; only ```gherkin blocks inside a story section contribute scenarios.
      inFence = true;
      collect = /^\s*```gherkin\s*$/.test(line);
      previous = '';
    }
  }
  if (inFence) throw new MapError(`${file}: unterminated fenced block`);
  return stories;
}

/**
 * Story files of the repository in file-name order.
 * @param {string} root
 * @param {(dir: string) => string[]} listDir
 * @returns {Story[]}
 */
export function loadStories(root, listDir) {
  const dir = join(root, ...STORIES_DIR.split('/'));
  const files = listDir(dir)
    .filter((name) => STORY_FILE.test(name))
    .sort();
  if (files.length === 0) throw new MapError(`${STORIES_DIR}: no EPIC-*.md story files`);
  return files.flatMap((file) => parseStoryFile(readBounded(root, join(dir, file)), file));
}

/**
 * Scenario test ID of a story scenario.
 * @param {string} storyId `US-001`
 * @param {number} index 1-based
 */
export function scenarioId(storyId, index) {
  return `AT-${storyId}-${String(index).padStart(2, '0')}`;
}

const MAP_ROW = /^\| AT-US-\d{3}-\d{2} \|/;

/**
 * Rows of gherkin-test-map.md (`| AT-US-001-01 | US-001 (DC) | title | \`suite\` | lane | yes |`).
 * @param {string} text
 * @returns {MapRow[]}
 */
export function parseGherkinMap(text) {
  /** @type {MapRow[]} */
  const rows = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!MAP_ROW.test(line)) continue;
    const cells = tableCells(line);
    if (cells.length !== 6) throw new MapError(`${MAP_PATHS.gherkin}: row ${cells[0]} has ${cells.length} cells, expected 6`);
    const [id, storyCell, title, suiteCell, lane, g3Text] = /** @type {[string, string, string, string, string, string]} */ (cells);
    const story = /^(US-\d{3})( \(DC\))?$/.exec(storyCell);
    const suite = /^`([a-z0-9-]+)`$/.exec(suiteCell);
    if (story === null || suite === null) throw new MapError(`${MAP_PATHS.gherkin}: row ${id} has a malformed story or suite cell`);
    if (seen.has(id)) throw new MapError(`${MAP_PATHS.gherkin}: ${id} appears twice`);
    seen.add(id);
    rows.push({
      id,
      story: /** @type {string} */ (story[1]),
      dc: story[2] !== undefined,
      title,
      suite: /** @type {string} */ (suite[1]),
      lane,
      g3: g3Text === 'yes',
      g3Text,
    });
  }
  return rows;
}

/**
 * Adopted SEC-TC cases (table rows before the "Proposed cases" section) and proposed ones (rows after it).
 * @param {string} text
 * @returns {{ adopted: string[], proposed: string[] }}
 */
export function parseSecurityCases(text) {
  /** @type {string[]} */
  const adopted = [];
  /** @type {string[]} */
  const proposed = [];
  let inProposed = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^## /.test(line)) inProposed = /^## Proposed cases\b/.test(line);
    const match = /^\| (SEC-TC-\d{2}) \|/.exec(line);
    if (match === null) continue;
    const id = /** @type {string} */ (match[1]);
    if (adopted.includes(id) || proposed.includes(id)) throw new MapError(`${MAP_PATHS.security}: ${id} appears twice`);
    (inProposed ? proposed : adopted).push(id);
  }
  return { adopted: adopted.sort(), proposed: proposed.sort() };
}

/**
 * Journey IDs from `### J-...` headings; a heading `### J-KB-01..09` defines the whole range.
 * @param {string} text
 * @returns {string[]}
 */
export function parseJourneys(text) {
  const ids = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = /^### (J-[A-Za-z0-9]+-)(\d{2})([A-Z]?)(?:\.\.(\d{2}))?(?![A-Za-z0-9])/.exec(line);
    if (match === null) continue;
    const [, prefix = '', first = '', suffix = '', last] = match;
    if (last === undefined) ids.add(`${prefix}${first}${suffix}`);
    else for (let n = Number(first); n <= Number(last); n += 1) ids.add(`${prefix}${String(n).padStart(2, '0')}`);
  }
  return [...ids].sort();
}

const NFR_PART =
  /(?<![A-Za-z0-9_])NT-([A-Z][A-Z0-9]*-\d{3})-([a-z])(?:\.\.([a-z]))?(?![A-Za-z0-9_])|(?<=· )-([a-z])(?:\.\.([a-z]))?(?=[\s,;)]|$)/g;

/**
 * NT parts listed in one Test(s) cell. `NT-PERF-003-a..c` expands to a, b, c; a bare `-b` (or `-b..d`) that opens a
 * `·`-separated item after an NT ID is shorthand for the same NFR prefix. Only the `· -x` position counts, so command
 * flags in prose (`compose up -d`, `tsc -b`) and back-references ("for -b and -c") are not parts.
 * @param {string} cell
 * @returns {string[]}
 */
export function parseNfrParts(cell) {
  const parts = new Set();
  /** @type {string | undefined} */
  let prefix;
  for (const match of cell.matchAll(NFR_PART)) {
    const [, nfr, from, to, shortFrom, shortTo] = match;
    if (nfr !== undefined) prefix = nfr;
    if (prefix === undefined) continue;
    const start = /** @type {string} */ (from ?? shortFrom);
    const end = /** @type {string} */ (nfr !== undefined ? (to ?? from) : (shortTo ?? shortFrom));
    for (let c = start.charCodeAt(0); c <= end.charCodeAt(0); c += 1) parts.add(`NT-${prefix}-${String.fromCharCode(c)}`);
  }
  return [...parts].sort();
}

/**
 * Rows of nfr-traceability.md with their Run value and NT parts (columns located by header name).
 * @param {string} text
 * @returns {NfrRow[]}
 */
export function parseNfrTraceability(text) {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^\| NFR \|/.test(line));
  if (headerIndex === -1) throw new MapError(`${MAP_PATHS.nfr}: no "| NFR |" table header`);
  const header = tableCells(/** @type {string} */ (lines[headerIndex]));
  const runCol = header.indexOf('Run');
  const testCol = header.indexOf('Test(s)');
  if (runCol === -1 || testCol === -1) throw new MapError(`${MAP_PATHS.nfr}: header lacks Run or Test(s)`);
  /** @type {NfrRow[]} */
  const rows = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!/^\| NFR-[A-Z0-9]+-\d{3} \|/.test(line)) continue;
    const cells = tableCells(line);
    const nfr = /** @type {string} */ (cells[0]);
    if (cells.length !== header.length) throw new MapError(`${MAP_PATHS.nfr}: ${nfr} has ${cells.length} cells, expected ${header.length}`);
    const run = /** @type {string} */ (cells[runCol]);
    if (!['FULL', 'PARTIAL', 'DEFERRED'].includes(run)) throw new MapError(`${MAP_PATHS.nfr}: ${nfr} has Run "${run.slice(0, 20)}"`);
    if (rows.some((r) => r.nfr === nfr)) throw new MapError(`${MAP_PATHS.nfr}: ${nfr} appears twice`);
    rows.push({ nfr, run, parts: parseNfrParts(/** @type {string} */ (cells[testCol])) });
  }
  return rows;
}
