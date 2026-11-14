// @ts-check
/**
 * Dependency-graph pruning of an installed node_modules tree (TASK-014; platform.md §3.2 `prod-deps` row, §3.4 size
 * budget, OI-08). `npm ci --omit=dev --omit=optional --workspace=apps/<app>` still reifies packages that only other
 * workspaces need (react and react-dom were measured in the api image). This script keeps exactly the production
 * closure of the named workspaces and removes every other installed package:
 *
 *   closure   = workspace `dependencies`, `optionalDependencies` and `peerDependencies`, followed transitively through
 *               each installed package's `dependencies`, `optionalDependencies` and `peerDependencies`, resolved the
 *               way Node walks node_modules directories, over the hidden lockfile `node_modules/.package-lock.json`
 *   removed   = installed packages outside the closure (workspace links included), never anything outside node_modules
 *
 *   node tools/docker/prune-deps.mjs [--root <dir>] [--dry-run] <workspace dir>...
 *
 * Plain ESM with `node:` builtins only (it runs in image build stages). The graph helpers are shared with
 * prune-migrate-image.mjs. The runtime-stage preflight (tools/docker/preflight.mjs) proves afterwards that nothing needed went.
 */
import { readFileSync, rmSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

/**
 * @typedef {{ link?: boolean, resolved?: string, version?: string, dependencies?: Record<string, string>,
 *   optionalDependencies?: Record<string, string>, peerDependencies?: Record<string, string>,
 *   devDependencies?: Record<string, string> }} LockEntry
 * @typedef {Record<string, LockEntry>} LockPackages
 */

/**
 * Resolves `name` required from the package at `from` the way Node walks node_modules directories; a workspace link
 * resolves to its target folder.
 * @param {LockPackages} packages @param {string} from @param {string} name @returns {string | undefined}
 */
export function resolveFrom(packages, from, name) {
  for (let base = from; ; base = posix.dirname(base) === '.' ? '' : posix.dirname(base)) {
    const candidate = `${base === '' ? '' : `${base}/`}node_modules/${name}`;
    const entry = packages[candidate];
    if (entry !== undefined) return entry.link === true && entry.resolved !== undefined ? entry.resolved : candidate;
    if (base === '') return undefined;
  }
}

/** Dependency names of one lockfile entry (devDependencies only when asked). @param {LockEntry} entry @param {boolean} [dev] */
export function dependencyNames(entry, dev = false) {
  return [
    ...Object.keys(entry.dependencies ?? {}),
    ...Object.keys(entry.optionalDependencies ?? {}),
    ...Object.keys(entry.peerDependencies ?? {}),
    ...(dev ? Object.keys(entry.devDependencies ?? {}) : []),
  ];
}

/**
 * Paths reachable from `starts`, never entering `blocked`. Targets that are not installed (omitted optional or peer
 * packages) are skipped.
 * @param {LockPackages} packages @param {readonly string[]} starts
 * @param {{ blocked?: ReadonlySet<string>, devFor?: (path: string) => boolean }} [options]
 * @returns {Set<string>}
 */
export function closure(packages, starts, options = {}) {
  const blocked = options.blocked ?? new Set();
  /** @type {Set<string>} */
  const seen = new Set();
  const queue = starts.filter((start) => !blocked.has(start));
  while (queue.length > 0) {
    const path = /** @type {string} */ (queue.pop());
    if (seen.has(path) || blocked.has(path)) continue;
    seen.add(path);
    for (const name of dependencyNames(packages[path] ?? {}, options.devFor?.(path) === true)) {
      const target = resolveFrom(packages, path, name);
      if (target !== undefined && packages[target] !== undefined) queue.push(target);
    }
  }
  return seen;
}

/** Sorted paths without those nested below another listed path (removing the parent removes them). @param {string[]} paths */
export const outermost = (paths) =>
  [...paths].sort().filter((path) => !paths.some((other) => other !== path && path.startsWith(`${other}/`)));

/**
 * Installed node_modules paths outside the production closure of `workspaces`. Pure (lockfile in, paths out).
 * @param {LockPackages} packages @param {readonly string[]} workspaces e.g. ['apps/api']
 */
export function outsideClosure(packages, workspaces) {
  const kept = closure(packages, workspaces);
  // A workspace link (node_modules/@platform/x -> packages/x) stays exactly when its target is in the closure.
  const keep = (/** @type {string} */ path) => {
    const entry = packages[path];
    return kept.has(path) || (entry?.link === true && entry.resolved !== undefined && kept.has(entry.resolved));
  };
  return outermost(Object.keys(packages).filter((path) => path.includes('node_modules/') && !keep(path)));
}

/** Lockfile packages of an installed tree: the hidden lockfile plus the root manifest under ''. @param {string} root */
export function readInstalledTree(root) {
  const hidden = JSON.parse(readFileSync(join(root, 'node_modules', '.package-lock.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  /** @type {LockPackages} */
  const packages = { '': manifest, ...hidden.packages };
  // A workspace folder without installed packages of its own may have no entry; its manifest supplies the edges.
  for (const entry of /** @type {LockEntry[]} */ (Object.values(hidden.packages ?? {}))) {
    const target = entry.resolved;
    if (entry.link === true && target !== undefined && packages[target] === undefined) {
      try {
        packages[target] = JSON.parse(readFileSync(join(root, ...target.split('/'), 'package.json'), 'utf8'));
      } catch {
        // A link to a workspace whose manifest is absent leads nowhere; it goes with the other unreachable paths.
      }
    }
  }
  return packages;
}

/** @param {string[]} argv @returns {number} */
export function main(argv) {
  const rootFlag = argv.indexOf('--root');
  const root = resolve(rootFlag > -1 ? (argv[rootFlag + 1] ?? '') : '.');
  const workspaces = argv.filter((arg, index) => !arg.startsWith('--') && argv[index - 1] !== '--root');
  if (workspaces.length === 0) {
    process.stderr.write('usage: prune-deps.mjs [--root <dir>] [--dry-run] <workspace dir>...\n');
    return 2;
  }
  const packages = readInstalledTree(root);
  const missing = workspaces.filter((workspace) => packages[workspace] === undefined);
  if (missing.length > 0) {
    process.stderr.write(`[prune-deps] not an installed workspace: ${missing.join(', ')}\n`);
    return 1;
  }
  const doomed = outsideClosure(packages, workspaces);
  process.stdout.write(`[prune-deps] ${workspaces.join(' ')}: removing ${doomed.length} package(s) outside the production closure\n`);
  if (doomed.length > 0) process.stdout.write(`[prune-deps] ${doomed.join(' ')}\n`);
  if (argv.includes('--dry-run')) return 0;
  for (const path of doomed) rmSync(join(root, ...path.split('/')), { recursive: true, force: true });
  return 0;
}

if (import.meta.main === true) process.exitCode = main(process.argv.slice(2));
