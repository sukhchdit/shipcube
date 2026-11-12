/**
 * Shared visitor for the local ESLint rules that inspect SQL text in source: string literals and template literals
 * (tagged ones included, e.g. tx.$executeRaw`…`). A template is checked as one text, each `${…}` replaced by `$1`.
 */

/**
 * @param {(node: import('estree').Node, text: string) => void} onText
 * @returns {import('eslint').Rule.RuleListener}
 */
export function stringTextVisitor(onText) {
  return {
    Literal(node) {
      if (typeof node.value === 'string') onText(node, node.value);
    },
    TemplateLiteral(node) {
      onText(node, node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join('$1'));
    },
  };
}
