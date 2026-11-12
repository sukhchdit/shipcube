/**
 * Pure scanners for the catalog suite (data-model.md §4.6 C3 and the C-series prosrc scan; ADR-0005 am. 10 items 1
 * and 7; data-model §8.3 rule 16; PR7-SEC-07, PR7-SEC-11, D-ARCH-065; TASK-016). They read rows the suite selects from
 * pg_policy / pg_proc and return one finding per violation, so a failing assertion names the object.
 */

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
 * C3: forbidden tokens in every policy expression, USING (true) for platform_app, policies for the migrator or PUBLIC,
 * and platform_definer policies outside the definer tables (manifest flags definerRead/definerPurge).
 */
export function scanPolicies(rows: readonly PolicyRow[], definerTables: ReadonlySet<string>): string[] {
  const findings: string[] = [];
  for (const row of rows) {
    const name = `${row.table}.${row.policy}`;
    for (const [clause, expression] of [
      ['USING', row.qual],
      ['WITH CHECK', row.with_check],
    ] as const) {
      if (expression === null) continue;
      const text = expression.split(OPERATOR_SCOPE_DEPARSED).join(' ');
      for (const [token, pattern] of FORBIDDEN_IN_POLICY) {
        if (pattern.test(text)) findings.push(`${name} ${clause}: ${token}`);
      }
    }
    if (row.roles.includes('platform_app') && row.qual === 'true') findings.push(`${name}: USING (true) for platform_app`);
    if (row.roles.includes('platform_migrator') || row.roles.includes('public')) findings.push(`${name}: targets ${row.roles.join(',')}`);
    if (row.roles.includes('platform_definer') && !definerTables.has(row.table))
      findings.push(`${name}: platform_definer policy outside the definer tables`);
    if (!row.permissive) findings.push(`${name}: RESTRICTIVE policies are not rendered by the templates`);
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

/** Write forms (rule 16 (i)): forbidden in every function, helpers included. */
const WRITE_FORMS: readonly (readonly [string, RegExp])[] = [
  // any set_config( whose first argument is not a literal key outside app.* (dynamic keys are refused too)
  ['set_config( with an app. key', /\bset_config\s*\(\s*(?!'(?!app\.)[^']*')/i],
  ['SET app.', /\bSET\s+(?:SESSION\s+|LOCAL\s+)?"?app\./i],
  ['RESET app./RESET ALL', /\bRESET\s+(?:"?app\.|ALL\b)/i],
  ['DISCARD', /\bDISCARD\b/i],
];
/** Reads of the four security keys (rule 16 (ii)); app.correlation_id and other literal keys stay allowed. */
const SECURITY_KEY_READ = /\bcurrent_setting\s*\(\s*(?!'(?!app\.(?:org_id|actor_id|actor_scope|guest_token_hash)')[^']*')/i;

/** C-series prosrc scan: by form, in every non-system namespace (ADR-0005 am. 10 item 1, D-ARCH-065). */
export function scanFunctionBodies(rows: readonly FunctionRow[]): string[] {
  const findings: string[] = [];
  for (const row of rows) {
    for (const [form, pattern] of WRITE_FORMS) {
      if (pattern.test(row.prosrc)) findings.push(`${row.fn}: ${form}`);
    }
    if (!CONTEXT_HELPERS.has(row.fn) && SECURITY_KEY_READ.test(row.prosrc)) {
      findings.push(`${row.fn}: reads a security key outside the §4.2 helpers`);
    }
  }
  return findings;
}
