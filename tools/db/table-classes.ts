/**
 * Table-class manifests (ADR-0005 "Table classes", data-model.md §1.5, §4.3, §4.6 C1/C2/C5; D-ARCH-049).
 *
 * One JSON manifest per module in `tools/db/table-classes/<module>.json` lists every table the module creates in
 * `public` with its tenant class. The manifests are the single source for:
 *  - the RLS renderer (`tools/db/render-rls.ts`): TENANT, GUEST_CAPABLE and USER_OWNED tables get the §4.3 block;
 *  - catalog tests C1/C2 (the GLOBAL/SYSTEM allow-list is derived from the manifests, never typed twice);
 *  - migration-linter rule 9 (a `CREATE TABLE` whose table is in no manifest, or is an RLS class without its
 *    ENABLE + FORCE block in the same file, fails).
 *
 * Manifest shape (validated here; unknown keys are rejected so a typo cannot silently drop a policy):
 *   { "module": "<module>", "tables": [ { "name": "<table>", "class": "<TableClass>", ...flags } ] }
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TABLE_CLASSES = ['TENANT', 'GUEST_CAPABLE', 'USER_OWNED', 'GLOBAL', 'SYSTEM'] as const;
export type TableClass = (typeof TABLE_CLASSES)[number];

/** Classes protected by ENABLE + FORCE ROW LEVEL SECURITY and rendered policies (ADR-0005). */
export const RLS_CLASSES: ReadonlySet<TableClass> = new Set(['TENANT', 'GUEST_CAPABLE', 'USER_OWNED']);

/** Optional per-table flags; each one selects an extra §4.3 template block. */
export interface TableFlags {
  /** `p_<t>__definer_read` (SELECT TO platform_definer) + `GRANT SELECT … TO platform_definer` (§4.3). */
  readonly definerRead?: boolean;
  /** `p_<t>__definer_purge` (DELETE TO platform_definer with the expiry predicate); token tables only (§4.3). */
  readonly definerPurge?: boolean;
  /** Hard-delete allow-list: `DELETE` may be granted to platform_app (C5, linter rule 8). SYSTEM tables only. */
  readonly hardDelete?: boolean;
  /**
   * Append-only table carrying the immutability trigger(s): a BEFORE UPDATE OR DELETE row trigger and a BEFORE TRUNCATE
   * statement trigger, both ENABLE ALWAYS (catalog test C7, data-model §4.6 2026-11-13; D-ARCH-076). Never combined
   * with hardDelete.
   */
  readonly immutable?: boolean;
}

export interface TableClassEntry extends TableFlags {
  readonly module: string;
  readonly name: string;
  readonly class: TableClass;
}

export class TableClassManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TableClassManifestError';
  }
}

export const MANIFEST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'table-classes');

const MODULE_NAME = /^[a-z][a-z0-9-]{0,62}$/;
const TABLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const ENTRY_KEYS: ReadonlySet<string> = new Set(['name', 'class', 'definerRead', 'definerPurge', 'hardDelete', 'immutable']);
const FLAG_KEYS = ['definerRead', 'definerPurge', 'hardDelete', 'immutable'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const isTableClass = (value: unknown): value is TableClass =>
  typeof value === 'string' && (TABLE_CLASSES as readonly string[]).includes(value);

function parseEntry(module: string, raw: unknown, where: string): TableClassEntry {
  if (!isRecord(raw)) throw new TableClassManifestError(`${where}: each table entry must be an object`);
  const unknownKey = Object.keys(raw).find((key) => !ENTRY_KEYS.has(key));
  if (unknownKey !== undefined) throw new TableClassManifestError(`${where}: unknown key "${unknownKey}"`);
  const { name, class: tableClass } = raw;
  if (typeof name !== 'string' || !TABLE_NAME.test(name)) {
    throw new TableClassManifestError(`${where}: "name" must be a lowercase SQL identifier`);
  }
  if (!isTableClass(tableClass)) {
    throw new TableClassManifestError(`${where}: table "${name}" has class outside ${TABLE_CLASSES.join('|')}`);
  }
  const flags: { -readonly [K in keyof TableFlags]: TableFlags[K] } = {};
  for (const key of FLAG_KEYS) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') throw new TableClassManifestError(`${where}: "${key}" of "${name}" must be a boolean`);
    flags[key] = value;
  }
  if (flags.hardDelete === true && tableClass !== 'SYSTEM') {
    throw new TableClassManifestError(`${where}: "hardDelete" is allowed on SYSTEM tables only ("${name}")`);
  }
  if (flags.immutable === true && (flags.hardDelete === true || flags.definerPurge === true)) {
    throw new TableClassManifestError(`${where}: an "immutable" table cannot be on a delete allow-list ("${name}")`);
  }
  if ((flags.definerRead === true || flags.definerPurge === true) && !RLS_CLASSES.has(tableClass)) {
    throw new TableClassManifestError(`${where}: definer policies need an RLS class ("${name}")`);
  }
  if (flags.definerPurge === true && flags.definerRead !== true) {
    // A DELETE … WHERE also applies the SELECT policy (data-model §4.3), so a purge table needs the read policy too.
    throw new TableClassManifestError(`${where}: "definerPurge" requires "definerRead" ("${name}")`);
  }
  return { module, name, class: tableClass, ...flags };
}

/** Parses one manifest's JSON text; `fileName` must be `<module>.json` and match the `module` field. */
export function parseManifest(fileName: string, text: string): readonly TableClassEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new TableClassManifestError(`${fileName}: not valid JSON`);
  }
  if (!isRecord(raw)) throw new TableClassManifestError(`${fileName}: the manifest must be an object`);
  const unknownKey = Object.keys(raw).find((key) => key !== 'module' && key !== 'tables' && key !== '$comment');
  if (unknownKey !== undefined) throw new TableClassManifestError(`${fileName}: unknown key "${unknownKey}"`);
  const { module, tables } = raw;
  if (typeof module !== 'string' || !MODULE_NAME.test(module)) {
    throw new TableClassManifestError(`${fileName}: "module" must be a lowercase module name`);
  }
  if (basename(fileName) !== `${module}.json`) {
    throw new TableClassManifestError(`${fileName}: file name must be "${module}.json"`);
  }
  if (!Array.isArray(tables)) throw new TableClassManifestError(`${fileName}: "tables" must be an array`);
  return tables.map((entry: unknown, index) => parseEntry(module, entry, `${fileName} tables[${String(index)}]`));
}

/** Merges manifests; a table listed twice (in one or several modules) is an error. Sorted by table name. */
export function mergeManifests(manifests: readonly (readonly TableClassEntry[])[]): readonly TableClassEntry[] {
  const byName = new Map<string, TableClassEntry>();
  for (const entry of manifests.flat()) {
    const existing = byName.get(entry.name);
    if (existing !== undefined) {
      throw new TableClassManifestError(`table "${entry.name}" is listed by "${existing.module}" and "${entry.module}"`);
    }
    byName.set(entry.name, entry);
  }
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Loads every `*.json` manifest of `dir` (default `tools/db/table-classes`). */
export function loadTableClasses(dir: string = MANIFEST_DIR): readonly TableClassEntry[] {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort();
  return mergeManifests(files.map((file) => parseManifest(file, readFileSync(join(dir, file), 'utf8'))));
}

/** Tables flagged `immutable`: the C7 list (append-only tables carrying the immutability triggers). */
export function immutableTables(entries: readonly TableClassEntry[]): readonly string[] {
  return entries.filter((entry) => entry.immutable === true).map((entry) => entry.name);
}

/** Tables outside RLS (GLOBAL and SYSTEM): the C1/C2 allow-list. */
export function rlsAllowList(entries: readonly TableClassEntry[]): readonly string[] {
  return entries.filter((entry) => !RLS_CLASSES.has(entry.class)).map((entry) => entry.name);
}
