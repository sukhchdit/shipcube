/**
 * `platform/no-external-calls-in-tenant-tx` (threat model T-83; PR2-SEC-05 addendum, PR11-SEC-05 item 5, D-ARCH-074):
 * no external I/O and no sleeps while a tenant transaction is open. A slow carrier, queue, cache, object store or mail
 * server would hold the transaction (and its pooled connection, locks and tenant context) open, and a failed commit
 * after a side effect cannot be undone; do the call before the transaction, or after commit through the outbox.
 *
 * Reported, lexically inside a function passed as an argument to `withTenantTx(...)` / `<x>.withTenantTx(...)`
 * (closures nested in it included):
 *  - a call of the global `fetch` (`fetch()`, `globalThis.fetch()`);
 *  - a call or `new` on a value import (default, named or namespace) from `undici`, `node:http`, `node:https`, `http`,
 *    `https`, `bullmq`, `ioredis`, `@aws-sdk/*`, `stripe` or `nodemailer`, including member calls on it
 *    (`http.request()`, `nodemailer.createTransport()`), and member calls on a same-file variable initialised from such
 *    an import (`const s3 = new S3Client(...)` ... `s3.send(cmd)`);
 *  - a member call on an identifier in the `names` option (`queue.add()`, `this.queue.add()`, `deps.queue.add()`);
 *  - `setTimeout`-based sleeps: a call of the global `setTimeout` (so `new Promise((r) => setTimeout(r, n))` too) and
 *    of `setTimeout` imported from `node:timers/promises`.
 *
 * Limits (review items, not lint): the rule is lexical and per file. A callback passed by reference, and a service or
 * repository method called inside the transaction that performs I/O in another file, are not followed; cross-file
 * calls stay a code-review item (a Semgrep twin may follow in .semgrep/). TASK-113 extends `names` with the
 * OutboundHttpClient member names when the client lands.
 */

/** Modules whose bindings perform network I/O (exact names, or a scope prefix ending in `/`). */
const EXTERNAL_MODULES = ['undici', 'node:http', 'node:https', 'http', 'https', 'bullmq', 'ioredis', '@aws-sdk/', 'stripe', 'nodemailer'];
const TIMER_PROMISE_MODULES = new Set(['node:timers/promises', 'timers/promises']);
const DEFAULT_NAMES = ['outboundHttp', 'httpClient', 'queue', 'queues', 'redis', 'valkey', 'storage', 'mailer'];
/** Receivers through which an injected dependency is reached: `this.<name>.x()` and `deps.<name>.x()`. */
const DEPENDENCY_HOLDERS = new Set(['deps']);
const TENANT_TX = 'withTenantTx';

/**
 * @param {string} source
 * @returns {string | undefined} The module family of `source`, or undefined when it is not an external client.
 */
function externalFamily(source) {
  return EXTERNAL_MODULES.find((family) =>
    family.endsWith('/') ? source.startsWith(family) : source === family || source.startsWith(`${family}/`),
  );
}

/**
 * @param {import('estree').Node} node
 * @returns {string | undefined}
 */
function propertyName(node) {
  if (node.type !== 'MemberExpression') return undefined;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string') return node.property.value;
  return undefined;
}

/**
 * @param {import('estree').Node} callee
 * @returns {boolean}
 */
function isTenantTxCallee(callee) {
  return (callee.type === 'Identifier' && callee.name === TENANT_TX) || propertyName(callee) === TENANT_TX;
}

/**
 * The identifier at the root of a member chain (`a.b.c` -> `a`); undefined when the chain starts with a call, a
 * `new`, `this` or anything else (those are reported where that inner expression is evaluated).
 *
 * @param {import('estree').Node} node
 * @returns {import('estree').Identifier | undefined}
 */
function rootIdentifier(node) {
  let current = node;
  while (current.type === 'MemberExpression') current = current.object;
  return current.type === 'Identifier' ? current : undefined;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow external I/O (HTTP, queues, cache, object storage, mail) and sleeps inside a withTenantTx callback.' },
    schema: [
      {
        type: 'object',
        properties: { names: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true } },
        additionalProperties: false,
      },
    ],
    messages: {
      external:
        "'{{call}}' ({{source}}) runs inside a withTenantTx callback: external I/O holds the tenant transaction and its connection open and cannot be rolled back; call it before the transaction or after commit through the outbox (T-83).",
      sleep:
        "'{{call}}' sleeps inside a withTenantTx callback: a timer holds the tenant transaction and its connection open; wait outside the transaction (T-83).",
    },
  },
  create(context) {
    const { sourceCode } = context;
    const [options] = /** @type {[{ names?: string[] } | undefined]} */ (context.options);
    const names = new Set(options?.names ?? DEFAULT_NAMES);
    /** @type {(import('estree').CallExpression | import('estree').NewExpression)[]} */
    const candidates = [];
    /** Same-file variables initialised from an external client import -> module family. */
    const clientVariables = new Map();

    /**
     * @param {string} name
     * @param {import('estree').Node} node
     * @returns {import('eslint').Scope.Variable | undefined}
     */
    function resolve(name, node) {
      /** @type {import('eslint').Scope.Scope | null} */
      let scope = sourceCode.getScope(node);
      while (scope) {
        const variable = scope.set.get(name);
        if (variable) return variable;
        scope = scope.upper;
      }
      return undefined;
    }

    /**
     * @param {string} name
     * @param {import('estree').Node} node
     * @returns {boolean} True when `name` is the global (no declaration in the file).
     */
    function isGlobal(name, node) {
      const variable = resolve(name, node);
      return variable === undefined || variable.defs.length === 0;
    }

    /**
     * @param {import('eslint').Scope.Variable | undefined} variable
     * @returns {{ source: string; imported: string } | undefined} The value import behind `variable`.
     */
    function importOf(variable) {
      const def = variable?.defs.find((candidate) => candidate.type === 'ImportBinding');
      if (def === undefined) return undefined;
      const declaration = /** @type {import('estree').ImportDeclaration & { importKind?: string }} */ (def.parent);
      const specifier = /** @type {import('estree').ImportDeclaration['specifiers'][number] & { importKind?: string }} */ (def.node);
      if (declaration.importKind === 'type' || specifier.importKind === 'type') return undefined;
      let imported = '*';
      if (specifier.type === 'ImportDefaultSpecifier') imported = 'default';
      else if (specifier.type === 'ImportSpecifier') {
        imported = specifier.imported.type === 'Identifier' ? specifier.imported.name : String(specifier.imported.value);
      }
      return { source: String(declaration.source.value), imported };
    }

    /**
     * @param {import('estree').Identifier} identifier
     * @returns {string | undefined} The module family the identifier's value comes from.
     */
    function clientFamilyOf(identifier) {
      const variable = resolve(identifier.name, identifier);
      if (variable === undefined) return undefined;
      const fromImport = importOf(variable);
      if (fromImport) return externalFamily(fromImport.source);
      return clientVariables.get(variable);
    }

    /**
     * @param {import('estree').Node} node
     * @returns {boolean}
     */
    function insideTenantTx(node) {
      for (const ancestor of sourceCode.getAncestors(node)) {
        if (ancestor.type !== 'ArrowFunctionExpression' && ancestor.type !== 'FunctionExpression') continue;
        const parent = /** @type {import('estree').Node & { parent?: import('estree').Node }} */ (ancestor).parent;
        if (
          parent?.type === 'CallExpression' &&
          parent.arguments.includes(/** @type {import('estree').Expression} */ (ancestor)) &&
          isTenantTxCallee(parent.callee)
        ) {
          return true;
        }
      }
      return false;
    }

    /**
     * @param {import('estree').Node} callee
     * @returns {boolean}
     */
    function isSleep(callee) {
      if (callee.type === 'Identifier') {
        if (callee.name === 'setTimeout' && isGlobal('setTimeout', callee)) return true;
        const fromImport = importOf(resolve(callee.name, callee));
        return fromImport !== undefined && TIMER_PROMISE_MODULES.has(fromImport.source) && fromImport.imported === 'setTimeout';
      }
      if (callee.type !== 'MemberExpression' || propertyName(callee) !== 'setTimeout' || callee.object.type !== 'Identifier') return false;
      if (callee.object.name === 'globalThis') return isGlobal('globalThis', callee);
      const fromImport = importOf(resolve(callee.object.name, callee));
      return fromImport !== undefined && TIMER_PROMISE_MODULES.has(fromImport.source) && fromImport.imported === '*';
    }

    /**
     * @param {import('estree').Node} callee
     * @returns {boolean} `name.x()`, `this.name.x()` or `deps.name.x()` with `name` in the option list.
     */
    function isNamedDependencyCall(callee) {
      if (callee.type !== 'MemberExpression') return false;
      const receiver = callee.object;
      if (receiver.type === 'Identifier') return names.has(receiver.name);
      const name = propertyName(receiver);
      if (receiver.type !== 'MemberExpression' || name === undefined || !names.has(name)) return false;
      return (
        receiver.object.type === 'ThisExpression' || (receiver.object.type === 'Identifier' && DEPENDENCY_HOLDERS.has(receiver.object.name))
      );
    }

    /** @param {import('estree').CallExpression | import('estree').NewExpression} node */
    function check(node) {
      const { callee } = node;
      const call = sourceCode.getText(callee);
      if (isSleep(callee)) {
        context.report({ node: callee, messageId: 'sleep', data: { call } });
        return;
      }
      if (
        node.type === 'CallExpression' &&
        ((callee.type === 'Identifier' && callee.name === 'fetch' && isGlobal('fetch', callee)) ||
          (propertyName(callee) === 'fetch' &&
            callee.type === 'MemberExpression' &&
            callee.object.type === 'Identifier' &&
            callee.object.name === 'globalThis'))
      ) {
        context.report({ node: callee, messageId: 'external', data: { call, source: 'global fetch' } });
        return;
      }
      const root = rootIdentifier(callee);
      const family = root === undefined ? undefined : clientFamilyOf(root);
      if (family !== undefined) {
        context.report({ node: callee, messageId: 'external', data: { call, source: family.endsWith('/') ? `${family}*` : family } });
        return;
      }
      if (isNamedDependencyCall(callee)) {
        context.report({ node: callee, messageId: 'external', data: { call, source: 'an injected I/O dependency' } });
      }
    }

    /** @param {import('estree').CallExpression | import('estree').NewExpression} node */
    function collect(node) {
      if (insideTenantTx(node)) candidates.push(node);
    }

    return {
      CallExpression: collect,
      NewExpression: collect,
      VariableDeclarator(node) {
        let init = node.init;
        if (init?.type === 'AwaitExpression') init = init.argument;
        if (node.id.type !== 'Identifier' || (init?.type !== 'NewExpression' && init?.type !== 'CallExpression')) return;
        const root = rootIdentifier(init.callee);
        const variable = resolve(node.id.name, node.id);
        const fromImport = root === undefined ? undefined : importOf(resolve(root.name, root));
        const family = fromImport === undefined ? undefined : externalFamily(fromImport.source);
        if (family !== undefined && variable !== undefined) clientVariables.set(variable, family);
      },
      // Evaluated at the end, so a client variable declared after the callback that uses it is still known.
      'Program:exit'() {
        for (const node of candidates) check(node);
      },
    };
  },
};
