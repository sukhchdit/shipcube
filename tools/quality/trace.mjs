// @ts-check
/**
 * Test-ID traceability for one lane B run (TASK-277, T-QA-02; TEST-STRATEGY section 6 rule 2, D-QA-002).
 *
 *   npm run quality:trace [-- --run <dir>] [-- --root <repo>] [-- --out <file>]
 *
 * Reads every `*.junit.xml` of a run directory under docs/05-quality/tests/runs (default: the latest), extracts the
 * AT-/NT-/SEC-TC-/J- IDs from each test case's name and classname (a describe title carries its ID to every test in
 * it), and writes `ac-trace.json` (default: into the run directory) with per-ID counts and the three coverage ratios.
 *
 * Known IDs: AT = gherkin-test-map.md rows UNION the scenarios of every story file (Should/Could stories are not in the
 * Must map but are not orphans, D-TASK277-02; an outline row `-<n>` is known when its outline is); NT = parts of the
 * nfr-traceability.md Test(s) column; SEC-TC = rows of security-test-cases.md (adopted and proposed); J = journey
 * headings of e2e-journeys.md. Only map rows with G3 = yes are in the Must-AC denominator.
 *
 * Output is deterministic (sorted keys, no timestamps, no host paths) and carries IDs and counts only, never test
 * names or messages. Exit: 0 ok (failing tests do not fail the command; coverage is informational until G3),
 * 1 orphan IDs or an unreadable/unparseable map or JUnit file, 2 usage or internal error.
 */
import { lstatSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CONSOLE_IO, DEFAULT_ROOT, UsageError, parseArgs, ratio, stableJson } from './lib/cli.mjs';
import { JUnitError, MAX_JUNIT_BYTES, parseJUnit } from './lib/junit.mjs';
import {
  MAP_PATHS,
  MapError,
  OUTLINE_SUFFIX,
  extractIds,
  idFamily,
  loadStories,
  outlineRow,
  parseGherkinMap,
  parseJourneys,
  parseNfrTraceability,
  parseSecurityCases,
  readBounded,
  relPath,
  scenarioId,
  sha256Text,
} from './lib/test-ids.mjs';

export const RUNS_PATH = 'docs/05-quality/tests/runs';
export const RUN_DIR = /^\d{8}T\d{4}Z_[0-9a-f]{7}$/;
export const TRACE_FILE = 'ac-trace.json';

/**
 * @typedef {import('./lib/test-ids.mjs').NfrRow} NfrRow
 * @typedef {import('./lib/junit.mjs').CaseStatus} CaseStatus
 * @typedef {{ g3: boolean | undefined, outline: boolean }} AtEntry
 * @typedef {{ at: Map<string, AtEntry>, nt: Set<string>, sec: Set<string>, secAdopted: string[], journeys: Set<string>,
 *   nfr: NfrRow[], mustAc: string[], sha: Record<string, string> }} Maps
 * @typedef {{ suite: string, ids: string[], status: CaseStatus }} Observation
 * @typedef {{ family: string, g3?: boolean, suites: string[], tests: number, passed: number, failed: number, skipped: number }} IdStats
 */

/**
 * Loads every map of the repository.
 * @param {string} root
 * @returns {Maps}
 */
export function loadMaps(root) {
  const read = (/** @type {string} */ path) => readBounded(root, join(root, ...path.split('/')));
  const texts = {
    gherkin: read(MAP_PATHS.gherkin),
    security: read(MAP_PATHS.security),
    journeys: read(MAP_PATHS.journeys),
    nfr: read(MAP_PATHS.nfr),
  };
  /** @type {Map<string, AtEntry>} */
  const at = new Map();
  for (const story of loadStories(root, (dir) => readdirSync(dir)))
    for (const scenario of story.scenarios) at.set(scenarioId(story.id, scenario.index), { g3: undefined, outline: scenario.outline });
  const mapRows = parseGherkinMap(texts.gherkin);
  for (const row of mapRows) {
    const outline = row.title.endsWith(OUTLINE_SUFFIX) || (at.get(row.id)?.outline ?? false);
    at.set(row.id, { g3: row.g3, outline });
  }
  const security = parseSecurityCases(texts.security);
  const nfr = parseNfrTraceability(texts.nfr);
  return {
    at,
    nt: new Set(nfr.flatMap((r) => r.parts)),
    sec: new Set([...security.adopted, ...security.proposed]),
    secAdopted: security.adopted,
    journeys: new Set(parseJourneys(texts.journeys)),
    nfr,
    mustAc: mapRows.filter((r) => r.g3).map((r) => r.id),
    sha: {
      gherkin_sha256: sha256Text(texts.gherkin),
      security_sha256: sha256Text(texts.security),
      journeys_sha256: sha256Text(texts.journeys),
      nfr_sha256: sha256Text(texts.nfr),
    },
  };
}

/**
 * True when the maps define the ID.
 * @param {string} id
 * @param {Maps} maps
 */
export function isKnown(id, maps) {
  switch (idFamily(id)) {
    case 'AT': {
      if (maps.at.has(id)) return true;
      const row = outlineRow(id);
      return row !== undefined && row.row >= 1 && maps.at.get(row.outline)?.outline === true;
    }
    case 'NT':
      return maps.nt.has(id);
    case 'SEC-TC':
      return maps.sec.has(id);
    case 'J':
      return maps.journeys.has(id);
    default:
      return false;
  }
}

/**
 * Resolves the run directory: `--run` (relative to the working directory) must be a direct, non-symlink child of the
 * runs directory named `<UTCstamp>_<sha7>`; without it, the lexicographically latest such child.
 * @param {string} root
 * @param {string | undefined} requested
 * @returns {string} absolute path
 */
export function resolveRunDir(root, requested) {
  const runsDir = join(root, ...RUNS_PATH.split('/'));
  if (requested === undefined) {
    let names;
    try {
      names = readdirSync(runsDir, { withFileTypes: true });
    } catch {
      throw new MapError(`${RUNS_PATH}: cannot be read`);
    }
    const latest = names
      .filter((d) => d.isDirectory() && RUN_DIR.test(d.name))
      .map((d) => d.name)
      .sort()
      .at(-1);
    if (latest === undefined) throw new MapError(`${RUNS_PATH}: no run directory`);
    return join(runsDir, latest);
  }
  const path = resolve(requested);
  const rel = relative(runsDir, path);
  if (rel === '' || isAbsolute(rel) || rel.split(/[\\/]/).length !== 1 || rel === '..' || !RUN_DIR.test(rel))
    throw new UsageError(`--run must name a <UTCstamp>_<sha7> directory directly under ${RUNS_PATH}`);
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new MapError(`${RUNS_PATH}/${rel}: cannot be read`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new UsageError(`${RUNS_PATH}/${rel} is not a directory (symlinks are not followed)`);
  return path;
}

/**
 * Observations (suite, IDs, status) of every test case in the run's JUnit files. Unreadable or unparseable files are
 * returned as problems.
 * @param {string} root
 * @param {string} runDir
 * @returns {{ observations: Observation[], problems: string[] }}
 */
export function collectRun(root, runDir) {
  /** @type {Observation[]} */
  const observations = [];
  /** @type {string[]} */
  const problems = [];
  const files = readdirSync(runDir)
    .filter((name) => name.endsWith('.junit.xml'))
    .sort();
  if (files.length === 0) problems.push(`${relPath(root, runDir)}: no *.junit.xml file`);
  for (const file of files) {
    const path = join(runDir, file);
    const suite = file.slice(0, -'.junit.xml'.length);
    let report;
    try {
      report = parseJUnit(readBounded(root, path, MAX_JUNIT_BYTES));
    } catch (error) {
      // The parser's message may quote file content; only the file and the kind of failure are reported.
      problems.push(
        error instanceof JUnitError
          ? `${relPath(root, path)}: unparseable JUnit XML`
          : error instanceof MapError
            ? error.message
            : `${relPath(root, path)}: cannot be read`,
      );
      continue;
    }
    for (const kase of report.cases) {
      const ids = extractIds(`${kase.name}\n${kase.classname}`);
      if (ids.length > 0) observations.push({ suite, ids, status: kase.status });
    }
  }
  return { observations, problems };
}

/**
 * The ac-trace document.
 * @param {Maps} maps
 * @param {string} runName
 * @param {readonly Observation[]} observations
 * @param {readonly string[]} problems
 */
export function buildTrace(maps, runName, observations, problems) {
  /** @type {Map<string, { suites: Set<string>, obs: Set<number> }>} */
  const byId = new Map();
  const orphans = new Set();
  observations.forEach((observation, index) => {
    for (const id of observation.ids) {
      if (!isKnown(id, maps)) {
        orphans.add(id);
        continue;
      }
      const entry = byId.get(id) ?? { suites: new Set(), obs: new Set() };
      entry.suites.add(observation.suite);
      entry.obs.add(index);
      byId.set(id, entry);
    }
  });
  const statsOf = (/** @type {Iterable<number>} */ indices) => {
    let tests = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    for (const i of indices) {
      const status = /** @type {Observation} */ (observations[i]).status;
      tests += 1;
      if (status === 'passed') passed += 1;
      else if (status === 'skipped') skipped += 1;
      else failed += 1;
    }
    return { tests, passed, failed, skipped };
  };
  /** @type {Record<string, IdStats>} */
  const ids = {};
  for (const [id, entry] of byId) {
    const family = /** @type {string} */ (idFamily(id));
    /** @type {IdStats} */
    const stats = { family, suites: [...entry.suites].sort(), ...statsOf(entry.obs) };
    if (family === 'AT') {
      const base = outlineRow(id)?.outline;
      const g3 = maps.at.get(id)?.g3 ?? (base === undefined ? undefined : maps.at.get(base)?.g3);
      stats.g3 = g3 === true;
    }
    ids[id] = stats;
  }
  // Must-AC: the outline ID and its `-<row>` IDs are pooled; covered = at least one test and all of them passed.
  /** @type {Map<string, Set<number>>} */
  const pooled = new Map();
  for (const [id, entry] of byId) {
    const key = outlineRow(id)?.outline ?? id;
    const set = pooled.get(key) ?? new Set();
    for (const i of entry.obs) set.add(i);
    pooled.set(key, set);
  }
  const covered = maps.mustAc.filter((id) => {
    const s = statsOf(pooled.get(id) ?? []);
    return s.tests > 0 && s.passed === s.tests;
  }).length;
  const partOk = (/** @type {string} */ part) => {
    const s = ids[part];
    return s !== undefined && s.passed > 0 && s.failed === 0;
  };
  const verified = maps.nfr.filter((r) => r.run === 'FULL' && r.parts.length > 0 && r.parts.every(partOk)).length;
  const partialEvidence = maps.nfr.filter((r) => r.run !== 'FULL' && r.parts.some((p) => (ids[p]?.passed ?? 0) > 0)).length;
  const secPresent = maps.secAdopted.filter((id) => ids[id] !== undefined);
  const secPassing = secPresent.filter((id) => {
    const s = /** @type {IdStats} */ (ids[id]);
    return s.passed === s.tests;
  });
  return {
    schema_version: 1,
    run: runName,
    maps: maps.sha,
    ids,
    coverage: {
      must_ac: { counted: maps.mustAc.length, covered, ratio: ratio(covered, maps.mustAc.length) },
      nfr: {
        total: maps.nfr.length,
        verified,
        partial_evidence: partialEvidence,
        ratio: ratio(verified + partialEvidence, maps.nfr.length),
      },
      sec_tc: {
        total: maps.secAdopted.length,
        present: secPresent.length,
        passing: secPassing.length,
        ratio: ratio(secPassing.length, maps.secAdopted.length),
      },
    },
    orphans: [...orphans].sort(),
    problems: [...problems].sort(),
  };
}

/**
 * @param {readonly string[]} argv
 * @param {import('./lib/cli.mjs').Io} [io]
 * @returns {number}
 */
export function main(argv, io = CONSOLE_IO) {
  const name = 'quality:trace';
  try {
    const args = parseArgs(argv, ['--root', '--run', '--out'], []);
    const root = resolve(String(args.get('--root') ?? DEFAULT_ROOT));
    const runDir = resolveRunDir(root, args.has('--run') ? String(args.get('--run')) : undefined);
    const out = args.has('--out') ? resolve(String(args.get('--out'))) : join(runDir, TRACE_FILE);
    const maps = loadMaps(root);
    const { observations, problems } = collectRun(root, runDir);
    const trace = buildTrace(maps, basename(runDir), observations, problems);
    writeFileSync(out, stableJson(trace));
    const c = trace.coverage;
    io.out(
      `${name}: ${trace.run}: must-AC ${c.must_ac.covered}/${c.must_ac.counted} (${c.must_ac.ratio}) · NFR ${c.nfr.verified} verified + ${c.nfr.partial_evidence} partial/${c.nfr.total} (${c.nfr.ratio}) · SEC-TC ${c.sec_tc.passing} passing, ${c.sec_tc.present} present/${c.sec_tc.total} (${c.sec_tc.ratio}) · ${Object.keys(trace.ids).length} IDs · ${trace.orphans.length} orphans · ${trace.problems.length} problems`,
    );
    for (const id of trace.orphans) io.err(`${name}: orphan ID ${id} (in a test title, absent from every map)`);
    for (const problem of trace.problems) io.err(`${name}: ${problem}`);
    return trace.orphans.length > 0 || trace.problems.length > 0 ? 1 : 0;
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
