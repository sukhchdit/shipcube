/**
 * `platform/outbound-http-via-client` (NFR-SEC-010, ADR-0016 §13): server-side code makes outbound HTTP calls only
 * through the SSRF-safe `OutboundHttpClient`. The rule forbids importing HTTP client libraries and calling the global
 * `fetch` or `http(s).request/get`. eslint.config.mjs scopes it to server code and turns it off for the client module
 * (`apps/api/src/platform/egress/**`). Servers may still import `node:http` to listen; only calls are flagged.
 * SDK egress exceptions (ADR-0016 am. 10) are not HTTP client libraries and are not affected.
 *
 * Other network egress (PR44-SEC-04 X04-X08, mirrored from the T-83 rule's module list): a call or `new` on a value
 * import (named, default or namespace) of `http2`, `net`, `tls`, `dgram`, `dns` (and `dns/promises`) or
 * `child_process` (with or without the `node:` prefix), a `require()` / literal `import()` of one of them but `net`,
 * and a call or `new` of the global `WebSocket` (bare or `globalThis.`/`window.`/`self.`). Exempt: the listening side
 * (`createServer`, `createSecureServer`, `Server`) and the pure `net` helpers (`isIP`, `isIPv4`, `isIPv6`,
 * `BlockList`, `SocketAddress`); type-only imports never count. Limits: a dynamic `import('node:net')` is not reported
 * (its members cannot be told apart lexically), and aliases of a source (`const f = fetch`) are not followed.
 */

const CLIENT_LIBRARIES = new Set(['axios', 'node-fetch', 'cross-fetch', 'got', 'ky', 'undici', 'superagent', 'request', 'needle']);
const HTTP_MODULES = new Set(['http', 'https', 'node:http', 'node:https']);
const HTTP_CALLS = new Set(['request', 'get']);
/** Node network and process modules (without the `node:` prefix); `dns` covers `dns/promises`. */
const NETWORK_MODULES = new Set(['http2', 'net', 'tls', 'dgram', 'dns', 'child_process']);
/** Members that open no outbound connection: the listening side, and the pure `net` helpers. */
const NON_EGRESS_MEMBERS = new Set([
  'createServer',
  'createSecureServer',
  'Server',
  'isIP',
  'isIPv4',
  'isIPv6',
  'BlockList',
  'SocketAddress',
]);
/** Modules whose import alone does not tell egress from a pure helper (dynamic imports are not reported). */
const MIXED_MODULES = new Set(['net']);
const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self']);

/**
 * @param {string} source
 * @returns {boolean}
 */
function isClientLibrary(source) {
  const [scopeOrName] = source.split('/');
  return scopeOrName !== undefined && CLIENT_LIBRARIES.has(scopeOrName);
}

/**
 * @param {string} source
 * @returns {string | undefined} The network module family of `source` (`node:dns/promises` -> `dns`).
 */
function networkModule(source) {
  const [name] = (source.startsWith('node:') ? source.slice('node:'.length) : source).split('/');
  return name !== undefined && NETWORK_MODULES.has(name) ? name : undefined;
}

/**
 * @param {import('estree').Node | undefined} node
 * @returns {string | undefined} The value of a string literal or a no-substitution template literal.
 */
function literalSource(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? undefined;
  return undefined;
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
      network:
        "'{{call}}' ({{source}}) opens a network connection or a process outside OutboundHttpClient; make outbound calls through OutboundHttpClient (apps/api/src/platform/egress) (NFR-SEC-010).",
    },
  },
  create(context) {
    const { sourceCode } = context;
    /** Local names bound to node:http / node:https (namespace or default imports). */
    const httpNamespaces = new Set();
    /** Local names bound to `request` / `get` imported from node:http(s). */
    const httpFunctions = new Set();
    /** Local names bound to a network module (namespace or default value imports) -> the module family. */
    const networkNamespaces = new Map();
    /** Local names bound to an egress member of a network module (named value imports) -> the module family. */
    const networkFunctions = new Map();

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

    /**
     * @param {import('estree').ImportDeclaration} node
     * @param {string} family
     */
    function recordNetworkImport(node, family) {
      if (/** @type {{ importKind?: string }} */ (node).importKind === 'type') return;
      for (const specifier of node.specifiers) {
        if (specifier.type !== 'ImportSpecifier') networkNamespaces.set(specifier.local.name, family);
        else if (/** @type {{ importKind?: string }} */ (specifier).importKind !== 'type') {
          const imported = specifier.imported.type === 'Identifier' ? specifier.imported.name : String(specifier.imported.value);
          if (!NON_EGRESS_MEMBERS.has(imported)) networkFunctions.set(specifier.local.name, family);
        }
      }
    }

    /**
     * PR44-SEC-04 X04-X08: a call or `new` of a network-module member or of the global `WebSocket`.
     * @param {import('estree').CallExpression | import('estree').NewExpression} node
     */
    function checkNetwork(node) {
      const { callee } = node;
      if (callee.type === 'Identifier') {
        const family = networkFunctions.get(callee.name);
        if (family !== undefined && !isGlobal(callee.name, node)) {
          context.report({ node: callee, messageId: 'network', data: { call: callee.name, source: family } });
        } else if (callee.name === 'WebSocket' && isGlobal('WebSocket', node)) {
          context.report({ node: callee, messageId: 'directCall', data: { call: 'WebSocket' } });
        }
        return;
      }
      if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') return;
      if (callee.object.type !== 'Identifier') return;
      const { name: object } = callee.object;
      const { name: property } = callee.property;
      const family = networkNamespaces.get(object);
      if (family !== undefined && !NON_EGRESS_MEMBERS.has(property) && !isGlobal(object, node)) {
        context.report({ node: callee, messageId: 'network', data: { call: `${object}.${property}`, source: family } });
      } else if (GLOBAL_OBJECTS.has(object) && property === 'WebSocket') {
        context.report({ node: callee, messageId: 'directCall', data: { call: `${object}.WebSocket` } });
      }
    }

    /**
     * @param {import('estree').Node} node the reported source node
     * @param {string | undefined} source a `require()` / `import()` specifier
     */
    function checkLoadedModule(node, source) {
      if (source === undefined) return;
      if (isClientLibrary(source)) {
        context.report({ node, messageId: 'clientLibrary', data: { source } });
        return;
      }
      const family = networkModule(source);
      if (family !== undefined && !MIXED_MODULES.has(family)) {
        context.report({ node, messageId: 'network', data: { call: sourceCode.getText(node), source: family } });
      }
    }

    return {
      ImportDeclaration(node) {
        const source = String(node.source.value);
        if (isClientLibrary(source) && /** @type {{ importKind?: string }} */ (node).importKind !== 'type') {
          context.report({ node: node.source, messageId: 'clientLibrary', data: { source } });
          return;
        }
        const family = networkModule(source);
        if (family !== undefined) {
          recordNetworkImport(node, family);
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
        if (callee.type === 'Identifier' && callee.name === 'require' && first !== undefined) {
          checkLoadedModule(first, literalSource(/** @type {import('estree').Node} */ (first)));
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
        checkNetwork(node);
      },
      NewExpression(node) {
        checkNetwork(node);
      },
      ImportExpression(node) {
        checkLoadedModule(node.source, literalSource(node.source));
      },
    };
  },
};
