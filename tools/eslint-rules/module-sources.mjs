/**
 * Shared visitor for the local ESLint rules that inspect module specifiers: static imports, re-exports,
 * dynamic `import('x')` and CommonJS `require('x')`.
 */

/**
 * @typedef {object} ModuleReference
 * @property {import('estree').Node} node Node to report on (the specifier literal).
 * @property {string} source Module specifier as written.
 * @property {readonly string[]} names Value names taken from the module (`default`, `*` for namespace / unknown).
 * @property {boolean} typeOnly True when nothing is imported at runtime (`import type`, only `type` specifiers).
 */

/**
 * @param {import('estree').Node} node
 * @returns {boolean}
 */
function isTypeOnly(node) {
  const kind = /** @type {{ importKind?: string; exportKind?: string }} */ (node);
  return kind.importKind === 'type' || kind.exportKind === 'type';
}

/**
 * @param {import('estree').ImportDeclaration['specifiers'][number]} specifier
 * @returns {string}
 */
function importedName(specifier) {
  if (specifier.type === 'ImportDefaultSpecifier') return 'default';
  if (specifier.type === 'ImportNamespaceSpecifier') return '*';
  const { imported } = specifier;
  return imported.type === 'Identifier' ? imported.name : String(imported.value);
}

/**
 * @param {(reference: ModuleReference) => void} onReference
 * @returns {import('eslint').Rule.RuleListener}
 */
export function moduleSourceVisitor(onReference) {
  return {
    ImportDeclaration(node) {
      const valueSpecifiers = node.specifiers.filter((specifier) => !isTypeOnly(specifier));
      onReference({
        node: node.source,
        source: String(node.source.value),
        names: valueSpecifiers.map(importedName),
        typeOnly: isTypeOnly(node) || (node.specifiers.length > 0 && valueSpecifiers.length === 0),
      });
    },
    ExportAllDeclaration(node) {
      onReference({ node: node.source, source: String(node.source.value), names: ['*'], typeOnly: isTypeOnly(node) });
    },
    ExportNamedDeclaration(node) {
      if (!node.source) return;
      const valueSpecifiers = node.specifiers.filter((specifier) => !isTypeOnly(specifier));
      onReference({
        node: node.source,
        source: String(node.source.value),
        names: valueSpecifiers.map((specifier) =>
          specifier.local.type === 'Identifier' ? specifier.local.name : String(specifier.local.value),
        ),
        typeOnly: isTypeOnly(node) || (node.specifiers.length > 0 && valueSpecifiers.length === 0),
      });
    },
    ImportExpression(node) {
      if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
        onReference({ node: node.source, source: node.source.value, names: ['*'], typeOnly: false });
      }
    },
    CallExpression(node) {
      const [first] = node.arguments;
      if (
        node.callee.type === 'Identifier' &&
        node.callee.name === 'require' &&
        first?.type === 'Literal' &&
        typeof first.value === 'string'
      ) {
        onReference({ node: first, source: first.value, names: ['*'], typeOnly: false });
      }
    },
  };
}
