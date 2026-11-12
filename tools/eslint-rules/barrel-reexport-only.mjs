/**
 * `platform/barrel-reexport-only` (tracked follow-up m4; ADR-0002 §5): `packages/<name>/src/index.ts` is the package's
 * public entry and contains only re-exports (`export * from`, `export { x } from`, `export type { T } from`) or the
 * placeholder `export {}`. Jest excludes these barrels from coverage (jest.config.ts), so any logic placed here would
 * be untested and uncounted. Applied to the barrels by eslint.config.mjs.
 */

/**
 * @param {import('estree').Program['body'][number] | import('estree').ModuleDeclaration} statement
 * @returns {boolean}
 */
function isReexport(statement) {
  if (statement.type === 'ExportAllDeclaration') return true;
  if (statement.type !== 'ExportNamedDeclaration') return false;
  if (statement.source) return true;
  return !statement.declaration && statement.specifiers.length === 0;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Allow only re-export statements in package entry points (packages/*/src/index.ts).' },
    schema: [],
    messages: {
      notReexport:
        'Package entry points may only re-export (`export … from`, `export type … from`, `export {}`); move this code to its own module.',
    },
  },
  create(context) {
    return {
      Program(node) {
        for (const statement of node.body) {
          if (!isReexport(statement)) context.report({ node: statement, messageId: 'notReexport' });
        }
      },
    };
  },
};
