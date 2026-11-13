/**
 * OpenAPI breaking-change gate (NFR-MAINT-004; PR #21 code review R1-m6; D-ORCH-023 (1); D-ARCH-084; api/README §1
 * and §18 item 3). Lane A, job `scans`, run from the base ref like every gate tool (SEC-P3-31).
 *
 * Compares `docs/03-architecture/api/openapi.yaml` at the PR head with the same file at the latest release tag: the
 * highest strict-semver tag `v<major>.<minor>.<patch>[-<pre>]` (RELEASE_TAG, semver precedence) that is reachable from
 * the base (`git tag --merged <base>`), so a tag pushed on an unmerged branch or a junk `v*` tag is never the baseline
 * (PR #33 R1-M2 (b), PR33-SEC-03 (ii)). Both versions come from git objects (`git show`), never from the working tree,
 * and are written to a private temporary folder (0755, files 0644: the container user must traverse it on Linux, PR #33
 * R1-M1 / PR33-SEC-02) that is bind-mounted read-only into the digest-pinned oasdiff container (only OASDIFF_IMAGE is
 * accepted) running with no network, a read-only root file system, no capabilities and a non-root user.
 *
 * Decision:
 * - no release tag: a smoke run compares the head contract with itself (pull, mount and parse are exercised on every
 *   PR; it must report no ERR change), then prints `no release tag` and passes (exit 0);
 * - oasdiff `breaking` reports no ERR-level change: pass;
 * - ERR-level changes: fail unless a deprecation record (api/README §18, D-TASK015-03) names each of them: a
 *   `docs/03-architecture/adr/ADR-*.md` file added or modified since the tag (tag..head, so a record merged by an
 *   earlier PR stays valid until the next tag; R1-M2 (a)) whose head text has `Status: Accepted` as its first status
 *   line, a line naming `Supersedes` and an `ADR-NNNN`, and every broken operation by its `operationId` (or, for a
 *   change without one, `METHOD /path`) as a whole identifier (R1-M2 (c)). The deprecation mechanism itself
 *   (`deprecated: true` + `x-sunset`) is judged by oasdiff, which is sunset-aware (removing an operation whose
 *   `x-sunset` has passed is not an ERR), and by the contract test (§15 rule 8: a deprecated operation needs `x-sunset`).
 *   Residual (PR33-SEC-03 (iii), 015-C): the record is an ADR the PR may itself add; `docs/03-architecture/adr/` is
 *   not security-owned, so the control is against omission, not forgery.
 * Every PR-controlled string printed to the log or the summary goes through `clean` (no control characters, so no
 * `::workflow-command` line can be forged; PR33-SEC-04).
 *
 * The README "append-only" rule for `tools/openapi/implemented-operations.json` and the contract is a process rule;
 * this job is what catches a breaking contract change (D-ORCH-024 (4)).
 *
 * Usage: node tools/ci/openapi-breaking.mjs [--root <dir>] --base <git-ref> [--head <git-ref>] [--image <OASDIFF_IMAGE>]
 *        [--summary <file>] [--json]
 * `--image` is accepted only when it equals OASDIFF_IMAGE (any other reference exits 2).
 * Exit 0 = pass or no release tag, 1 = breaking change without a record, 2 = usage or internal error.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
/** The first status line of an ADR (`- **Status:** Accepted`, `Status: Proposed`, …). */
const STATUS_LINE = /^[ \t]*(?:[-*][ \t]+)?\**Status\**[ \t]*:[ \t]*\**[ \t]*(.*)$/mu;
/** A release tag (PR #33 R1-M2 (b)): `v<major>.<minor>.<patch>` with an optional `-<prerelease>`. */
export const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u;
/** Spec folder and file modes: the container runs as uid 65534 and must traverse and read them (PR33-SEC-02). */
export const SPEC_DIR_MODE = 0o755;
export const SPEC_FILE_MODE = 0o644;
const MAX_FINDINGS = 10_000;

/**
 * @typedef {{ id: string, text: string, level: number, operation: string, operationId: string, path: string }} Change
 * @typedef {{ path: string, text: string }} Adr
 * @typedef {{ verdict: 'pass' | 'fail' | 'skip', tag?: string, errors: Change[], uncovered: Change[], records: string[], message: string, smoke?: string }} Decision
 * @typedef {(args: readonly string[]) => { status: number | null, stdout: string, stderr: string, error?: Error }} DockerRunner
 */

/**
 * Semver precedence of two RELEASE_TAG names (negative: a < b). A prerelease sorts before its release; prerelease
 * identifiers compare numerically when both are numeric, numeric before alphanumeric, else by ASCII order, and a shorter
 * identifier list sorts first when it is a prefix of the other.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareReleaseTags(a, b) {
  const ma = RELEASE_TAG.exec(a);
  const mb = RELEASE_TAG.exec(b);
  if (ma === null || mb === null) throw new Error(`not a release tag: ${ma === null ? a : b}`);
  for (const index of [1, 2, 3]) {
    const diff = BigInt(ma[index] ?? '0') - BigInt(mb[index] ?? '0');
    if (diff !== 0n) return diff < 0n ? -1 : 1;
  }
  const pa = ma[4];
  const pb = mb[4];
  if (pa === undefined || pb === undefined) return pa === pb ? 0 : pa === undefined ? 1 : -1;
  const ia = pa.split('.');
  const ib = pb.split('.');
  for (let i = 0; i < Math.min(ia.length, ib.length); i += 1) {
    const x = ia[i] ?? '';
    const y = ib[i] ?? '';
    if (x === y) continue;
    const xNum = /^\d+$/u.test(x);
    const yNum = /^\d+$/u.test(y);
    if (xNum && yNum) return BigInt(x) < BigInt(y) ? -1 : 1;
    if (xNum !== yNum) return xNum ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return Math.sign(ia.length - ib.length);
}

/**
 * The latest release tag of a `git tag --list` output: the highest RELEASE_TAG name by semver precedence; any other
 * name (`vnext`, `v1`, `v1.2.3.4`, `v1.2.3+build`) is ignored.
 * @param {string} listing
 * @returns {string | undefined}
 */
export function latestReleaseTag(listing) {
  const tags = listing
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => RELEASE_TAG.test(line));
  return tags.sort((a, b) => compareReleaseTags(b, a))[0];
}

/**
 * A PR-controlled value made safe for one log line or table cell: control characters (newlines included) become a
 * space (C0, DEL, C1 and the Unicode line/paragraph separators), so no line of output can start a GitHub workflow
 * command (PR33-SEC-04).
 * @param {string} value
 */
export const clean = (value) =>
  Array.from(value, (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 ? ' ' : ch;
  }).join('');

/** A value for a Markdown table cell: cleaned, with `|` and backticks escaped. @param {string} value */
const cell = (value) => clean(value).replace(/[|`]/gu, (c) => `\\${c}`);

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
 * Whether an ADR's first status line says Accepted (`Proposed`, `Superseded`, `Draft`, a missing line: no).
 * @param {string} text
 */
export const isAccepted = (text) => /^Accepted\b/u.test((STATUS_LINE.exec(text)?.[1] ?? '').replace(/^\**\s*/u, ''));

/**
 * Whether `text` names `key` as a whole identifier: not preceded by an identifier character and not followed by an
 * identifier, path or template character, so `getThingList` and `GET /a/b/{id}` do not name `getThing` / `GET /a/b`
 * (PR #33 R1-M2 (c)).
 * @param {string} text
 * @param {string} key
 */
export function namesKey(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_/{}-])`, 'u').test(text);
}

/**
 * ADR files that qualify as a deprecation record (D-TASK015-03, PR #33 R1-M2): an ADR-*.md path, an Accepted status and
 * a `Supersedes … ADR-NNNN` line.
 * @param {readonly Adr[]} adrs
 * @returns {Adr[]}
 */
export const recordAdrs = (adrs) => adrs.filter((adr) => ADR_FILE.test(adr.path) && isAccepted(adr.text) && SUPERSEDES.test(adr.text));

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
  const uncovered = errors.filter((change) => !records.some((adr) => namesKey(adr.text, changeKey(change))));
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
        ? `${errors.length} breaking change(s) against ${tag} and no deprecation record (api/README §18: an Accepted ADR-*.md added or changed since ${tag} with a "Supersedes ADR-NNNN" line that names each operationId)`
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
 * ADR files added or modified between the release tag and the head, with their head text. Not merge base..head: a
 * record merged by an earlier PR keeps covering its change until the next tag, because the comparison is always
 * tag..head (PR #33 R1-M2 (a)).
 * @param {string} root
 * @param {string} tag
 * @param {string} head
 * @returns {Adr[]}
 */
function changedAdrs(root, tag, head) {
  const parts = (git(root, ['diff', '--name-status', '-z', '--no-renames', `${tag}^{commit}`, head, '--', ADR_DIR]) ?? '')
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
 * A private temporary folder holding base.yaml and head.yaml, readable by the container's non-root user: the folder
 * 0755 and the files 0644 (mkdtemp creates 0700 owned by the runner user, which uid 65534 cannot traverse on Linux;
 * PR #33 R1-M1, PR33-SEC-02). The mount stays read-only and the folder private to this run.
 * @param {string} baseText
 * @param {string} headText
 * @param {{ chmod?: (path: string, mode: number) => void }} [options] `chmod` is injectable so a test can observe it on
 *   Windows, where POSIX modes are not stored
 * @returns {string} the folder (caller removes it)
 */
export function writeSpecsDir(baseText, headText, { chmod = chmodSync } = {}) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'openapi-breaking-')));
  try {
    for (const [name, text] of /** @type {const} */ ([
      ['base.yaml', baseText],
      ['head.yaml', headText],
    ])) {
      writeFileSync(join(dir, name), text, { mode: SPEC_FILE_MODE });
      chmod(join(dir, name), SPEC_FILE_MODE);
    }
    chmod(dir, SPEC_DIR_MODE);
    return dir;
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * One oasdiff `breaking` run over two contract texts.
 * @param {string} baseText
 * @param {string} headText
 * @param {DockerRunner} runner
 * @returns {Change[]}
 */
function runOasdiff(baseText, headText, runner) {
  const dir = writeSpecsDir(baseText, headText);
  try {
    const result = runner(oasdiffArgs(OASDIFF_IMAGE, dir));
    if (result.error) throw new Error(`docker run failed: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`oasdiff exited ${String(result.status)}: ${clean(result.stderr.trim().slice(0, 2000))}`);
    return parseOasdiffJson(result.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * @param {{ root: string, base: string, head?: string, image?: string, runner?: DockerRunner }} options `image` must be
 *   OASDIFF_IMAGE (the base-ref constant; ci.yml passes it so the two stay bound, PR33-SEC-03 (i))
 * @returns {Decision}
 */
export function checkOpenapiBreaking({ root, base, head = 'HEAD', image = OASDIFF_IMAGE, runner = realDocker }) {
  if (image !== OASDIFF_IMAGE) throw new Error(`--image must be the pinned OASDIFF_IMAGE of this script (${OASDIFF_IMAGE})`);
  if (git(root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], { allowFail: true }) === undefined)
    throw new Error(`--base ${base} is not a commit`);
  const current = git(root, ['show', `${head}:${CONTRACT_PATH}`], { allowFail: true });
  if (current === undefined) throw new Error(`${head} has no ${CONTRACT_PATH}`);
  // Only tags already merged into the base: a tag pushed on an unmerged branch is never the baseline (PR33-SEC-03 (ii)).
  const tag = latestReleaseTag(git(root, ['tag', '--list', 'v*', '--merged', `${base}^{commit}`]) ?? '');
  if (tag === undefined) {
    // Smoke (PR #33 R1-M1): pull, mount and parse run on every PR, so a broken container setup cannot wait for the tag.
    const smoke = runOasdiff(current, current, runner);
    const smokeErrors = smoke.filter((change) => change.level >= ERR_LEVEL);
    if (smokeErrors.length > 0)
      throw new Error(`smoke: oasdiff reported ${smokeErrors.length} breaking change(s) of the head contract against itself`);
    return {
      ...decide({ tag, changes: [], adrs: [] }),
      smoke: `oasdiff compared the head contract with itself: ${smoke.length} change(s)`,
    };
  }
  const released = git(root, ['show', `${tag}^{commit}:${CONTRACT_PATH}`], { allowFail: true });
  if (released === undefined) throw new Error(`release tag ${tag} has no ${CONTRACT_PATH}`);
  const changes = runOasdiff(released, current, runner);
  return decide({ tag, changes, adrs: changedAdrs(root, tag, head) });
}

/** @param {Decision} decision */
export function toMarkdown(decision) {
  const verdict = decision.verdict === 'fail' ? 'FAIL' : decision.verdict === 'skip' ? 'PASS (no release tag)' : 'PASS';
  const rows = decision.errors.map(
    (change) =>
      `| \`${cell(change.id)}\` | \`${cell(changeKey(change))}\` | ${decision.uncovered.includes(change) ? 'no record' : 'recorded'} |`,
  );
  const table = rows.length === 0 ? '' : `\n| oasdiff rule | Operation | Record |\n|---|---|---|\n${rows.join('\n')}\n`;
  const smoke = decision.smoke === undefined ? '' : `\nSmoke: ${clean(decision.smoke)}.\n`;
  return `\n### OpenAPI breaking changes (oasdiff, NFR-MAINT-004): ${verdict}\n\n${clean(decision.message)}\n${smoke}${table}`;
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
      if (value === undefined || value.startsWith('-')) throw new Error(`${arg} needs a value (not starting with "-")`);
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
    // JSON.stringify escapes every control character, so the JSON line cannot carry a workflow command either.
    if (options.json) process.stdout.write(`${JSON.stringify(decision)}\n`);
    for (const change of decision.uncovered) process.stdout.write(`${clean(`${change.id}: ${change.text} (${changeKey(change)})`)}\n`);
    if (decision.smoke !== undefined) process.stdout.write(`openapi-breaking: smoke: ${clean(decision.smoke)}\n`);
    process.stdout.write(`openapi-breaking: ${decision.verdict === 'fail' ? 'FAIL' : 'PASS'}: ${clean(decision.message)}\n`);
    if (options.summary !== undefined) appendFileSync(options.summary, toMarkdown(decision));
    process.exitCode = decision.verdict === 'fail' ? 1 : 0;
  } catch (error) {
    process.stderr.write(`openapi-breaking: error: ${clean(error instanceof Error ? error.message : String(error))}\n`);
    process.exitCode = 2;
  }
}
