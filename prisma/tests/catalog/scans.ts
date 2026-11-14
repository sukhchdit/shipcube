/**
 * Pure scanners for the catalog suite (data-model.md §4.6 C3, C9 and the C-series prosrc scan; ADR-0005 am. 10 items
 * 1 and 7; data-model §8.3 rule 16; PR7-SEC-07, PR7-SEC-11, PR11-SEC-02, PR11-SEC-03, D-ARCH-065; TASK-016). They read
 * rows the suite selects from pg_policy / pg_proc / pg_constraint and return one finding per violation, so a failing
 * assertion names the object.
 */
import { sqlText } from '../../../tools/db/sql-text.js';
import { CONTEXT_DISCARD, contextReads, contextWrites } from '../../../tools/db/tenant-key-forms.js';

/** A row of the C3 policy query (`pg_get_expr` output under search_path pg_catalog, pg_temp). */
export interface PolicyRow {
  readonly table: string;
  readonly policy: string;
  readonly cmd: string;
  readonly roles: readonly string[];
  readonly permissive: boolean;
  readonly qual: string | null;
  readonly with_check: string | null;
}

/** The deparsed operator-scope atom of the §4.3 operator template, the only allowed raw current_setting( in a policy. */
export const OPERATOR_SCOPE_DEPARSED = "current_setting('app.actor_scope'::text, true) = 'OPERATOR'::text";

const FORBIDDEN_IN_POLICY: readonly (readonly [string, RegExp])[] = [
  ['IS [NOT] DISTINCT FROM', /\bIS\s+(?:NOT\s+)?DISTINCT\s+FROM\b/i],
  ['coalesce', /\bcoalesce\s*\(/i],
  ['<>', /<>/],
  ['!=', /!=/],
  ['NOT', /\bNOT\b/i],
  ['OR', /\bOR\b/i],
  ['raw current_setting(', /\bcurrent_setting\s*\(/i],
];

/**
 * The keyed atoms of the §4.3 templates (deparsed, schema-qualified; a same-named function in another schema does not
 * count). Every platform_app USING / WITH CHECK must reference one, so `org_id = org_id`, `org_id IS NULL` and `1 = 1`
 * are refused (PR11-SEC-03).
 */
const KEYED_ATOM = /(?<![\w".])platform\.app_(?:org_id|actor_id|guest_token_hash|is_operator)\(\)/;

/**
 * C3: forbidden tokens in every policy expression, USING (true) for platform_app, a platform_app clause without a
 * keyed atom, policies for the migrator or PUBLIC, and platform_definer policies outside the definer tables (manifest
 * flags definerRead/definerPurge).
 */
export function scanPolicies(rows: readonly PolicyRow[], definerTables: ReadonlySet<string>): string[] {
  const findings: string[] = [];
  for (const row of rows) {
    const name = `${row.table}.${row.policy}`;
    const forApp = row.roles.includes('platform_app');
    for (const [clause, expression] of [
      ['USING', row.qual],
      ['WITH CHECK', row.with_check],
    ] as const) {
      if (expression === null) continue;
      const text = expression.split(OPERATOR_SCOPE_DEPARSED).join(' ');
      for (const [token, pattern] of FORBIDDEN_IN_POLICY) {
        if (pattern.test(text)) findings.push(`${name} ${clause}: ${token}`);
      }
      if (forApp && !KEYED_ATOM.test(expression)) findings.push(`${name} ${clause}: no keyed context atom`);
    }
    if (forApp && row.qual === 'true') findings.push(`${name}: USING (true) for platform_app`);
    if (row.roles.includes('platform_migrator') || row.roles.includes('public')) findings.push(`${name}: targets ${row.roles.join(',')}`);
    if (row.roles.includes('platform_definer') && !definerTables.has(row.table))
      findings.push(`${name}: platform_definer policy outside the definer tables`);
    if (!row.permissive) findings.push(`${name}: RESTRICTIVE policies are not rendered by the templates`);
  }
  return findings;
}

/**
 * C3 DR-A14 invariants (data-model §4.3 as amended 2026-11-13; PR11-SEC-10 requirement 5; D-ARCH-072): a `memberships`
 * policy holds no subquery (a memberships policy reading another RLS table recurses, 42P17); every subquery of a
 * `users` / `organisations` policy reads `public.memberships` only; an `IN (…)` list (deparsed `= ANY (ARRAY[…])`)
 * appears only on `m.status`. The deny-list and keyed-atom checks of {@link scanPolicies} run on the same rows.
 */
export function drA14Findings(rows: readonly PolicyRow[]): string[] {
  const findings: string[] = [];
  for (const row of rows) {
    for (const [clause, expression] of [
      ['USING', row.qual],
      ['WITH CHECK', row.with_check],
    ] as const) {
      if (expression === null) continue;
      const name = `${row.table}.${row.policy} ${clause}`;
      if (row.table === 'memberships' && /\bSELECT\b/i.test(expression)) findings.push(`${name}: subquery in a memberships policy (42P17)`);
      if (row.table === 'users' || row.table === 'organisations') {
        for (const match of expression.matchAll(/\bFROM\s+([\w".]+)/gi)) {
          if (match[1] !== 'public.memberships') findings.push(`${name}: subquery reads ${match[1] ?? ''}, not public.memberships`);
        }
      }
      for (const match of expression.matchAll(/([\w".]+)\s*=\s*ANY\s*\(/gi)) {
        if (match[1] !== 'm.status') findings.push(`${name}: IN list on ${match[1] ?? ''}, allowed only on m.status`);
      }
    }
  }
  return findings;
}

/** A row of the prosrc query. */
export interface FunctionRow {
  readonly fn: string;
  readonly prosrc: string;
}

/** The §4.2 helpers, by regprocedure text (search_path pg_catalog, pg_temp). */
export const CONTEXT_HELPERS: ReadonlySet<string> = new Set([
  'platform.app_org_id()',
  'platform.app_actor_id()',
  'platform.app_guest_token_hash()',
  'platform.app_is_operator()',
]);

/**
 * The scan text of a function body, built by the SAME function as linter rule 16 (`sqlText(…, true)` in
 * tools/db/sql-text.ts; PR #11 review R2-n1): every comment becomes one space, so `SET app/**\/.org_id` and
 * `set_config/**\/(…)` read as the forms they are; string literals are KEPT (dynamic SQL counts); nested
 * dollar-quoted bodies are expanded recursively. A body that does not lex is scanned verbatim (fail closed).
 */
export function bodyText(source: string): string {
  try {
    return sqlText(source, true);
  } catch {
    return source;
  }
}

/**
 * C-series prosrc scan: by form, in every non-system namespace (ADR-0005 am. 10 item 1, D-ARCH-065), with the one form
 * list shared with migration-linter rule 16 (tools/db/tenant-key-forms.ts; PR11-SEC-02, review m1). Write forms and
 * DISCARD apply to every body, the §4.2 helpers included; read forms to every function except the helpers, matched by
 * regprocedure. The comment-stripped body is scanned (bodyText), string literals included, so dynamic SQL counts.
 */
export function scanFunctionBodies(rows: readonly FunctionRow[]): string[] {
  const findings: string[] = [];
  for (const row of rows) {
    const text = bodyText(row.prosrc);
    const forms = contextWrites(text);
    if (CONTEXT_DISCARD.test(text)) forms.push('DISCARD');
    if (!CONTEXT_HELPERS.has(row.fn)) forms.push(...contextReads(text));
    findings.push(...forms.map((form) => `${row.fn}: ${form}`));
  }
  return findings;
}

/** A row of the C9 query: a CHECK constraint whose definition holds an `= ANY (ARRAY[…])` list. */
export interface CheckRow {
  readonly conname: string;
  readonly def: string;
}

/**
 * C9: the value lists of the enum-like CHECKs (a single `col IN (…)`, deparsed as `= ANY (ARRAY[…])`, with no AND/OR
 * around it), by constraint name, values sorted. Mixed predicates such as `ck_permissions__key_format` are not enums.
 */
export function enumCheckValues(rows: readonly CheckRow[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const row of rows.filter((r) => !/\b(?:AND|OR)\b/.test(r.def))) {
    result[row.conname] = [...row.def.matchAll(/'((?:[^']|'')*)'::/g)].map((match) => (match[1] ?? '').replaceAll("''", "'")).sort();
  }
  return result;
}
