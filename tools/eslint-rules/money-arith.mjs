/**
 * `platform/money-arith` (NFR-DATA-001, ADR-0009 §3): no number arithmetic on money minor-unit values outside the
 * Money helpers of `@platform/shared` (`add`, `sub`, `mulRatio`, `allocate`, `convert`). The eslint.config.mjs turns
 * the rule off for `packages/shared/src/money/**`.
 *
 * The rule is name-based: it recognises `amount`, `minor`, `<x>Amount`, `<x>Minor` and the snake-case column names
 * `<x>_amount`, `<x>_minor`, as identifiers or as member names. Comparisons are allowed; so is `+` on strings.
 */

const DEFAULT_NAME_PATTERN = '^(?:amount|minor|\\w+Amount|\\w+Minor|\\w+_amount|\\w+_minor)$';
const ARITHMETIC = new Set(['+', '-', '*', '/', '%', '**']);
const ARITHMETIC_ASSIGN = new Set(['+=', '-=', '*=', '/=', '%=', '**=']);

/**
 * Strips TypeScript wrappers that do not change the runtime value.
 * @param {import('estree').Node} node
 * @returns {import('estree').Node}
 */
function unwrap(node) {
  let current = /** @type {{ type: string; expression?: import('estree').Node }} */ (node);
  while (
    (current.type === 'TSNonNullExpression' || current.type === 'TSAsExpression' || current.type === 'TSSatisfiesExpression') &&
    current.expression
  ) {
    current = /** @type {typeof current} */ (current.expression);
  }
  return /** @type {import('estree').Node} */ (/** @type {unknown} */ (current));
}

/**
 * @param {import('estree').Node} node
 * @returns {boolean}
 */
function isStringish(node) {
  const inner = unwrap(node);
  return (inner.type === 'Literal' && typeof inner.value === 'string') || inner.type === 'TemplateLiteral';
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow number arithmetic on money minor-unit values outside the Money helpers (NFR-DATA-001).',
    },
    schema: [
      {
        type: 'object',
        properties: { namePattern: { type: 'string' } },
        additionalProperties: false,
      },
    ],
    messages: {
      moneyArithmetic:
        "Arithmetic on the money minor-unit value '{{name}}' is forbidden; use the Money helpers of @platform/shared (add, sub, mulRatio, allocate, convert).",
    },
  },
  create(context) {
    const options = /** @type {{ namePattern?: string } | undefined} */ (context.options[0]);
    const namePattern = new RegExp(options?.namePattern ?? DEFAULT_NAME_PATTERN, 'u');

    /**
     * @param {import('estree').Node} node
     * @returns {string | null} The matching name, or null when the node is not a money value.
     */
    function moneyName(node) {
      const inner = unwrap(node);
      /** @type {string | null} */
      let name = null;
      if (inner.type === 'Identifier') name = inner.name;
      else if (inner.type === 'MemberExpression') {
        const { property, computed } = inner;
        if (!computed && property.type === 'Identifier') name = property.name;
        else if (computed && property.type === 'Literal' && typeof property.value === 'string') name = property.value;
      }
      return name !== null && namePattern.test(name) ? name : null;
    }

    return {
      BinaryExpression(node) {
        if (!ARITHMETIC.has(node.operator)) return;
        if (node.operator === '+' && (isStringish(node.left) || isStringish(node.right))) return;
        const name = moneyName(node.left) ?? moneyName(node.right);
        if (name !== null) context.report({ node, messageId: 'moneyArithmetic', data: { name } });
      },
      AssignmentExpression(node) {
        if (!ARITHMETIC_ASSIGN.has(node.operator)) return;
        const name = moneyName(node.left);
        if (name !== null) context.report({ node, messageId: 'moneyArithmetic', data: { name } });
      },
      UpdateExpression(node) {
        const name = moneyName(node.argument);
        if (name !== null) context.report({ node, messageId: 'moneyArithmetic', data: { name } });
      },
    };
  },
};
