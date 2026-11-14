/**
 * `platform/prisma-client-construction` (PR2-SEC-05; ADR-0005 am. 10 item 2; TASK-016; PR44-SEC-01): a Prisma client
 * opens connections outside `withTenantTx` and so outside the tenant context. Reported:
 *  - a value import of `PrismaClient` or `PrismaPg` (any module), or any value import of `@prisma/adapter-pg`
 *    (static, re-export, `import()`, every require-style load: `require`, `module.require`, `createRequire` in any
 *    form, R1-m6);
 *  - a whole-module value (`names: ['*']`: a namespace import, `export *`, `import()`, a require-style load) of
 *    `@prisma/client`, `@platform/prisma/client` or a subpath: the namespace carries the constructor (PR44-SEC-01);
 *  - `new PrismaClient(…)` / `new PrismaPg(…)` (also through a namespace, `new x.PrismaClient(…)`), and `new C(…)`
 *    where `C` is a const alias of a constructor: `const C = <x>.PrismaClient`, `const { PrismaClient: C } = <x>`.
 * Type-only imports pass (`import type { PrismaClient }`). eslint.config.mjs turns the rule off for the files that
 * build the client (apps/api/src/platform/db/{client,generated,runtime}.ts), prisma/**, tools/db/** and tests; the
 * rest of apps/*\/src/platform/db (the worker's included) is in (PR44-SEC-01).
 * Residuals: an alias through more than one hop (`const A = x.PrismaClient; const B = A; new B()`), a `let` alias
 * reassigned later, a constructor handed in as a parameter (client.ts's `createDatabaseClient(Client, …)` by design).
 */
import { moduleSourceVisitor } from './module-sources.mjs';

const ADAPTER = /^@prisma\/adapter-pg(?:\/.*)?$/u;
const CLIENT_MODULE = /^@(?:prisma\/client|platform\/prisma\/client)(?:\/.*)?$/u;
const CONSTRUCTORS = new Set(['PrismaClient', 'PrismaPg']);
const HOMES = ' In platform/db only apps/api/src/platform/db/{client,generated,runtime}.ts construct or pass it (PR44-SEC-01).';

/**
 * @param {import('estree').Node} key
 * @param {boolean} computed
 * @returns {string | undefined} The property name of a non-computed identifier or a string-literal key.
 */
const keyName = (key, computed) => {
  if (!computed && key.type === 'Identifier') return key.name;
  return key.type === 'Literal' && typeof key.value === 'string' ? key.value : undefined;
};

/**
 * The constructor a const `identifier` aliases: `const C = <x>.PrismaClient` or `const { PrismaClient: C } = <x>`.
 * @param {import('eslint').SourceCode} sourceCode
 * @param {import('estree').Identifier} identifier
 * @returns {string | undefined}
 */
const aliasedConstructor = (sourceCode, identifier) => {
  /** @type {import('eslint').Scope.Scope | null} */
  let scope = sourceCode.getScope(identifier);
  let variable;
  while (scope && variable === undefined) {
    variable = scope.set.get(identifier.name);
    scope = scope.upper;
  }
  for (const def of variable?.defs ?? []) {
    if (def.type !== 'Variable') continue;
    const { id, init } = def.node;
    if (id.type === 'Identifier' && init?.type === 'MemberExpression') {
      const name = keyName(init.property, init.computed);
      if (name !== undefined && CONSTRUCTORS.has(name)) return name;
    }
    if (id.type !== 'ObjectPattern') continue;
    for (const property of id.properties) {
      if (property.type !== 'Property') continue;
      const value = property.value.type === 'AssignmentPattern' ? property.value.left : property.value;
      const name = keyName(property.key, property.computed);
      if (value === def.name && name !== undefined && CONSTRUCTORS.has(name)) return name;
    }
  }
  return undefined;
};

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Confine Prisma client construction to the database platform, prisma/, tools/db and tests (PR2-SEC-05).' },
    schema: [],
    messages: {
      importClient: `Value import of a Prisma client constructor from '{{source}}': only apps/*/src/platform/db constructs clients; use withTenantTx / TenantDb (or import type) (PR2-SEC-05).${HOMES}`,
      construct: `new {{name}}(…) outside apps/*/src/platform/db: a second client runs without tenant context; use withTenantTx / TenantDb (PR2-SEC-05).${HOMES}`,
    },
  },
  create(context) {
    const { sourceCode } = context;
    const imports = moduleSourceVisitor(({ node, source, names, typeOnly }) => {
      if (typeOnly) return;
      const namespace = CLIENT_MODULE.test(source) && names.includes('*');
      if (namespace || ADAPTER.test(source) || names.some((name) => CONSTRUCTORS.has(name))) {
        context.report({ node, messageId: 'importClient', data: { source } });
      }
    }, sourceCode);

    /**
     * @param {import('estree').NewExpression['callee']} callee
     * @returns {string | undefined} The constructor `callee` names, as written (`C (PrismaClient)` for an alias).
     */
    const constructed = (callee) => {
      if (callee.type === 'MemberExpression') {
        const name = callee.property.type === 'Identifier' ? callee.property.name : keyName(callee.property, callee.computed);
        return name !== undefined && CONSTRUCTORS.has(name) ? name : undefined;
      }
      if (callee.type !== 'Identifier') return undefined;
      if (CONSTRUCTORS.has(callee.name)) return callee.name;
      const aliased = aliasedConstructor(sourceCode, callee);
      return aliased === undefined ? undefined : `${callee.name} (${aliased})`;
    };

    return {
      ...imports,
      NewExpression(node) {
        const name = constructed(node.callee);
        if (name !== undefined) context.report({ node, messageId: 'construct', data: { name } });
      },
    };
  },
};
