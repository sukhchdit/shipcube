/**
 * Cross-tenant isolation case generator (US-077, REQ-RLS-007, NFR-TENANT-001, NFR-SEC-011; data-model §4.3, §4.6 C12;
 * ADR-0005 am. 10 items 7 and 11; PR7-SEC-04, PR7-SEC-07 item 3; T-QA-04; TASK-024). Pure: no I/O.
 *
 * Input: the table-class manifests (`tools/db/table-classes/*.json`, the single source of the tenant classes) and,
 * for the enumeration checks, the live catalogue as read by `catalog.ts`. Output:
 *  - `generateCases(entries)`: one case per (RLS table x probe kind). A table enters the suite by being listed in a
 *    manifest, so a new tenant table is picked up without editing the suite (AT-US-077-03), and there is no skip list
 *    (the suite is zero-skip: an unrunnable case fails, it is never skipped);
 *  - `enumerationFindings(entries, live)`: a live table in no manifest, an RLS-class table without ENABLE + FORCE, a
 *    GUEST_CAPABLE table without its de-claim trigger, a missing isolation-key column, an RLS table under a non-RLS
 *    class, a listed table that does not exist;
 *  - `tenantResourceRoutes` / `routeCaseFindings`: every `tenant`/`user` route that addresses a resource by a path
 *    parameter needs a registered API case (AT-US-077-02); a route without one fails the suite;
 *  - `synthesiseRow`: a row for any table from its column metadata (NOT NULL columns without a default get a typed
 *    synthetic value; single-column enum CHECKs give their first value; `ROW_OVERRIDES` in fixtures.ts covers the rest),
 *    so a new table needs no hand-written fixture unless a constraint the synthesis cannot read demands one.
 *
 * Determinism (TEST-STRATEGY §10): every id is derived from a label with SHA-256 (`stableUuid`), never random.
 */
import { createHash } from 'node:crypto';

import { RLS_CLASSES, type TableClassEntry } from '../../../tools/db/table-classes.js';

// ---------------------------------------------------------------------------------------------------------------------
// Isolation keys
// ---------------------------------------------------------------------------------------------------------------------

/** The column that binds a row to its tenant, and the context key it is compared with. */
export interface IsolationKey {
  readonly column: string;
  /** `org`: `app.org_id`; `actor`: `app.actor_id`. */
  readonly scope: 'org' | 'actor';
}

/** The isolation key of an RLS-class manifest entry (data-model §4.3, DR-A14 sets included). */
export function isolationKey(entry: Pick<TableClassEntry, 'name' | 'class' | 'policySet'>): IsolationKey {
  switch (entry.policySet ?? entry.class) {
    case 'TENANT':
    case 'GUEST_CAPABLE':
    case 'dr-a14-memberships':
      return { column: 'org_id', scope: 'org' };
    case 'USER_OWNED':
      return { column: 'user_id', scope: 'actor' };
    case 'dr-a14-users':
      return { column: 'id', scope: 'actor' };
    case 'dr-a14-organisations':
      return { column: 'id', scope: 'org' };
    default:
      throw new Error(`table ${entry.name}: class ${entry.class} is not row-level secured`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------------------------------------------------

/** Probes run against every RLS table (AT-US-077-01; C12 generalised; SEC-TC-06). */
export const TABLE_PROBES = [
  'own-row-visible',
  'select-foreign-id',
  'select-foreign-key',
  'update-foreign-id',
  'delete-foreign-id',
  'insert-foreign-key',
  'no-context',
  'empty-context',
  'malformed-context',
  'forced-operator',
  'operator-policies-select-only',
] as const;

/** Extra probes for GUEST_CAPABLE tables (PR7-SEC-07 item 3 = C12 guest rows; PR7-SEC-04 de-claim). */
export const GUEST_PROBES = [
  'guest-no-settings',
  'guest-empty-settings',
  'guest-org-without-hash',
  'guest-other-hash',
  'guest-own-hash',
  'guest-declaim-refused',
  'guest-claim-allowed',
] as const;

export type ProbeKind = (typeof TABLE_PROBES)[number] | (typeof GUEST_PROBES)[number];

export interface IsolationCase {
  readonly table: string;
  readonly kind: ProbeKind;
  readonly key: IsolationKey;
  /** Test title: carries the acceptance / security IDs (TEST-STRATEGY §6). */
  readonly title: string;
}

const TITLES: Readonly<Record<ProbeKind, string>> = {
  'own-row-visible': 'AT-US-077-01 positive control: the session of A sees its own row (the probe is not vacuous)',
  'select-foreign-id': "AT-US-077-01 SELECT by B's exact id returns 0 rows",
  'select-foreign-key': "AT-US-077-01 SELECT by B's isolation key returns 0 rows",
  'update-foreign-id': "AT-US-077-01 UPDATE by B's exact id affects 0 rows (or is refused without the privilege)",
  'delete-foreign-id': "AT-US-077-01 DELETE by B's exact id affects 0 rows (or is refused without the privilege)",
  'insert-foreign-key': "AT-US-077-01 INSERT with B's isolation key fails the WITH CHECK policy (42501)",
  'no-context': 'C12 REQ-RLS-004 with no settings the table returns 0 rows (fail closed)',
  'empty-context': 'C12 F-07 with all four app.* keys set to the empty string the table returns 0 rows',
  'malformed-context': 'C12 F-07 a malformed org/actor id returns 0 rows',
  'forced-operator': '[SEC-TC-06] C12 a customer forcing the OPERATOR actor scope still sees nothing of B',
  'operator-policies-select-only': '[SEC-TC-06] every operator policy is FOR SELECT (cross-tenant reads only, ADR-0005 am. 2)',
  'guest-no-settings': 'C12 PR7-SEC-07 (i) a guest row (org_id NULL, hash H) is invisible with no settings',
  'guest-empty-settings': 'C12 PR7-SEC-07 (ii) a guest row is invisible with all four app.* keys empty',
  'guest-org-without-hash': 'C12 PR7-SEC-07 (iii) a guest row is invisible to org A without a hash',
  'guest-other-hash': 'C12 PR7-SEC-07 (iv) a guest row is invisible under a different hash',
  'guest-own-hash': 'C12 PR7-SEC-07 positive control: the guest row is visible under its own hash H',
  'guest-declaim-refused':
    'PR7-SEC-04 under the claim context the de-claim UPDATE (org_id -> NULL, hash -> H) raises GUEST_DECLAIM_FORBIDDEN',
  'guest-claim-allowed': 'PR7-SEC-04 positive control: the legitimate claim (NULL -> org A, hash -> NULL) succeeds',
};

/** Every case for the RLS-class entries of `entries`, in manifest order then probe order. */
export function generateCases(entries: readonly TableClassEntry[]): IsolationCase[] {
  return entries
    .filter((entry) => RLS_CLASSES.has(entry.class))
    .flatMap((entry) => {
      const key = isolationKey(entry);
      const kinds: readonly ProbeKind[] = entry.class === 'GUEST_CAPABLE' ? [...TABLE_PROBES, ...GUEST_PROBES] : TABLE_PROBES;
      return kinds.map((kind) => ({ table: entry.name, kind, key, title: `${entry.name}: ${TITLES[kind]}` }));
    });
}

/** What a probe observed: a row count (selected or affected), or the SQLSTATE (+ message marker) of a refusal. */
export type Observation = { readonly rows: number } | { readonly sqlState: string; readonly marker?: string };

const REFUSED: Observation = { sqlState: '42501' };

/**
 * The expected observation of a probe given the table privileges of `platform_app`. A probe whose privilege is missing
 * is refused with 42501 before RLS is consulted; that is isolation as well, and the outcome is pinned, not skipped.
 */
export function expectedObservation(kind: ProbeKind, privileges: readonly TablePrivilege[]): Observation {
  const can = (...needed: TablePrivilege[]): boolean => needed.every((privilege) => privileges.includes(privilege));
  switch (kind) {
    case 'own-row-visible':
    case 'guest-own-hash':
      return can('SELECT') ? { rows: 1 } : REFUSED;
    case 'update-foreign-id':
      return can('SELECT', 'UPDATE') ? { rows: 0 } : REFUSED;
    case 'delete-foreign-id':
      return can('SELECT', 'DELETE') ? { rows: 0 } : REFUSED;
    case 'insert-foreign-key':
      return REFUSED;
    case 'operator-policies-select-only':
      return { rows: 0 };
    case 'guest-declaim-refused':
      return { sqlState: '23514', marker: 'GUEST_DECLAIM_FORBIDDEN' };
    case 'guest-claim-allowed':
      return { rows: 1 };
    default:
      return can('SELECT') ? { rows: 0 } : REFUSED;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Live catalogue and enumeration
// ---------------------------------------------------------------------------------------------------------------------

export interface ColumnInfo {
  readonly name: string;
  /** `format_type(atttypid, atttypmod)`, e.g. `uuid`, `text`, `character varying(3)`, `bigint`, `text[]`. */
  readonly type: string;
  readonly notNull: boolean;
  readonly hasDefault: boolean;
  /** Allowed values of a single-column `col = ANY (ARRAY[...])` / `col IN (...)` CHECK, when there is one. */
  readonly enumValues?: readonly string[];
}

export const TABLE_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;
export type TablePrivilege = (typeof TABLE_PRIVILEGES)[number];

export interface LiveTable {
  readonly name: string;
  readonly columns: readonly ColumnInfo[];
  readonly rowSecurity: boolean;
  readonly forceRowSecurity: boolean;
  /** Names of the table's triggers. */
  readonly triggers: readonly string[];
  /** Table privileges `platform_app` holds. */
  readonly appPrivileges: readonly TablePrivilege[];
}

/** The de-claim trigger the renderer emits for GUEST_CAPABLE tables (PR7-SEC-04). */
export const guestGuardTrigger = (table: string): string => `tg_${table}__guest_capable_guard`;

/**
 * Enumeration findings (AT-US-077-03): empty when every live public table is classified and every RLS-class table the
 * manifests list exists with ENABLE + FORCE, its isolation-key column and (GUEST_CAPABLE) its de-claim trigger.
 */
export function enumerationFindings(entries: readonly TableClassEntry[], live: readonly LiveTable[]): string[] {
  const findings: string[] = [];
  const listed = new Map(entries.map((entry) => [entry.name, entry]));
  const byName = new Map(live.map((table) => [table.name, table]));
  for (const table of live) {
    const entry = listed.get(table.name);
    if (entry === undefined) {
      findings.push(`${table.name}: table in no table-class manifest, so the generator cannot classify it`);
    } else if (!RLS_CLASSES.has(entry.class) && table.rowSecurity) {
      findings.push(`${table.name}: row security is enabled but the manifest class is ${entry.class}`);
    }
  }
  for (const entry of entries) {
    if (!RLS_CLASSES.has(entry.class)) continue;
    const table = byName.get(entry.name);
    if (table === undefined) {
      findings.push(`${entry.name}: listed as ${entry.class} but not in the database`);
      continue;
    }
    if (!table.rowSecurity || !table.forceRowSecurity)
      findings.push(`${entry.name}: ${entry.class} without ENABLE and FORCE ROW LEVEL SECURITY`);
    const key = isolationKey(entry);
    if (!table.columns.some((column) => column.name === key.column))
      findings.push(`${entry.name}: isolation key column ${key.column} missing`);
    if (entry.class === 'GUEST_CAPABLE') {
      if (!table.triggers.includes(guestGuardTrigger(entry.name))) {
        findings.push(`${entry.name}: GUEST_CAPABLE without ${guestGuardTrigger(entry.name)} (PR7-SEC-04)`);
      }
      for (const column of ['org_id', 'guest_token_hash']) {
        if (!table.columns.some((c) => c.name === column)) findings.push(`${entry.name}: GUEST_CAPABLE without ${column}`);
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------------------------------------------------
// API-level enumeration (AT-US-077-02)
// ---------------------------------------------------------------------------------------------------------------------

/** The route descriptor fields the enumeration reads (structural, so the generator stays free of app imports). */
export interface RouteShape {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly tenancy: string;
}

const PATH_PARAMETER = /(?:^|\/)(?::[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})(?=\/|$)/;

/** Routes that address a tenant's or user's resource by a path parameter: each needs a cross-tenant API case. */
export function tenantResourceRoutes<R extends RouteShape>(routes: readonly R[]): R[] {
  return routes.filter((route) => (route.tenancy === 'tenant' || route.tenancy === 'user') && PATH_PARAMETER.test(route.path));
}

/** Routes without a registered API case (operationId keyed); sorted. */
export function routeCaseFindings(routes: readonly RouteShape[], registered: ReadonlySet<string>): string[] {
  return tenantResourceRoutes(routes)
    .filter((route) => !registered.has(route.operationId))
    .map(
      (route) =>
        `${route.method.toUpperCase()} ${route.path} (${route.operationId}): tenant-resource route without a generated cross-tenant case`,
    )
    .sort();
}

// ---------------------------------------------------------------------------------------------------------------------
// Deterministic ids and row synthesis
// ---------------------------------------------------------------------------------------------------------------------

/** A UUID (version 7 and RFC 9562 variant bits) derived from `label` with SHA-256: stable across runs. */
export function stableUuid(label: string): string {
  const hex = createHash('sha256').update(label).digest('hex');
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** A 32-byte guest token hash derived from `label` (the helper reads 64 lowercase hex digits). */
export const stableHash = (label: string): string => createHash('sha256').update(`guest:${label}`).digest('hex');

export class RowSynthesisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RowSynthesisError';
  }
}

export interface SynthesisedRow {
  readonly columns: readonly string[];
  /** Parameter values (strings, booleans, Buffers or null); placeholders `$1..$n` in column order. */
  readonly values: readonly unknown[];
}

/** A synthetic value for a NOT NULL column without a default, by type; `undefined` when the type is unknown. */
function syntheticValue(table: string, column: ColumnInfo, tag: string): unknown {
  if (column.enumValues !== undefined && column.enumValues.length > 0) return column.enumValues[0];
  const type = column.type.toLowerCase();
  if (type.endsWith('[]')) return '{}';
  if (type === 'uuid') return stableUuid(`${table}.${column.name}.${tag}`);
  if (type === 'boolean') return false;
  if (/^(?:smallint|integer|bigint|numeric|real|double precision)\b/.test(type)) return '1';
  if (/^timestamp|^date$|^time\b/.test(type)) return '2026-01-01T00:00:00Z';
  if (type === 'jsonb' || type === 'json') return '{}';
  if (type === 'bytea') return Buffer.from(stableHash(`${table}.${column.name}.${tag}`), 'hex');
  if (type === 'inet' || type === 'cidr') return '192.0.2.1';
  if (/^(?:character\(3\)|character varying\(3\))$/.test(type) || /(?:^|_)currency$/.test(column.name)) return 'USD';
  const length = /^(?:character varying|character)\((\d+)\)$/.exec(type);
  if (type === 'text' || type === 'citext' || length !== null) {
    const text = `rls-${column.name}-${tag}`;
    return length === null ? text : text.slice(0, Number(length[1]));
  }
  return undefined;
}

/**
 * Builds one row of `table`: `overrides` first (the isolation key, ids, standard-column stamps, per-table fixtures),
 * then every NOT NULL column without a default gets a synthetic value. Nullable and defaulted columns are omitted.
 * `tag` makes text values unique per row (unique constraints). Throws {@link RowSynthesisError} naming the column when
 * a type has no synthetic value: add a `ROW_OVERRIDES` entry for it (never a skip).
 */
export function synthesiseRow(table: LiveTable, overrides: Readonly<Record<string, unknown>>, tag: string): SynthesisedRow {
  const known = new Set(table.columns.map((column) => column.name));
  const unknown = Object.keys(overrides).filter((name) => !known.has(name));
  if (unknown.length > 0) throw new RowSynthesisError(`${table.name}: override for unknown column(s) ${unknown.join(', ')}`);
  const columns: string[] = [];
  const values: unknown[] = [];
  for (const column of table.columns) {
    if (Object.hasOwn(overrides, column.name)) {
      columns.push(column.name);
      values.push(overrides[column.name]);
    } else if (column.notNull && !column.hasDefault) {
      const value = syntheticValue(table.name, column, tag);
      if (value === undefined) {
        throw new RowSynthesisError(
          `${table.name}.${column.name} (${column.type}): no synthetic value; add it to ROW_OVERRIDES in tests/generated/rls/fixtures.ts`,
        );
      }
      columns.push(column.name);
      values.push(value);
    }
  }
  return { columns, values };
}

/** The standard-column set (data-model §1.3, §7.6): present in full = the stamps must be valid on every write. */
export const STD_COLUMNS = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'version'] as const;

export const hasStdColumns = (table: LiveTable): boolean =>
  STD_COLUMNS.every((name) => table.columns.some((column) => column.name === name));

/** Standard-column stamps that satisfy `platform.std_columns_guard()` for an INSERT by `actor`. */
export const insertStamps = (table: LiveTable, actor: string): Record<string, unknown> =>
  hasStdColumns(table) ? { created_by: actor, updated_by: actor, version: '1' } : {};
