// @ts-check
/**
 * Prunes Prisma Studio and the Prisma dev server out of the tooling (migrate/bootstrap/seed) image (TASK-014;
 * platform.md §3.2 `migrate` row; ADR-0022 am. 12; SPK-01 F-14; PR1-SEC-04 (b), PR1-SEC-05). `prisma` 7.10.1 declares
 * `@prisma/studio-core` (→ `elkjs` EPL-2.0, `@visx/*` alpha, `d3-*`) and `@prisma/dev` as regular dependencies, so
 * `--omit=optional` keeps them. This script:
 *
 *   1. removes `node_modules/@prisma/studio-core` and `node_modules/@prisma/dev` with their EXCLUSIVE subtrees: every
 *      installed package reachable from them that no other root (the workspace root, the workspaces, their
 *      dependencies) reaches. Reachability follows Node's resolution over the hidden lockfile
 *      `node_modules/.package-lock.json` that `npm ci` writes;
 *   2. with `--stub-studio`, installs the stub fallback of ADR-0022 am. 12: `prisma/build/cli.js` requires
 *      `@prisma/studio-core/data/{bff,mysql2,node-sqlite,postgresjs}` at module load (PR1-SEC-04 (b)), so a stub
 *      package answers those requires with an object whose every member throws when used. `prisma studio` therefore
 *      fails with a clear message; `migrate deploy`, `migrate status` and `--version` never touch it;
 *   3. verifies the invariants: no `elkjs`, no real `@prisma/studio-core`, no `@prisma/dev`.
 *
 *   node tools/docker/prune-migrate-image.mjs [--root <dir>] [--stub-studio] [--dry-run]
 *
 * Plain ESM with `node:` builtins only (it runs in the image build stage). Exit 0 ok, 1 invariant failure, 2 usage.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { closure, outermost, readInstalledTree } from './prune-deps.mjs';

export const REMOVE_ROOTS = Object.freeze(['node_modules/@prisma/studio-core', 'node_modules/@prisma/dev']);
export const STUB_VERSION = '0.0.0-removed';

/**
 * Paths to delete: the removal roots plus every package only they reach. Pure (lockfile in, paths out). The kept set
 * starts at every project folder (root and workspaces, devDependencies included: the tooling image installs them).
 * @param {import('./prune-deps.mjs').LockPackages} packages hidden-lockfile `packages`, with the root project under ''
 * @param {readonly string[]} [roots]
 * @returns {string[]} sorted, without paths nested under another returned path
 */
export function exclusiveSubtrees(packages, roots = REMOVE_ROOTS) {
  const present = roots.filter((root) => packages[root] !== undefined);
  const isProject = (/** @type {string} */ path) => !path.includes('node_modules/');
  const kept = closure(packages, Object.keys(packages).filter(isProject), { blocked: new Set(present), devFor: isProject });
  return outermost([...closure(packages, present)].filter((path) => !kept.has(path) && !isProject(path)));
}

export { readInstalledTree };

const STUB_MODULE = `'use strict';
// Stub written by tools/docker/prune-migrate-image.mjs (ADR-0022 am. 12): Prisma Studio is not part of this image.
const fail = () => {
  throw new Error('Prisma Studio is not available in the tooling image (ADR-0022 am. 12)');
};
module.exports = new Proxy(
  {},
  {
    get: (_target, key) => (key === '__esModule' || key === 'then' || typeof key === 'symbol' ? undefined : fail),
  },
);
`;

/** Writes the throwing stub package in place of `@prisma/studio-core`. @param {string} root */
export function writeStudioStub(root) {
  const dir = join(root, 'node_modules', '@prisma', 'studio-core');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const target = { require: './stub.cjs', default: './stub.cjs' };
  const manifest = {
    name: '@prisma/studio-core',
    version: STUB_VERSION,
    private: true,
    license: 'UNLICENSED',
    exports: { '.': target, './data': target, './data/*': target, './package.json': './package.json' },
  };
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(dir, 'stub.cjs'), STUB_MODULE);
}

/** Invariant violations of the pruned tree. @param {string} root @returns {string[]} */
export function invariantViolations(root) {
  /** @type {string[]} */
  const out = [];
  const visit = (/** @type {string} */ dir, /** @type {number} */ depth) => {
    if (!existsSync(dir) || depth > 12) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = join(dir, entry.name);
      if (entry.name === 'elkjs') out.push(`${full} (EPL-2.0)`);
      if (entry.name === 'dev' && dir.endsWith('@prisma')) out.push(full);
      if (entry.name === 'studio-core' && dir.endsWith('@prisma')) {
        const version = JSON.parse(readFileSync(join(full, 'package.json'), 'utf8')).version;
        if (version !== STUB_VERSION) out.push(`${full} (real Studio ${version})`);
      }
      visit(full, depth + 1);
    }
  };
  visit(join(root, 'node_modules'), 0);
  return out;
}

/** @param {string[]} argv @returns {number} */
export function main(argv) {
  const rootFlag = argv.indexOf('--root');
  const root = resolve(rootFlag > -1 ? (argv[rootFlag + 1] ?? '') : '.');
  const known = new Set(['--root', '--stub-studio', '--dry-run']);
  if (argv.some((arg, index) => arg.startsWith('--') && !known.has(arg) && argv[index - 1] !== '--root')) {
    process.stderr.write('usage: prune-migrate-image.mjs [--root <dir>] [--stub-studio] [--dry-run]\n');
    return 2;
  }
  const doomed = exclusiveSubtrees(readInstalledTree(root));
  process.stdout.write(`[prune-migrate-image] removing ${doomed.length} package(s): ${doomed.join(' ')}\n`);
  if (argv.includes('--dry-run')) return 0;
  for (const path of doomed) rmSync(join(root, ...path.split('/')), { recursive: true, force: true });
  if (argv.includes('--stub-studio')) writeStudioStub(root);
  const violations = invariantViolations(root);
  for (const violation of violations) process.stderr.write(`[prune-migrate-image] still present: ${violation}\n`);
  return violations.length === 0 ? 0 : 1;
}

if (import.meta.main === true) process.exitCode = main(process.argv.slice(2));
