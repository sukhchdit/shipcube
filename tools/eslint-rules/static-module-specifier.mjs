/**
 * `platform/static-module-specifier` (PR32-SEC-07 (a); PR #32 security review §4): every module load in application
 * code names its module with a string literal or a no-substitution template literal. A computed specifier
 * (`import(where)`, `require(name)`, `createRequire(import.meta.url)(x)`, `module.require(x)`) hides the target from
 * every import-based control at once: eslint-plugin-boundaries (layering, the bcrypt and logging confinements),
 * `no-restricted-imports` (bcrypt, Supertest, the S3 SDK) and `platform/system-model-owner` (the SYSTEM accessor).
 *
 * `createRequire` confinement (PR44-SEC-01, messageId `loader`): `createRequire` is legal only as
 * `createRequire(<url>).resolve(<literal>)` (a path lookup, nothing is loaded; apps/api/src/platform/openapi/serve.ts).
 * Every other use is reported, in any form `isCreateRequire` knows (the name, an import alias from `node:module`, a
 * namespace or default member under a static key, `` m[`createRequire`] `` included (PR44-SEC-10),
 * `(await import('node:module')).createRequire`, `process.getBuiltinModule('module').createRequire`): called and the
 * result called, stored, aliased, destructured, passed, returned or re-exported. A require function built from it loads
 * modules that `boundaries` sees only in the inline form, so every module load stays an `import` / `import()`, which
 * every import control sees.
 * A messageId of this rule rather than a rule of its own: same hole (a load the import controls cannot see), same
 * scope, and `isRequireCall` / `isCreateRequire` already live beside it.
 *
 * The `node:module` value fails closed (PR44-SEC-10, D-TASK020-59), also `loader`. Wherever the whole module is in
 * hand (a namespace or default import of `node:module` / `module`, `(await) import('node:module')`,
 * `process.getBuiltinModule('module')`, `require('module')`, directly or through the one `const` it initialises), a
 * computed key that is not a static string (`m[k]`, `m['create' + 'Require']`, `const { [k]: v } = m`) is reported,
 * since the member it reaches is unknown. The dynamic import (also the parameter of an inline `.then` callback) is
 * stricter: only a member read under a static key (`m.x`, `m['x']`, `` m[`x`] ``), a destructuring with static keys,
 * the one `const` and a discarded expression are legal; every other use (passed, as to `Reflect.get(m, k)`, returned,
 * aliased into a second variable, stored, a rest element, a non-inline `.then` callback) is reported. The other three
 * sources are refused outright by configuration (no-restricted-imports allows only `createRequire`, `builtinModules`
 * and `isBuiltin` from `node:module`; no-restricted-properties refuses `process.getBuiltinModule`; the
 * no-require-imports rule refuses `require`), so the rule keeps to computed keys there.
 *
 * A rule of its own rather than a branch of `system-model-owner`: the finding is not about SYSTEM models, the same
 * hole defeats every import control, and its scope (all non-test application and package code, the database platform
 * included) differs from that rule's exemptions. Tests and tooling are outside it (eslint.config.mjs).
 *
 * Residuals: a loader the syntax does not name (`Module._load`, `process.mainModule`; `Module`, `register` and the
 * namespace import itself are refused by no-restricted-imports, `process.getBuiltinModule` by no-restricted-properties);
 * `eval` / `new Function` are no-eval / no-implied-eval.
 */
import {
  isCreateRequire,
  isCreateRequireKey,
  isNodeModule,
  isNodeModuleNamespace,
  isRequireCall,
  staticSpecifier,
} from './module-sources.mjs';

/** TypeScript wrappers that keep the value of their expression. */
const TS_WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion']);
/** The same, plus `await` (awaiting a module value yields the module value). */
const VALUE_WRAPPERS = new Set([...TS_WRAPPERS, 'AwaitExpression']);

/**
 * @param {import('estree').Node} callee
 * @returns {string | undefined} The name a callee calls (`f`, `x.f`, `x['f']`), when it is static.
 */
const calleeName = (callee) => {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type !== 'MemberExpression') return undefined;
  if (callee.computed) return staticSpecifier(callee.property);
  return callee.property.type === 'Identifier' ? callee.property.name : undefined;
};

/**
 * @param {import('estree').CallExpression} call
 * @returns {boolean} `process.getBuiltinModule('module' | 'node:module')` (any receiver, or a bare destructured name).
 */
const isBuiltinNodeModule = (call) => calleeName(call.callee) === 'getBuiltinModule' && isNodeModule(staticSpecifier(call.arguments[0]));

/**
 * The one legal shape: `node` (a `createRequire` reference) is called and only `.resolve(<literal>)` is called on the result.
 * @param {import('estree').Node & { parent?: import('estree').Node }} node
 * @returns {boolean}
 */
const isResolveOnly = (node) => {
  const call = /** @type {import('estree').Node & { parent?: import('estree').Node }} */ (node.parent);
  if (call?.type !== 'CallExpression' || call.callee !== node) return false;
  const member = /** @type {import('estree').Node & { parent?: import('estree').Node }} */ (call.parent);
  if (member?.type !== 'MemberExpression' || member.object !== call || member.computed) return false;
  if (member.property.type !== 'Identifier' || member.property.name !== 'resolve') return false;
  const resolve = member.parent;
  return (
    resolve?.type === 'CallExpression' &&
    resolve.callee === member &&
    resolve.arguments.length === 1 &&
    staticSpecifier(resolve.arguments[0]) !== undefined
  );
};

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Require a literal module specifier in import(), require(), module.require() and createRequire(...)().' },
    schema: [],
    messages: {
      computed:
        "'{{call}}' loads a module through a computed specifier: name the module with a string literal so the import controls (boundaries, no-restricted-imports, system-model-owner) can see it (PR32-SEC-07).",
      loader:
        "'{{call}}' uses createRequire other than as createRequire(<url>).resolve('<literal>'): a require function loads modules that the import controls (boundaries, prisma-client-construction, audit-writer-allowlist) do not all see; use a static import or a literal import() (PR44-SEC-01).",
    },
  },
  create(context) {
    const { sourceCode } = context;

    /** @param {import('estree').Node} node */
    const excerpt = (node) => {
      const text = sourceCode.getText(node);
      return text.length > 60 ? `${text.slice(0, 57)}...` : text;
    };

    /**
     * @param {import('estree').Node} node
     * @param {import('estree').Node | undefined} specifier
     */
    const check = (node, specifier) => {
      if (specifier === undefined || specifier.type === 'SpreadElement' || staticSpecifier(specifier) === undefined) {
        context.report({ node, messageId: 'computed', data: { call: excerpt(node) } });
      }
    };

    /** @param {import('estree').Node & { parent?: import('estree').Node }} node A `createRequire` reference. */
    const confine = (node) => {
      if (!isResolveOnly(node)) context.report({ node, messageId: 'loader', data: { call: excerpt(node.parent ?? node) } });
    };

    /** @param {import('estree').Node} node A use of the `node:module` value the rule cannot bound (PR44-SEC-10). */
    const reportValue = (node) => context.report({ node, messageId: 'loader', data: { call: excerpt(node) } });

    /**
     * @param {import('estree').Node} node
     * @param {ReadonlySet<string>} wrappers
     * @returns {import('estree').Node & { parent?: import('estree').Node | null }} `node` with the `wrappers` around it walked up.
     */
    const outermost = (node, wrappers) => {
      let current = /** @type {import('estree').Node & { parent?: import('estree').Node | null }} */ (node);
      while (current.parent !== undefined && current.parent !== null && wrappers.has(current.parent.type)) current = current.parent;
      return current;
    };

    /**
     * @param {import('estree').ObjectPattern} pattern Destructured from the `node:module` value.
     * @param {boolean} strict whether a rest element (the module's members, keys unknown) is reported too
     */
    const checkPattern = (pattern, strict) => {
      for (const property of pattern.properties) {
        const unbounded = property.type === 'RestElement' ? strict : property.computed && staticSpecifier(property.key) === undefined;
        if (unbounded) reportValue(property);
      }
    };

    /**
     * @param {import('eslint').Scope.Variable} variable A binding of the `node:module` value: each read is checked, no further alias.
     * @param {boolean} strict
     */
    const checkReads = (variable, strict) => {
      for (const reference of variable.references) {
        const identifier = /** @type {import('estree').Identifier} */ (reference.identifier);
        const parentType = /** @type {{ parent?: { type: string } }} */ (identifier).parent?.type;
        if (reference.isRead() && parentType !== 'TSTypeQuery') checkModuleValue(identifier, false, strict);
      }
    };

    /**
     * PR44-SEC-10 (fail closed): `node` evaluates to the whole `node:module` value. A computed key that is not a static
     * string (member or destructuring) is always reported; one `const` holding the value (when `aliasable`) is followed.
     * When `strict` (the dynamic import, D-TASK020-59), every other use is reported too: legal are only a member read
     * under a static key, a destructuring with static keys, the one `const`, and a discarded expression.
     * @param {import('estree').Node} node
     * @param {boolean} aliasable
     * @param {boolean} strict
     */
    const checkModuleValue = (node, aliasable, strict) => {
      const value = outermost(node, VALUE_WRAPPERS);
      const { parent } = value;
      if (parent?.type === 'MemberExpression' && parent.object === value) {
        if (parent.computed && staticSpecifier(parent.property) === undefined) reportValue(parent);
        return;
      }
      if (parent?.type === 'VariableDeclarator' && parent.init === value) {
        if (parent.id.type === 'ObjectPattern') {
          checkPattern(parent.id, strict);
          return;
        }
        const declaration = /** @type {import('estree').Node & { parent?: import('estree').Node }} */ (parent).parent;
        if (aliasable && parent.id.type === 'Identifier' && declaration?.type === 'VariableDeclaration' && declaration.kind === 'const') {
          for (const variable of sourceCode.getDeclaredVariables(parent)) checkReads(variable, strict);
          return;
        }
      }
      if (!strict || parent?.type === 'ExpressionStatement' || (parent?.type === 'UnaryExpression' && parent.operator === 'void')) return;
      reportValue(parent ?? value);
    };

    /**
     * PR44-SEC-10 / D-TASK020-59: `import('node:module')` is legal awaited (then checked as the module value), with an
     * inline `.then` callback (its parameter checked as the module value) or discarded; any other use is reported.
     * @param {import('estree').ImportExpression} node
     */
    const checkModulePromise = (node) => {
      const promise = outermost(node, TS_WRAPPERS);
      const { parent } = promise;
      if (parent?.type === 'AwaitExpression') {
        checkModuleValue(parent, true, true);
        return;
      }
      const call = /** @type {import('estree').Node & { parent?: import('estree').Node }} */ (parent ?? promise).parent;
      if (parent?.type === 'MemberExpression' && parent.object === promise && call?.type === 'CallExpression' && call.callee === parent) {
        if (calleeName(parent) !== 'then') {
          reportValue(call);
          return;
        }
        const [callback] = call.arguments;
        if (callback?.type !== 'ArrowFunctionExpression' && callback?.type !== 'FunctionExpression') {
          reportValue(call);
          return;
        }
        const [param] = callback.params;
        if (param === undefined) return;
        if (param.type === 'ObjectPattern') checkPattern(param, true);
        else if (param.type !== 'Identifier') reportValue(param);
        else for (const variable of sourceCode.getDeclaredVariables(callback)) if (variable.name === param.name) checkReads(variable, true);
        return;
      }
      if (parent?.type === 'ExpressionStatement' || (parent?.type === 'UnaryExpression' && parent.operator === 'void')) return;
      reportValue(parent ?? promise);
    };

    /** @param {import('estree').ExportAllDeclaration | import('estree').ExportNamedDeclaration} node */
    const reexport = (node) => {
      if (!isNodeModule(node.source?.value)) return;
      // `export * from 'node:module'` / `export { createRequire } from 'node:module'` hands the function to other files.
      const passes =
        node.type === 'ExportAllDeclaration' || node.specifiers.some((specifier) => isCreateRequireKey(specifier.local, false));
      if (passes) context.report({ node, messageId: 'loader', data: { call: excerpt(node) } });
    };

    return {
      ImportExpression(node) {
        check(node, node.source);
        if (isNodeModule(staticSpecifier(node.source))) checkModulePromise(node);
      },
      CallExpression(node) {
        const isRequire = isRequireCall(node, sourceCode);
        if (isRequire) check(node, node.arguments[0]);
        if (isBuiltinNodeModule(node) || (isRequire && isNodeModule(staticSpecifier(node.arguments[0]))))
          checkModuleValue(node, true, false);
      },
      // `<x>.createRequire` / `<x>['createRequire']` / `` <x>[`createRequire`] ``.
      MemberExpression(node) {
        if (isCreateRequire(node, sourceCode)) confine(node);
      },
      // `const { createRequire: mk } = <x>` (any static key form): the function itself is taken out.
      'ObjectPattern > Property'(/** @type {import('estree').Property} */ node) {
        if (isCreateRequireKey(node.key, node.computed)) context.report({ node, messageId: 'loader', data: { call: excerpt(node) } });
      },
      ExportAllDeclaration: reexport,
      ExportNamedDeclaration: reexport,
      // Every read of a `createRequire` binding (the name or an import alias): called, stored, passed, returned, exported.
      // Every read of a namespace or default import of `node:module` is checked for computed keys (PR44-SEC-10).
      'Program:exit'() {
        for (const scope of sourceCode.scopeManager.scopes) {
          for (const reference of scope.references) {
            const { identifier } = reference;
            const parentType = /** @type {{ parent?: { type: string } }} */ (identifier).parent?.type;
            if (identifier.type !== 'Identifier' || !reference.isRead() || parentType === 'TSTypeQuery') continue;
            if (isCreateRequire(identifier, sourceCode)) confine(identifier);
            else if (isNodeModuleNamespace(identifier, sourceCode)) checkModuleValue(identifier, true, false);
          }
        }
      },
    };
  },
};
