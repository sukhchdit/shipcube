/**
 * `platform/db-raw-sql` (ADR-0005 am. 10 items 1 and 4, F-04; TASK-016): in the database platform
 * (apps/*\/src/platform/db) and in repositories, raw SQL is parameterised only. Reported:
 *  - member access to `$executeRawUnsafe` / `$queryRawUnsafe` (string interpolation is an injection surface; the
 *    `TenantDb` type omits both and its run-time Proxy throws);
 *  - `SET LOCAL` in source text (it cannot take a bind parameter, 42601; settings go through the transaction-local
 *    setter in withTenantTx).
 * Scoped by eslint.config.mjs; tests are excluded there (they assert that the Proxy refuses the unsafe members).
 */
import { stringTextVisitor } from './string-literals.mjs';

const UNSAFE_MEMBERS = new Set(['$executeRawUnsafe', '$queryRawUnsafe']);
const SET_LOCAL = /\bset\s+local\b/iu;

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid unsafe raw-SQL members and SET LOCAL text in the database platform and repositories.' },
    schema: [],
    messages: {
      unsafeMember:
        "'{{name}}' interpolates SQL: use the tagged $executeRaw/$queryRaw templates (bind parameters) (ADR-0005 am. 10 item 4).",
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
        const { property } = node;
        const name =
          property.type === 'Identifier' && !node.computed
            ? property.name
            : property.type === 'Literal' && typeof property.value === 'string'
              ? property.value
              : undefined;
        if (name !== undefined && UNSAFE_MEMBERS.has(name)) context.report({ node: property, messageId: 'unsafeMember', data: { name } });
      },
    };
  },
};
