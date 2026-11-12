// @ts-check
/**
 * Security-owned paths need a security review record (lane A; PR5-SEC-04, PR2-SEC-08; SEC-P3-31).
 *
 * When the PR range `<base>...<head>` changes a path owned by `.github/CODEOWNERS` (patterns read from the base AND the
 * head, so deleting a line does not exempt the PR that deletes it), a committed record
 * `docs/05-quality/security/PR-<nnnn>-*.md` must exist in the checked-out tree that
 *   (a) names a commit of this PR (a 7-40 hex token resolving to a commit in `<base>..<head>`), and
 *   (b) no security-owned path changed between that commit and `<head>` (the record commit itself and later docs-only
 *       commits are fine; a code change after the review invalidates it), and
 *   (c) its last `Verdict` is not FAIL.
 * This is how PR5-SEC-04's "names the PR head SHA" survives the fact that committing the record moves the head.
 *
 * `--report-only` reports instead of failing, and is accepted only while the base ref does not contain this script
 * (the PR that introduces the check); afterwards it is refused, so a later PR cannot switch the gate off from ci.yml.
 *
 * CLI: node tools/ci/check-security-owned-paths.mjs --base <ref> [--head <ref>] [--root <dir>] [--report-only]
 *      [--summary <file>] [--json]
 * Exit 0 pass / not required / report-only, 1 record missing or invalid, 2 usage/internal error.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @typedef {{ pattern: string, regex: RegExp }} OwnerPattern */
/** @typedef {{ path: string, text: string }} ReviewRecord */
/**
 * @typedef {object} Evaluation
 * @property {'not-required' | 'pass' | 'missing'} status
 * @property {string[]} owned security-owned paths changed by the PR
 * @property {{ record: string, commit: string } | null} satisfiedBy
 * @property {string[]} notes
 */

export const RECORD_DIR = 'docs/05-quality/security';
const RECORD_NAME = /^PR-\d{4}-.+\.md$/;
const SELF = 'tools/ci/check-security-owned-paths.mjs';

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

/**
 * The last verdict token in a record (`| **Verdict** | **PASS_WITH_FOLLOW-UPS.** …` or `Verdict: FAIL`).
 * @param {string} text
 * @returns {string | null}
 */
export function recordVerdict(text) {
  const matches = [...text.matchAll(/\bVerdict\b\**\s*[|:]\s*\**\s*([A-Z][A-Z_-]*[A-Z])/g)];
  const last = matches[matches.length - 1];
  return last?.[1] ?? null;
}

/**
 * Pure core.
 * @param {object} input
 * @param {readonly string[]} input.changed paths changed in the PR range
 * @param {readonly OwnerPattern[]} input.patterns
 * @param {readonly ReviewRecord[]} input.records
 * @param {(tokens: string[]) => Map<string, string>} input.resolveCommits short/long token -> full commit SHA (only resolvable ones)
 * @param {ReadonlySet<string>} input.prCommits full SHAs in `<base>..<head>`
 * @param {(commit: string) => string[]} input.changedSince paths changed between `commit` and the head
 * @returns {Evaluation}
 */
export function evaluate({ changed, patterns, records, resolveCommits, prCommits, changedSince }) {
  const owned = ownedPaths(changed, patterns);
  /** @type {string[]} */
  const notes = [];
  if (owned.length === 0) return { status: 'not-required', owned, satisfiedBy: null, notes };
  for (const record of records) {
    const verdict = recordVerdict(record.text);
    if (verdict === null || verdict.startsWith('FAIL')) {
      notes.push(`${record.path}: verdict ${verdict ?? 'missing'}`);
      continue;
    }
    const resolved = resolveCommits(candidateShas(record.text));
    for (const commit of new Set(resolved.values())) {
      if (!prCommits.has(commit)) continue;
      const later = ownedPaths(changedSince(commit), patterns);
      if (later.length === 0) return { status: 'pass', owned, satisfiedBy: { record: record.path, commit }, notes };
      notes.push(`${record.path} names ${commit.slice(0, 7)}, but ${later.join(', ')} changed after it`);
    }
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
 * @param {{ root: string, base: string, head: string }} options
 */
export function checkSecurityOwnedPaths({ root, base, head }) {
  const changed = lines(gitOk(root, ['diff', '--name-only', `${base}...${head}`]));
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
  const changedSince = (/** @type {string} */ commit) => lines(gitOk(root, ['diff', '--name-only', commit, head]));
  return evaluate({ changed, patterns, records, resolveCommits, prCommits, changedSince });
}

/** @param {string[]} argv */
export function main(argv) {
  /** @type {{ root: string, base?: string, head: string, summary?: string, json: boolean, reportOnly: boolean }} */
  const options = { root: process.cwd(), head: 'HEAD', json: false, reportOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (['--root', '--base', '--head', '--summary'].includes(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value === '') {
        console.error(`check-security-owned-paths: ${arg} needs a value`);
        return 2;
      }
      if (arg === '--root') options.root = resolve(value);
      else if (arg === '--base') options.base = value;
      else if (arg === '--head') options.head = value;
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
  if (options.reportOnly && git(options.root, ['cat-file', '-e', `${options.base}:${SELF}`]).status === 0) {
    console.error('check-security-owned-paths: --report-only is refused because the base ref already contains this check');
    return 2;
  }
  const result = checkSecurityOwnedPaths({ root: options.root, base: options.base, head: options.head });
  const failing = result.status === 'missing';
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else if (failing) {
    console.log(
      `security-review-record: ${result.owned.length} security-owned path(s) changed (${result.owned.slice(0, 10).join(', ')}${result.owned.length > 10 ? ', …' : ''}); ` +
        `no record under ${RECORD_DIR}/ names a commit of this PR after which no owned path changed, with a verdict other than FAIL (${RECORD_DIR})`,
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
