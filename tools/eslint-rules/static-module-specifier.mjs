/**
 * `platform/static-module-specifier` (PR32-SEC-07 (a); PR #32 security review §4): every module load in application
 * code names its module with a string literal or a no-substitution template literal. A computed specifier
 * (`import(where)`, `require(name)`, `createRequire(import.meta.url)(x)`, `module.require(x)`) hides the target from
 * every import-based control at once: eslint-plugin-boundaries (layering, the bcrypt and logging confinements),
 * `no-restricted-imports` (bcrypt, Supertest, the S3 SDK) and `platform/system-model-owner` (the SYSTEM accessor).
 *
 * A rule of its own rather than a branch of `system-model-owner`: the finding is not about SYSTEM models, the same
 * hole defeats every import control, and its scope (all non-test application and package code, the database platform
 * included) differs from that rule's exemptions. Tests and tooling are outside it (eslint.config.mjs).
 */
import { isRequireCall, staticSpecifier } from './module-sources.mjs';

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Require a literal module specifier in import(), require(), module.require() and createRequire(...)().' },
    schema: [],
    messages: {
      computed:
        "'{{call}}' loads a module through a computed specifier: name the module with a string literal so the import controls (boundaries, no-restricted-imports, system-model-owner) can see it (PR32-SEC-07).",
    },
  },
  create(context) {
    const { sourceCode } = context;

    /**
     * @param {import('estree').Node} node
     * @param {import('estree').Node | undefined} specifier
     */
    const check = (node, specifier) => {
      if (specifier === undefined || specifier.type === 'SpreadElement' || staticSpecifier(specifier) === undefined) {
        const text = sourceCode.getText(node);
        context.report({ node, messageId: 'computed', data: { call: text.length > 60 ? `${text.slice(0, 57)}...` : text } });
      }
    };

    return {
      ImportExpression(node) {
        check(node, node.source);
      },
      CallExpression(node) {
        if (isRequireCall(node, sourceCode)) check(node, node.arguments[0]);
      },
    };
  },
};
