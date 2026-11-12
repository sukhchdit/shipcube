/**
 * `platform/tenant-context-sql` (ADR-0005 am. 10 items 1 and 4; AT-US-075-03; TASK-016): the tenant request context
 * is set in exactly one place, `withTenantTx`, with the transaction-local setter. Source text (string and template
 * literals) is checked for four forms; each is an error unless the file's `allow` option lists it:
 *  - `setter`: the setter function name (a writer of the context; PR11-SEC-08 split it from `keys`, so a file that
 *    only reads the keys cannot also become a second, transaction-local writer);
 *  - `keys`: one of the four security keys of the context (`app.` + org_id, actor_id, actor_scope, guest_token_hash);
 *  - `session-set`: a session-level `SET [SESSION] app.…` or `RESET app.…` (the value outlives the transaction and
 *    leaks to the next checkout of the pooled connection);
 *  - `session-set-config`: the setter with `is_local = false` (same leak), unless its key is a literal outside `app.`.
 * The per-file exemptions live in eslint.config.mjs (TENANT_CONTEXT_EXEMPTIONS), one entry per exact file. The
 * patterns are regular-expression literals so that this module itself carries none of the banned text.
 */
import { stringTextVisitor } from './string-literals.mjs';

/** Checked in this order; the first form the file does not allow is reported. */
const FORMS = [
  { form: 'session-set-config', pattern: /set_config\s*\(\s*(?!'(?!app\.)[^']*'\s*,)[^;]*?,\s*false\s*\)/iu },
  { form: 'session-set', pattern: /\b(?:set\s+(?:session\s+)?|reset\s+)app\./iu },
  { form: 'setter', pattern: /set_config/iu },
  { form: 'keys', pattern: /app\.(?:org_id|actor_id|actor_scope|guest_token_hash)\b/iu },
];

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Confine tenant-context SQL to withTenantTx and its exact-file test exemptions (ADR-0005 am. 10).' },
    schema: [
      {
        type: 'object',
        properties: {
          allow: { type: 'array', items: { enum: FORMS.map(({ form }) => form) }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      'session-set-config':
        'Session-scoped context setter (is_local = false): the value leaks to the next checkout of the pooled connection; only withTenantTx sets the context, transaction-local (ADR-0005 am. 10 item 4).',
      'session-set':
        'Session-level SET/RESET of a tenant-context key: it leaks across pooled connections and cannot take a bind parameter; only withTenantTx sets the context (ADR-0005 am. 10 items 1 and 4, AT-US-075-03).',
      setter:
        'Tenant-context setter outside withTenantTx: only withTenantTx writes the context; go through withTenantTx / TenantDb; exemptions are exact files in eslint.config.mjs (ADR-0005 am. 10 item 1, PR11-SEC-08).',
      keys: 'Tenant-context security key outside withTenantTx: go through withTenantTx / TenantDb; exemptions are exact files in eslint.config.mjs (ADR-0005 am. 10 item 1).',
    },
  },
  create(context) {
    const options = /** @type {{ allow?: string[] } | undefined} */ (context.options[0]);
    const allowed = new Set(options?.allow ?? []);
    return stringTextVisitor((node, text) => {
      const hit = FORMS.find(({ form, pattern }) => !allowed.has(form) && pattern.test(text));
      if (hit) context.report({ node, messageId: hit.form });
    });
  },
};
