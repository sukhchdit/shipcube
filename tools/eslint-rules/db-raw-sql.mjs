/**
 * `platform/db-raw-sql` (ADR-0005 am. 10 items 1 and 4, F-04; TASK-016; PR #11 m5, PR11-SEC-05): in application code
 * (apps/*\/src, services included, since they hold a `TenantDb` too) and the planned non-repository Prisma files, raw
 * SQL is parameterised only. Reported:
 *  - member access to `$executeRawUnsafe` / `$queryRawUnsafe` (string interpolation is an injection surface; the
 *    `TenantDb` type omits both and its run-time Proxy throws);
 *  - member access to `$parent` (Prisma's extension back-reference: an unguarded client of the same transaction, whose
 *    `_originalClient` is the root client; the `TenantDb` Proxy refuses it, PR11-SEC-01);
 *  - `Prisma.raw(…)` and a named import of `raw` from the Prisma client or runtime packages (a raw fragment
 *    interpolates exactly like the `*Unsafe` members);
 *  - a NON-tagged `$queryRaw(…)` / `$executeRaw(…)` call (the `Sql`-object overload splices a pre-built fragment;
 *    only the tagged template binds every value);
 *  - `SET LOCAL` in source text (it cannot take a bind parameter, 42601; settings go through the transaction-local
 *    setter in withTenantTx).
 * Scoped by eslint.config.mjs; tests are excluded there (they assert that the Proxy refuses these shapes).
 */
import { stringTextVisitor } from './string-literals.mjs';

const UNSAFE_MEMBERS = new Set(['$executeRawUnsafe', '$queryRawUnsafe']);
const TAGGED_ONLY = new Set(['$queryRaw', '$executeRaw']);
const SET_LOCAL = /\bset\s+local\b/iu;
/** Module specifiers that export Prisma's `raw` helper: the client, its runtime packages and the generated client. */
const PRISMA_SOURCES = /^(?:@prisma\/client(?:\/.*)?|@prisma\/client-runtime-utils(?:\/.*)?|.*\/generated\/prisma(?:\/.*)?)$/u;

/**
 * @param {import('estree').MemberExpression} node
 * @returns {string | undefined} the static property name (`a.b` or `a['b']`)
 */
const memberName = ({ property, computed }) =>
  property.type === 'Identifier' && !computed
    ? property.name
    : property.type === 'Literal' && typeof property.value === 'string'
      ? property.value
      : undefined;

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid unsafe raw-SQL shapes, the $parent escape and SET LOCAL text in application database code.' },
    schema: [],
    messages: {
      unsafeMember:
        "'{{name}}' interpolates SQL: use the tagged $executeRaw/$queryRaw templates (bind parameters) (ADR-0005 am. 10 item 4).",
      parent:
        "'$parent' reaches an unguarded client of the transaction (and through it the root client): use the TenantDb you were given (ADR-0005 am. 10 item 1, PR11-SEC-01).",
      prismaRaw:
        'Prisma.raw interpolates SQL exactly like the *Unsafe members: use the tagged $executeRaw/$queryRaw templates (bind parameters) (ADR-0005 am. 10 item 4, PR11-SEC-05).',
      nonTagged:
        "'{{name}}(…)' called without a tagged template splices a pre-built SQL fragment: write {{name}}`…` so every value is a bind parameter (ADR-0005 am. 10 item 4).",
      setLocal:
        'SET LOCAL cannot take a bind parameter (42601): settings are applied by withTenantTx with the transaction-local setter (ADR-0005 am. 10 item 4).',
    },
  },
  create(context) {
    const strings = stringTextVisitor((node, text) => {
      if (SET_LOCAL.test(text)) context.report({ node, messageId: 'setLocal' });
    });
    return {
      ...strings,
      MemberExpression(node) {
        const name = memberName(node);
        if (name === undefined) return;
        if (UNSAFE_MEMBERS.has(name)) context.report({ node: node.property, messageId: 'unsafeMember', data: { name } });
        if (name === '$parent') context.report({ node: node.property, messageId: 'parent' });
      },
      CallExpression(node) {
        const { callee } = node;
        if (callee.type !== 'MemberExpression') return;
        const name = memberName(callee);
        if (name !== undefined && TAGGED_ONLY.has(name)) context.report({ node: callee.property, messageId: 'nonTagged', data: { name } });
        if (name === 'raw' && callee.object.type === 'Identifier' && callee.object.name === 'Prisma') {
          context.report({ node: callee.property, messageId: 'prismaRaw' });
        }
      },
      ImportDeclaration(node) {
        if (typeof node.source.value !== 'string' || !PRISMA_SOURCES.test(node.source.value)) return;
        for (const specifier of node.specifiers) {
          const imported = specifier.type === 'ImportSpecifier' ? specifier.imported : undefined;
          const name = imported?.type === 'Identifier' ? imported.name : imported?.value;
          if (name === 'raw') context.report({ node: specifier, messageId: 'prismaRaw' });
        }
      },
    };
  },
};
