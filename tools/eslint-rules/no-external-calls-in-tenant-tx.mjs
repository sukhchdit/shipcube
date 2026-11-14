/**
 * `platform/no-external-calls-in-tenant-tx` (threat model T-83; PR2-SEC-05 addendum, PR11-SEC-05 item 5, D-ARCH-074):
 * no external I/O and no sleeps while a tenant transaction is open. A slow carrier, queue, cache, object store or mail
 * server would hold the transaction (and its pooled connection, locks and tenant context) open, and a failed commit
 * after a side effect cannot be undone; do the call before the transaction, or after commit through the outbox.
 *
 * Tenant-transaction roots (D-ARCH-106 (5), ADR-0005 am. 11 item 20; PR32-SEC-01, PR #32 code review m4); closures
 * nested in a root are inside it too:
 *  - R1: a function passed as an argument to `withTenantTx(...)` / `<x>.withTenantTx(...)`;
 *  - R2: the `handler` property of the route spec of `defineRoute(...)`, in every function form (arrow, function
 *    expression, `handler() {}`, `async handler() {}`), unless the spec's effective `transaction` is the string literal
 *    `'none'`. A non-literal value, an unresolved computed key or an unreadable spread element after the last
 *    `transaction` property makes it unknown, which counts as tenant. `fixtureRoute(...)` defaults to `none`: its
 *    handler is a root only when the effective value is `'tenant'` or unknown;
 *  - R3: `handler: name` (or `{ handler }`) where `name` resolves in scope to a function declaration or a `const`
 *    function (arrow or function expression) of the same file;
 *  - R4: the `load` property of the route spec of `defineRoute(...)` / `fixtureRoute(...)` (it runs in a read-only
 *    tenant transaction), in the same function forms and with the same `load: name` resolution as R2/R3, whatever the
 *    `transaction` value (defineRoute refuses `load` on `transaction: 'none'` at module load anyway). `call` and
 *    `afterCommit` are never roots;
 *  - R5: every function of a file matching the `txFiles` option (the audit hook, the outbox writer, the audit store);
 *  - R6: any function with a parameter whose type annotation names a type of the `txHandleTypes` option (`TenantDb`,
 *    `AppDb`, `AppTransactionClient`; generic `TenantDb<X>` and qualified `Db.TenantDb` included, function types inside
 *    the annotation excluded). Type-name based, never parameter-name based: `db: DatabaseRuntime` is not a root. Every
 *    method of a class whose constructor takes such a parameter (`constructor(private readonly db: TenantDb)`) is a
 *    root too (D-ARCH-111 (e)).
 *
 * Route specs and phases the rule must be able to read (D-ARCH-111 (a)-(c)):
 *  - the factory is recognised by name (`defineRoute`, `fixtureRoute`, `<x>.defineRoute`) and through an import alias
 *    (`import { defineRoute as route }`). Any other reference to a factory (`defineRoute.call(undefined, spec)`,
 *    `const dr = defineRoute`, `(0, defineRoute)(spec)`, `x.defineRoute` passed as a value) is reported (PR44-SEC-04
 *    F01-F03): call the factory directly. Import and export specifiers, declarations and type positions are not;
 *  - the spec is an inline object literal or an identifier resolving to a same-file `const` object literal (walked like
 *    an inline one); any other spec (a parameter, an import, a call result, a `let`/`var`) is reported;
 *  - a spread in the spec (`{ operationId, ...phases }`, `...{ load }`) whose argument is an inline or same-file `const`
 *    object literal is walked as part of the spec, recursively, in evaluation order (code review R1-m5 Q1, S01-S04).
 *    Any other spread (a parameter, an import, a call result, a `let`/`var`) is reported unless an explicit `handler`
 *    property follows it (it then makes `transaction` unknown only);
 *  - a computed key resolves like the plain key when it is a string literal, a no-substitution template literal
 *    (`` [`load`] ``) or a same-file `const` string (`[K]`) (K02-K04); any other computed key is reported;
 *  - a root phase (`handler` on a tenant route, `load` always) that is a call is walked through its function arguments
 *    (`timed(async () => ...)`, `timed(named)`, nested wrappers too), each becoming a root; a conditional and a logical
 *    expression (`maybe ?? (async () => ...)`, `||`, `&&`) are walked through every operand (H03), and an identifier is
 *    followed through every same-file `const` initialiser that is not a member expression (R1-m5 Q2: `const pick =
 *    flag ? async () => ... : ...`). A phase that is a function parameter, a `let`/`var` binding or a call with no
 *    function argument (`makeHandler(deps)`) is reported, so a route-building helper `build(h)` is reported at its
 *    defineRoute call. A member expression (`controller.cancel`) and an imported binding are not reported (R6 reaches
 *    the service).
 *
 * Reported inside a root:
 *  - a call or `new` of the global `fetch` or `WebSocket` (bare, or as a `globalThis.` member);
 *  - a call or `new` on a value import (default, named or namespace) from `undici`, `node:http`, `node:https`, `http`,
 *    `https`, `http2`, `net`, `tls`, `dgram`, `dns` (and `dns/promises`), `child_process` (each with or without the
 *    `node:` prefix), `bullmq`, `ioredis`, `@aws-sdk/*`, `stripe` or `nodemailer`, including member calls on it
 *    (`http.request()`, `nodemailer.createTransport()`), and member calls on a same-file variable initialised from such
 *    an import (`const s3 = new S3Client(...)` ... `s3.send(cmd)`). The pure `net` helpers (`isIP`, `isIPv4`,
 *    `isIPv6`, `BlockList`, `SocketAddress`) are not I/O and stay clean; type-only imports are never sources;
 *  - a literal `import()` of one of those modules (string literal or no-substitution template literal);
 *  - a member call whose receiver chain ends in an identifier of the `names` option, at any depth (`queue.add()`,
 *    `this.queue.add()`, `deps.queue.add()`, `ctx.deps.queue.add()`, `this.x.queue.add()`), and through one `const`
 *    alias of such a chain declared in any scope the call sees (the same function, an enclosing factory function or
 *    the module: `const q = deps.queue; q.add()`; code review R2-m3 / R2-n3, PR44-SEC-11 (b)), a destructured `names`
 *    key included (`const { queue: q } = deps; q.add()`, code review R1-n8), and a method destructured from such a
 *    chain and called bare (`const { add } = deps.queue; add()`, `const { queue: { add } } = deps; add()`, R2-n3);
 *  - sleeps and waits: a call of the global `setTimeout` / `setInterval` (bare, `globalThis.` or `global.`; so
 *    `new Promise((r) => setTimeout(r, n))` too), of `setTimeout` / `setInterval` from `node:timers`, `timers`,
 *    `node:timers/promises` or `timers/promises`, and of `scheduler.wait` from the promises modules (any local name,
 *    named or namespace import: `import { scheduler as s }`, `tp.scheduler.wait()`, `timers.promises.setTimeout()`,
 *    the `promises` member imported by name: `import { promises as tp } from 'node:timers'`, PR44-SEC-14), and of
 *    the global `Atomics.wait` / `Atomics.waitAsync`; a literal `import()` of a timer module is itself a sleep, and a
 *    `const` holding it is followed like a namespace import (`const tp = await import('node:timers/promises')`).
 *
 * Limits (review items, not lint): the rule is lexical and per file. A handler resolved through another file (an
 * injected `controller.cancel`, an imported handler) is reached through R6 in the file of the service method it ends
 * in; a root calling an imported function without a transaction-handle parameter that performs I/O in another file,
 * dynamic dispatch (`obj[name]()`), generated handlers, a phase held in an array literal or an object member
 * (`handler: handlers[0]`, `handler: table.cancel`; type information would be needed, PR44-SEC-04 H08/H09), a `load`
 * hidden in an unreadable spread that an explicit `handler` follows, setter-injected handles (I02) and aliases of a
 * source itself (`const f = fetch`, `fetch.call(...)`, X09/X10) are not followed: R6, the `names` option, the
 * NFR-SEC-010 `outbound-http-via-client` rule and the runtime twin of D-ARCH-106 (6) (a low idle-in-transaction
 * timeout in the API lanes) cover them (D-ARCH-106 (6), D-ARCH-111 (3)). A
 * false positive on an in-memory variable named like a port (`const queue = []`) is fixed by renaming it, never by a
 * disable. TASK-113 extends `names` with the OutboundHttpClient member names when the client lands. The outbox is
 * never in `names`: `outbox.publish(db, event)` is the sanctioned in-transaction effect (D-ARCH-106 (2)).
 */
import { staticSpecifier } from './module-sources.mjs';
import { globPattern, relativeFile } from './path-glob.mjs';

/** Modules whose bindings perform network I/O (exact names, or a scope prefix ending in `/`). */
const EXTERNAL_MODULES = [
  'undici',
  'node:http',
  'node:https',
  'http',
  'https',
  // PR44-SEC-04 X04-X08: the other Node network and process modules (`dns` covers `dns/promises`).
  'node:http2',
  'http2',
  'node:net',
  'net',
  'node:tls',
  'tls',
  'node:dgram',
  'dgram',
  'node:dns',
  'dns',
  'node:child_process',
  'child_process',
  'bullmq',
  'ioredis',
  '@aws-sdk/',
  'stripe',
  'nodemailer',
];
/** Members of an external module that do no I/O (module family without `node:` -> member names). */
const PURE_MEMBERS = new Map([['net', new Set(['isIP', 'isIPv4', 'isIPv6', 'BlockList', 'SocketAddress'])]]);
/** Timer modules: the callback forms and the promise forms (PR44-SEC-04 X01-X03). */
const TIMER_MODULES = new Set(['node:timers', 'timers', 'node:timers/promises', 'timers/promises']);
/** Timer functions that sleep or wait, as globals or imports. */
const SLEEP_TIMERS = new Set(['setTimeout', 'setInterval']);
/** Global objects whose members are the timer and network globals. */
const GLOBAL_OBJECTS = new Set(['globalThis', 'global']);
/** Global network constructors and functions (`fetch()`, `new WebSocket(url)`) -> the `{{source}}` text. */
const NETWORK_GLOBALS = new Map([
  ['fetch', 'global fetch'],
  ['WebSocket', 'global WebSocket'],
]);
/** Parents in which a factory identifier is not a value reference (declarations, specifiers, keys). */
const FACTORY_NAME_PARENTS = new Set(['ImportSpecifier', 'ImportDefaultSpecifier', 'ImportNamespaceSpecifier', 'ExportSpecifier']);
const DEFAULT_NAMES = ['outboundHttp', 'httpClient', 'queue', 'queues', 'redis', 'valkey', 'storage', 'mailer'];
/** R5 defaults (D-ARCH-106 (5)); eslint.config.mjs sets the same list explicitly. */
const DEFAULT_TX_FILES = ['apps/api/src/platform/audit/**', 'apps/api/src/platform/outbox/writer.ts', 'packages/audit/src/store/**'];
/** R6 defaults (D-ARCH-106 (5)). */
const DEFAULT_TX_HANDLE_TYPES = ['TenantDb', 'AppDb', 'AppTransactionClient'];
/** `Atomics` members that block or wait (D-ARCH-111 (f)). */
const ATOMICS_WAITS = new Set(['wait', 'waitAsync']);
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
  load: 'a defineRoute load phase (it runs in a read-only tenant transaction)',
  handle: 'a function that receives a tenant transaction handle',
  injected: 'a method of a class constructed with a tenant transaction handle',
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
 * @param {string} family an `EXTERNAL_MODULES` entry
 * @returns {ReadonlySet<string> | undefined} The members of `family` that do no I/O.
 */
function pureMembers(family) {
  return PURE_MEMBERS.get(family.startsWith('node:') ? family.slice('node:'.length) : family);
}

/**
 * The member of a module a call reaches: the imported name of a named import, or the first property after a namespace
 * or default import (`net.connect` -> `connect`, `net.Socket.prototype.x` -> `Socket`).
 *
 * @param {import('estree').Node} callee
 * @param {{ imported: string }} fromImport
 * @returns {string | undefined}
 */
function moduleMember(callee, fromImport) {
  if (fromImport.imported !== '*' && fromImport.imported !== 'default') return fromImport.imported;
  let current = callee;
  let member;
  while (current.type === 'MemberExpression') {
    member = propertyName(current);
    current = current.object;
  }
  return member;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow external I/O (HTTP, queues, cache, object storage, mail) and sleeps inside a tenant transaction (withTenantTx callbacks, defineRoute handlers and load phases, tx-handle functions, tx files).',
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
      routeSpec:
        "'{{factory}}' receives a route spec the rule cannot read: declare route specs as an inline literal or a same-file const literal, so the tenant-transaction phases (handler, load) can be checked (T-83, D-ARCH-111).",
      routePhase:
        "The route {{phase}} '{{text}}' cannot be followed: declare route handlers inline or as same-file const functions (a wrapper call must receive the function itself), so the tenant-transaction check can see what runs inside the transaction (T-83, D-ARCH-111).",
      routeFactory:
        "'{{text}}' uses the route factory '{{factory}}' without calling it: call {{factory}} directly so the tenant-transaction lint can see the route spec (T-83, D-ARCH-111).",
    },
  },
  create(context) {
    const { sourceCode } = context;
    const [options] = /** @type {[{ names?: string[]; txFiles?: string[]; txHandleTypes?: string[] } | undefined]} */ (context.options);
    const names = new Set(options?.names ?? DEFAULT_NAMES);
    const txHandleTypes = new Set(options?.txHandleTypes ?? DEFAULT_TX_HANDLE_TYPES);
    const file = relativeFile(context);
    const txFile = (options?.txFiles ?? DEFAULT_TX_FILES).some((glob) => globPattern(glob).test(file));
    /** @type {(import('estree').CallExpression | import('estree').NewExpression | import('estree').ImportExpression)[]} */
    const candidates = [];
    /** Same-file variables initialised from an external client import -> module family. */
    const clientVariables = new Map();
    /** R2/R3/R4 roots: route phase functions of this file -> their `{{root}}` text. @type {Map<import('estree').Node, string>} */
    const phaseRoots = new Map();
    /** Route phase values already reported as unreadable (a const spec may be shared by several routes). */
    const reportedPhases = new WeakSet();
    /** Spreads and computed keys of route specs already reported as unreadable (same reason). */
    const reportedSpecParts = new WeakSet();
    /** Local names of value imports of a route factory (`import { defineRoute as route }`) -> the factory name. */
    const factoryAliases = new Map();
    /** Identifiers naming a route factory, checked at the end (F01-F03). @type {[import('estree').Identifier, string][]} */
    const factoryReferences = [];
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
      // A typescript-eslint `TSImportEqualsDeclaration` is not an estree type.
      const equals =
        /** @type {{ type: string; moduleReference?: { type: string; expression?: import('estree').Node }; importKind?: string }} */ (
          /** @type {unknown} */ (def.node)
        );
      // PR44-SEC-11 (a): `import x = require('m')` is the whole module (fail closed); `import X = NS.y` is no import.
      if (equals.type === 'TSImportEqualsDeclaration') {
        const source =
          equals.moduleReference?.type === 'TSExternalModuleReference' ? staticSpecifier(equals.moduleReference.expression) : undefined;
        return source === undefined || equals.importKind === 'type' ? undefined : { source, imported: '*' };
      }
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
        const phase = phaseRoots.get(ancestor);
        if (phase !== undefined) return phase;
        const parent = /** @type {import('estree').Node & { parent?: import('estree').Node }} */ (ancestor).parent;
        if (
          parent?.type === 'CallExpression' &&
          parent.arguments.includes(/** @type {import('estree').Expression} */ (ancestor)) &&
          isTenantTxCallee(parent.callee)
        ) {
          return ROOT_TEXT.tx;
        }
        if (takesTxHandle(ancestor)) return ROOT_TEXT.handle;
        if (holdsTxHandle(ancestor)) return ROOT_TEXT.injected;
      }
      return txFile && inFunction ? ROOT_TEXT.file : undefined;
    }

    /**
     * D-ARCH-111 (e): `fn` is a method (or a function-valued class field) of a class whose constructor takes a
     * transaction-handle parameter (`constructor(private readonly db: TenantDb)`).
     * @param {import('estree').Node} fn
     * @returns {boolean}
     */
    function holdsTxHandle(fn) {
      const member = /** @type {import('estree').Node & { parent?: import('estree').Node }} */ (fn).parent;
      const isMember = (member?.type === 'MethodDefinition' && member.kind !== 'constructor') || member?.type === 'PropertyDefinition';
      const body = isMember ? /** @type {import('estree').Node & { parent?: import('estree').Node }} */ (member).parent : undefined;
      if (body?.type !== 'ClassBody') return false;
      return body.body.some(
        (element) => element.type === 'MethodDefinition' && element.kind === 'constructor' && takesTxHandle(element.value),
      );
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
     * D-ARCH-111 (c): the factory name when `callee` is `defineRoute` / `fixtureRoute`, `<x>.` either, or a local
     * alias of their import (`import { defineRoute as route }`).
     * @param {import('estree').Node} callee
     * @returns {string | undefined}
     */
    function routeFactory(callee) {
      const name = callee.type === 'Identifier' ? callee.name : propertyName(callee);
      if (name !== undefined && ROUTE_FACTORIES.has(name)) return name;
      if (callee.type !== 'Identifier') return undefined;
      const imported = importOf(resolve(callee.name, callee))?.imported;
      return imported !== undefined && ROUTE_FACTORIES.has(imported) ? imported : undefined;
    }

    /**
     * D-ARCH-111 (a): the route spec literal of a factory call: inline, or a same-file `const` object literal.
     * @param {import('estree').Node} argument
     * @returns {import('estree').ObjectExpression | undefined}
     */
    function routeSpec(argument) {
      const spec = unwrap(argument);
      if (spec.type === 'ObjectExpression') return spec;
      if (spec.type !== 'Identifier') return undefined;
      for (const def of resolve(spec.name, spec)?.defs ?? []) {
        if (def.type === 'Variable' && def.parent.kind === 'const' && def.node.init) {
          const init = unwrap(def.node.init);
          if (init.type === 'ObjectExpression') return init;
        }
      }
      return undefined;
    }

    /**
     * @param {import('estree').Node} node
     * @param {string} phase `handler` or `load`
     */
    function reportPhase(node, phase) {
      if (reportedPhases.has(node)) return;
      reportedPhases.add(node);
      const text = sourceCode.getText(node);
      context.report({ node, messageId: 'routePhase', data: { phase, text: text.length > 60 ? `${text.slice(0, 57)}...` : text } });
    }

    /**
     * The functions a wrapper call passes on (`timed(async () => ...)`, `timed(named)`, nested wrappers).
     * @param {import('estree').CallExpression} call
     * @returns {import('estree').Node[]}
     */
    function wrappedFunctions(call) {
      return call.arguments.flatMap((argument) => {
        const value = unwrap(argument);
        if (FUNCTION_TYPES.has(value.type)) return [value];
        if (value.type === 'Identifier') {
          const fn = namedHandler(value);
          return fn === undefined ? [] : [fn];
        }
        return value.type === 'CallExpression' ? wrappedFunctions(value) : [];
      });
    }

    /**
     * R2/R3/R4 and D-ARCH-111 (b): records the function(s) a root phase value runs, or reports a value the rule cannot
     * follow. A member expression and an imported binding are left to R6.
     * @param {import('estree').Node} node the phase value
     * @param {string} phase `handler` or `load`
     * @param {Set<import('estree').Node>} [seen] the const initialisers already followed (a cycle stops)
     */
    function collectPhase(node, phase, seen = new Set()) {
      const value = unwrap(node);
      const root = phase === 'load' ? ROOT_TEXT.load : ROOT_TEXT.handler;
      if (FUNCTION_TYPES.has(value.type)) {
        phaseRoots.set(value, root);
      } else if (value.type === 'ConditionalExpression') {
        collectPhase(value.consequent, phase, seen);
        collectPhase(value.alternate, phase, seen);
      } else if (value.type === 'LogicalExpression') {
        // PR44-SEC-04 H03: `maybe ?? (async () => ...)`, `a || b`, `flag && fn`.
        collectPhase(value.left, phase, seen);
        collectPhase(value.right, phase, seen);
      } else if (value.type === 'CallExpression') {
        const functions = wrappedFunctions(value);
        if (functions.length === 0) reportPhase(node, phase);
        for (const fn of functions) phaseRoots.set(fn, root);
      } else if (value.type === 'Identifier') {
        const fn = namedHandler(value);
        if (fn !== undefined) {
          phaseRoots.set(fn, root);
          return;
        }
        for (const def of resolve(value.name, value)?.defs ?? []) {
          if (def.type === 'Parameter' || (def.type === 'Variable' && def.parent.kind !== 'const')) reportPhase(node, phase);
          else if (def.type === 'Variable' && def.node.init && def.node.id.type === 'Identifier') {
            // R1-m5 (b): every const initialiser but a member expression (left to R6 by design) is followed.
            const init = def.node.init;
            if (unwrap(init).type === 'MemberExpression' || seen.has(init)) continue;
            seen.add(init);
            collectPhase(init, phase, seen);
          }
        }
      }
    }

    /**
     * The static key of an object-literal property: a plain or string-literal key, or a computed key that is a string
     * literal, a no-substitution template literal or a same-file `const` string (PR44-SEC-04 K02-K04).
     * @param {import('estree').Property} property
     * @returns {string | undefined} undefined for a computed key the rule cannot resolve.
     */
    function staticKey(property) {
      const { key } = property;
      if (!property.computed) {
        if (key.type === 'Identifier') return key.name;
        return key.type === 'Literal' ? String(key.value) : undefined;
      }
      return constantString(key, new Set());
    }

    /**
     * @param {import('estree').Node} node
     * @param {Set<import('estree').Node>} seen the const initialisers already followed
     * @returns {string | undefined} The string `node` always evaluates to, when the file says so lexically.
     */
    function constantString(node, seen) {
      const value = unwrap(node);
      if (value.type === 'Literal') return typeof value.value === 'string' ? value.value : undefined;
      if (value.type === 'TemplateLiteral')
        return value.expressions.length === 0 ? (value.quasis[0]?.value.cooked ?? undefined) : undefined;
      if (value.type !== 'Identifier') return undefined;
      for (const def of resolve(value.name, value)?.defs ?? []) {
        const init = def.type === 'Variable' && def.parent.kind === 'const' && def.node.id.type === 'Identifier' ? def.node.init : null;
        if (init === null || init === undefined || seen.has(init)) continue;
        seen.add(init);
        return constantString(init, seen);
      }
      return undefined;
    }

    /**
     * @typedef {{ property: import('estree').Property; key: string | undefined } | { spread: import('estree').SpreadElement }} SpecEntry
     */

    /**
     * R1-m5 (a), PR44-SEC-04 S01-S04: the properties of a route spec in evaluation order, a spread of an inline or
     * same-file `const` object literal inlined (recursively), any other spread kept as an unreadable entry.
     * @param {import('estree').ObjectExpression} literal
     * @param {Set<import('estree').ObjectExpression>} open the literals being expanded (a cycle is unreadable)
     * @returns {SpecEntry[]}
     */
    function specEntries(literal, open) {
      open.add(literal);
      /** @type {SpecEntry[]} */
      const entries = [];
      for (const property of literal.properties) {
        if (property.type === 'SpreadElement') {
          const spread = routeSpec(property.argument);
          if (spread === undefined || open.has(spread)) entries.push({ spread: property });
          else entries.push(...specEntries(spread, open));
        } else entries.push({ property, key: staticKey(property) });
      }
      open.delete(literal);
      return entries;
    }

    /**
     * @param {import('estree').Node} node an unreadable spread or computed key of a route spec
     * @param {string} factory
     */
    function reportSpecPart(node, factory) {
      if (reportedSpecParts.has(node)) return;
      reportedSpecParts.add(node);
      context.report({ node, messageId: 'routeSpec', data: { factory } });
    }

    /**
     * R2/R3/R4: records the root phases (`handler` unless the route is `transaction: 'none'`, `load` always) of a
     * `defineRoute(...)` / `fixtureRoute(...)` spec; reports a spec the rule cannot read (D-ARCH-111 (a)): the spec
     * itself, an unresolved computed key, and an unreadable spread that no explicit `handler` follows.
     * @param {import('estree').CallExpression} call
     */
    function collectRoute(call) {
      const factory = routeFactory(call.callee);
      const [first] = call.arguments;
      if (factory === undefined || first === undefined) return;
      const literal = first.type === 'SpreadElement' ? undefined : routeSpec(first);
      if (literal === undefined) {
        context.report({ node: first, messageId: 'routeSpec', data: { factory } });
        return;
      }
      const entries = specEntries(literal, new Set());
      // The effective `transaction` (D-ARCH-106 (5) R2): the last `transaction` property when no unreadable spread or
      // computed key follows it; 'unknown' for a non-literal value, or when one may override it.
      let transaction = ROUTE_FACTORIES.get(factory) ?? 'tenant';
      /** @type {import('estree').SpreadElement[]} */
      let unreadSpreads = [];
      for (const entry of entries) {
        if ('spread' in entry) {
          transaction = 'unknown';
          unreadSpreads.push(entry.spread);
        } else if (entry.key === undefined) {
          transaction = 'unknown';
          reportSpecPart(entry.property.key, factory);
        } else if (entry.key === 'transaction') {
          const value = unwrap(entry.property.value);
          transaction = value.type === 'Literal' && typeof value.value === 'string' ? value.value : 'unknown';
        } else if (entry.key === 'handler') unreadSpreads = [];
      }
      for (const spread of unreadSpreads) reportSpecPart(spread, factory);
      const tenantHandler = factory === 'defineRoute' ? transaction !== 'none' : transaction === 'tenant' || transaction === 'unknown';
      for (const entry of entries) {
        if ('spread' in entry) continue;
        if (entry.key === 'load' || (entry.key === 'handler' && tenantHandler)) collectPhase(entry.property.value, entry.key);
      }
    }

    /**
     * PR44-SEC-04 F01-F03: a reference to a route factory that is neither a direct callee nor a name position
     * (an import or export specifier, a declaration, a parameter, a property key, a type position) hides the spec.
     * @param {import('estree').Identifier} identifier
     * @param {string} factory
     */
    function checkFactoryReference(identifier, factory) {
      /** @type {import('estree').Node} */
      let node = identifier;
      let parent = /** @type {import('estree').Node & { parent?: import('estree').Node }} */ (identifier).parent;
      if (parent === undefined || FACTORY_NAME_PARENTS.has(parent.type)) return;
      const isProperty = parent.type === 'MemberExpression' && parent.property === identifier && !parent.computed;
      // An import alias counts only where it reads the import (not `obj.route`, not a shadowing binding).
      if (identifier.name !== factory && (isProperty || importOf(resolve(identifier.name, identifier))?.imported !== factory)) return;
      if (isProperty) {
        // `<x>.defineRoute`: a callee, or the target of an assignment, is not a hidden use.
        node = parent;
        parent = /** @type {import('estree').Node & { parent?: import('estree').Node }} */ (parent).parent;
        if (parent?.type === 'AssignmentExpression' && parent.left === node) return;
      } else if (isNamePosition(identifier, parent)) return;
      if ((parent?.type === 'CallExpression' || parent?.type === 'NewExpression') && parent.callee === node) return;
      // A shorthand property may hold the same identifier as key and value: report it once.
      if (reportedSpecParts.has(node)) return;
      reportedSpecParts.add(node);
      const text = sourceCode.getText(parent ?? node);
      context.report({ node, messageId: 'routeFactory', data: { factory, text: text.length > 60 ? `${text.slice(0, 57)}...` : text } });
    }

    /**
     * @param {import('estree').Identifier} identifier
     * @param {import('estree').Node} parent
     * @returns {boolean} `identifier` names something (a declaration, a parameter, a key, a type) rather than reading it.
     */
    function isNamePosition(identifier, parent) {
      const loose = /** @type {Record<string, unknown> & { type: string }} */ (/** @type {unknown} */ (parent));
      if (parent.type.startsWith('TS') && !VALUE_WRAPPERS.has(parent.type)) return true;
      if (loose.id === identifier) return true;
      if (FUNCTION_TYPES.has(parent.type) && /** @type {import('estree').Function} */ (parent).params.includes(identifier)) return true;
      // A destructuring target (`const { defineRoute } = routing`) declares the name; its calls are direct.
      if (parent.type === 'Property' && /** @type {{ parent?: import('estree').Node }} */ (parent).parent?.type === 'ObjectPattern')
        return true;
      const isKeyed = parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition';
      return isKeyed && loose.key === identifier && loose.computed !== true && loose.shorthand !== true;
    }

    /**
     * @param {import('estree').Node} callee
     * @returns {boolean}
     */
    function isSleep(callee) {
      if (callee.type === 'Identifier') {
        if (SLEEP_TIMERS.has(callee.name) && isGlobal(callee.name, callee)) return true;
        const imported = timersImport(callee);
        return imported !== undefined && SLEEP_TIMERS.has(imported);
      }
      if (callee.type !== 'MemberExpression') return false;
      const name = propertyName(callee);
      const { object } = callee;
      if (name === 'wait' && isTimersScheduler(object)) return true;
      if (name !== undefined && ATOMICS_WAITS.has(name) && object.type === 'Identifier' && object.name === 'Atomics') {
        return isGlobal('Atomics', object);
      }
      if (name === undefined || !SLEEP_TIMERS.has(name)) return false;
      // `timers.promises.setTimeout()` (namespace of `node:timers`).
      if (object.type === 'MemberExpression') {
        return propertyName(object) === 'promises' && object.object.type === 'Identifier' && isTimersNamespace(object.object);
      }
      if (object.type !== 'Identifier') return false;
      // PR44-SEC-04 X01: `globalThis.setTimeout()` and `global.setTimeout()`.
      if (GLOBAL_OBJECTS.has(object.name)) return isGlobal(object.name, callee);
      return isTimersNamespace(object);
    }

    /**
     * @param {import('estree').Identifier} identifier
     * @returns {string | undefined} The name imported from a timer module (`node:timers`, `node:timers/promises`)
     * behind `identifier` (PR44-SEC-04 X02/X03).
     */
    function timersImport(identifier) {
      const fromImport = importOf(resolve(identifier.name, identifier));
      return fromImport !== undefined && TIMER_MODULES.has(fromImport.source) ? fromImport.imported : undefined;
    }

    /**
     * @param {import('estree').Identifier} identifier
     * @returns {boolean} A namespace (or default) import of a timer module, its `promises` member imported by name
     * (`import { promises as tp } from 'node:timers'`), or a `const` holding a literal `import()` of a timer module
     * (`const tp = await import('node:timers/promises')`; PR44-SEC-14).
     */
    function isTimersNamespace(identifier) {
      const imported = timersImport(identifier);
      if (imported === '*' || imported === 'default' || imported === 'promises') return true;
      return constDefs(identifier).some((def) => isTimersImportExpression(def.node.init));
    }

    /**
     * @param {import('estree').Node} node
     * @returns {boolean} `node` is a literal `import()` of a timer module, awaited or not (PR44-SEC-14).
     */
    function isTimersImportExpression(node) {
      const value = unwrap(node.type === 'AwaitExpression' ? node.argument : node);
      const source = value.type === 'ImportExpression' ? staticSpecifier(value.source) : undefined;
      return source !== undefined && TIMER_MODULES.has(source);
    }

    /**
     * D-ARCH-111 (f): `scheduler` from `node:timers/promises` under any local name, or `<namespace>.scheduler`.
     * @param {import('estree').Node} node
     * @returns {boolean}
     */
    function isTimersScheduler(node) {
      if (node.type === 'Identifier') return timersImport(node) === 'scheduler';
      return (
        node.type === 'MemberExpression' &&
        propertyName(node) === 'scheduler' &&
        node.object.type === 'Identifier' &&
        isTimersNamespace(node.object)
      );
    }

    /**
     * @param {import('estree').Node} node
     * @returns {boolean} `node` is a `names` identifier or a member chain ending in one (`deps.queue`, `this.x.queue`).
     */
    function endsInName(node) {
      if (node.type === 'Identifier') return names.has(node.name);
      const name = propertyName(node);
      return name !== undefined && names.has(name);
    }

    /**
     * D-ARCH-111 (d): a member call whose receiver chain ends in a `names` entry at any depth (`queue.add()`,
     * `ctx.deps.queue.add()`, `this.x.queue.add()`), or whose receiver is one `const` alias of such a chain
     * (`const q = deps.queue; q.add()`) declared in any scope the call sees: the same function, an enclosing factory
     * function (`createSvc(d) { const q = d.queue; ... }`, code review R2-n3) or the module (R2-m3, PR44-SEC-11 (b));
     * a `const` is as followable in each. Also a method destructured from such a chain and called bare (R2-n3).
     * @param {import('estree').Node} callee
     * @returns {boolean}
     */
    function isNamedDependencyCall(callee) {
      if (callee.type === 'Identifier') return isHolderMethod(callee);
      if (callee.type !== 'MemberExpression') return false;
      const receiver = unwrap(callee.object);
      if (endsInName(receiver)) return true;
      if (receiver.type !== 'Identifier') return false;
      return constDefs(receiver).some((def) => endsInName(unwrap(def.node.init)) || isNamedKeyTarget(def.name));
    }

    /**
     * @param {import('estree').Identifier} identifier
     * @returns {{ name: import('estree').Identifier; node: import('estree').VariableDeclarator & { init: import('estree').Expression } }[]}
     * The initialised `const` declarations `identifier` resolves to.
     */
    function constDefs(identifier) {
      return /** @type {{ name: import('estree').Identifier; node: import('estree').VariableDeclarator & { init: import('estree').Expression } }[]} */ (
        (resolve(identifier.name, identifier)?.defs ?? []).filter(
          (def) => def.type === 'Variable' && def.parent.kind === 'const' && def.node.init !== null && def.node.init !== undefined,
        )
      );
    }

    /**
     * Code review R2-n3: `add` in `const { add } = deps.queue` or `const { queue: { add } } = deps`, a method taken out
     * of a `names` holder (the initialiser ends in a `names` entry, or an outer key of the pattern is one).
     * @param {import('estree').Identifier} callee
     * @returns {boolean}
     */
    function isHolderMethod(callee) {
      return constDefs(callee).some((def) => {
        /** @type {(import('estree').Node & { parent?: import('estree').Node | null }) | null | undefined} */
        let property = /** @type {import('estree').Node & { parent?: import('estree').Node }} */ (def.name).parent;
        if (property?.type !== 'Property' || property.value !== def.name) return false;
        // Walk out of the pattern: every key above the method's own key names a holder on the way.
        for (let pattern = property.parent; pattern?.type === 'ObjectPattern'; pattern = property?.parent) {
          const outer = /** @type {import('estree').Node & { parent?: import('estree').Node | null }} */ (pattern).parent;
          if (outer?.type !== 'Property') return outer === def.node && endsInName(unwrap(def.node.init));
          const key = staticKey(/** @type {import('estree').Property} */ (outer));
          if (key !== undefined && names.has(key)) return true;
          property = outer;
        }
        return false;
      });
    }

    /**
     * Code review R1-n8: `q` in `const { queue: q } = deps` (a destructuring property whose key is a `names` entry).
     * @param {import('estree').Identifier} name the declared identifier
     * @returns {boolean}
     */
    function isNamedKeyTarget(name) {
      const property = /** @type {import('estree').Node & { parent?: import('estree').Node }} */ (name).parent;
      if (property?.type !== 'Property' || property.value !== name) return false;
      const key = staticKey(property);
      return key !== undefined && names.has(key);
    }

    /**
     * D-ARCH-111 (g): a literal `import()` of an external client module; PR44-SEC-14: a literal `import()` of a timer
     * module is a sleep, whatever is done with it.
     * @param {import('estree').ImportExpression} node
     * @param {string} root
     */
    function checkImport(node, root) {
      if (isTimersImportExpression(node)) {
        context.report({ node, messageId: 'sleep', data: { call: sourceCode.getText(node), root } });
        return;
      }
      const source = staticSpecifier(node.source);
      const family = source === undefined ? undefined : externalFamily(source);
      if (family === undefined) return;
      context.report({
        node,
        messageId: 'external',
        data: { call: sourceCode.getText(node), root, source: family.endsWith('/') ? `${family}*` : family },
      });
    }

    /**
     * @param {import('estree').Node} callee
     * @returns {string | undefined} The `{{source}}` text when `callee` is the global `fetch` or `WebSocket` (bare or a
     * `globalThis.` member; PR44-SEC-04 X04-X08 for `WebSocket`).
     */
    function networkGlobalSource(callee) {
      if (callee.type === 'Identifier') {
        const source = NETWORK_GLOBALS.get(callee.name);
        return source !== undefined && isGlobal(callee.name, callee) ? source : undefined;
      }
      const name = propertyName(callee);
      if (name === undefined || callee.type !== 'MemberExpression' || callee.object.type !== 'Identifier') return undefined;
      return callee.object.name === 'globalThis' ? NETWORK_GLOBALS.get(name) : undefined;
    }

    /**
     * @param {import('estree').Node} callee
     * @param {import('estree').Identifier} receiver the root identifier of `callee`
     * @param {string} family
     * @returns {boolean} `callee` reaches a member of `family` that does no I/O (`isIP` from `node:net`).
     */
    function isPureMember(callee, receiver, family) {
      const pure = pureMembers(family);
      const fromImport = pure === undefined ? undefined : importOf(resolve(receiver.name, receiver));
      if (pure === undefined || fromImport === undefined) return false;
      const member = moduleMember(callee, fromImport);
      return member !== undefined && pure.has(member);
    }

    /** @param {import('estree').CallExpression | import('estree').NewExpression | import('estree').ImportExpression} node */
    function check(node) {
      const root = tenantTxRoot(node);
      if (root === undefined) return;
      if (node.type === 'ImportExpression') {
        checkImport(node, root);
        return;
      }
      const { callee } = node;
      const call = sourceCode.getText(callee);
      if (isSleep(callee)) {
        context.report({ node: callee, messageId: 'sleep', data: { call, root } });
        return;
      }
      const networkGlobal = networkGlobalSource(callee);
      if (networkGlobal !== undefined) {
        context.report({ node: callee, messageId: 'external', data: { call, root, source: networkGlobal } });
        return;
      }
      const receiver = rootIdentifier(callee);
      const family = receiver === undefined ? undefined : clientFamilyOf(receiver);
      if (family !== undefined && receiver !== undefined) {
        if (!isPureMember(callee, receiver, family)) {
          context.report({
            node: callee,
            messageId: 'external',
            data: { call, root, source: family.endsWith('/') ? `${family}*` : family },
          });
        }
        return;
      }
      if (isNamedDependencyCall(callee)) {
        context.report({ node: callee, messageId: 'external', data: { call, root, source: 'an injected I/O dependency' } });
      }
    }

    return {
      Program(node) {
        // Import declarations are top-level: the factory aliases are known before any identifier is visited.
        for (const statement of node.body) {
          if (statement.type !== 'ImportDeclaration') continue;
          for (const specifier of statement.specifiers) {
            const fromImport = importOf(resolve(specifier.local.name, specifier));
            if (fromImport !== undefined && ROUTE_FACTORIES.has(fromImport.imported))
              factoryAliases.set(specifier.local.name, fromImport.imported);
          }
        }
      },
      Identifier(node) {
        const factory = ROUTE_FACTORIES.has(node.name) ? node.name : factoryAliases.get(node.name);
        if (factory !== undefined) factoryReferences.push([node, factory]);
      },
      // Every call is a candidate; the roots are decided at the end, once every route handler of the file is known
      // (a named handler is often declared before the defineRoute call that names it).
      CallExpression(node) {
        collectRoute(node);
        candidates.push(node);
      },
      NewExpression(node) {
        candidates.push(node);
      },
      ImportExpression(node) {
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
        if (family !== undefined && variable !== undefined && root !== undefined && !isPureMember(init.callee, root, family)) {
          clientVariables.set(variable, family);
        }
      },
      // Evaluated at the end, so a client variable declared after the callback that uses it, and a handler named
      // before its defineRoute call, are still known.
      'Program:exit'() {
        for (const [identifier, factory] of factoryReferences) checkFactoryReference(identifier, factory);
        for (const node of candidates) check(node);
      },
    };
  },
};
