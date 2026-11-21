/**
 * Catalog C16 and P9-CK: the queries, exception maps and finding rules (data-model §4.6 C16, §4.7; D-ARCH-154,
 * D-SEC-PR65-01 / PR65-SEC-01; PR #66 code review R1-n2, D-SEC-PR66-02; TASK-293; amended by TASK-051 for R-ARCH-34:
 * rulings/wave-1-r-arch-34-operator-rulings.md §2.6 and §8.1 to §8.3, D-ARCH-162, D-ARCH-163, D-ARCH-207 to D-ARCH-209,
 * ADR-0005 amendment 14 items 31 to 33 and amendment 15 item 38). Kept free of the Testcontainers harness so the same
 * SQL can be probed outside Jest; c16-tenant-keys.int.test.ts runs it against PostgreSQL 18 and tenant-keys.test.ts
 * drives the finding rules with row fixtures.
 *
 * C16 (a) tenant-bound references. PostgreSQL runs referential-integrity checks without row security, so a
 * single-column key between two organisation-keyed tables accepts a row of organisation A naming a row of B and answers
 * "does this id exist in any tenant" (§4.7). Scope: every foreign key in `public` whose referencing and referenced
 * tables both have an `org_id` column. A key is ORG-BOUND when `org_id` is a key column on both sides at the same
 * position, and GUEST-BOUND when `guest_token_hash` is. Its REST is the column-to-column mapping of its other key
 * columns. The rules:
 *  - T1, referencing `org_id` NOT NULL: the key is org-bound.
 *  - T2-N, referencing `org_id` nullable and no `guest_token_hash`: org-bound, or an org-bound sibling of the same table
 *    pair with the same rest sits beside it (D-ARCH-154 as it was; no instance yet).
 *  - T2-G, the referencing table has `guest_token_hash` (GUEST_CAPABLE): the key is org-bound or guest-bound and any
 *    other key is reported, a single-column key included; a key that holds both owner columns is reported and is the
 *    sibling of no key (MATCH SIMPLE skips it on every row the owner CHECK admits; D-ARCH-207); a guest-bound key needs
 *    an org-bound sibling with the same rest, and an org-bound key needs a guest-bound sibling with the same rest or an
 *    entry in TENANT_REFERENCE_EXCEPTIONS (T2-O). A sibling is another key of the same table pair, never the key itself.
 *  - T2-O entry (D-ARCH-209): it names the key, its CHECK and the reason. It hides the key only when the key is reported
 *    as org-bound without a guest-bound sibling, its referencing columns are `org_id` and exactly one other column c,
 *    and the named constraint of the referencing table is a validated CHECK whose definition is exactly
 *    orgOnlyCheckDefinition(c). Otherwise the key stays reported and the entry is reported as well.
 *
 * C16 (b) owner-scoped unique keys (PR65-SEC-01, D-ARCH-163). A unique index is checked while the index tuple is
 * inserted, before the statement-end foreign-key check, so a unique key without an owner column answers questions about
 * other owners' rows (`23505` against `23503`) and lets a foreign row block them. Scope: the TENANT and GUEST_CAPABLE
 * tables of the manifests that have an `org_id` column. Read: every non-primary index with `indisunique OR
 * indisexclusion`. An owner column (`org_id`, or `guest_token_hash` where the table has it; INCLUDE columns and
 * expressions do not count) COUNTS only when it separates owners (D-ARCH-208): B1, it is NOT NULL or the index is
 * NULLS DISTINCT (a nullable owner column under NULLS NOT DISTINCT makes every row of the other owner class one owner);
 * B2, in an exclusion constraint, its operator is the equality member of a btree operator family (`org_id WITH <>`
 * conflicts only across owners). Finding: no owner column counts. An exception entry (a listed globally unique digest)
 * applies only to an index with no owner key column at all; an index whose owner column does not count is always
 * reported. `UNIQUE NULLS NOT DISTINCT` over both owner columns is reported too (fail closed; U2 asks for two indexes).
 *
 * Every exception entry of both arms must be live: it names a key that exists and that the rule would otherwise report,
 * so a map entry can neither hide a compliant key nor outlive the key it was written for.
 *
 * Stated limits (rulings §2.6): index and constraint predicates are not compared (a partial index counts as its key
 * columns; U2 of D-ARCH-163, one index per owner column with the same predicate, is checked in review), and USER_OWNED
 * tables are out of scope of arm (b) (their isolation key is the user; the rule for them is written with the first one
 * that carries a unique business key).
 *
 * P9-CK. The shadow rendering keeps a same-name `ck_…` replacement as "the CHECK being replaced" by its name alone
 * (tools/db/shadow-init.ts isCheckReplacement): every constraint whose name starts with `ck_` is a CHECK.
 */

/** A T2-O exception entry (D-ARCH-209): the CHECK of the referencing table that keeps guest rows off the key. */
export interface ReferenceException {
  /** Name of the CHECK on the referencing table (not derived from the key name). */
  readonly check: string;
  readonly reason: string;
}

/**
 * C16 (a) exceptions: exact constraint name -> its CHECK and stated reason; looked up with a Map, never the `in`
 * operator (PR26-SEC-06). T2-O entries only (rulings §2.3, §8.3): an org-bound key whose rows can never be guest rows.
 * An entry needs a principal-architect ruling and must be live (referenceExceptionFindings). Empty until the quote
 * tables (TASK-087: fk_quotes__requote_of_quote_id with ck_quotes__requote_org_only).
 */
export const TENANT_REFERENCE_EXCEPTIONS: ReadonlyMap<string, ReferenceException> = new Map<string, ReferenceException>();

/**
 * C16 (b) exceptions: exact index name -> stated reason. Only globally unique secret digests, which no writer can choose
 * or enumerate (PR65-SEC-01 remediation; PR65-SEC-03 inventory; D-ARCH-163 U1). Every entry must exist in scope and
 * must hold no owner key column at all (uniqueExceptionFindings).
 */
export const TENANT_UNIQUE_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  [
    'ux_invitations__token_hash',
    'SHA-256 digest of a random invitation token, unique across all organisations; redeemed through platform.invitation_lookup before any organisation context exists (data-model §4.5, AP-ORG-13; PR65-SEC-03)',
  ],
]);

/** One foreign key between two `org_id` tables (C16 (a)). */
export interface TenantReference {
  readonly conname: string;
  readonly child: string;
  readonly parent: string;
  /** The referencing `org_id` is NOT NULL. */
  readonly child_org_not_null: boolean;
  /** The referencing table has a `guest_token_hash` column (GUEST_CAPABLE, rule T2-G). */
  readonly child_guest_capable: boolean;
  /** `org_id` is a key column on both sides, at the same position. */
  readonly org_bound: boolean;
  /** `guest_token_hash` is a key column on both sides, at the same position. */
  readonly guest_bound: boolean;
  /**
   * The other column pairs of the constraint in constraint order, joined by commas ('' when none). Each pair is the
   * referencing column name, an equals sign and the referenced column name (child column to parent column).
   */
  readonly rest: string;
}

/** Every foreign key in `public` whose referencing and referenced tables both have an `org_id` column. */
export const TENANT_REFERENCES_SQL = `
  WITH fk AS (
    SELECT c.conname, c.conrelid, c.confrelid, c.conkey, c.confkey, ca.attnotnull AS child_org_not_null,
           ca.attnum AS child_org, pa.attnum AS parent_org, cg.attnum AS child_guest, pg_guest.attnum AS parent_guest
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attname = 'org_id' AND NOT ca.attisdropped
      JOIN pg_catalog.pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attname = 'org_id' AND NOT pa.attisdropped
      LEFT JOIN pg_catalog.pg_attribute cg
        ON cg.attrelid = c.conrelid AND cg.attname = 'guest_token_hash' AND NOT cg.attisdropped
      LEFT JOIN pg_catalog.pg_attribute pg_guest
        ON pg_guest.attrelid = c.confrelid AND pg_guest.attname = 'guest_token_hash' AND NOT pg_guest.attisdropped
     WHERE c.contype = 'f' AND c.conparentid = 0 AND c.connamespace = 'public'::regnamespace
  )
  SELECT f.conname::text AS conname,
         (SELECT r.relname::text FROM pg_catalog.pg_class r WHERE r.oid = f.conrelid) AS child,
         (SELECT r.relname::text FROM pg_catalog.pg_class r WHERE r.oid = f.confrelid) AS parent,
         f.child_org_not_null,
         f.child_guest IS NOT NULL AS child_guest_capable,
         COALESCE(pg_catalog.array_position(f.conkey, f.child_org) = pg_catalog.array_position(f.confkey, f.parent_org), false)
           AS org_bound,
         COALESCE(pg_catalog.array_position(f.conkey, f.child_guest) = pg_catalog.array_position(f.confkey, f.parent_guest), false)
           AS guest_bound,
         COALESCE((SELECT pg_catalog.string_agg(ka.attname || '=' || kp.attname, ',' ORDER BY k.n)
                     FROM ROWS FROM (pg_catalog.unnest(f.conkey), pg_catalog.unnest(f.confkey)) WITH ORDINALITY AS k(c, p, n)
                     JOIN pg_catalog.pg_attribute ka ON ka.attrelid = f.conrelid AND ka.attnum = k.c
                     JOIN pg_catalog.pg_attribute kp ON kp.attrelid = f.confrelid AND kp.attnum = k.p
                    WHERE NOT (k.c = f.child_org AND k.p = f.parent_org)
                      AND NOT (k.c IS NOT DISTINCT FROM f.child_guest AND k.p IS NOT DISTINCT FROM f.parent_guest)), '') AS rest
    FROM fk f
   ORDER BY 1`;

/** One constraint of a table in `public`, read for the CHECK an exception entry names (D-ARCH-209). */
export interface TenantCheck {
  readonly conname: string;
  readonly table: string;
  readonly contype: string;
  readonly validated: boolean;
  /** pg_get_constraintdef. */
  readonly definition: string;
}

/** Every constraint of a `public` table whose name is in `$1` (text[]), with its table, type, state and definition. */
export const REFERENCE_CHECKS_SQL = `
  SELECT c.conname::text AS conname, r.relname::text AS "table", c.contype::text AS contype, c.convalidated AS validated,
         pg_catalog.pg_get_constraintdef(c.oid) AS definition
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class r ON r.oid = c.conrelid
   WHERE r.relnamespace = 'public'::regnamespace AND c.conname = ANY ($1::text[])
   ORDER BY 1, 2`;

/** The CHECK names the entries of `exceptions` rely on (the parameter of REFERENCE_CHECKS_SQL). */
export const exceptionCheckNames = (exceptions: ReadonlyMap<string, ReferenceException> = TENANT_REFERENCE_EXCEPTIONS): string[] =>
  [...new Set([...exceptions.values()].map((entry) => entry.check))].sort();

/**
 * The T2-O predicate for the referencing column `column`, as pg_get_constraintdef prints it (rulings §8.3, probe Q3 on
 * 17.5): only organisation rows may hold the reference. A NOT VALID or NOT ENFORCED constraint prints a longer text.
 */
export const orgOnlyCheckDefinition = (column: string): string => `CHECK (((${column} IS NULL) OR (org_id IS NOT NULL)))`;

/** Why the rules of arm (a) report a key. `org-only` is the one kind a T2-O entry may name. */
export type ReferenceViolationKind = 'not-org-bound' | 'no-org-sibling' | 'not-owner-bound' | 'both-owners' | 'guest-only' | 'org-only';

/** One reference the rules of arm (a) report, before the exception map is applied. */
export interface ReferenceViolation {
  readonly conname: string;
  readonly child: string;
  readonly rest: string;
  readonly kind: ReferenceViolationKind;
  readonly message: string;
}

const VIOLATION_TEXT: Readonly<Record<ReferenceViolationKind, string>> = {
  'not-org-bound': 'is not bound through org_id (T1)',
  'no-org-sibling': 'is not bound through org_id and has no org-bound sibling (T2-N)',
  'not-owner-bound': 'is not owner-bound: neither org_id nor guest_token_hash at the same key position on both sides (T2-G)',
  'both-owners': 'holds both owner columns, so the owner CHECK leaves it unchecked on every row (T2-G)',
  'guest-only': 'is guest-bound without an org-bound sibling (T2-G)',
  'org-only': 'is org-bound without a guest-bound sibling (T2-G; a T2-O key needs an exception entry)',
};

/** The arm (a) kind of `row`, or undefined when the rules pass it. */
function violationKind(row: TenantReference, rows: readonly TenantReference[]): ReferenceViolationKind | undefined {
  // A sibling is ANOTHER key of the same table pair with the same rest (never the key itself), bound through exactly
  // the one owner column asked for: a key holding both owner columns is never checked, so it is nobody's sibling.
  const sibling = (bound: 'org_bound' | 'guest_bound'): boolean =>
    rows.some(
      (other) =>
        other.conname !== row.conname &&
        other.child === row.child &&
        other.parent === row.parent &&
        other.rest === row.rest &&
        other.org_bound === (bound === 'org_bound') &&
        other.guest_bound === (bound === 'guest_bound'),
    );
  if (row.child_org_not_null) return row.org_bound ? undefined : 'not-org-bound';
  if (!row.child_guest_capable) return row.org_bound || sibling('org_bound') ? undefined : 'no-org-sibling';
  if (!row.org_bound && !row.guest_bound) return 'not-owner-bound';
  // MATCH SIMPLE skips a key with a NULL column, and the owner CHECK leaves one owner column NULL on every row.
  if (row.org_bound && row.guest_bound) return 'both-owners';
  if (row.guest_bound) return sibling('org_bound') ? undefined : 'guest-only';
  return sibling('guest_bound') ? undefined : 'org-only';
}

/** The arm (a) rules over the rows (pure; no exception map). */
export function referenceViolations(rows: readonly TenantReference[]): ReferenceViolation[] {
  return rows.flatMap((row) => {
    const kind = violationKind(row, rows);
    return kind === undefined
      ? []
      : [
          {
            conname: row.conname,
            child: row.child,
            rest: row.rest,
            kind,
            message: `${row.conname}: ${row.child} -> ${row.parent} ${VIOLATION_TEXT[kind]}`,
          },
        ];
  });
}

/** The referencing column of a rest that holds exactly one pair, or undefined. */
function soleRestColumn(rest: string): string | undefined {
  if (rest === '' || rest.includes(',')) return undefined;
  return rest.split('=')[0];
}

/** Why the entry `name` does not hide a key (rulings §8.3), or undefined when it is live. */
function exceptionDefect(
  name: string,
  entry: ReferenceException,
  violations: ReadonlyMap<string, ReferenceViolation>,
  checks: readonly TenantCheck[],
): string | undefined {
  const violation = violations.get(name);
  if (violation === undefined) return 'names no reported key';
  if (violation.kind !== 'org-only')
    return `names a key reported as ${violation.kind}, not as org-bound without a guest-bound sibling (T2-O only)`;
  const column = soleRestColumn(violation.rest);
  if (column === undefined) return 'names a key whose referencing columns are not org_id and exactly one other column (T2-O only)';
  const check = checks.find((candidate) => candidate.conname === entry.check && candidate.table === violation.child);
  if (check === undefined) return `names ${entry.check}, which ${violation.child} does not carry`;
  if (check.contype !== 'c') return `names ${entry.check}, which is not a CHECK (contype ${check.contype})`;
  if (!check.validated) return `names ${entry.check}, which is not validated`;
  const expected = orgOnlyCheckDefinition(column);
  if (check.definition !== expected) return `names ${entry.check}, whose definition ${check.definition} is not ${expected}`;
  return undefined;
}

/** The names of the entries that hide their key: each is live (rulings §8.3). */
function liveReferenceExceptions(
  violations: readonly ReferenceViolation[],
  exceptions: ReadonlyMap<string, ReferenceException>,
  checks: readonly TenantCheck[],
): Set<string> {
  const byName = new Map(violations.map((violation) => [violation.conname, violation]));
  return new Set(
    [...exceptions].filter(([name, entry]) => exceptionDefect(name, entry, byName, checks) === undefined).map(([name]) => name),
  );
}

/** C16 (a) findings: the violations no live exception entry names. `checks` are the rows of REFERENCE_CHECKS_SQL. */
export function tenantReferenceFindings(
  rows: readonly TenantReference[],
  exceptions: ReadonlyMap<string, ReferenceException> = TENANT_REFERENCE_EXCEPTIONS,
  checks: readonly TenantCheck[] = [],
): string[] {
  const violations = referenceViolations(rows);
  const live = liveReferenceExceptions(violations, exceptions, checks);
  return violations.filter((violation) => !live.has(violation.conname)).map((violation) => violation.message);
}

/** C16 (a) exception liveness: every entry that does not hide its key, with the reason. */
export function referenceExceptionFindings(
  rows: readonly TenantReference[],
  exceptions: ReadonlyMap<string, ReferenceException> = TENANT_REFERENCE_EXCEPTIONS,
  checks: readonly TenantCheck[] = [],
): string[] {
  const byName = new Map(referenceViolations(rows).map((violation) => [violation.conname, violation]));
  return [...exceptions].flatMap(([name, entry]) => {
    const defect = exceptionDefect(name, entry, byName, checks);
    return defect === undefined ? [] : [`${name}: exception entry ${defect}`];
  });
}

/** One owner key column of a unique index or exclusion constraint (C16 (b), rules B1 and B2). */
export interface OwnerKeyColumn {
  readonly column: string;
  readonly not_null: boolean;
  /** Exclusion constraint: the operator at this key position is btree equality (strategy 3). Null for a unique index. */
  readonly equality: boolean | null;
}

/** One non-primary unique index or exclusion constraint of a scoped table that has an `org_id` column (C16 (b)). */
export interface TenantUniqueIndex {
  readonly index: string;
  readonly table: string;
  readonly kind: 'unique' | 'exclusion';
  /** pg_index.indnullsnotdistinct. */
  readonly nulls_not_distinct: boolean;
  /** The owner columns (`org_id`, `guest_token_hash`) among the KEY columns, in key order. */
  readonly owner_columns: readonly OwnerKeyColumn[];
}

/** Every non-primary unique index and exclusion constraint of the tables named in `$1` (text[]) that have `org_id`. */
export const TENANT_UNIQUE_INDEXES_SQL = `
  SELECT x.relname::text AS index, t.relname::text AS "table",
         CASE WHEN i.indisexclusion THEN 'exclusion' ELSE 'unique' END AS kind,
         i.indnullsnotdistinct AS nulls_not_distinct,
         COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                            'column', a.attname, 'not_null', a.attnotnull,
                            'equality', CASE WHEN i.indisexclusion THEN EXISTS (
                                SELECT 1 FROM pg_catalog.pg_amop ao JOIN pg_catalog.pg_am am ON am.oid = ao.amopmethod
                                 WHERE ao.amopopr = c.conexclop[k.n] AND am.amname = 'btree' AND ao.amopstrategy = 3) END)
                          ORDER BY k.n)
                     FROM pg_catalog.unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, n)
                     JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum AND NOT a.attisdropped
                    WHERE k.n <= i.indnkeyatts AND a.attname IN ('org_id', 'guest_token_hash')), '[]'::jsonb) AS owner_columns
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class x ON x.oid = i.indexrelid
    JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
    LEFT JOIN pg_catalog.pg_constraint c ON c.conindid = i.indexrelid AND c.contype = 'x'
   WHERE (i.indisunique OR i.indisexclusion) AND NOT i.indisprimary
     AND t.relnamespace = 'public'::regnamespace AND t.relname = ANY ($1::text[])
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute o WHERE o.attrelid = t.oid AND o.attname = 'org_id' AND NOT o.attisdropped)
   ORDER BY 1`;

/** The arm (b) scope: the TENANT and GUEST_CAPABLE tables of the manifests (USER_OWNED is out, see the header). */
export function uniqueScope(entries: readonly { readonly name: string; readonly class: string }[]): string[] {
  return entries
    .filter((entry) => entry.class === 'TENANT' || entry.class === 'GUEST_CAPABLE')
    .map((entry) => entry.name)
    .sort();
}

/** Why an owner key column does not separate owners (rules B1, B2 of D-ARCH-208), or [] when it counts. */
function ownerColumnDefects(row: TenantUniqueIndex, column: OwnerKeyColumn): string[] {
  return [
    ...(row.nulls_not_distinct && !column.not_null ? [`${column.column} is nullable under NULLS NOT DISTINCT`] : []),
    ...(row.kind === 'exclusion' && column.equality !== true
      ? [`${column.column} is compared by an operator that is not btree equality`]
      : []),
  ];
}

/** An owner column counts when it separates owners (rules B1 and B2). */
export const ownerColumnCounts = (row: TenantUniqueIndex, column: OwnerKeyColumn): boolean => ownerColumnDefects(row, column).length === 0;

/**
 * C16 (b) findings: a unique key without an owner key column that is not an exception, and a unique key whose owner
 * key columns all fail to separate owners (never excepted).
 */
export function tenantUniqueFindings(
  rows: readonly TenantUniqueIndex[],
  exceptions: ReadonlyMap<string, string> = TENANT_UNIQUE_EXCEPTIONS,
): string[] {
  return rows.flatMap((row) => {
    if (row.owner_columns.length === 0) {
      return exceptions.has(row.index)
        ? []
        : [
            `${row.index} (${row.kind}) on ${row.table} has no owner column (org_id or guest_token_hash) among its key columns (PR65-SEC-01)`,
          ];
    }
    if (row.owner_columns.some((column) => ownerColumnCounts(row, column))) return [];
    const defects = row.owner_columns.flatMap((column) => ownerColumnDefects(row, column));
    return [`${row.index} (${row.kind}) on ${row.table} has no owner column that separates owners: ${defects.join('; ')} (D-ARCH-208)`];
  });
}

/** C16 (b) exception liveness: entries that are not an in-scope unique key without any owner key column. */
export function uniqueExceptionFindings(
  rows: readonly TenantUniqueIndex[],
  exceptions: ReadonlyMap<string, string> = TENANT_UNIQUE_EXCEPTIONS,
): string[] {
  const live = new Set(rows.filter((row) => row.owner_columns.length === 0).map((row) => row.index));
  return [...exceptions.keys()]
    .filter((name) => !live.has(name))
    .map((name) => `${name}: exception entry names no owner-free unique key in scope`);
}

/** One constraint named `ck_…` (P9-CK). */
export interface CheckNamedConstraint {
  readonly conname: string;
  readonly contype: string;
  /** The table, or the domain, the constraint belongs to. */
  readonly owner: string;
}

/** Every constraint whose name starts with `ck_`, in every non-system schema (tables and domains). */
export const CHECK_NAMED_SQL = `
  SELECT c.conname::text AS conname, c.contype::text AS contype,
         n.nspname || '.' || COALESCE(r.relname, t.typname) AS owner
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.connamespace
    LEFT JOIN pg_catalog.pg_class r ON r.oid = c.conrelid
    LEFT JOIN pg_catalog.pg_type t ON t.oid = c.contypid
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'
     AND c.conname LIKE 'ck\\_%'
   ORDER BY 1, 3`;

/** P9-CK findings: a `ck_…` constraint that is not a CHECK. */
export function checkNameFindings(rows: readonly CheckNamedConstraint[]): string[] {
  return rows.filter((row) => row.contype !== 'c').map((row) => `${row.conname} on ${row.owner} has contype ${row.contype}, not c (CHECK)`);
}

/**
 * Planted probe for C16 (a), run as the superuser inside a transaction that is rolled back: one organisation-keyed
 * parent and one child per shape. Reported: a single-column key (T1), a composite key at the wrong position, a
 * nullable-org single key without a sibling (T2-N), and a single key beside a composite one on a NOT NULL `org_id`
 * (T1 replaces it). Not reported: the composite key, the T2-N pair, a key to a GLOBAL table.
 */
export const PLANT_REFERENCES: readonly string[] = [
  'CREATE TABLE public.c16_parent (id uuid PRIMARY KEY, org_id uuid NOT NULL, code text, CONSTRAINT c16_parent_org_id_id UNIQUE (org_id, id))',
  `CREATE TABLE public.c16_single (id uuid PRIMARY KEY, org_id uuid NOT NULL, parent_id uuid, role_id uuid,
     CONSTRAINT c16_single_parent FOREIGN KEY (parent_id) REFERENCES public.c16_parent (id),
     CONSTRAINT c16_single_role FOREIGN KEY (role_id) REFERENCES public.roles (id))`,
  `CREATE TABLE public.c16_bound (id uuid PRIMARY KEY, org_id uuid NOT NULL, parent_id uuid,
     CONSTRAINT c16_bound_parent FOREIGN KEY (org_id, parent_id) REFERENCES public.c16_parent (org_id, id))`,
  `CREATE TABLE public.c16_swapped (id uuid PRIMARY KEY, org_id uuid NOT NULL, parent_id uuid,
     CONSTRAINT c16_swapped_parent FOREIGN KEY (parent_id, org_id) REFERENCES public.c16_parent (org_id, id))`,
  `CREATE TABLE public.c16_guest (id uuid PRIMARY KEY, org_id uuid, parent_id uuid,
     CONSTRAINT c16_guest_parent FOREIGN KEY (parent_id) REFERENCES public.c16_parent (id),
     CONSTRAINT c16_guest_org_parent FOREIGN KEY (org_id, parent_id) REFERENCES public.c16_parent (org_id, id))`,
  `CREATE TABLE public.c16_guest_only (id uuid PRIMARY KEY, org_id uuid, parent_id uuid,
     CONSTRAINT c16_guest_only_parent FOREIGN KEY (parent_id) REFERENCES public.c16_parent (id))`,
  `CREATE TABLE public.c16_both (id uuid PRIMARY KEY, org_id uuid NOT NULL, parent_id uuid,
     CONSTRAINT c16_both_parent FOREIGN KEY (parent_id) REFERENCES public.c16_parent (id),
     CONSTRAINT c16_both_org_parent FOREIGN KEY (org_id, parent_id) REFERENCES public.c16_parent (org_id, id))`,
];

/** The C16 (a) findings PLANT_REFERENCES must add, by constraint name. */
export const PLANTED_REFERENCE_FINDINGS: readonly string[] = [
  'c16_both_parent',
  'c16_guest_only_parent',
  'c16_single_parent',
  'c16_swapped_parent',
];

/**
 * Planted probe for C16 (a) rule T2-G (rulings §2.6), after PLANT_REFERENCES: a guest-capable parent with both target
 * indexes (and a second digest column, the target of a swapped key) and one child per shape. Not reported: the
 * owner-bound pair (c16_g_pair). Reported: a single-column key beside the pair, an org-bound key alone, a guest-bound
 * key alone, a key whose guest_token_hash meets another parent column (swapped), and a key that holds both owner
 * columns (c16_g_both, D-ARCH-207; its target `(org_id, guest_token_hash, id)` is NULLS DISTINCT and passes arm (b)).
 * c16_g_org_only is the T2-O shape, with its CHECK c16_g_org_only_check: reported unless a live exception entry names
 * it (rulings §8.3).
 */
export const PLANT_GUEST_REFERENCES: readonly string[] = [
  `CREATE TABLE public.c16_gparent (id uuid PRIMARY KEY, org_id uuid, guest_token_hash bytea, digest bytea, code text,
     CONSTRAINT c16_gparent_owner CHECK (num_nonnulls(org_id, guest_token_hash) = 1),
     CONSTRAINT c16_gparent_org_id_id UNIQUE (org_id, id),
     CONSTRAINT c16_gparent_guest_id UNIQUE (guest_token_hash, id),
     CONSTRAINT c16_gparent_owners_id UNIQUE (org_id, guest_token_hash, id),
     CONSTRAINT c16_gparent_digest_id UNIQUE (digest, id))`,
  `CREATE TABLE public.c16_g_both (id uuid PRIMARY KEY, org_id uuid, guest_token_hash bytea, parent_id uuid,
     CONSTRAINT c16_g_both_parent FOREIGN KEY (org_id, guest_token_hash, parent_id)
       REFERENCES public.c16_gparent (org_id, guest_token_hash, id))`,
  `CREATE TABLE public.c16_g_pair (id uuid PRIMARY KEY, org_id uuid, guest_token_hash bytea, parent_id uuid NOT NULL,
     CONSTRAINT c16_g_pair_org FOREIGN KEY (org_id, parent_id) REFERENCES public.c16_gparent (org_id, id),
     CONSTRAINT c16_g_pair_guest FOREIGN KEY (guest_token_hash, parent_id) REFERENCES public.c16_gparent (guest_token_hash, id))`,
  `CREATE TABLE public.c16_g_single (id uuid PRIMARY KEY, org_id uuid, guest_token_hash bytea, parent_id uuid NOT NULL,
     CONSTRAINT c16_g_single_parent FOREIGN KEY (parent_id) REFERENCES public.c16_gparent (id),
     CONSTRAINT c16_g_single_org FOREIGN KEY (org_id, parent_id) REFERENCES public.c16_gparent (org_id, id),
     CONSTRAINT c16_g_single_guest FOREIGN KEY (guest_token_hash, parent_id) REFERENCES public.c16_gparent (guest_token_hash, id))`,
  `CREATE TABLE public.c16_g_org_only (id uuid PRIMARY KEY, org_id uuid, guest_token_hash bytea, parent_id uuid,
     CONSTRAINT c16_g_org_only_check CHECK (parent_id IS NULL OR org_id IS NOT NULL),
     CONSTRAINT c16_g_org_only_parent FOREIGN KEY (org_id, parent_id) REFERENCES public.c16_gparent (org_id, id))`,
  `CREATE TABLE public.c16_g_guest_only (id uuid PRIMARY KEY, org_id uuid, guest_token_hash bytea, parent_id uuid,
     CONSTRAINT c16_g_guest_only_parent FOREIGN KEY (guest_token_hash, parent_id) REFERENCES public.c16_gparent (guest_token_hash, id))`,
  `CREATE TABLE public.c16_g_swapped (id uuid PRIMARY KEY, org_id uuid, guest_token_hash bytea, parent_id uuid,
     CONSTRAINT c16_g_swapped_parent FOREIGN KEY (guest_token_hash, parent_id) REFERENCES public.c16_gparent (digest, id))`,
];

/** The C16 (a) findings PLANT_GUEST_REFERENCES must add (no exception entry), by constraint name. */
export const PLANTED_GUEST_REFERENCE_FINDINGS: readonly string[] = [
  'c16_g_both_parent',
  'c16_g_guest_only_parent',
  'c16_g_org_only_parent',
  'c16_g_single_parent',
  'c16_g_swapped_parent',
];

/**
 * Planted probe for C16 (b) on `c16_parent` (after PLANT_REFERENCES; scoped as if it were a TENANT table). Reported: a
 * unique index without `org_id`, the same with `org_id` only as an INCLUDE column, an expression over `org_id`, and
 * `EXCLUDE USING gist (org_id WITH <>, code WITH =)` (NOT NULL does not rescue an operator that is not equality; rule
 * B2 of D-ARCH-208). Not reported: the `(org_id, id)` constraint, `org_id` as a later key column, the primary key, and
 * `UNIQUE NULLS NOT DISTINCT (org_id, code)` (`org_id` is NOT NULL here, so rule B1 holds).
 */
export const PLANT_UNIQUE_INDEXES: readonly string[] = [
  'CREATE UNIQUE INDEX c16_ux_code ON public.c16_parent (code)',
  'CREATE UNIQUE INDEX c16_ux_code_include ON public.c16_parent (code) INCLUDE (org_id)',
  'CREATE UNIQUE INDEX c16_ux_expr ON public.c16_parent ((org_id::text || code))',
  'CREATE UNIQUE INDEX c16_ux_code_org ON public.c16_parent (code, org_id)',
  'CREATE UNIQUE INDEX c16_ux_org_code_nnd ON public.c16_parent (org_id, code) NULLS NOT DISTINCT',
  'ALTER TABLE public.c16_parent ADD CONSTRAINT c16_ex_org_ne_code EXCLUDE USING gist (org_id WITH <>, code WITH =)',
];

/** The C16 (b) findings PLANT_UNIQUE_INDEXES must add, by index name. */
export const PLANTED_UNIQUE_FINDINGS: readonly string[] = ['c16_ex_org_ne_code', 'c16_ux_code', 'c16_ux_code_include', 'c16_ux_expr'];

/**
 * Planted probe for C16 (b) on the guest-capable parent `c16_gparent` (after PLANT_GUEST_REFERENCES; scoped as if it
 * were a GUEST_CAPABLE table; rulings §2.6 and §8.2). Reported: `UNIQUE (code)`, `EXCLUDE USING btree (code WITH =)`,
 * `UNIQUE NULLS NOT DISTINCT (guest_token_hash, code)` and `UNIQUE NULLS NOT DISTINCT (org_id, code)` (a nullable owner
 * column under NULLS NOT DISTINCT; rule B1) and `EXCLUDE USING gist (org_id WITH <>, code WITH =)` (rule B2). Not
 * reported: `UNIQUE (org_id, code)`, `UNIQUE (guest_token_hash, code)`, `EXCLUDE USING btree (org_id WITH =, code WITH
 * =)` and `EXCLUDE USING gist (org_id WITH =, code WITH =)` (the rule reads the operator, not the access method), nor
 * the three owner target keys. The swap target `(digest, id)` has no owner column and is reported as well.
 */
export const PLANT_GUEST_UNIQUE_INDEXES: readonly string[] = [
  'CREATE UNIQUE INDEX c16_gux_code ON public.c16_gparent (code)',
  'ALTER TABLE public.c16_gparent ADD CONSTRAINT c16_gex_code EXCLUDE USING btree (code WITH =)',
  'CREATE UNIQUE INDEX c16_gux_org_code ON public.c16_gparent (org_id, code)',
  'CREATE UNIQUE INDEX c16_gux_guest_code ON public.c16_gparent (guest_token_hash, code)',
  'ALTER TABLE public.c16_gparent ADD CONSTRAINT c16_gex_org_code EXCLUDE USING btree (org_id WITH =, code WITH =)',
  'CREATE UNIQUE INDEX c16_gux_guest_code_nnd ON public.c16_gparent (guest_token_hash, code) NULLS NOT DISTINCT',
  'CREATE UNIQUE INDEX c16_gux_org_code_nnd ON public.c16_gparent (org_id, code) NULLS NOT DISTINCT',
  'ALTER TABLE public.c16_gparent ADD CONSTRAINT c16_gex_org_ne_code EXCLUDE USING gist (org_id WITH <>, code WITH =)',
  'ALTER TABLE public.c16_gparent ADD CONSTRAINT c16_gex_gist_org_code EXCLUDE USING gist (org_id WITH =, code WITH =)',
];

/** The C16 (b) findings PLANT_GUEST_UNIQUE_INDEXES (on the parent of PLANT_GUEST_REFERENCES) must add, by name. */
export const PLANTED_GUEST_UNIQUE_FINDINGS: readonly string[] = [
  'c16_gex_code',
  'c16_gex_org_ne_code',
  'c16_gparent_digest_id',
  'c16_gux_code',
  'c16_gux_guest_code_nnd',
  'c16_gux_org_code_nnd',
];

/**
 * The two PR #65 shapes the rules exist for, re-planted on the real tables (rolled back): the single-column membership
 * key that D-ARCH-154 replaced, and the live-grant index without `org_id` that PR65-SEC-01 replaced.
 */
export const PLANT_PR65_MUTANTS: readonly string[] = [
  'ALTER TABLE public.membership_roles DROP CONSTRAINT fk_membership_roles__membership_id',
  'ALTER TABLE public.membership_roles ADD CONSTRAINT fk_membership_roles__membership_id FOREIGN KEY (membership_id) REFERENCES public.memberships (id)',
  'DROP INDEX public.ux_membership_roles__membership_role_live',
  'CREATE UNIQUE INDEX ux_membership_roles__membership_role_live ON public.membership_roles (membership_id, role_id) WHERE revoked_at IS NULL',
];

/** Planted probe for P9-CK (rolled back): a primary key and a unique key named `ck_…`; a domain CHECK passes. */
export const PLANT_CHECK_NAMES: readonly string[] = [
  'CREATE TABLE public.c16_ck (id integer CONSTRAINT ck_c16_ck__id PRIMARY KEY, v integer CONSTRAINT ck_c16_ck__v CHECK (v > 0), w integer CONSTRAINT ck_c16_ck__w UNIQUE)',
  'CREATE DOMAIN public.c16_positive AS integer CONSTRAINT ck_c16_positive CHECK (VALUE > 0)',
];

/** The P9-CK findings PLANT_CHECK_NAMES must add. */
export const PLANTED_CHECK_FINDINGS: readonly string[] = [
  'ck_c16_ck__id on public.c16_ck has contype p, not c (CHECK)',
  'ck_c16_ck__w on public.c16_ck has contype u, not c (CHECK)',
];
