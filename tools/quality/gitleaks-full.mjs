// @ts-check
/**
 * `gitleaks-full` suite runner: Gitleaks over the full history of the gate commit (lanes B and C; manifest suite
 * `gitleaks-full`; PR25-SEC-01 runner half and PR33-SEC-08; D-TASK015-02; D-SEC-PR25-01 as clarified by D-SEC-PR45-01;
 * TASK-015 part 015-B).
 *
 * 1. Configuration and baseline come from `--ref` (the run's base ref in lane B, the gate SHA in lanes C and nightly)
 *    through `git show`, never from the working tree: `.gitleaks.toml` (the SAME file lane A's range scan reads from the
 *    base ref, D-SEC-PR45-01) and tools/quality/gitleaks-baseline.txt (the PR25-SEC-01 exact-fingerprint list).
 * 2. Every non-comment baseline line must match BASELINE_LINE (`<40-hex commit>:<path>:generic-api-key:<line>`, the
 *    regex tools/ci/sec-static.test.ts pins) and the count must equal BASELINE_COUNT, before anything is mounted. A
 *    commit-less or path-only line would silence every commit at that path (the class D-SEC-PR45-01 forbids), so it is
 *    rejected and the scan does not start.
 * 3. Only the validated lines are written to a fresh temporary file, mounted read-only with `--gitleaks-ignore-path`;
 *    the config is mounted read-only; the repository's git directory (the common dir, so a worktree works) is mounted
 *    read-only as `/repo/.git` and no working tree is mounted (gitleaks would auto-load `<source>/.gitleaksignore`).
 * 4. The scan covers the ancestry of the gate commit (`--log-opts=--diff-merges=first-parent <sha>`), not `--all`;
 *    `--network none`, `--ignore-gitleaks-allow` (inline allow markers are inert), `--redact`, `--exit-code 1`.
 *
 * quality:heavy runs it as a `command` suite (tools/quality/suite-runners.json, converter `gitleaks`, native report
 * `gitleaks-full.json`); lane C and nightly.yml run the CLI directly.
 *
 * CLI: node tools/quality/gitleaks-full.mjs --root <repo> --ref <rev> --report <file> [--scan <rev>]
 * Exit 0 no findings, 1 findings (report written), 2 configuration, baseline, git or docker error.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Same image and digest as ci.yml `GITLEAKS_IMAGE` (gitleaks-full.test.ts pins the equality). */
export const GITLEAKS_IMAGE = 'ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f';
export const CONFIG_PATH = '.gitleaks.toml';
export const BASELINE_PATH = 'tools/quality/gitleaks-baseline.txt';
/** One exact fingerprint (commit AND path AND rule AND line); the sec-static pin uses the same pattern. */
export const BASELINE_LINE = /^[0-9a-f]{40}:[^:\s]+:generic-api-key:[1-9]\d*$/u;
/** PR25-SEC-01: the 17 recorded fingerprints; a different count is a reviewed change of this constant. */
export const BASELINE_COUNT = 17;
const SHA = /^[0-9a-f]{40}$/u;
const SCAN_TIMEOUT_MS = 30 * 60_000;

export class BaselineError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'BaselineError';
  }
}

/**
 * The fingerprints of a baseline text, validated line by line and by count. Comment (`#`) and blank lines are dropped.
 * @param {string} text
 * @param {{ count: number }} options
 * @returns {string[]}
 */
export function validateBaseline(text, { count }) {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line !== '' && !line.startsWith('#'));
  for (const [index, line] of lines.entries()) {
    if (!BASELINE_LINE.test(line))
      throw new BaselineError(
        `baseline entry ${String(index + 1)} is not an exact <40-hex commit>:<path>:generic-api-key:<line> fingerprint (rejected before the scan)`,
      );
  }
  if (new Set(lines).size !== lines.length) throw new BaselineError('baseline holds a duplicate fingerprint (rejected before the scan)');
  if (lines.length !== count)
    throw new BaselineError(
      `baseline holds ${String(lines.length)} fingerprints, exactly ${String(count)} expected (rejected before the scan)`,
    );
  return lines;
}

/**
 * The `docker` argument list of one scan (exported for the unit test).
 * @param {{ gitDir: string, configFile: string, baselineFile: string, outDir: string, sha: string, image?: string }} input
 * @returns {string[]}
 */
export function dockerArgs({ gitDir, configFile, baselineFile, outDir, sha, image = GITLEAKS_IMAGE }) {
  if (!SHA.test(sha)) throw new Error('the scanned commit must be a full 40-hex SHA');
  const bind = (/** @type {string} */ src, /** @type {string} */ dst, /** @type {boolean} */ readonly) =>
    `type=bind,src=${src},dst=${dst}${readonly ? ',readonly' : ''}`;
  return [
    'run',
    '--rm',
    '--network',
    'none',
    '--mount',
    bind(gitDir, '/repo/.git', true),
    '--mount',
    bind(configFile, '/config/gitleaks.toml', true),
    '--mount',
    bind(baselineFile, '/config/baseline.txt', true),
    '--mount',
    bind(outDir, '/out', false),
    '-e',
    'GIT_CONFIG_COUNT=1',
    '-e',
    'GIT_CONFIG_KEY_0=safe.directory',
    '-e',
    'GIT_CONFIG_VALUE_0=/repo',
    image,
    'git',
    '/repo',
    '--config',
    '/config/gitleaks.toml',
    '--gitleaks-ignore-path',
    '/config/baseline.txt',
    `--log-opts=--diff-merges=first-parent ${sha}`,
    '--ignore-gitleaks-allow',
    '--redact',
    '--no-banner',
    '--exit-code',
    '1',
    '--report-format',
    'json',
    '--report-path',
    '/out/gitleaks-full.json',
  ];
}

/**
 * @param {string} root
 * @param {string[]} args
 */
function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args[0] ?? ''} failed: ${(r.stderr || '').trim().split('\n')[0] ?? ''}`);
  return r.stdout;
}

/**
 * Scans the ancestry of `sha` with the given config and validated baseline lines; writes the native report.
 * @param {{ root: string, sha: string, configText: string, baselineLines: readonly string[], report: string, image?: string }} input
 * @returns {{ status: 'clean' | 'findings', findings: number }}
 */
export function scan({ root, sha, configText, baselineLines, report, image = GITLEAKS_IMAGE }) {
  const gitDir = resolve(root, git(root, ['rev-parse', '--git-common-dir']).trim());
  const work = mkdtempSync(join(tmpdir(), 'gitleaks-full-'));
  try {
    const configFile = join(work, 'gitleaks.toml');
    const baselineFile = join(work, 'baseline.txt');
    const outDir = join(work, 'out');
    mkdirSync(outDir, { mode: 0o777 });
    writeFileSync(configFile, configText, { mode: 0o644 });
    writeFileSync(baselineFile, `${baselineLines.join('\n')}\n`, { mode: 0o644 });
    const r = spawnSync('docker', dockerArgs({ gitDir, configFile, baselineFile, outDir, sha, image }), {
      encoding: 'utf8',
      windowsHide: true,
      timeout: SCAN_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    });
    const native = join(outDir, 'gitleaks-full.json');
    if ((r.status !== 0 && r.status !== 1) || !existsSync(native))
      throw new Error(`gitleaks did not complete (exit ${String(r.status)}): ${(r.stderr || '').trim().split('\n').slice(-1)[0] ?? ''}`);
    mkdirSync(dirname(report), { recursive: true });
    copyFileSync(native, report);
    const findings = /** @type {unknown} */ (JSON.parse(readFileSync(native, 'utf8')));
    const count = Array.isArray(findings) ? findings.length : -1;
    if (count < 0) throw new Error('gitleaks report is not a findings array');
    return { status: r.status === 0 && count === 0 ? 'clean' : 'findings', findings: count };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * @param {readonly string[]} argv
 * @returns {number}
 */
export function main(argv) {
  /** @type {Record<string, string>} */
  const values = {};
  const valued = new Set(['--root', '--ref', '--report', '--scan']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = /** @type {string} */ (argv[i]);
    if (!valued.has(arg) || i + 1 >= argv.length) {
      console.error(`gitleaks-full: unknown or incomplete argument ${arg}`);
      return 2;
    }
    values[arg] = /** @type {string} */ (argv[i + 1]);
    i += 1;
  }
  const { '--root': rootArg, '--ref': ref, '--report': reportArg } = values;
  if (rootArg === undefined || ref === undefined || reportArg === undefined) {
    console.error('gitleaks-full: --root, --ref and --report are required');
    return 2;
  }
  const root = resolve(rootArg);
  const report = isAbsolute(reportArg) ? reportArg : resolve(root, reportArg);
  try {
    const sha = git(root, ['rev-parse', '--verify', '--end-of-options', `${values['--scan'] ?? 'HEAD'}^{commit}`]).trim();
    const configRef = git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
    const configText = git(root, ['show', `${configRef}:${CONFIG_PATH}`]);
    const baselineLines = validateBaseline(git(root, ['show', `${configRef}:${BASELINE_PATH}`]), { count: BASELINE_COUNT });
    console.log(
      `gitleaks-full: ancestry of ${sha.slice(0, 12)}; config and ${String(baselineLines.length)}-line baseline from ${configRef.slice(0, 12)}`,
    );
    const result = scan({ root, sha, configText, baselineLines, report });
    console.log(`gitleaks-full: ${result.status} (${String(result.findings)} finding(s)); report ${reportArg}`);
    return result.status === 'clean' ? 0 : 1;
  } catch (error) {
    console.error(`gitleaks-full: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
