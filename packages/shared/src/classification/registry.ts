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
 * the SYSTEM-no-PII rule of C10 holds for the entry table as written (D-TASK028-03; ruled by D-ARCH-148, which amends
 * data-model §3.4 from "PER (token)" to "INT (token)"). `old_value` / `new_value` / `details` are INTERNAL after
 * redaction and tokenisation (data-model §3.4).
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
const PER = 'PERSONAL';
const SEC = 'SECRET';

/** The standard columns (data-model P2): always INTERNAL. */
const STD = { id: INT, created_at: INT, updated_at: INT, created_by: INT, updated_by: INT, version: INT } as const;
/** The soft-delete pair (data-model P2, "STD, SD"): INTERNAL. */
const SD = { deleted_at: INT, deleted_by: INT } as const;

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
  // TASK-040 (data-model §3.5, §6.2): the HTTP idempotency store. response_body is the one PER column a SYSTEM table
  // may hold (C10 exception): AES-256-GCM ciphertext of the caller's own response, kept 24 h; the rest are hashes,
  // identifiers and bookkeeping (idem_key is a client-chosen opaque value, a UUIDv4 by recommendation).
  idempotency_keys: table({
    ...STD,
    scope_hash: INT,
    scope_org_id: INT,
    actor_id: INT,
    method: INT,
    path: INT,
    idem_key: INT,
    fingerprint: INT,
    status: INT,
    lease_until: INT,
    response_status: INT,
    response_headers: INT,
    response_body: PER,
    response_body_key_id: INT,
    expires_at: INT,
  }),
  // data-model §3.2 (TASK-037): the whole pending state of an invitation (D-ARCH-123). The invitee address is PER; the
  // SHA-256 of the one-time invitation token is SEC (a credential verifier, never logged or audited in clear).
  invitations: table({
    ...STD,
    org_id: INT,
    email: PER,
    role_id: INT,
    locale: INT,
    token_hash: SEC,
    status: INT,
    expires_at: INT,
    send_count: INT,
    last_sent_at: INT,
    accepted_at: INT,
    revoked_at: INT,
    accepted_by_user_id: INT,
    revoked_by: INT,
  }),
  // data-model §3.2 (TASK-037): role grants of a membership; ids and timestamps only.
  membership_roles: table({
    ...STD,
    org_id: INT,
    membership_id: INT,
    role_id: INT,
    granted_by: INT,
    revoked_at: INT,
    revoked_by: INT,
  }),
  // data-model §3.2 (TASK-037): ids, status and timestamps only.
  memberships: table({
    ...STD,
    org_id: INT,
    user_id: INT,
    status: INT,
    invitation_id: INT,
    activated_at: INT,
    suspended_at: INT,
    removed_at: INT,
    removed_by: INT,
  }),
  // data-model §3.2 (TASK-037): the profile columns that exist so far. display_name is PER because a personal
  // organisation is named after its user (REQ-ORG-002); the address, country, region and currency columns arrive as
  // expand columns with their reference tables and are classified then.
  organisations: table({
    ...STD,
    ...SD,
    type: INT,
    display_name: PER,
    legal_name: PER,
    contact_email: PER,
    contact_phone_e164: PER,
    default_locale: INT,
    personal_owner_user_id: INT,
  }),
  // TASK-051 (D-ARCH-165): one row per user who may hold a membership of an OPERATOR organisation; ids only.
  operator_staff_grants: table({ ...STD, user_id: INT }),
  // TASK-039: the job idempotency ledger; identifiers and bookkeeping only (the job id names no person).
  job_executions: table({ ...STD, job_key: INT, queue: INT, status: INT, result: INT, completed_at: INT }),
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
  // data-model §3.1 (TASK-037, D-TASK037-01): the minimal users table. email, display_name and time_zone are PER (an
  // IANA zone is a location hint); display_currency arrives with currencies and is classified then.
  users: table({
    ...STD,
    ...SD,
    email: PER,
    email_verified_at: INT,
    display_name: PER,
    status: INT,
    status_changed_at: INT,
    status_reason: INT,
    first_signed_in_at: INT,
    locale: INT,
    time_zone: PER,
    unit_system: INT,
    theme: INT,
    admin_sidebar_collapsed: INT,
    table_density: INT,
    personal_org_id: INT,
    last_active_org_id: INT,
    is_system: INT,
    deletion_requested_at: INT,
  }),
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
