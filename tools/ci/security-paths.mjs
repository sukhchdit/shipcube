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
 * suites prove. Only a production-closure change selects (ADR-0023 am. L item 2 (b), D-ARCH-127; ruling
 * wave-0-ci-minutes section 3 (3)): the merge-base and head lockfiles are parsed from git objects and their `packages`
 * entries compared; an added, removed or changed entry selects when it is the root entry `""` or is not dev-only on
 * every side where it exists, so a dev -> prod move selects. Dev-only means `dev: true` and nothing else: a
 * `devOptional: true` entry is a dev dependency that is ALSO an optional dependency of a production package (the Prisma
 * CLI, `@prisma/engines`, `@prisma/config`, whose CLI the integration harness uses to apply the migrations the suites
 * prove), so it counts as production closure (D-ARCH-133, ADR-0023 am. M item 1; PR #46 code review R2-m2; TASK-286).
 * Dev-only bumps (Jest, ESLint, TypeScript, Prettier, ...) change nothing the suites prove; lanes B and C still run them. A lockfile that is
 * new, deleted, not JSON or has no `packages` object, or a git error, selects (fail closed).
 *
 * Fail closed toward running the job: an unknown range (no base commit, a base that is not in the clone) or a git
 * error classifies as `true`. Renames count as both paths (`--no-renames`). `classifyRange(root, base, head)` is the
 * entry point (this CLI and tools/ci/lane-scope.mjs use it).
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

/**
 * ADR-0023 amendment G item 5 trigger paths, plus the lockfile (see the header), plus the security suites' own code paths
 * (PR57-SEC-02, D-SEC-PR57-01, TASK-287): the Jest config and test support every suite loads, the DB tooling and engine
 * pin the harness applies migrations with, and the generated RLS cases and API mounts the suites run. Their own unit
 * tests and fixtures are excluded (`!`), so a test-only change there does not select the job.
 */
export const SECURITY_INTEGRATION_PATHS = Object.freeze([
  'packages/authz/**',
  'packages/audit/**',
  'packages/config/**',
  'prisma/**',
  'apps/api/src/platform/**',
  'apps/api/src/modules/identity/**',
  'package-lock.json',
  'jest.config.ts',
  'tools/test-support/**',
  'tools/db/**',
  'tools/deps/**',
  'tests/generated/rls/**',
  'tests/generated/api-mounts.ts',
  '!tools/test-support/**/*.test.ts',
  '!tools/db/**/*.test.ts',
  '!tools/db/fixtures/**',
  '!tools/deps/**/*.test.ts',
]);

/** The lockfile that the production-closure rule reads (ruling section 3 (3)). */
export const LOCKFILE = 'package-lock.json';

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
 * The `packages` map of a lockfile text, or null when it is not JSON or has no `packages` object (lockfile v2 and v3
 * both carry one; a v1 lockfile does not and is treated as unparseable, fail closed).
 * @param {string} text
 * @returns {Record<string, unknown> | null}
 */
export function lockfilePackages(text) {
  let parsed;
  try {
    parsed = /** @type {unknown} */ (JSON.parse(text));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const packages = /** @type {Record<string, unknown>} */ (parsed)['packages'];
  if (packages === null || typeof packages !== 'object' || Array.isArray(packages)) return null;
  return /** @type {Record<string, unknown>} */ (packages);
}

/**
 * Canonical JSON (object keys sorted at every depth), so key order alone is not a change.
 * @param {unknown} value
 * @returns {string}
 */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(/** @type {Record<string, unknown>} */ (value)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * @param {unknown} entry
 * @returns {boolean} true for a `packages` entry flagged `dev: true`; a `devOptional: true` entry is production closure
 *   (D-ARCH-133: an optional dependency of a production package, e.g. the Prisma CLI the integration harness runs)
 */
function devOnly(entry) {
  if (entry === null || typeof entry !== 'object') return false;
  const record = /** @type {Record<string, unknown>} */ (entry);
  return record['dev'] === true;
}

/**
 * The production-closure rule for two lockfile texts (null = no lockfile at that commit).
 * @param {string | null} baseText the merge base's lockfile
 * @param {string | null} headText the head's lockfile
 * @returns {{ selected: boolean, reason: string }}
 */
export function lockfileChange(baseText, headText) {
  if (baseText === null || headText === null)
    return { selected: true, reason: `${LOCKFILE}: ${baseText === null ? 'new' : 'deleted'} lockfile (fail closed: run)` };
  const base = lockfilePackages(baseText);
  const head = lockfilePackages(headText);
  if (base === null || head === null) return { selected: true, reason: `${LOCKFILE}: unparseable lockfile (fail closed: run)` };
  /** @type {string[]} */
  const production = [];
  let devChanges = 0;
  for (const key of new Set([...Object.keys(base), ...Object.keys(head)])) {
    const before = Object.hasOwn(base, key) ? base[key] : undefined;
    const after = Object.hasOwn(head, key) ? head[key] : undefined;
    if (before !== undefined && after !== undefined && canonical(before) === canonical(after)) continue;
    const dev = key !== '' && (before === undefined || devOnly(before)) && (after === undefined || devOnly(after));
    if (dev) devChanges += 1;
    else production.push(key === '' ? '(root entry)' : key);
  }
  if (production.length > 0) {
    const shown = production.slice(0, 5).join(', ') + (production.length > 5 ? `, … ${String(production.length - 5)} more` : '');
    return { selected: true, reason: `${LOCKFILE}: production-closure change (${shown})` };
  }
  return { selected: false, reason: `${LOCKFILE}: dev-only change (${String(devChanges)} entries)` };
}

/**
 * The lockfile text at a commit (null when the commit has none), or a problem.
 * @param {string} root
 * @param {string} commit
 * @returns {{ text: string | null } | { problem: string }}
 */
function lockfileAt(root, commit) {
  const tree = spawnSync('git', ['ls-tree', '--name-only', commit, '--', LOCKFILE], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (tree.status !== 0) return { problem: `git ls-tree ${LOCKFILE} failed` };
  if (tree.stdout.trim() === '') return { text: null };
  const shown = spawnSync('git', ['show', `${commit}:${LOCKFILE}`], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (shown.status !== 0) return { problem: `git show ${LOCKFILE} failed` };
  return { text: shown.stdout };
}

/**
 * The classifier over a range: the changed paths of `<base>...<head>` (fail closed on an unknown range), where
 * `package-lock.json` selects only for a production-closure change between the merge base and the head (git objects).
 * @param {string} root
 * @param {string} base
 * @param {string} head
 * @returns {{ selected: boolean, reason: string, matched: string[] }}
 */
export function classifyRange(root, base, head) {
  const changed = changedFiles(root, base, head);
  const result = classify(changed);
  if ('problem' in changed || !result.matched.includes(LOCKFILE)) return result;
  const mergeBase = spawnSync('git', ['merge-base', base, head], { cwd: root, encoding: 'utf8', windowsHide: true });
  const commit = mergeBase.status === 0 ? mergeBase.stdout.trim() : '';
  /** @type {{ selected: boolean, reason: string }} */
  let lock;
  if (!SHA.test(commit)) lock = { selected: true, reason: `${LOCKFILE}: git merge-base failed (fail closed: run)` };
  else {
    const before = lockfileAt(root, commit);
    const after = lockfileAt(root, head);
    if ('problem' in before) lock = { selected: true, reason: `${before.problem} (fail closed: run)` };
    else if ('problem' in after) lock = { selected: true, reason: `${after.problem} (fail closed: run)` };
    else lock = lockfileChange(before.text, after.text);
  }
  const matched = lock.selected ? result.matched : result.matched.filter((path) => path !== LOCKFILE);
  return matched.length > 0
    ? { selected: true, reason: `${String(matched.length)} security-critical path(s) changed; ${lock.reason}`, matched }
    : {
        selected: false,
        reason: `no security-critical path among ${String(changed.files.length)} changed path(s); ${lock.reason}`,
        matched,
      };
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
  const result = classifyRange(root, values['--base'] ?? '', values['--head']);
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
