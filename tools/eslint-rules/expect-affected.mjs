/**
 * `platform/expect-affected` (ADR-0005 am. 10 item 15, PR7-SEC-13; TASK-016): an UPDATE or DELETE issued without
 * tenant context touches 0 rows and raises nothing, so a lost state transition would commit silently. In
 * repositories, the result of `updateMany(…)` / `deleteMany(…)` must reach `expectAffected(result, n)`
 * (apps/api/src/platform/db/expect-affected.ts), either directly (`expectAffected(await x.updateMany(…), 1)`) or
 * through a `const` that is later passed to it. Anything else (discarded, returned, destructured) is reported.
 */

const BULK_WRITES = new Set(['updateMany', 'deleteMany']);
const WRAPPERS = new Set(['AwaitExpression', 'ChainExpression', 'TSAsExpression', 'TSNonNullExpression', 'TSSatisfiesExpression']);

/**
 * @param {import('estree').Node} callee
 * @returns {boolean}
 */
const isExpectAffected = (callee) =>
  (callee.type === 'Identifier' && callee.name === 'expectAffected') ||
  (callee.type === 'MemberExpression' && callee.property.type === 'Identifier' && callee.property.name === 'expectAffected');

/**
 * @param {import('estree').Node & { parent?: import('estree').Node }} node
 * @returns {boolean}
 */
const passedToHelper = (node) => {
  const { parent } = node;
  return parent?.type === 'CallExpression' && isExpectAffected(parent.callee) && parent.arguments.includes(/** @type {never} */ (node));
};

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Pass updateMany/deleteMany results to expectAffected (ADR-0005 am. 10 item 15).' },
    schema: [],
    messages: {
      unchecked:
        '{{method}}(…) result is not passed to expectAffected(result, n): without tenant context it touches 0 rows silently (ADR-0005 am. 10 item 15, PR7-SEC-13).',
    },
  },
  create(context) {
    return {
      CallExpression(call) {
        const { callee } = call;
        if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier' || !BULK_WRITES.has(callee.property.name)) return;
        /** @type {import('estree').Node & { parent?: import('estree').Node }} */
        let node = call;
        while (node.parent !== undefined && WRAPPERS.has(node.parent.type)) node = node.parent;
        if (passedToHelper(node)) return;
        const { parent } = node;
        if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
          const [variable] = context.sourceCode.getDeclaredVariables(parent);
          // A reference is always an Identifier in .ts sources (JSXIdentifier only in JSX, where no call can be an argument).
          if (variable?.references.some((reference) => passedToHelper(/** @type {never} */ (reference.identifier)))) return;
        }
        context.report({ node: call, messageId: 'unchecked', data: { method: callee.property.name } });
      },
    };
  },
};
