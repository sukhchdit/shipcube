/**
 * Catalog C16 and P9-CK: the queries, exception maps and finding rules (data-model §4.6 C16, §4.7; D-ARCH-154,
 * D-SEC-PR65-01 / PR65-SEC-01; PR #66 code review R1-n2, D-SEC-PR66-02; TASK-293). Kept free of the Testcontainers
 * harness so the same SQL can be probed outside Jest; c16-tenant-keys.int.test.ts runs it against PostgreSQL 18.
 *
 * C16 (a) tenant-bound references. PostgreSQL runs referential-integrity checks without row security, so a
 * single-column key between two organisation-keyed tables accepts a row of organisation A naming a row of B and answers
 * "does this id exist in any tenant" (§4.7). Every foreign key in `public` whose referencing and referenced tables both
 * have an `org_id` column holds `org_id` on both sides at the same key position (rule T1); where the referencing
 * `org_id` is nullable (GUEST_CAPABLE, rule T2) a single-column key may stay if a composite key of the same table pair
 * covering its columns sits beside it. Out of scope by construction: references to tables without `org_id` (GLOBAL
 * tables, `organisations`, `users`).
 *
 * C16 (b) tenant-scoped unique indexes (PR65-SEC-01). A unique index is checked while the index tuple is inserted, before
 * the statement-end foreign-key check, so a unique index of a TENANT table without `org_id` answers questions about other
 * organisations' rows (`23505` against `23503`) and lets a foreign row block them. Every unique index of a TENANT table
 * with an `org_id` column has `org_id` among its KEY columns (INCLUDE columns and expressions do not count), except the
 * primary key and the listed globally unique digests.
 *
 * P9-CK. The shadow rendering keeps a same-name `ck_…` replacement as "the CHECK being replaced" by its name alone
 * (tools/db/shadow-init.ts isCheckReplacement): every constraint whose name starts with `ck_` is a CHECK.
 */

/**
 * C16 (a) exceptions: exact constraint name -> stated reason; looked up with a Map, never the `in` operator
 * (PR26-SEC-06). Starts empty (D-ARCH-154); an entry needs a principal-architect ruling.
 */
export const TENANT_REFERENCE_EXCEPTIONS: ReadonlyMap<string, string> = new Map<string, string>();

/**
 * C16 (b) exceptions: exact index name -> stated reason. Only globally unique secret digests, which no organisation can
 * choose or enumerate (PR65-SEC-01 remediation; PR65-SEC-03 inventory). Every entry must exist and must lack `org_id`,
 * so the map cannot hide a compliant or vanished index.
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
  /** `org_id` is a key column on both sides, at the same position. */
  readonly composite: boolean;
  /** The referencing `org_id` is NOT NULL. */
  readonly child_org_not_null: boolean;
  /** A composite key of the same table pair holds every column of this key (T2 sibling). */
  readonly sibling: boolean;
}

/** Every foreign key in `public` whose referencing and referenced tables both have an `org_id` column. */
export const TENANT_REFERENCES_SQL = `
  WITH fk AS (
    SELECT c.conname, c.conrelid, c.confrelid, c.conkey, c.confkey, ca.attnotnull AS child_org_not_null,
           pg_catalog.array_position(c.conkey, ca.attnum) IS NOT NULL
             AND pg_catalog.array_position(c.conkey, ca.attnum) = pg_catalog.array_position(c.confkey, pa.attnum) AS composite
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attname = 'org_id' AND NOT ca.attisdropped
      JOIN pg_catalog.pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attname = 'org_id' AND NOT pa.attisdropped
     WHERE c.contype = 'f' AND c.conparentid = 0 AND c.connamespace = 'public'::regnamespace
  )
  SELECT f.conname::text AS conname,
         (SELECT r.relname::text FROM pg_catalog.pg_class r WHERE r.oid = f.conrelid) AS child,
         (SELECT r.relname::text FROM pg_catalog.pg_class r WHERE r.oid = f.confrelid) AS parent,
         f.composite, f.child_org_not_null,
         EXISTS (SELECT 1 FROM fk s
                  WHERE s.composite AND s.conrelid = f.conrelid AND s.confrelid = f.confrelid
                    AND f.conkey OPERATOR(pg_catalog.<@) s.conkey AND f.confkey OPERATOR(pg_catalog.<@) s.confkey) AS sibling
    FROM fk f
   ORDER BY 1`;

/** C16 (a) findings: a key that is not composite through `org_id`, unless T2 applies (nullable `org_id` + sibling). */
export function tenantReferenceFindings(
  rows: readonly TenantReference[],
  exceptions: ReadonlyMap<string, string> = TENANT_REFERENCE_EXCEPTIONS,
): string[] {
  return rows
    .filter((row) => !row.composite && !(!row.child_org_not_null && row.sibling) && !exceptions.has(row.conname))
    .map((row) => `${row.conname}: ${row.child} -> ${row.parent} is not bound through org_id (T1${row.child_org_not_null ? '' : '/T2'})`);
}

/** One unique index of a scoped table that has an `org_id` column (C16 (b)). */
export interface TenantUniqueIndex {
  readonly index: string;
  readonly table: string;
  /** `org_id` is one of the index KEY columns. */
  readonly has_org_id: boolean;
}

/** Every non-primary unique index of the tables named in `$1` (text[]) that have an `org_id` column. */
export const TENANT_UNIQUE_INDEXES_SQL = `
  SELECT x.relname::text AS index, t.relname::text AS "table",
         a.attnum = ANY (SELECT k.attnum FROM pg_catalog.unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, n)
                          WHERE k.n <= i.indnkeyatts) AS has_org_id
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class x ON x.oid = i.indexrelid
    JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
    JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attname = 'org_id' AND NOT a.attisdropped
   WHERE i.indisunique AND NOT i.indisprimary
     AND t.relnamespace = 'public'::regnamespace AND t.relname = ANY ($1::text[])
   ORDER BY 1`;

/** C16 (b) findings: a unique index without `org_id` among its key columns that is not an exception. */
export function tenantUniqueFindings(
  rows: readonly TenantUniqueIndex[],
  exceptions: ReadonlyMap<string, string> = TENANT_UNIQUE_EXCEPTIONS,
): string[] {
  return rows
    .filter((row) => !row.has_org_id && !exceptions.has(row.index))
    .map((row) => `${row.index} on ${row.table} has no org_id key column (PR65-SEC-01)`);
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
 * nullable-org single key without a sibling (T2), and a single key beside a composite one on a NOT NULL `org_id`
 * (T1 replaces it). Not reported: the composite key, the T2 pair, a key to a GLOBAL table.
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
 * Planted probe for C16 (b) on `c16_parent` (after PLANT_REFERENCES; scoped as if it were a TENANT table). Reported: a
 * unique index without `org_id`, the same with `org_id` only as an INCLUDE column, and an expression over `org_id`.
 * Not reported: the `(org_id, id)` constraint, `org_id` as a later key column, the primary key.
 */
export const PLANT_UNIQUE_INDEXES: readonly string[] = [
  'CREATE UNIQUE INDEX c16_ux_code ON public.c16_parent (code)',
  'CREATE UNIQUE INDEX c16_ux_code_include ON public.c16_parent (code) INCLUDE (org_id)',
  'CREATE UNIQUE INDEX c16_ux_expr ON public.c16_parent ((org_id::text || code))',
  'CREATE UNIQUE INDEX c16_ux_code_org ON public.c16_parent (code, org_id)',
];

/** The C16 (b) findings PLANT_UNIQUE_INDEXES must add, by index name. */
export const PLANTED_UNIQUE_FINDINGS: readonly string[] = ['c16_ux_code', 'c16_ux_code_include', 'c16_ux_expr'];

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
