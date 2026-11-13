// @ts-check
/**
 * Image pruning of build output and production node_modules (TASK-014; platform.md §3.2 `prod-deps` and `runtime` rows,
 * SPK-01 F-13). `tsc -b` emits compiled tests next to the code, so before the runtime stage copies `dist/`, this script
 * removes, below every directory given:
 *
 *   always            `*.test.*` files and `__fixtures__/` directories (node_modules included), `*.tsbuildinfo`;
 *                     outside node_modules also `fixtures/`, `tests/` and `spikes/` directories
 *   --declarations    type declarations (`*.d.ts`, `*.d.mts`, `*.d.cts` and their maps)
 *   --node-modules    for a production node_modules tree: Markdown files (licence and notice files are kept), source
 *                     maps, type declarations (implies --declarations) and the non-PostgreSQL Prisma query compilers;
 *                     `test`/`tests` folders of packages are kept
 *                     because some packages ship runtime code under those names
 *
 *   node tools/docker/prune-dist.mjs [--declarations] [--node-modules] <dir>...
 *
 * Plain ESM with `node:` builtins only (it runs inside the image build). Prints one summary line per directory.
 */
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const LICENCE = /^(?:licen[cs]e|notice|copying|authors)(?:[.-].*)?$/i;
const DECLARATION = /\.d\.[cm]?ts(?:\.map)?$/;
/**
 * Prisma 7 ships a WebAssembly query compiler per database provider inside @prisma/client/runtime (about 9 MB each,
 * fast and small builds). The datasource is PostgreSQL only (data-model.md §7.1, ADR-0005), so the MySQL, SQLite, SQL
 * Server and CockroachDB compilers are dead weight in the runtime images (size budget, platform.md §3.4 / OI-08).
 */
const OTHER_PROVIDER_COMPILER = /(?:^|\/)@prisma\/client\/runtime\/query_compiler_[a-z]+_bg\.(?:mysql|sqlite|sqlserver|cockroachdb)\./;
/**
 * Of the PostgreSQL compilers, the generated `prisma-client` (ESM, default `compilerBuild` fast) loads only
 * `query_compiler_fast_bg.postgresql.mjs` and `…postgresql.wasm-base64.mjs` (prisma/generated/prisma/internal); the
 * `small` build and the CommonJS `.js` twins are never loaded (about 13 MB; the worker size budget, OI-08). The
 * runtime preflight that imports `@platform/prisma/client` (TASK-020 part 020-B) proves the remaining pair loads.
 */
const UNUSED_POSTGRESQL_COMPILER =
  /(?:^|\/)@prisma\/client\/runtime\/query_compiler_(?:small_bg\.postgresql\.|fast_bg\.postgresql\.(?:wasm-base64\.)?js$)/;

/**
 * Decides whether one entry goes. Pure, so the rules are unit-tested without a file system.
 * @param {string} relPath path relative to the pruned root, `/`-separated
 * @param {boolean} isDirectory
 * @param {{ declarations?: boolean, nodeModules?: boolean }} [options]
 */
export function shouldRemove(relPath, isDirectory, options = {}) {
  const name = relPath.split('/').at(-1) ?? '';
  const nodeModules = options.nodeModules === true;
  if (isDirectory) {
    if (name === '__fixtures__') return true;
    return !nodeModules && ['fixtures', 'tests', 'spikes'].includes(name);
  }
  if (/\.test\.[^/]+$/.test(name)) return true;
  if (name.endsWith('.tsbuildinfo')) return true;
  if ((options.declarations === true || nodeModules) && DECLARATION.test(name)) return true;
  if (nodeModules && name.endsWith('.map')) return true;
  if (nodeModules && (OTHER_PROVIDER_COMPILER.test(relPath) || UNUSED_POSTGRESQL_COMPILER.test(relPath))) return true;
  if (nodeModules && /\.(?:md|markdown)$/i.test(name) && !LICENCE.test(name)) return true;
  return false;
}

/**
 * Removes the matching entries below `root`; returns the number of removed files and directories.
 * @param {string} root
 * @param {{ declarations?: boolean, nodeModules?: boolean }} [options]
 */
export function prune(root, options = {}) {
  let removed = 0;
  /** @param {string} dir @param {string} rel */
  const visit = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      const full = join(dir, entry.name);
      // Symbolic links (workspace links in node_modules) are never followed or removed.
      if (entry.isSymbolicLink()) continue;
      if (shouldRemove(entryRel, entry.isDirectory(), options)) {
        rmSync(full, { recursive: true, force: true });
        removed += 1;
      } else if (entry.isDirectory()) visit(full, entryRel);
    }
  };
  visit(root, '');
  return removed;
}

/** @param {string[]} argv @returns {number} exit code */
export function main(argv) {
  const options = { declarations: argv.includes('--declarations'), nodeModules: argv.includes('--node-modules') };
  const dirs = argv.filter((arg) => !arg.startsWith('--'));
  const unknown = argv.filter((arg) => arg.startsWith('--') && !['--declarations', '--node-modules'].includes(arg));
  if (dirs.length === 0 || unknown.length > 0) {
    process.stderr.write('usage: prune-dist.mjs [--declarations] [--node-modules] <dir>...\n');
    return 2;
  }
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      process.stderr.write(`[prune-dist] missing directory: ${dir}\n`);
      return 1;
    }
    process.stdout.write(`[prune-dist] ${dir}: removed ${prune(dir, options)} entr(ies)\n`);
  }
  return 0;
}

if (import.meta.main === true) process.exitCode = main(process.argv.slice(2));
