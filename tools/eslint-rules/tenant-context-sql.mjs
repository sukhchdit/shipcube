/**
 * `platform/tenant-context-sql` (ADR-0005 am. 10 items 1 and 4; AT-US-075-03; TASK-016): the tenant request context
 * is set in exactly one place, `withTenantTx`, with the transaction-local setter. Source text (string and template
 * literals) is checked for four forms; each is an error unless the file's `allow` option lists it:
 *  - `setter`: the setter function name (a writer of the context; PR11-SEC-08 split it from `keys`, so a file that
 *    only reads the keys cannot also become a second, transaction-local writer);
 *  - `keys`: one of the four security keys of the context (`app.` + org_id, actor_id, actor_scope, guest_token_hash),
 *    in every quoting and spacing PostgreSQL accepts (`"app"."org_id"`, `app . org_id`, `"app.org_id"`);
 *  - `session-set`: `SET [SESSION|LOCAL]` or `RESET` of an `app.` setting, in every quoting and spacing (a session
 *    value outlives the transaction and leaks to the next checkout of the pooled connection; a session or local one
 *    inside the transaction re-scopes the rest of it; neither takes a bind parameter);
 *  - `session-set-config`: the setter with `is_local = false` (same leak), unless its key is a literal outside `app.`.
 * `session-set` and `keys` are the TypeScript twins of `CONTEXT_WRITE_FORMS[1]` and `CONTEXT_READ_FORMS[0]` in
 * tools/db/tenant-key-forms.ts (R2-m2); tools/lint/tenant-context-forms-drift.test.ts runs one probe corpus through
 * both, so the twins cannot drift apart silently. The per-file exemptions live in eslint.config.mjs
 * (TENANT_CONTEXT_EXEMPTIONS), one entry per exact file. The patterns are regular-expression literals so that this
 * module itself carries none of the banned text.
 */
import { stringTextVisitor } from './string-literals.mjs';

/**
 * Checked in this order; the first form the file does not allow is reported. Exported for the drift test.
 * @type {readonly { form: 'session-set-config' | 'session-set' | 'setter' | 'keys'; pattern: RegExp }[]}
 */
export const FORMS = [
  { form: 'session-set-config', pattern: /set_config\s*\(\s*(?!'(?!app\.)[^']*'\s*,)[^;]*?,\s*false\s*\)/iu },
  { form: 'session-set', pattern: /\b(?:set|reset)\s+(?:(?:session|local)\s+)?(?:"app"\s*\.|app\s*\.|"app\.)/iu },
  { form: 'setter', pattern: /set_config/iu },
  {
    form: 'keys',
    pattern:
      /(?:"app"|\bapp)\s*\.\s*"?(?:org_id|actor_id|actor_scope|guest_token_hash)\b|"app\.(?:org_id|actor_id|actor_scope|guest_token_hash)"/iu,
  },
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
        'Session-level SET/RESET (or SET LOCAL) of a tenant-context setting: a session value leaks across pooled connections, a local one re-scopes the rest of the transaction, and neither takes a bind parameter; only withTenantTx sets the context (ADR-0005 am. 10 items 1 and 4, AT-US-075-03, R2-m2).',
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
