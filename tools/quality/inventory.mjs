// @ts-check
/**
 * Lane C inventory cross-check (ADR-0023 amendment G item 6; TEST-STRATEGY sections 9.1, 13 item 4 and 15 item 3;
 * SEC-TC-48; TASK-015 part 015-B).
 *
 * Lane C writes `inventory.json`: per manifest suite, the tests it ran on Linux, per test file. It is compared with the
 * lane B evidence committed in the repository (`docs/05-quality/tests/runs/<stamp>_<sha7>/`):
 *   - reference runs: with `--since <rev>`, every lane B run directory added in `<since>..<sha>` (the wave's merges);
 *     without it, the newest run directory in the tree (lane B evidence is taken on PR branch commits that are
 *     squash-merged, so a run's `git_sha` is usually not an ancestor of main). inventory.json records the scope
 *     (`references_scope`: `since:<sha>` or `newest-only`); a `wave-end` run without `--since` compares one run only,
 *     which ADR-0023 am. G item 6 ("every lane B evidence merged during the wave") does not intend, so the summary
 *     carries a WARNING line (code review PR #46 m6);
 *   - only `active` suites of the manifest with a Jest runner entry are compared (counted from the lane C Jest JSON
 *     reports through the suite-runners.json projects and paths, the lane B definition); lane B harness cases (the
 *     coverage gate and merge cases, classname = suite id) are not tests of a file and are left out;
 *   - discrepancies: `missing-suite` (a reference run has tests in a suite lane C ran none of), and, for a reference run
 *     of the SAME CODE (the run's `git_sha` is in the clone and differs from the lane C SHA only under docs/ and .claude/,
 *     the lane A staleness rule), `lower-count` (a file with fewer tests on Linux) and `linux-fail` (a file whose tests passed in
 *     lane B and failed in lane C). Any discrepancy fails the wave end (incident in DECISIONS.md, revert of the PR).
 * Playwright JUnit reports (lane C e2e-stack shards, `--playwright <dir>`) are inventoried per engine for the record;
 * they are compared once lane B has e2e runner entries.
 *
 * CLI: node tools/quality/inventory.mjs --root <repo> --jest <dir> [--playwright <dir>] [--sha <rev>] [--since <rev>]
 *        --profile wave-end|release-candidate --out <inventory.json> [--summary <$GITHUB_STEP_SUMMARY>]
 * Exit 0 consistent, 1 discrepancies, 2 usage or input error.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseRunners } from './heavy.mjs';
import { parseJUnit } from './lib/junit.mjs';
import { parseManifest } from './lib/manifest.mjs';

export const RUNS_DIR = 'docs/05-quality/tests/runs';
export const PROFILES = Object.freeze(['wave-end', 'release-candidate']);

/**
 * @typedef {{ tests: number, failures: number, skipped: number }} Count
 * @typedef {Record<string, Count>} FileCounts per repository-relative test file
 * @typedef {{ suite: string, kind: 'missing-suite' | 'lower-count' | 'linux-fail', run: string, detail: string }} Discrepancy
 */

/**
 * Jest projects of a test file, mirroring the testMatch / testPathIgnorePatterns of jest.config.ts.
 * @param {string} path repository-relative, `/`-separated
 * @returns {string[]}
 */
export function projectsOf(path) {
  // IGNORED_PATHS of jest.config.ts (every project).
  if (/(^|\/)(node_modules|dist|build|fixtures)\//u.test(path)) return [];
  const out = [];
  const intOrApi = /\.(int|api)\.test\.tsx?$/u.test(path);
  // GENERATED_PATH: `integration` and `api` ignore tests/generated/ (the `generated` project runs those suites);
  // `unit` and `unit-dom` do not (a plain *.test.ts there is a unit suite).
  const generated = /(^|\/)tests\/generated\//u.test(path);
  if (/\.test\.ts$/u.test(path) && !intOrApi && !path.startsWith('tests/e2e/')) out.push('unit');
  if (/\.test\.tsx$/u.test(path) && !intOrApi && !path.startsWith('tests/e2e/')) out.push('unit-dom');
  if (/\.int\.test\.tsx?$/u.test(path) && !generated) out.push('integration');
  if (/\.api\.test\.tsx?$/u.test(path) && !generated) out.push('api');
  if (generated && /\.(api|int)\.test\.tsx?$/u.test(path)) out.push('generated');
  return out;
}

/**
 * @param {string} path
 * @param {{ projects: readonly string[], paths: readonly string[] }} runner
 */
export function fileInSuite(path, runner) {
  const projects = projectsOf(path);
  if (!runner.projects.some((p) => projects.includes(p))) return false;
  return runner.paths.length === 0 || runner.paths.some((p) => path.includes(p));
}

/**
 * Per-file counts from Jest `--json` reports. One report counts every test case, including cases of one file that share
 * a full name (lane B JUnit keeps each of them, code review PR #46 M1); a test seen in several reports (the same file run
 * by two projects or shards) counts as often as the report with the most occurrences, not once per report. Failed wins:
 * a (file, full name) failed in any report keeps that report's failure count.
 * @param {readonly unknown[]} reports
 * @param {string} root
 * @returns {FileCounts}
 */
export function jestFileCounts(reports, root) {
  /** @type {Map<string, Count>} merged over reports */
  const merged = new Map();
  for (const report of reports) {
    const results = /** @type {{ testResults?: { name: string, assertionResults: { fullName: string, status: string }[] }[] }} */ (report)
      .testResults;
    if (!Array.isArray(results)) throw new Error('a Jest report has no testResults');
    /** @type {Map<string, Count>} this report's multiplicity per (file, full name) */
    const local = new Map();
    for (const file of results) {
      const rel = relative(root, file.name).replaceAll('\\', '/');
      for (const a of file.assertionResults) {
        const key = `${rel}\0${a.fullName}`;
        const c = local.get(key) ?? { tests: 0, failures: 0, skipped: 0 };
        c.tests += 1;
        if (a.status === 'failed') c.failures += 1;
        if (a.status === 'pending' || a.status === 'skipped' || a.status === 'todo') c.skipped += 1;
        local.set(key, c);
      }
    }
    for (const [key, c] of local) {
      const prev = merged.get(key);
      if (prev === undefined) merged.set(key, { ...c });
      else {
        // The first report with the most occurrences sets the skip count; failures are the most seen in any report.
        if (c.tests > prev.tests) {
          prev.tests = c.tests;
          prev.skipped = c.skipped;
        }
        prev.failures = Math.max(prev.failures, c.failures);
      }
    }
  }
  /** @type {FileCounts} */
  const out = {};
  for (const [key, c] of merged) {
    const file = /** @type {string} */ (key.split('\0')[0]);
    const entry = (out[file] ??= { tests: 0, failures: 0, skipped: 0 });
    const failures = Math.min(c.failures, c.tests);
    entry.tests += c.tests;
    entry.failures += failures;
    entry.skipped += Math.min(c.skipped, c.tests - failures);
  }
  return out;
}

/**
 * Per-file counts of a lane B suite JUnit; harness cases (classname without a `/`, e.g. the coverage gate) are left out.
 * @param {string} xml
 * @returns {FileCounts}
 */
export function junitFileCounts(xml) {
  /** @type {FileCounts} */
  const out = {};
  for (const c of parseJUnit(xml).cases) {
    if (!c.classname.includes('/')) continue;
    const entry = (out[c.classname] ??= { tests: 0, failures: 0, skipped: 0 });
    entry.tests += 1;
    if (c.status === 'failed' || c.status === 'error') entry.failures += 1;
    if (c.status === 'skipped') entry.skipped += 1;
  }
  return out;
}

/**
 * Playwright JUnit (one file or several): unique tests per engine (`hostname` = project), so `--repeat-each` counts once.
 * @param {readonly string[]} xmls
 * @returns {Record<string, { projects: string[], tests: number, failures: number }>}
 */
export function playwrightCounts(xmls) {
  /** @type {Map<string, { projects: Set<string>, tests: Set<string>, failed: Set<string> }>} */
  const engines = new Map();
  for (const xml of xmls) {
    for (const suite of xml.matchAll(/<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/gu)) {
      const project = /\bhostname="([^"]*)"/u.exec(suite[1] ?? '')?.[1] ?? '';
      const engine = project.split('-')[0] ?? '';
      if (engine === '') continue;
      const entry = engines.get(engine) ?? { projects: new Set(), tests: new Set(), failed: new Set() };
      entry.projects.add(project);
      for (const tc of (suite[2] ?? '').matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/gu)) {
        const name = /\bname="([^"]*)"/u.exec(tc[1] ?? '')?.[1] ?? '';
        const cls = /\bclassname="([^"]*)"/u.exec(tc[1] ?? '')?.[1] ?? '';
        const key = `${project}\0${cls}\0${name}`;
        entry.tests.add(key);
        if (/<(failure|error)\b/u.test(tc[3] ?? '')) entry.failed.add(key);
      }
      engines.set(engine, entry);
    }
  }
  return Object.fromEntries(
    [...engines.entries()].map(([engine, e]) => [
      `e2e-${engine}`,
      { projects: [...e.projects].sort(), tests: e.tests.size, failures: e.failed.size },
    ]),
  );
}

/**
 * @param {FileCounts} counts
 */
const total = (counts) =>
  Object.values(counts).reduce(
    (a, c) => ({ tests: a.tests + c.tests, failures: a.failures + c.failures, skipped: a.skipped + c.skipped }),
    {
      tests: 0,
      failures: 0,
      skipped: 0,
    },
  );

/**
 * @param {{ laneC: Record<string, FileCounts>, references: { run: string, same_code: boolean, suites: Record<string, FileCounts> }[] }} input
 * @returns {Discrepancy[]}
 */
export function compare({ laneC, references }) {
  /** @type {Discrepancy[]} */
  const out = [];
  for (const ref of references) {
    for (const [suite, bFiles] of Object.entries(ref.suites)) {
      const cFiles = laneC[suite];
      if (cFiles === undefined) continue;
      if (total(bFiles).tests > 0 && total(cFiles).tests === 0) {
        out.push({ suite, kind: 'missing-suite', run: ref.run, detail: `lane B ran ${String(total(bFiles).tests)} tests, lane C none` });
        continue;
      }
      if (!ref.same_code) continue;
      for (const [file, b] of Object.entries(bFiles)) {
        const c = cFiles[file] ?? { tests: 0, failures: 0, skipped: 0 };
        if (c.tests < b.tests)
          out.push({
            suite,
            kind: 'lower-count',
            run: ref.run,
            detail: `${file}: ${String(c.tests)} on Linux, ${String(b.tests)} in lane B`,
          });
        if (b.failures === 0 && c.failures > 0)
          out.push({ suite, kind: 'linux-fail', run: ref.run, detail: `${file}: ${String(c.failures)} failed on Linux, passed in lane B` });
      }
    }
  }
  return out;
}

/**
 * @param {string} root
 * @param {string[]} args
 */
function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout ?? '' };
}

/**
 * True when the lane B run's commit is in the clone and its code equals the lane C SHA's (only docs/ or .claude/ differ).
 * @param {string} root
 * @param {string} runSha
 * @param {string} sha
 */
export function sameCode(root, runSha, sha) {
  if (!/^[0-9a-f]{40}$/u.test(runSha) || !git(root, ['cat-file', '-e', `${runSha}^{commit}`]).ok) return false;
  return (
    spawnSync('git', ['diff', '--quiet', '--no-ext-diff', '--no-textconv', runSha, sha, '--', '.', ':(exclude)docs', ':(exclude).claude'], {
      cwd: root,
      windowsHide: true,
    }).status === 0
  );
}

/**
 * Lane B run directories to compare with (see the header).
 * @param {string} root
 * @param {string} sha
 * @param {string | undefined} since
 * @returns {string[]} run directory names
 */
export function referenceRuns(root, sha, since) {
  if (since !== undefined) {
    const log = git(root, ['log', '--format=', '--name-only', '--diff-filter=A', `${since}..${sha}`, '--', `${RUNS_DIR}/*/summary.json`]);
    if (!log.ok) throw new Error(`--since ${since}: not a revision of this repository`);
    return [
      ...new Set(
        log.out
          .split('\n')
          .filter((l) => l.endsWith('/summary.json'))
          .map((l) => l.split('/').slice(-2)[0] ?? ''),
      ),
    ].sort();
  }
  const dir = join(root, ...RUNS_DIR.split('/'));
  if (!existsSync(dir)) return [];
  const newest = readdirSync(dir)
    .filter((name) => /^\d{8}T\d{4,6}Z_[0-9a-f]{7}$/u.test(name) && existsSync(join(dir, name, 'summary.json')))
    .sort()
    .pop();
  return newest === undefined ? [] : [newest];
}

/**
 * @param {readonly string[]} argv
 * @returns {number}
 */
export function main(argv) {
  /** @type {Record<string, string>} */
  const v = {};
  const valued = new Set(['--root', '--jest', '--playwright', '--sha', '--since', '--profile', '--out', '--summary']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = /** @type {string} */ (argv[i]);
    if (!valued.has(arg) || i + 1 >= argv.length) {
      console.error(`inventory: unknown or incomplete argument ${arg}`);
      return 2;
    }
    v[arg] = /** @type {string} */ (argv[i + 1]);
    i += 1;
  }
  if (v['--root'] === undefined || v['--jest'] === undefined || v['--out'] === undefined || !PROFILES.includes(v['--profile'] ?? '')) {
    console.error(`inventory: --root, --jest, --out and --profile ${PROFILES.join('|')} are required`);
    return 2;
  }
  if (v['--since'] !== undefined && !/^[0-9a-f]{7,40}$/u.test(v['--since'])) {
    console.error('inventory: --since must be a commit SHA');
    return 2;
  }
  const root = resolve(v['--root']);
  try {
    const sha = git(root, ['rev-parse', '--verify', `${v['--sha'] ?? 'HEAD'}^{commit}`]).out.trim();
    if (!/^[0-9a-f]{40}$/u.test(sha)) throw new Error('--sha is not a commit');
    const manifest = parseManifest(JSON.parse(readFileSync(join(root, 'tools', 'quality', 'required-suites.json'), 'utf8')));
    const runners = parseRunners(JSON.parse(readFileSync(join(root, 'tools', 'quality', 'suite-runners.json'), 'utf8')));
    const jestDir = resolve(v['--jest']);
    const reports = readdirSync(jestDir)
      .filter((f) => f.endsWith('.jest.json'))
      .map((f) => /** @type {unknown} */ (JSON.parse(readFileSync(join(jestDir, f), 'utf8'))));
    if (reports.length === 0) throw new Error(`no *.jest.json report in ${v['--jest']}`);
    const files = jestFileCounts(reports, root);
    /** @type {Record<string, FileCounts>} */
    const laneC = {};
    /** @type {string[]} */
    const notInventoried = [];
    for (const [id, suite] of Object.entries(manifest.suites)) {
      if (suite.status !== 'active') continue;
      const runner = runners.suites[id];
      if (runner?.kind !== 'jest' || runner.testNamePattern !== undefined) {
        notInventoried.push(id);
        continue;
      }
      laneC[id] = Object.fromEntries(Object.entries(files).filter(([file]) => fileInSuite(file, runner)));
    }
    const runs = referenceRuns(root, sha, v['--since']);
    const references = runs.map((run) => {
      const dir = join(root, ...RUNS_DIR.split('/'), run);
      const summary = /** @type {{ git_sha: string, profile: string, suites: { name: string, report: string }[] }} */ (
        JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'))
      );
      /** @type {Record<string, FileCounts>} */
      const suites = {};
      for (const s of summary.suites) {
        const report = join(dir, s.report);
        if (existsSync(report)) suites[s.name] = junitFileCounts(readFileSync(report, 'utf8'));
      }
      return { run, git_sha: summary.git_sha, profile: summary.profile, same_code: sameCode(root, summary.git_sha, sha), suites };
    });
    const discrepancies = compare({ laneC, references });
    const since = v['--since'];
    const referencesScope = since === undefined ? 'newest-only' : `since:${since}`;
    const scopeWarning =
      since === undefined && v['--profile'] === 'wave-end'
        ? 'WARNING: wave-end without --since compares the newest lane B run only (references_scope newest-only), not every run merged during the wave (ADR-0023 am. G item 6)'
        : undefined;
    const playwrightDir = v['--playwright'];
    const e2e =
      playwrightDir !== undefined && existsSync(playwrightDir)
        ? playwrightCounts(
            readdirSync(playwrightDir)
              .filter((f) => f.endsWith('.xml'))
              .map((f) => readFileSync(join(playwrightDir, f), 'utf8')),
          )
        : {};
    const inventory = {
      schema_version: 1,
      lane: 'C',
      profile: v['--profile'],
      git_sha: sha,
      generated_at: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
      suites: Object.fromEntries(Object.entries(laneC).map(([id, f]) => [id, { ...total(f), files: Object.keys(f).length }])),
      e2e,
      not_inventoried: notInventoried,
      references_scope: referencesScope,
      references: references.map((r) => ({ run: r.run, git_sha: r.git_sha, profile: r.profile, same_code: r.same_code })),
      discrepancies,
      verdict: discrepancies.length === 0 ? 'CONSISTENT' : 'DISCREPANCY',
    };
    mkdirSync(dirname(resolve(v['--out'])), { recursive: true });
    writeFileSync(v['--out'], `${JSON.stringify(inventory, null, 2)}\n`);
    const lines = [
      `### Lane C inventory: ${inventory.verdict}`,
      '',
      `References (${referencesScope}): ${references.length === 0 ? 'none (no lane B run reachable)' : references.map((r) => `\`${r.run}\``).join(', ')}`,
      '',
      ...(scopeWarning === undefined ? [] : [`**${scopeWarning}**`, '']),
      '| Suite | Tests | Failures | Skipped | Files |',
      '|---|---|---|---|---|',
      ...Object.entries(inventory.suites).map(
        ([id, c]) => `| \`${id}\` | ${String(c.tests)} | ${String(c.failures)} | ${String(c.skipped)} | ${String(c.files)} |`,
      ),
      ...Object.entries(e2e).map(
        ([id, c]) => `| \`${id}\` (${c.projects.join(', ')}) | ${String(c.tests)} | ${String(c.failures)} | – | – |`,
      ),
      '',
      ...discrepancies.map((d) => `- **${d.kind}** \`${d.suite}\` vs \`${d.run}\`: ${d.detail}`),
      '',
    ];
    console.log(lines.join('\n'));
    if (v['--summary'] !== undefined) appendFileSync(v['--summary'], lines.join('\n'));
    return discrepancies.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(`inventory: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
