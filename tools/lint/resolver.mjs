/**
 * Module resolution for the lint tooling (ADR-0002 am. item 3, D-ARCH-036; TASK-002).
 *
 * Workspace packages export `{ "@platform/source": "./src/index.ts", "types", "default" }`, so a resolver without
 * the `@platform/source` condition would send `@platform/shared` to a `dist/` that may not be built. Both resolver
 * consumers share these options so they classify files identically:
 *  - `eslint-plugin-import-x` takes the resolver object (`import-x/resolver-next` setting);
 *  - `eslint-plugin-boundaries` loads a legacy (interface v2) resolver by path through `eslint-module-utils`, which is
 *    this module itself (named exports `interfaceVersion` and `resolve`).
 * The resolver is import-x's built-in `unrs-resolver` wrapper, so no extra resolver dependency is needed.
 */
import { createNodeResolver } from 'eslint-plugin-import-x';

/** Export condition of the workspace packages (matches tsconfig.base.json `customConditions` and Jest). */
export const WORKSPACE_CONDITION = '@platform/source';

/** Options of the `unrs-resolver` behind `createNodeResolver`. NodeNext sources import `./x.js` for `./x.ts`. */
export const resolverOptions = {
  conditionNames: [WORKSPACE_CONDITION, 'types', 'import', 'node', 'default'],
  extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.node'],
  extensionAlias: {
    '.js': ['.ts', '.tsx', '.js', '.jsx'],
    '.mjs': ['.mts', '.mjs'],
    '.cjs': ['.cts', '.cjs'],
  },
  mainFields: ['module', 'main'],
};

export function createWorkspaceResolver() {
  return createNodeResolver(resolverOptions);
}

const legacyResolver = createWorkspaceResolver();

/** Legacy resolver interface (v2) used by eslint-plugin-boundaries. */
export const interfaceVersion = 2;

/**
 * @param {string} source Module specifier as written.
 * @param {string} file Absolute path of the importing file.
 * @returns {{ found: boolean; path?: string | null | undefined }}
 */
export function resolve(source, file) {
  return legacyResolver.resolve(source, file);
}
