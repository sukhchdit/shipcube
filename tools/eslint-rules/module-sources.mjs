/**
 * Shared visitor for the local ESLint rules that inspect module specifiers: static imports, re-exports,
 * dynamic `import('x')`, `import x = require('x')` (PR44-SEC-11 (a)) and CommonJS-style loads (`require('x')`,
 * `module.require('x')` and every `createRequire` form, R1-m6, a static template key included, PR44-SEC-10).
 * Residual: a loader the syntax does not name (`Module._load`). A static import of it is refused by
 * no-restricted-imports; platform/static-module-specifier confines `createRequire` itself (PR44-SEC-01) and bounds
 * every other `node:module` value by {@link NODE_MODULE_ALLOWED} (a key outside it, or not a static string, is
 * reported: `m.Module`, `m.register`, `m[k]`, `Reflect.get(m, k)`, PR44-SEC-10, PR54-SEC-03).
 */

/**
 * PR44-SEC-14 / PR54-SEC-03: the only `node:module` members application code may reach, in every form (the static
 * import through no-restricted-imports in eslint.config.mjs, every other module value through
 * platform/static-module-specifier). `createRequire` is itself confined to `createRequire(<url>).resolve('<literal>')`;
 * `builtinModules` and `isBuiltin` are read-only lookups. `Module` (`Module._load`), `register` / `registerHooks` and
 * `default` (the whole module again) load modules past every import control.
 */
export const NODE_MODULE_ALLOWED = Object.freeze(['createRequire', 'builtinModules', 'isBuiltin']);

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
  // PR44-SEC-11 (a): an `import x = require('m')` / `import X = NS.y` binding has no ImportDeclaration (no `source`).
  const declaration = /** @type {import('estree').Node | undefined} */ (def?.parent);
  if (def === undefined || declaration?.type !== 'ImportDeclaration' || !NODE_MODULE.has(String(declaration.source.value))) {
    return undefined;
  }
  return def.node.type === 'ImportSpecifier' ? importedName(def.node) : '*';
}

/**
 * @param {import('estree').Identifier} identifier
 * @param {import('eslint').SourceCode} sourceCode
 * @returns {boolean} Whether `identifier` is a namespace or default import of `node:module` (the whole module value).
 */
export const isNodeModuleNamespace = (identifier, sourceCode) => nodeModuleImport(sourceCode, identifier) === '*';

/**
 * @param {import('estree').Node} key a property key (member, object pattern, export specifier)
 * @param {boolean} computed
 * @returns {boolean} Whether the key names `createRequire`: an identifier, a string literal, or a computed key that is
 * a static string (`['createRequire']`, `` [`createRequire`] ``, PR44-SEC-10).
 */
export const isCreateRequireKey = (key, computed) =>
  !computed && key.type === 'Identifier' ? key.name === CREATE_REQUIRE : staticSpecifier(key) === CREATE_REQUIRE;

/**
 * D-ARCH-111 (h): `createRequire` by name, a local alias of its import from `node:module`
 * (`import { createRequire as mk }`), or a member `createRequire` (`<x>.createRequire`, `<x>['createRequire']`,
 * `` <x>[`createRequire`] ``: a namespace or default import, `(await import('node:module')).createRequire`,
 * `process.getBuiltinModule('module').createRequire`).
 * @param {import('estree').Node} callee
 * @param {import('eslint').SourceCode} sourceCode
 * @returns {boolean}
 */
export const isCreateRequire = (callee, sourceCode) => {
  if (callee.type === 'Identifier') return callee.name === CREATE_REQUIRE || nodeModuleImport(sourceCode, callee) === CREATE_REQUIRE;
  return callee.type === 'MemberExpression' && isCreateRequireKey(callee.property, callee.computed);
};

/**
 * A variable holding `createRequire` itself: `const mk = createRequire`, `const mk = m.createRequire`, or
 * `const { createRequire: mk } = m` (any static key form). platform/static-module-specifier reports the declaration;
 * this lets {@link isRequireCall} still see the loads made through it (`mk(url)(x)`).
 * @param {import('estree').Identifier} identifier
 * @param {import('eslint').SourceCode} sourceCode
 * @returns {boolean}
 */
const isCreateRequireVariable = (identifier, sourceCode) =>
  (resolveVariable(sourceCode, identifier)?.defs ?? []).some((def) => {
    if (def.type !== 'Variable') return false;
    const property = /** @type {import('estree').Node & { parent?: import('estree').Node }} */ (def.name).parent;
    if (property?.type === 'Property' && property.value === def.name) return isCreateRequireKey(property.key, property.computed);
    return def.node.id === def.name && def.node.init !== null && def.node.init !== undefined && isCreateRequire(def.node.init, sourceCode);
  });

/**
 * @param {import('estree').Node} callee
 * @param {import('eslint').SourceCode} sourceCode
 * @returns {boolean} `callee` is `createRequire` in a form {@link isCreateRequire} knows, or a variable holding it.
 */
const isCreateRequireOrVariable = (callee, sourceCode) =>
  isCreateRequire(callee, sourceCode) || (callee.type === 'Identifier' && isCreateRequireVariable(callee, sourceCode));

/**
 * Whether `call` loads a module by a CommonJS-style require: `require(x)`, `<x>.require(x)` (`module.require`),
 * `createRequire(url)(x)`, or `req(x)` where `req` is a variable initialised with `createRequire(url)` (PR32-SEC-07 (a));
 * `createRequire` includes its import aliases, namespace members (D-ARCH-111 (h)), static template keys and a variable
 * holding the function (`const { [`createRequire`]: mk } = m; mk(url)(x)`, PR44-SEC-10).
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
  if (callee.type === 'CallExpression') return isCreateRequireOrVariable(callee.callee, sourceCode);
  if (callee.type !== 'Identifier') return false;
  return (resolveVariable(sourceCode, callee)?.defs ?? []).some(
    (def) =>
      def.type === 'Variable' && def.node.init?.type === 'CallExpression' && isCreateRequireOrVariable(def.node.init.callee, sourceCode),
  );
}

/**
 * Calls `onReference` for every module load with a literal specifier. The CommonJS-style loads are every form
 * {@link isRequireCall} knows (R1-m6, PR44-SEC-01): bare `require(x)`, `module.require(x)`, `createRequire(url)(x)`, a
 * const-held loader `req(x)`, and `createRequire` through an import alias or a namespace / default member; each is
 * reported with `names: ['*']` (the whole module value). `import x = require('<literal>')` is the same kind of load
 * (PR44-SEC-11 (a), fail closed); `import X = NS.y` loads nothing.
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
    /** @param {import('estree').Node} node A typescript-eslint `TSImportEqualsDeclaration` (not an estree type). */
    TSImportEqualsDeclaration(node) {
      const declaration = /** @type {{ moduleReference: { type: string; expression?: import('estree').Node }; importKind?: string }} */ (
        /** @type {unknown} */ (node)
      );
      const reference = declaration.moduleReference;
      const source = reference.type === 'TSExternalModuleReference' ? staticSpecifier(reference.expression) : undefined;
      if (source !== undefined && reference.expression !== undefined) {
        onReference({ node: reference.expression, source, names: ['*'], typeOnly: declaration.importKind === 'type' });
      }
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
