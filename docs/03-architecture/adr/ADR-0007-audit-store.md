# ADR-0007: Immutable audit store — partitions, triggers, roles, hash chain scope, same-transaction writes, redaction and privacy erasure

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect, data-architect (security-analyst and compliance review at P6)
- **Related:** brief §4.9, §4.12; REQ-AUDIT-001..025, DR-A09..A13; NFR-AUDIT-001..007, NFR-PRIV-002/003; A-043 (chain scope), A-044, A-045 (erasure mechanism), A-046; ADR-0005 (RLS), ADR-0003 (route metadata)

## Context

The audit trail is a standing obligation: automatic capture via route metadata, a fixed entry schema, DB-enforced immutability (app role INSERT/SELECT only; triggers for every role), SHA-256 hash chain with scheduled verification, monthly range partitions with later S3 Object Lock archive, same-transaction writes for mutations, fail-closed sensitive reads, redaction, and a privacy-erasure mechanism that "works without breaking the chain" — the brief leaves two choices to this ADR: the **hash-chain scope** (A-043 proposes per-organisation streams) and the **erasure mechanism** (per-subject key shredding vs tokenised identifiers, A-045).

## Decision

### Storage

- `audit_entries` **range-partitioned by month on `occurred_at`** (PK `(occurred_at, id)`; `id` UUIDv7). Partitions `audit_entries_YYYY_MM` created by the initial migration (current + 3) and by the daily `audit-maintenance` job (REQ-AUDIT-017); **no default partition**, so an insert with no partition fails and the business transaction rolls back (fail closed). `audit_partitions(name, from, to, created_at, archived_at NULL, archive_manifest_sha256 NULL)` records metadata and the M5 archive marker (REQ-AUDIT-018).
- Columns per REQ-AUDIT-003 plus `stream_id uuid NOT NULL`, `target_org_id uuid NULL` (operator cross-tenant), `prev_hash bytea(32)`, `entry_hash bytea(32) UNIQUE` (per partition; uniqueness across partitions is enforced by the chain itself), `pii_token_count int`. Indexes: `(stream_id, occurred_at DESC)`, `(org_id, occurred_at DESC)`, `(user_id, occurred_at DESC)`, `(entity_name, entity_id, occurred_at DESC)`, `(action, occurred_at DESC)`, `(correlation_id)`, `(outcome, occurred_at DESC)`; `ip` filter uses `(ip, occurred_at DESC)`. Query-plan tests prove a one-day filter prunes to one partition (REQ-AUDIT-016).
- **Immutability:** `platform_app` has `INSERT, SELECT` only; `BEFORE UPDATE OR DELETE` row trigger and `BEFORE TRUNCATE` statement trigger on the parent and every partition raise `audit_entries are append-only` for every role including the owner; partitions are never dropped or detached in this run (REQ-AUDIT-014/018). Tests attempt UPDATE/DELETE/TRUNCATE/DROP TRIGGER as `platform_app`, `platform_migrator` and the owner (REQ-AUDIT-015).

### Capture

`packages/audit` middleware, driven by `defineRoute().audit` (ADR-0003): for mutations it computes the field-level diff (RFC 8785 canonical, deterministic key order; `CREATE` = full new value, `UPDATE` = changed fields only, `DELETE` = last old value; no-op updates write nothing unless `audit_noop`), redacts, tokenises PII, computes the chain hash and inserts **inside the business transaction** (`withTenantTx`), so neither exists without the other (REQ-AUDIT-004; failure → 500 `AUDIT_WRITE_FAILED`). `STATE_TRANSITION` entries are written by the state machine through the same writer. For `VIEW`/`DOWNLOAD` of `SENSITIVE` entities (DR-A12) the entry is written before the response is released and the request fails closed with 503 `AUDIT_UNAVAILABLE` (REQ-AUDIT-005); `NORMAL` reads are best-effort. `FAILED` outcomes (409/422/5xx after authorisation) are written in a separate transaction; 400 validation failures are logged only (REQ-AUDIT-010). Actor types `USER | API_KEY | SYSTEM_JOB | ANONYMOUS`; sources `web | admin | api | worker` (from `X-Client-App`/process). Allow-listed direct callers of the writer: identity events (login/logout/failures/MFA), permission denials, config changes, system jobs, state machine — enforced by lint (REQ-AUDIT-001).

### Hash chain — scope decision (A-043 accepted, refined)

**One chain per audit stream**, `stream_id = org_id` for tenant entries and the all-zero UUID for the `SYSTEM` stream (entries without an organisation: anonymous logins, system jobs, config changes). Inside the business transaction the writer takes `pg_advisory_xact_lock(hashtext('audit:' || stream_id))`, reads the stream head (`audit_stream_heads(stream_id, head_hash, head_entry_id, entry_count)` — updated in the same transaction), computes `entry_hash = SHA-256(JCS(entry without prev_hash/entry_hash) || prev_hash)` (first `prev_hash` = 32 zero bytes), inserts the entry and updates the head. The per-stream lock serialises only writers of the same organisation (REQ-AUDIT-012: 50 parallel writers → distinct predecessors), never the whole platform. **Global anchoring without global serialisation:** the nightly job writes a `SYSTEM`-stream `CHAIN_CHECKPOINT` entry whose value lists every stream's `(stream_id, head_hash, entry_count)`, so a deleted-and-rebuilt tenant stream would contradict a checkpoint. Trade-off accepted: a break can only be localised per stream (which is also how auditors query). Verification job (REQ-AUDIT-013): hourly incremental from `audit_chain_verifications.last_verified_entry` per stream, nightly full; result rows store `ok`, `first_broken_entry_id`; a break logs ERROR, increments `audit_chain_broken_total`, emits security event `audit_chain_broken`, marks readiness degraded. Budget: 1 M entries ≤ 5 min (NFR-AUDIT-003) — streaming SHA-256 in the worker, ordered scan per stream by `(stream_id, occurred_at, id)`.

### Redaction and classification

`packages/audit/classification.ts` registers, per audited entity, every field's class `PUBLIC | INTERNAL | PERSONAL | SENSITIVE_PERSONAL | SECRET`; a build-time test fails for an audited entity with an unclassified field (REQ-AUDIT-009, NFR-PRIV-003) and feeds the Pino redaction list (NFR-PRIV-001). `SECRET` values (passwords, hashes, tokens, TOTP secrets, recovery codes, authorisation headers, card/gateway fields) become the literal `[REDACTED]` **before hashing**, so the hash is stable and the secret never exists in the row (REQ-AUDIT-008).

### Privacy erasure — mechanism decision (A-045): **tokenised identifiers with an encrypted vault**

`PERSONAL`/`SENSITIVE_PERSONAL` values in `old_value`/`new_value` are replaced by `{"$pii": "<token>"}` (token = UUIDv7). The value is stored in `audit_pii_vault(token PK, subject_id → data_subjects, entity_name, field, classification, ciphertext bytea, created_at)` encrypted with AES-256-GCM under a per-environment data key wrapped by KMS (local: config key). `data_subjects(id, kind USER | CONTACT, ref_id)` identifies the natural person (the user, or a sender/receiver contact). The chain hashes the **token**, never the value. Erasure (M4/M5 jobs) hard-deletes vault rows of a subject (allow-listed hard delete); the viewer renders `[ERASED]` for a missing token; the chain still verifies; closed partitions exported to S3 Object Lock contain no personal data, which is the decisive argument against key shredding (whose ciphertext would sit forever in an un-deletable compliance-mode object and would still be *personal data* under GDPR Art. 4(1) until the key is destroyed, requiring proof of key destruction). Vault reads are themselves `SENSITIVE` views (audited) and allowed only to `audit:read` holders; vault rows are never exported with partitions. Cost: one extra insert per PII field per entry (batched in the same transaction) and a join on viewer reads (paginated, ≤ 200 rows).

### Viewer (D-008 scope)

`GET /audit/entries` (keyset pagination on `(occurred_at, id)`, required date range ≤ 31 d, filters per REQ-AUDIT-019 mapped to the indexes above), `GET /audit/entries/{id}`, `GET /audit/entities/{entity}/{id}/history`, `GET /audit/chain/status`. Each viewer request writes its own `VIEW` entry (filter summary + count) **after** the result set is fixed, fail-closed (REQ-AUDIT-022); operator cross-tenant scope applies (ADR-0005). Exports, regulator report and signed actions are M2 (`reasonRequired` and `EXPORT` action exist now).

### Archive seam (M5)

`AuditArchiver` interface (`exportPartition(name) → {objectKey, manifestSha256}`) + `archived_at` marker; the S3 Object Lock bucket and job are M5 (NFR-AUDIT-007 DEFERRED). PII vault is excluded from archives by design.

## Alternatives considered

- **Single global chain.** Simplest verification but every write on the platform serialises on one lock (REQ-AUDIT-012 explicitly rejects; ~300 rps would be bound by one row lock).
- **Chain per partition/month.** Avoids locks only if writes are single-threaded per month — same problem.
- **Per-subject key shredding (A-045 option 1).** Keeps values inline (simpler reads) but the ciphertext lands in immutable archives; erasure then depends on key destruction evidence and per-subject key management (tens of thousands of keys). Rejected for the archive reason above.
- **Hashing/pseudonymising PII inline (HMAC).** Irreversible for the viewer; auditors need the values.
- **Application-level immutability only.** Rejected by brief §4.9 ("enforced in the database").

## Consequences

- Positive: DB-enforced append-only; chain verification is parallel per stream; erasure is a delete of vault rows; archives are PII-free; one writer code path.
- Negative: two inserts per PII-bearing entry; the viewer joins the vault; checkpoint entries add a few rows per night; partition maintenance is a hard dependency (readiness degraded < 2 future months).
- Verification: audit test generator (REQ-AUDIT-024, NFR-AUDIT-001/006), immutability tests for every role (NFR-AUDIT-002), chain corruption detection test (NFR-AUDIT-003), classification completeness test (NFR-PRIV-003), redaction property test (NFR-PRIV-002), overhead benchmark (NFR-AUDIT-005).

## Amendments after the threat model (2026-11-12, threat-model.md R-09..R-12, T-84, T-85, T-88)

1. **SYSTEM stream is sharded (R-10, T-85).** Entries without an organisation use `stream_id = SYSTEM_SHARD[n]` with `n = hash(correlation_id) mod 16` (UUIDs `00000000-0000-0000-0000-0000000000NN`), so anonymous logins, public lookups and webhooks do not serialise on one lock. Verification and the nightly checkpoint cover all 16 shards; the viewer treats them as one logical SYSTEM stream.
2. **Personal data never enters the chain in clear (R-11).** `ip`, `user_agent_raw`, `reason`, list-filter values and `target_org_id`-related free text are classified `PERSONAL` and tokenised through the vault like other PII; filtering by IP uses `ip_hash = HMAC-SHA256(AUDIT_INDEX_KEY, ip)` and `ip_coarse` (/24 or /48, not personal data at that granularity) which stay in clear and indexed. The viewer resolves tokens for `audit:read` holders and shows `[ERASED]` after erasure.
3. **Signed, externally anchored checkpoints (R-09, T-84 — P2, designed now, enforced at M5).** The nightly `CHAIN_CHECKPOINT` is additionally signed with an HMAC key the database never holds (`AUDIT_CHECKPOINT_KEY` from Secrets Manager/KMS) and its hash is written to an append-only external location (CloudWatch Logs with retention lock / the Object Lock bucket at M5; a local file in Compose), so a database superuser cannot recompute the chain undetected.
4. **No runtime audit-off switch (R-12, T-88).** The NFR-AUDIT-005 A/B benchmark uses a **build-time** profile (`BENCHMARK_AUDIT_OFF=1` at image build producing a separately tagged `-bench` image that refuses to start when `APP_ENV` is `staging` or `production`); there is no runtime flag that disables audit.
5. **Denied/failed floods.** `PERMISSION_DENIED` and `webhook_signature_invalid` entries remain one per event (REQ-RBAC-007, REQ-PAY-011) but are written to the SYSTEM shards or the actor's stream under the per-IP rate limits of DR-A22, which bound their rate; aggregation is revisited if P6 benchmarks show pressure.
6. **Physical refinements (data-model.md §5/§12).** `entry_hash` is `UNIQUE (entry_hash, occurred_at)` per partition (a partitioned table cannot carry a global unique without the partition key); a dense `stream_seq bigint` per stream gives explicit chain order and gap detection; the verifier checks global hash uniqueness and gap-free sequences. The nightly checkpoint stores the SHA-256 digest of the ordered `(stream_id, head_hash, stream_seq)` list (full list in `audit_checkpoint_heads`), and the external anchor signs that digest. Append-only tables are exempt from `updated_at/updated_by/version` (NFR-DATA-003 exemption for product-manager). Vault deletions use the `platform_erasure` role (ADR-0005 amendment 6).

## Reversibility

Low once production data exists (hash scheme and token format are load-bearing); medium during this run.
