/**
 * The field classification registry (REQ-AUDIT-009, NFR-PRIV-003, NFR-PRIV-002; data-model §1.2, §10.4; ADR-0007
 * §Redaction and classification; US-091; TASK-028). Every column of every table in `public` and `platform` has exactly
 * one class. The registry drives the audit redaction (`packages/audit/src/redaction`: SECRET becomes `[REDACTED]`
 * before hashing, PERSONAL / SENSITIVE_PERSONAL are tokenised into the vault), and is the source of two tests:
 *  - the completeness check over `prisma/schema` (tools/db/classification.test.ts): a model column without an entry
 *    fails the build, naming the table and the column (AT-US-091-04);
 *  - catalog C10 against the live schema (prisma/tests/catalog/c10-classification.int.test.ts): every column of
 *    `information_schema.columns` has an entry and no entry is stale; SYSTEM tables hold no PER/SPER column except the
 *    documented exceptions; every §10.4 ciphertext/HMAC column has its `<col>_key_id` sibling.
 *
 * A task that creates a table adds its columns here in the same change (the two tests above refuse it otherwise).
 *
 * Vault token columns (`audit_entries.ip_token`, `user_agent_token`, `reason_token`) are INTERNAL: they hold a
 * pseudonymous reference whose PERSONAL value lives (encrypted) in `audit_pii_vault` and disappears with erasure, so
 * the SYSTEM-no-PII rule of C10 holds for the entry table as written (D-TASK028-03). `old_value` / `new_value` /
 * `details` are INTERNAL after redaction and tokenisation (data-model §3.4).
 */

/** The REQ-AUDIT-009 classes, in increasing sensitivity. */
export const FIELD_CLASSIFICATIONS = ['PUBLIC', 'INTERNAL', 'PERSONAL', 'SENSITIVE_PERSONAL', 'SECRET'] as const;
export type FieldClassification = (typeof FIELD_CLASSIFICATIONS)[number];

/** The data-model §1.2 tag of each class (the column `Class` of data-model §3). */
export const CLASSIFICATION_TAGS: Readonly<Record<FieldClassification, string>> = Object.freeze({
  PUBLIC: 'PUB',
  INTERNAL: 'INT',
  PERSONAL: 'PER',
  SENSITIVE_PERSONAL: 'SPER',
  SECRET: 'SEC',
});

const CLASSIFICATION_SET: ReadonlySet<string> = new Set(FIELD_CLASSIFICATIONS);
export const isFieldClassification = (value: unknown): value is FieldClassification =>
  typeof value === 'string' && CLASSIFICATION_SET.has(value);

/** Table name -> column name -> class. */
export type ClassificationRegistry = Readonly<Record<string, Readonly<Record<string, FieldClassification>>>>;

const INT = 'INTERNAL';
const PUB = 'PUBLIC';
const SEC = 'SECRET';

/** The standard columns (data-model P2): always INTERNAL. */
const STD = { id: INT, created_at: INT, updated_at: INT, created_by: INT, updated_by: INT, version: INT } as const;

const table = (columns: Readonly<Record<string, FieldClassification>>): Readonly<Record<string, FieldClassification>> =>
  Object.freeze({ ...columns });

/** The platform registry, by table (alphabetical). */
export const CLASSIFICATION_REGISTRY: ClassificationRegistry = Object.freeze({
  // Prisma migration history (SYSTEM, no runtime grant): migration names, checksums and step logs.
  _prisma_migrations: table({
    id: INT,
    checksum: INT,
    finished_at: INT,
    migration_name: INT,
    logs: INT,
    rolled_back_at: INT,
    started_at: INT,
    applied_steps_count: INT,
  }),
  // ADR-0007 amendment 7: signed anchor chain; every column INT (data-model §3.4).
  audit_anchors: table({
    anchor_seq: INT,
    checkpoint_entry_id: INT,
    created_at: INT,
    heads_digest: INT,
    prev_anchor_hash: INT,
    anchor_hash: INT,
    algorithm: INT,
    key_id: INT,
    signature: INT,
  }),
  audit_chain_verifications: table({
    ...STD,
    run_kind: INT,
    status: INT,
    started_at: INT,
    finished_at: INT,
    streams_checked: INT,
    entries_checked: INT,
    first_broken_stream_id: INT,
    first_broken_entry_id: INT,
    first_broken_occurred_at: INT,
    failure_kind: INT,
    checkpoint_entry_id: INT,
    anchor_seq_from: INT,
    anchor_seq_to: INT,
  }),
  audit_checkpoint_heads: table({
    ...STD,
    checkpoint_entry_id: INT,
    stream_id: INT,
    entry_count: INT,
    head_hash: INT,
    head_occurred_at: INT,
  }),
  // data-model §3.4: personal values are vault tokens (INT references, see the header); JSON values are redacted and
  // tokenised before they are hashed or stored.
  audit_entries: table({
    id: INT,
    occurred_at: INT,
    stream_id: INT,
    stream_seq: INT,
    org_id: INT,
    target_org_id: INT,
    scope_org_id: INT,
    on_behalf_of_org_id: INT,
    actor_type: INT,
    user_id: INT,
    api_key_id: INT,
    job_name: INT,
    actor_roles: INT,
    session_id: INT,
    ip_token: INT,
    ip_hash: INT,
    ip_hash_key_id: INT,
    ip_coarse: INT,
    user_agent_token: INT,
    ua_parsed: INT,
    source_app: INT,
    correlation_id: INT,
    action: INT,
    entity_name: INT,
    entity_id: INT,
    outcome: INT,
    reason_token: INT,
    reauth_proof_id: INT,
    signature_meaning: INT,
    http_method: INT,
    route: INT,
    old_value: INT,
    new_value: INT,
    details: INT,
    pii_token_count: INT,
    hash_version: INT,
    prev_hash: INT,
    entry_hash: INT,
  }),
  audit_partitions: table({
    ...STD,
    partition_name: INT,
    range_start: INT,
    range_end: INT,
    closed_at: INT,
    row_count_at_close: INT,
    archived_at: INT,
    archive_object_key: INT,
    archive_manifest_sha256: INT,
  }),
  // data-model §3.4 / §5.7: the encrypted vault. `ciphertext` holds PER/SPER values under AES-256-GCM and the dedupe
  // HMAC is keyed; both SECRET (never logged, never returned). `token` is the key (no `id`).
  audit_pii_vault: table({
    token: INT,
    created_at: INT,
    updated_at: INT,
    created_by: INT,
    updated_by: INT,
    version: INT,
    subject_id: INT,
    classification: INT,
    entity_name: INT,
    field: INT,
    value_hmac: SEC,
    value_hmac_key_id: INT,
    ciphertext: SEC,
    ciphertext_key_id: INT,
  }),
  audit_stream_heads: table({
    ...STD,
    stream_id: INT,
    entry_count: INT,
    head_entry_id: INT,
    head_occurred_at: INT,
    head_hash: INT,
    last_verified_seq: INT,
    last_verified_hash: INT,
    last_verified_occurred_at: INT,
  }),
  // The bootstrap-lane ledger (tools/db/bootstrap.ts): file names, content hashes and the applying role.
  bootstrap_migrations: table({ file_name: INT, sha256: INT, applied_at: INT, applied_by: INT }),
  // data-model §3.4: who a vault value belongs to (a user or a contact row id), never the value itself.
  data_subjects: table({ ...STD, kind: INT, ref_id: INT, erased_at: INT }),
  // PR8-SEC-10 (ADR-0008 am. 3 item 6, D-ARCH-069): INT except the PUB description and category.
  permissions: table({ ...STD, key: INT, description: PUB, category: PUB, operator_only: INT }),
  reference_dataset_versions: table({
    ...STD,
    dataset: INT,
    dataset_version: INT,
    content_sha256: INT,
    applied_at: INT,
    row_count: INT,
  }),
  role_permissions: table({ ...STD, role_id: INT, permission_id: INT }),
  // PR8-SEC-10: INT except the PUB i18n name key and description.
  roles: table({ ...STD, key: INT, name_key: PUB, scope: INT, is_system: INT, description: PUB }),
});

/** Own-key lookup (a table or column named like an `Object.prototype` member is never classified by accident). */
function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** The class of `table.column`, or undefined when the registry has no entry. */
export function classificationOf(
  tableName: string,
  column: string,
  registry: ClassificationRegistry = CLASSIFICATION_REGISTRY,
): FieldClassification | undefined {
  const columns = own(registry, tableName);
  return columns === undefined ? undefined : own(columns, column);
}

/** A column of a schema, by table and column name. */
export interface SchemaColumn {
  readonly table: string;
  readonly column: string;
}

/** Every entry of a registry as `{ table, column, classification }`. */
export function registeredColumns(
  registry: ClassificationRegistry = CLASSIFICATION_REGISTRY,
): readonly (SchemaColumn & { readonly classification: FieldClassification })[] {
  return Object.entries(registry).flatMap(([tableName, columns]) =>
    Object.entries(columns).map(([column, classification]) => ({ table: tableName, column, classification })),
  );
}

const sortedUnique = (items: readonly string[]): string[] => [...new Set(items)].sort();

/** AT-US-091-04: every schema column without an entry, as `table.column` (sorted). */
export function unclassifiedColumns(
  columns: readonly SchemaColumn[],
  registry: ClassificationRegistry = CLASSIFICATION_REGISTRY,
): string[] {
  return sortedUnique(
    columns
      .filter(({ table: name, column }) => classificationOf(name, column, registry) === undefined)
      .map(({ table: name, column }) => `${name}.${column}`),
  );
}

/** Every entry whose column is not in `columns` (a renamed or dropped column), as `table.column` (sorted). */
export function staleClassifications(
  columns: readonly SchemaColumn[],
  registry: ClassificationRegistry = CLASSIFICATION_REGISTRY,
): string[] {
  const present = new Set(columns.map(({ table: name, column }) => `${name}.${column}`));
  return sortedUnique(
    registeredColumns(registry)
      .map(({ table: name, column }) => `${name}.${column}`)
      .filter((key) => !present.has(key)),
  );
}
