// @ts-check
/**
 * Diff-coverage gate (US-006 / REQ-PLAT-008; TASK-015 sheet: "fails a PR whose changed files are below 85/75 (95 in
 * pricing/audit/authz)"). For each changed source file in the coverage scope, the changed EXECUTABLE lines (added lines
 * that lcov instruments, `DA:`) must be >= the line threshold covered, and the branches recorded on those lines
 * (`BRDA:`) >= the branch threshold. Thresholds come from coverage-gate.mjs COVERAGE_THRESHOLDS (one source).
 *
 * Inputs: `coverage/lcov.info` (jest.config.ts `coverageReporters` includes lcov) and
 * `git diff --unified=0 <base>...<head>` (merge-base diff: only the PR's own changes count).
 *
 * Fail-closed: no `--base` is a usage error; git failing, or git reporting a binary diff for an in-scope file
 * (PR40-SEC-01), is exit 2; a changed in-scope source file that lcov does not
 * know is a failure (it was not measured). A changed file with no executable added line (types, comments, deletions)
 * passes and is listed as such.
 *
 * CLI: node tools/ci/diff-coverage.mjs --base <ref> [--head <ref>] [--lcov <file>] [--root <dir>] [--json]
 * Exit 0 pass, 1 a changed file below threshold or unmeasured, 2 usage/git/lcov error.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { COVERAGE_THRESHOLDS, relativeKey } from './coverage-gate.mjs';

/**
 * @typedef {{ lines: Map<number, number>, branches: Map<number, { total: number, covered: number }> }} FileCoverage
 * @typedef {{ file: string, status: 'ok' | 'below' | 'unmeasured' | 'no-executable-change', lines: { covered: number, total: number },
 *   branches: { covered: number, total: number }, threshold: { lines: number, branches: number }, uncovered: number[] }} FileVerdict
 */

/** Bound on lcov/diff input size (characters). */
const MAX_INPUT_CHARS = 200 * 1024 * 1024;
const GIT_TIMEOUT_MS = 60_000;

/**
 * The jest.config.ts `collectCoverageFrom` scope as a predicate. diff-coverage.test.ts pins the glob list it mirrors,
 * so a change to collectCoverageFrom fails that test until this predicate follows.
 * @param {string} path repository-relative POSIX path
 * @returns {boolean}
 */
export function isCoverageScoped(path) {
  const included = /^(?:apps|packages)\/[^/]+\/(?:src|app)\/.+\.tsx?$/.test(path) || /^prisma\/seed\/.+\.tsx?$/.test(path);
  if (!included) return false;
  if (/\.test\.tsx?$/.test(path) || path.endsWith('.d.ts')) return false;
  if (path === 'apps/api/src/modules/index.generated.ts' || path === 'packages/shared/src/api/types.gen.ts') return false;
  if (/(?:^|\/)(?:tests|fixtures|\.react-router)\//.test(path)) return false;
  if (path.startsWith('prisma/generated/')) return false;
  if (/^packages\/[^/]+\/src\/index\.ts$/.test(path)) return false;
  if (/^apps\/[^/]+\/app\/(?:entry\.server\.tsx|routes\.ts)$/.test(path)) return false;
  return true;
}

/**
 * Thresholds for one file: 95/95 inside a critical package, else the overall 85/75.
 * @param {string} path
 * @returns {{ lines: number, branches: number }}
 */
export function thresholdFor(path) {
  const critical = COVERAGE_THRESHOLDS.critical.find((c) => path.startsWith(`${c.scope}/`));
  return critical === undefined ? { ...COVERAGE_THRESHOLDS.overall } : { lines: critical.lines, branches: critical.branches };
}

/**
 * @param {string} text lcov.info contents
 * @param {string} root repository root (SF paths are made relative to it)
 * @returns {Map<string, FileCoverage>}
 */
export function parseLcov(text, root) {
  if (text.length > MAX_INPUT_CHARS) throw new Error('lcov input is too large');
  /** @type {Map<string, FileCoverage>} */
  const files = new Map();
  /** @type {FileCoverage | null} */
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      current = { lines: new Map(), branches: new Map() };
      files.set(relativeKey(line.slice(3), root), current);
    } else if (line === 'end_of_record') current = null;
    else if (current !== null && line.startsWith('DA:')) {
      const [ln, hits] = line.slice(3).split(',');
      const n = Number(ln);
      const h = Number(hits);
      if (!Number.isInteger(n) || !Number.isFinite(h)) throw new Error(`malformed lcov line: ${line.slice(0, 80)}`);
      current.lines.set(n, Math.max(current.lines.get(n) ?? 0, h));
    } else if (current !== null && line.startsWith('BRDA:')) {
      const parts = line.slice(5).split(',');
      const n = Number(parts[0]);
      if (parts.length !== 4 || !Number.isInteger(n)) throw new Error(`malformed lcov line: ${line.slice(0, 80)}`);
      const taken = parts[3] === '-' ? 0 : Number(parts[3]);
      const acc = current.branches.get(n) ?? { total: 0, covered: 0 };
      acc.total += 1;
      if (taken > 0) acc.covered += 1;
      current.branches.set(n, acc);
    }
  }
  return files;
}

/**
 * The path of a `diff --git a/<path> b/<path>` header (renames are off, so both sides name one path), else null.
 * @param {string} line
 * @returns {string | null}
 */
function headerPath(line) {
  const rest = line.slice('diff --git '.length);
  const length = (rest.length - 5) / 2;
  if (!Number.isInteger(length) || length < 1) return null;
  const path = rest.slice(2, 2 + length);
  return rest === `a/${path} b/${path}` ? path : null;
}

/**
 * Added line numbers per new-side path from `git diff --unified=0` output.
 *
 * Fail-closed (PR40-SEC-01): a `Binary files ... differ` line for a coverage-scoped path (or for a file whose header
 * cannot be read) throws, because its changed lines would otherwise count as no change at all. gitDiff passes
 * `--text --no-textconv`, so a `.gitattributes` `-diff` or `binary` setting cannot produce such a line any more; this is
 * the second line of defence.
 * @param {string} text
 * @returns {Map<string, Set<number>>}
 */
export function parseUnifiedDiff(text) {
  if (text.length > MAX_INPUT_CHARS) throw new Error('diff input is too large');
  /** @type {Map<string, Set<number>>} */
  const files = new Map();
  /** @type {Set<number> | null} */
  let current = null;
  /** @type {string | null} */
  let header = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      header = headerPath(line);
      current = null;
      continue;
    }
    if (line.startsWith('Binary files ') && line.endsWith(' differ')) {
      if (header === null || isCoverageScoped(header))
        throw new Error(`git reported a binary diff for ${header ?? 'a file it did not name'}: its changed lines cannot be measured`);
      continue;
    }
    if (line.startsWith('+++ ')) {
      const target = line.slice(4);
      if (target === '/dev/null') current = null;
      else {
        const path = target.startsWith('b/') ? target.slice(2) : target;
        current = files.get(path) ?? new Set();
        files.set(path, current);
      }
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk !== null && current !== null) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let i = 0; i < count; i += 1) current.add(start + i);
    }
  }
  return files;
}

/**
 * Pure verdicts for every changed, coverage-scoped file.
 * @param {Map<string, Set<number>>} changed
 * @param {Map<string, FileCoverage>} coverage
 * @returns {FileVerdict[]}
 */
export function evaluateDiffCoverage(changed, coverage) {
  /** @type {FileVerdict[]} */
  const verdicts = [];
  for (const [file, added] of [...changed.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!isCoverageScoped(file) || added.size === 0) continue;
    const threshold = thresholdFor(file);
    const cov = coverage.get(file);
    const lines = { covered: 0, total: 0 };
    const branches = { covered: 0, total: 0 };
    /** @type {number[]} */
    const uncovered = [];
    if (cov === undefined) {
      verdicts.push({ file, status: 'unmeasured', lines, branches, threshold, uncovered });
      continue;
    }
    for (const ln of [...added].sort((a, b) => a - b)) {
      const hits = cov.lines.get(ln);
      if (hits !== undefined) {
        lines.total += 1;
        if (hits > 0) lines.covered += 1;
        else uncovered.push(ln);
      }
      const br = cov.branches.get(ln);
      if (br !== undefined) {
        branches.total += br.total;
        branches.covered += br.covered;
      }
    }
    const pct = (/** @type {{ covered: number, total: number }} */ c) => (c.total === 0 ? 100 : (c.covered * 100) / c.total);
    const status =
      lines.total === 0 && branches.total === 0
        ? 'no-executable-change'
        : pct(lines) >= threshold.lines && pct(branches) >= threshold.branches
          ? 'ok'
          : 'below';
    verdicts.push({ file, status, lines, branches, threshold, uncovered });
  }
  return verdicts;
}

/**
 * `git diff --unified=0 <base>...<head>` in `root`, limited to TypeScript files (every coverage-scoped file is one).
 * `--text --no-textconv` and explicit `a/` / `b/` prefixes make the output independent of `.gitattributes` (`-diff`,
 * `binary`, a textconv driver) and of the operator's git configuration (`diff.noprefix`, `diff.dstPrefix`,
 * `diff.mnemonicPrefix`) (PR40-SEC-01).
 * @param {string} root
 * @param {string} base
 * @param {string} head
 * @returns {string}
 */
export function gitDiff(root, base, head) {
  for (const ref of [base, head]) if (ref.startsWith('-') || /[\s\0]/.test(ref)) throw new Error(`refusing git ref ${JSON.stringify(ref)}`);
  const result = spawnSync(
    'git',
    [
      '-c',
      'core.quotePath=false',
      'diff',
      '--unified=0',
      '--no-color',
      '--no-ext-diff',
      '--no-renames',
      '--text',
      '--no-textconv',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--diff-filter=AM',
      `${base}...${head}`,
      '--',
      ':(glob)**/*.ts',
      ':(glob)**/*.tsx',
    ],
    { cwd: root, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: MAX_INPUT_CHARS },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git diff failed (exit ${String(result.status)}): ${result.stderr.trim()}`);
  return result.stdout;
}

/** @param {{ covered: number, total: number }} c */
const fmt = (c) => (c.total === 0 ? 'n/a' : `${((c.covered * 100) / c.total).toFixed(2)}% (${c.covered}/${c.total})`);

/** @param {string[]} argv @returns {number} */
export function main(argv) {
  /** @type {Record<string, string | undefined>} */
  const opts = { root: undefined, base: undefined, head: undefined, lcov: undefined };
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const key = arg.startsWith('--') ? arg.slice(2) : '';
    if (arg === '--json') json = true;
    else if (key in opts) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        console.error(`diff-coverage: ${arg} needs a value`);
        return 2;
      }
      opts[key] = value;
      i += 1;
    } else {
      console.error(`diff-coverage: unknown argument ${arg}`);
      return 2;
    }
  }
  if (opts['base'] === undefined) {
    console.error('diff-coverage: --base <ref> is required (fail closed: no base, no verdict)');
    return 2;
  }
  const root = resolve(opts['root'] ?? process.cwd());
  let verdicts;
  try {
    const lcov = parseLcov(readFileSync(resolve(root, opts['lcov'] ?? join('coverage', 'lcov.info')), 'utf8'), root);
    verdicts = evaluateDiffCoverage(parseUnifiedDiff(gitDiff(root, opts['base'], opts['head'] ?? 'HEAD')), lcov);
  } catch (error) {
    console.error(`diff-coverage: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const failing = verdicts.filter((v) => v.status === 'below' || v.status === 'unmeasured');
  if (json) console.log(JSON.stringify({ ok: failing.length === 0, verdicts }, null, 2));
  else {
    for (const v of verdicts)
      console.log(
        `diff-coverage: ${v.status === 'ok' || v.status === 'no-executable-change' ? 'ok  ' : 'FAIL'} ${v.file} [${v.status}] ` +
          `lines ${fmt(v.lines)} (>= ${v.threshold.lines}%), branches ${fmt(v.branches)} (>= ${v.threshold.branches}%)` +
          (v.uncovered.length > 0 ? ` uncovered: ${v.uncovered.slice(0, 20).join(',')}${v.uncovered.length > 20 ? ',...' : ''}` : ''),
      );
    console.log(
      failing.length === 0
        ? `diff-coverage: PASS (${verdicts.length} changed source file(s))`
        : `diff-coverage: FAIL ${failing.map((v) => v.file).join(', ')}`,
    );
  }
  return failing.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
