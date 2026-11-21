/**
 * Load-time code: catalog test C17 and the load-time gate of the restore rehearsal (data-model.md §4.6 C17, §8.6 second
 * amendment; D-ARCH-235, D-ARCH-236, D-ARCH-237; PR034-SEC-01, PR034-SEC-05; TASK-034 fix cycle 3).
 *
 * A restore loads every row as a privileged role, and PostgreSQL evaluates four kinds of expression as the role that
 * writes the row: a table CHECK, a domain CHECK, a generated-column expression and a partition-key expression. Such an
 * expression may call IMMUTABLE `pg_catalog` routines only, and operators that `pg_catalog` routines implement. The
 * references are read from the stored expression trees (`conbin`, `adbin`, `partexprs`), because PostgreSQL records no
 * `pg_depend` row for a built-in object, so `pg_depend` cannot show `CHECK (pg_catalog.query_to_xml('select w()', …)
 * IS NOT NULL)`, which runs `w` as the loading role. A range type outside `pg_catalog` and outside an extension is a
 * finding too (the catalog half of migration-lint rule 14).
 *
 * One query and one finding rule serve three callers: the catalog case (prisma/tests/catalog/c17-load-time-code.int.test.ts),
 * `db:backup`, which records the findings of the dump's snapshot in the manifest (`loadTimeCode`), and
 * `db:verify-restore`, which refuses a manifest with a finding before it creates a database. Findings carry object and
 * routine names only, never row data.
 *
 * Stated limits (D-ARCH-236): the operators of a row comparison are not read (a btree operator family needs a
 * superuser), and an IMMUTABLE built-in routine is trusted.
 */

/**
 * The C17 query, equal to the fence of data-model §8.6 that starts with `-- C17: load-time code` (load-time-code.test.ts
 * compares the two). Run it with `search_path = pg_catalog, pg_temp` (every privileged session of the tools does). One
 * row per reference that is not an IMMUTABLE `pg_catalog` routine, and per range type outside an extension.
 */
export const LOAD_TIME_CODE_SQL = `WITH site (kind, object, tree) AS (
  SELECT CASE WHEN c.contypid <> 0 THEN 'domain check' ELSE 'table check' END,
         CASE WHEN c.contypid <> 0 THEN pg_catalog.format_type(c.contypid, NULL)
              ELSE c.conrelid::pg_catalog.regclass::pg_catalog.text END || ' ' || c.conname,
         c.conbin::pg_catalog.text
    FROM pg_catalog.pg_constraint c
   WHERE c.contype = 'c'
  UNION ALL
  SELECT 'generated column', ad.adrelid::pg_catalog.regclass::pg_catalog.text || '.' || a.attname,
         ad.adbin::pg_catalog.text
    FROM pg_catalog.pg_attrdef ad
    JOIN pg_catalog.pg_attribute a ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
   WHERE a.attgenerated <> ''
  UNION ALL
  SELECT 'partition key', pt.partrelid::pg_catalog.regclass::pg_catalog.text, pt.partexprs::pg_catalog.text
    FROM pg_catalog.pg_partitioned_table pt
   WHERE pt.partexprs IS NOT NULL
), ref (kind, object, via, routine) AS (
  SELECT s.kind, s.object, 'call', m.found[1]::pg_catalog.oid
    FROM site s CROSS JOIN LATERAL pg_catalog.regexp_matches(s.tree, ':funcid ([0-9]+)', 'g') AS m (found)
  UNION
  SELECT s.kind, s.object, 'operator', m.found[1]::pg_catalog.oid
    FROM site s CROSS JOIN LATERAL pg_catalog.regexp_matches(s.tree, ':opfuncid ([0-9]+)', 'g') AS m (found)
   WHERE m.found[1] <> '0'
  UNION
  SELECT s.kind, s.object, 'operator', o.oprcode::pg_catalog.oid
    FROM site s CROSS JOIN LATERAL pg_catalog.regexp_matches(s.tree, ':opno ([0-9]+)', 'g') AS m (found)
    LEFT JOIN pg_catalog.pg_operator o ON o.oid = m.found[1]::pg_catalog.oid
)
SELECT r.kind, r.object, r.via,
       COALESCE(p.oid::pg_catalog.regprocedure::pg_catalog.text, 'unknown routine') AS reference,
       CASE WHEN p.oid IS NULL THEN 'unknown routine'
            WHEN p.pronamespace <> 'pg_catalog'::pg_catalog.regnamespace THEN 'not built in'
            ELSE 'not immutable' END AS reason
  FROM ref r
  LEFT JOIN pg_catalog.pg_proc p ON p.oid = r.routine
 WHERE p.oid IS NULL
    OR p.pronamespace <> 'pg_catalog'::pg_catalog.regnamespace
    OR (r.via = 'call' AND p.provolatile <> 'i')
UNION ALL
SELECT 'range type', t.oid::pg_catalog.regtype::pg_catalog.text, 'type',
       t.oid::pg_catalog.regtype::pg_catalog.text, 'range type outside an extension'
  FROM pg_catalog.pg_range g
  JOIN pg_catalog.pg_type t ON t.oid = g.rngtypid
 WHERE t.typnamespace <> 'pg_catalog'::pg_catalog.regnamespace
   AND NOT EXISTS (SELECT FROM pg_catalog.pg_depend e
                    WHERE e.classid = 'pg_catalog.pg_type'::pg_catalog.regclass AND e.objid = t.oid AND e.deptype = 'e')
 ORDER BY 1, 2, 3, 4`;

/** One row of LOAD_TIME_CODE_SQL. */
export interface LoadTimeCodeRow {
  /** `table check`, `domain check`, `generated column`, `partition key` or `range type`. */
  readonly kind: string;
  /** The table and constraint, the domain and constraint, the column, the partitioned table, or the range type. */
  readonly object: string;
  /** `call`, `operator` or `type`. */
  readonly via: string;
  /** The routine as exact `regprocedure` text, the range type, or `unknown routine`. */
  readonly reference: string;
  /** `not immutable`, `not built in`, `unknown routine` or `range type outside an extension`. */
  readonly reason: string;
}

/** A load-time-code finding as the manifest records it (object and routine names only). */
export interface LoadTimeFinding {
  readonly kind: string;
  readonly object: string;
  readonly reference: string;
  readonly reason: string;
}

/**
 * `pg_catalog` routines that are not IMMUTABLE and that a load-time expression may call anyway: exact `regprocedure`
 * text → the stated reason. Empty: no migration needs one (D-ARCH-236 item 1). An entry needs principal-architect's
 * ruling first, and an entry that no expression of the migrated schema uses is a C17 finding (`unusedReviewedBuiltins`).
 * A routine outside `pg_catalog` never has an exception.
 */
export const REVIEWED_NON_IMMUTABLE_BUILTINS: ReadonlyMap<string, string> = new Map<string, string>();

/** The reason that a reviewed-list entry can excuse; every other reason is always a finding. */
const EXCUSABLE_REASON = 'not immutable';

/**
 * The findings among `rows`: every row, unless its reason is `not immutable` and its exact `reference` is on `reviewed`.
 * `not built in`, `unknown routine` and `range type outside an extension` are always findings (fail closed: an unknown
 * reason is a finding too).
 */
export function loadTimeCodeFindings(
  rows: readonly LoadTimeCodeRow[],
  reviewed: ReadonlyMap<string, string> = REVIEWED_NON_IMMUTABLE_BUILTINS,
): LoadTimeFinding[] {
  return rows
    .filter((row) => !(row.reason === EXCUSABLE_REASON && reviewed.get(row.reference) !== undefined))
    .map(({ kind, object, reference, reason }) => ({ kind, object, reference, reason }));
}

/** The entries of `reviewed` that no `not immutable` row of `rows` uses (each is a C17 finding: the list may only shrink to use). */
export function unusedReviewedBuiltins(
  rows: readonly LoadTimeCodeRow[],
  reviewed: ReadonlyMap<string, string> = REVIEWED_NON_IMMUTABLE_BUILTINS,
): string[] {
  const used = new Set(rows.filter((row) => row.reason === EXCUSABLE_REASON).map((row) => row.reference));
  return [...reviewed.keys()].filter((reference) => !used.has(reference));
}

/** One line per finding for a CLI message or a test diff: `<kind> <object>: <reference> (<reason>)`. */
export const describeFinding = (finding: LoadTimeFinding): string =>
  `${finding.kind} ${finding.object}: ${finding.reference} (${finding.reason})`;
