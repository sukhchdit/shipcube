/**
 * `platform/no-tofixed-tolocalestring` (NFR-I18N-004, NFR-DATA-001, ADR-0009 §3): numbers, dates, currencies and
 * units are formatted only through the shared Intl-based helpers. Direct `toFixed`, `toLocale*String`, `parseFloat`
 * and `Intl.NumberFormat` / `Intl.DateTimeFormat` are forbidden; eslint.config.mjs turns the rule off for the
 * helper folders (`packages/shared/src/{intl,format}/**`).
 */

const FORBIDDEN_METHODS = new Set(['toFixed', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']);
const FORBIDDEN_INTL = new Set(['NumberFormat', 'DateTimeFormat']);

/**
 * @param {import('estree').Node} node
 * @returns {string | null} Static property name of a member expression.
 */
function memberName(node) {
  if (node.type !== 'MemberExpression') return null;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string') return node.property.value;
  return null;
}

/**
 * @param {import('estree').Node} callee
 * @returns {string | null} The forbidden `Intl.<name>` constructor named by the callee, called with or without `new`.
 */
function forbiddenIntl(callee) {
  const name = memberName(callee);
  return name !== null &&
    FORBIDDEN_INTL.has(name) &&
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'Intl'
    ? name
    : null;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow toFixed, toLocaleString, parseFloat and direct Intl formatting outside the shared format helpers.',
    },
    schema: [],
    messages: {
      forbiddenMethod:
        "'{{name}}' is forbidden; format numbers, dates, currencies and units with the helpers of @platform/shared (intl/format).",
      forbiddenParseFloat: "'parseFloat' is forbidden; parse numbers with the helpers of @platform/shared (no floating point on money).",
      forbiddenIntl: "'Intl.{{name}}' is forbidden; use the Intl-based helpers of @platform/shared (intl/format).",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        const method = memberName(callee);
        if (method !== null && FORBIDDEN_METHODS.has(method)) {
          context.report({ node: callee, messageId: 'forbiddenMethod', data: { name: method } });
        } else if (callee.type === 'Identifier' && callee.name === 'parseFloat') {
          context.report({ node: callee, messageId: 'forbiddenParseFloat' });
        } else if (
          method === 'parseFloat' &&
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Number'
        ) {
          context.report({ node: callee, messageId: 'forbiddenParseFloat' });
        } else {
          // `Intl.NumberFormat('en')` without `new` is valid JavaScript and returns a formatter too (n6).
          const name = forbiddenIntl(callee);
          if (name !== null) context.report({ node, messageId: 'forbiddenIntl', data: { name } });
        }
      },
      NewExpression(node) {
        const name = forbiddenIntl(node.callee);
        if (name !== null) context.report({ node, messageId: 'forbiddenIntl', data: { name } });
      },
    };
  },
};
