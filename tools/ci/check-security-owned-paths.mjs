// @ts-check
/**
 * Security-owned paths need a security review record (lane A; PR5-SEC-04, PR2-SEC-08; SEC-P3-31; PR10-SEC-04; code
 * review PR #10 m2).
 *
 * When the PR changes a path owned by `.github/CODEOWNERS` (patterns read from the base AND the head, so deleting a line
 * does not exempt the PR that deletes it), a committed record must exist in the checked-out tree that
 *   (a) is named for THIS pull request: `docs/05-quality/security/PR-<pr, zero-padded to 4>-*.md` (`--pr`). A record
 *       of another PR does not count, even if it names a commit of this range (stacked branches);
 *   (b) carries an allow-listed verdict: of the markdown table rows (outside fenced code blocks) whose first cell, with
 *       `*` and whitespace stripped, is exactly `Verdict` (any case), the LAST one wins (later review rounds append a
 *       new header table); its verdict is the leading `[A-Z_-]+` token of the second cell with `*` stripped
 *       (`| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No …` gives PASS_WITH_FOLLOW-UPS). Only PASS, PASS_WITH_FOLLOW-UPS
 *       and PASS_WITH_CONDITIONS count; FAIL, PENDING, TBD, BLOCKED, any other token or no Verdict row make the
 *       record invalid. Prose (`Verdict: FAIL`) and fenced examples are ignored;
 *   (c) names a reviewed commit of this PR: a 7-40 hex token in a table row whose first cell (stripped of `*`) starts
 *       with `Branch / head` or `Head` (`Head`, `Head / range`) that resolves to a commit in `<base>..<head>`; and
 *   (d) no owned path that this PR changes changed between that commit and `<head>`. The owned set is the PR's own net
 *       change (`<base>...<head>`, i.e. against the merge base), so paths that only `main` changed, brought in by a
 *       merge of `main` after the review, do not void the record; a PR change to an owned path after the review does.
 *       The record commit itself and later docs-only commits are fine.
 * This is how PR5-SEC-04's "names the PR head SHA" survives the fact that committing the record moves the head.
 * Every diff runs with `--no-renames`, so a rename out of an owned path reports the old (owned) path too.
 *
 * `--event push` skips the check (exit 0, status `skipped`): it is a pull-request control, and on a push to `main` the
 * range is the squash commit, which no record can name (records name branch commits). `--pr` is required for
 * `pull_request` (the default) and optional on `push`.
 *
 * `--report-only` reports instead of failing, and is accepted only while the base ref does not contain this script
 * (the PR that introduces the check); afterwards it is refused, so a later PR cannot switch the gate off from ci.yml.
 *
 * Residual (PR10-SEC-04, D-ORCH-013): records come from the PR's own tree, so whoever can push the branch can commit
 * one. The check detects an OMITTED record, not a FORGED one; forgery is controlled procedurally (only the
 * orchestrator commits records authored by security-analyst and verifies them before merging).
 *
 * CLI: node tools/ci/check-security-owned-paths.mjs --base <ref> --pr <number> [--head <ref>] [--root <dir>]
 *      [--event pull_request|push] [--report-only] [--summary <file>] [--json]
 * Exit 0 pass / not required / skipped / report-only, 1 record missing or invalid, 2 usage/internal error.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @typedef {{ pattern: string, regex: RegExp }} OwnerPattern */
/** @typedef {{ path: string, text: string }} ReviewRecord */
/**
 * @typedef {object} Evaluation
 * @property {'not-required' | 'pass' | 'missing' | 'skipped'} status
 * @property {string[]} owned security-owned paths changed by the PR
 * @property {{ record: string, commit: string } | null} satisfiedBy
 * @property {string[]} notes
 */

export const RECORD_DIR = 'docs/05-quality/security';
const RECORD_NAME = /^PR-\d{4,}-.+\.md$/;
const SELF = 'tools/ci/check-security-owned-paths.mjs';
/** Verdicts that let a record satisfy the check (PR10-SEC-04). */
export const ACCEPTED_VERDICTS = Object.freeze(['PASS', 'PASS_WITH_FOLLOW-UPS', 'PASS_WITH_CONDITIONS']);
const PR_NUMBER = /^[1-9]\d{0,8}$/;
const EVENTS = ['pull_request', 'push'];
const PUSH_SKIP = 'record check is a pull-request control; skipped on push';

/**
 * CODEOWNERS pattern to RegExp (gitignore-style subset: leading `/` anchors, trailing `/` is a directory, `*`, `**`).
 * @param {string} pattern
 */
export function patternToRegExp(pattern) {
  const anchored = pattern.startsWith('/');
  const directory = pattern.endsWith('/');
  const body = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
  const source = body
    .split('/')
    .map((part) => (part === '**' ? '.*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*')))
    .join('/');
  const prefix = anchored || body.includes('/') ? '^' : '^(?:.*/)?';
  return new RegExp(`${prefix}${source}${directory ? '/' : '(?:$|/)'}`);
}

/**
 * @param {string} text CODEOWNERS content
 * @returns {OwnerPattern[]}
 */
export function parseCodeowners(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, '').trim())
    .filter((line) => line !== '')
    .map((line) => line.split(/\s+/)[0] ?? '')
    .filter((pattern) => pattern !== '')
    .map((pattern) => ({ pattern, regex: patternToRegExp(pattern) }));
}

/**
 * @param {readonly string[]} paths
 * @param {readonly OwnerPattern[]} patterns
 */
export const ownedPaths = (paths, patterns) => paths.filter((path) => patterns.some((p) => p.regex.test(path)));

/** @param {string} text */
export function candidateShas(text) {
  return [...new Set([...text.matchAll(/(?<![0-9A-Za-z])[0-9a-f]{7,40}(?![0-9A-Za-z])/g)].map((m) => m[0]))];
}

/** @param {number} pr */
export const recordPrefix = (pr) => `PR-${String(pr).padStart(4, '0')}-`;

/** @param {string} cell */
const stripCell = (cell) => cell.replaceAll('*', '').replace(/\s+/g, ' ').trim();

/**
 * Markdown table rows (cells split on unescaped `|`), skipping fenced code blocks and indented code (4+ spaces).
 * @param {string} text
 * @returns {string[][]}
 */
export function tableRows(text) {
  /** @type {string[][]} */
  const rows = [];
  /** @type {{ char: string, length: number } | null} */
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    if (fence !== null) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)?.[1];
      if (close !== undefined && close.charAt(0) === fence.char && close.length >= fence.length) fence = null;
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (open !== undefined) {
      fence = { char: open.charAt(0), length: open.length };
      continue;
    }
    if (!/^ {0,3}\|/.test(line)) continue;
    rows.push(
      line
        .trim()
        .replace(/^\|/, '')
        .split(/(?<!\\)\|/),
    );
  }
  return rows;
}

/**
 * The verdict of the LAST `| Verdict | … |` table row (first cell exactly `Verdict` once `*` and whitespace are
 * stripped; case-insensitive), or null when there is none. A row without a leading upper-case token gives ''.
 * @param {string} text
 * @returns {string | null}
 */
export function recordVerdict(text) {
  const rows = tableRows(text).filter((cells) => stripCell(cells[0] ?? '').toLowerCase() === 'verdict');
  const last = rows[rows.length - 1];
  if (last === undefined) return null;
  return /^[A-Z_-]+/.exec(stripCell(last[1] ?? ''))?.[0] ?? '';
}

/**
 * Hex tokens from the `Branch / head`, `Head`, `Head / range` header rows only (PR10-SEC-04: free text elsewhere
 * in a record cannot bind it to a commit).
 * @param {string} text
 */
export function recordHeadShas(text) {
  const rows = tableRows(text).filter((cells) => /^(?:Branch \/ head|Head)\b/i.test(stripCell(cells[0] ?? '')));
  return candidateShas(rows.map((cells) => cells.slice(1).join('|')).join('\n'));
}

/**
 * Pure core.
 * @param {object} input
 * @param {number} input.pr pull request number; only `PR-<pr padded to 4>-*.md` records count
 * @param {readonly string[]} input.changed paths changed in the PR range (against the merge base, no rename detection)
 * @param {readonly OwnerPattern[]} input.patterns
 * @param {readonly ReviewRecord[]} input.records
 * @param {(tokens: string[]) => Map<string, string>} input.resolveCommits short/long token -> full commit SHA (only resolvable ones)
 * @param {ReadonlySet<string>} input.prCommits full SHAs in `<base>..<head>`
 * @param {(commit: string) => string[]} input.changedSince paths changed between `commit` and the head
 * @returns {Evaluation}
 */
export function evaluate({ pr, changed, patterns, records, resolveCommits, prCommits, changedSince }) {
  const owned = ownedPaths(changed, patterns);
  const ownedSet = new Set(owned);
  /** @type {string[]} */
  const notes = [];
  if (owned.length === 0) return { status: 'not-required', owned, satisfiedBy: null, notes };
  const prefix = recordPrefix(pr);
  const mine = records.filter((record) => (record.path.split('/').pop() ?? '').startsWith(prefix));
  if (mine.length === 0) notes.push(`no record named ${RECORD_DIR}/${prefix}*.md for PR #${pr}`);
  for (const record of mine) {
    const verdict = recordVerdict(record.text);
    if (verdict === null || !ACCEPTED_VERDICTS.includes(verdict)) {
      notes.push(
        `${record.path}: verdict ${verdict === null ? 'missing (no "| Verdict |" table row)' : verdict === '' ? 'unreadable' : verdict} is not one of ${ACCEPTED_VERDICTS.join(', ')}`,
      );
      continue;
    }
    const shas = recordHeadShas(record.text);
    if (shas.length === 0) {
      notes.push(`${record.path}: no commit SHA in a "| Branch / head |" or "| Head |" table row`);
      continue;
    }
    const resolved = resolveCommits(shas);
    let named = false;
    for (const commit of new Set(resolved.values())) {
      if (!prCommits.has(commit)) continue;
      named = true;
      const later = ownedPaths(changedSince(commit), patterns).filter((path) => ownedSet.has(path));
      if (later.length === 0) return { status: 'pass', owned, satisfiedBy: { record: record.path, commit }, notes };
      notes.push(`${record.path} names ${commit.slice(0, 7)}, but ${later.join(', ')} changed after it`);
    }
    if (!named) notes.push(`${record.path}: its head row names no commit of this PR (${shas.join(', ')})`);
  }
  return { status: 'missing', owned, satisfiedBy: null, notes };
}

/**
 * @param {string} root
 * @param {string[]} args
 * @param {string} [input]
 */
function git(root, args, input) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    ...(input === undefined ? {} : { input }),
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * @param {string} root
 * @param {string[]} args
 */
function gitOk(root, args) {
  const result = git(root, args);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

/** @param {string} text */
const lines = (text) => text.split(/\r?\n/).filter((line) => line.trim() !== '');

/**
 * Collects the inputs from git and the tree, then evaluates.
 * @param {{ root: string, base: string, head: string, pr: number }} options
 */
export function checkSecurityOwnedPaths({ root, base, head, pr }) {
  const changed = lines(gitOk(root, ['diff', '--name-only', '--no-renames', `${base}...${head}`]));
  const baseOwners = git(root, ['show', `${base}:.github/CODEOWNERS`]);
  const headOwnersPath = join(root, '.github', 'CODEOWNERS');
  const patterns = [
    ...(baseOwners.status === 0 ? parseCodeowners(baseOwners.stdout) : []),
    ...(existsSync(headOwnersPath) ? parseCodeowners(readFileSync(headOwnersPath, 'utf8')) : []),
  ];
  const recordDir = join(root, ...RECORD_DIR.split('/'));
  const records = existsSync(recordDir)
    ? readdirSync(recordDir)
        .filter((name) => RECORD_NAME.test(name))
        .sort()
        .map((name) => ({ path: `${RECORD_DIR}/${name}`, text: readFileSync(join(recordDir, name), 'utf8') }))
    : [];
  const prCommits = new Set(lines(gitOk(root, ['rev-list', `${base}..${head}`])));
  const resolveCommits = (/** @type {string[]} */ tokens) => {
    /** @type {Map<string, string>} */
    const out = new Map();
    if (tokens.length === 0) return out;
    const batch = git(
      root,
      ['cat-file', '--batch-check=%(objectname) %(objecttype)'],
      tokens.map((t) => `${t}^{commit}`).join('\n') + '\n',
    );
    const answers = batch.stdout.split('\n');
    tokens.forEach((token, index) => {
      const [sha, type] = (answers[index] ?? '').split(' ');
      if (type === 'commit' && sha !== undefined) out.set(token, sha);
    });
    return out;
  };
  const changedSince = (/** @type {string} */ commit) => lines(gitOk(root, ['diff', '--name-only', '--no-renames', commit, head]));
  return evaluate({ pr, changed, patterns, records, resolveCommits, prCommits, changedSince });
}

/**
 * @param {{ summary?: string, json: boolean }} options
 */
function reportSkipped(options) {
  /** @type {Evaluation} */
  const result = { status: 'skipped', owned: [], satisfiedBy: null, notes: [PUSH_SKIP] };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`check-security-owned-paths: skipped (${PUSH_SKIP})`);
  if (options.summary) appendFileSync(options.summary, `\n### Security-owned paths: skipped (${PUSH_SKIP})\n`);
  return 0;
}

/** @param {string[]} argv */
export function main(argv) {
  /** @type {{ root: string, base?: string, head: string, pr?: string, event: string, summary?: string, json: boolean, reportOnly: boolean }} */
  const options = { root: process.cwd(), head: 'HEAD', event: 'pull_request', json: false, reportOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (['--root', '--base', '--head', '--summary', '--pr', '--event'].includes(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value === '') {
        console.error(`check-security-owned-paths: ${arg} needs a value`);
        return 2;
      }
      if (arg === '--root') options.root = resolve(value);
      else if (arg === '--base') options.base = value;
      else if (arg === '--head') options.head = value;
      else if (arg === '--pr') options.pr = value;
      else if (arg === '--event') options.event = value;
      else options.summary = value;
      i += 1;
    } else if (arg === '--json') options.json = true;
    else if (arg === '--report-only') options.reportOnly = true;
    else {
      console.error(`check-security-owned-paths: unknown argument ${arg}`);
      return 2;
    }
  }
  if (options.base === undefined) {
    console.error('check-security-owned-paths: --base <ref> is required');
    return 2;
  }
  if (!EVENTS.includes(options.event)) {
    console.error(`check-security-owned-paths: --event must be one of ${EVENTS.join(', ')}, got ${JSON.stringify(options.event)}`);
    return 2;
  }
  if (options.pr !== undefined && !PR_NUMBER.test(options.pr)) {
    console.error(`check-security-owned-paths: --pr must be a positive integer, got ${JSON.stringify(options.pr)}`);
    return 2;
  }
  if (options.event === 'pull_request' && options.pr === undefined) {
    console.error('check-security-owned-paths: --pr <number> is required for pull_request events');
    return 2;
  }
  if (options.reportOnly && git(options.root, ['cat-file', '-e', `${options.base}:${SELF}`]).status === 0) {
    console.error('check-security-owned-paths: --report-only is refused because the base ref already contains this check');
    return 2;
  }
  if (options.event === 'push') return reportSkipped(options);
  const pr = Number(options.pr);
  const result = checkSecurityOwnedPaths({ root: options.root, base: options.base, head: options.head, pr });
  const failing = result.status === 'missing';
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else if (failing) {
    console.log(
      `security-review-record: ${result.owned.length} security-owned path(s) changed (${result.owned.slice(0, 10).join(', ')}${result.owned.length > 10 ? ', …' : ''}); ` +
        `no record ${RECORD_DIR}/${recordPrefix(pr)}*.md has a last "| Verdict |" row of ${ACCEPTED_VERDICTS.join(' / ')} and a ` +
        `"| Branch / head |" row naming a commit of this PR after which no owned path of the PR changed`,
    );
    for (const note of result.notes) console.log(`  note: ${note}`);
  } else
    console.log(
      `check-security-owned-paths: ${result.status}${result.satisfiedBy ? ` (${result.satisfiedBy.record} @ ${result.satisfiedBy.commit.slice(0, 7)})` : ''}`,
    );
  if (options.summary) {
    const state =
      result.status === 'pass'
        ? `pass (${result.satisfiedBy?.record ?? ''})`
        : result.status === 'not-required'
          ? 'not required (no security-owned path changed)'
          : options.reportOnly
            ? `**record pending** (report-only: this PR introduces the check; the D-004 security review record is still required before merge) for ${result.owned.length} path(s)`
            : `**missing** for ${result.owned.length} path(s)`;
    appendFileSync(options.summary, `\n### Security-owned paths: ${state}\n`);
  }
  return failing && !options.reportOnly ? 1 : 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`check-security-owned-paths: internal error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
