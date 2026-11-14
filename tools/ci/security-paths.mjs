// @ts-check
/**
 * Security-critical path classifier (lane A; ADR-0023 amendment G item 5; TEST-STRATEGY section 4.1; TASK-015 part 015-B).
 *
 * Decides whether a pull request needs the hosted `security-integration` job: true when any path changed in
 * `<base>...<head>` matches `security_critical_paths` of the required-suite manifest. The CALLER passes the BASE ref's
 * manifest (`git show "$RANGE_BASE:tools/quality/required-suites.json"`), so a PR cannot drop a path from its own
 * selection. Runs in ci.yml job `scans` (no npm, no node_modules): this file imports nothing but `node:` modules.
 *
 * Fail closed toward running the job: an unknown range (no base commit), a missing, empty or malformed manifest, an
 * empty glob list or a git error all classify as `true`. Renames count as both paths (`--no-renames`).
 *
 * Glob dialect = tools/quality/lib/manifest.mjs `globsMatch` (anchored, `/`-separated, `**` whole segment, `*` within a
 * segment, `!` negates). The matcher is a copy because job `scans` extracts only tools/ci from the base ref;
 * security-paths.test.ts pins parity with the manifest copy on a path corpus, so the two cannot drift silently.
 *
 * CLI: node tools/ci/security-paths.mjs --root <dir> --base <sha> --head <sha> --manifest <file>
 *        [--output <$GITHUB_OUTPUT>] [--summary <$GITHUB_STEP_SUMMARY>]
 * Writes `security_paths=true|false` to --output (and stdout). Exit 0 classified, 2 usage error.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

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
 * `security_critical_paths` of a manifest text, or a reason why it cannot be used (then the PR classifies as true).
 * @param {string} text
 * @returns {{ globs: string[] } | { problem: string }}
 */
export function securityGlobs(text) {
  if (text.trim() === '') return { problem: 'no base-ref manifest' };
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { problem: 'the base-ref manifest is not JSON' };
  }
  const list =
    typeof raw === 'object' && raw !== null ? /** @type {Record<string, unknown>} */ (raw)['security_critical_paths'] : undefined;
  if (!Array.isArray(list) || list.length === 0 || !list.every((g) => typeof g === 'string' && g !== '' && g !== '!'))
    return { problem: 'security_critical_paths is missing, empty or not a list of globs' };
  return { globs: /** @type {string[]} */ (list) };
}

/**
 * @param {readonly string[]} files changed paths
 * @param {readonly string[]} globs
 * @returns {string[]} the changed paths that are security-critical
 */
export function securityMatches(files, globs) {
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
 * @param {{ globs: string[] } | { problem: string }} globs
 * @returns {{ selected: boolean, reason: string, matched: string[] }}
 */
export function classify(changed, globs) {
  if ('problem' in changed) return { selected: true, reason: `${changed.problem} (fail closed: run)`, matched: [] };
  if ('problem' in globs) return { selected: true, reason: `${globs.problem} (fail closed: run)`, matched: [] };
  const matched = securityMatches(changed.files, globs.globs);
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
  const valued = new Set(['--root', '--base', '--head', '--manifest', '--output', '--summary']);
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
  const manifest = values['--manifest'];
  if (root === undefined || manifest === undefined || values['--head'] === undefined) {
    console.error('security-paths: --root, --head and --manifest are required');
    return 2;
  }
  const changed = changedFiles(root, values['--base'] ?? '', values['--head']);
  const globs = securityGlobs(existsSync(manifest) ? readFileSync(manifest, 'utf8') : '');
  const result = classify(changed, globs);
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
