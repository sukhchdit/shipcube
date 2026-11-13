/**
 * `platform/no-raw-request-in-log` (PR20-SEC-13 item 4, PR #20 L-13; no secrets or PII in logs): a raw HTTP request,
 * response or header set is never stringified into a log call. Pino's `req` / `res` serializers and its redaction
 * paths only apply to objects passed as fields; a string built from them carries the Authorization and Cookie headers,
 * query strings and bodies verbatim.
 *
 * A logger call is `<x>.info|warn|error|debug|fatal|trace(...)` where `<x>` is an identifier or a member whose name ends
 * in `log`, `logger`, `Log` or `Logger` (`log`, `logger`, `req.log`, `this.logger`, `deps.log`). Inside its arguments,
 * reported: `JSON.stringify(X)`, `util.inspect(X)` / `inspect(X)`, `String(X)` and a template literal with `X` as an
 * expression, where X is an identifier or a member whose last segment is `req`, `res`, `request`, `response`,
 * `rawHeaders`, `rawTrailers` or `headers` (`req.headers`, `ctx.request`). Passing `req` itself as a field
 * (`log.info({ req }, 'msg')`) is fine: the serializers handle it. Values stringified before the call are not followed.
 */

const LOG_METHODS = new Set(['info', 'warn', 'error', 'debug', 'fatal', 'trace']);
const LOGGER_NAME = /(?:log|logger|Log|Logger)$/u;
const RAW_NAMES = new Set(['req', 'res', 'request', 'response', 'rawHeaders', 'rawTrailers', 'headers']);

/**
 * @typedef {import('estree').Node & { parent?: Node }} Node
 */

/**
 * @param {Node} node
 * @returns {string | undefined}
 */
function propertyName(node) {
  if (node.type !== 'MemberExpression') return undefined;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string') return node.property.value;
  return undefined;
}

/**
 * @param {Node | undefined} node
 * @returns {boolean}
 */
function isRaw(node) {
  if (node === undefined) return false;
  if (node.type === 'Identifier') return RAW_NAMES.has(node.name);
  const name = propertyName(node);
  return name !== undefined && RAW_NAMES.has(name);
}

/**
 * @param {Node} node
 * @returns {boolean}
 */
function isLoggerCall(node) {
  if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return false;
  const method = propertyName(node.callee);
  if (method === undefined || !LOG_METHODS.has(method)) return false;
  const receiver = node.callee.object;
  const name = receiver.type === 'Identifier' ? receiver.name : propertyName(receiver);
  return name !== undefined && LOGGER_NAME.test(name);
}

/**
 * @param {Node} callee
 * @returns {string | undefined} The stringifying function, when `callee` is one.
 */
function stringifier(callee) {
  if (callee.type === 'Identifier' && (callee.name === 'String' || callee.name === 'inspect')) return callee.name;
  if (callee.type !== 'MemberExpression' || callee.object.type !== 'Identifier') return undefined;
  const name = propertyName(callee);
  if (callee.object.name === 'JSON' && name === 'stringify') return 'JSON.stringify';
  if (callee.object.name === 'util' && name === 'inspect') return 'util.inspect';
  return undefined;
}

/**
 * @param {Node} node
 * @returns {boolean} True when `node` sits inside the arguments of a logger call.
 */
function inLoggerArguments(node) {
  /** @type {Node} */
  let child = node;
  let parent = child.parent;
  // The Program node's parent is null.
  while (parent) {
    if (parent.type === 'CallExpression' && parent.callee !== child && isLoggerCall(parent)) return true;
    child = parent;
    parent = child.parent;
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow stringifying a raw request, response or header set inside a logger call.' },
    schema: [],
    messages: {
      raw: "'{{text}}' stringifies a raw request, response or header set into a log line, bypassing the Pino serializers and redaction; log the object as a field ({ req }) or pick the safe values explicitly (PR20-SEC-13).",
    },
  },
  create(context) {
    const { sourceCode } = context;

    /**
     * @param {Node} node
     */
    function report(node) {
      context.report({ node, messageId: 'raw', data: { text: sourceCode.getText(node) } });
    }

    return {
      CallExpression(node) {
        const name = stringifier(/** @type {Node} */ (node.callee));
        if (name === undefined || !isRaw(/** @type {Node | undefined} */ (node.arguments[0]))) return;
        if (inLoggerArguments(/** @type {Node} */ (node))) report(/** @type {Node} */ (node));
      },
      TemplateLiteral(node) {
        if (!node.expressions.some((expression) => isRaw(/** @type {Node} */ (expression)))) return;
        if (inLoggerArguments(/** @type {Node} */ (node))) report(/** @type {Node} */ (node));
      },
    };
  },
};
