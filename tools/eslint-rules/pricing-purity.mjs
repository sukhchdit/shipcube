/**
 * `platform/pricing-purity` (REQ-PRICE-001, ADR-0015 §6, NFR-MAINT-001; US-138 AT-US-138-02, TASK-076; code review
 * R1-m1, PR076-SEC-01): the pricing engine is a pure function, so `packages/pricing/src` reads no clock, no randomness,
 * no environment and does no I/O. eslint.config.mjs enables the rule for that folder only (tests excluded).
 *
 * Global-scope pass (every value reference to a global, whatever the spelling: member access, destructuring, alias,
 * computed or template key, spread, `Reflect` argument):
 *  - `process`, `performance`, `crypto` and the global objects `globalThis`, `self`, `window`, `global`: always
 *    reported (the engine needs none of them; this covers `process.env`/`argv`/`hrtime`/`uptime`/`cwd`,
 *    `performance.now`/`timeOrigin`, `crypto.randomUUID`/`getRandomValues`/`subtle`);
 *  - `Date`: reported except as `new Date(<one non-spread argument>)`, `Date.UTC(...)` and `Date.parse(...)` (so
 *    `Date.now`, `Date()` with or without arguments, `new Date()`, `new Date(...args)` and aliases are reported);
 *  - `Math`: reported except as `Math.<static name>` other than `random`.
 * Type-only references (`(): Date`) are not values and are skipped.
 *
 * Imports:
 *  - I/O modules: any `node:*` or Node core module, HTTP clients, database, queue and cache drivers, by static import,
 *    re-export, `import()` or `require()` (the ADR-0003 boundaries allow-list is the second control);
 *  - the clock and randomness that the allow-listed `@platform/shared` root exports (`uuidv7`, `uuidV7Timestamp`), by
 *    name, and any namespace, default, `export *` or `import()` of `@platform/shared` (which would carry them);
 *  - relative specifiers into a `tests/`, `test/` or `__tests__/` folder or a `*.test.*` module: test helpers are
 *    outside this rule, so production code never imports them.
 *
 * Limits: a value that is not a global (an `Event().timeStamp`, `import.meta`, a timer callback) is not a clock read
 * this rule can see; `Intl` is `platform/no-tofixed-tolocalestring` and `new Function` is `no-implied-eval`.
 */
import { builtinModules } from 'node:module';

const ALWAYS_IMPURE = new Set(['process', 'performance', 'crypto', 'globalThis', 'self', 'window', 'global']);
const GLOBAL_OBJECTS = new Set(['globalThis', 'self', 'window', 'global']);
const DATE_STATIC_ALLOWED = new Set(['UTC', 'parse']);
const SHARED_ROOT = '@platform/shared';
/** `@platform/shared` exports that read the clock or randomness (`ids/uuidv7.ts`: `uuid` v7). */
const IMPURE_SHARED_EXPORTS = new Set(['uuidv7', 'uuidV7Timestamp']);
const TEST_SPECIFIER = /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.test(?:\.[cm]?[jt]sx?)?$/u;
const IO_PACKAGES = [
  'axios',
  'node-fetch',
  'undici',
  'got',
  'ky',
  'pg',
  'pg-pool',
  '@prisma/client',
  '@prisma/adapter-pg',
  '@platform/prisma',
  'ioredis',
  'redis',
  'bullmq',
  'pino',
];
const CORE_MODULES = new Set(builtinModules);

/**
 * @param {string} specifier
 * @returns {boolean}
 */
function isIoModule(specifier) {
  if (specifier.startsWith('node:') || CORE_MODULES.has(specifier) || CORE_MODULES.has(specifier.split('/')[0] ?? '')) return true;
  return IO_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

/**
 * The static property name of a member expression (identifier, string literal or expression-free template).
 * @param {import('estree').MemberExpression} node
 * @returns {string | null}
 */
function propertyName(node) {
  const { property } = node;
  if (!node.computed && property.type === 'Identifier') return property.name;
  if (property.type === 'Literal' && typeof property.value === 'string') return property.value;
  if (property.type === 'TemplateLiteral' && property.expressions.length === 0) return property.quasis[0]?.value.cooked ?? null;
  return null;
}

/**
 * The member read directly on `node` (`node.<name>`), or null.
 * @param {import('estree').Node & { parent?: import('estree').Node }} node
 * @returns {string | null}
 */
function memberOf(node) {
  const parent = node.parent;
  return parent?.type === 'MemberExpression' && parent.object === node ? propertyName(parent) : null;
}

/**
 * Whether a reference to `name` at `id` is one of the allowed pure forms.
 * @param {string} name
 * @param {import('estree').Identifier & { parent?: import('estree').Node }} id
 * @returns {boolean}
 */
function isAllowedUse(name, id) {
  const parent = id.parent;
  if (name === 'Date') {
    if (parent?.type === 'NewExpression' && parent.callee === id) {
      return parent.arguments.length === 1 && parent.arguments[0]?.type !== 'SpreadElement';
    }
    const member = memberOf(id);
    return member !== null && DATE_STATIC_ALLOWED.has(member);
  }
  if (name === 'Math') {
    const member = memberOf(id);
    return member !== null && member !== 'random';
  }
  return !ALWAYS_IMPURE.has(name);
}

/**
 * A readable name for the reported form: `process.env`, `crypto.getRandomValues` (through `globalThis.`),
 * `new Date()`, `Date()`, or the bare global for an alias or a destructuring.
 * @param {import('estree').Identifier & { parent?: import('estree').Node }} id
 * @returns {string}
 */
function describe(id) {
  const parent = id.parent;
  if (id.name === 'Date' && parent?.type === 'NewExpression' && parent.callee === id) return 'new Date()';
  if (id.name === 'Date' && parent?.type === 'CallExpression' && parent.callee === id) return 'Date()';
  /** @type {import('estree').Node & { parent?: import('estree').Node }} */
  let node = id;
  let head = id.name;
  const viaGlobal = GLOBAL_OBJECTS.has(id.name) ? memberOf(id) : null;
  if (viaGlobal !== null && parent !== undefined) {
    head = viaGlobal;
    node = parent;
  }
  const member = memberOf(node);
  return member === null ? head : `${head}.${member}`;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'packages/pricing is pure: no clock, randomness, environment or I/O (REQ-PRICE-001, ADR-0015).' },
    schema: [],
    messages: {
      impure:
        "'{{what}}' is not allowed in packages/pricing: the engine is pure (no clock, randomness, environment or I/O; ADR-0015). Take the value from PricingInput.",
      testImport: 'packages/pricing production code never imports a test module ({{what}}); test helpers are outside the purity rule.',
    },
  },
  create(context) {
    /**
     * @param {import('estree').Node} node
     * @param {string} what
     */
    const report = (node, what) => context.report({ node, messageId: 'impure', data: { what } });

    /**
     * @param {import('estree').Node} node
     * @param {import('estree').Node | null | undefined} source
     * @param {boolean} wholeModule the import carries every export (namespace, default, `export *`, `import()`, require)
     * @param {readonly string[]} names imported or re-exported names
     */
    const checkSource = (node, source, wholeModule, names) => {
      if (source?.type !== 'Literal' || typeof source.value !== 'string') return;
      const specifier = source.value;
      if (isIoModule(specifier)) {
        report(node, specifier);
      } else if (specifier === SHARED_ROOT) {
        if (wholeModule) report(node, `${SHARED_ROOT} (whole module)`);
        for (const name of names) if (IMPURE_SHARED_EXPORTS.has(name)) report(node, `${SHARED_ROOT} ${name}`);
      } else if (specifier.startsWith('.') && TEST_SPECIFIER.test(specifier)) {
        context.report({ node, messageId: 'testImport', data: { what: specifier } });
      }
    };

    /** @param {{ importKind?: string; exportKind?: string }} node */
    const typeOnly = (node) => node.importKind === 'type' || node.exportKind === 'type';

    return {
      ImportDeclaration(node) {
        if (typeOnly(/** @type {never} */ (node))) return;
        const specifiers = node.specifiers.filter((specifier) => !typeOnly(/** @type {never} */ (specifier)));
        const whole = specifiers.some((specifier) => specifier.type !== 'ImportSpecifier');
        const names = specifiers.flatMap((specifier) =>
          specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier' ? [specifier.imported.name] : [],
        );
        checkSource(node, node.source, whole, names);
      },
      ExportNamedDeclaration(node) {
        if (typeOnly(/** @type {never} */ (node))) return;
        const names = node.specifiers.flatMap((specifier) =>
          !typeOnly(/** @type {never} */ (specifier)) && specifier.local.type === 'Identifier' ? [specifier.local.name] : [],
        );
        checkSource(node, node.source, false, names);
      },
      ExportAllDeclaration(node) {
        if (!typeOnly(/** @type {never} */ (node))) checkSource(node, node.source, true, []);
      },
      ImportExpression(node) {
        checkSource(node, node.source, true, []);
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') checkSource(node, node.arguments[0], true, []);
      },
      'Program:exit'(node) {
        const globalScope = context.sourceCode.getScope(node);
        const references = [
          ...globalScope.through,
          ...globalScope.variables.filter((variable) => variable.defs.length === 0).flatMap((variable) => variable.references),
        ];
        for (const reference of references) {
          const id = /** @type {import('estree').Identifier & { parent?: import('estree').Node }} */ (reference.identifier);
          if (/** @type {{ isTypeReference?: boolean }} */ (reference).isTypeReference === true) continue;
          if (isAllowedUse(id.name, id)) continue;
          report(id, describe(id));
        }
      },
    };
  },
};
