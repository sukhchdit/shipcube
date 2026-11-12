/**
 * `platform/audit-writer-allowlist` (REQ-AUDIT-001, ADR-0003, ADR-0007): audit entries are written by the middleware
 * driven by the route's audit descriptor, so feature code never imports the audit writer. The allow-list (the audit
 * package itself and its callers: auth events, system jobs, config changes, the state machine) lives in
 * eslint.config.mjs, which turns this rule off for those files. Type-only imports are not capabilities and pass.
 *
 * The writer is recognised by module specifier (`@platform/audit/writer`, a relative path ending `audit/src/writer`)
 * or by importing one of the writer exports from `@platform/audit`.
 */
import { moduleSourceVisitor } from './module-sources.mjs';

const DEFAULT_WRITER_EXPORTS = ['AuditWriter', 'createAuditWriter', 'writeAuditEntry'];
const WRITER_MODULE = /^@platform\/audit\/(?:.+\/)?writer(?:\.js)?$|(?:^|\/)audit\/src\/writer(?:\.[jt]s)?$/u;

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow importing the audit writer outside the allow-listed modules (REQ-AUDIT-001).' },
    schema: [
      {
        type: 'object',
        properties: { writerExports: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: {
      writerImport:
        "Importing the audit writer ('{{source}}') is allowed only in the audit-writer allow-list; audit entries are written by the route audit middleware (REQ-AUDIT-001).",
    },
  },
  create(context) {
    const options = /** @type {{ writerExports?: string[] } | undefined} */ (context.options[0]);
    const writerExports = new Set(options?.writerExports ?? DEFAULT_WRITER_EXPORTS);

    return moduleSourceVisitor(({ node, source, names, typeOnly }) => {
      if (typeOnly) return;
      const isWriter =
        WRITER_MODULE.test(source) || (source === '@platform/audit' && names.some((name) => name === '*' || writerExports.has(name)));
      if (isWriter) context.report({ node, messageId: 'writerImport', data: { source } });
    });
  },
};
