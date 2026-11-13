/**
 * `platform/tenant-context-sql` (ADR-0005 am. 10 items 1 and 4; AT-US-075-03; TASK-016): the tenant request context
 * is set in exactly one place, `withTenantTx`, with the transaction-local setter. Source text (string and template
 * literals) is checked for five forms; each is an error unless the file's `allow` option lists it:
 *  - `setter`: the setter function name (a writer of the context; PR11-SEC-08 split it from `keys`, so a file that
 *    only reads the keys cannot also become a second, transaction-local writer);
 *  - `keys`: one of the four security keys of the context (`app.` + org_id, actor_id, actor_scope, guest_token_hash),
 *    in every quoting and spacing PostgreSQL accepts (`"app"."org_id"`, `app . org_id`, `"app.org_id"`);
 *  - `session-set`: `SET [SESSION|LOCAL]` or `RESET` of an `app.` setting, in every quoting and spacing (a session
 *    value outlives the transaction and leaks to the next checkout of the pooled connection; a session or local one
 *    inside the transaction re-scopes the rest of it; neither takes a bind parameter);
 *  - `session-set-config`: the setter with `is_local = false` (same leak), unless its key is a literal outside `app.`;
 *  - `unicode-escape`: a `U&'…'` string or `U&"…"` identifier (PR11-SEC-17): `U&"\0061pp".org_id` spells a key or the
 *    setter in escapes that no other form can see.
 * PR11-SEC-17: each text is matched as written AND with its SQL comments stripped (`/* … *\/` becomes one space,
 * `-- …` is removed to the end of the line, as PostgreSQL reads them), so `SET/**\/app.org_id` is the `session-set`
 * form; matching both texts keeps a `--` inside a string literal from hiding the rest of its line.
 * `session-set`, `keys` and `unicode-escape` are the TypeScript twins of `CONTEXT_WRITE_FORMS[1]`,
 * `CONTEXT_READ_FORMS[0]` and `CONTEXT_WRITE_FORMS[5]` in tools/db/tenant-key-forms.ts (R2-m2);
 * tools/lint/tenant-context-forms-drift.test.ts runs one probe corpus through both, so the twins cannot drift apart
 * silently. The per-file exemptions live in eslint.config.mjs (TENANT_CONTEXT_EXEMPTIONS), one entry per exact file.
 * The patterns are regular-expression literals so that this module itself carries none of the banned text.
 */
import { stringTextVisitor } from './string-literals.mjs';

/**
 * Checked in this order; the first form the file does not allow is reported. Exported for the drift test.
 * @type {readonly { form: 'session-set-config' | 'session-set' | 'setter' | 'keys' | 'unicode-escape'; pattern: RegExp }[]}
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
  { form: 'unicode-escape', pattern: /\bu&["']/iu },
];

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//gu;
const LINE_COMMENT = /--[^\n]*/gu;

/**
 * The texts a form is matched against: the text as written and, when it differs, the text with its SQL comments
 * stripped (block comments become one space, line comments are removed). Exported for the drift test.
 * @param {string} text
 * @returns {string[]}
 */
export function textVariants(text) {
  const stripped = text.replace(BLOCK_COMMENT, ' ').replace(LINE_COMMENT, '');
  return stripped === text ? [text] : [text, stripped];
}

/**
 * True when `pattern` matches `text` as written or comment-stripped. Exported for the drift test.
 * @param {RegExp} pattern
 * @param {string} text
 */
export const matchesForm = (pattern, text) => textVariants(text).some((variant) => pattern.test(variant));

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
      'unicode-escape':
        'Unicode-escape SQL string or identifier (U& followed by a quote): it can spell a tenant-context key or the setter that no other form sees; write the text plainly (ADR-0005 am. 10 item 4, PR11-SEC-17).',
    },
  },
  create(context) {
    const options = /** @type {{ allow?: string[] } | undefined} */ (context.options[0]);
    const allowed = new Set(options?.allow ?? []);
    return stringTextVisitor((node, text) => {
      const hit = FORMS.find(({ form, pattern }) => !allowed.has(form) && matchesForm(pattern, text));
      if (hit) context.report({ node, messageId: hit.form });
    });
  },
};
