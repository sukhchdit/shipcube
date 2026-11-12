/**
 * `platform/prisma-client-construction` (PR2-SEC-05; ADR-0005 am. 10 item 2; TASK-016): a Prisma client opens
 * connections outside `withTenantTx` and so outside the tenant context. Reported:
 *  - a value import of `PrismaClient` or `PrismaPg` (any module), or any value import of `@prisma/adapter-pg`
 *    (static, re-export, `import()`, `require`);
 *  - `new PrismaClient(…)` / `new PrismaPg(…)` (also through a namespace, `new x.PrismaClient(…)`).
 * Type-only imports pass (`import type { PrismaClient }`). eslint.config.mjs turns the rule off for
 * apps/*\/src/platform/db/**, prisma/**, tools/db/** and tests.
 */
import { moduleSourceVisitor } from './module-sources.mjs';

const ADAPTER = /^@prisma\/adapter-pg(?:\/.*)?$/u;
const CONSTRUCTORS = new Set(['PrismaClient', 'PrismaPg']);

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Confine Prisma client construction to the database platform, prisma/, tools/db and tests (PR2-SEC-05).' },
    schema: [],
    messages: {
      importClient:
        "Value import of a Prisma client constructor from '{{source}}': only apps/*/src/platform/db constructs clients; use withTenantTx / TenantDb (or import type) (PR2-SEC-05).",
      construct:
        'new {{name}}(…) outside apps/*/src/platform/db: a second client runs without tenant context; use withTenantTx / TenantDb (PR2-SEC-05).',
    },
  },
  create(context) {
    const imports = moduleSourceVisitor(({ node, source, names, typeOnly }) => {
      if (typeOnly) return;
      if (ADAPTER.test(source) || names.some((name) => CONSTRUCTORS.has(name))) {
        context.report({ node, messageId: 'importClient', data: { source } });
      }
    });
    return {
      ...imports,
      NewExpression(node) {
        const { callee } = node;
        const name =
          callee.type === 'Identifier'
            ? callee.name
            : callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
              ? callee.property.name
              : undefined;
        if (name !== undefined && CONSTRUCTORS.has(name)) context.report({ node, messageId: 'construct', data: { name } });
      },
    };
  },
};
