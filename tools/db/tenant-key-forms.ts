/**
 * The one list of tenant-context SQL forms shared by migration-linter rule 16 (`tools/db/lint-migrations.ts`) and the
 * C-series `prosrc` scan (`prisma/tests/catalog/scans.ts`) (ADR-0005 am. 10 item 1 (i)/(ii); data-model §8.3 rule 16;
 * PR11-SEC-02, PR #11 review m1; TASK-016).
 *
 * Every pattern is case-insensitive and whitespace-tolerant, so it works on raw `pg_proc.prosrc` text and on the
 * linter's lowercased, whitespace-collapsed text alike. Callers pass text WITH string literals kept (dynamic SQL
 * counts), except where noted. GUC names are case-insensitive and `var_name` accepts quoted parts (`gram.y`), so the
 * namespace is matched as `app.`, `"app".`, `"app.…"` and `app . ` alike.
 *
 * The patterns are regular-expression literals and the labels avoid the banned text, so this module needs no
 * `platform/tenant-context-sql` exemption.
 *
 * Stated limits (PR11-SEC-14, PR11-SEC-15, PR #11 review R2-n2; data-model §8.3 "Limits"). The list is lexical: it
 * names forms, it does not evaluate SQL. It cannot see
 *  - a setter whose function name and key are both built in `format()` or by concatenation;
 *  - keyword-split dynamic SQL (`'SET' || ' LOCAL ' || 'app.' || 'org_id'`, `format('%s %s = %L', 'SET LOCAL', …)`);
 *  - `EXECUTE` of a computed statement (a statement read from a table, `chr()`-built text, a variable);
 *  - a read through `pg_show_all_settings()`.
 * `U&` Unicode escapes are refused outright (write form below), so escaped identifiers and strings cannot hide a key.
 * The outcome controls for the rest are the C11 converse (platform_definer owns only allow-listed objects) and the
 * withTenantTx leak check at checkout (ADR-0005 am. 10 item 16). Follow-ups: a reviewed dynamic-SQL allow-list for
 * `EXECUTE` in function bodies (C-series and rule 16) is TASK-024; rule 10 over DO bodies whose `EXECUTE` operand is
 * not a literal is TASK-021.
 */

/** A labelled pattern: the label names the form in a finding. */
export type ContextForm = readonly [label: string, pattern: RegExp];

/**
 * Write forms: forbidden in every function body (the §4.2 helpers included) and in every migration statement.
 *  - the context setter function (`set_config`, also quoted or schema-qualified) unless its first argument is ONE
 *    complete plain literal naming a non-`app.` setting, directly followed by a comma (`'' || 'app.org_id'`,
 *    `E'…'`, `'ap' 'p.org_id'` and every computed key are refused);
 *  - `SET [SESSION|LOCAL] app.…` / `RESET app.…` in every quoting and spacing;
 *  - a dynamic `SET`/`RESET` whose name is built at run time (`format('SET LOCAL %I …')`, `'SET LOCAL ' || k`);
 *  - `RESET ALL`;
 *  - `pg_settings` (an `UPDATE pg_catalog.pg_settings` is the setter in another form);
 *  - any `U&'…'` string or `U&"…"` identifier (PR11-SEC-14 a): `U&"\0061pp".org_id` and `U&'SET LOCAL \0061pp.…'`
 *    spell every form above without its text. No migration needs Unicode escapes, so the escape itself is refused.
 *    (`u &'…'`, with a space, is the `&` operator, not an escape, and is not matched.)
 */
export const CONTEXT_WRITE_FORMS: readonly ContextForm[] = [
  ['context setter with an app. or computed key', /\bset_config"?\s*\(\s*(?!'(?!app\.)[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?'\s*,)/i],
  ['SET/RESET of an app. setting', /\b(?:set|reset)\s+(?:(?:session|local)\s+)?(?:"app"\s*\.|app\s*\.|"app\.)/i],
  ['dynamic SET/RESET (name built at run time)', /\b(?:set|reset)\s+(?:(?:session|local)\s+)?(?:%|')/i],
  ['RESET ALL', /\breset\s+all\b/i],
  ['pg_settings', /\bpg_settings\b/i],
  ['Unicode-escape string or identifier', /\bu&["']/i],
];

/**
 * `DISCARD`: resets every session setting. The linter matches it on text WITHOUT string literals (the word is common
 * prose in messages); the C-series scan on the whole body.
 */
export const CONTEXT_DISCARD: RegExp = /\bdiscard\s+(?:all|plans|sequences|temp|temporary)\b/i;

/** The four security keys of the request context (data-model §4.1); `app.correlation_id` is not one of them. */
export const SECURITY_KEY_NAMES = ['org_id', 'actor_id', 'actor_scope', 'guest_token_hash'] as const;

/**
 * Read forms: forbidden outside the §4.2 helper definitions (`platform.app_org_id()`, `app_actor_id()`,
 * `app_guest_token_hash()`, `app_is_operator()`):
 *  - any mention of a security key, in any quoting or spacing (catches `current_setting('app.org_id')`, `SHOW`,
 *    `format('%I', 'app.org_id')`, `pg_settings` lookups);
 *  - a settings read whose first argument is not one complete plain literal followed by `,` or `)` (a computed key
 *    such as `'app.' || 'org_id'`, or a variable).
 * The renderer's operator-scope atom is the one sanctioned read outside the helpers; consumers exempt exactly that
 * text inside a `CREATE POLICY` (linter) or its deparsed form (C3), never more (PR11-SEC-03).
 */
export const CONTEXT_READ_FORMS: readonly ContextForm[] = [
  [
    'mentions a tenant security key',
    /(?:"app"|\bapp)\s*\.\s*"?(?:org_id|actor_id|actor_scope|guest_token_hash)\b|"app\.(?:org_id|actor_id|actor_scope|guest_token_hash)"/i,
  ],
  ['settings read with a computed key', /\bcurrent_setting"?\s*\(\s*(?!'[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?'\s*[,)])/i],
];

/** Labels of the write forms found in `text` (string literals kept). */
export function contextWrites(text: string): string[] {
  return CONTEXT_WRITE_FORMS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

/** Labels of the read forms found in `text` (string literals kept); callers skip the §4.2 helper definitions. */
export function contextReads(text: string): string[] {
  return CONTEXT_READ_FORMS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}
