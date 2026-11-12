/**
 * `platform/no-innerhtml` (REQ-SEC-016, ADR-0026 §9): no unsafe HTML injection APIs in application code outside the
 * single reviewed sanitising component (eslint.config.mjs turns the rule off for it). Flags `innerHTML` /
 * `outerHTML` assignments, `insertAdjacentHTML`, `document.write(ln)`, the JSX attribute `dangerouslySetInnerHTML`
 * and the same key in props objects (`createElement`).
 */

const HTML_SINKS = new Set(['innerHTML', 'outerHTML']);
const UNSAFE_CALLS = new Set(['insertAdjacentHTML']);
const DOCUMENT_WRITES = new Set(['write', 'writeln']);

/**
 * @param {import('estree').Node} node
 * @returns {string | null}
 */
function memberName(node) {
  if (node.type !== 'MemberExpression') return null;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string') return node.property.value;
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow innerHTML and dangerouslySetInnerHTML outside the sanitising component (REQ-SEC-016).' },
    schema: [],
    messages: {
      unsafeHtml: "'{{name}}' is forbidden outside the sanitising component; React encodes output by default (REQ-SEC-016).",
    },
  },
  create(context) {
    /**
     * @param {import('estree').Node} node
     * @param {string} name
     */
    const report = (node, name) => context.report({ node, messageId: 'unsafeHtml', data: { name } });

    return {
      AssignmentExpression(node) {
        const name = memberName(node.left);
        if (name !== null && HTML_SINKS.has(name)) report(node.left, name);
      },
      CallExpression(node) {
        const name = memberName(node.callee);
        if (name !== null && UNSAFE_CALLS.has(name)) report(node.callee, name);
        else if (
          name !== null &&
          DOCUMENT_WRITES.has(name) &&
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'document'
        ) {
          report(node.callee, `document.${name}`);
        }
      },
      /** @param {unknown} node JSX nodes are outside the ESTree types. */
      JSXAttribute(node) {
        const attribute = /** @type {{ name: { type: string; name?: string } }} */ (/** @type {unknown} */ (node));
        if (attribute.name.type === 'JSXIdentifier' && attribute.name.name === 'dangerouslySetInnerHTML') {
          report(/** @type {import('estree').Node} */ (/** @type {unknown} */ (node)), 'dangerouslySetInnerHTML');
        }
      },
      Property(node) {
        if (node.computed) return;
        const key = node.key;
        const name = key.type === 'Identifier' ? key.name : key.type === 'Literal' ? String(key.value) : null;
        if (name === 'dangerouslySetInnerHTML') report(node.key, name);
      },
    };
  },
};
