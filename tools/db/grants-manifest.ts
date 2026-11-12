/**
 * Grant manifest parser (`prisma/sql/grants.manifest`; data-model.md §4.4 grant matrix, §4.6 C5; PR8-SEC-10,
 * D-ARCH-069; TASK-016).
 *
 * The manifest lists every table and column privilege of the platform runtime roles, one grant per line. Catalog test
 * C5 compares the live ACLs with {@link grantTuples} of the parsed manifest; {@link validateGrants} cross-checks the
 * manifest with the table-class manifests (DELETE only on the hard-delete allow-list, definer grants only on
 * definer-flagged tables, every table known).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TableClassEntry } from './table-classes.js';

export const GRANTS_MANIFEST = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma', 'sql', 'grants.manifest');

export const GRANTEES = ['platform_app', 'platform_definer', 'platform_erasure'] as const;
export type Grantee = (typeof GRANTEES)[number];
export const PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;
export type Privilege = (typeof PRIVILEGES)[number];

export interface Grant {
  readonly grantee: Grantee;
  readonly privilege: Privilege;
  readonly schema: string;
  readonly table: string;
  /** Column grant when present (sorted); table-level grant otherwise. */
  readonly columns?: readonly string[];
}

export class GrantsManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrantsManifestError';
  }
}

const IDENT = '[a-z_][a-z0-9_]{0,62}';
const LINE = new RegExp(`^(\\S+) (\\S+) (${IDENT})\\.(${IDENT})(?: \\(([^)]*)\\))?$`);
const COLUMN = new RegExp(`^${IDENT}$`);
const SCHEMAS: ReadonlySet<string> = new Set(['public', 'platform']);

const isGrantee = (value: string): value is Grantee => (GRANTEES as readonly string[]).includes(value);
const isPrivilege = (value: string): value is Privilege => (PRIVILEGES as readonly string[]).includes(value);

/** One comparable string per (grantee, privilege, relation, column or `*`). */
export function grantTuples(grants: readonly Grant[]): string[] {
  return grants
    .flatMap((grant) =>
      (grant.columns ?? ['*']).map((column) => `${grant.grantee} ${grant.privilege} ${grant.schema}.${grant.table} ${column}`),
    )
    .sort();
}

/** Parses the manifest text. Blank lines and `#` comments are ignored; duplicates are an error. */
export function parseGrantsManifest(text: string, file = 'grants.manifest'): readonly Grant[] {
  const grants: Grant[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(/#.*$/, '').replace(/\s+/g, ' ').trim();
    if (line === '') return;
    const where = `${file}:${String(index + 1)}`;
    const match = LINE.exec(line);
    if (match === null) throw new GrantsManifestError(`${where}: expected "<grantee> <privilege> <schema>.<table>[ (<columns>)]"`);
    const [, grantee = '', privilege = '', schema = '', table = '', columnList] = match;
    if (!isGrantee(grantee)) throw new GrantsManifestError(`${where}: grantee must be one of ${GRANTEES.join(', ')}`);
    if (!isPrivilege(privilege)) throw new GrantsManifestError(`${where}: privilege must be one of ${PRIVILEGES.join(', ')}`);
    if (!SCHEMAS.has(schema)) throw new GrantsManifestError(`${where}: schema must be public or platform`);
    let columns: string[] | undefined;
    if (columnList !== undefined) {
      columns = columnList.split(',').map((column) => column.trim());
      if (columns.some((column) => !COLUMN.test(column))) throw new GrantsManifestError(`${where}: invalid column list`);
      if (new Set(columns).size !== columns.length) throw new GrantsManifestError(`${where}: duplicate column`);
      if (privilege === 'DELETE') throw new GrantsManifestError(`${where}: DELETE cannot be a column grant`);
      columns.sort();
    }
    grants.push({ grantee, privilege, schema, table, ...(columns ? { columns } : {}) });
  });
  const tuples = grantTuples(grants);
  const duplicate = tuples.find((tuple, index) => tuples[index + 1] === tuple);
  if (duplicate !== undefined) throw new GrantsManifestError(`${file}: duplicate grant ${duplicate}`);
  const tableLevel = new Set(
    grants.filter((g) => g.columns === undefined).map((g) => `${g.grantee} ${g.privilege} ${g.schema}.${g.table}`),
  );
  const shadowed = grants.find((g) => g.columns !== undefined && tableLevel.has(`${g.grantee} ${g.privilege} ${g.schema}.${g.table}`));
  if (shadowed !== undefined) {
    throw new GrantsManifestError(
      `${file}: ${shadowed.grantee} ${shadowed.privilege} on ${shadowed.schema}.${shadowed.table} is both a table and a column grant`,
    );
  }
  return grants;
}

export function loadGrantsManifest(file: string = GRANTS_MANIFEST): readonly Grant[] {
  return parseGrantsManifest(readFileSync(file, 'utf8'), file);
}

/**
 * Cross-checks the grants with the table-class manifests; returns the violations (empty = consistent).
 * Only `public` tables are checked against the manifests (platform holds no table today).
 */
export function validateGrants(grants: readonly Grant[], entries: readonly TableClassEntry[]): string[] {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const problems: string[] = [];
  for (const grant of grants) {
    const label = `${grant.grantee} ${grant.privilege} ${grant.schema}.${grant.table}`;
    if (grant.schema !== 'public') continue;
    const entry = byName.get(grant.table);
    if (entry === undefined) {
      problems.push(`${label}: table is in no table-class manifest`);
      continue;
    }
    if (grant.grantee === 'platform_app' && grant.privilege === 'DELETE' && entry.hardDelete !== true) {
      problems.push(`${label}: DELETE outside the hard-delete allow-list`);
    }
    if (grant.grantee === 'platform_definer') {
      if (grant.privilege === 'SELECT' && entry.definerRead !== true) problems.push(`${label}: table has no definerRead flag`);
      else if (grant.privilege === 'DELETE' && entry.definerPurge !== true) problems.push(`${label}: table has no definerPurge flag`);
      else if (grant.privilege !== 'SELECT' && grant.privilege !== 'DELETE')
        problems.push(`${label}: platform_definer holds SELECT/DELETE only`);
    }
  }
  // The renderer emits the definer grants with the definer policies; the manifest must carry them too.
  const present = new Set(grantTuples(grants));
  for (const entry of entries) {
    if (entry.definerRead === true && !present.has(`platform_definer SELECT public.${entry.name} *`)) {
      problems.push(`platform_definer SELECT public.${entry.name}: definerRead table without its manifest line`);
    }
    if (entry.definerPurge === true && !present.has(`platform_definer DELETE public.${entry.name} *`)) {
      problems.push(`platform_definer DELETE public.${entry.name}: definerPurge table without its manifest line`);
    }
  }
  return problems;
}
