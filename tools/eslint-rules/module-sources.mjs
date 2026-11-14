/**
 * Shared visitor for the local ESLint rules that inspect module specifiers: static imports, re-exports,
 * dynamic `import('x')` and CommonJS-style loads (`require('x')`, `module.require('x')` and every `createRequire`
 * form, R1-m6). Residual: a loader the syntax does not name (`Module._load`, a computed member
 * `m['create' + 'Require']`); platform/static-module-specifier confines `createRequire` itself (PR44-SEC-01).
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

/** The modules that export `createRequire`. */
const NODE_MODULE = new Set(['node:module', 'module']);
const CREATE_REQUIRE = 'createRequire';

/**
 * @param {unknown} source A module specifier.
 * @returns {boolean} Whether it names Node's `module` built-in (the home of `createRequire`).
 */
export const isNodeModule = (source) => typeof source === 'string' && NODE_MODULE.has(source);

/**
 * @param {import('eslint').SourceCode} sourceCode
 * @param {import('estree').Identifier} identifier
 * @returns {import('eslint').Scope.Variable | undefined} The variable `identifier` refers to.
 */
function resolveVariable(sourceCode, identifier) {
  /** @type {import('eslint').Scope.Scope | null} */
  let scope = sourceCode.getScope(identifier);
  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
    scope = scope.upper;
  }
  return undefined;
}

/**
 * @param {import('eslint').SourceCode} sourceCode
 * @param {import('estree').Identifier} identifier
 * @returns {string | undefined} The name imported from `node:module` behind `identifier` (`*` for a namespace or default).
 */
function nodeModuleImport(sourceCode, identifier) {
  const def = resolveVariable(sourceCode, identifier)?.defs.find((candidate) => candidate.type === 'ImportBinding');
  if (def === undefined || !NODE_MODULE.has(String(/** @type {import('estree').ImportDeclaration} */ (def.parent).source.value))) {
    return undefined;
  }
  return def.node.type === 'ImportSpecifier' ? importedName(def.node) : '*';
}

/**
 * D-ARCH-111 (h): `createRequire` by name, a local alias of its import from `node:module`
 * (`import { createRequire as mk }`), or a member `createRequire` (`<x>.createRequire`: a namespace or default import,
 * `(await import('node:module')).createRequire`, `process.getBuiltinModule('module').createRequire`).
 * @param {import('estree').Node} callee
 * @param {import('eslint').SourceCode} sourceCode
 * @returns {boolean}
 */
export const isCreateRequire = (callee, sourceCode) => {
  if (callee.type === 'Identifier') return callee.name === CREATE_REQUIRE || nodeModuleImport(sourceCode, callee) === CREATE_REQUIRE;
  if (callee.type !== 'MemberExpression') return false;
  if (!callee.computed) return callee.property.type === 'Identifier' && callee.property.name === CREATE_REQUIRE;
  return callee.property.type === 'Literal' && callee.property.value === CREATE_REQUIRE;
};

/**
 * Whether `call` loads a module by a CommonJS-style require: `require(x)`, `<x>.require(x)` (`module.require`),
 * `createRequire(url)(x)`, or `req(x)` where `req` is a variable initialised with `createRequire(url)` (PR32-SEC-07 (a));
 * `createRequire` includes its import aliases and namespace members (D-ARCH-111 (h)).
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
  if (callee.type === 'CallExpression') return isCreateRequire(callee.callee, sourceCode);
  if (callee.type !== 'Identifier') return false;
  return (resolveVariable(sourceCode, callee)?.defs ?? []).some(
    (def) => def.type === 'Variable' && def.node.init?.type === 'CallExpression' && isCreateRequire(def.node.init.callee, sourceCode),
  );
}

/**
 * Calls `onReference` for every module load with a literal specifier. The CommonJS-style loads are every form
 * {@link isRequireCall} knows (R1-m6, PR44-SEC-01): bare `require(x)`, `module.require(x)`, `createRequire(url)(x)`, a
 * const-held loader `req(x)`, and `createRequire` through an import alias or a namespace / default member; each is
 * reported with `names: ['*']` (the whole module value).
 * @param {(reference: ModuleReference) => void} onReference
 * @param {import('eslint').SourceCode} sourceCode
 * @returns {import('eslint').Rule.RuleListener}
 */
export function moduleSourceVisitor(onReference, sourceCode) {
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
      if (first !== undefined && source !== undefined && isRequireCall(node, sourceCode)) {
        onReference({ node: first, source, names: ['*'], typeOnly: false });
      }
    },
  };
}
