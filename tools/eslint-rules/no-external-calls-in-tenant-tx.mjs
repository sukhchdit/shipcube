/**
 * `platform/no-external-calls-in-tenant-tx` (threat model T-83; PR2-SEC-05 addendum, PR11-SEC-05 item 5, D-ARCH-074):
 * no external I/O and no sleeps while a tenant transaction is open. A slow carrier, queue, cache, object store or mail
 * server would hold the transaction (and its pooled connection, locks and tenant context) open, and a failed commit
 * after a side effect cannot be undone; do the call before the transaction, or after commit through the outbox.
 *
 * Tenant-transaction roots (D-ARCH-106 (5), ADR-0005 am. 11 item 20; PR32-SEC-01, PR #32 code review m4); closures
 * nested in a root are inside it too:
 *  - R1: a function passed as an argument to `withTenantTx(...)` / `<x>.withTenantTx(...)`;
 *  - R2: the `handler` property of the first argument (an object literal) of `defineRoute(...)`, in every function form
 *    (arrow, function expression, `handler() {}`, `async handler() {}`), unless the literal's effective `transaction`
 *    is the string literal `'none'`. A non-literal value, a computed key or a spread element after the last
 *    `transaction` property makes it unknown, which counts as tenant. `fixtureRoute(...)` defaults to `none`: its
 *    handler is a root only when the effective value is `'tenant'` or unknown;
 *  - R3: `handler: name` (or `{ handler }`) where `name` resolves in scope to a function declaration or a `const`
 *    function (arrow or function expression) of the same file;
 *  - R5: every function of a file matching the `txFiles` option (the audit hook, the outbox writer, the audit store);
 *  - R6: any function with a parameter whose type annotation names a type of the `txHandleTypes` option (`TenantDb`,
 *    `AppDb`, `AppTransactionClient`; generic `TenantDb<X>` and qualified `Db.TenantDb` included, function types inside
 *    the annotation excluded). Type-name based, never parameter-name based: `db: DatabaseRuntime` is not a root.
 * R4 (the `load` route phase) arrives with the phases of TASK-020 part C; `call` and `afterCommit` are never roots.
 *
 * Reported inside a root:
 *  - a call of the global `fetch` (`fetch()`, `globalThis.fetch()`);
 *  - a call or `new` on a value import (default, named or namespace) from `undici`, `node:http`, `node:https`, `http`,
 *    `https`, `bullmq`, `ioredis`, `@aws-sdk/*`, `stripe` or `nodemailer`, including member calls on it
 *    (`http.request()`, `nodemailer.createTransport()`), and member calls on a same-file variable initialised from such
 *    an import (`const s3 = new S3Client(...)` ... `s3.send(cmd)`);
 *  - a member call on an identifier in the `names` option (`queue.add()`, `this.queue.add()`, `deps.queue.add()`);
 *  - `setTimeout`-based sleeps: a call of the global `setTimeout` (so `new Promise((r) => setTimeout(r, n))` too) and
 *    of `setTimeout` imported from `node:timers/promises`.
 *
 * Limits (review items, not lint): the rule is lexical and per file. A handler resolved through another file (an
 * injected `controller.cancel`) is reached through R6 in the file of the service method it ends in; a callee without
 * a transaction-handle parameter that performs I/O in another file is not followed (the runtime twin of D-ARCH-106 (6),
 * a low idle-in-transaction timeout in the API lanes, covers it). TASK-113 extends `names` with the
 * OutboundHttpClient member names when the client lands. The outbox is never in `names`: `outbox.publish(db, event)` is
 * the sanctioned in-transaction effect (D-ARCH-106 (2)).
 */
import { globPattern, relativeFile } from './path-glob.mjs';

/** Modules whose bindings perform network I/O (exact names, or a scope prefix ending in `/`). */
const EXTERNAL_MODULES = ['undici', 'node:http', 'node:https', 'http', 'https', 'bullmq', 'ioredis', '@aws-sdk/', 'stripe', 'nodemailer'];
const TIMER_PROMISE_MODULES = new Set(['node:timers/promises', 'timers/promises']);
const DEFAULT_NAMES = ['outboundHttp', 'httpClient', 'queue', 'queues', 'redis', 'valkey', 'storage', 'mailer'];
/** R5 defaults (D-ARCH-106 (5)); eslint.config.mjs sets the same list explicitly. */
const DEFAULT_TX_FILES = ['apps/api/src/platform/audit/**', 'apps/api/src/platform/outbox/writer.ts', 'packages/audit/src/store/**'];
/** R6 defaults (D-ARCH-106 (5)). */
const DEFAULT_TX_HANDLE_TYPES = ['TenantDb', 'AppDb', 'AppTransactionClient'];
/** Receivers through which an injected dependency is reached: `this.<name>.x()` and `deps.<name>.x()`. */
const DEPENDENCY_HOLDERS = new Set(['deps']);
const TENANT_TX = 'withTenantTx';
/** Route factories and their default `transaction` (D-ARCH-106 (5) R2). */
const ROUTE_FACTORIES = new Map([
  ['defineRoute', 'tenant'],
  ['fixtureRoute', 'none'],
]);
/** Expression wrappers that do not change the value (`x as T`, `x satisfies T`, `x!`, `(x)` is not a node). */
const VALUE_WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion']);
/** Type nodes whose parameters describe a callback, not the annotated parameter itself (R6 does not look inside). */
const CALLBACK_TYPES = new Set([
  'TSFunctionType',
  'TSConstructorType',
  'TSMethodSignature',
  'TSCallSignatureDeclaration',
  'TSConstructSignatureDeclaration',
]);
const FUNCTION_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration']);
/** The `{{root}}` text of each root kind. */
const ROOT_TEXT = {
  tx: 'a withTenantTx callback',
  handler: 'a defineRoute handler (it runs in the tenant transaction unless the route declares transaction: none)',
  handle: 'a function that receives a tenant transaction handle',
  file: 'a tenant-transaction file (txFiles: the audit hook, the outbox writer, the audit store)',
};

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

/**
 * @param {import('estree').Node} node
 * @returns {import('estree').Node} `node` without TypeScript value wrappers.
 */
function unwrap(node) {
  let current = node;
  while (VALUE_WRAPPERS.has(current.type))
    current = /** @type {{ expression: import('estree').Node }} */ (/** @type {unknown} */ (current)).expression;
  return current;
}

/**
 * @param {import('estree').Property} property
 * @returns {string | undefined} The static key of an object-literal property.
 */
function propertyKey(property) {
  const { key } = property;
  if (!property.computed && key.type === 'Identifier') return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return undefined;
}

/**
 * The effective `transaction` of a route literal (D-ARCH-106 (5) R2): the last `transaction` property when no spread or
 * computed key follows it; `'unknown'` for a non-literal value, or when a spread or computed key may override it.
 *
 * @param {import('estree').ObjectExpression} literal
 * @param {string} fallback the factory default
 * @returns {string}
 */
function routeTransaction(literal, fallback) {
  let value = fallback;
  for (const property of literal.properties) {
    if (property.type === 'SpreadElement') {
      value = 'unknown';
      continue;
    }
    const key = propertyKey(property);
    if (key === undefined) value = 'unknown';
    else if (key === 'transaction') {
      const literalValue = unwrap(property.value);
      value = literalValue.type === 'Literal' && typeof literalValue.value === 'string' ? literalValue.value : 'unknown';
    }
  }
  return value;
}

/**
 * @param {import('estree').Node} callee
 * @returns {string | undefined} The factory name when `callee` is `defineRoute` / `fixtureRoute` (or `<x>.` either).
 */
function routeFactory(callee) {
  const name = callee.type === 'Identifier' ? callee.name : propertyName(callee);
  return name !== undefined && ROUTE_FACTORIES.has(name) ? name : undefined;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow external I/O (HTTP, queues, cache, object storage, mail) and sleeps inside a tenant transaction (withTenantTx callbacks, defineRoute handlers, tx-handle functions, tx files).',
    },
    schema: [
      {
        type: 'object',
        properties: {
          names: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
          txFiles: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
          txHandleTypes: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      external:
        "'{{call}}' ({{source}}) runs inside {{root}}: external I/O holds the tenant transaction and its connection open and cannot be rolled back; publish through the outbox (outbox.publish(db, event)) or call it outside the transaction (T-83, D-ARCH-106).",
      sleep:
        "'{{call}}' sleeps inside {{root}}: a timer holds the tenant transaction and its connection open; wait outside the transaction (T-83, D-ARCH-106).",
    },
  },
  create(context) {
    const { sourceCode } = context;
    const [options] = /** @type {[{ names?: string[]; txFiles?: string[]; txHandleTypes?: string[] } | undefined]} */ (context.options);
    const names = new Set(options?.names ?? DEFAULT_NAMES);
    const txHandleTypes = new Set(options?.txHandleTypes ?? DEFAULT_TX_HANDLE_TYPES);
    const file = relativeFile(context);
    const txFile = (options?.txFiles ?? DEFAULT_TX_FILES).some((glob) => globPattern(glob).test(file));
    /** @type {(import('estree').CallExpression | import('estree').NewExpression)[]} */
    const candidates = [];
    /** Same-file variables initialised from an external client import -> module family. */
    const clientVariables = new Map();
    /** R2/R3 roots: route handler functions of this file. */
    const handlerRoots = new Set();
    /** R6 decision per function node. @type {WeakMap<import('estree').Node, boolean>} */
    const handleRoots = new WeakMap();

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
     * R6: the annotation names a transaction-handle type (outside callback types inside it).
     * @param {import('estree').Node | null | undefined} type
     * @returns {boolean}
     */
    function namesTxHandle(type) {
      if (type === null || type === undefined || CALLBACK_TYPES.has(type.type)) return false;
      // TypeScript-ESTree type nodes are outside the estree typings: read them through a loose shape.
      const node = /** @type {{ type: string; typeName?: { type: string; name?: string; right?: { name: string } } }} */ (
        /** @type {unknown} */ (type)
      );
      if (node.type === 'TSTypeReference' && node.typeName !== undefined) {
        const name = node.typeName.type === 'TSQualifiedName' ? node.typeName.right?.name : node.typeName.name;
        if (name !== undefined && txHandleTypes.has(name)) return true;
      }
      const record = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (node));
      return (sourceCode.visitorKeys[node.type] ?? []).some((key) => {
        const child = record[key];
        const children = Array.isArray(child) ? child : [child];
        return children.some(
          (item) => typeof item === 'object' && item !== null && namesTxHandle(/** @type {import('estree').Node} */ (item)),
        );
      });
    }

    /**
     * @param {import('estree').Node} fn a function node
     * @returns {boolean} True when a parameter's type annotation names a transaction-handle type (R6).
     */
    function takesTxHandle(fn) {
      let decision = handleRoots.get(fn);
      if (decision === undefined) {
        const params = /** @type {import('estree').Function} */ (fn).params;
        decision = params.some((param) => {
          /** @type {{ type: string; parameter?: unknown; left?: unknown; typeAnnotation?: { typeAnnotation?: import('estree').Node } }} */
          let target = param;
          if (target.type === 'TSParameterProperty') target = /** @type {typeof target} */ (target.parameter);
          if (target.type === 'AssignmentPattern') target = /** @type {typeof target} */ (target.left);
          return namesTxHandle(target.typeAnnotation?.typeAnnotation);
        });
        handleRoots.set(fn, decision);
      }
      return decision;
    }

    /**
     * @param {import('estree').Node} node
     * @returns {string | undefined} The `{{root}}` text of the innermost tenant-transaction root around `node`.
     */
    function tenantTxRoot(node) {
      const ancestors = sourceCode.getAncestors(node);
      let inFunction = false;
      for (let index = ancestors.length - 1; index >= 0; index -= 1) {
        const ancestor = /** @type {import('estree').Node} */ (ancestors[index]);
        if (!FUNCTION_TYPES.has(ancestor.type)) continue;
        inFunction = true;
        if (handlerRoots.has(ancestor)) return ROOT_TEXT.handler;
        const parent = /** @type {import('estree').Node & { parent?: import('estree').Node }} */ (ancestor).parent;
        if (
          parent?.type === 'CallExpression' &&
          parent.arguments.includes(/** @type {import('estree').Expression} */ (ancestor)) &&
          isTenantTxCallee(parent.callee)
        ) {
          return ROOT_TEXT.tx;
        }
        if (takesTxHandle(ancestor)) return ROOT_TEXT.handle;
      }
      return txFile && inFunction ? ROOT_TEXT.file : undefined;
    }

    /**
     * R3: the same-file function a `handler: name` identifier resolves to.
     * @param {import('estree').Identifier} identifier
     * @returns {import('estree').Node | undefined}
     */
    function namedHandler(identifier) {
      for (const def of resolve(identifier.name, identifier)?.defs ?? []) {
        if (def.type === 'FunctionName') return def.node;
        if (def.type === 'Variable' && def.parent.kind === 'const' && def.node.init) {
          const init = unwrap(def.node.init);
          if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') return init;
        }
      }
      return undefined;
    }

    /**
     * R2/R3: records the handler of a `defineRoute({...})` / `fixtureRoute({...})` literal that runs in the tenant
     * transaction.
     * @param {import('estree').CallExpression} call
     */
    function collectRouteHandler(call) {
      const factory = routeFactory(call.callee);
      const [first] = call.arguments;
      if (factory === undefined || first === undefined || first.type === 'SpreadElement') return;
      const literal = unwrap(first);
      if (literal.type !== 'ObjectExpression') return;
      const transaction = routeTransaction(literal, ROUTE_FACTORIES.get(factory) ?? 'tenant');
      if (factory === 'defineRoute' ? transaction === 'none' : transaction !== 'tenant' && transaction !== 'unknown') return;
      for (const property of literal.properties) {
        if (property.type !== 'Property' || propertyKey(property) !== 'handler') continue;
        const value = unwrap(property.value);
        const fn = value.type === 'Identifier' ? namedHandler(value) : value;
        if (fn !== undefined && FUNCTION_TYPES.has(fn.type)) handlerRoots.add(fn);
      }
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
      const root = tenantTxRoot(node);
      if (root === undefined) return;
      const { callee } = node;
      const call = sourceCode.getText(callee);
      if (isSleep(callee)) {
        context.report({ node: callee, messageId: 'sleep', data: { call, root } });
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
        context.report({ node: callee, messageId: 'external', data: { call, root, source: 'global fetch' } });
        return;
      }
      const receiver = rootIdentifier(callee);
      const family = receiver === undefined ? undefined : clientFamilyOf(receiver);
      if (family !== undefined) {
        context.report({ node: callee, messageId: 'external', data: { call, root, source: family.endsWith('/') ? `${family}*` : family } });
        return;
      }
      if (isNamedDependencyCall(callee)) {
        context.report({ node: callee, messageId: 'external', data: { call, root, source: 'an injected I/O dependency' } });
      }
    }

    return {
      // Every call is a candidate; the roots are decided at the end, once every route handler of the file is known
      // (a named handler is often declared before the defineRoute call that names it).
      CallExpression(node) {
        collectRouteHandler(node);
        candidates.push(node);
      },
      NewExpression(node) {
        candidates.push(node);
      },
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
      // Evaluated at the end, so a client variable declared after the callback that uses it, and a handler named
      // before its defineRoute call, are still known.
      'Program:exit'() {
        for (const node of candidates) check(node);
      },
    };
  },
};
