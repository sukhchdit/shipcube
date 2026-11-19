/**
 * `platform/pricing-purity` (REQ-PRICE-001, ADR-0015 §6, NFR-MAINT-001; US-138 AT-US-138-02, TASK-076): the pricing
 * engine is a pure function, so `packages/pricing/src` reads no clock, no randomness, no environment and does no I/O.
 * eslint.config.mjs enables the rule for that folder only (tests excluded). Reported:
 *
 *  - the clock: `Date.now`, `Date()` and `new Date()` without an argument, `performance.now`;
 *  - randomness: `Math.random`, `crypto.randomUUID`, `crypto.getRandomValues`, `crypto.randomBytes`, `crypto.randomInt`
 *    (also through `globalThis.` / `self.` / `window.`);
 *  - the environment: `process.env`;
 *  - I/O modules: any `node:*` or Node core module, HTTP clients, database, queue and cache drivers, by static import,
 *    re-export, `import()` or `require()`. The ADR-0003 boundaries policy (allow-list: `@platform/shared` only) is the
 *    second, independent control for imports.
 *
 * Inputs carry the pricing instant (`now`) and every rate, so none of these is ever needed.
 */
import { builtinModules } from 'node:module';

const GLOBAL_OBJECTS = new Set(['globalThis', 'self', 'window', 'global']);
const RANDOM_MEMBERS = new Set(['randomUUID', 'getRandomValues', 'randomBytes', 'randomInt']);
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
 * The static property name of a member expression.
 * @param {import('estree').MemberExpression} node
 * @returns {string | null}
 */
function propertyName(node) {
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string') return node.property.value;
  return null;
}

/**
 * The global name an expression denotes: `x` or `globalThis.x` (also `self.x`, `window.x`, `global.x`).
 * @param {import('estree').Node} node
 * @returns {string | null}
 */
function globalName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && node.object.type === 'Identifier' && GLOBAL_OBJECTS.has(node.object.name)) {
    return propertyName(node);
  }
  return null;
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
     */
    const checkSource = (node, source) => {
      if (source?.type === 'Literal' && typeof source.value === 'string' && isIoModule(source.value)) report(node, source.value);
    };

    return {
      MemberExpression(node) {
        const owner = globalName(node.object);
        const name = propertyName(node);
        if (owner === null || name === null) return;
        if (
          (owner === 'Date' && name === 'now') ||
          (owner === 'Math' && name === 'random') ||
          (owner === 'performance' && name === 'now')
        ) {
          report(node, `${owner}.${name}`);
        } else if (owner === 'crypto' && RANDOM_MEMBERS.has(name)) {
          report(node, `crypto.${name}`);
        } else if (owner === 'process' && name === 'env') {
          report(node, 'process.env');
        }
      },
      'NewExpression, CallExpression'(/** @type {import('estree').NewExpression | import('estree').CallExpression} */ node) {
        if (globalName(node.callee) === 'Date' && node.arguments.length === 0) {
          report(node, node.type === 'NewExpression' ? 'new Date()' : 'Date()');
          return;
        }
        if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require') {
          checkSource(node, node.arguments[0]);
        }
      },
      ImportDeclaration(node) {
        checkSource(node, node.source);
      },
      ExportNamedDeclaration(node) {
        checkSource(node, node.source);
      },
      ExportAllDeclaration(node) {
        checkSource(node, node.source);
      },
      ImportExpression(node) {
        checkSource(node, node.source);
      },
    };
  },
};
