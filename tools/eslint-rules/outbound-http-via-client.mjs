/**
 * `platform/outbound-http-via-client` (NFR-SEC-010, ADR-0016 §13): server-side code makes outbound HTTP calls only
 * through the SSRF-safe `OutboundHttpClient`. The rule forbids importing HTTP client libraries and calling the global
 * `fetch` or `http(s).request/get`. eslint.config.mjs scopes it to server code and turns it off for the client module
 * (`apps/api/src/platform/egress/**`). Servers may still import `node:http` to listen; only calls are flagged.
 * SDK egress exceptions (ADR-0016 am. 10) are not HTTP client libraries and are not affected.
 */

const CLIENT_LIBRARIES = new Set(['axios', 'node-fetch', 'cross-fetch', 'got', 'ky', 'undici', 'superagent', 'request', 'needle']);
const HTTP_MODULES = new Set(['http', 'https', 'node:http', 'node:https']);
const HTTP_CALLS = new Set(['request', 'get']);

/**
 * @param {string} source
 * @returns {boolean}
 */
function isClientLibrary(source) {
  const [scopeOrName] = source.split('/');
  return scopeOrName !== undefined && CLIENT_LIBRARIES.has(scopeOrName);
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow outbound HTTP outside the SSRF-safe OutboundHttpClient.' },
    schema: [],
    messages: {
      clientLibrary:
        "Importing '{{source}}' is forbidden; make outbound HTTP calls through OutboundHttpClient (apps/api/src/platform/egress).",
      directCall: "Direct '{{call}}' is forbidden; make outbound HTTP calls through OutboundHttpClient (apps/api/src/platform/egress).",
    },
  },
  create(context) {
    const { sourceCode } = context;
    /** Local names bound to node:http / node:https (namespace or default imports). */
    const httpNamespaces = new Set();
    /** Local names bound to `request` / `get` imported from node:http(s). */
    const httpFunctions = new Set();

    /**
     * @param {string} name
     * @param {import('estree').Node} node
     * @returns {boolean} True when `name` resolves to the global (not a local binding).
     */
    function isGlobal(name, node) {
      /** @type {import('eslint').Scope.Scope | null} */
      let scope = sourceCode.getScope(node);
      while (scope) {
        if (scope.set.has(name)) return false;
        scope = scope.upper;
      }
      return true;
    }

    return {
      ImportDeclaration(node) {
        const source = String(node.source.value);
        if (isClientLibrary(source) && /** @type {{ importKind?: string }} */ (node).importKind !== 'type') {
          context.report({ node: node.source, messageId: 'clientLibrary', data: { source } });
          return;
        }
        if (!HTTP_MODULES.has(source)) return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== 'ImportSpecifier') httpNamespaces.add(specifier.local.name);
          else if (specifier.imported.type === 'Identifier' && HTTP_CALLS.has(specifier.imported.name))
            httpFunctions.add(specifier.local.name);
        }
      },
      CallExpression(node) {
        const { callee } = node;
        const first = node.arguments[0];
        if (
          callee.type === 'Identifier' &&
          callee.name === 'require' &&
          first?.type === 'Literal' &&
          typeof first.value === 'string' &&
          isClientLibrary(first.value)
        ) {
          context.report({ node: first, messageId: 'clientLibrary', data: { source: first.value } });
        } else if (callee.type === 'Identifier' && callee.name === 'fetch' && isGlobal('fetch', node)) {
          context.report({ node: callee, messageId: 'directCall', data: { call: 'fetch' } });
        } else if (callee.type === 'Identifier' && httpFunctions.has(callee.name)) {
          context.report({ node: callee, messageId: 'directCall', data: { call: callee.name } });
        } else if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property.type === 'Identifier' &&
          callee.object.type === 'Identifier'
        ) {
          const { name: object } = callee.object;
          const { name: property } = callee.property;
          if (httpNamespaces.has(object) && HTTP_CALLS.has(property)) {
            context.report({ node: callee, messageId: 'directCall', data: { call: `${object}.${property}` } });
          } else if ((object === 'globalThis' || object === 'window' || object === 'self') && property === 'fetch') {
            context.report({ node: callee, messageId: 'directCall', data: { call: `${object}.fetch` } });
          }
        }
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal' && typeof node.source.value === 'string' && isClientLibrary(node.source.value)) {
          context.report({ node: node.source, messageId: 'clientLibrary', data: { source: node.source.value } });
        }
      },
    };
  },
};
