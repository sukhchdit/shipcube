// @ts-check
/**
 * Security-critical path classifier (lane A; ADR-0023 amendment G item 5; TEST-STRATEGY section 4.1; TASK-015 part 015-B).
 *
 * Decides whether a pull request needs the hosted `security-integration` job: true when any path changed in
 * `<base>...<head>` matches SECURITY_INTEGRATION_PATHS, the trigger list of ADR-0023 amendment G item 5 plus
 * `package-lock.json`. Job `scans` runs the BASE ref's copy of this file (tools/ci from the base ref), so a PR cannot
 * narrow its own selection; widening or narrowing the list is a reviewed change of tools/ci (CODEOWNERS). No npm and
 * no node_modules in job `scans`: this file imports nothing but `node:` modules.
 *
 * Why not the manifest's broader `security_critical_paths` (which also lists tools/quality, tools/ci, .github and
 * .npmrc): those paths do not change what the Testcontainers suites exercise, and almost every Wave-0 PR touches them,
 * which would run the job on most PRs against a budget sized for about 15 a month (platform.md section 7.8, R-ARCH-19).
 * `package-lock.json` is added because a Prisma, adapter or `pg` bump changes the transaction and RLS behaviour those
 * suites prove.
 *
 * Fail closed toward running the job: an unknown range (no base commit, a base that is not in the clone) or a git
 * error classifies as `true`. Renames count as both paths (`--no-renames`).
 *
 * Glob dialect = tools/quality/lib/manifest.mjs `globsMatch` (anchored, `/`-separated, `**` whole segment, `*` within a
 * segment, `!` negates); security-paths.test.ts pins parity with the manifest copy on a path corpus.
 *
 * CLI: node tools/ci/security-paths.mjs --root <dir> --base <sha> --head <sha>
 *        [--output <$GITHUB_OUTPUT>] [--summary <$GITHUB_STEP_SUMMARY>]
 * Writes `security_paths=true|false` to --output (and stdout). Exit 0 classified, 2 usage error.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** ADR-0023 amendment G item 5 trigger paths, plus the lockfile (see the header). */
export const SECURITY_INTEGRATION_PATHS = Object.freeze([
  'packages/authz/**',
  'packages/audit/**',
  'packages/config/**',
  'prisma/**',
  'apps/api/src/platform/**',
  'apps/api/src/modules/identity/**',
  'package-lock.json',
]);

const ZERO_SHA = /^0{40}$/u;
const SHA = /^[0-9a-f]{7,64}$/u;
const MAX_LISTED = 20;

/**
 * One path segment against one glob segment (`*` = any run of characters except `/`).
 * @param {string} text
 * @param {string} pattern
 */
function matchSegment(text, pattern) {
  let t = 0;
  let p = 0;
  let starP = -1;
  let starT = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] !== '*' && pattern[p] === text[t]) {
      t += 1;
      p += 1;
    } else if (p < pattern.length && pattern[p] === '*') {
      starP = p;
      starT = t;
      p += 1;
    } else if (starP !== -1) {
      p = starP + 1;
      starT += 1;
      t = starT;
    } else return false;
  }
  while (p < pattern.length && pattern[p] === '*') p += 1;
  return p === pattern.length;
}

/**
 * Anchored glob match (the manifest dialect; `\` normalised to `/`).
 * @param {string} path
 * @param {string} glob a glob without a leading `!`
 */
export function matchGlob(path, glob) {
  const text = path.replaceAll('\\', '/').split('/');
  const pattern = glob.split('/');
  let t = 0;
  let p = 0;
  let starP = -1;
  let starT = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] !== '**' && matchSegment(/** @type {string} */ (text[t]), /** @type {string} */ (pattern[p]))) {
      t += 1;
      p += 1;
    } else if (p < pattern.length && pattern[p] === '**') {
      starP = p;
      starT = t;
      p += 1;
    } else if (starP !== -1) {
      p = starP + 1;
      starT += 1;
      t = starT;
    } else return false;
  }
  while (p < pattern.length && pattern[p] === '**') p += 1;
  return p === pattern.length;
}

/**
 * True when the path matches a positive glob and no `!` glob of the list.
 * @param {string} path
 * @param {readonly string[]} globs
 */
export function globsMatch(path, globs) {
  let positive = false;
  for (const glob of globs) {
    if (glob.startsWith('!')) {
      if (matchGlob(path, glob.slice(1))) return false;
    } else if (!positive && matchGlob(path, glob)) positive = true;
  }
  return positive;
}

/**
 * @param {readonly string[]} files changed paths
 * @param {readonly string[]} [globs]
 * @returns {string[]} the changed paths that select the security-integration job
 */
export function securityMatches(files, globs = SECURITY_INTEGRATION_PATHS) {
  return files.filter((file) => globsMatch(file, globs));
}

/**
 * @param {string} root
 * @param {string} base
 * @param {string} head
 * @returns {{ files: string[] } | { problem: string }}
 */
export function changedFiles(root, base, head) {
  if (base === '' || ZERO_SHA.test(base) || !SHA.test(base)) return { problem: 'the range has no base commit' };
  if (!SHA.test(head)) return { problem: 'the head is not a commit id' };
  const exists = spawnSync('git', ['cat-file', '-e', `${base}^{commit}`], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (exists.status !== 0) return { problem: 'the base commit is not in the clone' };
  const diff = spawnSync('git', ['diff', '--name-only', '--no-renames', '-z', '--ignore-submodules=none', `${base}...${head}`], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (diff.status !== 0) return { problem: 'git diff failed' };
  return { files: diff.stdout.split('\0').filter((name) => name !== '') };
}

/**
 * @param {{ files: string[] } | { problem: string }} changed
 * @returns {{ selected: boolean, reason: string, matched: string[] }}
 */
export function classify(changed) {
  if ('problem' in changed) return { selected: true, reason: `${changed.problem} (fail closed: run)`, matched: [] };
  const matched = securityMatches(changed.files);
  return matched.length > 0
    ? { selected: true, reason: `${String(matched.length)} security-critical path(s) changed`, matched }
    : { selected: false, reason: `no security-critical path among ${String(changed.files.length)} changed path(s)`, matched };
}

/**
 * @param {readonly string[]} argv
 * @returns {number}
 */
export function main(argv) {
  /** @type {Record<string, string>} */
  const values = {};
  const valued = new Set(['--root', '--base', '--head', '--output', '--summary']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = /** @type {string} */ (argv[i]);
    if (!valued.has(arg) || i + 1 >= argv.length) {
      console.error(`security-paths: unknown or incomplete argument ${arg}`);
      return 2;
    }
    values[arg] = /** @type {string} */ (argv[i + 1]);
    i += 1;
  }
  const root = values['--root'];
  if (root === undefined || values['--head'] === undefined) {
    console.error('security-paths: --root and --head are required');
    return 2;
  }
  const result = classify(changedFiles(root, values['--base'] ?? '', values['--head']));
  const line = `security_paths=${String(result.selected)}`;
  console.log(`${line} (${result.reason})`);
  if (values['--output'] !== undefined) appendFileSync(values['--output'], `${line}\n`);
  if (values['--summary'] !== undefined) {
    const listed = result.matched.slice(0, MAX_LISTED).map((path) => `- \`${path.replace(/[`\r\n]/gu, '?')}\``);
    if (result.matched.length > MAX_LISTED) listed.push(`- … ${String(result.matched.length - MAX_LISTED)} more`);
    appendFileSync(
      values['--summary'],
      [
        `### Security-critical paths: security-integration ${result.selected ? 'runs' : 'skipped'}`,
        '',
        result.reason,
        ...(listed.length > 0 ? ['', ...listed] : []),
        '',
      ].join('\n'),
    );
  }
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
