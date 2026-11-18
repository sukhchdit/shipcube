/**
 * Classification checks over the schema (REQ-AUDIT-009, NFR-PRIV-003; data-model §1.2, §4.6 C10, §10.4; PR8-SEC-10;
 * US-091 AT-US-091-04; TASK-028). The registry itself is `packages/shared/src/classification/registry.ts`; this module
 * reads schemas and reports, it classifies nothing.
 *
 *  - {@link prismaSchemaColumns}: every column of every model in `prisma/schema/*.prisma` (the build-time completeness
 *    check, tools/db/classification.test.ts): relation fields are skipped, `@map` / `@@map` give the database names.
 *  - {@link c10Findings}: catalog C10 over the live `information_schema.columns` of `public` and `platform`
 *    (prisma/tests/catalog/c10-classification.int.test.ts): unclassified and stale entries, a PER/SPER column in a
 *    SYSTEM table outside the documented exceptions, and a §10.4 ciphertext/HMAC column without its `<col>_key_id`.
 * Tables outside `public` are registered as `<schema>.<table>` ({@link registryTableName}).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type ClassificationRegistry,
  CLASSIFICATION_REGISTRY,
  classificationOf,
  type FieldClassification,
  type SchemaColumn,
  staleClassifications,
  unclassifiedColumns,
} from '@platform/shared';

import type { TableClassEntry } from './table-classes.js';

/** The registry key of a live table: the bare name in `public`, `<schema>.<table>` elsewhere. */
export const registryTableName = (schema: string, table: string): string => (schema === 'public' ? table : `${schema}.${table}`);

/** Prisma's scalar types; any other field type is a model (a relation field, no column) unless it is an enum. */
const PRISMA_SCALARS: ReadonlySet<string> = new Set([
  'String',
  'Boolean',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'DateTime',
  'Json',
  'Bytes',
]);
const BLOCK_START = /^(model|enum|view|type)\s+([A-Za-z][A-Za-z0-9_]*)\s*\{\s*$/;
const FIELD = /^([A-Za-z][A-Za-z0-9_]*)\s+([A-Za-z][A-Za-z0-9_]*)(?:\("[^"]*"\))?(\[\])?(\?)?(\s.*)?$/;
const MAP = /@map\(\s*(?:name:\s*)?"([^"]+)"/;
const TABLE_MAP = /^@@map\(\s*(?:name:\s*)?"([^"]+)"/;
const TABLE_SCHEMA = /^@@schema\(\s*"([^"]+)"/;

/** The line without its `//` comment; a `//` inside a double-quoted string (`@default("https://x")`) is kept (R1-n7). */
function withoutComment(line: string): string {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line.charAt(index);
    if (char === '"' && line.charAt(index - 1) !== '\\') quoted = !quoted;
    else if (!quoted && char === '/' && line.charAt(index + 1) === '/') return line.slice(0, index);
  }
  return line;
}

interface Block {
  readonly kind: string;
  readonly name: string;
  readonly lines: readonly string[];
}

/** The `model` / `enum` blocks of a schema text (comments removed, one statement per line as Prisma formats it). */
function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  let current: { kind: string; name: string; lines: string[] } | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = withoutComment(raw).trim();
    if (current === undefined) {
      const start = BLOCK_START.exec(line);
      if (start !== null) current = { kind: start[1] as string, name: start[2] as string, lines: [] };
      continue;
    }
    if (line === '}') {
      blocks.push(current);
      current = undefined;
    } else if (line !== '') current.lines.push(line);
  }
  return blocks;
}

/** Every column of every model of the given schema texts, by database table and column name. */
export function schemaColumnsOf(texts: readonly string[]): SchemaColumn[] {
  const blocks = texts.flatMap(blocksOf);
  const enums = new Set(blocks.filter((block) => block.kind === 'enum').map((block) => block.name));
  const columns: SchemaColumn[] = [];
  for (const block of blocks.filter((candidate) => candidate.kind === 'model')) {
    const tableLine = block.lines.find((line) => TABLE_MAP.test(line));
    const schemaLine = block.lines.find((line) => TABLE_SCHEMA.test(line));
    const bare = tableLine === undefined ? block.name : (TABLE_MAP.exec(tableLine)?.[1] as string);
    // A model in another schema (`@@schema("platform")`) is registered as `platform.<table>`, as C10 keys it (R1-n2).
    const schema = schemaLine === undefined ? 'public' : (TABLE_SCHEMA.exec(schemaLine)?.[1] as string);
    const table = registryTableName(schema, bare);
    for (const line of block.lines) {
      if (line.startsWith('@@')) continue;
      const field = FIELD.exec(line);
      if (field === null) continue;
      const [, name = '', type = '', , , rest = ''] = field;
      // A relation field (a model type, or a list of one) has no column; a scalar or enum list (`String[]`) is one.
      if (!PRISMA_SCALARS.has(type) && !enums.has(type) && type !== 'Unsupported') continue;
      columns.push({ table, column: MAP.exec(rest)?.[1] ?? name });
    }
  }
  return columns;
}

/** The columns of every `*.prisma` file in `dir` (default: the repository's `prisma/schema`). */
export function prismaSchemaColumns(dir: string): SchemaColumn[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.prisma'))
    .sort();
  return schemaColumnsOf(files.map((name) => readFileSync(join(dir, name), 'utf8')));
}

/** One row of `information_schema.columns` (partitions excluded by the caller). */
export interface LiveColumn {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
}

/**
 * The documented exceptions to "SYSTEM tables hold no PER/SPER column" (data-model §4.6 C10): the encrypted
 * idempotency response body and the encrypted vault.
 */
export const SYSTEM_PII_EXCEPTIONS: ReadonlySet<string> = new Set(['idempotency_keys.response_body', 'audit_pii_vault.*']);

/**
 * The ciphertext and HMAC lookup columns of data-model §10.4 (amendment SEC-P3-08 item 1) with their sibling key-id
 * column and their data-model §3 class (PR61-SEC-10: C10 pins the class as well as the sibling). The class is the
 * column's `Class` in data-model §3; `mfa_challenges.ip_prefix_hmac` and the M3-seam
 * `carrier_accounts.credentials_ciphertext` carry none there and are pinned SECRET (a keyed lookup HMAC and partner
 * credentials; the safe direction). Not listed: the outbox `payload.token_enc` (a JSON member, its sibling is a JSON
 * member) and the reserved `user_credentials.pepper_key_id` (SEC-P3-16 backlog).
 */
export const KEY_ID_SIBLINGS: readonly (readonly [table: string, column: string, sibling: string, classification: FieldClassification])[] =
  Object.freeze([
    ['mfa_totp', 'secret_ciphertext', 'secret_ciphertext_key_id', 'SECRET'],
    ['mfa_recovery_codes', 'code_hmac', 'code_hmac_key_id', 'SECRET'],
    ['mfa_challenges', 'ip_prefix_hmac', 'ip_prefix_hmac_key_id', 'SECRET'],
    ['mfa_enrolment_codes', 'code_hmac', 'code_hmac_key_id', 'SECRET'],
    ['login_attempt_counters', 'identifier_hmac', 'identifier_hmac_key_id', 'SECRET'],
    ['audit_pii_vault', 'ciphertext', 'ciphertext_key_id', 'SECRET'],
    ['audit_pii_vault', 'value_hmac', 'value_hmac_key_id', 'SECRET'],
    ['audit_entries', 'ip_hash', 'ip_hash_key_id', 'INTERNAL'],
    ['tracking_index', 'customer_ref_postcode_hmac', 'customer_ref_postcode_hmac_key_id', 'INTERNAL'],
    ['idempotency_keys', 'response_body', 'response_body_key_id', 'PERSONAL'],
    ['shipment_party_identifiers', 'value_ciphertext', 'value_ciphertext_key_id', 'SENSITIVE_PERSONAL'],
    ['carrier_accounts', 'credentials_ciphertext', 'credentials_ciphertext_key_id', 'SECRET'],
  ]);

const isPersonal = (classification: string | undefined): boolean =>
  classification === 'PERSONAL' || classification === 'SENSITIVE_PERSONAL';

export interface C10Input {
  readonly columns: readonly LiveColumn[];
  /** The table-class manifests (tools/db/table-classes): which tables are SYSTEM. */
  readonly tableClasses: readonly Pick<TableClassEntry, 'name' | 'class'>[];
  readonly registry?: ClassificationRegistry;
}

/** Catalog C10: every violation as one line naming the table and column (empty = pass). */
export function c10Findings(input: C10Input): string[] {
  const registry = input.registry ?? CLASSIFICATION_REGISTRY;
  const columns = input.columns.map(({ schema, table, column }) => ({ table: registryTableName(schema, table), column }));
  const present = new Set(columns.map(({ table, column }) => `${table}.${column}`));
  const system = new Set(input.tableClasses.filter((entry) => entry.class === 'SYSTEM').map((entry) => entry.name));
  const findings = [
    ...unclassifiedColumns(columns, registry).map((key) => `${key}: no classification registry entry`),
    ...staleClassifications(columns, registry).map((key) => `${key}: registry entry for a column that does not exist`),
  ];
  for (const { table, column } of columns) {
    if (!system.has(table) || !isPersonal(classificationOf(table, column, registry))) continue;
    if (SYSTEM_PII_EXCEPTIONS.has(`${table}.${column}`) || SYSTEM_PII_EXCEPTIONS.has(`${table}.*`)) continue;
    findings.push(`${table}.${column}: PERSONAL / SENSITIVE_PERSONAL column in a SYSTEM table`);
  }
  for (const [table, column, sibling, expected] of KEY_ID_SIBLINGS) {
    if (!present.has(`${table}.${column}`)) continue;
    if (!present.has(`${table}.${sibling}`)) findings.push(`${table}.${column}: no sibling key-id column ${sibling} (data-model §10.4)`);
    const actual = classificationOf(table, column, registry);
    if (actual !== undefined && actual !== expected) {
      findings.push(`${table}.${column}: classified ${actual}, data-model §3 says ${expected} (PR61-SEC-10)`);
    }
  }
  return findings.sort();
}
