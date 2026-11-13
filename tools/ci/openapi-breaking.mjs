/**
 * OpenAPI breaking-change gate (NFR-MAINT-004; PR #21 code review R1-m6; D-ORCH-023 (1); D-ARCH-084; api/README §1
 * and §18 item 3). Lane A, job `scans`, run from the base ref like every gate tool (SEC-P3-31).
 *
 * Compares `docs/03-architecture/api/openapi.yaml` at the PR head with the same file at the latest release tag (the
 * first line of `git tag --list 'v*' --sort=-v:refname`). Both versions come from git objects (`git show`), never from
 * the working tree, and are written to a private temporary folder that is bind-mounted read-only into a digest-pinned
 * oasdiff container running with no network, a read-only root file system, no capabilities and a non-root user.
 *
 * Decision:
 * - no release tag: prints `no release tag` and passes (exit 0);
 * - oasdiff `breaking` reports no ERR-level change: pass;
 * - ERR-level changes: fail unless the PR carries the api/README §18 deprecation record (D-TASK015-03): a
 *   `docs/03-architecture/adr/ADR-*.md` file that the PR adds or modifies (merge base..head) whose head text has a line
 *   naming `Supersedes` and an `ADR-NNNN`, and that names every broken operation by its `operationId` (or, for a
 *   change without one, by `METHOD /path`). The deprecation mechanism itself (`deprecated: true` + `x-sunset`) is
 *   judged by oasdiff, which is sunset-aware (removing an operation whose `x-sunset` has passed is not an ERR), and by
 *   the contract test (§15 rule 8: a deprecated operation needs `x-sunset`).
 *
 * The README "append-only" rule for `tools/openapi/implemented-operations.json` and the contract is a process rule;
 * this job is what catches a breaking contract change (D-ORCH-024 (4)).
 *
 * Usage: node tools/ci/openapi-breaking.mjs [--root <dir>] --base <git-ref> [--head <git-ref>] [--image <ref@sha256>]
 *        [--summary <file>] [--json]
 * Exit 0 = pass or no release tag, 1 = breaking change without a record, 2 = usage or internal error.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * oasdiff v1.35.0 (Apache-2.0, released 2026-10-28; tag v1.36.0/v1.37.0 were inside the 7-day cooldown on 2026-11-13).
 * Same value as `OASDIFF_IMAGE` in .github/workflows/ci.yml (a unit test keeps them equal).
 */
export const OASDIFF_IMAGE = 'docker.io/tufin/oasdiff:v1.35.0@sha256:82b1840a77335562bb11ce95f77ad31745a0c6f3a770929333ed1c5ef466e400';
export const CONTRACT_PATH = 'docs/03-architecture/api/openapi.yaml';
export const ADR_DIR = 'docs/03-architecture/adr';
export const NO_TAG = 'no release tag';
/** oasdiff `level`: 1 INFO, 2 WARN, 3 ERR. */
export const ERR_LEVEL = 3;
const DOCKER_TIMEOUT_MS = 180_000;
const GIT_TIMEOUT_MS = 60_000;
const DIGEST_PINNED = /^[a-z0-9][a-z0-9./_-]*(?::[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$/u;
const ADR_FILE = /^docs\/03-architecture\/adr\/ADR-[^/]+\.md$/u;
const SUPERSEDES = /^.*\bSupersedes\b.*\bADR-\d{4}\b.*$/mu;
const MAX_FINDINGS = 10_000;

/**
 * @typedef {{ id: string, text: string, level: number, operation: string, operationId: string, path: string }} Change
 * @typedef {{ path: string, text: string }} Adr
 * @typedef {{ verdict: 'pass' | 'fail' | 'skip', tag?: string, errors: Change[], uncovered: Change[], records: string[], message: string }} Decision
 * @typedef {(args: readonly string[]) => { status: number | null, stdout: string, stderr: string, error?: Error }} DockerRunner
 */

/**
 * The latest release tag from `git tag --list 'v*' --sort=-v:refname` output (first non-empty line).
 * @param {string} listing
 * @returns {string | undefined}
 */
export function latestReleaseTag(listing) {
  return listing
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line !== '');
}

/** @param {unknown} value @param {string} key */
const field = (value, key) => {
  const raw = /** @type {Record<string, unknown>} */ (value)[key];
  return typeof raw === 'string' ? raw : '';
};

/**
 * Parses and validates oasdiff `breaking --format json` output (an array of changes).
 * @param {string} stdout
 * @returns {Change[]}
 */
export function parseOasdiffJson(stdout) {
  /** @type {unknown} */
  const parsed = stdout.trim() === '' ? [] : JSON.parse(stdout);
  if (!Array.isArray(parsed)) throw new Error('oasdiff output is not a JSON array');
  if (parsed.length > MAX_FINDINGS) throw new Error(`oasdiff reported more than ${MAX_FINDINGS} changes`);
  return parsed.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) throw new Error(`oasdiff change ${index} is not an object`);
    const level = /** @type {Record<string, unknown>} */ (entry).level;
    if (typeof level !== 'number' || !Number.isInteger(level)) throw new Error(`oasdiff change ${index} has no integer level`);
    const id = field(entry, 'id');
    if (id === '') throw new Error(`oasdiff change ${index} has no id`);
    return {
      id,
      text: field(entry, 'text'),
      level,
      operation: field(entry, 'operation'),
      operationId: field(entry, 'operationId'),
      path: field(entry, 'path'),
    };
  });
}

/**
 * How a record must name a broken change: its operationId, else `METHOD /path`, else the change id.
 * @param {Change} change
 */
export const changeKey = (change) =>
  change.operationId !== '' ? change.operationId : change.path !== '' ? `${change.operation} ${change.path}`.trim() : change.id;

/**
 * ADR files changed by the PR that qualify as a deprecation record (D-TASK015-03): added or modified, and with a
 * `Supersedes … ADR-NNNN` line.
 * @param {readonly Adr[]} adrs
 * @returns {Adr[]}
 */
export const recordAdrs = (adrs) => adrs.filter((adr) => ADR_FILE.test(adr.path) && SUPERSEDES.test(adr.text));

/**
 * Pure decision.
 * @param {{ tag: string | undefined, changes: readonly Change[], adrs: readonly Adr[] }} input
 * @returns {Decision}
 */
export function decide({ tag, changes, adrs }) {
  if (tag === undefined) return { verdict: 'skip', errors: [], uncovered: [], records: [], message: NO_TAG };
  const errors = changes.filter((change) => change.level >= ERR_LEVEL);
  if (errors.length === 0) {
    return { verdict: 'pass', tag, errors, uncovered: [], records: [], message: `no breaking change against ${tag}` };
  }
  const records = recordAdrs(adrs);
  const uncovered = errors.filter((change) => !records.some((adr) => adr.text.includes(changeKey(change))));
  if (records.length > 0 && uncovered.length === 0) {
    return {
      verdict: 'pass',
      tag,
      errors,
      uncovered,
      records: records.map((adr) => adr.path),
      message: `${errors.length} breaking change(s) against ${tag}, each named by a superseding ADR record`,
    };
  }
  return {
    verdict: 'fail',
    tag,
    errors,
    uncovered,
    records: records.map((adr) => adr.path),
    message:
      records.length === 0
        ? `${errors.length} breaking change(s) against ${tag} and no deprecation record (api/README §18: a changed ADR-*.md with a "Supersedes ADR-NNNN" line that names each operationId)`
        : `${uncovered.length} breaking change(s) against ${tag} not named by the superseding ADR record(s) ${records.map((adr) => adr.path).join(', ')}`,
  };
}

/**
 * `docker run` arguments for one comparison: no network, read-only root, no capabilities, non-root, the folder with
 * base.yaml and head.yaml bind-mounted read-only at /specs.
 * @param {string} image digest-pinned reference
 * @param {string} specsDir absolute host folder
 */
export function oasdiffArgs(image, specsDir) {
  if (!DIGEST_PINNED.test(image)) throw new Error(`--image must be pinned by @sha256 digest: ${image}`);
  if (specsDir.includes(',')) throw new Error(`cannot bind-mount a path containing a comma: ${specsDir}`);
  return [
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    '65534:65534',
    '--mount',
    `type=bind,source=${specsDir},target=/specs,readonly`,
    image,
    'breaking',
    '/specs/base.yaml',
    '/specs/head.yaml',
    '--format',
    'json',
  ];
}

/** @type {DockerRunner} */
const realDocker = (args) => {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: DOCKER_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error } : {}),
  };
};

/**
 * @param {string} root
 * @param {string[]} args
 * @param {{ allowFail?: boolean }} [options]
 * @returns {string | undefined} stdout, or undefined when allowFail and git exits non-zero
 */
function git(root, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw new Error(`git ${args[0] ?? ''} failed: ${result.error.message}`);
  if (result.status !== 0) {
    if (options.allowFail === true) return undefined;
    throw new Error(`git ${args.join(' ')} exited ${String(result.status)}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/**
 * ADR files the PR adds or modifies, with their head text.
 * @param {string} root
 * @param {string} base
 * @param {string} head
 * @returns {Adr[]}
 */
function changedAdrs(root, base, head) {
  const mergeBase = (git(root, ['merge-base', base, head]) ?? '').trim();
  const parts = (git(root, ['diff', '--name-status', '-z', '--no-renames', mergeBase, head, '--', ADR_DIR]) ?? '')
    .split('\0')
    .filter((part) => part !== '');
  /** @type {Adr[]} */
  const adrs = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = (parts[i] ?? '').charAt(0);
    const path = parts[i + 1] ?? '';
    if ((status === 'A' || status === 'M') && ADR_FILE.test(path)) adrs.push({ path, text: git(root, ['show', `${head}:${path}`]) ?? '' });
  }
  return adrs;
}

/**
 * @param {{ root: string, base: string, head?: string, image?: string, runner?: DockerRunner }} options
 * @returns {Decision}
 */
export function checkOpenapiBreaking({ root, base, head = 'HEAD', image = OASDIFF_IMAGE, runner = realDocker }) {
  const tag = latestReleaseTag(git(root, ['tag', '--list', 'v*', '--sort=-v:refname']) ?? '');
  if (tag === undefined) return decide({ tag, changes: [], adrs: [] });
  const released = git(root, ['show', `${tag}^{commit}:${CONTRACT_PATH}`], { allowFail: true });
  if (released === undefined) throw new Error(`release tag ${tag} has no ${CONTRACT_PATH}`);
  const current = git(root, ['show', `${head}:${CONTRACT_PATH}`], { allowFail: true });
  if (current === undefined) throw new Error(`${head} has no ${CONTRACT_PATH}`);
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'openapi-breaking-')));
  try {
    writeFileSync(join(dir, 'base.yaml'), released);
    writeFileSync(join(dir, 'head.yaml'), current);
    const result = runner(oasdiffArgs(image, dir));
    if (result.error) throw new Error(`docker run failed: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`oasdiff exited ${String(result.status)}: ${result.stderr.trim().slice(0, 2000)}`);
    return decide({ tag, changes: parseOasdiffJson(result.stdout), adrs: changedAdrs(root, base, head) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** @param {Decision} decision */
export function toMarkdown(decision) {
  const verdict = decision.verdict === 'fail' ? 'FAIL' : decision.verdict === 'skip' ? 'PASS (no release tag)' : 'PASS';
  const rows = decision.errors.map(
    (change) => `| \`${change.id}\` | \`${changeKey(change)}\` | ${decision.uncovered.includes(change) ? 'no record' : 'recorded'} |`,
  );
  const table = rows.length === 0 ? '' : `\n| oasdiff rule | Operation | Record |\n|---|---|---|\n${rows.join('\n')}\n`;
  return `\n### OpenAPI breaking changes (oasdiff, NFR-MAINT-004): ${verdict}\n\n${decision.message}\n${table}`;
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {{ root: string, base?: string, head?: string, image?: string, summary?: string, json: boolean }} */
  const options = { root: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--root' || arg === '--base' || arg === '--head' || arg === '--image' || arg === '--summary') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      i += 1;
      if (arg === '--root') options.root = resolve(value);
      else options[/** @type {'base' | 'head' | 'image' | 'summary'} */ (arg.slice(2))] = value;
    } else throw new Error(`unknown argument: ${String(arg)}`);
  }
  if (options.base === undefined) throw new Error('--base <git-ref> is required');
  return options;
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const decision = checkOpenapiBreaking({
      root: options.root,
      base: /** @type {string} */ (options.base),
      ...(options.head === undefined ? {} : { head: options.head }),
      ...(options.image === undefined ? {} : { image: options.image }),
    });
    if (options.json) process.stdout.write(`${JSON.stringify(decision)}\n`);
    for (const change of decision.uncovered) process.stdout.write(`${change.id}: ${change.text} (${changeKey(change)})\n`);
    process.stdout.write(`openapi-breaking: ${decision.verdict === 'fail' ? 'FAIL' : 'PASS'}: ${decision.message}\n`);
    if (options.summary !== undefined) appendFileSync(options.summary, toMarkdown(decision));
    process.exitCode = decision.verdict === 'fail' ? 1 : 0;
  } catch (error) {
    process.stderr.write(`openapi-breaking: error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
