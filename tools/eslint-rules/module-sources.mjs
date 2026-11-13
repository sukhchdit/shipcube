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
 * The module specifier written as a string literal or a no-substitution template literal (PR32-SEC-07 (a)).
 * @param {import('estree').Node | null | undefined} node
 * @returns {string | undefined}
 */
export function staticSpecifier(node) {
  if (node?.type === 'Literal') return typeof node.value === 'string' ? node.value : undefined;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? undefined;
  return undefined;
}

/**
 * @param {import('estree').Node} callee
 * @returns {boolean} `createRequire` or `<x>.createRequire`.
 */
const isCreateRequire = (callee) =>
  (callee.type === 'Identifier' && callee.name === 'createRequire') ||
  (callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'createRequire');

/**
 * Whether `call` loads a module by a CommonJS-style require: `require(x)`, `<x>.require(x)` (`module.require`),
 * `createRequire(url)(x)`, or `req(x)` where `req` is a variable initialised with `createRequire(url)` (PR32-SEC-07 (a)).
 * @param {import('estree').CallExpression} call
 * @param {import('eslint').SourceCode} sourceCode
 * @returns {boolean}
 */
export function isRequireCall(call, sourceCode) {
  const { callee } = call;
  if (callee.type === 'Identifier' && callee.name === 'require') return true;
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'require'
  ) {
    return true;
  }
  if (callee.type === 'CallExpression') return isCreateRequire(callee.callee);
  if (callee.type !== 'Identifier') return false;
  /** @type {import('eslint').Scope.Scope | null} */
  let scope = sourceCode.getScope(call);
  while (scope) {
    const variable = scope.set.get(callee.name);
    if (variable) {
      return variable.defs.some(
        (def) => def.type === 'Variable' && def.node.init?.type === 'CallExpression' && isCreateRequire(def.node.init.callee),
      );
    }
    scope = scope.upper;
  }
  return false;
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
      const source = staticSpecifier(node.source);
      if (source !== undefined) onReference({ node: node.source, source, names: ['*'], typeOnly: false });
    },
    CallExpression(node) {
      const [first] = node.arguments;
      const source = first === undefined || first.type === 'SpreadElement' ? undefined : staticSpecifier(first);
      if (node.callee.type === 'Identifier' && node.callee.name === 'require' && first !== undefined && source !== undefined) {
        onReference({ node: first, source, names: ['*'], typeOnly: false });
      }
    },
  };
}
