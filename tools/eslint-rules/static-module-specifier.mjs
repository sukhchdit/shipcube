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
 * The `node:module` value fails closed (PR44-SEC-10, D-TASK020-59, PR54-SEC-03), also `loader`. Wherever the whole
 * module is in hand (a namespace or default import of `node:module` / `module`, `(await) import('node:module')`, the
 * parameter of an inline `.then` callback on it, `process.getBuiltinModule('module')`, `require('module')`, directly or
 * through the one `const` it initialises), it is bounded by the configuration's own allow-list, `NODE_MODULE_ALLOWED`
 * (module-sources.mjs, also the `allowImportNames` of no-restricted-imports): a member read or a destructuring key
 * other than `createRequire`, `builtinModules` or `isBuiltin` (`m.Module`, `m.register`, `m.registerHooks`, `m._load`,
 * `const { default: M } = m`, the whole module again), a key that is not a static string (`m[k]`,
 * `m['create' + 'Require']`, `const { [k]: v } = m`) and a rest element (`const { ...rest } = m`, it carries the
 * other members) are reported in every source. The dynamic import is stricter still: only an allowed member read, a
 * destructuring with allowed keys, the one `const` and a discarded expression are legal; every other use (passed, as
 * to `Reflect.get(m, k)`, returned, aliased into a second variable, stored, a non-inline `.then` callback) is reported.
 * A static import is bounded by no-restricted-imports with the same list; no-restricted-properties refuses
 * `process.getBuiltinModule` and the no-require-imports rule refuses `require`, so the other non-member uses of those
 * two sources are left to them.
 *
 * `process` respellings (PR44-SEC-14, PR54-SEC-03, messageId `processMember`): no-restricted-properties matches the
 * loader members of `process` (`getBuiltinModule`, `binding`, `_linkedBinding`, `dlopen`) only under a static name.
 * Matched by name (`process`, or `globalThis.process` / `global.process` under any static key, shadowing ignored: fail
 * closed), the rule reports a computed member of it whose key is not a static string (`process[name]`,
 * `process['getBuiltin' + 'Module']`), `process` passed as an argument to any `Reflect.*` or `Object.*` call
 * (`Reflect.get(process, k)`, `Object.getOwnPropertyDescriptor(process, k)`), and `process` held anywhere but a
 * destructuring with static keys: an identifier declarator or assignment (`const p = process`, `p = process`), a
 * default value (`(p = process) => p`), a rest element or a computed key in the destructuring. `const { env } = process`
 * stays legal.
 *
 * A rule of its own rather than a branch of `system-model-owner`: the finding is not about SYSTEM models, the same
 * hole defeats every import control, and its scope (all non-test application and package code, the database platform
 * included) differs from that rule's exemptions. Tests and tooling are outside it (eslint.config.mjs).
 *
 * Residuals (routed to TASK-113; lexical, per file, no type information): `process` handed to a user function
 * (`f(process)`), reached through a container (`[process][0]`, `{ ...process }`, `{ p: process }.p`, a spread argument
 * `Reflect.get(...[process, k])`), through a computed key or an alias of the global object (`globalThis[k]`,
 * `const g = globalThis; g.process[k]`), through `process.mainModule`, or returned / yielded (`() => process`); the
 * `node:module` value of `require('module')` or `process.getBuiltinModule('module')` passed, returned or aliased into
 * a second variable (refused at the source by no-require-imports / no-restricted-properties); a loader reached from an
 * allowed member (none exists in Node 24); and the `eval` class (`eval`, `new Function`, string timers), which is
 * no-eval / no-implied-eval.
 */
import {
  NODE_MODULE_ALLOWED,
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
/** PR54-SEC-03: the `node:module` members any module value may give (the no-restricted-imports allow-list). */
const MODULE_ALLOWED = new Set(NODE_MODULE_ALLOWED);
/** The global objects `process` is also reachable on (`globalThis.process`, `global.process`). */
const GLOBAL_OBJECTS = new Set(['globalThis', 'global']);
/** PR54-SEC-03: the globals whose static methods read or copy the members of an object argument. */
const REFLECTORS = new Set(['Reflect', 'Object']);

/**
 * @param {import('estree').Node} node
 * @returns {import('estree').Node} `node` with the TypeScript wrappers around its expression removed.
 */
const unwrapTs = (node) => {
  let current = node;
  while (TS_WRAPPERS.has(current.type))
    current = /** @type {{ expression: import('estree').Node }} */ (/** @type {unknown} */ (current)).expression;
  return current;
};

/**
 * @param {import('estree').MemberExpression} member
 * @returns {string | undefined} The key a member read names, when it is static (`m.x`, `m['x']`, `` m[`x`] ``).
 */
const memberKey = (member) => {
  if (member.computed) return staticSpecifier(member.property);
  return member.property.type === 'Identifier' ? member.property.name : undefined;
};

/**
 * @param {import('estree').Property} property A destructuring property.
 * @returns {string | undefined} The key it takes, when it is static (`{ x }`, `{ 'x': v }`, `` { [`x`]: v } ``).
 */
const patternKey = (property) => {
  if (!property.computed && property.key.type === 'Identifier') return property.key.name;
  return staticSpecifier(property.key);
};

/**
 * @param {import('estree').Node} node
 * @returns {string | undefined} The global `node` names: an identifier, or a static member of `globalThis` / `global`.
 */
const globalName = (node) => {
  const value = unwrapTs(node);
  if (value.type === 'Identifier') return value.name;
  if (value.type !== 'MemberExpression' || value.object.type !== 'Identifier' || !GLOBAL_OBJECTS.has(value.object.name)) return undefined;
  return memberKey(value);
};

/**
 * @param {import('estree').Node | null | undefined} node
 * @returns {boolean} `node` is `process`, `globalThis.process` or `global.process` (any static key form).
 */
const isProcess = (node) => node !== null && node !== undefined && globalName(node) === 'process';

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
        "'{{call}}' uses createRequire other than as createRequire(<url>).resolve('<literal>'), or node:module beyond createRequire, builtinModules and isBuiltin: a require function, Module._load and register load modules that the import controls (boundaries, prisma-client-construction, audit-writer-allowlist) do not all see; use a static import or a literal import() (PR44-SEC-01, PR44-SEC-10, PR54-SEC-03).",
      processMember:
        "'{{call}}' reaches the members of process other than by a static name or a destructuring with static keys: process.getBuiltinModule / binding / dlopen load modules that the import controls do not see, and no-restricted-properties matches only static names (PR44-SEC-14, PR54-SEC-03).",
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
     * PR54-SEC-03: every key outside the allow-list, every key that is not a static string and a rest element (it
     * carries the other members) is reported. `createRequire` is allowed here; the `ObjectPattern > Property` visitor
     * confines it.
     * @param {import('estree').ObjectPattern} pattern Destructured from the `node:module` value.
     */
    const checkPattern = (pattern) => {
      for (const property of pattern.properties) {
        const key = property.type === 'RestElement' ? undefined : patternKey(property);
        if (key === undefined || !MODULE_ALLOWED.has(key)) reportValue(property);
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
     * PR44-SEC-10 / PR54-SEC-03 (fail closed): `node` evaluates to the whole `node:module` value. A member read or a
     * destructuring key outside `NODE_MODULE_ALLOWED` (or not a static string) is always reported; one `const` holding
     * the value (when `aliasable`) is followed. When `strict` (the dynamic import, D-TASK020-59), every other use is
     * reported too: legal are only an allowed member read, a destructuring with allowed keys, the one `const`, and a
     * discarded expression.
     * @param {import('estree').Node} node
     * @param {boolean} aliasable
     * @param {boolean} strict
     */
    const checkModuleValue = (node, aliasable, strict) => {
      const value = outermost(node, VALUE_WRAPPERS);
      const { parent } = value;
      if (parent?.type === 'MemberExpression' && parent.object === value) {
        const key = memberKey(parent);
        if (key === undefined || !MODULE_ALLOWED.has(key)) reportValue(parent);
        return;
      }
      if (parent?.type === 'VariableDeclarator' && parent.init === value) {
        if (parent.id.type === 'ObjectPattern') {
          checkPattern(parent.id);
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
        if (param.type === 'ObjectPattern') checkPattern(param);
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

    /** @param {import('estree').Node} node A use of `process` that reaches its members unseen (PR54-SEC-03). */
    const reportProcess = (node) => context.report({ node, messageId: 'processMember', data: { call: excerpt(node) } });

    /**
     * PR54-SEC-03: `process` is stored into `target`. Legal only as an object pattern whose keys are all static (no rest
     * element): `const { env } = process`.
     * @param {import('estree').Node} target a declarator id, an assignment target or a parameter pattern
     * @param {import('estree').Node} node the declarator or assignment, reported when `target` holds `process` whole
     */
    const checkProcessTarget = (target, node) => {
      if (target.type !== 'ObjectPattern') {
        reportProcess(node);
        return;
      }
      for (const property of target.properties) {
        if (property.type === 'RestElement' || patternKey(property) === undefined) reportProcess(property);
      }
    };

    /** @param {import('estree').AssignmentExpression | import('estree').AssignmentPattern} node `x = process`, `(x = process) => x`. */
    const checkProcessAssignment = (node) => {
      if (isProcess(node.right)) checkProcessTarget(node.left, node);
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
        // PR54-SEC-03: `Reflect.get(process, k)`, `Object.getOwnPropertyDescriptor(process, k)`, any Reflect / Object method.
        const { callee } = node;
        if (callee.type === 'MemberExpression' && REFLECTORS.has(globalName(callee.object) ?? '')) {
          for (const argument of node.arguments) if (argument.type !== 'SpreadElement' && isProcess(argument)) reportProcess(argument);
        }
      },
      // `<x>.createRequire` / `<x>['createRequire']` / `` <x>[`createRequire`] ``; PR54-SEC-03: `process[k]`.
      MemberExpression(node) {
        if (isCreateRequire(node, sourceCode)) confine(node);
        if (node.computed && staticSpecifier(node.property) === undefined && isProcess(node.object)) reportProcess(node);
      },
      // PR54-SEC-03: `const p = process`, `const { ...rest } = process`, `const { [k]: v } = process`.
      VariableDeclarator(node) {
        if (isProcess(node.init)) checkProcessTarget(node.id, node);
      },
      AssignmentExpression: checkProcessAssignment,
      AssignmentPattern: checkProcessAssignment,
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
