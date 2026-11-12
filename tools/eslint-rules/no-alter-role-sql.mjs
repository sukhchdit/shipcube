/**
 * `platform/no-alter-role-sql` (ADR-0005 am. 10 item 12 (d), PR7-SEC-06; TASK-016): application code never alters
 * role defaults. Any role may `ALTER ROLE <self> SET` its own USERSET defaults, so the platform_app defaults are not a
 * boundary; the bootstrap lane owns them and the readiness check reports drift. Reports string and template literals
 * containing `ALTER ROLE` or `ALTER USER` (case-insensitive). Scoped to apps/*\/src and packages/*\/src (tests
 * excluded) by eslint.config.mjs.
 */
import { stringTextVisitor } from './string-literals.mjs';

const ALTER_ROLE = /\balter\s+(?:role|user)\b/iu;

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid ALTER ROLE / ALTER USER text in application code (ADR-0005 am. 10 item 12).' },
    schema: [],
    messages: {
      alterRole:
        'ALTER ROLE / ALTER USER in application code: role defaults belong to the bootstrap lane (prisma/bootstrap) and are checked for drift at readiness (ADR-0005 am. 10 item 12).',
    },
  },
  create(context) {
    return stringTextVisitor((node, text) => {
      if (ALTER_ROLE.test(text)) context.report({ node, messageId: 'alterRole' });
    });
  },
};
