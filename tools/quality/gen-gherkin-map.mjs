// @ts-check
/**
 * Generates docs/05-quality/tests/gherkin-test-map.md from the story files (TASK-277, T-QA-02; TEST-STRATEGY section 6).
 *
 *   npm run quality:gherkin-map [-- --check] [-- --root <repo>] [-- --out <file>]
 *
 * Inputs: `docs/01-requirements/stories/EPIC-*.md` (Must stories, their Gherkin scenarios in order, the `DC` flag and
 * `@live-sandbox` tags) and `docs/05-quality/tests/gherkin-suite-assignments.json` (qa-lead's primary suite per
 * scenario: a per-story default plus overrides keyed by the two-digit scenario number, the number of scenarios that were
 * classified, and the suite -> lane table). The suite is a judgement that cannot be derived from the story text, so a
 * Must story without an assignment, or whose scenario count differs from the classified count (a scenario was added or
 * inserted), fails the generator with the story IDs: qa-lead classifies them and re-runs it.
 *
 * `--check` compares instead of writing and exits 1 with the first differing line number (drift guard).
 * `--out` must stay inside the root and outside the committed evidence tree; links on the way are refused and the file
 * is replaced by a rename, never written through (PR35-SEC-01).
 * Exit: 0 ok, 1 drift or unclassified/malformed input, 2 usage or internal error.
 */
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CONSOLE_IO, DEFAULT_ROOT, UsageError, parseArgs, resolveOutput, safeIo, writeOutput } from './lib/cli.mjs';
import { MAP_PATHS, MapError, OUTLINE_SUFFIX, STORIES_DIR, loadStories, readBounded, scenarioId } from './lib/test-ids.mjs';

export { OUTLINE_SUFFIX };
export const ASSIGNMENTS_PATH = 'docs/05-quality/tests/gherkin-suite-assignments.json';
const LIVE_SANDBOX_G3 = 'no (COND-SANDBOX-DEMO)';
const SUITE_ID = /^[a-z0-9][a-z0-9-]*$/;
const LANES = new Set(['A', 'B', 'B+A*', 'opt-in']);

/**
 * @typedef {import('./lib/test-ids.mjs').Story} Story
 * @typedef {{ version: string, date: string, owner: string, stories_version: string }} AssignmentMeta
 * @typedef {{ scenarios: number, default: string, overrides: Record<string, string> }} StoryAssignment
 * @typedef {{ meta: AssignmentMeta, suiteLanes: Record<string, string>, stories: Record<string, StoryAssignment> }} Assignments
 * @typedef {{ id: string, story: Story, title: string, suite: string, lane: string, g3: boolean }} GeneratedRow
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates the parsed assignments JSON.
 * @param {unknown} raw
 * @returns {Assignments}
 */
export function parseAssignments(raw) {
  const where = ASSIGNMENTS_PATH;
  if (!isObject(raw) || !isObject(raw.meta) || !isObject(raw.suite_lanes) || !isObject(raw.stories))
    throw new MapError(`${where}: expected meta, suite_lanes and stories objects`);
  const meta = raw.meta;
  for (const key of ['version', 'date', 'owner', 'stories_version'])
    if (typeof meta[key] !== 'string' || meta[key] === '') throw new MapError(`${where}: meta.${key} must be a non-empty string`);
  /** @type {Record<string, string>} */
  const suiteLanes = {};
  for (const [suite, lane] of Object.entries(raw.suite_lanes)) {
    if (!SUITE_ID.test(suite) || typeof lane !== 'string' || !LANES.has(lane))
      throw new MapError(`${where}: suite_lanes.${suite} is invalid`);
    suiteLanes[suite] = lane;
  }
  /** @type {Record<string, StoryAssignment>} */
  const stories = {};
  for (const [storyId, entry] of Object.entries(raw.stories)) {
    if (!/^US-\d{3}$/.test(storyId) || !isObject(entry)) throw new MapError(`${where}: stories.${storyId} is invalid`);
    const { scenarios, default: suite, overrides = {} } = entry;
    if (!Number.isInteger(scenarios) || Number(scenarios) < 1)
      throw new MapError(`${where}: ${storyId}.scenarios must be a positive integer`);
    if (typeof suite !== 'string' || !Object.hasOwn(suiteLanes, suite))
      throw new MapError(`${where}: ${storyId}.default is not a suite of suite_lanes`);
    if (!isObject(overrides)) throw new MapError(`${where}: ${storyId}.overrides must be an object`);
    /** @type {Record<string, string>} */
    const checked = {};
    for (const [key, value] of Object.entries(overrides)) {
      if (!/^\d{2,3}$/.test(key) || Number(key) < 1 || Number(key) > Number(scenarios))
        throw new MapError(
          `${where}: ${storyId}.overrides key "${key}" is not a scenario number 01..${String(scenarios).padStart(2, '0')}`,
        );
      if (typeof value !== 'string' || !Object.hasOwn(suiteLanes, value))
        throw new MapError(`${where}: ${storyId}.overrides.${key} is not a suite of suite_lanes`);
      checked[key] = value;
    }
    stories[storyId] = { scenarios: Number(scenarios), default: suite, overrides: checked };
  }
  return {
    meta: {
      version: String(meta.version),
      date: String(meta.date),
      owner: String(meta.owner),
      stories_version: String(meta.stories_version),
    },
    suiteLanes,
    stories,
  };
}

/**
 * Map rows of the Must stories. Throws one MapError naming every story qa-lead must (re)classify.
 * @param {readonly Story[]} stories all stories in file order
 * @param {Assignments} assignments
 * @returns {GeneratedRow[]}
 */
export function buildRows(stories, assignments) {
  const must = stories.filter((s) => s.moscow === 'Must');
  /** @type {string[]} */
  const unclassified = [];
  /** @type {GeneratedRow[]} */
  const rows = [];
  for (const story of must) {
    const entry = assignments.stories[story.id];
    if (entry === undefined || entry.scenarios !== story.scenarios.length) {
      unclassified.push(
        entry === undefined
          ? `${story.id} (not classified)`
          : `${story.id} (${story.scenarios.length} scenarios in the story file, ${entry.scenarios} classified)`,
      );
      continue;
    }
    for (const scenario of story.scenarios) {
      const suite = entry.overrides[String(scenario.index).padStart(2, '0')] ?? entry.default;
      rows.push({
        id: scenarioId(story.id, scenario.index),
        story,
        title: scenario.title + (scenario.outline ? OUTLINE_SUFFIX : ''),
        suite,
        lane: /** @type {string} */ (assignments.suiteLanes[suite]),
        g3: !scenario.liveSandbox,
      });
    }
  }
  const mustIds = new Set(must.map((s) => s.id));
  for (const storyId of Object.keys(assignments.stories).sort())
    if (!mustIds.has(storyId)) unclassified.push(`${storyId} (classified but not a Must story)`);
  if (must.some((s) => s.scenarios.length === 0))
    unclassified.push(...must.filter((s) => s.scenarios.length === 0).map((s) => `${s.id} (no Gherkin scenario)`));
  if (unclassified.length > 0)
    throw new MapError(
      `${ASSIGNMENTS_PATH}: qa-lead must classify ${unclassified.length} stor${unclassified.length === 1 ? 'y' : 'ies'}: ${unclassified.join('; ')}`,
    );
  return rows;
}

/**
 * Renders the map exactly as committed (header prose, Summary, per-epic tables).
 * @param {readonly GeneratedRow[]} rows
 * @param {AssignmentMeta} meta
 * @returns {string}
 */
export function renderMap(rows, meta) {
  const stories = [...new Map(rows.map((r) => [r.story.id, r.story])).values()];
  /** @type {Map<string, { count: number, first: number }>} */
  const suites = new Map();
  rows.forEach((row, index) => {
    const entry = suites.get(row.suite);
    if (entry === undefined) suites.set(row.suite, { count: 1, first: index });
    else entry.count += 1;
  });
  const suiteOrder = [...suites.entries()].sort(([, a], [, b]) => b.count - a.count || a.first - b.first);
  const lane = (/** @type {string} */ suite) => /** @type {string} */ (rows.find((r) => r.suite === suite)?.lane);
  /** @type {Map<string, { file: string, stories: number, scenarios: number }>} */
  const epics = new Map();
  for (const story of stories) {
    const epic = epics.get(story.epic) ?? { file: story.file, stories: 0, scenarios: 0 };
    epic.stories += 1;
    epic.scenarios += story.scenarios.length;
    epics.set(story.epic, epic);
  }
  const g3 = rows.filter((r) => r.g3).length;
  const lines = [
    '# Gherkin → planned test ID map (Must stories)',
    '',
    `Version ${meta.version} · ${meta.date} · owner ${meta.owner} · generated from \`${STORIES_DIR}/EPIC-*.md\` (story files v${meta.stories_version}) by qa-lead in P4. Companion to [TEST-STRATEGY.md](../TEST-STRATEGY.md) §6 (test IDs) and §7 (suite catalogue).`,
    '',
    '**How to read.**',
    '',
    "- **Test ID** `AT-<story>-<nn>`: `nn` is the 1-based position of the scenario in the story's Gherkin block (Scenario and Scenario Outline both count). Every automated test that verifies the scenario carries the ID in its title in square brackets, e.g. `it('[AT-US-086-01] mutation is audited without feature code', …)`. A test may carry several IDs; a scenario may be verified by several tests (all must pass).",
    '- **Scenario Outline** rows get one test per Examples row, ID suffix `-<row>` (e.g. `AT-US-131-01-1`); the outline ID is covered when every row passes.',
    '- **Suite** is the primary suite (TEST-STRATEGY.md §7) where the test lives and whose JUnit file carries it. Permission scenarios in a story whose default suite is not RBAC-aware are verified in `rbac-matrix` (generated cells plus a named scenario test); cross-tenant ones in `abuse` or `rls-cross-tenant`; audit ones in `audit-generator`; UI-standard ones (locales, 360/1280, keyboard, axe, six states) in the Playwright suites.',
    '- **Lane**: A = hosted PR fast lane; B = local heavy lane (`quality:heavy`); `B+A*` = lane B plus the hosted `security-integration` job when a security-critical path changes; opt-in = runs only with sandbox credentials (D-003).',
    '- **G3** = counted in the AC-coverage denominator. `@live-sandbox` scenarios are COND-SANDBOX-DEMO (post-release condition, D-003) and excluded.',
    "- **Stability of IDs.** If a story's Gherkin is edited, product-manager appends new scenarios at the end of the block; a removed scenario keeps its number as `(withdrawn)` in this map. qa-lead regenerates this file after any story change (`tools/quality/gen-gherkin-map.mjs`, Wave 0 task T-QA-02) and `quality:trace` fails on an ID present in tests but absent here, or on a G3 ID without a passing test at the gate.",
    '- **Should/Could stories** use the same convention (`AT-US-xxx-nn`). They are verified when delivered but are not in the G3 Must-AC denominator.',
    '',
    '## Summary',
    '',
    `- Must stories: ${stories.length}; Must scenarios: ${rows.length} (${g3} counted for G3 AC coverage, ${rows.length - g3} \`@live-sandbox\`).`,
    '- Scenarios per primary suite:',
    '',
    '| Suite | Scenarios | Lane |',
    '|---|---|---|',
    ...suiteOrder.map(([suite, { count }]) => `| \`${suite}\` | ${count} | ${lane(suite)} |`),
    '',
    '| Epic | Must stories | Must scenarios |',
    '|---|---|---|',
    ...[...epics.entries()].map(([epic, e]) => `| ${epic} | ${e.stories} | ${e.scenarios} |`),
    '',
  ];
  for (const [epic, e] of epics) {
    lines.push('', `## ${epic} ([stories/${e.file}](../../01-requirements/stories/${e.file}))`, '');
    lines.push('| Test ID | Story | Scenario | Suite | Lane | G3 |', '|---|---|---|---|---|---|');
    for (const row of rows.filter((r) => r.story.epic === epic))
      lines.push(
        `| ${row.id} | ${row.story.id}${row.story.dc ? ' (DC)' : ''} | ${row.title} | \`${row.suite}\` | ${row.lane} | ${row.g3 ? 'yes' : LIVE_SANDBOX_G3} |`,
      );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * @param {string} root
 * @returns {Assignments}
 */
export function loadAssignments(root) {
  const text = readBounded(root, join(root, ...ASSIGNMENTS_PATH.split('/')));
  try {
    return parseAssignments(JSON.parse(text));
  } catch (error) {
    if (error instanceof MapError) throw error;
    throw new MapError(`${ASSIGNMENTS_PATH}: not valid JSON`);
  }
}

/**
 * Generated map text for a repository root.
 * @param {string} root
 */
export function generate(root) {
  const assignments = loadAssignments(root);
  const stories = loadStories(root, (dir) => readdirSync(dir));
  return renderMap(buildRows(stories, assignments), assignments.meta);
}

/**
 * 1-based number of the first line that differs, or 0 when equal.
 * @param {string} a
 * @param {string} b
 */
export function firstDifference(a, b) {
  if (a === b) return 0;
  const left = a.split('\n');
  const right = b.split('\n');
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) if (left[i] !== right[i]) return i + 1;
  return Math.max(left.length, right.length);
}

/**
 * @param {readonly string[]} argv
 * @param {import('./lib/cli.mjs').Io} [rawIo]
 * @returns {number}
 */
export function main(argv, rawIo = CONSOLE_IO) {
  const name = 'quality:gherkin-map';
  const io = safeIo(rawIo);
  try {
    const args = parseArgs(argv, ['--root', '--out'], ['--check']);
    const root = resolve(String(args.get('--root') ?? DEFAULT_ROOT));
    const out = resolveOutput(root, args.has('--out') ? String(args.get('--out')) : undefined, MAP_PATHS.gherkin);
    const text = generate(root);
    if (args.has('--check')) {
      let current = '';
      try {
        current = readBounded(root, out);
      } catch {
        current = '';
      }
      const line = firstDifference(current, text);
      if (line !== 0) {
        io.err(`${name}: the map differs from the generated one at line ${line}; run npm run quality:gherkin-map and commit the result`);
        return 1;
      }
      io.out(`${name}: up to date`);
      return 0;
    }
    writeOutput(root, out, text);
    io.out(`${name}: wrote the map`);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`${name}: ${error.message}`);
      return 2;
    }
    if (error instanceof MapError) {
      io.err(`${name}: ${error.message}`);
      return 1;
    }
    io.err(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main(process.argv.slice(2));
