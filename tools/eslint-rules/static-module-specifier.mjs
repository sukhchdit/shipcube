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
 * namespace or default member, `(await import('node:module')).createRequire`,
 * `process.getBuiltinModule('module').createRequire`): called and the result called, stored, aliased, destructured,
 * passed, returned or re-exported. A require function built from it loads modules that `boundaries` sees only in the
 * inline form, so every module load stays an `import` / `import()`, which every import control sees.
 * A messageId of this rule rather than a rule of its own: same hole (a load the import controls cannot see), same
 * scope, and `isRequireCall` / `isCreateRequire` already live beside it.
 *
 * A rule of its own rather than a branch of `system-model-owner`: the finding is not about SYSTEM models, the same
 * hole defeats every import control, and its scope (all non-test application and package code, the database platform
 * included) differs from that rule's exemptions. Tests and tooling are outside it (eslint.config.mjs).
 *
 * Residuals: a loader the syntax does not name (`Module._load`, `process.mainModule`, a computed member
 * `m['create' + 'Require']`, `Reflect.get(m, name)`); `eval` / `new Function` are no-eval / no-implied-eval.
 */
import { isCreateRequire, isNodeModule, isRequireCall, staticSpecifier } from './module-sources.mjs';

const CREATE_REQUIRE = 'createRequire';

/**
 * @param {import('estree').Node} key
 * @param {boolean} computed
 * @returns {boolean} Whether a property key names `createRequire`.
 */
const isCreateRequireKey = (key, computed) =>
  (!computed && key.type === 'Identifier' && key.name === CREATE_REQUIRE) || (key.type === 'Literal' && key.value === CREATE_REQUIRE);

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
      },
      CallExpression(node) {
        if (isRequireCall(node, sourceCode)) check(node, node.arguments[0]);
      },
      // `<x>.createRequire` / `<x>['createRequire']`.
      MemberExpression(node) {
        if (isCreateRequire(node, sourceCode)) confine(node);
      },
      // `const { createRequire: mk } = <x>`: the function itself is taken out.
      'ObjectPattern > Property'(/** @type {import('estree').Property} */ node) {
        if (isCreateRequireKey(node.key, node.computed)) context.report({ node, messageId: 'loader', data: { call: excerpt(node) } });
      },
      ExportAllDeclaration: reexport,
      ExportNamedDeclaration: reexport,
      // Every read of a `createRequire` binding (the name or an import alias): called, stored, passed, returned, exported.
      'Program:exit'() {
        for (const scope of sourceCode.scopeManager.scopes) {
          for (const reference of scope.references) {
            const { identifier } = reference;
            const parentType = /** @type {{ parent?: { type: string } }} */ (identifier).parent?.type;
            if (identifier.type !== 'Identifier' || !reference.isRead() || parentType === 'TSTypeQuery') continue;
            if (isCreateRequire(identifier, sourceCode)) confine(identifier);
          }
        }
      },
    };
  },
};
