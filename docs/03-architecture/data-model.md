# Data Model: Multi-Carrier Shipping Platform (M0 + M1)

| Field | Value |
|---|---|
| Version | 1.1 (1.0 amended after the P3 architecture security review; amendments listed at the end of §12) |
| Date | 2026-11-12 |
| Owner | data-architect (spawned by principal-architect, P3 Architecture) |
| Status | **Draft for G2** |
| Scope | Every persistent entity required by the M0 and M1 requirements, plus the seams the brief demands (`on_behalf_of_org_id`, `package_type`, `zones`/`zone_countries`, `api_mode`, audit partition archive marker) |
| Inputs | `docs/sdlc/BRIEF.md` §4.2, §4.4–§4.7, §4.9, §4.10, §4.12, §4.13, Appendix A (shape only; the legacy backup was not touched); `docs/01-requirements/REQUIREMENTS.md` v1.1 (all areas, DR-A01..A28, DR-B01..B34, EC-A/EC-B); `docs/01-requirements/NFR.md` (NFR-DATA, NFR-PERF-006, NFR-AUDIT, NFR-TENANT, NFR-REC, NFR-AVAIL-003, NFR-PRIV); `docs/01-requirements/ASSUMPTIONS.md` (A-041..A-082); `docs/sdlc/DECISIONS.md` (D-001..D-037); P3 design brief of 2026-11-12 (fixed decisions ADR-0004/0005/0006/0007/0009/0013/0014/0016); `CLAUDE.md` §5 database guardrail |
| Fixed stack (not re-opened) | PostgreSQL 18, Prisma 7.10.x with `@prisma/adapter-pg` + `pg`, `prisma.config.ts`, Node.js 24 LTS, UUIDv7 keys, Redis 7, S3 API object storage (RustFS locally) |
| External facts checked | Prisma 7 docs and changelog (prisma.io/docs, checked 2026-11-12): driver adapters mandatory, `prisma-client` generator with required `output`, `prisma.config.ts` holds datasource URL, migrations path and seed, `$use` middleware removed (client extensions instead), `partialIndexes` preview feature since 7.4 (`@@index(..., where: raw("..."))`), `tables.external` (preview, `experimental.externalTables`), down migrations via `migrate diff --from-schema … --to-config-datasource --script` + `db execute` + `migrate resolve --rolled-back`. PostgreSQL 18 native `uuidv7()` (release notes, 2025-09-25). |

Conventions in this document: requirement IDs (`REQ-*`), domain rules (`DR-*`), edge cases (`EC-*`), NFR IDs and assumptions (`A-*`) are cited next to the design element they justify. "Brief" means the P3 design brief of principal-architect unless "product brief" is written. Nothing here is code; Prisma schema, migrations and seed scripts are P4/P5 deliverables built from this document.

## Contents

1. Principles, bounded contexts, store selection and table classes
2. ERD (Mermaid) per module
3. Table-by-table specification (columns, constraints, classification, access patterns, indexes)
4. Row-level security: policy templates, settings, roles and grants, catalog tests
5. Audit store SQL: partitioning, immutability triggers, partition pre-creation, hash chaining, verification, PII vault
6. Outbox, idempotency, saga, number sequences; transactions and consistency
7. Prisma 7 mapping notes
8. Migration strategy, backup/restore rehearsal and zero-downtime probe
9. Seed plan
10. Volume and sizing, partitioning outlook, caching, data protection, retention, open issues
11. Handoff Report
12. Principal-architect ratification and reconciliation; amendments after the P3 security review (2026-11-12)

---

## 1. Principles, bounded contexts, store selection and table classes

### 1.1 Data-model principles

| # | Principle | Rule | Source |
|---|---|---|---|
| P1 | Identifiers | Every primary key is `id uuid` generated as UUIDv7 by the application (`uuid` v14 `v7()`), with `DEFAULT uuidv7()` (PostgreSQL 18 native) as a safety net. No serial or identity keys. UUIDv7 gives B-tree locality (append-mostly inserts, fewer page splits) without a central sequence, is safe to generate in API and worker before the insert (needed for saga client references and outbox aggregate IDs) and does not leak row counts the way serials do. Its embedded timestamp reveals creation time to anyone who sees the ID; that is acceptable because no ID is a secret (secrets are separate 256-bit tokens stored hashed). | §4.10, ADR-0009, REQ-RLS-009, NFR-DATA-002 |
| P2 | Standard columns (`STD`) | `id uuid PK`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`, `created_by uuid NOT NULL`, `updated_by uuid NOT NULL`, `version integer NOT NULL DEFAULT 1 CHECK (version >= 1)`. Set by the server (Prisma extension, §7.6), never from client input (REQ-SEC-007). `created_by`/`updated_by` are logical references to `users.id` (not foreign keys: avoids lock traffic on `users` and FK cycles at registration); reserved system actors (§1.6) exist as `users` rows so joins resolve. Append-only tables keep `version = 1` and `updated_* = created_*`. The only exemption is `audit_entries` (§3.4, open issue OI-08). | §4.10, REQ-RLS-009, REQ-RLS-011, DR-A16, NFR-DATA-003 |
| P3 | Soft delete (`SD`) | Soft-deletable tables add `deleted_at timestamptz NULL`, `deleted_by uuid NULL`, `CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))`. Every unique constraint and every list index on such a table is partial `WHERE deleted_at IS NULL`. The runtime role has no `DELETE` on them. Deletion is audited as `DELETE`. Restoring is not offered in this run. | REQ-RLS-010, DR-A17, NFR-DATA-003 |
| P4 | Time | Instants are `timestamptz` (stored UTC, microsecond precision); no `timestamp without time zone` column exists (schema test). Dates that are local by nature (pickup date, holiday) are `date` plus an IANA zone `text` column. Local times of day (cut-off, pickup window) are `time` interpreted in the stated zone. | REQ-RLS-012, DR-A19, NFR-DATA-002 |
| P5 | Money | Every amount is a pair `<name>_minor bigint` + `<name>_currency char(3)` (or one shared `currency char(3)` column per row when all amounts on the row share it), with `CHECK (currency ~ '^[A-Z]{3}$')` and a FK to `currencies(code)` on configuration tables. No `numeric`, `real` or `money` type for amounts. FX rates are `numeric(18,6)` (rates are not money) and travel as strings in the API. | §4.4, ADR-0009, REQ-PRICE-002, REQ-API-016, NFR-DATA-001 |
| P6 | Units | Weights are integer grams (`*_g integer`), lengths integer millimetres (`*_mm integer`), percentages integer basis points (`*_bp integer`, 1 % = 100 bp). | DR-B06, REQ-PRICE-004 |
| P7 | Enumerations | Status, state, type and code columns are `text` with a named `CHECK (col IN (...))` constraint, not PostgreSQL enum types: CHECKs can be widened in an expand migration (`ADD CONSTRAINT … NOT VALID` then `VALIDATE`, drop the old one later) without `ALTER TYPE` locking, and Prisma maps them to `String` typed by the TypeScript unions in `packages/shared`. A catalog test asserts each CHECK list equals its `packages/shared` enum (§4.6). | §4.10, REQ-BOOK-018, REQ-BOOK-028 |
| P8 | JSONB | Only for (a) immutable snapshots (price snapshots, explanations, service-point snapshot, public share snapshot, compliance-pack section content), (b) raw/redacted payload metadata and audit diffs, (c) outcome blobs of saga steps. Never for data that is filtered, joined or constrained; never for serialised addresses or parties (product brief App. A weakness). | §4.10, App. A |
| P9 | Naming | `snake_case`, plural table names, singular column names, FK columns `<entity>_id`. Constraint names: `pk_<table>`, `fk_<table>__<column>`, `ux_<table>__<cols>` (unique index), `ix_<table>__<cols>` (index), `ck_<table>__<rule>`, `ex_<table>__<rule>` (exclusion). Prisma models are PascalCase singular mapped with `@@map`/`@map` (§7.4). | Brief |
| P10 | Tenancy | Tenant-owned rows carry `org_id uuid NOT NULL` (nullable only on guest-capable tables) with RLS `ENABLE` + `FORCE` and a composite index leading with `org_id`. Every table belongs to exactly one class (§1.5). | ADR-0005, REQ-RLS-001/002/013, NFR-TENANT-001 |
| P11 | Optimistic locking | Updates are `UPDATE … SET …, version = version + 1 WHERE id = $id AND version = $expected`; zero rows ⇒ 412 `CONCURRENCY_CONFLICT` (If-Match) or 409 `CONFLICT` (internal). A no-op update issues no statement, no version bump and no audit entry. | REQ-RLS-011, REQ-API-013, DR-A16, EC-A25/A26 |
| P12 | Integrity in the database | Business invariants that are cheap to state declaratively are enforced in the database too (CHECK, partial UNIQUE, composite FK, exclusion constraints, immutability triggers); state machines and cross-row rules stay in the service layer, with the database holding the last line of defence where noted. | §4.10, NFR-DATA-001..004 |
| P13 | Files out of row | Documents, raw carrier payloads and gateway webhook payloads live in object storage; rows hold bucket, key (UUIDs only, no personal data), size, media type and SHA-256. | §4.10, REQ-DOC-006, REQ-CARR-018, REQ-PAY-003 |

### 1.2 Column classification vocabulary (classification registry)

Every column has exactly one classification, used by the field classification registry in `packages/audit` (build-time test, REQ-AUDIT-009, NFR-PRIV-003), Pino redaction (REQ-PLAT-012, NFR-PRIV-001) and the audit PII tokeniser (ADR-0007).

| Tag | Meaning | Audit value handling | Log handling |
|---|---|---|---|
| `PUB` (PUBLIC) | Non-sensitive, may be shown publicly (country codes, canonical status) | Stored as is | Allowed |
| `INT` (INTERNAL) | Business data without personal content (IDs, amounts, states, timestamps, carrier refs) | Stored as is | Allowed (IDs, codes) |
| `PER` (PERSONAL) | Identifies or relates to a natural person (names, emails, phones, addresses, postcodes, IP, user agent, free text typed by users) | Replaced by `{"$pii":"<token>"}`, value in `audit_pii_vault` | Redacted / masked |
| `SPER` (SENSITIVE_PERSONAL) | Government or tax identifiers, identity-document data | As `PER`, vault classification `SENSITIVE_PERSONAL`; never in notifications or public responses | Redacted |
| `SEC` (SECRET) | Password hashes, token hashes, TOTP secrets, recovery codes, gateway tokens, secret references | `[REDACTED]` before hashing (REQ-AUDIT-008) | Redacted |

`STD` and `SD` columns are `INT`. Note: NFR-PRIV-003 cites an example vocabulary (`PII_DIRECT`, `PII_INDIRECT`, `SENSITIVE`, `NONE`); this model uses the REQ-AUDIT-009 five-level vocabulary as the single source (OI-11).

### 1.3 Conceptual model: bounded contexts and aggregates

```mermaid
flowchart LR
  subgraph IAM[Identity and access]
    identity[identity: users, credentials, sessions, MFA, tokens]
    orgs[organisations: orgs, memberships, invitations, address book]
    authz[authz: permissions, roles]
  end
  subgraph COM[Commerce]
    quotes[quotes: quote, packages, options, shares]
    shipments[shipments + customs: shipment aggregate]
    orders[orders: basket, saga]
    payments[payments: payment, history, refunds, methods]
    pricing[pricing: versioned config]
  end
  subgraph FUL[Fulfilment]
    carriers[carriers: carriers, services, accounts, raw payloads]
    documents[documents]
    pickups[pickups]
    tracking[tracking: events, poll schedule, public read model]
    notifications[notifications]
  end
  subgraph XC[Cross-cutting]
    audit[audit: entries, vault, chain]
    platform[platform: outbox, idempotency, flags, sequences, consent]
    reference[reference + compliance packs]
  end
  quotes -->|selected option| shipments
  shipments -->|basket| orders
  orders -->|outbox: order.checkout_started| payments
  orders -->|saga| carriers
  shipments --> documents
  shipments --> pickups
  shipments --> tracking
  tracking -->|outbox| notifications
  pricing --> quotes
  reference --> pricing
  IAM --> COM
  XC -.-> COM
  XC -.-> FUL
```

Aggregates and their consistency boundary (one transaction may change one aggregate plus its outbox event and audit entry; other aggregates react to the event, DR-B04 G4):

| Aggregate (root) | Members | Invariants held in one transaction |
|---|---|---|
| User (`users`) | `user_credentials`, `mfa_totp`, `mfa_recovery_codes`, `sessions`, `notification_preferences` | Status machine DR-A04; at most one pending/active TOTP; recovery batch replaced atomically |
| Organisation (`organisations`) | `memberships`, `membership_roles`, `invitations`, `address_book_entries`, `organisation_tax_references` | Type immutable; one OPERATOR org; at least one ACTIVE Owner (DR-A05); one default sender |
| Quote (`quotes`) | `quote_packages`, `quote_options`, `quote_shares` | Immutable after rating completes except claim/save/delete; claim once (DR-B14) |
| Shipment (`shipments`) | `shipment_parties`, `shipment_party_identifiers`, `shipment_packages`, `customs_declarations`, `customs_items`, `prohibited_acknowledgements`, `shipment_attestations`, `shipment_price_snapshots`, `shipment_state_transitions` | State machine DR-B01 with history row + audit in the same tx (REQ-BOOK-019); single customs currency; snapshot immutability |
| Order (`orders`) | `order_shipments`, `saga_executions`, `saga_steps`, `coupon_redemptions` | 1–10 shipments, one currency (DR-B33); one open order per user and org |
| Payment (`payments`) | `payment_status_history`, `payment_attempts`, `refunds` | DR-B27 transitions; captured ≤ authorised; refunded ≤ captured |
| Document version (`documents`) | — | One CURRENT version per logical document (DR-B26) |
| Pickup (`pickups`) | — | One SCHEDULED pickup per shipment |
| Tracking stream (`tracking_events` per shipment) | `tracking_index`, `tracking_poll_schedule` (global index tables) | Dedupe per shipment (REQ-TRACK-005) |
| Audit stream (`audit_stream_heads` per stream) | `audit_entries`, `audit_pii_vault` | Hash chain continuity under the stream lock (ADR-0007) |

### 1.4 Store selection per context

All system-of-record data lives in one PostgreSQL 18 database (one schema `public` for tables, schema `platform` for functions). A single relational store is chosen because every M0/M1 write path needs atomicity across the business row, the outbox row and the audit entry (REQ-PLAT-016, REQ-AUDIT-004), tenant isolation is enforced by RLS in that same store (ADR-0005), and the projected volume (§10) is far inside one Multi-AZ instance. Redis and object storage hold only derived, ephemeral or binary data.

| Context | Store | Dominant access patterns (frequency at design load, latency target) | Why this store |
|---|---|---|---|
| identity, organisations, authz | PostgreSQL | Login lookup by email (≈ 2/s peak, p95 ≤ 300 ms incl. bcrypt); session validation per request is **not** a DB read (JWT + Redis revocation set, ADR-0006); refresh by token hash (≈ 1/s, ≤ 50 ms); `GET /me` memberships + permissions (per page load, ≤ 50 ms, cached ≤ 5 s REQ-RBAC-008) | Transactions with audit; RLS on users/sessions/memberships (DR-A14) |
| quotes, pricing config | PostgreSQL (+ Redis rate cache 300 s, DR-B15) | Insert quote + options per rate request (≈ 20/s peak, part of the 5 s rate-shopping budget, DB share ≤ 30 ms); read quote by id (SSE fallback, ≤ 50 ms); pricing config loaded once per version into process memory | Quotes must be claimable atomically under RLS (REQ-RLS-013) |
| shipments, customs, orders, payments, saga | PostgreSQL | Wizard saves by id with version check (≈ 10/s, ≤ 100 ms); shipment list per org with keyset pagination (≈ 5/s, p95 ≤ 300 ms at 100k rows, NFR-PERF-006); saga step persistence (≈ 5 bookings/s × 6 steps) | ACID across state + transition + outbox + audit (DR-B04) |
| documents | Object storage (bytes) + PostgreSQL (metadata) | Generate ≈ 4 documents per booking; download URL issue (≤ 300 ms incl. SHA-256 re-check of ≤ 5 MB, REQ-DOC-009) | Binary blobs out of the DB; S3 versioning + SSE (REQ-DOC-006) |
| carriers raw payloads, gateway webhook payloads | Object storage + PostgreSQL metadata | Write-once per carrier call; read only by staff/support (M2) | Keeps rows small (product brief App. A weakness) |
| tracking | PostgreSQL | Poll scheduler scan of due rows (every 30 s, ≤ 50 ms); event insert with dedupe (≈ 20/s at design load); public lookup by hash (50 req/s, p95 ≤ 200 ms, A-031) | Event-driven state transitions must commit with the event |
| notifications | PostgreSQL (templates, preferences, log) + BullMQ (jobs) | Log insert per send; user's own log list | Idempotency keys in the same DB as the outbox |
| audit | PostgreSQL (monthly partitions) → S3 Object Lock archive (M5 seam) | 1 insert per mutating request (in-tx, ≤ 15 ms p95 overhead, NFR-AUDIT-005); viewer queries with mandatory ≤ 31-day range (p95 ≤ 500 ms on 1M rows, NFR-PERF-006) | Same-transaction write (REQ-AUDIT-004); partition pruning |
| platform: outbox, idempotency, flags, sequences | PostgreSQL (+ Redis flag cache 30 s) | Outbox relay poll every 500 ms; idempotency claim per unsafe request; sequence allocation per checkout | Must commit atomically with the business change |
| reference data, compliance packs | PostgreSQL + in-process cache with ETag (`Cache-Control: public, max-age=3600`, REQ-DATA-016) | Read-mostly, ≈ 100 % cache hits | Seeded by migration/seed only (DR-A27) |
| Ephemeral: rate limits, revocation set `revoked:sid`, carrier OAuth tokens, rate cache, permission cache, service-point lookups, SSE fan-out, BullMQ | Redis 7 | Sub-millisecond counters and TTL keys | Loss is tolerable (A-053); nothing in Redis is a system of record |

### 1.5 Table classes (tenant class, ADR-0005)

| Class | `org_id` | RLS | Who can read | Examples |
|---|---|---|---|---|
| `TENANT` | `NOT NULL`, FK `organisations` | ENABLE + FORCE; tenant branch + read-only operator branch (`app_is_operator()`) | Rows of `app.org_id`; verified operator staff (read) | shipments, orders, payments, documents, address_book_entries, saga tables |
| `GUEST_CAPABLE` | nullable; `guest_token_hash` when null | as TENANT + guest branch | As TENANT, or the holder of the guest token | quotes, quote_packages, quote_options, quote_shares |
| `USER_OWNED` | none, or `org_id` for user-private data within an org | ENABLE + FORCE; `user_id = app_actor_id()` (and `org_id = app_org_id()` where present) + operator read + org-member read on `users` | The user; verified operator staff (read) | users, user_credentials, sessions, refresh_tokens, one-time token tables, mfa_* (including `mfa_enrolment_codes`), reauth_proofs, notification_preferences, notification_log, saved_payment_methods, payment_gateway_customers, terms_acceptances, consent_records |
| `GLOBAL` | none | none | Everyone (SELECT); writes only where listed in §4.4 | reference data, compliance packs, carriers, pricing config, roles, permissions, feature flags, number_sequences, notification_templates |
| `SYSTEM` | none (or informational `org_id` on global index tables) | none | Only the owning module's repositories; no personal data except hashes and the encrypted vault | outbox_events, processed_events, idempotency_keys, login_attempt_counters, gateway_webhook_events, global index tables (`tracking_index`, `gateway_refs`, `tracking_poll_schedule`), `audit_*` (entries, stream heads, partitions, verifications, checkpoint heads, anchors, PII vault, data subjects), `bootstrap_migrations` (bootstrap-lane ledger, §8.3) |

Amended 2026-11-12 (SEC-P3-03, SEC-P3-14): `audit_anchors` and the bootstrap-lane ledger `bootstrap_migrations` join the SYSTEM allow-list; `mfa_enrolment_codes` is USER_OWNED. All audit-module tables are owned by `platform_audit_owner`, not `platform_migrator` (§4.4).

The documented list of non-RLS tables (GLOBAL + SYSTEM) is the allow-list of the REQ-RLS-001 build-time test; any table with a column named `org_id` that is not on it must have RLS forced and an `org_id`-leading index (§4.6). Pre-authentication and cross-tenant lookups use only the allow-listed definer functions of §4.5 or the global index tables (ADR-0005 amendment 1).

### 1.6 Reserved identifiers

| Name | Value | Use |
|---|---|---|
| SYSTEM actor | `00000000-0000-7000-8000-000000000001` | `created_by`/`updated_by` and audit `user_id` for seed and system jobs (REQ-RLS-009); seeded `users` row with `is_system = true`, no credentials |
| ANONYMOUS actor | `00000000-0000-7000-8000-000000000002` | `created_by` of guest quotes and anonymous consent records (REQ-AUDIT-011) |
| SYSTEM audit stream shards | `00000000-0000-0000-0000-0000000000NN`, `NN` = `00`…`0f` | `stream_id` of entries without an organisation, shard = `hash(correlation_id) mod 16` (ADR-0007 amendment 1); shard `00` (the nil UUID) also carries the hourly checkpoint (amended 2026-11-12, SEC-P3-03; was nightly) |

Both actor IDs are syntactically valid UUIDv7 (version nibble 7, variant 10, timestamp 0) so the NFR-DATA-002 key test passes.

### 1.7 Enumeration catalogue (CHECK lists; single source `packages/shared`)

| Enum | Values | Source |
|---|---|---|
| `org_type` | `OPERATOR`, `BUSINESS_CUSTOMER`, `PARTNER`, `INDIVIDUAL` | REQ-ORG-001 |
| `user_status` | `PENDING_VERIFICATION`, `ACTIVE`, `SUSPENDED`, `DEACTIVATED` | DR-A04 |
| `membership_status` | `INVITED`, `ACTIVE`, `SUSPENDED`, `REMOVED` | DR-A05 |
| `role_scope` | `OPERATOR`, `CUSTOMER`, `PARTNER` | REQ-ORG-004. *2026-11-12 (D-T013-11, ADR-0008 am. 2):* defined as `RoleScope` in `packages/authz/src/roles.ts` until the shared enum module exists, then moved here |
| `refresh_token_status` | `ACTIVE`, `ROTATED`, `REVOKED` | DR-A03 |
| `session_status` | `ACTIVE`, `REVOKED`, `EXPIRED` | REQ-AUTH-009 |
| `client_app` | `web`, `admin` | ADR-0006 |
| `audit_action` | `CREATE`, `UPDATE`, `DELETE`, `VIEW`, `DOWNLOAD`, `LOGIN`, `LOGOUT`, `LOGIN_FAILED`, `ACCOUNT_LOCKED`, `TOKEN_REUSE_DETECTED`, `MFA_ENROLLED`, `MFA_FAILED`, `PERMISSION_DENIED`, `EXPORT`, `ON_BEHALF_ACTION`, `CONFIG_CHANGE`, `API_KEY_USE`, `STATE_TRANSITION` | REQ-AUDIT-002 (OI-07) |
| `audit_outcome` / `actor_type` / `source_app` | `SUCCESS`, `DENIED`, `FAILED` / `USER`, `API_KEY`, `SYSTEM_JOB`, `ANONYMOUS` / `web`, `admin`, `api`, `worker` | REQ-AUDIT-003/011, DR-A10/A11 |
| `shipment_state` | `DRAFT`, `QUOTED`, `PENDING_PAYMENT`, `PAID`, `BOOKING`, `BOOKED`, `LABEL_READY`, `PICKUP_SCHEDULED`, `DROPPED_OFF`, `IN_TRANSIT`, `CUSTOMS_HOLD`, `OUT_FOR_DELIVERY`, `DELIVERED`, `EXCEPTION`, `RETURNED_TO_SENDER`, `CANCELLED`, `VOIDED`, `REFUNDED`, `CLAIM_OPEN` | REQ-BOOK-018, DR-B01 |
| `transition_trigger` | `USER_ACTION`, `SAGA_STEP`, `CARRIER_EVENT`, `PAYMENT_EVENT`, `SYSTEM_TIMEOUT` | REQ-BOOK-019 |
| `direction` / `content_type` / `package_type` | `EXPORT`, `IMPORT`, `DOMESTIC` / `DOCUMENT`, `PARCEL` / `PARCEL_BOX`, `ENVELOPE` (seam: `PALLET`, `FREIGHT` later) | REQ-BOOK-027/028 |
| `screening_status` | `NOT_SCREENED`, `CLEARED`, `REVIEW`, `BLOCKED` | REQ-CUST-011 |
| `order_status` | `OPEN`, `PENDING_PAYMENT`, `PAID`, `BOOKING`, `BOOKED`, `PARTIALLY_BOOKED`, `FAILED`, `CANCELLED` | Reconciled to the API contract (ADR-0016 amendment 5e; §12 OI-13); no REQ enumerates order states |
| `payment_status` | `CREATED`, `REQUIRES_ACTION`, `AUTHORISED`, `CAPTURED`, `PARTIALLY_CAPTURED`, `VOIDED`, `FAILED`, `REFUND_PENDING`, `REFUNDED`, `REFUND_FAILED` | REQ-PAY-003, DR-B27 |
| `document_type` / `document_status` / `document_format` | `SHIPPING_LABEL`, `COMMERCIAL_INVOICE`, `PRO_FORMA_INVOICE`, `CARRIER_CUSTOMS_DECLARATION`, `PICKUP_CONFIRMATION` / `CURRENT`, `SUPERSEDED`, `VOIDED` / `PDF_4X6`, `PDF_A4`, `PDF_LETTER`, `ZPL` | REQ-DOC-001/002/015 |
| `tracking_status` | `INFO_RECEIVED`, `PICKED_UP`, `DROPPED_OFF`, `IN_TRANSIT`, `CUSTOMS_HOLD`, `CUSTOMS_CLEARED`, `OUT_FOR_DELIVERY`, `DELIVERY_ATTEMPTED`, `DELIVERED`, `EXCEPTION`, `RETURN_INITIATED`, `RETURNED_TO_SENDER`, `CANCELLED` | REQ-TRACK-001, DR-B18 |
| `notification_status` / `channel` | `QUEUED`, `SENT`, `FAILED`, `DEAD_LETTERED`, `SUPPRESSED_BY_PREFERENCE` / `EMAIL`, `SMS`, `WHATSAPP` | REQ-NOTIF-001/012 |
| `api_mode` | `TEST`, `LIVE` | REQ-API-020 (seam) |
| `reference_source` | `ISO`, `SEED`, `SAMPLE`, `OPERATOR` | REQ-DATA-001, DR-A27 |
| `user_status_reason` | `MFA_ENROLMENT_OVERDUE`, `ADMIN_ACTION`, `VERIFICATION_EXPIRED`, `USER_REQUEST` | ADR-0006 amendment 14 (SEC-P3-14); `VERIFICATION_EXPIRED` reserved for the 7-day unverified deactivation of SEC-P3-06 |
| `password_reset_purpose` | `RESET`, `SET_PASSWORD` | ADR-0006 amendment 14 (SEC-P3-14) |
| `job_context_kind` | `outbox_event`, `saga`, `shipment`, `order`, `pickup`, `document`, `payment`, `tracking_poll`, `notification`, `quote` | ADR-0013 amendment (SEC-P3-12); values of `platform.job_context(p_kind, …)`, §4.5 |
| `anchor_algorithm` | `ECDSA_P256_SHA256` | ADR-0007 amendment 7 (SEC-P3-03) |
| `chain_failure_kind` | `HASH_MISMATCH`, `PREV_HASH_MISMATCH`, `SEQ_GAP`, `SEQ_DUPLICATE`, `DUPLICATE_ENTRY_HASH`, `HEAD_MISMATCH`, `CHECKPOINT_HEAD_MISMATCH`, `CHECKPOINT_SIGNATURE_INVALID`, `ANCHOR_MISSING` | REQ-AUDIT-013, ADR-0007 amendment 7 (SEC-P3-03) |

Amended 2026-11-12 (SEC-P3-03, SEC-P3-12, SEC-P3-14): the last five rows were added; `chain_failure_kind` formalises the CHECK list of `audit_chain_verifications.failure_kind` (§3.4) and adds the three anchor-related kinds.


---

## 2. ERD (Mermaid) per module

Mermaid `erDiagram` has no grouping construct, so there is one diagram per module. Attributes are limited to keys and the columns that define relationships or tenancy; full column lists are in §3. Entities from other modules appear with their `id` only. Standard and soft-delete columns are omitted from the diagrams.

### 2.1 Identity

```mermaid
erDiagram
  users ||--o| user_credentials : "has password"
  users ||--o{ email_verification_tokens : "verifies by"
  users ||--o{ password_reset_tokens : "resets by"
  users ||--o{ sessions : "signs in"
  sessions ||--o{ refresh_tokens : "rotates (family)"
  users ||--o{ mfa_totp : "enrols"
  users ||--o{ mfa_recovery_codes : "holds"
  users ||--o{ mfa_challenges : "is challenged"
  users ||--o{ mfa_enrolment_codes : "proves mailbox for first TOTP"
  sessions ||--o{ mfa_enrolment_codes : "requested in"
  sessions ||--o{ reauth_proofs : "re-authenticates"
  users }o--o| organisations : "last_active_org / personal_org"
  users {
    uuid id PK
    text email UK
    text status
    uuid personal_org_id FK
    uuid last_active_org_id FK
  }
  user_credentials {
    uuid id PK
    uuid user_id FK,UK
  }
  email_verification_tokens {
    uuid id PK
    uuid user_id FK
    bytea token_hash UK
  }
  password_reset_tokens {
    uuid id PK
    uuid user_id FK
    bytea token_hash UK
  }
  sessions {
    uuid id PK
    uuid user_id FK
    uuid active_org_id FK
    text client_app
  }
  refresh_tokens {
    uuid id PK
    uuid family_id
    uuid session_id FK
    bytea token_hash UK
    text status
  }
  mfa_totp {
    uuid id PK
    uuid user_id FK
    text status
  }
  mfa_recovery_codes {
    uuid id PK
    uuid user_id FK
    uuid batch_id
  }
  mfa_challenges {
    uuid id PK
    uuid user_id FK
    bytea token_hash UK
  }
  mfa_enrolment_codes {
    uuid id PK
    uuid user_id FK
    uuid session_id FK
    bytea code_hmac
  }
  reauth_proofs {
    uuid id PK
    uuid session_id FK
    bytea token_hash UK
    text scope
  }
  login_attempt_counters {
    uuid id PK
    text kind
    bytea identifier_hmac
  }
  organisations {
    uuid id PK
  }
```

Amended 2026-11-12 (SEC-P3-14): `mfa_enrolment_codes` added (§3.1).

### 2.2 Organisations and authz

```mermaid
erDiagram
  organisations ||--o{ memberships : "has members"
  users ||--o{ memberships : "belongs via"
  memberships ||--|{ membership_roles : "holds"
  roles ||--o{ membership_roles : "assigned as"
  roles ||--o{ role_permissions : "grants"
  permissions ||--o{ role_permissions : "granted by"
  organisations ||--o{ invitations : "invites"
  roles ||--o{ invitations : "offered role"
  organisations ||--o{ address_book_entries : "owns"
  organisations ||--o{ organisation_tax_references : "registers"
  users ||--o{ terms_acceptances : "accepts"
  countries ||--o{ organisations : "country"
  organisations {
    uuid id PK
    text type
    char2 country_code FK
    uuid personal_owner_user_id FK
  }
  memberships {
    uuid id PK
    uuid org_id FK
    uuid user_id FK
    text status
  }
  membership_roles {
    uuid id PK
    uuid org_id FK
    uuid membership_id FK
    uuid role_id FK
  }
  invitations {
    uuid id PK
    uuid org_id FK
    uuid role_id FK
    bytea token_hash UK
  }
  address_book_entries {
    uuid id PK
    uuid org_id FK
    char2 country_code FK
  }
  organisation_tax_references {
    uuid id PK
    uuid org_id FK
  }
  terms_acceptances {
    uuid id PK
    uuid user_id FK
  }
  roles {
    uuid id PK
    text key UK
    text scope
  }
  permissions {
    uuid id PK
    text key UK
  }
  role_permissions {
    uuid id PK
    uuid role_id FK
    uuid permission_id FK
  }
  users {
    uuid id PK
  }
  countries {
    uuid id PK
  }
```

### 2.3 Audit

```mermaid
erDiagram
  audit_stream_heads ||--o{ audit_entries : "chains (stream_id, stream_seq)"
  audit_partitions ||--o{ audit_entries : "holds month of"
  data_subjects ||--o{ audit_pii_vault : "owns tokens"
  audit_pii_vault ||--o{ audit_entries : "referenced by $pii token in values"
  audit_chain_verifications }o--o| audit_entries : "first broken entry"
  audit_chain_verifications ||--o{ audit_checkpoint_heads : "anchors"
  audit_entries ||--o| audit_anchors : "CHAIN_CHECKPOINT entry signed by"
  audit_anchors ||--o| audit_anchors : "prev_anchor_hash chains"
  audit_entries {
    timestamptz occurred_at PK
    uuid id PK
    uuid stream_id
    bigint stream_seq
    uuid org_id
    uuid target_org_id
    bytea prev_hash
    bytea entry_hash
  }
  audit_stream_heads {
    uuid id PK
    uuid stream_id UK
    bigint entry_count
    bytea head_hash
  }
  audit_partitions {
    uuid id PK
    text partition_name UK
    timestamptz archived_at
  }
  audit_pii_vault {
    uuid token PK
    uuid subject_id FK
  }
  data_subjects {
    uuid id PK
    text kind
    uuid ref_id
  }
  audit_chain_verifications {
    uuid id PK
    text run_kind
    text status
  }
  audit_checkpoint_heads {
    uuid id PK
    uuid checkpoint_entry_id
    uuid stream_id
  }
  audit_anchors {
    bigint anchor_seq PK
    uuid checkpoint_entry_id
    bytea heads_digest
    bytea prev_anchor_hash
    bytea anchor_hash UK
    bytea signature
  }
```

Amended 2026-11-12 (SEC-P3-03): `audit_anchors` added (§3.4, §5.5). Every entity in this diagram is owned by `platform_audit_owner` and created only in the bootstrap lane (§4.4, §8.3).

### 2.4 Platform

```mermaid
erDiagram
  outbox_events ||--o{ processed_events : "consumed as"
  feature_flags ||--o{ feature_flag_overrides : "targeted by"
  organisations ||--o{ feature_flag_overrides : "target_org (informational)"
  users ||--o{ consent_records : "decides"
  outbox_events {
    uuid id PK
    text type
    uuid aggregate_id
    timestamptz published_at
  }
  processed_events {
    uuid id PK
    text consumer
    uuid event_id
  }
  idempotency_keys {
    uuid id PK
    bytea scope_hash UK
    text status
  }
  feature_flags {
    uuid id PK
    text key UK
  }
  feature_flag_overrides {
    uuid id PK
    uuid flag_id FK
    text environment
    uuid target_org_id
  }
  number_sequences {
    uuid id PK
    text scope
    char2 country
    bigint next_value
  }
  consent_records {
    uuid id PK
    uuid user_id FK
    uuid anonymous_id
  }
  reference_dataset_versions {
    uuid id PK
    text dataset UK
  }
  data_migration_runs {
    uuid id PK
    text name UK
  }
  users {
    uuid id PK
  }
  organisations {
    uuid id PK
  }
```

### 2.5 Reference data and compliance

```mermaid
erDiagram
  currencies ||--o{ countries : "default currency"
  countries ||--o{ subdivisions : "has"
  countries ||--o{ holidays : "observes"
  countries ||--o{ compliance_packs : "governed by (or EU)"
  compliance_packs ||--|{ compliance_pack_sections : "contains"
  compliance_packs ||--o{ prohibited_items : "country entries"
  carriers ||--o{ prohibited_items : "carrier entries"
  carrier_services ||--o{ transit_days : "transit per lane"
  zones ||--o{ zone_countries : "maps (empty seam)"
  currencies ||--o{ fx_rates : "base / quote"
  countries {
    uuid id PK
    char2 code UK
    char3 currency_code FK
  }
  subdivisions {
    uuid id PK
    text code UK
    char2 country_code FK
  }
  currencies {
    uuid id PK
    char3 code UK
  }
  holidays {
    uuid id PK
    char2 country_code FK
    date local_date
  }
  hs_codes {
    uuid id PK
    text code UK
  }
  prohibited_items {
    uuid id PK
    uuid compliance_pack_id FK
    uuid carrier_id FK
  }
  export_reasons {
    uuid id PK
    text code UK
  }
  incoterms {
    uuid id PK
    text code UK
  }
  fx_rates {
    uuid id PK
    char3 base_currency FK
    char3 quote_currency FK
    timestamptz as_of
  }
  transit_days {
    uuid id PK
    uuid carrier_service_id FK
  }
  zones {
    uuid id PK
    text code UK
  }
  zone_countries {
    uuid id PK
    uuid zone_id FK
    char2 country_code FK
  }
  compliance_packs {
    uuid id PK
    text country_code
    int version
  }
  compliance_pack_sections {
    uuid id PK
    uuid pack_id FK
    text section
  }
  carriers {
    uuid id PK
  }
  carrier_services {
    uuid id PK
  }
```

### 2.6 Carriers and pricing

```mermaid
erDiagram
  carriers ||--o{ carrier_services : "offers"
  carriers ||--o{ carrier_accounts : "accessed via"
  carrier_accounts ||--o{ carrier_raw_payloads : "logged calls"
  shipments ||--o{ carrier_raw_payloads : "linked to"
  pricing_config_versions ||--o{ margin_rules : "contains"
  pricing_config_versions ||--o{ surcharge_rules : "contains"
  pricing_config_versions ||--o{ cover_terms : "contains"
  pricing_config_versions ||--o{ discounts : "contains"
  coupons ||--o{ coupon_redemptions : "redeemed by"
  orders ||--o{ coupon_redemptions : "applies"
  carrier_services ||--o{ margin_rules : "scopes (optional)"
  carriers {
    uuid id PK
    text code UK
  }
  carrier_services {
    uuid id PK
    uuid carrier_id FK
    text canonical_code UK
  }
  carrier_accounts {
    uuid id PK
    uuid carrier_id FK
    text code UK
    text secret_ref
  }
  carrier_raw_payloads {
    uuid id PK
    uuid org_id FK
    uuid shipment_id FK
    uuid carrier_account_id FK
  }
  pricing_config_versions {
    uuid id PK
    text version_key UK
  }
  margin_rules {
    uuid id PK
    uuid config_version_id FK
    text rule_key
  }
  surcharge_rules {
    uuid id PK
    uuid config_version_id FK
    text kind
  }
  cover_terms {
    uuid id PK
    uuid config_version_id FK
  }
  discounts {
    uuid id PK
    uuid config_version_id FK
    text kind
  }
  coupons {
    uuid id PK
    text code_normalized UK
  }
  coupon_redemptions {
    uuid id PK
    uuid org_id FK
    uuid coupon_id FK
    uuid order_id FK
  }
  shipments {
    uuid id PK
  }
  orders {
    uuid id PK
  }
```

### 2.7 Quotes

```mermaid
erDiagram
  quotes ||--|{ quote_packages : "packages"
  quotes ||--o{ quote_options : "priced options"
  quotes ||--o{ quote_shares : "shared as"
  quotes |o--o| quotes : "requote_of"
  carrier_services ||--o{ quote_options : "service"
  carrier_accounts ||--o{ quote_options : "account"
  pricing_config_versions ||--o{ quotes : "priced with"
  organisations |o--o{ quotes : "owns (null = guest)"
  quotes {
    uuid id PK
    uuid org_id FK "nullable (guest)"
    bytea guest_token_hash
    timestamptz expires_at
  }
  quote_packages {
    uuid id PK
    uuid org_id FK
    uuid quote_id FK
    text package_type
  }
  quote_options {
    uuid id PK
    uuid org_id FK
    uuid quote_id FK
    uuid carrier_service_id FK
    bigint gross_minor
  }
  quote_shares {
    uuid id PK
    uuid org_id FK
    uuid quote_id FK
    bytea share_token_hash UK
  }
  carrier_services {
    uuid id PK
  }
  carrier_accounts {
    uuid id PK
  }
  pricing_config_versions {
    uuid id PK
  }
  organisations {
    uuid id PK
  }
```

### 2.8 Shipments and customs

```mermaid
erDiagram
  shipments ||--|{ shipment_parties : "sender + receiver"
  shipment_parties ||--o{ shipment_party_identifiers : "tax / ID refs (encrypted)"
  shipments ||--|{ shipment_packages : "packages"
  shipments ||--o{ shipment_state_transitions : "history"
  shipments ||--o{ shipment_price_snapshots : "immutable prices"
  shipments ||--o| customs_declarations : "customs"
  customs_declarations ||--o{ customs_items : "lines (same currency)"
  shipments ||--o{ prohibited_acknowledgements : "restricted acks"
  prohibited_items ||--o{ prohibited_acknowledgements : "matched entry"
  shipments ||--o{ shipment_attestations : "DG / documents attestations"
  quote_options |o--o{ shipments : "selected option"
  shipments {
    uuid id PK
    uuid org_id FK
    uuid on_behalf_of_org_id "seam, NULL in M1"
    text state
    uuid quote_id FK
    uuid selected_quote_option_id FK
    uuid price_snapshot_id FK
    text screening_status
  }
  shipment_parties {
    uuid id PK
    uuid org_id FK
    uuid shipment_id FK
    text role
  }
  shipment_party_identifiers {
    uuid id PK
    uuid org_id FK
    uuid party_id FK
  }
  shipment_packages {
    uuid id PK
    uuid org_id FK
    uuid shipment_id FK
    text package_type
  }
  shipment_state_transitions {
    uuid id PK
    uuid org_id FK
    uuid shipment_id FK
    text from_state
    text to_state
  }
  shipment_price_snapshots {
    uuid id PK
    uuid org_id FK
    uuid shipment_id FK
    bytea snapshot_sha256
  }
  customs_declarations {
    uuid id PK
    uuid org_id FK
    uuid shipment_id FK,UK
    char3 currency
  }
  customs_items {
    uuid id PK
    uuid org_id FK
    uuid declaration_id FK
    char3 currency FK
  }
  prohibited_acknowledgements {
    uuid id PK
    uuid org_id FK
    uuid shipment_id FK
    uuid prohibited_item_id FK
  }
  shipment_attestations {
    uuid id PK
    uuid org_id FK
    uuid shipment_id FK
    text kind
  }
  quote_options {
    uuid id PK
  }
  prohibited_items {
    uuid id PK
  }
```

### 2.9 Orders, saga and payments

```mermaid
erDiagram
  orders ||--o{ order_shipments : "basket lines"
  shipments ||--o{ order_shipments : "placed in"
  orders ||--o{ saga_executions : "orchestrated by"
  saga_executions ||--|{ saga_steps : "steps"
  orders ||--o{ payments : "paid by (one active)"
  payments ||--o{ payment_status_history : "history"
  payments ||--o{ payment_attempts : "gateway calls"
  payments ||--o{ refunds : "refunded by"
  payments ||--o{ gateway_refs : "indexed by"
  shipments ||--o{ refunds : "for shipment"
  saved_payment_methods }o--o{ payments : "used by"
  payment_gateway_customers ||--o{ saved_payment_methods : "attached to"
  orders {
    uuid id PK
    uuid org_id FK
    text order_number UK
    char3 sell_currency
    text status
  }
  order_shipments {
    uuid id PK
    uuid org_id FK
    uuid order_id FK
    uuid shipment_id FK
  }
  saga_executions {
    uuid id PK
    uuid org_id FK
    uuid order_id FK
    text kind
    text status
  }
  saga_steps {
    uuid id PK
    uuid org_id FK
    uuid saga_id FK
    text step
    text idempotency_key UK
  }
  payments {
    uuid id PK
    uuid org_id FK
    uuid order_id FK
    text gateway_payment_ref
    text status
  }
  payment_status_history {
    uuid id PK
    uuid org_id FK
    uuid payment_id FK
  }
  payment_attempts {
    uuid id PK
    uuid org_id FK
    uuid payment_id FK
    text idempotency_key UK
  }
  refunds {
    uuid id PK
    uuid org_id FK
    uuid payment_id FK
    uuid shipment_id FK
  }
  saved_payment_methods {
    uuid id PK
    uuid org_id FK
    uuid user_id FK
  }
  payment_gateway_customers {
    uuid id PK
    uuid org_id FK
    uuid user_id FK
  }
  gateway_webhook_events {
    uuid id PK
    text gateway
    text gateway_event_id
  }
  gateway_refs {
    uuid id PK
    text gateway
    text gateway_ref UK
    uuid payment_id
  }
  shipments {
    uuid id PK
  }
```

### 2.10 Documents, pickups, tracking, notifications

```mermaid
erDiagram
  shipments ||--o{ documents : "versions"
  pickups |o--o{ documents : "pickup confirmation"
  shipments ||--o{ pickups : "collection"
  pickups |o--o| pickups : "replaces (reschedule)"
  shipments ||--o{ tracking_events : "events"
  shipments ||--o| tracking_poll_schedule : "polled by"
  shipments ||--o| tracking_index : "indexed for public lookup"
  notification_templates ||--o{ notification_log : "rendered from (key, version)"
  users ||--o| notification_preferences : "prefers"
  users ||--o{ notification_log : "receives"
  documents {
    uuid id PK
    uuid org_id FK
    uuid shipment_id FK
    text document_key
    int version
    bytea sha256
  }
  pickups {
    uuid id PK
    uuid org_id FK
    uuid shipment_id FK
    date pickup_date
    text time_zone
  }
  tracking_events {
    uuid id PK
    uuid org_id FK
    uuid shipment_id FK
    bytea dedupe_key
    text canonical_status
  }
  tracking_poll_schedule {
    uuid id PK
    uuid org_id FK
    uuid shipment_id FK,UK
    timestamptz next_poll_at
  }
  tracking_index {
    uuid id PK
    uuid shipment_id UK
    uuid org_id
    text tracking_number
    text order_number
  }
  notification_templates {
    uuid id PK
    text template_key
    int version
    text locale
  }
  notification_preferences {
    uuid id PK
    uuid user_id FK,UK
  }
  notification_log {
    uuid id PK
    uuid recipient_user_id FK
    text idempotency_key UK
  }
  shipments {
    uuid id PK
  }
  users {
    uuid id PK
  }
```


---

## 3. Table-by-table specification

How to read the tables:

- **Header line:** table name · class (§1.5) · soft delete (yes/no) · write mode (`mutable`, `append-only`, `insert-only config`, `hard-delete allow-listed`).
- **`STD`** row = the six standard columns of P2; **`SD`** row = `deleted_at`, `deleted_by` (P3). Both are classification `INT`.
- **Null:** `N` = `NOT NULL`, `Y` = nullable.
- **Class:** `PUB`, `INT`, `PER`, `SPER`, `SEC` (§1.2). This column is the content of the classification registry.
- **Access patterns** are named `AP-<MODULE>-nn`; each name is an entry in the NFR-PERF-006 query-plan registry and maps to exactly one supporting index (or the primary key). Keyset pagination keys are stated as `(sort cols, id)`. All tenant indexes lead with `org_id` (REQ-RLS-001); partial `WHERE deleted_at IS NULL` on soft-deletable tables (REQ-RLS-010).
- Currency columns always carry `CHECK (<col> ~ '^[A-Z]{3}$')`; country columns `CHECK (<col> ~ '^[A-Z]{2}$')`. They are not repeated per row.

### 3.1 Identity module

#### `users` · USER_OWNED (+ org-member read branch, DR-A14) · SD: yes · mutable

REQ-AUTH-001/004/024, REQ-ORG-002/005, REQ-ACCT-017/018, REQ-I18N-007, REQ-UI-002/016/017, DR-A04.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD, SD | | | | INT |
| `email` | `text` | N | `ck_users__email_normalised CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254)`; NFC normalisation and trimming done in the service (REQ-AUTH-001, EC-A02) | PER |
| `email_verified_at` | `timestamptz` | Y | | INT |
| `display_name` | `text` | N | `CHECK (char_length(display_name) BETWEEN 1 AND 100)` | PER |
| `status` | `text` | N | `DEFAULT 'PENDING_VERIFICATION'`, CHECK `user_status` | INT |
| `status_changed_at` | `timestamptz` | N | `DEFAULT now()` | INT |
| `status_reason` | `text` | Y | CHECK `user_status_reason` (§1.7); `ck_users__status_reason CHECK (status_reason IS NULL OR status IN ('SUSPENDED','DEACTIVATED'))`; cleared on reactivation | INT |
| `first_signed_in_at` | `timestamptz` | Y | set once, at the first successful password verification; start of the 24 h staff enrolment deadline | INT |
| `locale` | `text` | N | `DEFAULT 'en'`, `CHECK (locale IN ('en','es','fr'))` | INT |
| `time_zone` | `text` | Y | IANA name, validated in service (A-077) | PER |
| `display_currency` | `char(3)` | Y | FK `currencies(code)` | INT |
| `unit_system` | `text` | Y | `CHECK (unit_system IN ('METRIC','IMPERIAL'))` | INT |
| `theme` | `text` | Y | `CHECK (theme IN ('LIGHT','DARK','SYSTEM'))` (REQ-UI-002) | INT |
| `admin_sidebar_collapsed` | `boolean` | N | `DEFAULT false` (REQ-UI-016) | INT |
| `table_density` | `text` | N | `DEFAULT 'COMFORTABLE'`, `CHECK (… IN ('COMFORTABLE','COMPACT'))` (REQ-UI-017) | INT |
| `personal_org_id` | `uuid` | Y | FK `organisations(id)`, set in the registration transaction (REQ-ORG-002); `DEFERRABLE INITIALLY DEFERRED` because user and org are inserted in the same transaction | INT |
| `last_active_org_id` | `uuid` | Y | FK `organisations(id)` (REQ-ORG-005) | INT |
| `is_system` | `boolean` | N | `DEFAULT false` (reserved actors, §1.6) | INT |
| `deletion_requested_at` | `timestamptz` | Y | 30-day grace (REQ-ACCT-017, Could) | INT |

| AP | Query | Index |
|---|---|---|
| AP-ID-01 | Resolve user by normalised email at login/registration/reset (through `auth_lookup_user_by_email`, §4.5) | `ux_users__email ON (email) WHERE deleted_at IS NULL` (also enforces case-insensitive uniqueness, EC-A02) |
| AP-ID-02 | Own row by id (`GET /me`) | PK |
| AP-ID-03 | Users of an org for member list (join from memberships) | PK (driven from `memberships`) |
| AP-ID-19 | Staff enrolment deadline: OPERATOR members, `status = 'ACTIVE'`, `first_signed_in_at < now() - 24 h`, no ACTIVE `mfa_totp` (hourly, through `mfa_enrolment_overdue_candidates`, §4.5) | Driven from the OPERATOR organisation's memberships (`ix_memberships__org_*`, tens of rows), then PK on `users` and `ux_mfa_totp__user_live`; no new index |

Amended 2026-11-12 (SEC-P3-14): added `status_reason` and `first_signed_in_at` and AP-ID-19. The `housekeeping` job reads candidates through `mfa_enrolment_overdue_candidates` and then, for each candidate, opens a transaction with `app.actor_id` set to that user (the OI-25 pattern for USER_OWNED rows; audit actor `SYSTEM_JOB`, job name `mfa-enrolment-deadline`). In that transaction it re-checks the predicate, sets `status = 'SUSPENDED'`, `status_reason = 'MFA_ENROLMENT_OVERDUE'`, revokes every session with reason `USER_STATUS_CHANGED` (Redis revocation set first, as in §12 OI-25) and writes the audit entry. The audited operator CLI `ops:staff-reactivate` sets `status = 'ACTIVE'` and `status_reason = NULL`, and keeps `first_signed_in_at`, so the deadline is already past and the user must enrol at the next sign-in before housekeeping runs again.

#### `user_credentials` · USER_OWNED · SD: no · mutable

REQ-AUTH-002/003/012/023. One row per user; separated from `users` so that the profile can be read and audited without ever touching the hash.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `user_id` | `uuid` | N | FK `users(id)`, `UNIQUE` | INT |
| `password_hash` | `text` | N | bcrypt string; `CHECK (password_hash ~ '^\$2[aby]\$')` | SEC |
| `bcrypt_cost` | `smallint` | N | `CHECK (bcrypt_cost >= 12)` (rehash on login when lower, REQ-AUTH-003) | INT |
| `password_changed_at` | `timestamptz` | N | `DEFAULT now()` | INT |

AP-ID-04 credential by user id → `ux_user_credentials__user_id`.

**Amendment (2026-11-12, SEC-P3-14, SEC-P3-08).**
- **A user may have no credential row.** Staff accounts created by a non-local seed (`APP_ENV ∉ {local, test}`) have no `user_credentials` row. The seed issues a `password_reset_tokens` row with `purpose = 'SET_PASSWORD'` (24 h) instead, and the e-mail carries the set-password link. A login for a user without a credential row (`auth_lookup_credential` returns no row) runs the dummy bcrypt comparison (NFR-SEC-003 timing) and answers the generic `INVALID_CREDENTIALS`. Redeeming the `SET_PASSWORD` token inserts the row.
- **Pepper column reserved.** `pepper_key_id text` (`<purpose>-v<n>`, `PASSWORD_PEPPER` in the ADR-0018 key register) is reserved for the SEC-P3-16 backlog item, which changes the bcrypt pre-hash to a peppered HMAC. It is added by that item's expand migration, not now. Until then the column does not exist, and §10.4 lists it as "reserved".

#### `email_verification_tokens`, `password_reset_tokens` · USER_OWNED · SD: no · purged by `purge_expired_tokens` (§4.5)

REQ-AUTH-004/011/012, DR-A01 (24 h / 60 min, 256-bit, hashed, single-use, superseded by newer token). Redeemed through `auth_lookup_one_time_token` (§4.5), after which the transaction runs as the user. Identical shape:

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `user_id` | `uuid` | N | FK `users(id)` | INT |
| `token_hash` | `bytea` | N | SHA-256 of the 256-bit token; `CHECK (octet_length(token_hash) = 32)`; `UNIQUE` | SEC |
| `expires_at` | `timestamptz` | N | | INT |
| `consumed_at` | `timestamptz` | Y | | INT |
| `superseded_at` | `timestamptz` | Y | set on all open tokens of the user when a new one is issued | INT |

| AP | Query | Index |
|---|---|---|
| AP-ID-05 | Redeem by token hash | `ux_<table>__token_hash` |
| AP-ID-06 | Supersede open tokens of a user | `ix_<table>__user_id_open ON (user_id) WHERE consumed_at IS NULL AND superseded_at IS NULL` |
| AP-ID-07 | Housekeeping purge (`expires_at < now() - 7 days`) through `purge_expired_tokens`, batches of 1,000 | `ix_<table>__expires_at` |

**Amendment (2026-11-12, SEC-P3-14).** `password_reset_tokens` adds one column. The two tables are no longer identical in shape.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| `purpose` | `text` | N | `DEFAULT 'RESET'`, CHECK `password_reset_purpose` (`RESET`, `SET_PASSWORD`); expiry 60 min for `RESET` and 24 h for `SET_PASSWORD` (`ck_password_reset_tokens__ttl CHECK (expires_at <= created_at + CASE purpose WHEN 'SET_PASSWORD' THEN interval '24 hours' ELSE interval '60 minutes' END + interval '1 minute')`, the minute absorbing app/DB clock skew) | INT |

Issuing either purpose supersedes every open token of the user in this table. `auth_lookup_one_time_token` accepts `p_purpose = 'SET_PASSWORD'`, which reads `password_reset_tokens WHERE purpose = 'SET_PASSWORD'`; `'PASSWORD_RESET'` reads `purpose = 'RESET'` (§4.5). Redemption of `SET_PASSWORD` inserts `user_credentials` (or updates it, if a row appeared in the meantime) and, like a reset, revokes the user's other sessions.

#### `sessions` · USER_OWNED · SD: no · mutable

REQ-AUTH-007/009/021/022, REQ-ADMIN-004/007, A-041. `id` is the `sid` claim.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `user_id` | `uuid` | N | FK `users(id)` | INT |
| `client_app` | `text` | N | `CHECK (client_app IN ('web','admin'))` | INT |
| `status` | `text` | N | `DEFAULT 'ACTIVE'`, CHECK `session_status` | INT |
| `active_org_id` | `uuid` | N | FK `organisations(id)` (REQ-ORG-005/006) | INT |
| `mfa_satisfied` | `boolean` | N | `DEFAULT false` (JWT `mfa` claim source) | INT |
| `authenticated_at` | `timestamptz` | N | time of the last password or MFA verification: set at login, updated when the MFA challenge completes and when a re-auth proof is issued successfully (`createReauthProof`), **never changed by refresh**; copied into the access-token claim `auth_time` (ADR-0006 amendment 12); `ck_sessions__authenticated_at CHECK (authenticated_at <= absolute_expires_at)` | INT |
| `ip_prefix_created` | `inet` | Y | network prefix only, IPv4 /24 or IPv6 /48 (`CHECK (masklen(ip_prefix_created) IN (24, 48))`, REQ-AUTH-021) | PER |
| `ip_prefix_last` | `inet` | Y | as above | PER |
| `user_agent_raw` | `text` | Y | `CHECK (char_length(user_agent_raw) <= 512)` | PER |
| `ua_browser`, `ua_os` | `text` | Y | parsed by bowser | PER |
| `last_used_at` | `timestamptz` | N | `DEFAULT now()`; updated at most once per 5 min per session (write throttling) | INT |
| `absolute_expires_at` | `timestamptz` | N | `created_at + AUTH_SESSION_ABSOLUTE_TTL`: **30 d (web)** / 12 h (admin, `AUTH_ADMIN_SESSION_ABSOLUTE_TTL`) (A-041, REQ-AUTH-007, REQ-ADMIN-004, ADR-0006 amendment 12); never extended. Database backstop: `ck_sessions__absolute_cap CHECK (absolute_expires_at <= created_at + CASE client_app WHEN 'admin' THEN interval '12 hours' ELSE interval '30 days' END + interval '1 minute')` (the minute absorbs app/DB clock skew), so a misconfiguration cannot exceed the ASVS L1 cap | INT |
| `revoked_at` | `timestamptz` | Y | | INT |
| `revoked_reason` | `text` | Y | `CHECK (… IN ('LOGOUT','REMOTE_SIGN_OUT','PASSWORD_RESET','PASSWORD_CHANGED','TOKEN_REUSE','MEMBERSHIP_REMOVED','USER_STATUS_CHANGED','MFA_DISABLED','ABSOLUTE_EXPIRY'))` | INT |

| AP | Query | Index |
|---|---|---|
| AP-ID-08 | List own sessions (newest use first) | `ix_sessions__user_status_last_used ON (user_id, status, last_used_at DESC, id DESC)` |
| AP-ID-09 | Revoke sessions whose active org is X for a removed member (REQ-ORG-012, EC-A17) | `ix_sessions__active_org_user ON (active_org_id, user_id) WHERE status = 'ACTIVE'` |
| AP-ID-10 | Expire sessions past `absolute_expires_at` (housekeeping; access tokens already stop at the absolute cap, so this is cleanup) | `ix_sessions__absolute_expires ON (absolute_expires_at) WHERE status = 'ACTIVE'` |

Cross-user revocations (membership removal, user status change, REQ-ORG-012, DR-A04) are performed by a worker job reacting to the outbox event with `app.actor_id` set to the affected user, because `sessions` is USER_OWNED; the Redis revocation set makes them effective within 5 s (REQ-AUTH-009, OI-25).

Amended 2026-11-12 (SEC-P3-01 C1/C2, SEC-P3-11): added `authenticated_at` (the `auth_time` source for step-up, `x-reauth-max-age`, and saved-card CVC recollection after 12 h). The web absolute cap drops from the earlier three-month figure to 30 days. The `ck_sessions__absolute_cap` backstop was added. A refresh presented after `absolute_expires_at` answers 401 `SESSION_EXPIRED` and sets `status = 'EXPIRED'`, `revoked_reason = 'ABSOLUTE_EXPIRY'`.

#### `refresh_tokens` · USER_OWNED · SD: no · purged by `purge_expired_tokens` (expired families)

ADR-0006, REQ-AUTH-006/007/008, DR-A03. Looked up by hash through `auth_lookup_refresh_token` (§4.5) before any access token exists; rotation and revocation then run under the user's own-row policy.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `family_id` | `uuid` | N | one family per session | INT |
| `session_id` | `uuid` | N | FK `sessions(id)` | INT |
| `user_id` | `uuid` | N | FK `users(id)` | INT |
| `token_hash` | `bytea` | N | SHA-256, 32 bytes, `UNIQUE` | SEC |
| `status` | `text` | N | `DEFAULT 'ACTIVE'`, CHECK `refresh_token_status` | INT |
| `expires_at` | `timestamptz` | N | sliding idle lifetime, recomputed at every rotation: web `LEAST(now() + AUTH_REFRESH_TTL (30 d), sessions.absolute_expires_at)`; **admin `LEAST(now() + AUTH_ADMIN_REFRESH_IDLE_TTL (30 min), sessions.absolute_expires_at)`** | INT |
| `rotated_at`, `revoked_at` | `timestamptz` | Y | | INT |
| `replaced_by_id` | `uuid` | Y | FK `refresh_tokens(id)` | INT |

Constraint `ux_refresh_tokens__one_active_per_family ON (family_id) WHERE status = 'ACTIVE'` makes a second concurrent rotation fail (DR-A03, EC-A04). AP-ID-11 lookup by hash (`ux_refresh_tokens__token_hash`); AP-ID-12 revoke family (`ix_refresh_tokens__family_id`); AP-ID-13 purge `expires_at < now() - 7 d` (`ix_refresh_tokens__expires_at`).

Amended 2026-11-12 (SEC-P3-11, SEC-P3-01): `expires_at` is a sliding idle lifetime that is capped by the session's absolute expiry. Admin refresh tokens live 30 minutes from their issue, so an idle admin client cannot keep its session alive: a refresh presented after `expires_at` answers 401 `SESSION_EXPIRED` (ADR-0006 amendment 13). Rotation copies `sessions.authenticated_at` unchanged into the new access token's `auth_time`.

#### `mfa_totp` · USER_OWNED · SD: no · mutable

REQ-AUTH-015/017/018/019, EC-A06.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `user_id` | `uuid` | N | FK `users(id)` | INT |
| `status` | `text` | N | `CHECK (status IN ('PENDING','ACTIVE','DISABLED'))` | INT |
| `secret_ciphertext` | `bytea` | N | AES-256-GCM (96-bit random nonce ‖ ciphertext ‖ 128-bit tag) of the base32 secret; AAD = (`mfa_totp`, `secret_ciphertext`, `id`, `secret_ciphertext_key_id`) (§10.4) | SEC |
| `secret_ciphertext_key_id` | `text` | N | `<purpose>-v<n>` of `MFA_ENCRYPTION_KEY` (e.g. `mfa-v1`); never the key itself; `CHECK (secret_ciphertext_key_id ~ '^[a-z][a-z0-9-]*-v[0-9]+$')` | INT |
| `pending_expires_at` | `timestamptz` | Y | created + 15 min while PENDING | INT |
| `activated_at`, `disabled_at` | `timestamptz` | Y | | INT |
| `last_accepted_step` | `bigint` | Y | last accepted RFC 6238 time step; a code for a step ≤ this is rejected (EC-A06) | INT |

`ux_mfa_totp__user_live ON (user_id) WHERE status IN ('PENDING','ACTIVE')` (AP-ID-14).

Amended 2026-11-12 (SEC-P3-08 item 1): `key_id` renamed to `secret_ciphertext_key_id` (`<col>_key_id` convention), and the AAD tuple is stated. A rotation re-encrypts by `secret_ciphertext_key_id`, and reads accept the current and the `_PREVIOUS` key (ADR-0018 amendment 1).

#### `mfa_recovery_codes` · USER_OWNED · SD: no · mutable

REQ-AUTH-016, REQ-ADMIN-008. Columns: STD; `user_id uuid N FK`; `batch_id uuid N` (regeneration voids the whole previous batch); `code_hmac bytea N` = HMAC-SHA256(`RECOVERY_KEY`, normalised code), `CHECK (octet_length(code_hmac) = 32)` (SEC); `code_hmac_key_id text N` (`<purpose>-v<n>` of `RECOVERY_KEY`); `used_at timestamptz Y`; `voided_at timestamptz Y`. AP-ID-15 unused codes of a user: `ix_mfa_recovery_codes__user_open ON (user_id) WHERE used_at IS NULL AND voided_at IS NULL` (≤ 10 rows; the presented code is HMAC'd under each `code_hmac_key_id` present in the batch and compared in constant time).

Amended 2026-11-12 (SEC-P3-08 item 1; drift fix against ADR-0006): `code_hash text` (bcrypt) is replaced by `code_hmac bytea` plus `code_hmac_key_id`, which is the keyed HMAC that ADR-0006 already specifies. The retired `RECOVERY_KEY` is kept until every code under it is used or voided (ADR-0018 register). The `id-secret` format with a per-code salt is the SEC-P3-16 backlog item and is not designed here.

#### `mfa_challenges` · USER_OWNED · SD: no · purged by `purge_expired_tokens`

REQ-AUTH-017 (5 min, single use, bound to user and IP class). Columns: STD; `user_id uuid N FK`; `client_app text N`; `token_hash bytea N UNIQUE` (SEC); `ip_prefix_hmac bytea N` (HMAC-SHA256 of the client's /24 or /48 prefix, so the challenge can be bound to the IP class without storing the address; INT); `ip_prefix_hmac_key_id text N` (amended 2026-11-12, SEC-P3-08 item 1); `expires_at timestamptz N`; `consumed_at timestamptz Y`; `failed_attempts smallint N DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5)`. AP-ID-16 by hash (through `auth_lookup_one_time_token` with purpose `MFA_CHALLENGE`); AP-ID-17 purge by `expires_at`.

#### `mfa_enrolment_codes` · USER_OWNED · SD: no · purged by `purge_expired_tokens`

**New (2026-11-12, SEC-P3-14; ADR-0006 amendment 14).** This is the one-time **enrolment e-mail code** that a user with an OPERATOR membership needs for their **first** TOTP enrolment outside `APP_ENV ∈ {local, test}`. `requestTotpEnrolmentCode` issues it; `enrolTotp` consumes it as `enrolment_code`.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `user_id` | `uuid` | N | FK `users(id)` | INT |
| `session_id` | `uuid` | N | FK `sessions(id)`; the code works only in the session that requested it | INT |
| `code_hmac` | `bytea` | N | HMAC-SHA256(enrolment-code key, `user_id` ‖ 6-digit code); `CHECK (octet_length(code_hmac) = 32)`. A plain SHA-256 of a 6-digit code would fall to 10⁶ guesses offline, which is why the key lives outside the database | SEC |
| `code_hmac_key_id` | `text` | N | `<purpose>-v<n>` of the enrolment-code key (ADR-0018 register entry requested, §10.4) | INT |
| `expires_at` | `timestamptz` | N | created + 10 min; `CHECK (expires_at <= created_at + interval '11 minutes')` | INT |
| `consumed_at` | `timestamptz` | Y | single use | INT |
| `superseded_at` | `timestamptz` | Y | set on the user's open codes when a new one is issued | INT |
| `failed_attempts` | `smallint` | N | `DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5)`; the 5th failure also supersedes the code. Every failure also counts against the per-user MFA lock (DR-A02) | INT |

| AP | Query | Index |
|---|---|---|
| AP-ID-20 | Open code of the actor's session (`SELECT … FOR UPDATE WHERE user_id = app_actor_id() AND session_id = $sid AND consumed_at IS NULL AND superseded_at IS NULL AND expires_at > now()`; constant-time compare in the service; `UPDATE` sets `consumed_at` or increments `failed_attempts`) | `ix_mfa_enrolment_codes__user_open ON (user_id) WHERE consumed_at IS NULL AND superseded_at IS NULL` |
| AP-ID-21 | Purge 7 days after expiry (`purge_expired_tokens`) | `ix_mfa_enrolment_codes__expires_at` |

Choice recorded: the review offered two designs. One was a `purpose = 'TOTP_ENROLMENT'` value on an existing one-time-token table. The other was this table. **This table is the smaller safe change.** The existing token tables have no generic purpose column, and they are keyed by a globally `UNIQUE` SHA-256 of a 256-bit token that is resolved before any actor exists (`auth_lookup_one_time_token`). A 6-digit code breaks all three properties: codes collide across users, an unkeyed hash is brute-forceable, and an attempt counter is needed. This table, by contrast, is read under the normal own-row policy, because the user already holds a password-authenticated session. It therefore needs no new definer function, only the purge.

#### `reauth_proofs` · USER_OWNED · SD: no · purged by `purge_expired_tokens`

REQ-AUTH-020 (5 min, single use, bound to session + action scope). Columns: STD; `user_id uuid N`; `session_id uuid N FK sessions`; `scope text N CHECK (scope ~ '^[a-z_]+(:[a-z_]+)*$')`; `token_hash bytea N UNIQUE` (SEC); `expires_at timestamptz N`; `consumed_at timestamptz Y`. Consumption is `UPDATE … SET consumed_at = now() WHERE token_hash = $1 AND session_id = $2 AND scope = $3 AND consumed_at IS NULL AND expires_at > now() RETURNING id` (single use under concurrency). Seam: the M2 signature record references `reauth_proofs.id` from the audit entry (`audit_entries.reauth_proof_id`).

#### `login_attempt_counters` · SYSTEM · SD: no · hard-delete allow-listed (stale > 30 d)

REQ-AUTH-013/014/017, DR-A02, EC-A09. Counters exist for unknown identifiers too, so the key is a keyed hash, never the email.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `kind` | `text` | N | `CHECK (kind IN ('LOGIN','MFA'))` | INT |
| `identifier_hmac` | `bytea` | N | HMAC-SHA256(normalised email or user id, `LOGIN_COUNTER_KEY` from the secret manager) | SEC |
| `identifier_hmac_key_id` | `text` | N | `<purpose>-v<n>`; amended 2026-11-12 (SEC-P3-08 item 1). Counters are short-lived, so a rotation starts fresh counters under the new key and does not dual-read (ADR-0018 register) | INT |
| `consecutive_failures` | `integer` | N | `DEFAULT 0 CHECK (consecutive_failures >= 0)` | INT |
| `last_failure_at` | `timestamptz` | Y | | INT |
| `delayed_until`, `locked_until` | `timestamptz` | Y | DR-A02 schedule | INT |

`ux_login_attempt_counters__kind_identifier ON (kind, identifier_hmac)` (AP-ID-18). Increment is an atomic upsert: `INSERT … ON CONFLICT (kind, identifier_hmac) DO UPDATE SET consecutive_failures = CASE WHEN login_attempt_counters.locked_until > now() THEN login_attempt_counters.consecutive_failures ELSE login_attempt_counters.consecutive_failures + 1 END, …` (counter not incremented while locked, DR-A02).

### 3.2 Organisations module

#### `organisations` · TENANT (special policy, §4.3) · SD: yes · mutable

REQ-ORG-001/002/008/009/014, DR-A06, REQ-I18N, REQ-PRICE-015.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD, SD | | | | INT |
| `type` | `text` | N | CHECK `org_type`; immutable (trigger `trg_organisations__type_immutable` raises on change) | INT |
| `display_name` | `text` | N | `CHECK (char_length(display_name) BETWEEN 1 AND 120)` | PER (a personal org is named after the user) |
| `legal_name` | `text` | Y | ≤ 200 | PER |
| `country_code` | `char(2)` | Y | FK `countries(code)` | PUB |
| `address_line1`, `address_line2`, `address_line3`, `city`, `postcode` | `text` | Y | lengths per DR-B (≤ 100/100/100/60/20) | PER |
| `region_code` | `text` | Y | FK `subdivisions(code)` | INT |
| `contact_email` | `text` | Y | lower-case | PER |
| `contact_phone_e164` | `text` | Y | `CHECK (contact_phone_e164 ~ '^\+[1-9][0-9]{6,14}$')` | PER |
| `default_locale` | `text` | N | `DEFAULT 'en'` CHECK en/es/fr | INT |
| `default_currency` | `char(3)` | Y | FK `currencies(code)` | INT |
| `personal_owner_user_id` | `uuid` | Y | FK `users(id)`; `CHECK ((type = 'INDIVIDUAL') = (personal_owner_user_id IS NOT NULL))` | INT |

| AP | Query | Index |
|---|---|---|
| AP-ORG-01 | Org by id (profile, `GET /organisations/{id}`) | PK |
| AP-ORG-02 | Exactly one OPERATOR org (DR-A06) | `ux_organisations__single_operator ON (type) WHERE type = 'OPERATOR'` |
| AP-ORG-03 | Personal org of a user (one per user) | `ux_organisations__personal_owner ON (personal_owner_user_id) WHERE personal_owner_user_id IS NOT NULL AND deleted_at IS NULL` |
| AP-ORG-04 | Count of orgs owned by a user (A-047 cap 10) | driven from `membership_roles` (AP-ORG-09) |

The REQ-RLS-001 "index leading with `org_id`" rule is satisfied by the PK `id`, which is the tenant key of this table (catalog test special-cases `organisations.id`).

#### `organisation_tax_references` · TENANT · SD: yes · mutable

REQ-ORG-008 (tax references as type/value pairs). Columns: STD, SD; `org_id uuid N FK`; `reference_type text N CHECK (reference_type ~ '^[A-Z]{2}_[A-Z0-9_]+$')` (pack-defined codes such as `IN_GSTIN`, `GB_VAT`); `value text N` ≤ 64 (PER); `country_code char(2) N`. AP-ORG-05 list per org: `ix_organisation_tax_references__org ON (org_id, reference_type) WHERE deleted_at IS NULL`; unique `(org_id, reference_type, value) WHERE deleted_at IS NULL`.

#### `memberships` · TENANT (+ user-owned read branch, DR-A14) · SD: no (status `REMOVED` keeps history) · mutable

REQ-ORG-003/005/011/012/013, DR-A05, EC-A15/A17.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `org_id` | `uuid` | N | FK `organisations(id)` | INT |
| `user_id` | `uuid` | N | FK `users(id)` | INT |
| `status` | `text` | N | CHECK `membership_status` | INT |
| `invitation_id` | `uuid` | Y | FK `invitations(id)` | INT |
| `activated_at`, `suspended_at`, `removed_at` | `timestamptz` | Y | | INT |
| `removed_by` | `uuid` | Y | | INT |
| `last_owner_guard` | — | — | not a column: the LAST_OWNER rule (REQ-ORG-013) is enforced by the service under `SELECT … FOR UPDATE` of the org's ACTIVE Owner membership rows inside the changing transaction | — |

| AP | Query | Index |
|---|---|---|
| AP-ORG-06 | Unique non-removed membership per (user, org) | `ux_memberships__org_user_live ON (org_id, user_id) WHERE status <> 'REMOVED'` |
| AP-ORG-07 | Member list of an org (status filter, keyset by `created_at, id`) | `ix_memberships__org_status_created ON (org_id, status, created_at, id)` |
| AP-ORG-08 | A user's memberships across orgs (`GET /me/organisations`, permission resolution per request, REQ-RBAC-008) | `ix_memberships__user_status ON (user_id, status) INCLUDE (org_id)` |

#### `membership_roles` · TENANT · SD: no (revocation via `revoked_at`) · mutable

REQ-ORG-003/004/012, REQ-ACCT-015. Columns: STD; `org_id uuid N FK`; `membership_id uuid N FK memberships`; `role_id uuid N FK roles`; `granted_by uuid N`; `revoked_at timestamptz Y`; `revoked_by uuid Y`. Trigger `trg_membership_roles__scope_matches_org` (BEFORE INSERT) raises `ROLE_NOT_ALLOWED_FOR_ORG_TYPE` when `roles.scope` does not match the org type mapping (`OPERATOR→OPERATOR`, `BUSINESS_CUSTOMER|INDIVIDUAL→CUSTOMER`, `PARTNER→PARTNER`) as the database backstop of REQ-ORG-004.

| AP | Query | Index |
|---|---|---|
| AP-ORG-09 | Active roles of a membership (permission resolution) | `ux_membership_roles__membership_role_live ON (membership_id, role_id) WHERE revoked_at IS NULL` |
| AP-ORG-10 | ACTIVE Owners of an org (LAST_OWNER check) | `ix_membership_roles__org_role_live ON (org_id, role_id) WHERE revoked_at IS NULL` |

#### `invitations` · TENANT · SD: no (status) · mutable

REQ-ORG-010/011, REQ-ACCT-014, A-082, DR-A01, EC-A16.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `org_id` | `uuid` | N | FK | INT |
| `email` | `text` | N | lower-case | PER |
| `role_id` | `uuid` | N | FK `roles(id)` (customer roles only; trigger as on `membership_roles`) | INT |
| `locale` | `text` | N | CHECK en/es/fr (inviter's selection, REQ-NOTIF-006) | INT |
| `token_hash` | `bytea` | N | 32 bytes, `UNIQUE` | SEC |
| `status` | `text` | N | `CHECK (status IN ('PENDING','ACCEPTED','REVOKED','EXPIRED'))` | INT |
| `expires_at` | `timestamptz` | N | created + 7 d | INT |
| `send_count` | `smallint` | N | `DEFAULT 1 CHECK (send_count BETWEEN 1 AND 4)` (initial + 3 resends) | INT |
| `last_sent_at` | `timestamptz` | N | | INT |
| `accepted_at`, `revoked_at` | `timestamptz` | Y | | INT |
| `accepted_by_user_id`, `revoked_by` | `uuid` | Y | | INT |

AP-ORG-11 pending invitation per (org, email): `ux_invitations__org_email_pending ON (org_id, email) WHERE status = 'PENDING'`; AP-ORG-12 list per org: `ix_invitations__org_status_created ON (org_id, status, created_at DESC, id DESC)`; AP-ORG-13 redeem by token: `ux_invitations__token_hash` (via `invitation_lookup`, §4.5).

#### `address_book_entries` · TENANT · SD: yes · mutable

REQ-ACCT-008/009/010, REQ-BOOK-005, A-068 (≤ 500 per org; app-checked with a count inside the insert transaction under `SELECT … FOR UPDATE` of the org row).

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD, SD | | | | INT |
| `org_id` | `uuid` | N | FK | INT |
| `label` | `text` | N | `CHECK (char_length(label) BETWEEN 1 AND 50)` | PER |
| `contact_name` | `text` | N | ≤ 100 | PER |
| `company` | `text` | Y | ≤ 100 | PER |
| `address_line1` | `text` | N | ≤ 100 | PER |
| `address_line2`, `address_line3` | `text` | Y | ≤ 100 | PER |
| `city` | `text` | N | ≤ 60 | PER |
| `region_code` | `text` | Y | FK `subdivisions(code)` | INT |
| `postcode` | `text` | Y | ≤ 20 | PER |
| `country_code` | `char(2)` | N | FK `countries(code)` | PUB |
| `phone_e164` | `text` | N | E.164 CHECK | PER |
| `email` | `text` | Y | | PER |
| `residential` | `boolean` | N | `DEFAULT false` | INT |
| `is_default_sender` | `boolean` | N | `DEFAULT false` | INT |
| `search_text` | `text` | N | `GENERATED ALWAYS AS (lower(label \|\| ' ' \|\| contact_name \|\| ' ' \|\| coalesce(company,'') \|\| ' ' \|\| city)) STORED` | PER |

| AP | Query | Index |
|---|---|---|
| AP-ORG-14 | List entries by label (keyset `(lower(label), id)`) | `ix_address_book__org_label ON (org_id, lower(label), id) WHERE deleted_at IS NULL` |
| AP-ORG-15 | Search by name/company/city/label (partial, case-insensitive) | `ix_address_book__org_search_trgm USING gin (org_id, search_text gin_trgm_ops) WHERE deleted_at IS NULL` (extensions `pg_trgm`, `btree_gin`) |
| AP-ORG-16 | One default sender per org (REQ-ACCT-009) | `ux_address_book__org_default_sender ON (org_id) WHERE is_default_sender AND deleted_at IS NULL` |
| AP-ORG-17 | CSV import duplicate check by label + postcode (REQ-ACCT-010) | `ix_address_book__org_label_postcode ON (org_id, lower(label), postcode) WHERE deleted_at IS NULL` |

#### `terms_acceptances` · USER_OWNED · SD: no · append-only

REQ-AUTH-001. Columns: STD; `user_id uuid N FK`; `document text N CHECK (document IN ('TERMS','PRIVACY'))`; `document_version text N`; `country_code text N` (pack country or `EU`); `locale text N`; `accepted_at timestamptz N DEFAULT now()`. AP-ORG-18 own acceptances: `ix_terms_acceptances__user ON (user_id, document, accepted_at DESC)`.

### 3.3 Authz module (GLOBAL, read-only at runtime)

REQ-RBAC-001/002/003/004/013/014, DR-A07. ~~Loaded and reconciled by the reference seed from the `packages/authz` catalogue (§9.3)~~ *Amended 2026-11-12 (TASK-013 PR #8, D-T013-08; ADR-0008 am. 2; `rulings/wave-0-batch-3-rulings.md` item 4; D-ARCH-060):* rows are inserted by the **generated versioned migration** `prisma/migrations/<ts>_authz_seed_v<N>/` (`npm run authz:generate`, source `packages/authz`), never by `db:seed`; the reference seed only verifies catalogue ⇔ database parity and the US-073 task writes the `CONFIG_CHANGE` audit entry per catalogue version (§9.2). No runtime write grants (REQ-RBAC-013): `platform_app` holds `SELECT` only. `permissions` carries no `reserved`/`signature_only`/`self_service` column — the flags are catalogue metadata that the guard tests and the generated matrix document use; the database holds keys, descriptions, categories, `operator_only` and the links.

| Table | Columns (besides STD) | Constraints / indexes |
|---|---|---|
| `permissions` | `key text N` (INT), `description text N`, `category text N`, `operator_only boolean N DEFAULT false` | `ux_permissions__key`; `ck_permissions__key_format CHECK (key ~ '^[a-z_]+:[a-z_]+(:[a-z_]+)?$' OR key IN ('public','authenticated'))` |
| `roles` | `key text N` (e.g. `OPERATOR_SUPER_ADMIN`, `CUSTOMER_OWNER`, `PARTNER_DEVELOPER`), `name_key text N` (i18n key), `scope text N` CHECK `role_scope`, `is_system boolean N DEFAULT true`, `description text N` | `ux_roles__key`; AP-AUTHZ-01 roles by scope `ix_roles__scope` |
| `role_permissions` | `role_id uuid N FK`, `permission_id uuid N FK` | `ux_role_permissions__role_permission`; AP-AUTHZ-02 permissions of roles `ix_role_permissions__role_id INCLUDE (permission_id)` |

The effective-permission query (REQ-RBAC-008) is one statement: memberships (AP-ORG-08) → membership_roles (AP-ORG-09) → role_permissions (AP-AUTHZ-02) → permissions; its result is cached in Redis for at most 5 s and invalidated on membership change.

### 3.4 Audit module

#### `audit_entries` · SYSTEM (no RLS, ADR-0005) · SD: no · append-only, immutable (DB-enforced) · partitioned by RANGE (`occurred_at`) monthly

ADR-0007, REQ-AUDIT-002/003/004/007/008/009/010/011/012/014/016/017/018, DR-A09..A13, NFR-AUDIT-001..006. Full DDL in §5.1. Access only through `packages/audit`; the viewer repository applies the scope that RLS would otherwise apply (`scope_org_id = active org` unless the request carries verified operator scope, REQ-AUDIT-023) and the route requires `audit:read`. **Exempt from P2 standard columns** (immutable rows have no `updated_*`/`version`; `occurred_at` plays `created_at`, `user_id` plays `created_by`) — OI-08.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| `id` | `uuid` | N | UUIDv7 (app) | INT |
| `occurred_at` | `timestamptz` | N | database clock `clock_timestamp()` read **after** the stream lock is held (§5.4); partition key | INT |
| `stream_id` | `uuid` | N | `org_id`, or one of the 16 SYSTEM shard UUIDs (§1.6, ADR-0007 amendment 1) | INT |
| `stream_seq` | `bigint` | N | `audit_stream_heads.entry_count + 1`, allocated under the stream lock; explicit chain order and gap detector (OI-05) | INT |
| `org_id` | `uuid` | Y | actor's active organisation | INT |
| `target_org_id` | `uuid` | Y | organisation whose data was touched by an operator cross-tenant action (REQ-RLS-006, DR-A15) | INT |
| `scope_org_id` | `uuid` | Y | `GENERATED ALWAYS AS (COALESCE(target_org_id, org_id)) STORED`; the viewer's "organisation" filter | INT |
| `on_behalf_of_org_id` | `uuid` | Y | NULL in M1 (DR-A06) | INT |
| `actor_type` | `text` | N | CHECK `actor_type` | INT |
| `user_id` | `uuid` | Y | NULL for ANONYMOUS; SYSTEM actor id for jobs | INT |
| `api_key_id` | `uuid` | Y | seam (M3) | INT |
| `job_name` | `text` | Y | required when `actor_type = 'SYSTEM_JOB'` (`CHECK`) | INT |
| `actor_roles` | `text[]` | N | `DEFAULT '{}'`; role keys at the time | INT |
| `session_id` | `uuid` | Y | | INT |
| `ip_token` | `uuid` | Y | PII-vault token of the client IP (ADR-0007 amendment 2) | PER (token) |
| `ip_hash` | `bytea` | Y | HMAC-SHA256(`AUDIT_INDEX_KEY`, IP) for the viewer's IP equality filter | INT |
| `ip_hash_key_id` | `text` | Y | `<purpose>-v<n>` of `AUDIT_INDEX_KEY`; `ck_audit_entries__ip_hash_key CHECK ((ip_hash IS NULL) = (ip_hash_key_id IS NULL))`. Part of the hashed canonical object like every other column. During a rotation, the viewer's IP filter computes the HMAC under each live key and queries `ip_hash = ANY($hashes)` (amended 2026-11-12, SEC-P3-08 item 1) | INT |
| `ip_coarse` | `inet` | Y | /24 (IPv4) or /48 (IPv6) network, in clear (not personal data at that granularity, ADR-0007 amendment 2) | INT |
| `user_agent_token` | `uuid` | Y | PII-vault token of the raw UA string (ADR-0007 amendment 2) | PER (token) |
| `ua_parsed` | `text` | Y | browser family + major version / OS family only (e.g. `Firefox 146 / Windows`) | INT |
| `source_app` | `text` | N | CHECK `source_app` | INT |
| `correlation_id` | `text` | N | `CHECK (correlation_id ~ '^[A-Za-z0-9-]{8,64}$')` | INT |
| `action` | `text` | N | CHECK `audit_action` | INT |
| `entity_name` | `text` | N | `CHECK (entity_name ~ '^[a-z][a-z0-9_]*$')` | INT |
| `entity_id` | `text` | Y | NULL for list views | INT |
| `outcome` | `text` | N | CHECK `audit_outcome` | INT |
| `reason_token` | `uuid` | Y | PII-vault token of the typed reason (REQ-AUDIT-025, ≤ 500 chars; ADR-0007 amendment 2) | PER (token) |
| `reauth_proof_id` | `uuid` | Y | seam for the M2 signature record (§4.9 Part 11) | INT |
| `signature_meaning` | `text` | Y | seam (M2) | INT |
| `http_method` | `text` | Y | | INT |
| `route` | `text` | Y | route template, never the concrete URL | INT |
| `old_value`, `new_value` | `jsonb` | Y | field-level diff, keys sorted (REQ-AUDIT-007); `PER`/`SPER` values replaced by `{"$pii":"<token>"}`, `SEC` by `"[REDACTED]"` | INT (tokenised) |
| `details` | `jsonb` | Y | context snapshot: filter summary (filter values tokenised, ADR-0007 amendment 2) + result count (DR-A13), required permission (REQ-RBAC-007), document id/version/sha256 (REQ-DOC-008), carrier operation (`carrier_call`), from/to state | INT |
| `pii_token_count` | `integer` | N | `DEFAULT 0 CHECK (pii_token_count >= 0)` | INT |
| `hash_version` | `smallint` | N | `DEFAULT 1` (canonicalisation version) | INT |
| `prev_hash` | `bytea` | N | `CHECK (octet_length(prev_hash) = 32)`; 32 zero bytes for `stream_seq = 1` | INT |
| `entry_hash` | `bytea` | N | `CHECK (octet_length(entry_hash) = 32)` | INT |

Keys and constraints: `PRIMARY KEY (occurred_at, id)`; `UNIQUE (entry_hash, occurred_at)` — PostgreSQL requires the partition key in every unique constraint of a partitioned table, so ADR-0007's "`entry_hash` UNIQUE" is enforced per partition and global uniqueness of `entry_hash` and `(stream_id, stream_seq)` is asserted by the verifier (OI-05).

Amended 2026-11-12 (SEC-P3-03, SEC-P3-08): added `ip_hash_key_id`. The table, every partition and every other audit-module table are owned by **`platform_audit_owner`** and created or altered only in the bootstrap lane (§4.4, §5, §8.3). `platform_migrator` owns none of them.

| AP | Query (all carry a mandatory `occurred_at` range ≤ 31 days, REQ-AUDIT-019) | Index (created on the parent, propagated to every partition) |
|---|---|---|
| AP-AUD-01 | Time range, newest first, keyset `(occurred_at DESC, id DESC)` | PK `(occurred_at, id)` scanned backwards |
| AP-AUD-02 | Organisation + time | `ix_audit__scope_org_time ON (scope_org_id, occurred_at DESC, id DESC)` |
| AP-AUD-03 | User + time | `ix_audit__user_time ON (user_id, occurred_at DESC, id DESC) WHERE user_id IS NOT NULL` |
| AP-AUD-04 | Entity name + entity id + time (also entity history, REQ-AUDIT-021, chronological) | `ix_audit__entity_time ON (entity_name, entity_id, occurred_at DESC, id DESC)` |
| AP-AUD-05 | Action + time | `ix_audit__action_time ON (action, occurred_at DESC, id DESC)` |
| AP-AUD-06 | Outcome (DENIED/FAILED) + time | `ix_audit__outcome_time ON (outcome, occurred_at DESC, id DESC) WHERE outcome <> 'SUCCESS'` |
| AP-AUD-07 | IP + time (exact IP via `ip_hash`, network via `ip_coarse`) | `ix_audit__ip_hash_time ON (ip_hash, occurred_at DESC, id DESC) WHERE ip_hash IS NOT NULL`; `ix_audit__ip_coarse_time ON (ip_coarse, occurred_at DESC, id DESC) WHERE ip_coarse IS NOT NULL` |
| AP-AUD-08 | Role filter (combined with the time range) | `ix_audit__roles USING gin (actor_roles)` |
| AP-AUD-09 | Chain verification and head recovery by stream (ADR-0007's `(stream_id, occurred_at)` order equals `stream_seq` order because `occurred_at` is taken after the lock and kept monotonic) | `ix_audit__stream_seq ON (stream_id, stream_seq)` |
| AP-AUD-15 | Correlation id (support: all entries of one request/job) | `ix_audit__correlation ON (correlation_id)` |
| AP-AUD-10 | Entry detail by id (`GET /audit/entries/{id}`) | The API cursor/ID carries the timestamp (`id` is UUIDv7, so `uuid_extract_timestamp(id)` bounds `occurred_at` to ±1 s), letting the query add `occurred_at BETWEEN t - 1 s AND t + 1 s` and prune to one partition; PK lookup |

Write amplification: 12 index entries per audit insert (PK, unique hash, 10 secondary). At the design load of ≈ 40 audit writes/s peak (§10) this is ≈ 500 index tuples/s, well inside one instance; AP-AUD-06/07 are partial to stay small, and AP-AUD-08 (GIN) uses `fastupdate` (default on) so pending-list inserts are batched. Index count is reviewed at M5 with real filter usage; dropping one is a contract step.

**Partition pruning proof (REQ-AUDIT-016).** Every viewer query has the form `WHERE occurred_at >= $from AND occurred_at < $to [AND <filter>] ORDER BY occurred_at DESC, id DESC LIMIT $n`. With literal or custom-plan parameters the planner prunes at plan time; with a generic plan (prepared statement reused > 5 times by `pg`) pruning happens at executor start-up and `EXPLAIN` shows `Subplans Removed: N`. The integration test (Testcontainers, 1M seeded rows across ≥ 4 monthly partitions, NFR-PERF-006) runs `EXPLAIN (FORMAT JSON)` for a one-day range (a) with literals and (b) after `SET plan_cache_mode = force_generic_plan` via `PREPARE`/`EXPLAIN EXECUTE`, and asserts that the Append node has exactly one non-pruned child (`audit_entries_YYYY_MM` of that day) and that no node is a `Seq Scan` on a partition with > 10,000 rows. A cross-month range of ≤ 31 days touches at most two partitions (asserted as well).

#### `audit_stream_heads` · SYSTEM · SD: no · mutable (under the stream lock only)

ADR-0007 (per-stream chain), REQ-AUDIT-012, EC-A22. O(1) predecessor lookup that does not depend on RLS visibility of the previous entry (an anonymous request may append to an org stream without being able to read that stream).

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `stream_id` | `uuid` | N | `UNIQUE` | INT |
| `entry_count` | `bigint` | N | `DEFAULT 0` (= `stream_seq` of the head entry) | INT |
| `head_entry_id` | `uuid` | Y | | INT |
| `head_occurred_at` | `timestamptz` | Y | | INT |
| `head_hash` | `bytea` | N | 32 zero bytes by default | INT |
| `last_verified_seq` | `bigint` | N | `DEFAULT 0` | INT |
| `last_verified_hash` | `bytea` | N | 32 zero bytes | INT |
| `last_verified_occurred_at` | `timestamptz` | Y | | INT |

The head is a cache, not evidence: if it were tampered with, the next entry would chain to a wrong predecessor and the verifier (which walks entries, §5.6) reports the break.

#### `audit_partitions` · SYSTEM · SD: no · mutable (metadata only)

REQ-AUDIT-017/018 (archive marker seam), NFR-AUDIT-007. Columns: STD; `partition_name text N UNIQUE` (`audit_entries_YYYY_MM`); `range_start timestamptz N`; `range_end timestamptz N` (`CHECK (range_end > range_start)`); `closed_at timestamptz Y` (month ended and verified); `row_count_at_close bigint Y`; `archived_at timestamptz Y` (seam; no job writes it in this run); `archive_object_key text Y`; `archive_manifest_sha256 bytea Y`. AP-AUD-11 future partitions count for readiness (`ix_audit_partitions__range_start`).

#### `audit_chain_verifications` · SYSTEM · SD: no · mutable (run row updated as it progresses)

REQ-AUDIT-013, NFR-AUDIT-003. Columns: STD; `run_kind text N CHECK (run_kind IN ('INCREMENTAL','FULL'))`; `status text N CHECK (status IN ('RUNNING','PASSED','FAILED','ERROR'))`; `started_at timestamptz N`; `finished_at timestamptz Y`; `streams_checked integer N DEFAULT 0`; `entries_checked bigint N DEFAULT 0`; `first_broken_stream_id uuid Y`; `first_broken_entry_id uuid Y`; `first_broken_occurred_at timestamptz Y`; `failure_kind text Y CHECK` `chain_failure_kind` (§1.7: `HASH_MISMATCH`, `PREV_HASH_MISMATCH`, `SEQ_GAP`, `SEQ_DUPLICATE`, `DUPLICATE_ENTRY_HASH`, `HEAD_MISMATCH`, `CHECKPOINT_HEAD_MISMATCH`, `CHECKPOINT_SIGNATURE_INVALID`, `ANCHOR_MISSING`); `checkpoint_entry_id uuid Y`; `anchor_seq_from bigint Y`, `anchor_seq_to bigint Y` (range of anchors checked by this run). AP-AUD-12 latest result for `/health/ready` and `GET /audit/chain/status`: `ix_audit_chain_verifications__started ON (started_at DESC)`.

Amended 2026-11-12 (SEC-P3-03): three failure kinds and the `anchor_seq_from/_to` columns were added (§5.6).

#### `audit_checkpoint_heads` · SYSTEM · SD: no · append-only

ADR-0007 `CHAIN_CHECKPOINT` (OI-07; hourly since amendment 7). One row per stream head captured by a checkpoint (§5.5): STD; `checkpoint_entry_id uuid N` (the SYSTEM-shard-0 entry whose `new_value.heads_digest` = SHA-256 over the sorted `(stream_id ‖ entry_count ‖ head_hash)` list); `stream_id uuid N`; `entry_count bigint N`; `head_hash bytea N`; `head_occurred_at timestamptz Y` (locator: lets the verifier fetch the anchored head entry with partition pruning; not part of the digest, and a wrong value makes the lookup fail, which is reported as a mismatch). `ux_audit_checkpoint_heads__checkpoint_stream ON (checkpoint_entry_id, stream_id)`; `ix_audit_checkpoint_heads__stream_checkpoint ON (stream_id, checkpoint_entry_id DESC)` (latest captured head per stream). The digest inside the chain anchors these rows; altering any row changes the recomputed digest.

Amended 2026-11-12 (SEC-P3-03): checkpoints are **hourly**, and each one stores **delta rows only**: one row per stream whose `entry_count` changed since that stream's previous captured row. The first checkpoint stores every stream. `heads_digest` is still computed over the **full** head set. The full set at checkpoint *k* is reconstructed as the latest row per stream with `checkpoint_entry_id ≤ k` (UUIDv7 order = time order; one checkpoint per hour). With about 125 k streams in Y1 (one per organisation, §10.1), full hourly snapshots would add about 3 M rows a day; deltas add about 50–100 k. Added `head_occurred_at` and the second index.

#### `audit_anchors` · SYSTEM · SD: no · append-only (DB-enforced)

**New (2026-11-12, SEC-P3-03; ADR-0007 amendment 7).** One signed, hash-chained record per checkpoint. The same record is appended to the external sink `AUDIT_ANCHOR_SINK` (§5.5). Owner `platform_audit_owner`; `platform_app` has `SELECT, INSERT`; the append-only triggers match those on the entries (§5.2). Exempt from P1/P2: the key is the dense `anchor_seq`, not a UUIDv7 `id`, because gap detection is the purpose of the key. It is allocated as `max + 1` under the advisory lock `audit:anchors` and never from a sequence object, because sequences skip values on rollback and would produce false gaps. Rows are never updated, so there are no `updated_*`/`version` columns (OI-08 exemption list).

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| `anchor_seq` | `bigint` | N | PK; `CHECK (anchor_seq >= 1)`; dense (+1) | INT |
| `checkpoint_entry_id` | `uuid` | N | `UNIQUE`; the SYSTEM-shard-0 `CHAIN_CHECKPOINT` entry (no FK: the partitioned PK is `(occurred_at, id)`; the verifier resolves it) | INT |
| `created_at` | `timestamptz` | N | microsecond precision; part of the signed hash | INT |
| `heads_digest` | `bytea` | N | `CHECK (octet_length(heads_digest) = 32)`; equals the checkpoint entry's `new_value.heads_digest` | INT |
| `prev_anchor_hash` | `bytea` | N | `CHECK (octet_length(prev_anchor_hash) = 32)`; 32 zero bytes for `anchor_seq = 1` | INT |
| `anchor_hash` | `bytea` | N | `UNIQUE`; `CHECK (octet_length(anchor_hash) = 32)`; `SHA-256(be64(anchor_seq) ‖ UTF-8(created_at as YYYY-MM-DDTHH:MM:SS.ffffffZ) ‖ heads_digest ‖ prev_anchor_hash)` | INT |
| `algorithm` | `text` | N | `CHECK (algorithm = 'ECDSA_P256_SHA256')` | INT |
| `key_id` | `text` | N | `<purpose>-v<n>` of `AUDIT_ANCHOR_SIGNING_KEY`; the verifier looks it up in `AUDIT_ANCHOR_PUBLIC_KEYS` | INT |
| `signature` | `bytea` | N | ECDSA P-256 with SHA-256 over the 32-byte message `anchor_hash`, DER-encoded (`CHECK (octet_length(signature) BETWEEN 8 AND 72)`) | INT |

AP-AUD-16 previous anchor and anchor ranges: PK. AP-AUD-17 anchor of a checkpoint: `ux_audit_anchors__checkpoint_entry_id`. Volume: 24 rows/day.

#### `audit_pii_vault` · SYSTEM (encrypted vault) · SD: no · insert-only; hard delete only by the erasure role (M4/M5)

ADR-0007, A-045, REQ-AUDIT-009, NFR-PRIV-002. DDL in §5.7.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| `token` | `uuid` | N | PK (UUIDv7) | INT |
| STD (without `id`; `token` is the key) | | | | INT |
| `subject_id` | `uuid` | N | FK `data_subjects(id)` | INT |
| `classification` | `text` | N | `CHECK (classification IN ('PERSONAL','SENSITIVE_PERSONAL'))` | INT |
| `entity_name` | `text` | N | audited entity (e.g. `shipment_party`, `audit_entry`) | INT |
| `field` | `text` | N | field name (e.g. `name`, `ip`, `reason`) | INT |
| `value_hmac` | `bytea` | N | HMAC-SHA256(value, per-env vault HMAC key); dedupe key so a repeated value for the same subject and field reuses its token | SEC |
| `value_hmac_key_id` | `text` | N | `<purpose>-v<n>` of the vault HMAC key | INT |
| `ciphertext` | `bytea` | N | AES-256-GCM(96-bit nonce ‖ ct ‖ 128-bit tag) of the UTF-8 value under `AUDIT_VAULT_KEY`; AAD = (`audit_pii_vault`, `ciphertext`, `token`, `ciphertext_key_id`) | SEC (holds PER/SPER) |
| `ciphertext_key_id` | `text` | N | `<purpose>-v<n>` of `AUDIT_VAULT_KEY` | INT |

`ux_audit_pii_vault__subject_field_value ON (subject_id, entity_name, field, value_hmac)` (AP-AUD-13 token reuse); AP-AUD-14 erasure by subject: `ix_audit_pii_vault__subject`.

Amended 2026-11-12 (SEC-P3-08 item 1): `key_id` was renamed to `ciphertext_key_id`, and `value_hmac_key_id` was added. The AAD binds each ciphertext to its token, so swapping ciphertexts between vault rows fails GCM authentication (T-89, SEC-TC-49). After a rotation of the HMAC key, a repeated value under the new key gets a new token instead of reusing the old one. That only costs dedupe; it never affects correctness. Vault DDL is in the bootstrap lane (owner `platform_audit_owner`). No RLS (SYSTEM, ADR-0005); access only through `packages/audit`; vault reads are themselves `SENSITIVE` views allowed to `audit:read` holders (ADR-0007). It is exempt from the SYSTEM-no-PII test because its PII is encrypted.

#### `data_subjects` · SYSTEM · SD: no · insert-only (+ `erased_at`)

Columns: STD; `kind text N CHECK (kind IN ('USER','CONTACT'))`; `ref_id uuid N` (user id, or `shipment_parties.id` / `address_book_entries.id` / `invitations.id` for contacts); `erased_at timestamptz Y` (M4/M5). `ux_data_subjects__kind_ref ON (kind, ref_id)`.

### 3.5 Platform module

#### `outbox_events` · SYSTEM · SD: no · mutable (`published_at`, `attempts`) · hard-delete allow-listed (published > 7 d)

ADR-0004, REQ-PLAT-016/017, DR-A25, EC-A39. DDL in §6.1.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `type` | `text` | N | dotted lower-case catalogue name; `CHECK (type ~ '^[a-z_]+\.[a-z_]+$')` | INT |
| `aggregate_type` | `text` | N | | INT |
| `aggregate_id` | `uuid` | N | | INT |
| `org_id` | `uuid` | Y | **authoritative** tenant context of every job derived from the event; read by `platform.job_context('outbox_event', id)` (§4.5), never copied into the BullMQ payload (amended 2026-11-12, SEC-P3-12); this table is on the non-RLS allow-list | INT |
| `actor_id` | `uuid` | N | initiating actor, returned by `job_context` | INT |
| `payload` | `jsonb` | N | IDs, codes, recipient locale (REQ-I18N-008); never PER values (schema-validated per type). One-time e-mail tokens travel only as `token_enc` (base64 AES-256-GCM under `OUTBOX_PAYLOAD_KEY`) with the sibling field `token_enc_key_id`; AAD = (`outbox_events`, `payload.token_enc`, `id`, `token_enc_key_id`) (amended 2026-11-12, SEC-P3-08 item 1; §12 `token_enc`) | INT (`token_enc` registered SEC) |
| `correlation_id` | `text` | N | | INT |
| `trace_context` | `text` | Y | W3C `traceparent` | INT |
| `published_at` | `timestamptz` | Y | | INT |
| `attempts` | `integer` | N | `DEFAULT 0` | INT |
| `last_error` | `text` | Y | ≤ 500, no payload echo | INT |

AP-PLAT-01 relay batch: `ix_outbox_events__unpublished ON (created_at, id) WHERE published_at IS NULL`; AP-PLAT-02 purge: `ix_outbox_events__published_at ON (published_at) WHERE published_at IS NOT NULL`. Per-aggregate order (REQ-PLAT-017) holds because the relay publishes in `(created_at, id)` order and a single relay instance holds the batch lock (`FOR UPDATE SKIP LOCKED` lets a second instance take the next batch; BullMQ `jobId = event id` dedupes a crash replay).

#### `processed_events` · SYSTEM · SD: no · insert-only · hard-delete allow-listed (> 30 d)

Columns: STD; `consumer text N`; `event_id uuid N`; `processed_at timestamptz N DEFAULT now()`. `ux_processed_events__consumer_event ON (consumer, event_id)` (AP-PLAT-03, consumer dedupe inside the consumer's business transaction); `ix_processed_events__processed_at` for purge.

#### `idempotency_keys` · SYSTEM · SD: no · mutable · hard-delete allow-listed (expired, and 5xx/429 outcomes)

REQ-API-009/010/011, DR-A20, EC-A27..A30. Protocol in §6.2.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `scope_hash` | `bytea` | N | SHA-256 of `org_id or guest token hash ‖ actor_id ‖ method ‖ path ‖ key`; `UNIQUE` | INT |
| `scope_org_id` | `uuid` | Y | informational | INT |
| `actor_id` | `uuid` | Y | | INT |
| `method` | `text` | N | | INT |
| `path` | `text` | N | concrete path (IDs only) | INT |
| `idem_key` | `text` | N | `CHECK (idem_key ~ '^[\x21-\x7E]{1,255}$')` | INT |
| `fingerprint` | `bytea` | N | SHA-256 of method, path, canonical query and body (32 bytes) | INT |
| `status` | `text` | N | `CHECK (status IN ('IN_PROGRESS','COMPLETED'))` | INT |
| `lease_until` | `timestamptz` | N | in-progress lease (30 s) for crash recovery | INT |
| `response_status` | `smallint` | Y | 2xx/4xx only | INT |
| `response_headers` | `jsonb` | Y | allow-listed headers (ETag, Location) | INT |
| `response_body` | `bytea` | Y | AES-256-GCM (96-bit nonce ‖ ct ‖ 128-bit tag) of the UTF-8 JSON body under `IDEMPOTENCY_BODY_KEY`; AAD = (`idempotency_keys`, `response_body`, `scope_hash` (hex), `response_body_key_id`); may contain personal data of the caller's own resource; kept 24 h only; routes on the ADR-0014 one-time-secret list (`createQuote`, `createQuoteShare`, …) are `not-applicable` and never stored | PER (encrypted) |
| `response_body_key_id` | `text` | Y | `<purpose>-v<n>`; `ck_idempotency_keys__body_key CHECK ((response_body IS NULL) = (response_body_key_id IS NULL))` | INT |
| `expires_at` | `timestamptz` | N | created + 24 h | INT |

AP-PLAT-04 claim/lookup: `ux_idempotency_keys__scope_hash`; AP-PLAT-05 purge: `ix_idempotency_keys__expires_at`. This is the one SYSTEM table allowed a `PER` column (explicit allow-list entry), justified by the 24 h hard-delete, by encryption at rest and by `response_body` only ever echoing the caller's own data.

Amended 2026-11-12 (SEC-P3-08 item 1, SEC-P3-10): `response_body` changed from clear `jsonb` to `bytea` ciphertext, and `response_body_key_id` was added. The AAD uses `scope_hash`, so a stored body cannot be replayed under another key scope. The one-time-secret routes are never stored.

#### `feature_flags` · GLOBAL (runtime write under `featureflag:manage`) · SD: yes · mutable

REQ-PLAT-020/021, DR-A28, A-056. Columns: STD, SD; `key text N` (`CHECK (key ~ '^[a-z][a-z0-9_.-]{2,63}$')`); `description text N`; `default_value boolean N DEFAULT false`; `owner_task_id text Y` (tracked task ID, product brief §13 rule 5). `ux_feature_flags__key ON (key) WHERE deleted_at IS NULL` (AP-PLAT-06).

#### `feature_flag_overrides` · GLOBAL (runtime write) · SD: yes · mutable

Columns: STD, SD; `flag_id uuid N FK`; `environment text Y CHECK (environment IN ('local','test','staging','production'))`; `target_org_id uuid Y` (named `target_` because it targets, it does not own: global table); `value boolean N`; `percentage smallint Y CHECK (percentage BETWEEN 0 AND 100)` (Could). `CHECK (environment IS NOT NULL OR target_org_id IS NOT NULL)`; `ux_feature_flag_overrides__flag_env_org ON (flag_id, environment, target_org_id) NULLS NOT DISTINCT WHERE deleted_at IS NULL` (AP-PLAT-07, whole table cached ≤ 30 s).

#### `number_sequences` · GLOBAL (UPDATE of counters only) · SD: no · mutable

DR-A24, DR-B22, REQ-DATA-015, REQ-BOOK-026. Allocation SQL in §6.4.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `scope` | `text` | N | `CHECK (scope IN ('ORDER','INVOICE','CREDIT_NOTE'))` | INT |
| `country` | `char(2)` | N | FK `countries(code)` | PUB |
| `next_value` | `bigint` | N | `DEFAULT 1`, `CHECK (next_value BETWEEN 1 AND 100000000)` (8-digit space; the update fails loudly before overflow) | INT |
| `allocation_enabled` | `boolean` | N | `DEFAULT true`; `false` for `INVOICE`/`CREDIT_NOTE` until M2 (seam, DR-A24) | INT |

`ux_number_sequences__scope_country` (AP-PLAT-08).

#### `consent_records` · USER_OWNED (insert open for anonymous decisions) · SD: no · append-only

REQ-UI-023, REQ-ACCT-012, REQ-COMP-007, NFR-PRIV-005, EC-A47.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `subject_kind` | `text` | N | `CHECK (subject_kind IN ('USER','ANONYMOUS'))` | INT |
| `user_id` | `uuid` | Y | FK `users(id)` | INT |
| `anonymous_id` | `uuid` | Y | first-party cookie identifier; `CHECK (num_nonnulls(user_id, anonymous_id) >= 1)` | PER |
| `purpose` | `text` | N | `CHECK (purpose IN ('COOKIES','EMAIL_TRACKING_UPDATES','EMAIL_MARKETING'))` | INT |
| `decision` | `text` | N | `CHECK (decision IN ('GRANTED','DENIED','CUSTOM'))` | INT |
| `categories` | `text[]` | N | `DEFAULT '{necessary}'`, subset of `necessary, preferences, analytics, marketing`; `CHECK ('necessary' = ANY(categories))` for cookies | INT |
| `policy_country` | `text` | N | pack country or `EU` | INT |
| `policy_version` | `text` | N | consent-rule / pack version | INT |
| `locale` | `text` | N | | INT |
| `source` | `text` | N | `CHECK (source IN ('BANNER','PREFERENCES','REGISTRATION'))` | INT |
| `decided_at` | `timestamptz` | N | `DEFAULT now()` | INT |

AP-PLAT-09 latest decision of a visitor/user per purpose: `ix_consent_records__anon_purpose ON (anonymous_id, purpose, decided_at DESC) WHERE anonymous_id IS NOT NULL` and `ix_consent_records__user_purpose ON (user_id, purpose, decided_at DESC) WHERE user_id IS NOT NULL`.

#### `reference_dataset_versions` · SYSTEM · SD: no · mutable

Seed idempotency and audit (REQ-DATA-001, REQ-RBAC-013, REQ-COMP-008). Columns: STD; `dataset text N UNIQUE` (e.g. `countries`, `authz_matrix`, `compliance_pack:IN`); ~~`version text N`~~ **`dataset_version text N`** *(renamed 2026-11-13, D-TASK023-01 (01), PR #13 code review ruling: the STD `version` column stays the optimistic-locking row counter, so the dataset label is `dataset_version`)*; `content_sha256 bytea N`; `applied_at timestamptz N`; `row_count integer N`. A seed run compares the dataset hash and is a no-op (no audit entry) when unchanged (REQ-COMP-008 "none on a no-op re-run").

*Amended 2026-11-13 (PR13-SEC-04, PR13-SEC-08, PR #13 code review n3/n6 and ruling on D-TASK023-01 (01); D-ARCH-075):*
- **Single writer.** The table has exactly one writer: the seed CLI (`db:seed`, `db:seed:demo`), which connects as `platform_migrator` — the table owner. **`platform_app` holds `SELECT` only** (§4.4 as amended; `prisma/sql/grants.manifest` carries one line; C5 asserts it). No runtime code writes the table: the US-073 reconciler (TASK-221) **reads** it and derives the last *audited* digest from `audit_entries` (the tamper-evident store, `SELECT` for `platform_app`), never from a row it would have to write itself — so there is no `authz_matrix` row to drop in a `down.sql`, no second "∅ → current" baseline after a down → up (PR13-SEC-08), and nothing a compromised `platform_app` could pre-write to suppress a `CONFIG_CHANGE` or poison the next seed run (PR13-SEC-04). The dataset name `authz_matrix` stays reserved (`RESERVED_DATASET_NAMES`, PR #13 n6): no seed dataset may take it, and the reconciler keys its audit entries on it (`entity_name = 'reference_dataset_versions'`, `entity_id`/`entity_key = 'authz_matrix'`).
- **If a runtime writer is ever needed**, the sanctioned form is a `platform_definer`-owned `SECURITY DEFINER` function in the §4.5 pattern (`SET search_path = pg_catalog, pg_temp`, `SET ROLE platform_definer; … RESET ROLE;` block, §8.3 rule 15, C11 allow-list), whose body pins the writable `dataset` names; **a direct `INSERT`/`UPDATE` grant to `platform_app` and RLS on this SYSTEM table are both rejected** (the class rule "SYSTEM = no RLS", C1 allow-list, is not bent for one row). Reviewer option 4 (`CHECK (version < 2147483647)`) is not adopted: once no runtime role can write the row, the overflow needs the owner credential.
- **Shared contract for the reconciler.** `DatasetVersionStore` (PR #13, `prisma/seed/framework/version-store.ts`) is reusable only from `prisma/` or `tools/` (apps cannot import `prisma/`, and raw SQL in apps needs the §8.3/PR #11 tags). The contract the worker-side reconciler shares with the seed is therefore **the table itself** — `(dataset, dataset_version, content_sha256, applied_at, row_count)` read through the generated client in `packages/authz`'s reconciler — not that object (PR #13 code review ruling).
- **Durable `CONFIG_CHANGE` for seed-originated changes (TASK-025 / TASK-221 boundary; PR13-SEC-08 TASK-025 item).** The seed path runs on the **migrator** connection inside the seed transaction, and `INSERT` on `audit_entries` belongs to `platform_app` only (§4.4 item 5, audit-owner separation). **The migrator gains no privilege on any audit table.** Consequently the seed's `ConfigChangeSink` stays a port whose seed-path implementation records state in this table and logs (D-TASK023-01 (04)); the durable audit entries are written by the post-migrate **reconciler job** (TASK-221, `SYSTEM_JOB` via `platform.job_context`, the real audit writer of TASK-025) for **every audited dataset**, not only `authz_matrix`: for each row it compares `(dataset, dataset_version, content_sha256)` with the last `CONFIG_CHANGE` entry for that dataset in the audit log and writes one entry per changed version (first run: baseline ∅ → current); a re-run writes nothing (REQ-RBAC-013, REQ-COMP-008). **Drift restores** (PR #13 code review m5/R2-m1: a hand-edited or hand-deleted row of an audited dataset restored by the upsert) are recorded by the seed on the row — TASK-221 adds, in an expand migration, `drift_restored_rows bigint N DEFAULT 0` (cumulative) and `last_drift_restored_at timestamptz Y` — and the reconciler audits a changed counter as `CONFIG_CHANGE` with `reason = 'drift-restored'`; until TASK-221 lands, the seed's `warn seed.drift_restored` log line and the logging sink are the record (accepted as temporary in D-ORCH-016 (2)). security-analyst confirms this boundary at the TASK-025 and TASK-221 reviews.
- **Pool rule for later callers (PR #13 n3).** `SeedSql` runs `BEGIN`, the advisory lock and `COMMIT` on **one** connection: TASK-089's provisioner and any later wiring pass a `pg.Client`, never a `pg.Pool`; a pool would spread the statements over connections and a refused run would leave partial writes.

#### `data_migration_runs` · SYSTEM · SD: no · mutable

Throttled resumable backfills (§8.5). Columns: STD; `name text N UNIQUE`; `status text N CHECK (status IN ('PENDING','RUNNING','PAUSED','COMPLETED','FAILED'))`; `last_key jsonb Y` (keyset position); `rows_done bigint N DEFAULT 0`; `rows_estimate bigint Y`; `batch_size integer N DEFAULT 1000`; `pause_ms integer N DEFAULT 200`; `started_at`, `finished_at timestamptz Y`; `last_error text Y`.


### 3.6 Reference module (GLOBAL, read-only at runtime, seeded)

All reference tables carry STD plus `source text N CHECK reference_source` and, where content may be legally or commercially relevant, `reviewed_at timestamptz Y` and `reviewed_by text Y` (PER: reviewer name) (DR-A27). The API exposes `unreviewed: true` when `reviewed_at IS NULL` (REQ-COMP-004). Runtime access is `SELECT` only; the reference seed (as `platform_migrator`) is the only writer. Names in three locales are explicit columns (`name_en`, `name_es`, `name_fr`), not JSONB, because they are selected by locale in every query (REQ-DATA-016). All columns of reference tables are `PUB` unless stated.

| Table | Columns (besides STD, `source`) | Constraints and access-pattern indexes | REQs |
|---|---|---|---|
| `countries` | `code char(2) N`, `alpha3 char(3) N`, `numeric_code char(3) N`, `name_en/_es/_fr text N`, `currency_code char(3) N FK currencies(code)`, `unit_system text N CHECK (METRIC, IMPERIAL)`, `postcode_regex text Y`, `postcode_example text Y`, `location_type text N CHECK (POSTCODE_REQUIRED, POSTCODE_OPTIONAL, CITY_ONLY)`, `region_required boolean N DEFAULT false`, `address_format text N` (field-order template, e.g. `%N%n%O%n%A%n%C %S %Z`), `postcode_label_key text N`, `region_label_key text Y`, `phone_country_code text N`, `default_time_zone text N` (IANA), `shipping_enabled boolean N DEFAULT false`, `is_eu_member boolean N DEFAULT false`, `translation_reviewed boolean N DEFAULT false` | `ux_countries__code`, `ux_countries__alpha3`; AP-REF-01 enabled countries `ix_countries__shipping_enabled ON (shipping_enabled) WHERE shipping_enabled`; `CHECK (location_type <> 'POSTCODE_REQUIRED' OR postcode_regex IS NOT NULL)` | REQ-DATA-004/005, REQ-I18N-005, A-049 |
| `subdivisions` | `code text N` (ISO 3166-2, e.g. `US-CA`), `country_code char(2) N FK`, `name_en/_es/_fr text N`, `type text N CHECK (STATE, PROVINCE, TERRITORY, UNION_TERRITORY, DISTRICT, OTHER)`, `time_zone text N` (primary IANA zone; OI-14), `translation_reviewed boolean N DEFAULT false` | `ux_subdivisions__code`; AP-REF-02 by country `ix_subdivisions__country ON (country_code, code)`; `CHECK (code LIKE country_code \|\| '-%')` | REQ-DATA-007 |
| `currencies` | `code char(3) N`, `numeric_code char(3) N`, `minor_unit smallint N CHECK (minor_unit BETWEEN 0 AND 4)`, `name_en/_es/_fr text N`, `symbol text N` | `ux_currencies__code` | REQ-DATA-006 |
| `holidays` | `country_code char(2) N FK`, `region_code text Y FK subdivisions(code)`, `local_date date N`, `time_zone text N`, `name_en/_es/_fr text N`, `pickup_unavailable boolean N DEFAULT true`, `reviewed_at`, `reviewed_by` | `ux_holidays__natural ON (country_code, region_code, local_date, name_en) NULLS NOT DISTINCT`; AP-REF-03 by country + year range `ix_holidays__country_date ON (country_code, local_date)` | REQ-DATA-008, REQ-PICK-003, DR-B25 |
| `hs_codes` | `code text N CHECK (code ~ '^[0-9]{6}$')`, `chapter char(2) GENERATED ALWAYS AS (left(code,2)) STORED`, `description_en/_es/_fr text N` | `ux_hs_codes__code`; AP-REF-04 prefix search `ix_hs_codes__code_pattern ON (code text_pattern_ops)`; AP-REF-05 keyword search per locale `ix_hs_codes__desc_en_trgm USING gin (lower(description_en) gin_trgm_ops)` (and `_es`, `_fr`); `LIMIT 20` (REQ-DATA-010, REQ-CUST-006) | REQ-DATA-010, REQ-CUST-006/007 |
| `prohibited_items` | `item_key text N` (natural key), `scope text N CHECK (COUNTRY, CARRIER)`, `compliance_pack_id uuid Y FK compliance_packs`, `carrier_id uuid Y FK carriers`, `category text N`, `name_en/_es/_fr text N`, `status text N CHECK (PROHIBITED, RESTRICTED)`, `note_en/_es/_fr text Y`, `keywords_en/_es/_fr text[] N DEFAULT '{}'` (lower-cased, unaccented at seed), `synonyms text[] N DEFAULT '{}'`, `hs_prefixes text[] N DEFAULT '{}'` (`CHECK` each 2–6 digits), `reviewed_at`, `reviewed_by` | `CHECK ((scope = 'COUNTRY' AND compliance_pack_id IS NOT NULL AND carrier_id IS NULL) OR (scope = 'CARRIER' AND carrier_id IS NOT NULL AND compliance_pack_id IS NULL))`; `ux_prohibited_items__pack_key ON (compliance_pack_id, item_key) WHERE scope='COUNTRY'`, `ux_prohibited_items__carrier_key ON (carrier_id, item_key) WHERE scope='CARRIER'`; AP-REF-06 lookup by resolved pack + carrier (`ix_prohibited_items__pack`, `ix_prohibited_items__carrier`); keyword matching runs in the service on the cached per-(pack, carrier) list (≤ 2,000 rows) using the same normaliser for text and keywords | REQ-DATA-011, REQ-CUST-009, DR-B24, REQ-QUOTE-020 |
| `export_reasons` | `code text N CHECK (code IN ('SALE','GIFT','SAMPLE','REPAIR_RETURN','PERSONAL_EFFECTS','RETURNED_GOODS','TEMPORARY_EXPORT','DOCUMENTS'))`, `label_en/_es/_fr text N`, `documents_only boolean N DEFAULT false`, `customs_selectable boolean N DEFAULT true`, `sort_order smallint N` | `ux_export_reasons__code` | REQ-DATA-012, REQ-CUST-004 (customs-selectable subset excludes `TEMPORARY_EXPORT` and `DOCUMENTS`) |
| `incoterms` | `code text N CHECK (code ~ '^[A-Z]{3}$')`, `label_en/_es/_fr text N`, `courier_usable boolean N`, `is_default boolean N DEFAULT false` | `ux_incoterms__code`; `ux_incoterms__single_default ON (is_default) WHERE is_default` | REQ-DATA-013, REQ-CUST-005 |
| `fx_rates` | `base_currency char(3) N FK`, `quote_currency char(3) N FK`, `rate numeric(18,6) N CHECK (rate > 0)`, `as_of timestamptz N`, `source` | Insert-only (no runtime UPDATE grant; new snapshot = new row, REQ-DATA-014); `ux_fx_rates__pair_as_of ON (base_currency, quote_currency, as_of)`; AP-REF-07 latest at or before T `ix_fx_rates__pair_as_of_desc ON (base_currency, quote_currency, as_of DESC)`; `CHECK (base_currency <> quote_currency)` | REQ-DATA-014, REQ-PRICE-015, DR-B13, D-019 |
| `transit_days` | `carrier_service_id uuid N FK`, `origin_country char(2) N`, `destination_country char(2) N`, `min_days smallint N`, `max_days smallint N`, `CHECK (min_days >= 0 AND max_days >= min_days)` | `ux_transit_days__service_lane ON (carrier_service_id, origin_country, destination_country)` (AP-REF-08) | REQ-DATA-009, REQ-QUOTE-007 |
| `zones` (empty seam) | `code text N`, `name text N`, `carrier_id uuid Y FK`, `description text Y` | `ux_zones__code`; no seed rows, no endpoints | REQ-DATA-017, D-010 |
| `zone_countries` (empty seam) | `zone_id uuid N FK zones`, `country_code char(2) N FK`, `postcode_from text Y`, `postcode_to text Y` | `ix_zone_countries__zone ON (zone_id)`; `ix_zone_countries__country ON (country_code)` | REQ-DATA-017 |

Brief §4.10 also lists postcode ranges and remote areas; they belong to M2 rate cards and remote-area surcharges (REQ-PRICE-021 seam) and are not created now, so no table exists without a consumer (product brief §13 rule 5).

### 3.7 Compliance module (GLOBAL, insert-only versions)

REQ-COMP-001..008, DR-A23, D-020, EC-A43.

#### `compliance_packs`

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `country_code` | `text` | N | `CHECK (country_code ~ '^[A-Z]{2}$')` (ISO alpha-2 or `EU`) | PUB |
| `version` | `integer` | N | `CHECK (version >= 1)` | PUB |
| `effective_from` | `timestamptz` | N | | PUB |
| `published_at` | `timestamptz` | N | `DEFAULT now()` (seeded packs are published on load) | INT |
| `reviewed_by` | `text` | Y | | PER |
| `reviewed_at` | `timestamptz` | Y | `NULL` ⇒ `unreviewed: true` | PUB |
| `content_sha256` | `bytea` | N | hash over all sections (seed idempotency, tamper evidence) | INT |
| `source` | `text` | N | `SEED` | INT |

`ux_compliance_packs__country_version ON (country_code, version)`; AP-COMP-01 resolve pack in force at T (DR-A23): `ix_compliance_packs__country_effective ON (country_code, effective_from DESC)` with `WHERE country_code = $c AND effective_from <= $t ORDER BY effective_from DESC LIMIT 1`, falling back to `EU` for EU members, else `PACK_UNAVAILABLE`. Trigger `trg_compliance_packs__immutable` (BEFORE UPDATE OR DELETE) raises for every role (REQ-COMP-002 "edits of a published version are rejected at the database"); a review is recorded by publishing a new version.

#### `compliance_pack_sections`

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `pack_id` | `uuid` | N | FK `compliance_packs(id)` | INT |
| `section` | `text` | N | `CHECK (section IN ('TAX_RULES','CUSTOMS_THRESHOLDS','CUSTOMS_LANES','IDENTITY_REFERENCES','PROHIBITED_ITEMS','PRIVACY_NOTICE','LEGAL_DOCUMENTS','CONSENT_RULE','RETENTION'))` | INT |
| `schema_version` | `integer` | N | JSON Schema version validated by the seed loader (invalid pack fails the seed, REQ-COMP-001) | INT |
| `content` | `jsonb` | N | immutable section snapshot: tax rules per line type (rate as decimal string, taxable flag, tax code, label, display mode `INCLUSIVE`/`EXCLUSIVE`) (REQ-COMP-005, DR-B12); de-minimis `{amount_minor, currency}` and document exemption (REQ-COMP-006); customs-required lane rules (REQ-CUST-001, DR-B23); identity/tax reference types with regex per party role and lane (REQ-BOOK-008); privacy notice per locale (REQ-COMP-007); consent rule `NOTICE_ONLY`/`OPT_IN`/`OPT_OUT` + version; retention periods per data category (recorded, not enforced, NFR-PRIV-005); `PROHIBITED_ITEMS` holds only a reference list of `prohibited_items.item_key` (rows are relational, §3.6) | PUB |
| `content_sha256` | `bytea` | N | | INT |

`ux_compliance_pack_sections__pack_section`; same immutability trigger. Packs are small (≤ 50 kB) and cached per version in process; JSONB is acceptable because sections are never filtered in SQL (P8). Consumers store the pack country and version they used (`quotes.tax_pack_*`, `customs_declarations.pack_*`, REQ-COMP-002).

### 3.8 Carriers module

#### `carriers` · GLOBAL

REQ-CARR-002/004/006/021. Columns: STD, `source`; `code text N` (`DHL_EXPRESS`, `FEDEX`, `UPS`, `MOCK`; `CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$')`); `name text N`; `logo_asset_key text N`; `enabled boolean N DEFAULT true`; `non_production_only boolean N DEFAULT false` (`true` for MOCK, REQ-CARR-006); `push_tracking_supported boolean N`; `max_tracking_numbers_per_call smallint N DEFAULT 30`; `idempotent_create boolean N` (REQ-BOOK-021/023). `ux_carriers__code`.

#### `carrier_services` · GLOBAL

REQ-CARR-002/021, DR-B05, DR-B30, DR-B34, D-014. Single source for `capabilities()` (REQ-CARR-021 note).

| Column | Type | Null | Default / constraint |
|---|---|---|---|
| STD, `source`, `reviewed_at`, `reviewed_by` | | | |
| `carrier_id` | `uuid` | N | FK `carriers(id)` |
| `carrier_service_code` | `text` | N | carrier's own code |
| `canonical_code` | `text` | N | `<CARRIER>_<SERVICE>`; `UNIQUE` |
| `name_key` | `text` | N | i18n key |
| `tier` | `text` | N | `CHECK (tier IN ('EXPRESS','STANDARD','ECONOMY'))` |
| `directions` | `text[]` | N | `CHECK (directions <@ ARRAY['EXPORT','IMPORT','DOMESTIC'] AND cardinality(directions) > 0)` |
| `content_types` | `text[]` | N | subset of `DOCUMENT`, `PARCEL` |
| `max_package_weight_g`, `max_shipment_weight_g` | `integer` | N | `> 0` |
| `max_length_mm`, `max_width_mm`, `max_height_mm` | `integer` | N | `> 0` |
| `document_max_weight_g` | `integer` | Y | document services' own limit (REQ-QUOTE-004, REQ-CUST-002) |
| `volumetric_divisor_metric` | `integer` | N | cm³/kg, default 5000 |
| `volumetric_divisor_imperial` | `integer` | N | in³/lb, default 139 (product brief App. A) |
| `weight_increment_metric_g` | `integer` | N | `DEFAULT 500` (A-059) |
| `weight_increment_imperial_centi_lb` | `integer` | N | `DEFAULT 100` (1 lb; the engine converts with 1 lb = 453.59237 g exactly, DR-B06) |
| `booking_cutoff_local` | `time` | N | interpreted in the sender's IANA zone (DR-B25) |
| `pickup_supported`, `dropoff_supported`, `ddp_supported`, `paperless_supported`, `printer_free_dropoff` | `boolean` | N | |
| `label_formats` | `text[]` | N | subset of `document_format` |
| `pickup_days` | `smallint[]` | N | ISO weekdays 1–7 |
| `pickup_earliest_ready`, `pickup_latest_close` | `time` | N | defaults 08:00 / 18:00 (A-071) |
| `pickup_min_window_minutes` | `smallint` | N | `DEFAULT 120` |
| `liability_term_type` | `text` | N | `CHECK (… IN ('PERCENT','PER_KG','FIXED'))` |
| `liability_percent_bp` | `integer` | Y | |
| `liability_amount_minor` | `bigint` | Y | per kg or fixed, with `liability_currency char(3) Y` |
| `enabled` | `boolean` | N | `DEFAULT true` |

`CHECK` consistency of liability columns per type. AP-CARR-01 services of enabled carriers (loaded once per process, ≤ 200 rows): `ix_carrier_services__carrier ON (carrier_id) WHERE enabled`.

#### `carrier_accounts` · GLOBAL (config-backed) · SD: no

D-012, REQ-CARR-001/015, product brief §4.3 (environment per account). Platform-owned accounts only in M1; partner accounts (M3) add encrypted credentials and RLS in an expand migration.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD, `source` | | | | INT |
| `code` | `text` | N | `UNIQUE` (e.g. `MOCK_DEFAULT`, `DHL_PLATFORM_SANDBOX`) | INT |
| `carrier_id` | `uuid` | N | FK | INT |
| `owner_type` | `text` | N | `DEFAULT 'PLATFORM'`, `CHECK (owner_type IN ('PLATFORM','PARTNER'))` | INT |
| `owner_org_id` | `uuid` | Y | `ck_carrier_accounts__platform_only_m1 CHECK (owner_type = 'PLATFORM' AND owner_org_id IS NULL)` (seam; replaced in M3) | INT |
| `environment` | `text` | N | `ck_carrier_accounts__sandbox_only_m1 CHECK (environment = 'SANDBOX')`; the column domain is `SANDBOX`/`PRODUCTION` and the M1 check mirrors the CLAUDE.md §5 guardrail until a G4-approved migration relaxes it (OI-24) | INT |
| `secret_ref` | `text` | N | reference only, never a value: `CHECK (secret_ref ~ '^(env\|aws-sm):[A-Za-z0-9_/:.+=@-]{1,200}$')` (e.g. `env:CARRIER_DHL_SANDBOX`) | SEC (redacted in audit and logs) |
| `account_number_ref` | `text` | Y | same pattern | SEC |
| `enabled` | `boolean` | N | runtime status `NOT_CONFIGURED` is computed when the referenced secret is absent (REQ-CARR-015) | INT |

AP-CARR-02 enabled accounts per carrier (process cache).

Amendment (2026-11-12, SEC-P3-08 item 1), applying to the M3 seam: when partner accounts arrive, their credentials are stored as `credentials_ciphertext bytea` (AES-256-GCM under a per-tenant KMS data key, ADR-0011) with the sibling `credentials_ciphertext_key_id text NOT NULL`, and AAD = (`carrier_accounts`, `credentials_ciphertext`, `id`, `credentials_ciphertext_key_id`). They are added by the M3 expand migration. Platform accounts keep `secret_ref` (a reference, not a ciphertext). OAuth tokens cached in Redis are encrypted under `CARRIER_TOKEN_CACHE_KEY` (ADR-0018 register); they are not database columns.

#### `carrier_raw_payloads` · TENANT · SD: no · append-only

REQ-CARR-018, product brief App. A weakness ("raw responses stored inline"). Bytes in the raw-carrier bucket; rows are metadata.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `org_id` | `uuid` | N | FK | INT |
| `shipment_id` | `uuid` | Y | FK `shipments(id)` | INT |
| `pickup_id` | `uuid` | Y | FK `pickups(id)` | INT |
| `carrier_account_id` | `uuid` | N | FK | INT |
| `operation` | `text` | N | `CHECK (operation IN ('CREATE_SHIPMENT','CANCEL_SHIPMENT','SCHEDULE_PICKUP','CANCEL_PICKUP','TRACK','UPLOAD_CUSTOMS_DOCUMENTS','RATES_FAILED'))` | INT |
| `request_object_key`, `response_object_key` | `text` | Y | `CHECK (… ~ '^raw/[0-9a-f-]{36}/[0-9a-f-]{36}/[a-z_]+\.json$')` (UUIDs only) | INT |
| `request_sha256`, `response_sha256` | `bytea` | Y | | INT |
| `redaction_version` | `smallint` | N | redactor version applied before upload | INT |
| `http_status` | `smallint` | Y | | INT |
| `duration_ms` | `integer` | Y | | INT |
| `outcome` | `text` | N | `CHECK (outcome IN ('SUCCESS','REJECTED','TIMEOUT','ERROR'))` | INT |
| `canonical_error_code` | `text` | Y | DR-B30 | INT |
| `correlation_id` | `text` | N | | INT |
| `truncation_applied` | `boolean` | N | `DEFAULT false` (REQ-CUST-015 "marking the truncation in the raw record") | INT |

AP-CARR-03 payloads of a shipment (staff, M2): `ix_carrier_raw_payloads__org_shipment ON (org_id, shipment_id, created_at)`.

Amendment (2026-11-12, SEC-P3-13; ADR-0010 amendment). The JSON stored under `request_object_key`/`response_object_key` never contains document bytes. The redactor replaces every base64 or binary document field (labels, invoices, customs uploads) with `{"$blob": {"sha256": "<hex>", "size": <bytes>, "media_type": "<type>", "document_id": "<uuid>"?}}`. `document_id` is present when the bytes are kept as a `documents` row. Tracking and response payloads are redacted by allow-list: canonical codes, timestamps, carrier references and city/country are kept, and everything else becomes `"[REDACTED]"`. `redaction_version` identifies the redactor that ran. A storage scan in SEC-TC-52 asserts that no base64 blob over 1 kB remains.

### 3.9 Pricing module (GLOBAL configuration, versioned)

D-010, REQ-PRICE-003..021, DR-B07..B13. A configuration version is a published, immutable set of rules; quotes and booked shipments record the version they used (REQ-PRICE-020). Child rows are immutable once their version is published (trigger `trg_pricing_children__immutable_when_published` on each child table raises on UPDATE/DELETE when the parent `published_at IS NOT NULL`). Tax rules come from compliance packs (§3.7); FX from `fx_rates`.

| Table | Columns (besides STD) | Constraints and indexes |
|---|---|---|
| `pricing_config_versions` | `version_key text N` (`pricing-2026.11.0`), `effective_from timestamptz N`, `published_at timestamptz Y`, `content_sha256 bytea N`, `source text N`, `notes text Y` | `ux_pricing_config_versions__version_key`; AP-PRICE-01 active version at T `ix_pricing_config_versions__effective ON (effective_from DESC) WHERE published_at IS NOT NULL`; immutable when published (trigger) |
| `margin_rules` | `config_version_id uuid N FK`, `rule_key text N`, `priority integer N DEFAULT 0`, nullable dimensions `carrier_id`, `carrier_service_id`, `carrier_account_id uuid`, `content_type text`, `weight_min_g integer`, `weight_max_g integer`, `origin_country char(2)`, `destination_country char(2)`, `customer_segment text`, `valid_during tstzrange`; `margin_type text N CHECK (PERCENT, FIXED)`, `margin_bp integer Y`, `margin_fixed_minor bigint Y`, `margin_currency char(3) Y`, `apply_to_surcharges boolean N DEFAULT false`, `allow_below_cost boolean N DEFAULT false`, `is_default boolean N DEFAULT false` | `ux_margin_rules__version_key ON (config_version_id, rule_key)`; `ux_margin_rules__one_default ON (config_version_id) WHERE is_default`; `CHECK (NOT is_default OR (priority = -1000 AND carrier_id IS NULL AND carrier_service_id IS NULL AND … all dimensions NULL))` (DR-B08); `CHECK (margin_bp IS NULL OR margin_bp >= 0)`; `CHECK (weight_max_g IS NULL OR weight_min_g IS NULL OR weight_max_g > weight_min_g)`; whole version loaded into memory (AP-PRICE-02 `ix_margin_rules__version`) |
| `surcharge_rules` | `config_version_id uuid N FK`, `rule_key text N`, `kind text N`, `carrier_id uuid Y`, `percent_bp integer N CHECK (percent_bp >= 0)`, `valid_during tstzrange N` | `ck_surcharge_rules__kind_m1 CHECK (kind = 'FUEL')` (REMOTE_AREA/PEAK/RESIDENTIAL/OVERSIZE are M2 seams, REQ-PRICE-021); `ex_surcharge_rules__no_overlap EXCLUDE USING gist (config_version_id WITH =, kind WITH =, (COALESCE(carrier_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =, valid_during WITH &&)` (overlapping fuel ranges for the same carrier are impossible, REQ-PRICE-006/020; requires `btree_gist`) |
| `cover_terms` | `config_version_id uuid N FK`, `rule_key text N`, `carrier_service_id uuid Y`, `optional_percent_bp integer N`, `min_charge_minor bigint N`, `min_charge_currency char(3) Y` (NULL = sell currency, A-066), `max_insurable_minor bigint N`, `max_insurable_currency char(3) N` | `ux_cover_terms__version_key`; seed: 200 bp, 500 minor, 500000 USD minor (REQ-PRICE-009) |
| `discounts` | `config_version_id uuid N FK`, `rule_key text N`, `kind text N CHECK (EMAIL_DOMAIN, ORGANISATION, VOLUME_TIER)`, `email_domain text Y` (lower-case), `target_org_id uuid Y`, `min_shipments_30d integer Y`, `carrier_id uuid Y`, `content_type text Y`, `value_type text N CHECK (PERCENT, FIXED)`, `percent_bp integer Y`, `fixed_minor bigint Y`, `fixed_currency char(3) Y`, `stackable boolean N`, `valid_during tstzrange N` (start inclusive, end exclusive, REQ-PRICE-010) | `ux_discounts__version_key`; kind-specific `CHECK`s (`EMAIL_DOMAIN ⇒ email_domain NOT NULL`, `ORGANISATION ⇒ target_org_id NOT NULL`, `VOLUME_TIER ⇒ min_shipments_30d NOT NULL`); `target_org_id` is a reference to a customer, not ownership (global table, operator-managed, PER-free) |
| `coupons` | **not versioned** (runtime redemption counter): `code_normalized text N` (upper-case, trimmed), `value_type`, `percent_bp`, `fixed_minor`, `fixed_currency`, `stackable boolean N`, `valid_during tstzrange N`, `max_redemptions integer Y`, `redeemed_count integer N DEFAULT 0`, eligibility `carrier_id uuid Y`, `content_type text Y`, `origin_country char(2) Y`, `min_order_minor bigint Y`; SD | `ux_coupons__code ON (code_normalized) WHERE deleted_at IS NULL` (AP-PRICE-03); `CHECK (max_redemptions IS NULL OR redeemed_count <= max_redemptions)`; runtime grant `UPDATE (redeemed_count, updated_at, updated_by, version)` only; redemption at PAID: `UPDATE coupons SET redeemed_count = redeemed_count + 1, … WHERE id = $1 AND (max_redemptions IS NULL OR redeemed_count < max_redemptions) RETURNING id` — 0 rows ⇒ `COUPON_EXHAUSTED` (REQ-PRICE-011, EC-B24) |

#### `coupon_redemptions` · TENANT · SD: no · append-only

Columns: STD; `org_id uuid N FK`; `coupon_id uuid N FK`; `order_id uuid N FK orders`; `discount_minor bigint N`; `currency char(3) N`; `redeemed_at timestamptz N`. `ux_coupon_redemptions__coupon_order ON (coupon_id, order_id)`; AP-PRICE-04 per org `ix_coupon_redemptions__org ON (org_id, redeemed_at DESC)`.

Volume-tier discounts (REQ-PRICE-012, Could) count the org's shipments in BOOKED or later over 30 days with AP-SHP-03 (`(org_id, state, created_at)`), excluding CANCELLED/VOIDED/REFUNDED.


### 3.10 Quotes module (GUEST_CAPABLE)

ADR-0005 guest branch, REQ-QUOTE-001..019, REQ-RLS-013, DR-B14, DR-B15, D-009, D-021, EC-A44, EC-B04/B05/B29. All four tables carry `org_id uuid NULL` and `guest_token_hash bytea NULL` with `ck_<t>__owner CHECK (num_nonnulls(org_id, guest_token_hash) = 1)` so a row is either guest-owned or org-owned, never both or neither. Children denormalise `org_id` and `guest_token_hash` from the parent so every RLS predicate is a column comparison (no join in the policy); the claim updates all four in one transaction (§4.3). `quote_packages` is guest-capable as well (listed by ADR-0005).

#### `quotes` · GUEST_CAPABLE · SD: yes (saved quote deleted by `quote:delete`) · immutable after rating except claim/save/delete

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD, SD | | | | INT |
| `org_id` | `uuid` | Y | FK `organisations(id)` | INT |
| `guest_token_hash` | `bytea` | Y | SHA-256 of the ≥ 128-bit (256-bit issued) guest token; 32 bytes | SEC |
| `claimed_by_user_id` | `uuid` | Y | | INT |
| `claimed_at` | `timestamptz` | Y | | INT |
| `claimed_from_token_hash` | `bytea` | Y | the guest token hash retained after the claim (not used by any policy) so a later claim attempt with the same token can be answered 409 instead of 404 (OI-19) | SEC |
| `saved_at`, `saved_by` | `timestamptz`, `uuid` | Y | REQ-QUOTE-014 | INT |
| `on_behalf_of_org_id` | `uuid` | Y | `ck_quotes__on_behalf_null_m1 CHECK (on_behalf_of_org_id IS NULL)` (seam, DR-A06; dropped by an M2 expand migration) | INT |
| `api_mode` | `text` | N | `DEFAULT 'TEST'`, CHECK `api_mode` (seam REQ-API-020) | INT |
| `origin_country`, `destination_country` | `char(2)` | N | FK `countries(code)` | PUB |
| `origin_postcode`, `destination_postcode` | `text` | Y | per country `location_type` | PER |
| `origin_city`, `destination_city` | `text` | Y | | PER (city alone is low risk but typed by users) |
| `origin_region_code`, `destination_region_code` | `text` | Y | | INT |
| `residential` | `boolean` | N | | INT |
| `content_type` | `text` | N | CHECK `content_type` | INT |
| `direction` | `text` | N | CHECK `direction` (REQ-BOOK-027) | INT |
| `ship_date` | `date` | Y | origin-local date | INT |
| `entry_unit_system` | `text` | N | `METRIC`/`IMPERIAL` (display only; canonical values are g/mm) | INT |
| `package_count` | `smallint` | N | `CHECK (package_count BETWEEN 1 AND 20)` (DR-B34) | INT |
| `total_actual_weight_g` | `integer` | N | | INT |
| `sell_currency` | `char(3)` | N | origin country currency (REQ-PRICE-015) | INT |
| `pricing_config_version_id` | `uuid` | N | FK | INT |
| `engine_version` | `text` | N | | INT |
| `fx_snapshot` | `jsonb` | N | `[{base, quote, rate:"83.120000", as_of, source}]` used for all options (REQ-PRICE-015, DR-B13) | INT |
| `tax_pack_country`, `tax_pack_version` | `text`, `integer` | Y | resolved pack (REQ-COMP-002) | INT |
| `request_fingerprint` | `bytea` | N | SHA-256 of the normalised inputs (DR-B15 rate-cache key without account set; re-quote, REQ-QUOTE-017/018) | INT |
| `mock_scenario` | `text` | Y | non-production only (DR-B29) | INT |
| `rating_status` | `text` | N | `DEFAULT 'IN_PROGRESS'`, `CHECK (rating_status IN ('IN_PROGRESS','COMPLETE'))` | INT |
| `carrier_statuses` | `jsonb` | Y | final per-carrier `OK/NO_SERVICE/TIMEOUT/ERROR` + canonical codes and exclusion reasons (`WEIGHT_EXCEEDED`, `DIMENSION_EXCEEDED`, REQ-QUOTE-004) — snapshot | INT |
| `rating_completed_at` | `timestamptz` | Y | | INT |
| `requote_of_quote_id` | `uuid` | Y | FK `quotes(id)` (price difference, REQ-QUOTE-017) | INT |
| `expires_at` | `timestamptz` | N | `created_at + QUOTE_TTL_HOURS` (24 h); `CHECK (expires_at > created_at)` | INT |

| AP | Query | Index |
|---|---|---|
| AP-QUO-01 | Quote by id (owner, guest with token, SSE fallback GET) | PK (+ RLS predicate) |
| AP-QUO-02 | Saved quotes of the org, newest first, keyset `(saved_at DESC, id DESC)` (REQ-ACCT-005) | `ix_quotes__org_saved ON (org_id, saved_at DESC, id DESC) WHERE saved_at IS NOT NULL AND deleted_at IS NULL` |
| AP-QUO-03 | Retention scan of unclaimed expired guest quotes (M4/M5 job; recorded only) | `ix_quotes__guest_expires ON (expires_at) WHERE org_id IS NULL` |
| AP-QUO-04 | Tenant composite index required by REQ-RLS-001 (also "recent quotes of org") | `ix_quotes__org_created ON (org_id, created_at DESC, id DESC) WHERE org_id IS NOT NULL` |

Expiry is derived (`now() > expires_at`), never stored as a state (DR-B14). Quote and option rows are not updated after `rating_status = 'COMPLETE'` except the claim columns, `saved_*` and `deleted_*`; the runtime grant on `quotes` is column-scoped accordingly (§4.4).

#### `quote_packages` · GUEST_CAPABLE · SD: no · insert-only (+ claim columns)

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `org_id`, `guest_token_hash` | as parent | Y | owner CHECK | INT / SEC |
| `quote_id` | `uuid` | N | FK `quotes(id)` | INT |
| `seq` | `smallint` | N | `CHECK (seq BETWEEN 1 AND 20)` | INT |
| `package_type` | `text` | N | CHECK `package_type` (`PARCEL_BOX`, `ENVELOPE`; seam REQ-BOOK-028) | INT |
| `weight_g` | `integer` | N | `CHECK (weight_g BETWEEN 100 AND 1000000)` (DR-B34) | INT |
| `length_mm`, `width_mm`, `height_mm` | `integer` | N | `CHECK (… BETWEEN 10 AND 3000)` | INT |

`ux_quote_packages__quote_seq ON (quote_id, seq)` (AP-QUO-05); `ix_quote_packages__org_quote ON (org_id, quote_id) WHERE org_id IS NOT NULL`.

#### `quote_options` · GUEST_CAPABLE · SD: no · insert-only (+ claim columns)

REQ-QUOTE-007/009/012, REQ-PRICE-016, DR-B11, DR-B17.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `org_id`, `guest_token_hash` | as parent | Y | owner CHECK | INT / SEC |
| `quote_id` | `uuid` | N | FK | INT |
| `carrier_id`, `carrier_service_id`, `carrier_account_id` | `uuid` | N | FKs | INT |
| `canonical_service_code`, `tier` | `text` | N | | INT |
| `transit_min_days`, `transit_max_days` | `smallint` | Y | NULL ⇒ "estimated delivery unavailable" (REQ-DATA-009) | INT |
| `estimated_delivery_date` | `date` | Y | destination-local | INT |
| `collection_modes` | `text[]` | N | subset of `PICKUP`, `DROP_OFF` | INT |
| `billable_weight_g` | `integer` | N | | INT |
| `carrier_cost_minor` | `bigint` | N | `CHECK (carrier_cost_minor >= 0)` | INT |
| `carrier_cost_currency` | `char(3)` | N | | INT |
| `net_minor`, `tax_minor`, `gross_minor` | `bigint` | N | `CHECK (net_minor + tax_minor = gross_minor AND gross_minor >= 0)` (REQ-PRICE-016/019) | INT |
| `sell_currency` | `char(3)` | N | = parent (checked in service) | INT |
| `price_snapshot` | `jsonb` | N | ordered charge lines `{code, label_key, amount, currency, tax_amount, tax_code, source}`, totals, FX used, config + engine version, `unreviewed` flags | INT |
| `explanation` | `jsonb` | N | rules fired/rejected (REQ-PRICE-016) | INT |
| `snapshot_sha256` | `bytea` | N | SHA-256 over JCS of `price_snapshot` | INT |
| `carrier_quote_ref` | `text` | Y | carrier rate reference needed at booking, if any | INT |
| `cached` | `boolean` | N | `DEFAULT false` (REQ-CARR-010) | INT |

AP-QUO-06 options of a quote: `ix_quote_options__quote ON (quote_id, gross_minor, id)`; tenant index `ix_quote_options__org_quote ON (org_id, quote_id) WHERE org_id IS NOT NULL`.

#### `quote_shares` · GUEST_CAPABLE (anonymous reads only through `quote_share_resolve`, §4.5) · SD: no (revocation via `revoked_at`) · mutable

REQ-QUOTE-015, NFR-PRIV-004, EC-B29. The share row carries an allow-listed `public_snapshot` built at share time from the (immutable) quote, so the anonymous reader never touches `quotes`.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `org_id`, `guest_token_hash` | | Y | owner CHECK | INT / SEC |
| `quote_id` | `uuid` | N | FK | INT |
| `share_token_hash` | `bytea` | N | SHA-256 of the ≥ 128-bit share token; `UNIQUE` | SEC |
| `public_snapshot` | `jsonb` | N | origin/destination country + city, packages (g/mm), content type, options with prices and transit; **no postcode, name, address, email, reference** (schema test against an allow-list, NFR-PRIV-004) | INT |
| `expires_at` | `timestamptz` | N | = quote expiry | INT |
| `revoked_at`, `revoked_by` | | Y | | INT |

AP-QUO-07 anonymous read by token (inside `quote_share_resolve`): `ux_quote_shares__share_token_hash`; AP-QUO-08 shares of a quote: `ix_quote_shares__org_quote ON (org_id, quote_id) WHERE org_id IS NOT NULL`.

Amendment (2026-11-12, SEC-P3-10). `createQuoteShare` **always mints a new token**. In the same transaction it sets `revoked_at`/`revoked_by` on the quote's previous active share (the previous link then resolves to 404) and inserts the new row. It never returns an existing token, which the server could not do anyway because it holds only `share_token_hash`. Backstop: `ux_quote_shares__quote_active ON (quote_id) WHERE revoked_at IS NULL` (at most one active share per quote). A concurrent second create fails this constraint and is retried once after re-reading. The route is `x-idempotency: not-applicable`, so the token never reaches `idempotency_keys`.

#### Amendment (2026-11-12, SEC-P3-32): revocation audit, mint cap, uniform 404

1. **The implicit revocation is audited.** When `createQuoteShare` revokes the previous active share, it writes its own audit entry in the same transaction as the `CREATE quote_share` entry: action `UPDATE`, entity `quote_share`, `entity_id` = the previous share's ID, `old_value` `{"revoked_at": null, "revoked_by": null}`, `new_value` `{"revoked_at": "<ts>", "revoked_by": "<actor>"}`, `revoked_by` = the calling actor, `details` `{"reason": "SUPERSEDED", "superseded_by": "<new share id>"}`. `share_token_hash` is SECRET and never appears in either entry (REQ-AUDIT-008). Both entries commit or roll back with the share rows, so a revocation without its audit entry cannot exist. The contract's `x-audit` for `createQuoteShare` lists both entries (api-designer).
2. **Per-quote mint cap: 10 shares per quote per rolling hour, then 429 `RATE_LIMITED`.** Mechanism: a count in PostgreSQL inside the minting transaction, not a Redis route counter.

   ```sql
   -- AP-QUO-09 (new): shares minted for one quote in the last hour; the minting transaction runs it before the revocation UPDATE
   SELECT count(*) AS minted, min(created_at) AS oldest
     FROM public.quote_shares
    WHERE quote_id = $1 AND created_at > now() - interval '1 hour';
   -- minted >= QUOTE_SHARE_MINTS_PER_HOUR (default 10; REQ-QUOTE-015) → roll back, 429 RATE_LIMITED, Retry-After = ceil(oldest + 1 h − now)

   CREATE INDEX ix_quote_shares__quote_created ON public.quote_shares (quote_id, created_at DESC);
   ```

   - **Why the database and not Redis.** The count is exact, transactional with the mint and the revocation, survives a Redis flush, and needs no second store on the path. Revoked rows count too, because the cap bounds rows written, not active links.
   - **Concurrency.** Two concurrent mints for the same quote are serialised by `ux_quote_shares__quote_active`: the second inserter waits on the unique index, fails when the first commits, and its single retry re-runs the count. The cap therefore cannot be overshot by a race.
   - **RLS.** The count runs in the caller's tenant or guest scope; every share of a quote has the quote's owner, so the caller sees all of them.
   - **Cost.** The index adds one B-tree entry per mint on a low-volume table. The probe reads at most 10 index entries. Without the cap, the 600/min `authenticated` class would let one user write about 36,000 revoked rows an hour.
3. **Resolve: unknown, revoked, superseded and expired tokens look identical (D-055; settled by principal-architect, D-ARCH-032).** `quote_share_resolve(p_share_token_hash)` returns `(quote_id uuid, public_snapshot jsonb, expires_at timestamptz)` and selects `WHERE share_token_hash = $1 AND revoked_at IS NULL AND expires_at > pg_catalog.now()`, replacing the `revoked boolean` column of §4.5.
   - **Unknown, revoked (incl. superseded) and expired tokens** all return **no row**, so the API answers every miss with the same byte-identical 404 body, and every case runs the same single unique-index probe (no timing or shape difference between them).
   - **Only an active share** returns its full `public_snapshot` (options included). There is no `EXPIRED` row and no `- 'options'` projection: the "expired quote with inputs prefilled" view of EC-B29 v1.3 was dropped by product-manager's D-055 (REQUIREMENTS.md v1.4, EC-B29/EC-B53), and the shared page shows a generic "this shared quote is no longer available" notice with a link to start a new quote (D-UX-034).
   - **History.** An earlier revision of this amendment kept the v1.3 EC-B29 expired view (200 `EXPIRED`, snapshot minus options) as the principal-architect's reconciliation with SEC-TC-53; it was withdrawn the same day when D-055 aligned the requirement with the review's condition. SEC-TC-53 therefore stands as amended in the review (byte-identical 404s for every non-active token).

     Whichever rule wins must be applied in REQUIREMENTS.md, `openapi.yaml`, SEC-TC-53 and this section together.

### 3.11 Shipments and customs module (TENANT)

REQ-BOOK-001..030, REQ-CUST-001..015, REQ-ACCT-002..007, DR-B01/B02/B20/B23/B24, DR-A06.

#### `shipments` · TENANT · SD: no (draft deletion is the transition to CANCELLED, REQ-ACCT-004) · mutable (aggregate root, optimistic locking)

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `org_id` | `uuid` | N | FK | INT |
| `on_behalf_of_org_id` | `uuid` | Y | `ck_shipments__on_behalf_null_m1 CHECK (on_behalf_of_org_id IS NULL)` (seam, REQ-ORG-007) | INT |
| `api_mode` | `text` | N | `DEFAULT 'TEST'` (seam) | INT |
| `state` | `text` | N | `DEFAULT 'DRAFT'`, CHECK `shipment_state` | INT |
| `state_changed_at` | `timestamptz` | N | | INT |
| `quote_id` | `uuid` | Y | FK `quotes(id)` (NULL for a repeat draft awaiting a fresh quote, REQ-ACCT-006) | INT |
| `selected_quote_option_id` | `uuid` | Y | FK `quote_options(id)`; cleared on rate-relevant change (REQ-QUOTE-018) | INT |
| `completed_steps` | `smallint[]` | N | `DEFAULT '{}'`, values 1–7 (REQ-BOOK-002) | INT |
| `last_edited_at` | `timestamptz` | N | draft expiry after 30 d (REQ-ACCT-004) | INT |
| `direction`, `content_type` | `text` | N | CHECKs | INT |
| `origin_country`, `destination_country` | `char(2)` | N | must equal the quote's (`ADDRESS_COUNTRY_MISMATCH`, REQ-BOOK-006) | PUB |
| `residential_delivery` | `boolean` | N | | INT |
| `description_of_contents` | `text` | Y | 3–100 chars when step 2 complete | PER |
| `package_count`, `total_actual_weight_g` | `smallint`, `integer` | N | | INT |
| `collection_mode` | `text` | Y | `CHECK (collection_mode IN ('PICKUP','DROP_OFF'))` (REQ-BOOK-010) | INT |
| `service_point_snapshot` | `jsonb` | Y | chosen drop-off point (REQ-PICK-010) | INT |
| `additional_cover` | `boolean` | N | `DEFAULT false` | INT |
| `insured_value_minor` | `bigint` | Y | with `insured_value_currency char(3) Y` | INT |
| `customer_reference`, `order_reference`, `note` | `text` | Y | `CHECK (… ~ '^[A-Za-z0-9 ._/-]{1,30}$')` (REQ-BOOK-011) | PER |
| `delivery_options` | `text[]` | N | `DEFAULT '{}'` | INT |
| `address_suggestion_accepted` | `boolean` | N | `DEFAULT false` (REQ-BOOK-007) | INT |
| `carrier_id`, `carrier_service_id`, `carrier_account_id` | `uuid` | Y | FKs; set from the selected option | INT |
| `canonical_service_code` | `text` | Y | | INT |
| `client_reference` | `text` | N | `DEFAULT id::text` semantics set by app = shipment id (REQ-BOOK-021, ADR-0014) | INT |
| `carrier_shipment_ref` | `text` | Y | AWB / carrier id | INT |
| `tracking_number` | `text` | Y | master tracking number | INT |
| `price_snapshot_id` | `uuid` | Y | FK `shipment_price_snapshots(id)` (current) | INT |
| `sell_currency` | `char(3)` | Y | | INT |
| `net_minor`, `tax_minor`, `gross_minor` | `bigint` | Y | denormalised from the current snapshot for lists and order totals; same CHECK as quote options | INT |
| `pricing_config_version_id` | `uuid` | Y | FK | INT |
| `coupon_id` | `uuid` | Y | FK `coupons(id)` | INT |
| `estimated_delivery_date` | `date` | Y | | INT |
| `screening_status` | `text` | N | `DEFAULT 'NOT_SCREENED'`, CHECK `screening_status` (REQ-CUST-011) | INT |
| `paperless_upload_status` | `text` | Y | `CHECK (… IN ('PENDING','UPLOADED','FAILED'))` (REQ-CUST-014) | INT |
| `booking_error_codes` | `text[]` | Y | canonical codes of the last definitive rejection (REQ-BOOK-023) | INT |
| `needs_review` | `boolean` | N | `DEFAULT false` (REQ-BOOK-023/030) | INT |
| `needs_review_reason` | `text` | Y | code | INT |
| `tracking_stale` | `boolean` | N | `DEFAULT false` (REQ-TRACK-003) | INT |
| `first_scan_at` | `timestamptz` | Y | first PICKED_UP/DROPPED_OFF/later event; cancellation window (DR-B20) | INT |
| `booked_at`, `delivered_at` | `timestamptz` | Y | | INT |
| `cancellation_id` | `uuid` | Y | attempt-independent cancellation id (refund idempotency, REQ-PAY-013) | INT |
| `cancel_reason_code` | `text` | Y | `CHECK (… IN ('CHANGED_MIND','WRONG_ADDRESS','WRONG_SERVICE','OTHER'))` | INT |
| `cancel_reason_text` | `text` | Y | ≤ 200 | PER |
| `cancelled_at`, `cancelled_by` | | Y | | INT |

Uniqueness: `ux_shipments__carrier_tracking ON (carrier_id, tracking_number) WHERE tracking_number IS NOT NULL`; `ux_shipments__client_reference ON (client_reference)`.

| AP | Query | Index |
|---|---|---|
| AP-SHP-01 | Shipment by id (detail, wizard save `WHERE id AND version`) | PK |
| AP-SHP-02 | Org shipment list, default sort `created_at DESC`, keyset `(created_at, id)`, optional filters carrier/direction (low cardinality, applied as filter) and creation range (REQ-ACCT-002) | `ix_shipments__org_created ON (org_id, created_at DESC, id DESC)` |
| AP-SHP-03 | List filtered by status (and dashboard "needs action" counts, volume tiers) | `ix_shipments__org_state_created ON (org_id, state, created_at DESC, id DESC)` |
| AP-SHP-04 | List filtered by destination country | `ix_shipments__org_dest_created ON (org_id, destination_country, created_at DESC, id DESC)` |
| AP-SHP-05 | Search by tracking number within tenant | `ix_shipments__org_tracking ON (org_id, tracking_number) WHERE tracking_number IS NOT NULL` |
| AP-SHP-06 | Search by customer reference within tenant | `ix_shipments__org_customer_ref ON (org_id, customer_reference) WHERE customer_reference IS NOT NULL` |
| AP-SHP-07 | User's drafts with step and last edit (REQ-ACCT-004) | `ix_shipments__org_creator_drafts ON (org_id, created_by, last_edited_at DESC, id DESC) WHERE state = 'DRAFT'` |
| AP-SHP-08 | Draft expiry scan (inside `draft_expiry_candidates`, §4.5) | `ix_shipments__draft_last_edited ON (last_edited_at) WHERE state = 'DRAFT'` |
| AP-SHP-09 | Needs-review / EXCEPTION metric and void-retry scan (every 4 h for 24 h, REQ-BOOK-030; inside `void_retry_candidates`) | `ix_shipments__needs_review ON (state_changed_at) WHERE needs_review` |
| AP-SHP-10 | Search by receiver name (partial, case-insensitive) | via `shipment_parties` AP-SHP-12, joined on `shipment_id` |
| AP-SHP-11 | Search by order number | via `orders` AP-ORD-02 → `order_shipments` AP-ORD-04 |

Write amplification: 9 secondary indexes, but a shipment row is updated ≈ 10–15 times in its life (wizard saves, transitions); `last_edited_at` and `state` are in indexes, so those updates are not HOT. Accepted at ≈ 5 bookings/s; `fillfactor = 90` on `shipments` leaves room for HOT updates of non-indexed columns (references, notes, snapshot pointer).

#### `shipment_parties` · TENANT · SD: no · mutable (child of shipment, structured snapshot, never a reference, REQ-BOOK-005)

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `org_id` | `uuid` | N | FK | INT |
| `shipment_id` | `uuid` | N | FK `shipments(id)` | INT |
| `role` | `text` | N | `CHECK (role IN ('SENDER','RECEIVER'))` | INT |
| `name` | `text` | N | ≤ 100 (strictest carrier limit validated in service, REQ-BOOK-006) | PER |
| `company` | `text` | Y | | PER |
| `address_line1` | `text` | N | | PER |
| `address_line2`, `address_line3` | `text` | Y | | PER |
| `city` | `text` | N | | PER |
| `region_code` | `text` | Y | FK `subdivisions(code)` | INT |
| `postcode` | `text` | Y | | PER |
| `country_code` | `char(2)` | N | | PUB |
| `phone_e164` | `text` | N | | PER |
| `email` | `text` | N | | PER |
| `residential` | `boolean` | N | | INT |
| `time_zone` | `text` | N | IANA zone of the address (pickup computations, DR-B25; OI-14) | INT |
| `source_address_book_entry_id` | `uuid` | Y | informational, no FK cascade | INT |
| `name_search` | `text` | N | `GENERATED ALWAYS AS (lower(name \|\| ' ' \|\| coalesce(company,''))) STORED` | PER |

`ux_shipment_parties__shipment_role ON (shipment_id, role)`; AP-SHP-12 receiver name search: `ix_shipment_parties__org_receiver_name_trgm USING gin (org_id, name_search gin_trgm_ops) WHERE role = 'RECEIVER'`; tenant index `ix_shipment_parties__org_shipment ON (org_id, shipment_id)`.

#### `shipment_party_identifiers` · TENANT · SD: yes · mutable · field-level encrypted

REQ-BOOK-008 (tax/identity references required by the pack; masked after entry; never in logs, audit values, notifications or public tracking), product brief §4.12 (KYC data stored encrypted).

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `org_id`, `shipment_id`, `party_id` | `uuid` | N | FKs | INT |
| `reference_type` | `text` | N | pack code, e.g. `IN_PAN`, `IN_GSTIN`, `IN_IEC` | INT |
| `value_ciphertext` | `bytea` | N | AES-256-GCM (96-bit nonce ‖ ct ‖ 128-bit tag), envelope key per environment (KMS in AWS); AAD = (`shipment_party_identifiers`, `value_ciphertext`, `id`, `value_ciphertext_key_id`) | SPER |
| `value_last4` | `text` | N | masking display (`••••1234`) | SPER (displayed masked) |
| `value_ciphertext_key_id` | `text` | N | `<purpose>-v<n>` (amended 2026-11-12, SEC-P3-08 item 1: was `key_id`) | INT |
| `pack_country`, `pack_version` | `text`, `integer` | N | pack that required it (REQ-COMP-002) | INT |

`ux_shipment_party_identifiers__party_type ON (party_id, reference_type) WHERE deleted_at IS NULL`; tenant index `(org_id, shipment_id)`. Values are validated against the pack regex before encryption; decryption happens only in the carrier adapter call path and in the customs document job.

#### `shipment_packages` · TENANT · SD: yes · mutable

REQ-BOOK-028, DR-B05/B06. Columns: STD, SD (a removed package is soft-deleted; uniqueness partial); `org_id`, `shipment_id uuid N FK`; `seq smallint N CHECK 1..20`; `package_type text N` CHECK `package_type`; `weight_g`, `length_mm`, `width_mm`, `height_mm integer N` (same CHECKs as `quote_packages`); `tracking_number text Y` (piece-level); `carrier_package_ref text Y`. `ux_shipment_packages__shipment_seq ON (shipment_id, seq) WHERE deleted_at IS NULL`; tenant index `(org_id, shipment_id) WHERE deleted_at IS NULL`.

#### `shipment_state_transitions` · TENANT · SD: no · append-only (INSERT/SELECT only)

REQ-BOOK-019, REQ-ACCT-003 timeline. Written in the same transaction as the state change and its audit entry.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `org_id`, `shipment_id` | `uuid` | N | FKs | INT |
| `from_state` | `text` | Y | NULL for the creation row | INT |
| `to_state` | `text` | N | CHECK `shipment_state` | INT |
| `trigger` | `text` | N | CHECK `transition_trigger` | INT |
| `actor_type` | `text` | N | CHECK `actor_type` | INT |
| `actor_id` | `uuid` | N | | INT |
| `correlation_id` | `text` | N | | INT |
| `reason_code` | `text` | Y | | INT |
| `tracking_event_id`, `saga_step_id`, `payment_id` | `uuid` | Y | provenance | INT |
| `occurred_at` | `timestamptz` | N | `DEFAULT now()` | INT |

AP-SHP-13 timeline: `ix_shipment_state_transitions__org_shipment_time ON (org_id, shipment_id, occurred_at, id)`.

Database backstop of DR-B01: trigger `trg_shipments__legal_transition` (BEFORE UPDATE OF `state`) checks `(OLD.state, NEW.state)` against the static table `shipment_state_rules(from_state, to_state)` (GLOBAL, seeded from `packages/shared`, catalog test asserts equality with the TS transition map) and raises `ILLEGAL_STATE_TRANSITION` (SQLSTATE `P0001`, message prefix mapped to 409). The service layer remains the primary enforcement (REQ-BOOK-018).

#### `shipment_price_snapshots` · TENANT · SD: no · insert-only, immutable (DB-enforced)

REQ-PRICE-017, EC-B14, product brief §4.4 ("the booked shipment stores this snapshot; later rule changes never alter a booked price").

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `org_id`, `shipment_id` | `uuid` | N | FKs | INT |
| `kind` | `text` | N | `CHECK (kind IN ('OPTION_SELECTED','REPRICED_COVER','REPRICED_COUPON','BOOKED'))` | INT |
| `quote_option_id` | `uuid` | Y | FK | INT |
| `pricing_config_version_id` | `uuid` | N | FK | INT |
| `engine_version` | `text` | N | | INT |
| `fx_snapshot` | `jsonb` | N | | INT |
| `carrier_cost_minor`, `carrier_cost_currency` | `bigint`, `char(3)` | N | | INT |
| `net_minor`, `tax_minor`, `gross_minor`, `currency` | | N | sum CHECK as above | INT |
| `snapshot` | `jsonb` | N | full engine output | INT |
| `explanation` | `jsonb` | N | | INT |
| `snapshot_sha256` | `bytea` | N | SHA-256 over JCS of `snapshot` | INT |

`ux_shipment_price_snapshots__one_booked ON (shipment_id) WHERE kind = 'BOOKED'`; AP-SHP-14 `(org_id, shipment_id, created_at DESC)`. Trigger `trg_shipment_price_snapshots__immutable` (BEFORE UPDATE OR DELETE) raises `PRICE_SNAPSHOT_IMMUTABLE` for every role; the runtime role has INSERT/SELECT only. The repository maps the trigger error to a `DENIED` audited `UPDATE` (REQ-PRICE-017). Re-pricing inserts a new row and repoints `shipments.price_snapshot_id`; at booking the saga inserts the `BOOKED` row.

#### `customs_declarations` · TENANT · SD: no · mutable

REQ-CUST-001..008/012, DR-B23.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `org_id`, `shipment_id` | `uuid` | N | FK; `UNIQUE (shipment_id)` | INT |
| `required` | `boolean` | N | result of DR-B23 for the lane | INT |
| `reason_for_export_code` | `text` | Y | FK `export_reasons(code)` | INT |
| `incoterm_code` | `text` | N | `DEFAULT 'DAP'`, FK `incoterms(code)` | INT |
| `currency` | `char(3)` | Y | single currency of all lines | INT |
| `declared_value_minor` | `bigint` | Y | Σ quantity × unit value, computed (REQ-CUST-003) | INT |
| `total_net_weight_g` | `integer` | Y | must be ≤ total actual package weight (`CUSTOMS_WEIGHT_EXCEEDS_PACKAGE`, service-checked) | INT |
| `invoice_type` | `text` | Y | `CHECK (… IN ('COMMERCIAL','PRO_FORMA'))` (SALE ⇒ COMMERCIAL, REQ-CUST-012) | INT |
| `de_minimis_hint` | `text` | Y | `CHECK (… IN ('MAY_BE_EXEMPT','DUTIES_LIKELY','NONE'))` (REQ-CUST-008) | INT |
| `pack_country`, `pack_version` | | Y | | INT |

`UNIQUE (id, currency)` supports the composite FK below. AP-SHP-15 by shipment: `ux_customs_declarations__shipment`; tenant index `(org_id, shipment_id)`.

#### `customs_items` · TENANT · SD: yes (replacing lines in `PUT /shipments/{id}/customs` soft-deletes the old ones) · mutable

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `org_id`, `shipment_id`, `declaration_id` | `uuid` | N | FKs | INT |
| `seq` | `smallint` | N | `CHECK (seq BETWEEN 1 AND 50)` | INT |
| `description` | `text` | N | `CHECK (char_length(description) BETWEEN 3 AND 100)` (full text kept; adapter truncates, REQ-CUST-015) | PER |
| `quantity` | `integer` | N | `CHECK (quantity BETWEEN 1 AND 99999)` | INT |
| `unit_value_minor` | `bigint` | N | `CHECK (unit_value_minor > 0)` | INT |
| `currency` | `char(3)` | N | `fk_customs_items__declaration_currency FOREIGN KEY (declaration_id, currency) REFERENCES customs_declarations (id, currency) ON UPDATE CASCADE` — a line can only carry the declaration's currency (`CUSTOMS_CURRENCY_MIXED`, REQ-CUST-003, EC-B37) | INT |
| `unit_net_weight_g` | `integer` | N | `> 0` | INT |
| `commodity_code` | `text` | N | `CHECK (commodity_code ~ '^[0-9]{6}([0-9]{2}){0,2}$')` (REQ-CUST-007) | INT |
| `commodity_code_in_sample` | `boolean` | N | warning flag (REQ-CUST-007) | INT |
| `country_of_manufacture` | `char(2)` | N | FK `countries(code)` | PUB |

STD and SD columns as usual. `ux_customs_items__declaration_seq ON (declaration_id, seq) WHERE deleted_at IS NULL`; tenant index `(org_id, shipment_id) WHERE deleted_at IS NULL`. `ON UPDATE CASCADE` keeps soft-deleted lines consistent when the declaration currency changes.

#### `prohibited_acknowledgements` · TENANT · SD: no · append-only

REQ-CUST-009, DR-B24. Columns: STD; `org_id`, `shipment_id uuid N FK`; `prohibited_item_id uuid N FK`; `field_ref text N` (`contents` or `customs_items[<seq>].description`; never the user's wording, REQ-CUST-009 note); `pack_country text N`, `pack_version integer N`; `acknowledged_by uuid N`; `acknowledged_at timestamptz N`. `ux_prohibited_ack__shipment_item_field ON (shipment_id, prohibited_item_id, field_ref)`; tenant index.

#### `shipment_attestations` · TENANT · SD: no · append-only

REQ-CUST-002 (documents of no commercial value), REQ-CUST-010 (no dangerous goods; audited as `CREATE` on `dg_attestation`). Columns: STD; `org_id`, `shipment_id uuid N`; `kind text N CHECK (kind IN ('NO_DANGEROUS_GOODS','DOCUMENTS_NO_COMMERCIAL_VALUE'))`; `wording_version text N`; `locale text N`; `attested_by uuid N`; `attested_at timestamptz N`. `ux_shipment_attestations__shipment_kind_version ON (shipment_id, kind, wording_version)`; tenant index. Booking checks the presence of the current wording version (`DG_ATTESTATION_REQUIRED`, EC-B38).

### 3.12 Orders module (TENANT)

REQ-BOOK-013..017/020..026, DR-B03/B04/B22/B33, ADR-0013/0014.

#### `orders` · TENANT · SD: no (status) · mutable

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `org_id` | `uuid` | N | FK | INT |
| `on_behalf_of_org_id` | `uuid` | Y | `CHECK (on_behalf_of_org_id IS NULL)` (seam) | INT |
| `api_mode` | `text` | N | `DEFAULT 'TEST'` | INT |
| `status` | `text` | N | `DEFAULT 'OPEN'`, CHECK `order_status` (OI-13) | INT |
| `order_number` | `text` | Y | `CHECK (order_number ~ '^[A-Z]{2}-[0-9]{9}$')`; allocated at checkout (REQ-BOOK-026) | INT |
| `order_number_country` | `char(2)` | Y | origin country of the sequence | PUB |
| `sell_currency` | `char(3)` | Y | set by the first shipment; `ORDER_CURRENCY_MISMATCH` otherwise (REQ-BOOK-013) | INT |
| `shipment_count` | `smallint` | N | `DEFAULT 0 CHECK (shipment_count BETWEEN 0 AND 10)` (DR-B33) | INT |
| `total_net_minor`, `total_tax_minor`, `total_gross_minor` | `bigint` | N | `DEFAULT 0`; recomputed on each basket change | INT |
| `coupon_id` | `uuid` | Y | FK | INT |
| `checkout_started_at`, `completed_at` | `timestamptz` | Y | | INT |

`ux_orders__order_number ON (order_number) WHERE order_number IS NOT NULL`.

| AP | Query | Index |
|---|---|---|
| AP-ORD-01 | One open basket per (org, user) (REQ-BOOK-014) | `ux_orders__org_creator_open ON (org_id, created_by) WHERE status = 'OPEN'` |
| AP-ORD-02 | Lookup by order number (account search; public tracking uses the projection) | `ux_orders__order_number` |
| AP-ORD-03 | Org order list newest first, keyset `(created_at, id)` | `ix_orders__org_created ON (org_id, created_at DESC, id DESC)` |

#### `order_shipments` · TENANT · SD: no (removal via `removed_at`) · mutable

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `org_id`, `order_id`, `shipment_id` | `uuid` | N | FKs | INT |
| `position` | `smallint` | N | 1–10 | INT |
| `gross_minor` | `bigint` | Y | amount authorised for this shipment, frozen at checkout | INT |
| `captured_minor`, `refunded_minor` | `bigint` | N | `DEFAULT 0`; `CHECK (refunded_minor <= captured_minor AND (gross_minor IS NULL OR captured_minor <= gross_minor))` (per-shipment capture and refund, REQ-BOOK-024, EC-B15/B19) | INT |
| `removed_at`, `removed_by` | | Y | | INT |

`ux_order_shipments__shipment_live ON (shipment_id) WHERE removed_at IS NULL` (a shipment is in at most one live basket); AP-ORD-04 lines of an order `ix_order_shipments__org_order ON (org_id, order_id, position) WHERE removed_at IS NULL`.

#### `saga_executions`, `saga_steps` · TENANT (due work discovered through `saga_due_candidates`, §4.5) · SD: no · mutable

DDL in §6.3. `saga_executions`: `kind BOOKING|CANCELLATION`, one BOOKING saga per order (`ux_saga_executions__order_booking ON (order_id) WHERE kind = 'BOOKING'`), one CANCELLATION saga per `cancellation_id`; `status`, `current_step`, `deadline_at` (30 min, REQ-BOOK-023), `next_run_at`. AP-ORD-05 sweeper/deadline scan: `ix_saga_executions__active_deadline ON (deadline_at) WHERE status IN ('PENDING','RUNNING','COMPENSATING')`; AP-ORD-06 progress of an order (REQ-BOOK-025): `ix_saga_executions__org_order ON (org_id, order_id)`; AP-ORD-07 steps of a saga: `ux_saga_steps__saga_step_shipment ON (saga_id, step, shipment_id) NULLS NOT DISTINCT`; AP-ORD-08 retry scan: `ix_saga_steps__next_attempt ON (next_attempt_at) WHERE status = 'FAILED_RETRYABLE'`.


### 3.13 Payments module (TENANT, except webhook inbox)

REQ-PAY-001..019, DR-B27, DR-B21, DR-B33, D-011, EC-B11/B12/B15/B16/B19/B30/B31/B32.

#### `payments` · TENANT · SD: no · mutable

One row per gateway authorisation lifecycle (a Stripe PaymentIntent or Mock equivalent). An order has at most one non-final payment at a time; a retry after `FAILED` creates a new row, and the per-order attempt limit (5 per hour, REQ-PAY-010, A-080) counts these rows.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `org_id`, `order_id` | `uuid` | N | FKs | INT |
| `api_mode` | `text` | N | `DEFAULT 'TEST'` (seam) | INT |
| `gateway` | `text` | N | `CHECK (gateway IN ('MOCK','STRIPE'))` | INT |
| `gateway_payment_ref` | `text` | Y | PaymentIntent id; set after the create call | INT |
| `status` | `text` | N | `DEFAULT 'CREATED'`, CHECK `payment_status` | INT |
| `currency` | `char(3)` | N | = order sell currency | INT |
| `amount_authorised_minor` | `bigint` | N | server-computed Σ gross (REQ-PAY-006) | INT |
| `amount_captured_minor`, `amount_refunded_minor` | `bigint` | N | `DEFAULT 0`; `CHECK (amount_captured_minor <= amount_authorised_minor AND amount_refunded_minor <= amount_captured_minor)` | INT |
| `livemode` | `boolean` | N | `DEFAULT false`, `ck_payments__test_mode_only_m1 CHECK (livemode = false)` (REQ-PAY-004/016, CLAUDE.md §5; relaxed only by a G4-approved migration, OI-24) | INT |
| `saved_payment_method_id` | `uuid` | Y | FK | INT |
| `method_type` | `text` | N | `DEFAULT 'CARD'`, `CHECK (method_type = 'CARD')` in M1 (REQ-PAY-019; widened in M4) | INT |
| `card_brand` | `text` | Y | | INT |
| `card_last4` | `text` | Y | `CHECK (card_last4 ~ '^[0-9]{4}$')` | PER |
| `failure_code` | `text` | Y | canonical decline code (REQ-PAY-010) | INT |
| `authorised_at`, `captured_at`, `voided_at`, `failed_at` | `timestamptz` | Y | | INT |

| AP | Query | Index |
|---|---|---|
| AP-PAY-01 | One non-final payment per order | `ux_payments__order_active ON (order_id) WHERE status NOT IN ('FAILED','VOIDED','REFUNDED')` |
| AP-PAY-02 | Payment of an order / attempts in the last hour | `ix_payments__org_order_created ON (org_id, order_id, created_at DESC)` |
| AP-PAY-03 | Webhook / confirm resolution by gateway ref | `ux_payments__gateway_ref ON (gateway, gateway_payment_ref) WHERE gateway_payment_ref IS NOT NULL` |
| AP-PAY-04 | Sweeper: AUTHORISED older than 30 min without booked shipment (REQ-PAY-018), inside `payment_sweeper_candidates` (§4.5) | `ix_payments__authorised_at ON (authorised_at) WHERE status = 'AUTHORISED'` |
| AP-PAY-05 | Sweeper: CAPTURED whose shipment is not BOOKED+ after 10 min, inside `payment_sweeper_candidates` | `ix_payments__captured_at ON (captured_at) WHERE status IN ('CAPTURED','PARTIALLY_CAPTURED')` |
| AP-PAY-06 | Dashboard spend of the month by currency (REQ-ACCT-001) | `ix_payments__org_captured ON (org_id, captured_at) INCLUDE (currency, amount_captured_minor, amount_refunded_minor) WHERE captured_at IS NOT NULL` |

#### `payment_status_history` · TENANT · SD: no · append-only

Columns: STD; `org_id`, `payment_id uuid N`; `from_status text Y`; `to_status text N` CHECK `payment_status`; `source text N CHECK (source IN ('API','WEBHOOK','SAGA','SWEEPER'))`; `gateway_event_id text Y`; `correlation_id text N`; `occurred_at timestamptz N DEFAULT now()`. AP-PAY-07 `ix_payment_status_history__org_payment_time ON (org_id, payment_id, occurred_at, id)`. A trigger `trg_payments__legal_transition` (BEFORE UPDATE OF `status`) checks DR-B27 against `payment_status_rules` (GLOBAL, seeded from `packages/shared`) as a backstop.

#### `payment_attempts` · TENANT · SD: no · mutable (journal of gateway calls)

DR-B04 G3 (every gateway call carries an idempotency key). Columns: STD; `org_id`, `payment_id uuid N`; `operation text N CHECK (operation IN ('CREATE','CONFIRM','CAPTURE','VOID','REFUND','RETRIEVE'))`; `idempotency_key text N UNIQUE` (deterministic: `<payment_id>:<operation>:<shipment_id or '-'>:<n>`); `amount_minor bigint Y`; `currency char(3) Y`; `status text N CHECK (status IN ('PENDING','SUCCEEDED','FAILED','AMBIGUOUS'))`; `gateway_ref text Y` (capture/refund id); `decline_code text Y`; `raw_object_key text Y` (redacted copy in object storage, REQ-PAY-003); `requested_at`, `completed_at timestamptz`. AP-PAY-08 by payment `ix_payment_attempts__org_payment (org_id, payment_id, requested_at)`.

#### `refunds` · TENANT · SD: no · mutable

REQ-PAY-013, DR-B21, EC-B19/B32. Columns: STD; `org_id`, `payment_id`, `order_id`, `shipment_id uuid N`; `cancellation_id uuid N`; `amount_minor bigint N CHECK (> 0)`; `currency char(3) N`; `status text N CHECK (status IN ('PENDING','SUCCEEDED','FAILED'))`; `attempts smallint N DEFAULT 0 CHECK (attempts <= 6)`; `gateway_refund_ref text Y`; `last_error_code text Y`; `idempotency_key text N UNIQUE` (from shipment + cancellation id); `requested_at`, `completed_at timestamptz`. `ux_refunds__shipment_cancellation ON (shipment_id, cancellation_id)` (one refund per cancellation); AP-PAY-09 retry scan `ix_refunds__pending ON (requested_at) WHERE status = 'PENDING'`; tenant index `(org_id, payment_id)`.

#### `payment_gateway_customers` · USER_OWNED within the org (ADR-0005 amendment 4) · SD: no · mutable

Columns: STD; `org_id`, `user_id uuid N`; `gateway text N`; `gateway_customer_ref text N` (SEC: treated as a gateway token in audit). `ux_payment_gateway_customers__org_user_gateway ON (org_id, user_id, gateway)`; `ux_payment_gateway_customers__ref ON (gateway, gateway_customer_ref)`.

#### `saved_payment_methods` · USER_OWNED within the org (ADR-0005 amendment 4) · SD: yes · mutable

REQ-PAY-014, REQ-ACCT-011. Only token, brand, last four and expiry are stored.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD, SD | | | | INT |
| `org_id`, `user_id` | `uuid` | N | FKs | INT |
| `gateway` | `text` | N | | INT |
| `gateway_method_ref` | `text` | N | `pm_…` token | SEC |
| `brand` | `text` | N | | INT |
| `last4` | `text` | N | `^[0-9]{4}$` | PER |
| `exp_month` | `smallint` | N | 1–12 | PER |
| `exp_year` | `smallint` | N | ≥ 2025 | PER |
| `is_default` | `boolean` | N | `DEFAULT false` | INT |

`ux_saved_payment_methods__default ON (org_id, user_id) WHERE is_default AND deleted_at IS NULL`; `ux_saved_payment_methods__ref ON (gateway, gateway_method_ref) WHERE deleted_at IS NULL`; AP-PAY-10 list own methods `ix_saved_payment_methods__org_user ON (org_id, user_id, created_at) WHERE deleted_at IS NULL` (limit 10 per user checked in the insert transaction, `LIMIT_EXCEEDED`, A-073).

#### `gateway_webhook_events` · SYSTEM · SD: no · mutable (processing status)

REQ-PAY-011/012, EC-B11. Arrives without tenant context; the verified payload bytes are stored in object storage for replay (gateway events carry no card numbers; the row holds metadata only).

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `gateway` | `text` | N | | INT |
| `gateway_event_id` | `text` | N | `UNIQUE (gateway, gateway_event_id)` (store-before-process, at most once) | INT |
| `event_type` | `text` | N | unknown types stored and acknowledged | INT |
| `object_type`, `object_ref` | `text` | Y | e.g. `payment_intent`, `pi_…` | INT |
| `resolved_org_id`, `resolved_payment_id` | `uuid` | Y | from verified event metadata (`org_id`, `payment_id` set at PaymentIntent creation) | INT |
| `payload_object_key`, `payload_sha256` | `text`, `bytea` | N | | INT |
| `processing_status` | `text` | N | `CHECK (… IN ('RECEIVED','PROCESSED','IGNORED','FAILED'))` | INT |
| `attempts` | `smallint` | N | `DEFAULT 0` | INT |
| `received_at`, `processed_at` | `timestamptz` | | | INT |
| `last_error` | `text` | Y | | INT |

AP-PAY-11 processing queue / replay by event id: `ix_gateway_webhook_events__status_received ON (processing_status, received_at)`. Processing runs in a worker job that resolves the organisation from the verified event metadata or, failing that, through `payment_lookup_by_gateway_ref` (§4.5, backed by `gateway_refs`), sets `app.org_id` (tenant scope) and derives state from the retrieved gateway object (REQ-PAY-012); signature failures are not stored (400, audited as DENIED in a SYSTEM shard).

#### `gateway_refs` · SYSTEM (global index table, ADR-0005 amendment 1) · SD: no · insert-only

Maps a gateway object reference (PaymentIntent, refund or customer id) to its payment and organisation so webhook processing can establish tenant context (REQ-PAY-012, EC-B11). Columns: STD; `gateway text N`; `gateway_ref text N`; `payment_id uuid N`; `org_id uuid N` (informational). `ux_gateway_refs__gateway_ref ON (gateway, gateway_ref)` (AP-PAY-12). Written in the same transaction that stores the gateway reference on `payments`/`refunds`; read through `payment_lookup_by_gateway_ref` (§4.5) when the verified event's metadata does not carry `org_id`.

### 3.14 Documents module (TENANT)

#### `documents` · TENANT · SD: no (versions kept; labels VOIDED, never deleted) · mutable (status only)

REQ-DOC-001..015, DR-B26, REQ-CUST-012/013, REQ-RBAC-012. One row per stored version; the API's `docId` is this row's `id`.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `org_id`, `shipment_id` | `uuid` | N | FKs | INT |
| `pickup_id` | `uuid` | Y | FK (pickup confirmation, REQ-DOC-003) | INT |
| `type` | `text` | N | CHECK `document_type` | INT |
| `format` | `text` | N | CHECK `document_format` | INT |
| `document_key` | `text` | N | logical document: `<TYPE>:<FORMAT>` or `PICKUP_CONFIRMATION:<pickup_id>:<FORMAT>` | INT |
| `version` | `integer` | N | `CHECK (version >= 1)` | INT |
| `status` | `text` | N | `DEFAULT 'CURRENT'`, CHECK `document_status` | INT |
| `media_type` | `text` | N | `CHECK (media_type IN ('application/pdf','application/zpl'))` | INT |
| `size_bytes` | `integer` | N | `CHECK (size_bytes BETWEEN 1 AND 5242880)` (REQ-DOC-009 limit) | INT |
| `sha256` | `bytea` | N | of the exact stored bytes (REQ-DOC-005), 32 bytes | INT |
| `storage_bucket` | `text` | N | | INT |
| `storage_key` | `text` | N | `CHECK (storage_key ~ '^docs/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf\|zpl)$')` (`org/shipment/document` UUIDs only, REQ-DOC-006) | INT |
| `storage_version_id` | `text` | Y | S3 object version | INT |
| `origin` | `text` | N | `CHECK (origin IN ('GENERATED','CARRIER'))` | INT |
| `generator_version` | `text` | Y | | INT |
| `input_hash` | `bytea` | Y | deterministic job input hash (REQ-DOC-012) | INT |
| `superseded_at`, `voided_at` | `timestamptz` | Y | | INT |

| AP | Query | Index |
|---|---|---|
| AP-DOC-01 | Versions of a logical document; next version number | `ux_documents__shipment_key_version ON (shipment_id, document_key, version)` |
| AP-DOC-02 | One CURRENT version per logical document (DR-B26) | `ux_documents__shipment_key_current ON (shipment_id, document_key) WHERE status = 'CURRENT'` |
| AP-DOC-03 | Documents of a shipment (list, REQ-DOC-011) | `ix_documents__org_shipment ON (org_id, shipment_id, type, version DESC)` |
| AP-DOC-04 | Download by id → hash re-check → audit → pre-signed URL | PK |

Identical bytes create no version (DR-B26): the job compares `sha256` with the CURRENT row before inserting.

### 3.15 Pickups module (TENANT)

#### `pickups` · TENANT · SD: no (status) · mutable

REQ-PICK-001..014, DR-B25, A-071, EC-B17/B18/B25. Service-point lookups are **not** persisted: they are cached in Redis for 1 h keyed by `(carrier account, postcode, radius)`; the chosen point is a snapshot on `shipments.service_point_snapshot` (REQ-PICK-010). A table would hold third-party opening-hours data that goes stale and that no requirement queries later.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `org_id`, `shipment_id`, `carrier_account_id` | `uuid` | N | FKs | INT |
| `sender_party_id` | `uuid` | N | FK `shipment_parties(id)` (pickup address is the sender address in M1) | INT |
| `status` | `text` | N | `CHECK (status IN ('REQUESTED','SCHEDULED','FAILED','CANCELLED','CANCEL_FAILED','SUPERSEDED'))` | INT |
| `pickup_date` | `date` | N | sender-local date | INT |
| `time_zone` | `text` | N | IANA zone of the sender address | INT |
| `window_start`, `window_end` | `time` | N | `CHECK (window_end - window_start >= interval '120 minutes')` | INT |
| `instructions` | `text` | Y | ≤ 200, control characters and markup stripped (REQ-PICK-012) | PER |
| `carrier_pickup_ref` | `text` | Y | | INT |
| `replaces_pickup_id` | `uuid` | Y | FK `pickups(id)` (reschedule, REQ-PICK-009) | INT |
| `shared_pickup_group_id` | `uuid` | Y | REQ-PICK-014 (Could): shipments sharing one carrier pickup | INT |
| `failure_code` | `text` | Y | canonical (DR-B30) | INT |
| `scheduled_at`, `cancelled_at` | `timestamptz` | Y | | INT |

AP-PICK-01 one SCHEDULED pickup per shipment: `ux_pickups__shipment_scheduled ON (shipment_id) WHERE status = 'SCHEDULED'` (reschedule inserts the new row as `REQUESTED`, then in one transaction flips old → `SUPERSEDED` and new → `SCHEDULED`); AP-PICK-02 pickups of a shipment `ix_pickups__org_shipment ON (org_id, shipment_id, created_at DESC)`; AP-PICK-03 shared pickup grouping `ix_pickups__group ON (shared_pickup_group_id) WHERE shared_pickup_group_id IS NOT NULL`.

### 3.16 Tracking module

#### `tracking_events` · TENANT · SD: no · append-only

REQ-TRACK-001/002/005/007/013, DR-B18, EC-B22/B23.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `org_id`, `shipment_id` | `uuid` | N | FKs | INT |
| `carrier_id` | `uuid` | N | | INT |
| `tracking_number` | `text` | N | | INT |
| `package_id` | `uuid` | Y | FK `shipment_packages(id)` | INT |
| `dedupe_key` | `bytea` | N | carrier event id, else SHA-256(tracking number ‖ event code ‖ timestamp ‖ location) (REQ-TRACK-005) | INT |
| `canonical_status` | `text` | N | CHECK `tracking_status` | PUB |
| `unmapped` | `boolean` | N | `DEFAULT false` (REQ-TRACK-001) | INT |
| `carrier_event_code` | `text` | N | | INT |
| `carrier_description` | `text` | Y | may contain names ("signed by …"), so never public (DR-B31) | PER |
| `occurred_at` | `timestamptz` | N | event time | INT |
| `location_city` | `text` | Y | | PUB |
| `location_region` | `text` | Y | | PUB |
| `location_country` | `char(2)` | Y | | PUB |
| `location_postcode` | `text` | Y | | PER |
| `facility_name` | `text` | Y | | INT (not public) |
| `source` | `text` | N | `CHECK (source IN ('POLL','PUSH','MOCK'))` | INT |
| `raw_object_key` | `text` | Y | raw event payload in object storage (REQ-CARR-018) | INT |
| `applied_to_state` | `text` | Y | state applied by this event, NULL if stored but not applied (REQ-TRACK-002) | INT |
| `received_at` | `timestamptz` | N | `DEFAULT now()` | INT |

AP-TRK-01 dedupe on insert (`INSERT … ON CONFLICT DO NOTHING`): `ux_tracking_events__shipment_dedupe ON (shipment_id, dedupe_key)`; AP-TRK-02 timeline ordered by event time: `ix_tracking_events__org_shipment_time ON (org_id, shipment_id, occurred_at, id)`.

#### `tracking_poll_schedule` · SYSTEM (global index table, ADR-0005 amendment 1) · SD: no · mutable

REQ-TRACK-003/004/015, DR-B19, A-081.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `org_id` | `uuid` | N | | INT |
| `shipment_id` | `uuid` | N | `UNIQUE` | INT |
| `carrier_account_id` | `uuid` | N | | INT |
| `tracking_number` | `text` | N | | INT |
| `interval_class` | `text` | N | `CHECK (… IN ('PRE_COLLECTION','MOVING','OUT_FOR_DELIVERY','IDLE'))` | INT |
| `next_poll_at` | `timestamptz` | N | ± 10 % jitter applied when computed | INT |
| `last_polled_at`, `last_event_at` | `timestamptz` | Y | | INT |
| `consecutive_failures` | `integer` | N | `DEFAULT 0` | INT |
| `not_found_since` | `timestamptz` | Y | 48 h grace (EC-B23) | INT |
| `manual_refresh_at` | `timestamptz` | Y | ≤ once per 5 min (REQ-TRACK-015) | INT |
| `stopped_at` | `timestamptz` | Y | | INT |
| `stop_reason` | `text` | Y | `CHECK (… IN ('FINAL_STATE','STALE_60D','VOIDED'))` | INT |

AP-TRK-03 due polls grouped per carrier account (batches ≤ 30, REQ-TRACK-004): `ix_tracking_poll_schedule__account_due ON (carrier_account_id, next_poll_at) WHERE stopped_at IS NULL`; AP-TRK-04 per-org cleanup `ix_tracking_poll_schedule__org ON (org_id)`. The planner reads due rows directly (no RLS, no personal data), calls the carrier in batches across organisations, then fans out per-org jobs that write events in tenant scope (REQ-RLS-008).

#### `tracking_index` · SYSTEM (global index table, ADR-0005 amendment 1) · SD: no · mutable (maintained in the source transaction)

REQ-TRACK-006/008/009/012, DR-B31, EC-B08/B39, A-050. Public tracking lookups and carrier push matching arrive with no tenant context. The index resolves a lookup key to `(shipment_id, org_id)` without personal data; the service then opens a tenant-scoped transaction for that organisation (`app.actor_id` = ANONYMOUS actor for public lookups) and projects only the DR-B31 allow-list (canonical status, event timestamps, localised canonical descriptions, city and country, carrier and service names, estimated delivery date). A response-schema contract test rejects any other field (NFR-PRIV-004).

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `shipment_id` | `uuid` | N | `UNIQUE` | INT |
| `org_id` | `uuid` | N | informational; this table is on the non-RLS allow-list | INT |
| `carrier_code` | `text` | N | | INT |
| `tracking_number` | `text` | Y | master tracking number (set at booking) | INT |
| `order_number` | `text` | Y | set at checkout | INT |
| `customer_ref_postcode_hmac` | `bytea` | Y | HMAC-SHA256(normalised customer reference ‖ `\|` ‖ normalised receiver postcode, `TRACKING_INDEX_KEY`) (REQ-TRACK-009) | INT |
| `customer_ref_postcode_hmac_key_id` | `text` | Y | `<purpose>-v<n>`; `CHECK ((customer_ref_postcode_hmac IS NULL) = (customer_ref_postcode_hmac_key_id IS NULL))`. During a rotation, lookups compute the HMAC under each live key and query `= ANY($hashes)`; the writer always uses the current key, and a throttled backfill (§8.5) re-keys old rows before the retired key is dropped (amended 2026-11-12, SEC-P3-08 item 1) | INT |

AP-TRK-05 by tracking number (also carrier push matching): `ix_tracking_index__tracking_number ON (tracking_number) WHERE tracking_number IS NOT NULL`; AP-TRK-06 by order number (lists every shipment of the order): `ix_tracking_index__order_number ON (order_number) WHERE order_number IS NOT NULL`; AP-TRK-07 by reference + postcode (a result only when exactly one row matches, EC-B39): `ix_tracking_index__ref_postcode ON (customer_ref_postcode_hmac) WHERE customer_ref_postcode_hmac IS NOT NULL`. Writers: the booking saga (tracking number), checkout (order number), wizard step 1/4 saves (reference/postcode hash), all inside the transaction that changes the source row. The check-digit test on order numbers runs before any query (EC-A42), and unknown keys return the identical 404 `TRACKING_NOT_FOUND` (REQ-TRACK-012).

### 3.17 Notifications module

#### `notification_templates` · GLOBAL · SD: no · insert-only (versioned)

REQ-NOTIF-004/005/006/017, DR-B28, D-018. Columns: STD, `source`; `template_key text N` (e.g. `EMAIL_VERIFICATION`, `SECURITY_NOTICE`, `BOOKING_CONFIRMATION`, `TRACKING_DELIVERED`); `variant text Y` (security-notice variants); `version integer N`; `channel text N CHECK (channel = 'EMAIL')` (M1); `locale text N CHECK en/es/fr`; `subject text N`; `body_html text N`; `body_text text N`; `variables text[] N` (declared variables; CI parity check, REQ-NOTIF-017); `content_sha256 bytea N`. `ux_notification_templates__key_variant_version_locale ON (template_key, variant, version, locale, channel) NULLS NOT DISTINCT`; AP-NOT-01 latest version for (key, variant, locale) `ix_notification_templates__lookup ON (template_key, variant, locale, version DESC)`. Immutable trigger (a new version never changes logged messages, REQ-NOTIF-005).

#### `notification_preferences` · USER_OWNED · SD: no · mutable

REQ-ACCT-012, REQ-NOTIF-011. Columns: STD; `user_id uuid N UNIQUE FK`; `tracking_updates boolean N DEFAULT true`; `marketing boolean N DEFAULT false`. Each change also inserts a `consent_records` row (purposes `EMAIL_TRACKING_UPDATES`, `EMAIL_MARKETING`).

#### `notification_log` · USER_OWNED · SD: no · mutable (status)

REQ-NOTIF-012/013/014, NFR-PRIV-004 (minimal: no rendered body, no full address), OI-10.

| Column | Type | Null | Default / constraint | Class |
|---|---|---|---|---|
| STD | | | | INT |
| `org_id` | `uuid` | Y | booking org for shipment events; NULL for auth events | INT |
| `recipient_user_id` | `uuid` | Y | FK `users(id)`; NULL only for invitations to unknown addresses | INT |
| `recipient_kind` | `text` | N | `CHECK (recipient_kind IN ('USER','INVITEE'))` | INT |
| `recipient_address_masked` | `text` | N | `a***@domain` as at send time (masking rule of REQ-PLAT-012) | PER |
| `event_id` | `uuid` | N | outbox event id | INT |
| `template_key`, `template_variant` | `text` | N / Y | | INT |
| `template_version` | `integer` | N | | INT |
| `locale`, `channel` | `text` | N | | INT |
| `status` | `text` | N | CHECK `notification_status` | INT |
| `attempt_count` | `smallint` | N | `DEFAULT 0` | INT |
| `idempotency_key` | `text` | N | `<event_id>:<template_key>:<recipient>`; `UNIQUE` (REQ-NOTIF-014) | INT |
| `variables_redacted` | `jsonb` | N | identifiers only (order number, tracking number, carrier, canonical status, city); names, addresses, phones, references dropped | INT |
| `provider_message_id` | `text` | Y | | INT |
| `queued_at`, `sent_at`, `failed_at` | `timestamptz` | | | INT |
| `last_error_code` | `text` | Y | | INT |

AP-NOT-02 own log newest first: `ix_notification_log__recipient_created ON (recipient_user_id, created_at DESC, id DESC)`; tenant-rule index `ix_notification_log__org_created ON (org_id, created_at DESC) WHERE org_id IS NOT NULL` (REQ-RLS-001 catalog rule; also the M2 staff view per org); AP-NOT-03 per-shipment email rate limit (5/h, REQ-DOC-010) is enforced in Redis, not by a query.

### 3.18 Static rule tables (GLOBAL)

`shipment_state_rules(from_state, to_state)` and `payment_status_rules(from_status, to_status)`: STD + the pair, `UNIQUE (from, to)`, seeded from the `packages/shared` transition maps (DR-B01, DR-B27) and asserted equal by a catalog test; used only by the backstop triggers (§3.11, §3.13).


---

## 4. Row-level security

ADR-0005 (Accepted, including its threat-model amendments 1–5), REQ-RLS-001..013, DR-A14, DR-A15, NFR-TENANT-001. All SQL below is written as raw SQL inside Prisma migrations (§7.3); the per-table policy blocks are rendered from these templates by `tools/db/render-rls.ts`, never typed by hand.

### 4.1 Request context settings

At the top of every request or job transaction (`withTenantTx`, §7.7) the server executes exactly one statement. Transaction-local values (`is_local = true`, equivalent to `SET LOCAL`) cannot leak across pooled connections (REQ-RLS-003). The first four settings are ADR-0005's; the other four are additions that carry no authority. *(Amended 2026-11-12, ADR-0005 am. 10 items 12 and 16, PR #7 round 2 R2-n2 (iii) / PR7-SEC-06 / PR7-SEC-14, D-ARCH-064/066: **eight** settings — `lock_timeout` and `idle_in_transaction_session_timeout` are set per transaction because role defaults are rewritable by the role itself — and the statement reads the prior values of the four security keys in the same round trip as a session-leak detector.)*

```sql
WITH prev AS MATERIALIZED (                              -- ADR-0005 am. 10 item 16: prior values, read BEFORE set_config runs
  SELECT current_setting('app.org_id', true)           AS org_id,
         current_setting('app.actor_id', true)         AS actor_id,
         current_setting('app.actor_scope', true)      AS actor_scope,
         current_setting('app.guest_token_hash', true) AS guest_token_hash)
SELECT prev.*,
       set_config('app.org_id',                            $1, true),   -- active org uuid from the access token, or '' (guest/public)
       set_config('app.actor_id',                          $2, true),   -- user id | SYSTEM actor id | '' (anonymous)
       set_config('app.actor_scope',                       $3, true),   -- 'TENANT' | 'OPERATOR'
       set_config('app.guest_token_hash',                  $4, true),   -- 64 lowercase hex chars (SHA-256 of X-Quote-Token), or ''
       set_config('app.correlation_id',                    $5, true),   -- for triggers' error messages and pg_stat_activity
       set_config('statement_timeout',                     $6, true),   -- DB_TX_STATEMENT_TIMEOUT_MS, default '5000' (ms)
       set_config('lock_timeout',                          $7, true),   -- DB_TX_LOCK_TIMEOUT_MS, default '2000'
       set_config('idle_in_transaction_session_timeout',   $8, true)    -- DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS, default '15000'
  FROM prev;
-- Any prev.* value other than NULL or '' => DB_SESSION_CONTEXT_LEAK (throw before fn, security event, process not-ready).
-- is_local is the literal true in the template text; every $n is a validated string (never NULL/undefined/Prisma.raw).
```

**Role-level defaults** (`prisma/bootstrap/00-roles.sql`, plus `02-role-backstops.sql` from TASK-016): `platform_app` has `search_path`, `idle_in_transaction_session_timeout = '15s'`, `lock_timeout = '2s'` and — new — the backstop `statement_timeout = '30s'` for statements issued outside `withTenantTx` (readiness probe, system paths). They are convenience defaults, not a boundary: per-transaction values win, C13 asserts the rows and the readiness check reports drift (ADR-0005 am. 10 item 12). *Amended 2026-11-13 (PR11-SEC-11 h, PR #11 code review n2; D-ARCH-073):* the same backstop file also pins **`lc_messages = 'C'`** for `platform_app` (`ALTER ROLE platform_app SET lc_messages = 'C'`), because `mapDbError` tells an RLS `WITH CHECK` rejection (403 `AUTHZ_DENIED`) from a privilege error (500) by the English message prefix "new row violates row-level security policy"; on a server with another `lc_messages` every RLS rejection would silently degrade to 500. C13 therefore expects **five** `platform_app` rows and the readiness expected-set constant carries the fifth. If PR #11 has merged without it, the setting ships as a new bootstrap file `03-role-locale.sql` (TASK-021; applied bootstrap files are immutable). SPK-08 records whether the RDS master may run this `ALTER ROLE … SET` (`lc_messages` is `SUSET`).

| Setting | Set by | Rule |
|---|---|---|
| `app.org_id` | API: the access token's active organisation only; a path `{orgId}` that differs yields 404 before any query (ADR-0005 amendment 3). Worker: the job payload (REQ-RLS-008). | UUID or empty |
| `app.actor_id` | API from `sub`; worker from the payload; reserved IDs (§1.6) for system and anonymous actors | UUID or empty |
| `app.actor_scope` | `TENANT` by default; `OPERATOR` only for admin-app tokens (`app = admin`) of actors with an ACTIVE OPERATOR membership on routes declaring `tenancy: 'operator-cross-tenant'` (M1: the audit viewer only) (DR-A15, ADR-0005 amendments 2 and 5). There is no cross-tenant scope for workers: cross-tenant work is discovered through the §4.5 functions and the global index tables, then executed per organisation in tenant scope. | |
| `app.guest_token_hash` | Quote routes with `X-Quote-Token` (`tenancy: 'guest'`) | SHA-256 hex |

Amended 2026-11-12 (SEC-P3-12; ADR-0013 amendment): the worker no longer takes `app.org_id`/`app.actor_id` from the job payload. Payload v2 carries only `kind`, `id`, `correlation_id`, `trace_context`. The processor calls `platform.job_context(kind, id)` (§4.5) and opens `withTenantTx` with the `org_id`/`actor_id` it returns. No row → non-retryable `JOB_CONTEXT_NOT_FOUND` (DLQ). A payload that carries `org_id` or `actor_id` fails the Joi schema at dequeue → DLQ, security event `job_context_mismatch`.

### 4.2 Helper functions (schema `platform`, owner `platform_migrator`; `app_is_operator` owner `platform_definer`)

Amendment (2026-11-12, SEC-P3-25; §12 OI-02, ADR-0005 amendment 6). The plain `SQL` helpers (`app_org_id`, `app_actor_id`, `app_guest_token_hash`) are not `SECURITY DEFINER` and stay owned by `platform_migrator`. `app_is_operator()` **is** `SECURITY DEFINER` and reads `memberships` and `organisations`, which have FORCE RLS. It is therefore owned by **`platform_definer`** and reads through that role's definer-read policies on those two tables (§4.3). Owned by `platform_migrator`, which keeps no runtime policies, it would always see zero rows and return false. The schema `platform` is created by the bootstrap lane (§4.4), so the `CREATE SCHEMA` line below runs there and not in a Prisma migration. Add `ALTER FUNCTION platform.app_is_operator() OWNER TO platform_definer;` after its definition.

Unset, empty or malformed settings evaluate to `NULL`, so every comparison is false and the query returns zero rows instead of raising (fail closed without errors, REQ-RLS-004). ADR-0005 sketches `app_org_id()` as `NULLIF(…,'')::uuid`; the regex guard below keeps its semantics and additionally turns a malformed value into "no rows" rather than a cast error. The SQL helpers are `STABLE`, have no `FROM` clause and are inlined by the planner, so `org_id = platform.app_org_id()` is an index condition.

*Amended 2026-11-12 (SEC-P3-27): `app_is_operator()` moves to `SET search_path = pg_catalog, pg_temp` with `pg_catalog.`-qualified built-ins, like every `SECURITY DEFINER` function (§4.5 rule, C11). The schema `platform` is owned by `platform_schema_owner`, not `platform_migrator` (§4.4 amendment); the line below is shown for reference only and runs, in its amended form, in `prisma/bootstrap/01-schemas.sql`. The three plain SQL helpers keep no `SET` clause on purpose: a `SET` clause stops the planner from inlining them, which would cost the index condition described above. They are not definer functions, so they run with the caller's rights and path.*

*Amended 2026-11-13 (PR11-SEC-11 a; D-ARCH-073): the helper bodies qualify every built-in and operator — `pg_catalog.current_setting(…)`, `OPERATOR(pg_catalog.~*)`, `OPERATOR(pg_catalog.~)`, `pg_catalog.decode(…)`, `::pg_catalog.uuid`.* The plain SQL helpers are inlined into the caller's query, so their bodies resolve names through the **caller's** `search_path`; qualification removes that dependency and does not prevent inlining (only a `SET` clause, `SECURITY DEFINER` or a non-SQL language does). The unmerged helpers migration of PR #11 (`20261112020000_platform_rls_helpers`) adopts the qualified form before merge; after merge the same change would need a `CREATE OR REPLACE` migration. Rule 16 and the C-series scan still match `current_setting(` with the `pg_catalog.` prefix (word boundary), and the helpers stay exempt by `regprocedure`.

```sql
CREATE SCHEMA IF NOT EXISTS platform AUTHORIZATION platform_schema_owner;   -- amended 2026-11-12 (SEC-P3-27 item 6): was platform_migrator; bootstrap lane only

-- amended 2026-11-13 (PR11-SEC-11 a, D-ARCH-073): qualified built-ins and operators; semantics unchanged
CREATE FUNCTION platform.app_org_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN pg_catalog.current_setting('app.org_id', true) OPERATOR(pg_catalog.~*) '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN pg_catalog.current_setting('app.org_id', true)::pg_catalog.uuid END
$$;
CREATE FUNCTION platform.app_actor_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN pg_catalog.current_setting('app.actor_id', true) OPERATOR(pg_catalog.~*) '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN pg_catalog.current_setting('app.actor_id', true)::pg_catalog.uuid END
$$;
CREATE FUNCTION platform.app_guest_token_hash() RETURNS bytea LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN pg_catalog.current_setting('app.guest_token_hash', true) OPERATOR(pg_catalog.~) '^[0-9a-f]{64}$'
              THEN pg_catalog.decode(pg_catalog.current_setting('app.guest_token_hash', true), 'hex') END
$$;

-- ADR-0005 amendment 2: the operator branch also verifies the membership in the database.
-- amended 2026-11-13 (D-TASK016-01 decision 3, PR #11 security review §5 ruling 1, D-ARCH-071): the body calls
-- platform.app_actor_id() while running as platform_definer, and PUBLIC holds no EXECUTE on the helpers (01-schemas.sql
-- global default privileges), so the migration that creates this function first runs
--   GRANT EXECUTE ON FUNCTION platform.app_actor_id() TO platform_definer;
-- as the migrator (owner of the helper) and only then enters SET ROLE platform_definer (ADR-0005 am. 10 item 9).
-- Template: prisma/sql/function-templates/app-is-operator.sql; TASK-037 applies it after both tables exist
-- (a SQL body is validated at CREATE time). C11 then expects EXECUTE on app_actor_id for platform_app and platform_definer.
CREATE FUNCTION platform.app_is_operator() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$                -- amended 2026-11-12 (SEC-P3-27): was pg_catalog, public
  SELECT pg_catalog.current_setting('app.actor_scope', true) = 'OPERATOR'
     AND EXISTS (SELECT 1
                   FROM public.memberships m
                   JOIN public.organisations o ON o.id = m.org_id
                  WHERE o.type = 'OPERATOR'
                    AND m.user_id = platform.app_actor_id()
                    AND m.status = 'ACTIVE')
$$;
```

`platform.app_is_operator()` takes no column arguments, so in a policy it becomes a one-time filter evaluated once per query, not per row.

### 4.3 Policy templates per table class

Policies for the runtime are `TO platform_app` (ADR-0005). Cross-tenant access is the operator branch only, **read-only** in M0/M1 (ADR-0005 amendment 2); M2 on-behalf writes add write-capable operator policies through superseding migrations. Because `FORCE` makes the owner `platform_migrator` subject to RLS and no runtime policy targets it, the owner sees nothing by default; the narrow `TO platform_definer` policies at the end of this section exist only so the §4.5 definer functions (which execute as their owner `platform_definer`) can read the rows they are allowed to resolve (amended 2026-11-12, SEC-P3-25: was `TO platform_migrator`; §12 OI-02, ADR-0005 amendment 6).

**TENANT** (every TENANT table `<t>`):

```sql
ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.<t> FORCE ROW LEVEL SECURITY;

CREATE POLICY p_<t>__tenant ON public.<t>
  FOR ALL TO platform_app
  USING      (org_id = platform.app_org_id())
  WITH CHECK (org_id = platform.app_org_id());

CREATE POLICY p_<t>__operator ON public.<t>
  FOR SELECT TO platform_app
  USING (current_setting('app.actor_scope', true) = 'OPERATOR' AND platform.app_is_operator());
```

**GUEST_CAPABLE** (`quotes`, `quote_packages`, `quote_options`, `quote_shares`) = TENANT template plus:

```sql
CREATE POLICY p_<t>__guest ON public.<t>
  FOR ALL TO platform_app
  USING      (org_id IS NULL AND guest_token_hash = platform.app_guest_token_hash())
  WITH CHECK (org_id IS NULL AND guest_token_hash = platform.app_guest_token_hash());
```

*Amended 2026-11-12 (SPK-03 security review PR7-SEC-04; ADR-0005 am. 10 item 11; D-ARCH-062).* **No org → guest de-claim.** With both `app.org_id` and `app.guest_token_hash` set, `UPDATE … SET org_id = NULL, guest_token_hash = <hash>` on an organisation's row passes the tenant `USING` and the guest `WITH CHECK`, moving the row out of tenant scope into a guest token's reach. Every GUEST_CAPABLE table therefore carries a `BEFORE UPDATE` trigger (`platform.guest_capable_guard()`, rendered by the RLS renderer with the policies; TASK-016 template, TASK-051 ships it with a test) that raises `23514`-class `GUEST_DECLAIM_FORBIDDEN` when `OLD.org_id IS NOT NULL AND NEW.org_id IS DISTINCT FROM OLD.org_id` or when `NEW.guest_token_hash IS NOT NULL AND NEW.guest_token_hash IS DISTINCT FROM OLD.guest_token_hash` *(conditions widened 2026-11-12, PR7-SEC-12 (d), D-ARCH-065: the first draft blocked only org → NULL and NULL → hash; the invariant is "`org_id` transitions only NULL → value, once; a hash is set only at insert and may only be cleared", which also forbids org A → org B and hash H1 → H2)*. The trigger is owned by the migrator, is not `SECURITY DEFINER`, and declares `SET search_path = pg_catalog, pg_temp`. RLS already blocks every forbidden transition under any single context, so this is defence in depth against a future definer or operator write path; TASK-051 tests the four forbidden transitions **as the superuser** (RLS bypassed) so the trigger alone is proven, and the legitimate claim (NULL → org, hash → NULL) still succeeds. Catalog test C-series asserts the trigger on every GUEST_CAPABLE table.

Anonymous shared-quote reads do not use a policy branch: they go through `quote_share_resolve(share_token_hash)` (§4.5), which returns only the allow-listed `public_snapshot` (REQ-QUOTE-015, NFR-PRIV-004).

**Guest claim** (REQ-QUOTE-016, REQ-RLS-013, EC-A44, ADR-0005), executed with both `app.org_id` and `app.guest_token_hash` set. The guest branch makes the old row visible (`USING`), the tenant branch accepts the new row (`WITH CHECK`), and `org_id IS NULL` makes the claim once-only:

```sql
UPDATE public.quotes
   SET org_id = $org, claimed_by_user_id = $user, claimed_at = now(),
       claimed_from_token_hash = guest_token_hash, guest_token_hash = NULL,
       updated_at = now(), updated_by = $user, version = version + 1
 WHERE id = $quote AND org_id IS NULL;
-- same transaction, the children (ADR-0005 amendment 4):
UPDATE public.quote_packages SET org_id = $org, guest_token_hash = NULL, updated_at = now(), updated_by = $user, version = version + 1 WHERE quote_id = $quote AND org_id IS NULL;
UPDATE public.quote_options  SET org_id = $org, guest_token_hash = NULL, updated_at = now(), updated_by = $user, version = version + 1 WHERE quote_id = $quote AND org_id IS NULL;
UPDATE public.quote_shares   SET org_id = $org, guest_token_hash = NULL, updated_at = now(), updated_by = $user, version = version + 1 WHERE quote_id = $quote AND org_id IS NULL;
```

Zero rows on `quotes` ⇒ the service re-reads by id under its own org scope: visible ⇒ already claimed by this org, idempotent 200; not visible ⇒ `quote_claim_state(id, token_hash)` (§4.5) returns `CLAIMED_ELSEWHERE` ⇒ 409 `QUOTE_ALREADY_CLAIMED`, or `UNKNOWN` ⇒ 404. After the claim the guest token stops working (REQ-QUOTE-016).

**USER_OWNED** (`user_credentials`, `sessions`, `refresh_tokens`, `email_verification_tokens`, `password_reset_tokens`, `mfa_totp`, `mfa_recovery_codes`, `mfa_challenges`, `mfa_enrolment_codes` (added 2026-11-12, SEC-P3-14), `reauth_proofs`, `notification_preferences`, `terms_acceptances`):

```sql
ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.<t> FORCE ROW LEVEL SECURITY;
CREATE POLICY p_<t>__own ON public.<t>
  FOR ALL TO platform_app
  USING      (user_id = platform.app_actor_id())
  WITH CHECK (user_id = platform.app_actor_id());
CREATE POLICY p_<t>__operator ON public.<t>
  FOR SELECT TO platform_app
  USING (current_setting('app.actor_scope', true) = 'OPERATOR' AND platform.app_is_operator());
```

USER_OWNED **within the organisation** (ADR-0005 amendment 4: members cannot read each other's private data) for `saved_payment_methods` and `payment_gateway_customers`: `USING (org_id = platform.app_org_id() AND user_id = platform.app_actor_id())` with the same `WITH CHECK`. `notification_log` uses `recipient_user_id = platform.app_actor_id()`. `consent_records` adds an anonymous insert branch: `CREATE POLICY p_consent_records__anonymous_insert ON public.consent_records FOR INSERT TO platform_app WITH CHECK (user_id IS NULL AND subject_kind = 'ANONYMOUS');`.

**Special policies of DR-A14** *(amended 2026-11-13; PR #11 code review §4 decision 5, security review PR11-SEC-10 requirements 1–5; D-ARCH-072)* — **three named renderer templates, never hand-written policies.** The renderer refused these shapes because `EXISTS`, `id =` and `<>` lie outside the allow-list of ADR-0005 am. 10 item 7, and an exemption "by policy name" would have removed the three tables from C3 and from linter rule 9 for good, with later edits to an exempted predicate going unchecked. Mechanism:

- **Manifest.** The table-class entry gains the optional field `policySet` with the closed values `dr-a14-users`, `dr-a14-memberships`, `dr-a14-organisations`. The loader (`tools/db/table-classes.ts`) accepts each value only on the table of the same name and class (`users` USER_OWNED, `memberships` TENANT, `organisations` TENANT); any other combination is a manifest error.
- **Renderer.** `blocksFor` renders `enable-force` + the named set (which *replaces* `user-owned` for `users` and `tenant` for `organisations`, and *adds* `own_read` to `tenant` for `memberships`) + `operator` (+ `definer-read` where flagged). The three templates live in `prisma/sql/policy-templates/dr-a14-*.sql`; `validateTemplate` admits, **for these templates only**, the exact atoms `id = platform.app_actor_id()` (users), `id = platform.app_org_id()` (organisations) and the two exact `EXISTS` atoms below as opaque strings. Every forbidden token (`<>`, `!=`, `NOT`, `OR`, `coalesce`, `IS [NOT] DISTINCT FROM`) stays forbidden inside the `EXISTS`; every context reference inside it is `col = platform.app_*()`; `IN (…)` appears only on `m.status` and only as a **positive** list.
- **Positive status lists.** `p_users__org_member_read` reads `m.status IN ('INVITED','ACTIVE','SUSPENDED')` instead of `m.status <> 'REMOVED'`: the deny-list form made a user's row readable by fellow members for any *future* `membership_status` value by default (fail-open on enum growth); the positive list names today's non-removed statuses and is extended deliberately when the enum grows. `p_organisations__member_read` already used a positive list.
- **Checks.** Linter rule 9 compares every `CREATE POLICY` in `prisma/migrations/**` with the renderer's output for its table ("policy not rendered from the templates"); C3 derives the expected policy set from the manifests and the renderer and asserts a keyed atom in every `TO platform_app` predicate (§4.6). No exemption file exists.
- **Owners.** TASK-024 ships the templates, `policySet`, rule 9 and C3; TASK-037 applies the memberships and organisations sets (and `app_is_operator()`), TASK-049 the users set. Security-analyst sign-off on the rendered policies is a merge condition of both (PR11-SEC-10).

```sql
-- template dr-a14-users (users: own row; rows of members of the active org, i.e. member lists; operator read via the operator template)
CREATE POLICY p_users__own ON public.users FOR ALL TO platform_app
  USING (id = platform.app_actor_id()) WITH CHECK (id = platform.app_actor_id());
CREATE POLICY p_users__org_member_read ON public.users FOR SELECT TO platform_app
  USING (EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.user_id = users.id
                    AND m.org_id = platform.app_org_id()
                    AND m.status IN ('INVITED','ACTIVE','SUSPENDED')));   -- amended 2026-11-13: positive list (was <> 'REMOVED')
CREATE POLICY p_users__operator ON public.users FOR SELECT TO platform_app
  USING (current_setting('app.actor_scope', true) = 'OPERATOR' AND platform.app_is_operator());

-- template tenant + dr-a14-memberships (memberships: org rows + the actor's own memberships in any org)
CREATE POLICY p_memberships__tenant ON public.memberships FOR ALL TO platform_app
  USING (org_id = platform.app_org_id()) WITH CHECK (org_id = platform.app_org_id());
CREATE POLICY p_memberships__own_read ON public.memberships FOR SELECT TO platform_app
  USING (user_id = platform.app_actor_id());
CREATE POLICY p_memberships__operator ON public.memberships FOR SELECT TO platform_app
  USING (current_setting('app.actor_scope', true) = 'OPERATOR' AND platform.app_is_operator());

-- template dr-a14-organisations (organisations: the active org; orgs the actor belongs to — switcher, GET /me/organisations)
CREATE POLICY p_organisations__active ON public.organisations FOR ALL TO platform_app
  USING (id = platform.app_org_id()) WITH CHECK (id = platform.app_org_id());
CREATE POLICY p_organisations__member_read ON public.organisations FOR SELECT TO platform_app
  USING (EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.org_id = organisations.id
                    AND m.user_id = platform.app_actor_id()
                    AND m.status IN ('ACTIVE','SUSPENDED')));
CREATE POLICY p_organisations__operator ON public.organisations FOR SELECT TO platform_app
  USING (current_setting('app.actor_scope', true) = 'OPERATOR' AND platform.app_is_operator());
```

The `memberships` policies reference no other RLS table (no subquery), so policy evaluation cannot recurse (`42P17`); the `users` and `organisations` subqueries reference `public.memberships` only. *C3 asserts both invariants (2026-11-13, PR11-SEC-10 requirement 5).* Registration (REQ-AUTH-001) generates the user and personal-org IDs in the service, sets `app.actor_id = user id` and `app.org_id = org id`, then inserts user, credentials, organisation, membership, role link and terms acceptance in one transaction; each insert passes its own `WITH CHECK`. Creating a business organisation (REQ-ORG-009) and accepting an invitation (REQ-ORG-011, after `invitation_lookup`) set `app.org_id` to the target organisation the same way; the service is the only party that chooses it.

**Definer-read policies** (only on the tables the §4.5 functions read; SELECT only, plus DELETE with an expiry predicate on purge tables):

```sql
CREATE POLICY p_<t>__definer_read  ON public.<t> FOR SELECT TO platform_definer USING (true);
CREATE POLICY p_<t>__definer_purge ON public.<t> FOR DELETE TO platform_definer
  USING (expires_at < now() - interval '7 days');                    -- token tables only
GRANT SELECT ON public.<t> TO platform_definer;                        -- DELETE as well on the purge tables
```

Amended 2026-11-12 (SEC-P3-25; §12 OI-02, ADR-0005 amendment 6): the definer policies target the `NOLOGIN` role **`platform_definer`**, which owns the §4.5 functions and `app_is_operator`. They no longer target `platform_migrator`, which keeps no runtime policies. `platform_definer` owns no table and has no DDL rights, so a defect in a definer function runs with read access to the listed tables only, never as the schema owner. `platform_app` keeps no path around its own policies. Tables that carry definer-read policies after this amendment: `users`, `user_credentials`, `refresh_tokens`, `email_verification_tokens`, `password_reset_tokens`, `mfa_challenges`, `mfa_enrolment_codes`, `reauth_proofs` (the six purge tables carry both the read and the purge policy, because a `DELETE … WHERE` also applies the `SELECT` policy), `sessions`, `mfa_totp`, `memberships`, `organisations`, `invitations`, `quote_shares`, `quotes`, `payments`, `saga_executions`, `shipments`, `orders`, `pickups`, `documents`, `notification_log`. SYSTEM tables (`outbox_events`, `tracking_poll_schedule`, `gateway_refs`) have no RLS and need only the `SELECT` grant. Catalog test C3 asserts this list.

**RETURNING caveat.** `INSERT … RETURNING` requires the new row to satisfy a `SELECT` policy. The only writer that inserts rows it cannot read back is the anonymous consent banner, which uses `createMany` (no `RETURNING`, §7.6). Audit tables are SYSTEM class (ADR-0005) and unaffected.

### 4.4 Roles, ownership and grants

Bootstrap SQL (run once by the cluster administrator: locally the Compose `bootstrap` one-shot service running `tools/db/bootstrap.ts` over `prisma/bootstrap/*.sql`, a pipeline-run bootstrap job against RDS at M5; *amended 2026-11-12, batch 0.2 / SEC-P3-37 item 4: the former `infra/compose/postgres/initdb/00-roles.sql` path is withdrawn — `prisma/bootstrap/` is the one location, §8.1*). Passwords come from the secret manager / Compose secret files and are referenced as psql variables; the script never contains values (CLAUDE.md §5). *Amended 2026-11-12 (batch 0.2):* the database name is the psql variable `:"db_name"`, set by the runner to `current_database()` and never by the caller; the file is `prisma/bootstrap/00-roles.sql`, and `CREATE ROLE` is rendered idempotently (a `DO` block creates a missing role, then `ALTER ROLE` asserts every attribute) because `CREATE ROLE` has no `IF NOT EXISTS`.

```sql
SET search_path = pg_catalog, pg_temp;                            -- amended 2026-11-12 (SEC-P3-27 item 4): first statement of every bootstrap file
CREATE ROLE platform_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'migrator_password';
CREATE ROLE platform_app      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
                               CONNECTION LIMIT 200 PASSWORD :'app_password';
CREATE ROLE platform_erasure  NOLOGIN NOSUPERUSER NOBYPASSRLS;   -- unused until the M4/M5 erasure job
CREATE ROLE platform_schema_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;  -- added 2026-11-12 (SEC-P3-27 item 6); no members

-- amended 2026-11-12 (SEC-P3-27 item 6): the schema owner changes BEFORE any database-level statement, so that on RDS
-- the master still owns public through pg_database_owner when it transfers it
ALTER SCHEMA public OWNER TO platform_schema_owner;               -- was platform_migrator
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO platform_app;
GRANT USAGE, CREATE ON SCHEMA public TO platform_migrator;        -- tables, _prisma_migrations (extension objects: see 01-schemas.sql)
-- ALTER DATABASE platform OWNER TO platform_migrator;            -- WITHDRAWN 2026-11-12 (batch 0.2, SEC-P3-34 item 5, D-ARCH-045): the database
--                                                                -- stays owned by the bootstrap role; the migrator holds CONNECT only, so it can
--                                                                -- neither ALTER DATABASE … SET nor CREATE SCHEMA nor CREATE EXTENSION
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO platform_app, platform_migrator;   -- amended 2026-11-12 (batch 0.2): the migrator needs an explicit CONNECT now

ALTER ROLE platform_app SET search_path = pg_catalog, public;     -- runtime role, not a definer context; it has no TEMPORARY privilege, so pg_temp stays empty
ALTER ROLE platform_app SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE platform_app SET lock_timeout = '2s';
ALTER ROLE platform_migrator SET lock_timeout = '3s';
-- amended 2026-11-12 (batch 0.2, SEC-P3-34 item 1): privileged sessions of the bootstrap role in this database resolve names in pg_catalog only;
-- a role-in-database setting outranks any database-wide default
ALTER ROLE CURRENT_USER IN DATABASE :"db_name" SET search_path = pg_catalog, pg_temp;
-- The two ALTER DEFAULT PRIVILEGES … IN SCHEMA … REVOKE lines that used to end this file are WITHDRAWN (2026-11-12, batch 0.2, SEC-P3-37 item 1,
-- D-ARCH-046): a per-schema REVOKE cannot remove a global default, so both were no-ops. The effective statements are the global
-- FOR ROLE … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC lines at the end of 01-schemas.sql (below). No TABLES line is needed:
-- PostgreSQL grants PUBLIC nothing on tables by default.
```

`platform_migrator` owns every table, partition, function and both schemas; `platform_app` owns nothing (REQ-RLS-005). Neither has `BYPASSRLS`. Note that `lock_timeout` also bounds the audit stream advisory-lock wait (§5.4): a wait above 2 s fails the request closed (`AUDIT_WRITE_FAILED`), which is the intended behaviour.

#### Amendment (2026-11-12, SEC-P3-03, SEC-P3-25): audit ownership separation and the definer owner

The sentence "`platform_migrator` owns every table, partition, function and both schemas" is superseded. Ownership is now split across three roles, so that whoever holds the migrator login (the migrate job, CI, developers, agents) cannot disable audit triggers or rewrite audit rows.

| Role | Login | Owns | Member of / members |
|---|---|---|---|
| `platform_migrator` | LOGIN | ~~the database,~~ every **non-audit** table, sequence and function, and the plain SQL helpers of §4.2; `CONNECT` on the database and `USAGE, CREATE` on both schemas (*amended 2026-11-12, SEC-P3-27 item 6: no longer owns the schemas, see `platform_schema_owner`; amended 2026-11-12, batch 0.2 / SEC-P3-34 item 5, D-ARCH-045: no longer owns the database either — the bootstrap role keeps it, so the migrator cannot set database-wide defaults, create schemas or install extensions*) | holds `platform_definer` with `INHERIT FALSE, SET TRUE` (so it can assign function ownership; it inherits no policies). It is **not** a member of `platform_audit_owner` and owns no audit object |
| `platform_definer` | NOLOGIN, NOINHERIT | `app_is_operator()` and every §4.5 function; no table, no DDL right (*amended 2026-11-12, SEC-P3-27: holds `CREATE` on schema `platform`, which PostgreSQL requires of the new owner in `ALTER FUNCTION … OWNER TO`; no definer function runs dynamic DDL, and the migrator already holds `CREATE` there, so this adds no capability*) | none |
| `platform_audit_owner` | NOLOGIN, NOINHERIT | `audit_entries` and every partition, `audit_stream_heads`, `audit_checkpoint_heads`, `audit_chain_verifications`, `audit_partitions`, `audit_anchors`, `audit_pii_vault`, `data_subjects`; functions `platform.audit_forbid_mutation()`, `platform.audit_vault_guard()`, `platform.ensure_audit_partitions(integer)` | **no members**; only the cluster superuser can `SET ROLE` to it, and that happens only in the bootstrap lane (*amended 2026-11-12, SEC-P3-33 item 10: on RDS at M5 the master role keeps one ADMIN-only row, treated as break-glass; C13*) |
| `platform_schema_owner` (*added 2026-11-12, SEC-P3-27 item 6*) | NOLOGIN, NOINHERIT | schemas `public` and `platform`; nothing else | **no members**, same rule and same RDS exception as `platform_audit_owner` (C13) |
| `platform_app` | LOGIN | nothing | none |
| `platform_erasure` | NOLOGIN | nothing; `SELECT, DELETE` on `audit_pii_vault`, `UPDATE (erased_at, …)` on `data_subjects` (unchanged) | none |

Bootstrap lane SQL (cluster-admin credential, one-shot `bootstrap` step; files under `prisma/bootstrap/`, §8.3), appended to the role script above:

```sql
-- prisma/bootstrap/00-roles.sql (continued)
CREATE ROLE platform_definer     NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE platform_audit_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT platform_definer TO platform_migrator WITH INHERIT FALSE, SET TRUE;   -- PostgreSQL 16+ grant options
-- (no GRANT platform_audit_owner / platform_schema_owner TO anyone; catalog test C13 asserts the pg_auth_members rows:
--  none locally, exactly one ADMIN-only row for the RDS master at M5; amended 2026-11-12, SEC-P3-33 item 10)

-- prisma/bootstrap/01-schemas.sql (schema-scoped; carried by pg_dump, see §8.6)
SET search_path = pg_catalog, pg_temp;                                      -- amended 2026-11-12 (SEC-P3-27 item 4)
CREATE SCHEMA IF NOT EXISTS platform AUTHORIZATION platform_schema_owner;   -- moved here from §4.2; amended 2026-11-12 (SEC-P3-27 item 6): was platform_migrator
REVOKE ALL ON SCHEMA platform FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA platform TO platform_migrator;                -- added 2026-11-12 (SEC-P3-27 item 6): helpers and §4.5 functions
GRANT USAGE ON SCHEMA platform TO platform_app, platform_erasure;
GRANT USAGE, CREATE ON SCHEMA platform TO platform_definer;                 -- amended 2026-11-12 (SEC-P3-27): CREATE is required of the new owner by ALTER FUNCTION … OWNER TO
GRANT USAGE, CREATE ON SCHEMA public, platform TO platform_audit_owner;     -- ensure_audit_partitions creates partitions in public
GRANT USAGE ON SCHEMA public TO platform_definer, platform_erasure;

-- Trusted extensions (added 2026-11-12, batch 0.2 / SEC-P3-34 item 5, D-ARCH-045): installed by the bootstrap role, because the migrator
-- no longer owns the database and therefore cannot run CREATE EXTENSION. Extensions never appear in prisma/migrations/** (linter rule 14).
CREATE EXTENSION IF NOT EXISTS pg_trgm    WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS btree_gin  WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;

-- Default privileges (amended 2026-11-12, batch 0.2 / SEC-P3-37 item 1, D-ARCH-046). The former three "… IN SCHEMA … REVOKE … FROM PUBLIC"
-- lines were PostgreSQL no-ops: "Default privileges that are specified per-schema are added to whatever the global default privileges are
-- for the particular object type. This means you cannot revoke privileges per-schema if they are granted globally" (ALTER DEFAULT
-- PRIVILEGES, PostgreSQL 18 docs). The built-in default grants EXECUTE on functions to PUBLIC, so the revocation must be GLOBAL (no IN
-- SCHEMA) and per creating role. The TABLES line is dropped: PostgreSQL grants PUBLIC nothing on tables by default (§5.8 Privileges).
-- These rows live in pg_default_acl of this database and are carried by pg_dump, which is why they stay in this file (§8.6).
ALTER DEFAULT PRIVILEGES FOR ROLE platform_migrator    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE platform_definer     REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE platform_audit_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- prisma/bootstrap/10-audit.sql (every audit object; §5.1–§5.7)
-- @audit-ddl security-approved: <reviewer> <YYYY-MM-DD>
SET search_path = pg_catalog, pg_temp;    -- amended 2026-11-12 (SEC-P3-27 item 4): BEFORE SET ROLE; never the default "$user", public
SET ROLE platform_audit_owner;            -- objects are created owned by the audit owner; the DDL guard admits this role
--   CREATE TABLE … (§5.1, §5.7, audit_anchors §5.5), triggers (§5.2), ensure_audit_partitions (§5.3)
GRANT SELECT, INSERT ON public.audit_entries, public.audit_checkpoint_heads, public.audit_anchors,
                        public.audit_pii_vault, public.data_subjects TO platform_app;
GRANT SELECT, INSERT, UPDATE ON public.audit_stream_heads, public.audit_partitions,
                                public.audit_chain_verifications TO platform_app;
GRANT SELECT, DELETE ON public.audit_pii_vault TO platform_erasure;
GRANT SELECT, UPDATE (erased_at, updated_at, updated_by, version) ON public.data_subjects TO platform_erasure;
GRANT EXECUTE ON FUNCTION platform.ensure_audit_partitions(integer) TO platform_app;
SELECT platform.ensure_audit_partitions(3);
RESET ROLE;

-- prisma/bootstrap/90-audit-ddl-guard.sql (superuser; §5.2): event triggers platform_audit_ddl_guard_end / _drop
--   (also starts with SET search_path = pg_catalog, pg_temp; amended 2026-11-12, SEC-P3-27 item 4)
```

Consequences:
- `ALTER TABLE audit_entries DISABLE TRIGGER …`, `NO FORCE ROW LEVEL SECURITY`, `DETACH PARTITION`, `DROP TRIGGER`, `GRANT`, and `CREATE OR REPLACE` of the audit functions all fail for `platform_migrator` with "must be owner" (SEC-TC-43).
- PostgreSQL lets a **schema owner drop any table in its schema**. `platform_migrator` owns `public`, so `DROP TABLE public.audit_entries` and `DROP SCHEMA public CASCADE` would succeed on privileges alone. The identity-based `sql_drop` guard (§5.2) closes this path, and SEC-TC-43 includes both statements. *Amended 2026-11-12 (SEC-P3-27 item 6): the migrator no longer owns either schema, so both statements now fail by privilege ("must be owner"); the guard stays as the second layer.*
- Moving the audit tables into a dedicated schema owned by `platform_audit_owner` would close the path by privilege as well. It was considered and not adopted in this amendment, because it renames every audit relation (`public.audit_*`) across the Prisma mapping, the ADRs and the tests. It is recorded as an option for M5. *Amended 2026-11-12 (SEC-P3-27 item 6): the cheaper no-member schema owner below closes the path by privilege now, without renaming any relation; the dedicated schema stays an M5 option.*
- Holding `platform_definer` with `SET TRUE` lets the migrator read the definer-read tables. That adds no capability, because the migrator owns those tables and could change their RLS anyway. The separation protects against a defective definer function running as the schema owner, not against the migrator.
- Revoking the audit owner's `CREATE` on `public` (which the schema owner can do) only stops partition creation. That fails closed and is detected by readiness (fewer than 2 future partitions, §5.3). *Amended 2026-11-12 (SEC-P3-27 item 6): the schema owner is now `platform_schema_owner`, which nobody can log in as or `SET ROLE` to outside the bootstrap lane, so this is no longer reachable with the migrator credential.*

#### Amendment (2026-11-12, SEC-P3-27): fixed search path for every definer context, and a no-member schema owner

Source: security review §14.4 SEC-P3-27 (CWE-426/427, MEDIUM). Before this amendment, `ensure_audit_partitions` ran as `platform_audit_owner` with `search_path = pg_catalog, public`. Because the migrator owned `public`, it could plant a better-matching overload there, such as `public.pg_advisory_xact_lock(integer)` or `public.to_char(date, text)`. The daily job would then run the planted body as the audit owner, and the identity-based guard admits that role. This amendment closes the path in four layers.

1. **One search-path rule for every definer context (items 1, 5).** Every `SECURITY DEFINER` function declares exactly `SET search_path = pg_catalog, pg_temp`. That covers the §4.5 functions, `platform.app_is_operator`, `platform.job_context` and `platform.ensure_audit_partitions`. So do the non-definer audit functions `platform.audit_forbid_mutation`, `platform.audit_vault_guard` and `platform.audit_ddl_guard`, which run as the invoker; for the guard and the triggers, the invoker includes the bootstrap superuser.
   - PostgreSQL never searches `pg_temp` for functions or operators, and listing it last stops it from shadowing catalog relations or types. Functions and operators therefore resolve in `pg_catalog` only.
   - Every relation stays `public.`- or `platform.`-qualified.
   - The audit functions also qualify their built-ins (`pg_catalog.format`, `pg_catalog.current_setting`, …).
   - Catalog tests C11 and C14 assert the exact `proconfig` value (§4.6), and linter rule 13 is the text-level early warning (§8.3).
2. **The bootstrap lane runs with a fixed path (item 4).** Each `prisma/bootstrap/*.sql` file starts with `SET search_path = pg_catalog, pg_temp;` as its first statement, after the header comments and before any `SET ROLE`. As a second layer, the runner `tools/db/bootstrap.ts` connects with `options=-c search_path=pg_catalog,pg_temp` and checks `SHOW search_path` before applying the first file.
   - **Without it**, a later bootstrap file, run as the superuser after migrations have created objects in `public`, would resolve unqualified calls through the default `"$user", public`.
   - **Qualification.** Inside the files, every relation is schema-qualified, and every function body and `EXECUTE` string qualifies its calls. Expressions in DDL (column defaults such as `uuidv7()`, CHECK constraints, index expressions) are bound to function and operator OIDs when the statement runs, under the file's fixed path. They therefore resolve to `pg_catalog` and need no textual qualification.
3. **The DDL guard matches the protected schemas by OID (item 3)** and refuses `ALTER SCHEMA … RENAME`, `OWNER TO` and `DROP SCHEMA` on them. The method and the reasons are in §5.2.
4. **The schemas are owned by a role nobody can use (item 6, recommended by the review; adopted).**
   - **The change.** `public` and `platform` are owned by the new `NOLOGIN NOINHERIT` role **`platform_schema_owner`**, which has no members. `platform_migrator` receives `USAGE, CREATE` on both.
   - **What the migrator can no longer do.** `DROP TABLE public.audit_*`, `DROP SCHEMA … CASCADE`, `ALTER SCHEMA … RENAME` and `ALTER SCHEMA … OWNER TO` now fail by privilege, before the guard runs. The same holds for the path the review did not list: as owner of `platform`, the migrator could have run `DROP FUNCTION platform.audit_ddl_guard() CASCADE` or `DROP SCHEMA platform CASCADE`. A schema owner may drop any object in its schema, and `CASCADE` removes the event triggers that depend on the guard function. PostgreSQL does not promise that a `sql_drop` trigger fires for the command that drops it, so the design no longer relies on that.
   - **What it keeps.** The migrator can still create objects in `public`, which is why items 1 and 2 are needed as well.

   **Evaluation against Prisma 7 Migrate and the bootstrap ordering:**

   | Concern | Result |
   |---|---|
   | `prisma migrate deploy` | Needs `CREATE` on `public` (tables, indexes, `_prisma_migrations`) and ownership of the tables it alters. Both hold: the migrator owns every non-audit table. Migrate never alters or drops a schema in `deploy`. ~~A `CREATE SCHEMA IF NOT EXISTS "public"` line, which some Prisma versions emit, is a no-op: the database owner passes the `CREATE`-on-database check, and the guard sees `objid = 0` and skips it~~ *Amended 2026-11-12 (batch 0.2, D-ARCH-045):* the migrator is no longer the database owner, and PostgreSQL checks `CREATE` on the database **before** the `IF NOT EXISTS` short-circuit (`CreateSchemaCommand`, `schemacmds.c`), so a `CREATE SCHEMA IF NOT EXISTS "public"` line would now fail with `42501` even though `public` exists. TASK-003 verified on 7.10.1 / PostgreSQL 18 that `migrate deploy`, `migrate status` and `db execute` emit no `CREATE SCHEMA` and need neither database ownership nor `CREATE` on the database (`prisma/README.md`, SPK-08 record 3). Linter rule 14 (§8.3) rejects `CREATE SCHEMA`, `CREATE EXTENSION` and `ALTER DATABASE` in `prisma/migrations/**` as the text-level early warning; a `migrate dev`-generated `CREATE SCHEMA IF NOT EXISTS` line is removed from the migration before commit |
   | Trusted extensions (`pg_trgm`, `btree_gin`, `btree_gist`) | ~~Installed by the migrator as database owner.~~ *Amended 2026-11-12 (batch 0.2, D-ARCH-045):* installed by the bootstrap role in `01-schemas.sql` (`WITH SCHEMA public`); their objects are owned by the bootstrap role. `CREATE EXTENSION IF NOT EXISTS` for an already-installed extension is skipped before any privilege check (`CreateExtension`, `extension.c`), but a **new** extension fails by privilege for the migrator; so extensions are bootstrap-lane objects only (a new one is a new bootstrap file) and rule 14 rejects them in `prisma/migrations/**`. Index operator classes from these extensions (`gin_trgm_ops`, …) remain usable in migrations because the extension objects live in `public` |
   | `migrate dev` and `migrate reset` against the dev database | A reset drops and recreates the schema, so it now fails by privilege. It already failed before this change, because the guard blocks `DROP SCHEMA public`. A local reset is done by recreating the Compose database volume and rerunning the bootstrap lane. *Amended 2026-11-12 (batch 0.2):* `npm run db:reset` (`tools/db/reset.ts`) is the scripted form: as the bootstrap credential it drops and recreates the database, reruns the bootstrap lane and `migrate deploy`; it requires `--yes` and a loopback host, so it cannot be pointed at a shared environment |
   | Shadow database (§7.3) | It is a separate database, pre-created by the Compose bootstrap and owned by the migrator, because the migrator has `NOCREATEDB`. Its `public` schema is owned by `pg_database_owner`, which is the migrator, so Prisma's shadow reset still works there. Its init script was already a migrator-runnable rendering of the bootstrap lane: without roles, `SET ROLE`, `OWNER TO` and event triggers, because the migrator cannot run those. This change adds `AUTHORIZATION platform_schema_owner` to what the rendering strips. The shadow database is only a diff target, so ownership there carries no security meaning |
   | Bootstrap ordering | `00-roles.sql` creates `platform_schema_owner` and transfers `public` **before** ~~`ALTER DATABASE … OWNER TO platform_migrator`~~ any database-level statement, so that on RDS the master still owns `public` through `pg_database_owner`. `01-schemas.sql` creates `platform` with that owner. *Amended 2026-11-12 (batch 0.2, D-ARCH-045):* there is no database-owner transfer any more; the database-level statements are `REVOKE ALL … FROM PUBLIC`, `GRANT CONNECT` and the role-in-database `search_path` of SEC-P3-34 item 1 |
   | Restore rehearsal (§8.6) | The rehearsal still runs only `00-roles.sql` before `pg_restore`. That file now also creates `platform_schema_owner`. The dump carries the schema owners and ACLs, and `pg_restore` runs as the superuser |
   | RDS at M5 | Like `platform_audit_owner`, the RDS master needs `SET` on `platform_schema_owner` while the lane runs (`ALTER SCHEMA … OWNER TO` and `CREATE SCHEMA … AUTHORIZATION` require it in PostgreSQL 16+). It ends with the ADMIN-only row that C13 allows (SEC-P3-33 item 10). The exact statements on RDS, for example `SET createrole_self_grant = 'set'` during role creation followed by removal of the SET option, are verified in SPK-08 |

   **Decision.** Item 6 is adopted, because it breaks nothing in Prisma Migrate and it closes the schema-owner paths by privilege. It is recorded in §12 (A13). The dedicated `audit` schema stays the M5 option.

   **Amendment (2026-11-12, batch 0.2; SEC-P3-34 items 1–3 and 5; D-ARCH-045, D-ARCH-046; `docs/03-architecture/rulings/batch-0.2-rulings.md` items 1–2).** TASK-003 (PR #5) implemented the SEC-P3-34 *recommended* item 5 and the §4.4 text is aligned to it:
   - **The migrator does not own the database.** `pg_database.datdba` stays the bootstrap role (Compose superuser locally, RDS master at M5). `platform_migrator` holds `CONNECT` on the database and `USAGE, CREATE` on `public` and `platform`, nothing else at database level. Consequences, all verified by the TASK-003 bootstrap suite on PostgreSQL 18: `ALTER DATABASE … SET`, `CREATE SCHEMA`, `CREATE EXTENSION` and `ALTER SCHEMA public RENAME` each fail for the migrator with `42501`; `migrate deploy`, `migrate status` and `db execute` succeed. Any future extension is a new bootstrap file; the shadow-database init rendering (§7.3) carries the `CREATE EXTENSION IF NOT EXISTS` lines, because the migrator owns the shadow database and may create trusted extensions there.
   - **Items 1–3 of SEC-P3-34 are in place now, not at M5.** `00-roles.sql` ends with `ALTER ROLE CURRENT_USER IN DATABASE :"db_name" SET search_path = pg_catalog, pg_temp`; the bootstrap runner, the Testcontainers harness and `db:reset` connect with `options=-c search_path=pg_catalog,pg_temp`; the bootstrap suite asserts that `pg_db_role_setting` has exactly one row for this database (the bootstrap role's, `search_path=pg_catalog, pg_temp`) and no database-wide (`setrole = 0`) row. C13 (§4.6) carries the same assertion so that it is also re-checked after every migration and in the restore rehearsal. Item 4 (break-glass runbook) stays a G4-production item.
   - **Default privileges are global, per creating role, and live in `01-schemas.sql`** (text above). `pg_default_acl` therefore holds exactly three rows for this database, all with `defaclnamespace = 0` and `defaclobjtype = 'f'`: `platform_migrator=X/platform_migrator`, `platform_definer=X/platform_definer`, `platform_audit_owner=X/platform_audit_owner`. Every `EXECUTE` for `platform_app` (and `platform_erasure`) remains an explicit `GRANT`, which the grant matrix already requires. The scope is wider than the withdrawn per-schema wording — it also covers functions those roles create in `public` — and that is intended.

5. **Trust model unchanged.** The migrator stays trusted for tenant data: it owns the RLS helper functions and every non-audit table. The separation protects existing audit rows and the audit DDL path, nothing more.
   - **App-side defence in depth.** `platform_app`'s own search path is `pg_catalog, public`, so the advisory-lock calls in the application's audit SQL (§5.4, §5.5) are qualified too. A planted overload in `public` would otherwise run as `platform_app` on every audit write.

The grant-matrix rows below are unchanged except for the additions marked "2026-11-12".

Grant matrix (rendered from `prisma/sql/grants.manifest.json` into each migration that adds a table; catalog test C5 compares the live privileges with the manifest):

| Class / table group | `platform_app` privileges |
|---|---|
| TENANT and USER_OWNED mutable tables (soft-deletable or not) | `SELECT, INSERT, UPDATE` — never `DELETE` (REQ-RLS-010; expired one-time and refresh tokens are purged through `purge_expired_tokens`, §4.5) |
| Append-only tables: `shipment_state_transitions`, `shipment_price_snapshots`, `payment_status_history`, `tracking_events`, `terms_acceptances`, `consent_records`, `carrier_raw_payloads`, `prohibited_acknowledgements`, `shipment_attestations`, `coupon_redemptions`, `audit_checkpoint_heads`, `audit_anchors` (2026-11-12, SEC-P3-03; granted in the bootstrap lane) | `SELECT, INSERT` |
| `quotes` | `SELECT, INSERT`, `UPDATE (org_id, guest_token_hash, claimed_from_token_hash, claimed_by_user_id, claimed_at, saved_at, saved_by, rating_status, carrier_statuses, rating_completed_at, deleted_at, deleted_by, updated_at, updated_by, version)` |
| `quote_packages`, `quote_options` | `SELECT, INSERT`, `UPDATE (org_id, guest_token_hash, updated_at, updated_by, version)` |
| `quote_shares` | `SELECT, INSERT`, `UPDATE (org_id, guest_token_hash, revoked_at, revoked_by, updated_at, updated_by, version)` |
| GLOBAL reference, compliance, carriers, pricing, authz, templates, rule tables | `SELECT` |
| `feature_flags`, `feature_flag_overrides` | `SELECT, INSERT, UPDATE` |
| `number_sequences` | `SELECT`, `UPDATE (next_value, updated_at, updated_by, version)` |
| `coupons` | `SELECT`, `UPDATE (redeemed_count, updated_at, updated_by, version)` |
| SYSTEM hard-delete allow-list: `idempotency_keys`, `outbox_events`, `processed_events`, `login_attempt_counters` | `SELECT, INSERT, UPDATE, DELETE` (DELETE used only by housekeeping with the retention predicates of §10.5) |
| SYSTEM global index tables: `tracking_index`, `gateway_refs`, `tracking_poll_schedule` | `SELECT, INSERT, UPDATE` |
| Other SYSTEM: `audit_stream_heads`, `audit_partitions`, `audit_chain_verifications`, `gateway_webhook_events`, ~~`reference_dataset_versions`~~, `data_migration_runs` | `SELECT, INSERT, UPDATE` |
| `reference_dataset_versions` *(row split out 2026-11-13, PR13-SEC-04; D-ARCH-075)* | **`SELECT` only.** The seed CLI writes it as `platform_migrator` (owner); no runtime role writes it — the US-073 reconciler derives the last audited digest from `audit_entries` (§3.5). `prisma/sql/grants.manifest` carries one line; C5 asserts it; a `platform_app` `INSERT`/`UPDATE` probe → `42501`. A future runtime writer takes the §4.5 definer-function form, never a table grant or RLS on this SYSTEM table |
| `audit_entries` (parent only; never partitions) | `SELECT, INSERT` |
| `audit_pii_vault`, `data_subjects` | `SELECT, INSERT` (`platform_erasure`: `SELECT, DELETE` on the vault, `UPDATE (erased_at, updated_at, updated_by, version)` on subjects) |
| Functions | `EXECUTE` on `platform.app_org_id`, `app_actor_id`, `app_guest_token_hash`, `app_is_operator`, `ensure_audit_partitions` and exactly the §4.5 list (2026-11-12: including `job_context`, `sessions_for_user`, `mfa_enrolment_overdue_candidates`). *2026-11-13 (D-TASK016-01 decision 3, PR #11 security review §5 ruling 1, D-ARCH-071):* **`platform_definer` holds `EXECUTE` on `platform.app_actor_id()`** — the body of `app_is_operator()` calls it while running as the definer and `PUBLIC` holds no `EXECUTE` on the helpers; granted by the migrator in the `app_is_operator` migration **before** `SET ROLE platform_definer` (template `prisma/sql/function-templates/app-is-operator.sql`); C11's helper expectation for `app_actor_id` gains `platform_definer` when TASK-037 applies the template; no other helper is granted to the definer |
| `platform_definer` (2026-11-12, SEC-P3-25) | `SELECT` on the definer-read tables of §4.3 and `DELETE` on the six purge tables, each gated by its `TO platform_definer` policy; `EXECUTE` on `platform.app_actor_id()` (2026-11-13, above); nothing else |
| Never granted to anyone at runtime | `TRUNCATE`, `REFERENCES`, `TRIGGER`, `DELETE` outside the allow-list, any privilege on partitions, membership in `platform_audit_owner` (2026-11-12) |

Compared with the P3 brief's hard-delete allow-list (expired tokens, idempotency keys, MFA challenges, re-auth proofs, outbox events older than N days, PII vault via erasure job): token-table purges run through one definer function because those tables are USER_OWNED under ADR-0005; vault deletion is assigned to the dedicated `platform_erasure` role instead of `platform_app` (OI-15).

### 4.5 Allow-listed SECURITY DEFINER functions (ADR-0005 amendment 1)

Every path that must read rows before a tenant/actor context exists, or must discover work across tenants, uses one of these functions or a global index table (`tracking_index`, `gateway_refs`, `tracking_poll_schedule`, §3.13/§3.16). Each function is owned by `platform_definer` (amended 2026-11-12, SEC-P3-25: was `platform_migrator`; §12 OI-02, ADR-0005 amendment 6), is `SECURITY DEFINER` with `SET search_path = pg_catalog, pg_temp` (amended 2026-11-12, SEC-P3-27: was `pg_catalog, public`; every relation in the body is schema-qualified, `public.sessions` and so on, and built-ins resolve in `pg_catalog` only; C11 asserts the exact value), takes a hashed or opaque key, returns a fixed minimal column set (IDs, statuses, timestamps; never personal data beyond what the caller supplied), has `EXECUTE` revoked from `PUBLIC` and granted to `platform_app`, and has a dedicated integration test (ADR-0005). After the lookup the service sets `app.actor_id`/`app.org_id` in the same transaction and continues under the normal policies.

| Function | Returns | Reads (definer-read policy) | Used by |
|---|---|---|---|
| `auth_lookup_user_by_email(p_email text)` | `(user_id uuid, status text, email_verified boolean)` | `users` | login, registration duplicate check, password reset request (REQ-AUTH-001/005/011) |
| `auth_lookup_credential(p_user_id uuid)` | `(password_hash text, bcrypt_cost smallint)` | `user_credentials` | login password check before the actor is established (the hash never leaves the identity service) |
| `auth_lookup_refresh_token(p_token_hash bytea)` | `(token_id, family_id, session_id, user_id, status, expires_at)` | `refresh_tokens` | refresh, logout, reuse detection (REQ-AUTH-007/008) |
| `auth_lookup_one_time_token(p_purpose text, p_token_hash bytea)` | `(token_id, user_id, expires_at, consumed_at, superseded_at)`; `p_purpose ∈ ('EMAIL_VERIFICATION','PASSWORD_RESET','SET_PASSWORD','MFA_CHALLENGE')` dispatches to the matching table (`PASSWORD_RESET` → `password_reset_tokens.purpose = 'RESET'`, `SET_PASSWORD` → `purpose = 'SET_PASSWORD'`; amended 2026-11-12, SEC-P3-14) | `email_verification_tokens`, `password_reset_tokens`, `mfa_challenges` | verify email, reset password, set first password of seeded staff, MFA challenge (REQ-AUTH-004/012/017) |
| `invitation_lookup(p_token_hash bytea)` | `(invitation_id, org_id, email, role_id, status, expires_at)` | `invitations` | accept invitation (REQ-ORG-011) |
| `payment_lookup_by_gateway_ref(p_gateway text, p_ref text)` | `(payment_id uuid, org_id uuid)` | `gateway_refs` (no RLS) | gateway webhooks when event metadata lacks the org (REQ-PAY-012) |
| `quote_share_resolve(p_share_token_hash bytea)` | `(quote_id, public_snapshot jsonb, expires_at)`; no row for unknown, revoked, superseded **and expired** tokens (`revoked_at IS NULL AND expires_at > pg_catalog.now()`; D-055, D-ARCH-032; the interim `EXPIRED` row was withdrawn) (amended 2026-11-12, SEC-P3-32: was `(…, revoked boolean)`; §3.10 `quote_shares` amendment) | `quote_shares` | `POST /public/shared-quotes/resolve` (token in the body, never in the URL; REQ-QUOTE-015; amended 2026-11-12, SEC-P3-25: was `GET /public/shared-quotes/{shareToken}`) |
| `quote_claim_state(p_quote_id uuid, p_token_hash bytea)` | `text` (`CLAIMED_ELSEWHERE` \| `UNKNOWN`) | `quotes` (`claimed_from_token_hash`) | claim conflict answer (EC-A44). ADR-0005 sketches `quote_claim_state(id)`; the token-hash argument is a tightening so that a caller learns about claim state only for a quote whose guest token it holds (OI-19) |
| `payment_sweeper_candidates(p_authorised_before timestamptz, p_captured_before timestamptz, p_limit int)` | `(payment_id, org_id, status)` | `payments` | REQ-PAY-018 sweeper |
| `saga_due_candidates(p_now timestamptz, p_limit int)` | `(saga_id, org_id)` | `saga_executions` | deadline enforcement and retry pickup (REQ-BOOK-023) |
| `draft_expiry_candidates(p_idle_before timestamptz, p_limit int)` | `(shipment_id, org_id)` | `shipments` | 30-day draft expiry (REQ-ACCT-004) |
| `void_retry_candidates(p_now timestamptz, p_limit int)` | `(shipment_id, org_id)` | `shipments` | void retry every 4 h for 24 h (REQ-BOOK-030) |
| `org_ids_page(p_after uuid, p_limit int)` | `setof uuid` | `organisations` | resumable backfills that iterate organisations (§8.5) |
| `purge_expired_tokens(p_before timestamptz, p_limit int)` | `integer` (rows deleted) | `email_verification_tokens`, `password_reset_tokens`, `refresh_tokens`, `mfa_challenges`, `reauth_proofs`, `mfa_enrolment_codes` (2026-11-12, SEC-P3-14) (definer-purge policy) | housekeeping (§10.5) |
| `sessions_for_user(p_user_id uuid)` (listed 2026-11-12; ratified in §12 OI-25) | `setof uuid` (session IDs with `status = 'ACTIVE'`) | `sessions` | synchronous Redis revocation of another user's sessions (membership removal, user status change) |
| `job_context(p_kind text, p_id uuid)` (**new 2026-11-12, SEC-P3-12**) | `(org_id uuid, actor_type text, actor_id uuid)`; one row or none | `outbox_events`, `saga_executions`, `shipments`, `orders`, `pickups`, `documents`, `payments`, `tracking_poll_schedule` (joined to `shipments`), `notification_log`, `quotes` | every worker processor, before `withTenantTx` (ADR-0013 amendment, payload v2) |
| `mfa_enrolment_overdue_candidates(p_now timestamptz, p_limit int)` (**new 2026-11-12, SEC-P3-14**) | `setof uuid` (user IDs) | `organisations`, `memberships`, `users`, `mfa_totp` | `housekeeping` 24 h staff enrolment deadline (AP-ID-19) |

Example (the others follow the same shape):

```sql
CREATE FUNCTION platform.auth_lookup_user_by_email(p_email text)
RETURNS TABLE (user_id uuid, status text, email_verified boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$                 -- amended 2026-11-12 (SEC-P3-27): was pg_catalog, public
  SELECT u.id, u.status, u.email_verified_at IS NOT NULL
    FROM public.users u
   WHERE u.email = p_email AND u.deleted_at IS NULL
$$;
REVOKE ALL ON FUNCTION platform.auth_lookup_user_by_email(text) FROM PUBLIC;          -- redundant with the global default privileges (§4.4, ADR-0005 am. 9) but explicit
GRANT EXECUTE ON FUNCTION platform.auth_lookup_user_by_email(text) TO platform_app;
ALTER FUNCTION platform.auth_lookup_user_by_email(text) OWNER TO platform_definer;   -- amended 2026-11-12 (SEC-P3-25): was platform_migrator
-- Order matters (reordered 2026-11-12, SPK-03 F-10, ADR-0005 am. 10 item 9): grants come BEFORE the owner change. platform_migrator
-- holds platform_definer WITH INHERIT FALSE, and PostgreSQL 16+ ownership checks use inherited privileges, so after
-- OWNER TO the migrator can no longer GRANT or REVOKE on the function. Preferred form (PR7-SEC-09): wrap the whole block in
-- SET ROLE platform_definer; … RESET ROLE; so that no SECURITY DEFINER function is ever owned by the migrator, not even
-- between two statements; linter rule 15 (TASK-016) enforces one of the two forms.
```

Candidate functions page by their partial indexes (AP-PAY-04/05, AP-ORD-05, AP-SHP-08/09) and return at most `p_limit` (≤ 1,000) rows; the worker groups them by `org_id` and processes each organisation in its own tenant-scoped transaction (REQ-RLS-008). Adding a function requires a reviewed migration, a test and an entry in this table (catalog test C11 compares the live list with it).

#### Amendment (2026-11-12, SEC-P3-12): `platform.job_context`

The worker resolves the tenant context of every job from PostgreSQL, never from Redis (ADR-0013 amendment, payload v2 `{v: 2, kind, id, correlation_id, trace_context}`). The returned actor is the **initiating actor** recorded on the authoritative row: the processor sets it as `app.actor_id`, and the processor's own audit entries keep `actor_type = 'SYSTEM_JOB'` with the initiator in `details`. Mapping:

| `p_kind` | Source of `org_id` | Actor returned |
|---|---|---|
| `outbox_event` | `outbox_events.org_id` (SYSTEM table, authoritative; NULL for organisation-less events such as auth e-mails) | `outbox_events.actor_id`; type `SYSTEM_JOB` / `ANONYMOUS` / `USER` for the reserved IDs (§1.6) and others |
| `saga` | `saga_executions.org_id` | `saga_executions.created_by` (the checkout actor) |
| `notification` | `notification_log.org_id` (NULL for auth e-mails) | `USER`, `recipient_user_id` (the USER_OWNED policy of the log row needs it); `SYSTEM_JOB`/SYSTEM actor for invitees without an account |
| `shipment`, `order`, `pickup`, `document`, `payment`, `quote` | the row's `org_id` | `SYSTEM_JOB`, SYSTEM actor |
| `tracking_poll` | `shipments.org_id` joined through `tracking_poll_schedule.shipment_id` (the schedule's own `org_id` is informational only) | `SYSTEM_JOB`, SYSTEM actor |

A guest quote (`quotes.org_id IS NULL`) returns `org_id = NULL`. Every processor whose queue requires a tenant treats a NULL `org_id` as non-retryable `MISSING_TENANT_CONTEXT` (ADR-0013 §2), and M1 has no worker job that writes guest-quote rows. The function never returns `guest_token_hash`, because a UUIDv7 ID is not a secret (P1) and returning the hash would turn any quote ID into guest access.

```sql
SET ROLE platform_definer;   -- preferred form (ADR-0005 am. 10 item 9, PR7-SEC-09; block rewritten 2026-11-12, PR7-SEC-12 (e), D-ARCH-065):
                             -- the function is created already owned by platform_definer (CREATE on schema platform, am. 8 b), so
                             -- no OWNER TO is needed and the owner itself grants EXECUTE. Linter rule 15 accepts this form or
                             -- "grants before OWNER TO" (the auth_lookup_user_by_email example above), never OWNER TO before GRANT.
CREATE FUNCTION platform.job_context(p_kind text, p_id uuid)
RETURNS TABLE (org_id uuid, actor_type text, actor_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$                 -- amended 2026-11-12 (SEC-P3-27): was pg_catalog, public
#variable_conflict use_column
DECLARE
  c_system    constant uuid := '00000000-0000-7000-8000-000000000001';
  c_anonymous constant uuid := '00000000-0000-7000-8000-000000000002';
BEGIN
  CASE p_kind
    WHEN 'outbox_event' THEN
      RETURN QUERY SELECT e.org_id,
                          CASE e.actor_id WHEN c_system THEN 'SYSTEM_JOB' WHEN c_anonymous THEN 'ANONYMOUS' ELSE 'USER' END,
                          e.actor_id
                     FROM public.outbox_events e WHERE e.id = p_id;
    WHEN 'saga' THEN
      RETURN QUERY SELECT s.org_id,
                          CASE s.created_by WHEN c_system THEN 'SYSTEM_JOB' ELSE 'USER' END,
                          s.created_by
                     FROM public.saga_executions s WHERE s.id = p_id;
    WHEN 'notification' THEN
      RETURN QUERY SELECT n.org_id,
                          CASE WHEN n.recipient_user_id IS NULL THEN 'SYSTEM_JOB' ELSE 'USER' END,
                          COALESCE(n.recipient_user_id, c_system)
                     FROM public.notification_log n WHERE n.id = p_id;
    WHEN 'shipment'      THEN RETURN QUERY SELECT x.org_id, 'SYSTEM_JOB'::text, c_system FROM public.shipments x WHERE x.id = p_id;
    WHEN 'order'         THEN RETURN QUERY SELECT x.org_id, 'SYSTEM_JOB'::text, c_system FROM public.orders    x WHERE x.id = p_id;
    WHEN 'pickup'        THEN RETURN QUERY SELECT x.org_id, 'SYSTEM_JOB'::text, c_system FROM public.pickups   x WHERE x.id = p_id;
    WHEN 'document'      THEN RETURN QUERY SELECT x.org_id, 'SYSTEM_JOB'::text, c_system FROM public.documents x WHERE x.id = p_id;
    WHEN 'payment'       THEN RETURN QUERY SELECT x.org_id, 'SYSTEM_JOB'::text, c_system FROM public.payments  x WHERE x.id = p_id;
    WHEN 'quote'         THEN RETURN QUERY SELECT x.org_id, 'SYSTEM_JOB'::text, c_system FROM public.quotes    x WHERE x.id = p_id;
    WHEN 'tracking_poll' THEN
      RETURN QUERY SELECT s.org_id, 'SYSTEM_JOB'::text, c_system
                     FROM public.tracking_poll_schedule t
                     JOIN public.shipments s ON s.id = t.shipment_id
                    WHERE t.id = p_id;
    ELSE
      RAISE EXCEPTION USING ERRCODE = '22023',               -- invalid_parameter_value
                            MESSAGE = pg_catalog.format('JOB_CONTEXT_UNKNOWN_KIND: %s', p_kind);
  END CASE;
END $$;
REVOKE ALL ON FUNCTION platform.job_context(text, uuid) FROM PUBLIC;      -- redundant with the definer's global default privileges (am. 9), explicit
GRANT EXECUTE ON FUNCTION platform.job_context(text, uuid) TO platform_app;
RESET ROLE;
```

- **Rules.** An unknown kind raises, and the processor sends the job to the DLQ as non-retryable `PAYLOAD_INVALID`. No row means an empty result, which the processor treats as non-retryable `JOB_CONTEXT_NOT_FOUND`.
- **Cost.** Every lookup is a primary-key probe (`tracking_poll` probes two primary keys), so a call adds about 0.1 ms per job.
- **Tests.** The C11 test plus a dedicated integration test: for each kind, the function returns the context of the row's own organisation. A job edited in Redis to name org B's row runs in org B's context, never in the context of the job's original org. A payload that carries `org_id` or `actor_id` goes to the DLQ with `job_context_mismatch` (SEC-TC-20, SEC-TC-50).
- **Policies.** The definer-read policies on the listed TENANT/USER_OWNED tables are those of §4.3.

`mfa_enrolment_overdue_candidates(p_now, p_limit)` (SEC-P3-14) follows the candidate-function shape:

```sql
SELECT u.id
  FROM public.organisations o
  JOIN public.memberships m ON m.org_id = o.id AND m.status = 'ACTIVE'
  JOIN public.users u       ON u.id = m.user_id
 WHERE o.type = 'OPERATOR' AND o.deleted_at IS NULL
   AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
   AND u.first_signed_in_at < p_now - interval '24 hours'
   AND NOT EXISTS (SELECT 1 FROM public.mfa_totp t WHERE t.user_id = u.id AND t.status = 'ACTIVE')
 ORDER BY u.id
 LIMIT least(p_limit, 1000);
```

#### Sensitive definer functions (amended 2026-11-12; SEC-P3-12, SEC-P3-26)

These functions return data that grants or reveals more than an ID lookup. In addition to C11, a lint/Semgrep rule allows calls only from the listed module, and catalog test C11 keeps this list as a separate assertion.

| Function | Why sensitive | Only caller |
|---|---|---|
| `auth_lookup_credential` | returns the password hash of any user ID | `apps/api/src/modules/identity/repository` |
| `job_context` | maps any aggregate ID to its organisation and opens that tenant context | `apps/worker/src/platform/jobs` (the job runner, before `withTenantTx`) |
| `sessions_for_user` | enumerates another user's session IDs | `apps/api/src/modules/identity/repository` (revocation service) |
| `purge_expired_tokens` | deletes rows across users | `apps/worker` `housekeeping` processor |

### 4.6 Catalog tests (integration suite, Testcontainers, run against the migrated schema)

| # | Assertion | Query sketch |
|---|---|---|
| C1 | Every non-partition table in `public` not on the GLOBAL/SYSTEM allow-list has RLS enabled **and** forced | `SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relispartition AND relname <> ALL($allow) AND NOT (relrowsecurity AND relforcerowsecurity)` → 0 rows (REQ-RLS-002) |
| C2 | Every table with an `org_id` column is either allow-listed or has RLS, ≥ 1 `TO platform_app` policy and an index whose first key column is `org_id` (`organisations` special-cased on `id`) | join `pg_attribute` / `pg_policy` / `pg_index` (`indkey[0] = attnum`) (REQ-RLS-001, NFR-TENANT-001) |
| C3 | Policy definitions equal the committed snapshot *(amended 2026-11-13, D-ARCH-072: equal the set **derived from the manifests and the renderer** — see the 2026-11-13 bullets below; the hand-edited snapshot is retired)*; no `TO platform_app` policy has `USING (true)`; every `TO platform_app` predicate contains a keyed atom; `TO platform_definer` policies exist only on the definer-read tables listed in §4.3; no policy targets `platform_migrator` | `SELECT tablename, policyname, cmd, roles, qual, with_check FROM pg_policies ORDER BY 1,2` vs the deparsed rendering of every manifest entry on a rolled-back probe |
| C4 | `platform_app` is not superuser, has no `BYPASSRLS`/`CREATEROLE`/`CREATEDB`, owns no relation or function | `pg_roles`, `pg_class.relowner`, `pg_proc.proowner` (REQ-RLS-005) |
| C5 | Table and column privileges of `platform_app` equal the grant manifest; `DELETE` only on the SYSTEM allow-list; audit tables (`audit_entries`, `audit_checkpoint_heads`, `audit_anchors`, `audit_pii_vault`, `data_subjects`) exactly `INSERT, SELECT`; no privilege on any partition. *Amended 2026-11-12 (batch 0.2, D-ARCH-046):* the manifest is the only source of table privileges — `pg_default_acl` holds **no** row with `defaclobjtype IN ('r', 'S', 'T', 'n')` for this database (no default table, sequence, type or schema privileges for any role), so every table grant is an explicit statement in a migration or bootstrap file | `information_schema.role_table_grants`, `role_column_grants`, `has_table_privilege`, `pg_default_acl` (REQ-AUDIT-014, REQ-RLS-010) |
| C6 | `audit_entries` has the UPDATE/DELETE row trigger and the TRUNCATE trigger; every partition has the cloned row trigger (`tgparentid`) and its own TRUNCATE trigger | `pg_trigger` (ADR-0007) |
| C7 | Immutability triggers exist on `compliance_packs`, `compliance_pack_sections`, `shipment_price_snapshots`, `notification_templates`, pricing child tables, `audit_checkpoint_heads`, `audit_anchors`, `audit_pii_vault` | `pg_trigger` |
| C8 | No `timestamp without time zone`; every `id` is `uuid` with default `uuidv7()`; every `*_minor` column is `bigint` with a sibling currency column carrying the `^[A-Z]{3}$` CHECK | `information_schema.columns`, `pg_constraint` (NFR-DATA-001/002) |
| C9 | Each named enum CHECK equals its `packages/shared` enum | parse `pg_get_constraintdef` of `ck_*` constraints |
| C10 | Every column has a classification registry entry; SYSTEM tables have no `PER`/`SPER` columns except the documented exceptions (`idempotency_keys.response_body`, the encrypted vault); every ciphertext/HMAC column listed in §10.4 has its `<col>_key_id` sibling | `information_schema.columns` vs registry (NFR-PRIV-003) |
| C11 | `SECURITY DEFINER` functions (in every schema) are exactly the §4.5 list plus `app_is_operator` (owner `platform_definer`) and `ensure_audit_partitions` (owner `platform_audit_owner`), each with `EXECUTE` only for `platform_app`; the §4.5 functions have owner `platform_definer`; the sensitive-definer list of §4.5 matches its lint allow-list. *Amended 2026-11-12 (SEC-P3-27):* for every `SECURITY DEFINER` function, `proconfig` holds **exactly one** `search_path` entry and it equals **`search_path=pg_catalog, pg_temp`** (other entries, such as `TimeZone=UTC` and `lock_timeout=5s` on `ensure_audit_partitions`, are allowed). *Amended 2026-11-12 (batch 0.2, SEC-P3-37 item 1, D-ARCH-046):* **default function privileges.** `pg_default_acl` holds exactly three rows with `defaclobjtype = 'f'`, each with `defaclnamespace = 0` (global, never `IN SCHEMA`) and `defaclacl = '{<role>=X/<role>}'`, for `platform_migrator`, `platform_definer` and `platform_audit_owner`; **and** a probe function created by the migrator in `platform` and one in `public` (inside a rolled-back transaction) report `has_function_privilege('public', …, 'EXECUTE') = false` and `has_function_privilege('platform_app', …, 'EXECUTE') = false`. No function in any schema grants `EXECUTE` to `PUBLIC` | `SELECT p.oid::regprocedure FROM pg_catalog.pg_proc p WHERE p.prosecdef AND (p.proconfig IS NULL OR NOT ('search_path=pg_catalog, pg_temp' = ANY (p.proconfig)) OR (SELECT count(*) FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%') <> 1)` → 0 rows; plus `proowner`, `has_function_privilege`; `SELECT pg_get_userbyid(defaclrole), defaclnamespace, defaclobjtype, defaclacl FROM pg_catalog.pg_default_acl` → exactly the three rows above |
| C12 | With no settings, every RLS table returns 0 rows to `platform_app`; with org A set, crafted IDs of org B select/update/delete 0 rows and inserts with B's `org_id` fail; a customer member with `app.actor_scope = 'OPERATOR'` forced still sees nothing of B (`app_is_operator()` false) | generated per table (REQ-RLS-004/006/007, NFR-TENANT-001) |
| C13 | (2026-11-12, SEC-P3-03) Every audit object (the eight tables of §4.4, every `audit_entries_%` partition, the three audit functions) has owner `platform_audit_owner`. `platform_audit_owner` has `rolcanlogin = false` and **no row in `pg_auth_members`**, neither as a role granted to others nor as a member. `platform_migrator` owns no audit object. *Amended 2026-11-12 (SEC-P3-27 item 6, SEC-P3-33 item 10):* (a) schemas `public` and `platform` have owner `platform_schema_owner`, which has `rolcanlogin = false`; `platform_migrator` owns no schema. (b) The `pg_auth_members` rule for **both** `platform_audit_owner` and `platform_schema_owner` depends on who ran the bootstrap. **Locally** (superuser bootstrap): **no row**, neither as granted role nor as member. **On RDS (M5)**: the bootstrap master is not a superuser, and PostgreSQL 16+ automatically grants a role created by a `CREATEROLE` role to its creator with `admin_option = true`. So for each role there is **exactly one** row, with `roleid` = the role, `member` = the RDS master role, `admin_option = true`, `set_option = false`, `inherit_option = false`, and no other row in which the role is `roleid` or `member`. The master is passed to the test as `CATALOG_BOOTSTRAP_MASTER_ROLE`, empty locally. That row is break-glass, like the master credential itself (platform.md §4.3). SPK-08 verifies this RDS-parity assumption. *Amended 2026-11-12 (batch 0.2, SEC-P3-34 items 3 and 5, D-ARCH-045):* (c) `pg_database.datdba` for the current database is **not** `platform_migrator` (locally it is the bootstrap superuser; on RDS the master, passed as `CATALOG_BOOTSTRAP_MASTER_ROLE`); `platform_migrator` has `has_database_privilege(…, 'CREATE') = false` and `'CONNECT') = true`. (d) `pg_db_role_setting` for the current database has **no** database-wide row (`setrole = 0`) and exactly one row for the bootstrap role whose `setconfig` contains `search_path=pg_catalog, pg_temp`. The TASK-003 bootstrap suite asserts (c) and (d) at bootstrap time; C13 re-asserts them after every migration and in the restore rehearsal (§8.6 step 5) | `pg_class.relowner`, `pg_proc.proowner`, `pg_namespace.nspowner`, `pg_roles`, `pg_auth_members (roleid, member, admin_option, set_option, inherit_option)`, `pg_database.datdba`, `has_database_privilege`, `pg_db_role_setting (setdatabase, setrole, setconfig)` |
| C14 | (2026-11-12, SEC-P3-03) Event triggers `platform_audit_ddl_guard_end` (`ddl_command_end`) and `platform_audit_ddl_guard_drop` (`sql_drop`) exist with `evtenabled = 'O'` and call `platform.audit_ddl_guard()`, which is **not** `SECURITY DEFINER`. `audit_anchors` has the UPDATE/DELETE row trigger and the TRUNCATE trigger. *Amended 2026-11-12 (SEC-P3-27):* (a) `platform.audit_forbid_mutation()`, `platform.audit_vault_guard()` and `platform.audit_ddl_guard()` have `prosecdef = false`, and `proconfig` holds exactly one `search_path` entry equal to **`search_path=pg_catalog, pg_temp`**. (b) The guard matches the schemas by OID. In a transaction that is rolled back, the test superuser runs `ALTER SCHEMA public RENAME TO c14_x` and then `ALTER SCHEMA platform RENAME TO c14_y`, each in its own savepoint. Each raises SQLSTATE `42501` with the guard's message. Privilege does not stop a superuser, so this proves the guard itself. The migrator-side negative test is SEC-TC-61 | `pg_event_trigger`, `pg_proc.prosecdef`, `pg_proc.proconfig` (same query as C11 with `p.oid IN (…three functions…)` in place of `p.prosecdef`), `pg_trigger`, rename probe |

Amended 2026-11-12 (SEC-P3-03, SEC-P3-25, SEC-P3-26):
- **C3.** The row was changed from "`TO platform_migrator` policies exist only on the tables in §4.5" to the `platform_definer` wording above.
- **C5.** `audit_anchors` is `INSERT, SELECT` for `platform_app`, like the other append-only audit tables (row changed in place).
- **C7.** `audit_anchors` is added to the immutability-trigger list (row changed in place).
- **C10.** Each column in the §10.4 key table has its `<col>_key_id` sibling (row changed in place).
- **C11.** The row was changed from "owner `platform_migrator`" to the owners above. The §4.5 list now includes `job_context`, `sessions_for_user` and `mfa_enrolment_overdue_candidates`, and the sensitive-definer assertion was added.
- **Wave-end and evidence checks.** SEC-P3-07 refers to the security catalog suite as "C1–C12"; C13 and C14 belong to it as well.

Amended 2026-11-12 (SEC-P3-27, SEC-P3-33 item 10):
- **C11.** "each with a fixed `search_path`" now names the exact value, `search_path=pg_catalog, pg_temp`, and the query covers every schema. A definer function planted in `public` therefore fails both the exact-list and the `proconfig` assertion.
- **C13.** Adds the schema owner `platform_schema_owner` and the environment-dependent `pg_auth_members` rule (none locally; one ADMIN-only row for the RDS master).
- **C14.** Adds the `proconfig` assertion for the three non-definer audit functions and the OID rename probe.
- **SEC-TC-61** (security review §14.5) is the negative test as the migrator:
  - It plants `public.pg_advisory_xact_lock(integer)` and `public.to_char(date, text)`, then calls `platform.ensure_audit_partitions(3)` as `platform_app`. The call succeeds, no marker row exists and every audit trigger is still enabled.
  - `ALTER SCHEMA public RENAME TO x` and `ALTER SCHEMA platform RENAME TO y` both raise; since this amendment they are refused by privilege first and by the guard second.
  - The amendment proposes adding `DROP FUNCTION platform.audit_ddl_guard() CASCADE` and `DROP SCHEMA platform CASCADE` to SEC-TC-61 (both must fail by privilege).

Amended 2026-11-12 (batch 0.2; SEC-P3-34, SEC-P3-37 item 1; D-ARCH-045, D-ARCH-046; `rulings/batch-0.2-rulings.md`):
- **C5.** Adds the "no default table/sequence/type/schema privileges" assertion on `pg_default_acl`, so the grant manifest is provably the only source of table privileges.
- **C11.** Adds the default-function-privilege assertion: exactly three global `defaclobjtype = 'f'` rows (`platform_migrator`, `platform_definer`, `platform_audit_owner`), plus the migrator-created-probe check in `platform` and `public`. The per-schema statements the earlier text implied would have produced no `pg_default_acl` row at all (a per-schema `REVOKE` cannot remove a global default), which is how TASK-003 found the defect.
- **C13.** Adds (c) the migrator is not the database owner and holds no `CREATE` on the database, and (d) the SEC-P3-34 item 3 `pg_db_role_setting` assertion. The TASK-003 bootstrap suite (`prisma/tests/bootstrap`) already asserts both; TASK-016's `c01-c12.int.test.ts` (which also carries C13/C14) re-asserts them on the migrated schema.

Amended 2026-11-13 (PR #11 code review m2/m4/n1/n2, security review PR11-SEC-03/04/06/10/11; `rulings/wave-0-task-016-rulings.md`; D-ARCH-071..074). TASK-016 (PR #11) ships C1–C5, C11, C12 (rendered probe) and C13 and parts of C14; the remainder has named owners and the suite header names every deferral:
- **C3 — derived, keyed, invariant-checked (owner TASK-024).** The expected policy set is no longer a hand-edited `policies.snapshot.json` (which the same PR that adds a policy also edits): the suite renders every RLS manifest entry with `renderRls`, creates the rendered block on a rolled-back probe, reads back the deparsed `pg_policies` rows and requires the live rows to equal them. In addition every `TO platform_app` `qual`/`with_check` must contain one of `platform.app_org_id()`, `platform.app_actor_id()`, `platform.app_guest_token_hash()` or `platform.app_is_operator()` (planted `p_bad_tautology` `USING (org_id = org_id)` and `p_bad_unkeyed` `USING (org_id IS NULL)` are reported — probe P-C showed both passed the deny-list), and the DR-A14 invariants hold: `memberships` policy expressions contain no subquery; `users`/`organisations` subqueries reference `public.memberships` only; `IN (…)` lists appear only on `m.status`. The deny-list scan of `scans.ts` stays as the second layer.
- **C5 — `PUBLIC` included (TASK-016 fix cycle).** `aclexplode` rows with `grantee = 0` are rendered as `PUBLIC` instead of being filtered out; the manifest cannot express `PUBLIC`, so any table or column grant to `PUBLIC` in `public`/`platform` fails C5 (planted, rolled-back `GRANT TRUNCATE ON public.permissions TO PUBLIC`). `platform_app` inherits every `PUBLIC` grant and `TRUNCATE`/`REFERENCES` are not subject to RLS. Linter rule 8 flags `TO PUBLIC` and `TRUNCATE`/`TRIGGER`/`REFERENCES` grants (§8.3).
- **C6, C7, C14 remainder (owner TASK-021).** C6 as written. C7 becomes manifest-driven: a new table-class flag `immutable: true` marks every append-only table that carries the immutability trigger (`audit_checkpoint_heads`, `audit_anchors`, `audit_pii_vault` first; each later creating task flags its own — `compliance_packs`, `compliance_pack_sections`, `shipment_price_snapshots`, `notification_templates`, pricing child tables), and C7 asserts the trigger on every flagged table that exists.
- **C8, C9 (TASK-016 fix cycle if it ships them, otherwise TASK-024).** Both already apply to the committed authz tables.
- **C10 (owner TASK-028, the classification-registry task).**
- **C11 — converse ownership set (owner TASK-024; PR11-SEC-06, P3 §15 deviation 7 condition).** `platform_definer` owns exactly the allow-listed definer functions and **no other function, relation, type or schema**: `UNION ALL` over `pg_proc.proowner`, `pg_class.relowner`, `pg_type.typowner` and `pg_namespace.nspowner` equals the allow-list; planted, rolled-back `SET ROLE platform_definer; CREATE VIEW platform.v AS SELECT 1;` and an invoker function are both reported. A definer-owned view in `platform` would otherwise read the definer-read tables under `USING (true)`. Helper expectation (TASK-037): `platform.app_actor_id()` is `EXECUTE`-able by `platform_app`, `platform_migrator` and `platform_definer` once `app_is_operator()` exists (§4.4).
- **C13 — case folding and `proconfig` (TASK-016 fix cycle; PR11-SEC-11 b).** GUC names are case-insensitive: the `app.%` assertions use `lower(…) LIKE 'app.%'` on `pg_db_role_setting.setconfig` and `pg_parameter_acl.parname`, and additionally assert no `pg_proc.proconfig` entry `ILIKE 'app.%'` in any non-system schema (a function-level `SET app.* = …` needs superuser or `SET` on the parameter, so only the bootstrap lane could add one). The `platform_app` row set is five rows once `lc_messages = 'C'` ships (§4.1).
- **C1 and rule 9 scope (owner TASK-024; PR11-SEC-11 e).** C1 covers every non-system schema, or asserts that `platform` holds no table; rule 9 likewise.
- **Grant manifest (owner TASK-024; PR11-SEC-11 g).** A `runtimeReadOnly` flag on GLOBAL manifest entries makes `validateGrants` refuse any write line at parse time, so the SELECT-only guarantee of the authz catalogue no longer rests on C5 equality alone.

---

## 5. Audit store SQL

ADR-0007, REQ-AUDIT-012..018, DR-A09, NFR-AUDIT-002/003. Written as raw SQL in the initial audit migration.

Amended 2026-11-12 (SEC-P3-03; ADR-0007 amendment 7): every statement in §5.1–§5.7 that creates or alters an audit object runs in the **bootstrap lane** (`prisma/bootstrap/10-audit.sql` and later `prisma/bootstrap/NN-audit-*.sql` files carrying the security-approval marker, §8.3), under `SET ROLE platform_audit_owner`. It never runs in a Prisma migration as `platform_migrator`. The audit tables are listed in `tables.external` (§7.3) so that Prisma Migrate never diffs them. DML from the application (§5.4–§5.6) is unchanged and runs as `platform_app`.

### 5.1 Partitioned table

```sql
CREATE TABLE public.audit_entries (
  id                  uuid        NOT NULL,
  occurred_at         timestamptz NOT NULL,
  stream_id           uuid        NOT NULL,
  stream_seq          bigint      NOT NULL CONSTRAINT ck_audit_entries__seq CHECK (stream_seq >= 1),
  org_id              uuid,
  target_org_id       uuid,
  scope_org_id        uuid GENERATED ALWAYS AS (COALESCE(target_org_id, org_id)) STORED,
  on_behalf_of_org_id uuid,
  actor_type          text        NOT NULL CONSTRAINT ck_audit_entries__actor_type
                        CHECK (actor_type IN ('USER','API_KEY','SYSTEM_JOB','ANONYMOUS')),
  user_id             uuid,
  api_key_id          uuid,
  job_name            text,
  actor_roles         text[]      NOT NULL DEFAULT '{}',
  session_id          uuid,
  ip_token            uuid,
  ip_hash             bytea       CONSTRAINT ck_audit_entries__ip_hash CHECK (ip_hash IS NULL OR octet_length(ip_hash) = 32),
  ip_hash_key_id      text,                                                -- amended 2026-11-12 (SEC-P3-08 item 1)
  ip_coarse           inet        CONSTRAINT ck_audit_entries__ip_coarse CHECK (ip_coarse IS NULL OR masklen(ip_coarse) IN (24, 48)),
  user_agent_token    uuid,
  ua_parsed           text        CONSTRAINT ck_audit_entries__ua_parsed CHECK (char_length(ua_parsed) <= 120),
  source_app          text        NOT NULL CONSTRAINT ck_audit_entries__source_app CHECK (source_app IN ('web','admin','api','worker')),
  correlation_id      text        NOT NULL CONSTRAINT ck_audit_entries__correlation CHECK (correlation_id ~ '^[A-Za-z0-9-]{8,64}$'),
  action              text        NOT NULL CONSTRAINT ck_audit_entries__action CHECK (action IN (
                        'CREATE','UPDATE','DELETE','VIEW','DOWNLOAD','LOGIN','LOGOUT','LOGIN_FAILED','ACCOUNT_LOCKED',
                        'TOKEN_REUSE_DETECTED','MFA_ENROLLED','MFA_FAILED','PERMISSION_DENIED','EXPORT',
                        'ON_BEHALF_ACTION','CONFIG_CHANGE','API_KEY_USE','STATE_TRANSITION')),
  entity_name         text        NOT NULL CONSTRAINT ck_audit_entries__entity_name CHECK (entity_name ~ '^[a-z][a-z0-9_]*$'),
  entity_id           text,
  outcome             text        NOT NULL CONSTRAINT ck_audit_entries__outcome CHECK (outcome IN ('SUCCESS','DENIED','FAILED')),
  reason_token        uuid,
  reauth_proof_id     uuid,
  signature_meaning   text,
  http_method         text,
  route               text,
  old_value           jsonb,
  new_value           jsonb,
  details             jsonb,
  pii_token_count     integer     NOT NULL DEFAULT 0 CONSTRAINT ck_audit_entries__pii_token_count CHECK (pii_token_count >= 0),
  hash_version        smallint    NOT NULL DEFAULT 1,
  prev_hash           bytea       NOT NULL CONSTRAINT ck_audit_entries__prev_hash  CHECK (octet_length(prev_hash) = 32),
  entry_hash          bytea       NOT NULL CONSTRAINT ck_audit_entries__entry_hash CHECK (octet_length(entry_hash) = 32),
  CONSTRAINT ck_audit_entries__job_name CHECK (actor_type <> 'SYSTEM_JOB' OR job_name IS NOT NULL),
  CONSTRAINT ck_audit_entries__ip_hash_key CHECK ((ip_hash IS NULL) = (ip_hash_key_id IS NULL)),
  CONSTRAINT pk_audit_entries PRIMARY KEY (occurred_at, id),
  CONSTRAINT ux_audit_entries__entry_hash UNIQUE (entry_hash, occurred_at)
) PARTITION BY RANGE (occurred_at);
-- no DEFAULT partition: an insert outside every partition fails closed (REQ-AUDIT-017, EC-A21)

CREATE INDEX ix_audit__scope_org_time ON public.audit_entries (scope_org_id, occurred_at DESC, id DESC);
CREATE INDEX ix_audit__user_time      ON public.audit_entries (user_id, occurred_at DESC, id DESC) WHERE user_id IS NOT NULL;
CREATE INDEX ix_audit__entity_time    ON public.audit_entries (entity_name, entity_id, occurred_at DESC, id DESC);
CREATE INDEX ix_audit__action_time    ON public.audit_entries (action, occurred_at DESC, id DESC);
CREATE INDEX ix_audit__outcome_time   ON public.audit_entries (outcome, occurred_at DESC, id DESC) WHERE outcome <> 'SUCCESS';
CREATE INDEX ix_audit__ip_hash_time   ON public.audit_entries (ip_hash, occurred_at DESC, id DESC) WHERE ip_hash IS NOT NULL;
CREATE INDEX ix_audit__ip_coarse_time ON public.audit_entries (ip_coarse, occurred_at DESC, id DESC) WHERE ip_coarse IS NOT NULL;
CREATE INDEX ix_audit__correlation    ON public.audit_entries (correlation_id);
CREATE INDEX ix_audit__roles          ON public.audit_entries USING gin (actor_roles);
CREATE INDEX ix_audit__stream_seq     ON public.audit_entries (stream_id, stream_seq);
ALTER TABLE public.audit_entries OWNER TO platform_audit_owner;   -- amended 2026-11-12 (SEC-P3-03); created under SET ROLE platform_audit_owner anyway
```

Amended 2026-11-12 (SEC-P3-08 item 1, SEC-P3-03): added `ip_hash_key_id` with its pairing CHECK, and the owner line.

### 5.2 Immutability triggers

```sql
CREATE FUNCTION platform.audit_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp                    -- amended 2026-11-12 (SEC-P3-27): was unset (ran with the invoker's path)
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '42501',                                   -- insufficient_privilege
    MESSAGE = pg_catalog.format('AUDIT_IMMUTABLE: %s on %s is not permitted', TG_OP, TG_TABLE_NAME);
END $$;

CREATE TRIGGER trg_audit_entries__no_update_delete
  BEFORE UPDATE OR DELETE ON public.audit_entries
  FOR EACH ROW EXECUTE FUNCTION platform.audit_forbid_mutation();     -- cloned to every partition

CREATE TRIGGER trg_audit_entries__no_truncate
  BEFORE TRUNCATE ON public.audit_entries
  FOR EACH STATEMENT EXECUTE FUNCTION platform.audit_forbid_mutation();
-- statement triggers are not cloned to partitions: ensure_audit_partitions adds one per partition (§5.3)

CREATE TRIGGER trg_audit_checkpoint_heads__immutable
  BEFORE UPDATE OR DELETE ON public.audit_checkpoint_heads
  FOR EACH ROW EXECUTE FUNCTION platform.audit_forbid_mutation();

-- amended 2026-11-12 (SEC-P3-03): anchors are append-only like the entries
CREATE TRIGGER trg_audit_anchors__immutable
  BEFORE UPDATE OR DELETE ON public.audit_anchors
  FOR EACH ROW EXECUTE FUNCTION platform.audit_forbid_mutation();
CREATE TRIGGER trg_audit_anchors__no_truncate
  BEFORE TRUNCATE ON public.audit_anchors
  FOR EACH STATEMENT EXECUTE FUNCTION platform.audit_forbid_mutation();
CREATE TRIGGER trg_audit_checkpoint_heads__no_truncate
  BEFORE TRUNCATE ON public.audit_checkpoint_heads
  FOR EACH STATEMENT EXECUTE FUNCTION platform.audit_forbid_mutation();
ALTER FUNCTION platform.audit_forbid_mutation() OWNER TO platform_audit_owner;
```

The triggers fire for every role including the owner (REQ-AUDIT-014). Disabling a trigger requires table ownership (`platform_audit_owner` since the 2026-11-12 amendment below; was `platform_migrator`), which the application never holds; the migration linter rejects `DISABLE TRIGGER`, `DETACH PARTITION`, `DROP TABLE … audit_*`, `NO FORCE ROW LEVEL SECURITY` and any `UPDATE`/`DELETE`/`TRUNCATE` of audit tables (§8.3). `session_replication_role = replica` (which skips triggers) needs superuser. As defence in depth the bootstrap (superuser) script installs (**withdrawn 2026-11-12, replaced by the identity-based guard below**) an event trigger `platform_audit_ddl_guard` on `ddl_command_start` and `sql_drop` that raises when the statement text targets `audit_entries`/`audit_pii_vault` with `DETACH`, `DISABLE TRIGGER`, `NO FORCE`, `DISABLE ROW LEVEL SECURITY` or `DROP`. It guards against accidents, not a malicious superuser; tamper evidence against the latter is the hash chain plus the M5 Object Lock archive. The REQ-AUDIT-015 tests attempt UPDATE, DELETE and TRUNCATE as `platform_app`, `platform_migrator` and the bootstrap owner, through SQL and through the Prisma client, and expect SQLSTATE `42501`.

#### Amendment (2026-11-12, SEC-P3-03): ownership and an identity-based event trigger

The paragraph above is amended in two places:

1. **Ownership.** "Disabling a trigger requires table ownership (`platform_migrator`)" now reads: ownership by **`platform_audit_owner`**, a `NOLOGIN` role with no members (§4.4). The migrator therefore gets "must be owner" on `DISABLE TRIGGER`, `NO FORCE ROW LEVEL SECURITY`, `DETACH PARTITION`, `DROP TRIGGER` and `CREATE OR REPLACE FUNCTION`.
2. **Event trigger.** The statement-text event trigger on `ddl_command_start` is **withdrawn**: it pattern-matched statement text, which dynamic SQL defeats (`DO $$ BEGIN EXECUTE 'ALTER TABLE audit_' || 'entries DISABLE TRIGGER ALL'; END $$`). It is replaced by a guard that inspects the **identity of the objects affected**. `ddl_command_end` lists every object a command created or altered (including commands built by `EXECUTE` inside `DO` blocks and functions), and `sql_drop` lists every dropped object (including objects dropped by `CASCADE` and by the schema owner's `DROP TABLE` / `DROP SCHEMA … CASCADE`, §4.4).

The guard raises unless `current_user = 'platform_audit_owner'`. That condition holds only:
- inside `ensure_audit_partitions` (a `SECURITY DEFINER` function owned by that role), and
- in the bootstrap lane under `SET ROLE platform_audit_owner`, which requires superuser.

The guard function therefore must **not** be `SECURITY DEFINER`, otherwise `current_user` would always be its owner (C14). The row and statement triggers above stay.

```sql
-- prisma/bootstrap/90-audit-ddl-guard.sql — run by the bootstrap superuser AFTER 10-audit.sql (RESET ROLE first);
-- event triggers require superuser, so the function and triggers are owned by the bootstrap superuser.
-- amended 2026-11-12 (SEC-P3-27 items 1 and 3): search_path with pg_temp explicitly last; every catalog and built-in
-- pg_catalog-qualified; the protected schemas are matched by OID, derived at call time (method and reasons below).
SET search_path = pg_catalog, pg_temp;                                       -- SEC-P3-27 item 4: first statement of the file
CREATE OR REPLACE FUNCTION platform.audit_ddl_guard() RETURNS event_trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp                                        -- was: pg_catalog (pg_temp then searched FIRST for relations)
AS $$
DECLARE
  r       record;
  v_owner oid;
  v_ns    oid[];                                                             -- protected schema OIDs
  v_rel   oid;
  v_hit   boolean;
  c_tbl   constant text   := '^(audit_[a-z0-9_]+|data_subjects)$';          -- audit tables and audit_entries_YYYY_MM partitions
  c_idx   constant text   := '^(ix_audit__|pk_audit_|ux_audit_|ux_data_subjects__|audit_entries_)';
  c_fn    constant text[] := ARRAY['audit_forbid_mutation','audit_vault_guard','ensure_audit_partitions','audit_ddl_guard'];
  c_nsnm  constant text[] := ARRAY['public','platform'];                     -- sql_drop fallback only; never used on ddl_command_end
BEGIN
  IF current_user = 'platform_audit_owner' THEN
    RETURN;                                                                  -- ensure_audit_partitions / bootstrap lane only
  END IF;

  -- Protected schemas BY OID: every schema holding a relation or function owned by platform_audit_owner
  -- (public: the audit tables; platform: the audit functions). A rename keeps the OID.
  v_owner := pg_catalog.to_regrole('platform_audit_owner')::oid;
  SELECT pg_catalog.array_agg(s.ns) INTO v_ns
    FROM (SELECT c.relnamespace AS ns FROM pg_catalog.pg_class c WHERE c.relowner = v_owner
          UNION
          SELECT p.pronamespace       FROM pg_catalog.pg_proc  p WHERE p.proowner = v_owner) s;
  IF v_ns IS NULL THEN                                                       -- owner missing or owns nothing: fail closed
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'audit DDL guard cannot resolve the protected schemas (SEC-P3-27)';
  END IF;

  IF TG_EVENT = 'ddl_command_end' THEN
    FOR r IN SELECT * FROM pg_catalog.pg_event_trigger_ddl_commands() LOOP
      CONTINUE WHEN r.objid IS NULL OR r.objid = 0;                          -- e.g. GRANT rows, no-op CREATE SCHEMA IF NOT EXISTS
      v_hit := false;
      IF r.object_type = 'schema' THEN
        v_hit := r.objid = ANY (v_ns);                                       -- ALTER SCHEMA … RENAME / OWNER TO, COMMENT ON SCHEMA
      ELSIF r.object_type = 'function' THEN
        SELECT p.proowner = v_owner OR (p.pronamespace = ANY (v_ns) AND p.proname = ANY (c_fn))
          INTO v_hit FROM pg_catalog.pg_proc p WHERE p.oid = r.objid;        -- also stops overloads planted under an audit name
      ELSIF r.object_type IN ('table','table column','index','trigger','policy','table constraint','rule') THEN
        v_rel := CASE r.object_type
                   WHEN 'index'            THEN (SELECT i.indrelid FROM pg_catalog.pg_index      i WHERE i.indexrelid = r.objid)
                   WHEN 'trigger'          THEN (SELECT t.tgrelid  FROM pg_catalog.pg_trigger    t WHERE t.oid = r.objid)
                   WHEN 'policy'           THEN (SELECT p.polrelid FROM pg_catalog.pg_policy     p WHERE p.oid = r.objid)
                   WHEN 'table constraint' THEN (SELECT k.conrelid FROM pg_catalog.pg_constraint k WHERE k.oid = r.objid)
                   WHEN 'rule'             THEN (SELECT w.ev_class FROM pg_catalog.pg_rewrite    w WHERE w.oid = r.objid)
                   ELSE r.objid                                              -- 'table', 'table column'
                 END;
        SELECT c.relowner = v_owner OR (c.relnamespace = ANY (v_ns) AND c.relname ~ c_tbl)
          INTO v_hit FROM pg_catalog.pg_class c WHERE c.oid = v_rel;
      END IF;
      IF COALESCE(v_hit, false) THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
          MESSAGE = 'audit objects are immutable (SEC-P3-03)',
          DETAIL  = pg_catalog.format('%s on %s %s by %s', r.command_tag, r.object_type, r.object_identity, current_user);
      END IF;
    END LOOP;

  ELSIF TG_EVENT = 'sql_drop' THEN
    -- Dropped objects are already gone from the catalogue: schemas match by OID first, and by name only as the fallback
    -- for a schema dropped together with every audit object it held (names are stable: renames are refused above).
    FOR r IN SELECT * FROM pg_catalog.pg_event_trigger_dropped_objects() LOOP
      IF r.object_type = 'schema' THEN
        v_hit := r.objid = ANY (v_ns) OR r.object_name = ANY (c_nsnm);
      ELSE
        v_hit := (COALESCE(pg_catalog.to_regnamespace(pg_catalog.quote_ident(r.address_names[1]))::oid = ANY (v_ns), false)
                  OR r.address_names[1] = ANY (c_nsnm))
             AND CASE
                   WHEN r.object_type IN ('table','table column','trigger','policy','table constraint','rule')
                                                   THEN r.address_names[2] ~ c_tbl
                   WHEN r.object_type = 'index'    THEN r.address_names[2] ~ c_idx
                   WHEN r.object_type = 'function' THEN r.address_names[2] = ANY (c_fn)
                   ELSE false
                 END;
      END IF;
      IF COALESCE(v_hit, false) THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
          MESSAGE = 'audit objects are immutable (SEC-P3-03)',
          DETAIL  = pg_catalog.format('DROP of %s %s by %s', r.object_type, r.object_identity, current_user);
      END IF;
    END LOOP;
  END IF;
END $$;
REVOKE ALL ON FUNCTION platform.audit_ddl_guard() FROM PUBLIC;

DROP EVENT TRIGGER IF EXISTS platform_audit_ddl_guard;                      -- the withdrawn text-matching trigger
CREATE EVENT TRIGGER platform_audit_ddl_guard_end  ON ddl_command_end EXECUTE FUNCTION platform.audit_ddl_guard();
CREATE EVENT TRIGGER platform_audit_ddl_guard_drop ON sql_drop        EXECUTE FUNCTION platform.audit_ddl_guard();
```

What the guard covers:
- **`ALTER TABLE` forms.** `ALTER TABLE … DISABLE TRIGGER`, `NO FORCE ROW LEVEL SECURITY`, `DISABLE ROW LEVEL SECURITY`, `DETACH PARTITION`, `ADD/DROP COLUMN`, `SET LOGGED/UNLOGGED`, `OWNER TO` and `RENAME` on an audit table or partition all surface in `ddl_command_end` with `object_type = 'table'` and the table's address.
- **Drops.** `DROP TRIGGER`, `DROP POLICY` and `DROP TABLE` surface in `sql_drop` with the table in `address_names[2]`.
- **Dropped indexes.** A dropped index is matched by name, because its table is gone from the catalogue at `sql_drop` time. That is why the naming prefixes of P9 matter. Partition child indexes start with the partition name.
- **Schemas.** Altering or dropping the `public` and `platform` schemas is guarded too. They are created only by the bootstrap lane, and a migrator-owned `DROP SCHEMA public CASCADE` would otherwise remove the audit tables. *Amended 2026-11-12 (SEC-P3-27): the schemas are matched by OID, so `ALTER SCHEMA public|platform RENAME`, `OWNER TO` and `DROP SCHEMA` all raise; since the §4.4 amendment the migrator no longer owns them, and privilege refuses these statements before the guard runs.*

#### Amendment (2026-11-12, SEC-P3-27): fixed search path and OID-based schema matching

The guard above, `audit_forbid_mutation` (above) and `audit_vault_guard` (§5.7) now declare `SET search_path = pg_catalog, pg_temp`. Every catalog and built-in they use is `pg_catalog.`-qualified: `pg_catalog.pg_class`, `pg_index`, `pg_proc`, `pg_trigger`, `pg_policy`, `pg_constraint`, `pg_rewrite`, `format`, `to_regrole`, `to_regnamespace`, `quote_ident`, `array_agg`, `pg_event_trigger_ddl_commands`, `pg_event_trigger_dropped_objects`. The fixes, against the weaknesses the review found:

- **Temporary-table shadowing.** The guard's old `SET search_path = pg_catalog` left `pg_temp` implicitly **first** for relation names. In the migrator's own session, a temporary `pg_index` or `pg_class` could therefore shadow the catalog in the index branch. With `pg_temp` listed last, and every catalog qualified, that is no longer possible.
- **Unpinned trigger functions.** The two trigger functions previously set no path. Their `format()` call ran with the invoker's path, and in the bootstrap lane the invoker is the superuser.
- **Schema renames.** The old guard matched `object_names[1] = 'public'`. As owner of `public`, the migrator could `ALTER SCHEMA public RENAME TO x`. Audit writes would then fail closed, and the guard would block renaming it back, a denial of service that only the superuser could repair. Schemas are now matched by OID.

**Method chosen for the OID match: derived at call time, not written into the body.** On every call the guard computes the protected schema OIDs. They are the namespaces of every relation (`pg_class.relnamespace`) and every function (`pg_proc.pronamespace`) owned by `platform_audit_owner`, whose OID comes from `to_regrole`; today that is `public` and `platform`. Reasons:
1. **Restore.** OIDs written into the function body by the bootstrap would go stale after every `pg_dump`/`pg_restore`, including the §8.6 rehearsal and any RDS snapshot restored into a new instance. Restored objects get new OIDs, but the restored function body would keep the old ones. The guard would then silently protect nothing (fail open), or need a regeneration step that someone must remember. The derived set is right in every database without a per-database step.
2. **Who controls the set.** It is anchored on ownership, which the migrator cannot change: it is not a member of `platform_audit_owner`, and it cannot `ALTER … OWNER` objects it does not own. It can only grow if the audit owner gains objects in another schema (for example the M5 `audit` schema), which makes the guard stricter, never weaker.
3. **Cost.** Two scans of `pg_class` and `pg_proc` filtered by owner per DDL command. That is a few milliseconds, paid only on DDL.
4. **Fail closed.** If the set is empty (the owner is missing or owns nothing), the guard raises on every DDL command instead of letting it through.

**Relation and function objects** are matched in two ways:
- by the identity of the object they belong to: the owning relation (`indrelid`, `tgrelid`, `polrelid`, `conrelid`, `ev_class`) or the function's owner is `platform_audit_owner`;
- or by namespace OID plus the audit name pattern. This keeps catching an audit table after an owner change by the superuser, and a function planted under an audit name, for example an overload `platform.ensure_audit_partitions(bigint)`.

**`sql_drop`.** Dropped objects are no longer in the catalogue when `sql_drop` fires, so the guard matches:
- a dropped schema by OID first, with its name as the fallback for a schema dropped in the same command as every audit object it held;
- a dropped table, index or function by the OID of its still-existing schema, with the schema name as the same fallback.

The names are stable, because `ddl_command_end` refuses a rename of a protected schema by OID, and since §4.4 item 6 the migrator cannot rename or drop either schema at all.

**Changing the guard later.** The guard protects itself (`audit_ddl_guard` is in `c_fn`), so a later bootstrap file that replaces it must first run `ALTER EVENT TRIGGER … DISABLE` for both triggers (superuser), then replace the function, then re-enable them, all in one transaction. The linter's `@audit-ddl` marker applies.

#### Amendment (2026-11-13, PR12-SEC-02 MEDIUM, PR12-SEC-03, PR12-SEC-04; SPK-08 F-05/F-08, §8 items 6–7; D-SEC-PR12-01; D-ARCH-076) — name squatting, install hardening, `ENABLE ALWAYS`. Binding on TASK-021 (DDL), TASK-033 (tests).

- **Name squatting (PR12-SEC-02 item 1).** The guard above matches an `index` through its table and lets `view`, `sequence`, `materialized view`, `composite type`, `type` and `domain` fall through with `v_hit = false`. As the migrator (`CREATE` on `public`), `CREATE INDEX audit_entries_2027_05 ON public.<own table>(id)` — or a view, sequence, matview, composite type, enum or domain of that name — therefore passed, and `ensure_audit_partitions` then skipped that month silently (§5.3). The `ddl_command_end` loop gains, **before** the existing relation branch, a match on the object's **own name** for every `pg_class` and `pg_type` object in a protected schema:
  ```sql
  IF r.object_type IN ('index','sequence','view','materialized view','composite type','foreign table') THEN
    SELECT c.relnamespace = ANY (v_ns) AND c.relname ~ c_tbl INTO v_hit FROM pg_catalog.pg_class c WHERE c.oid = r.objid;
  END IF;
  IF NOT COALESCE(v_hit, false) AND r.object_type IN ('type','domain') THEN
    SELECT t.typnamespace = ANY (v_ns) AND t.typname ~ c_tbl INTO v_hit FROM pg_catalog.pg_type t WHERE t.oid = r.objid;
  END IF;
  ```
  For `index` this is OR-ed with the existing owner-of-table check. `ALTER … RENAME TO audit_entries_…` surfaces in `ddl_command_end` with the new name and is caught the same way. Prisma never emits such names (SPK-08 F-08). Audit-owner DDL stays exempt, so the partitions' own `audit_entries_YYYY_MM_*` indexes are unaffected. C14 gains one probe per object kind (SEC-TC-43 extension, TASK-033).
- **Install hardening (PR12-SEC-03).** (1) The first-install file uses plain **`CREATE FUNCTION platform.audit_ddl_guard()`** (not `CREATE OR REPLACE`, which keeps a pre-existing owner and ACL — a migrator-created `platform.audit_ddl_guard()` on a developer, CI or rehearsal database would otherwise stay migrator-owned after the superuser's bootstrap and could later be replaced by a no-op). Later replacement files (“Changing the guard later”) first assert that no `platform.audit_ddl_guard` exists with an owner other than `current_user`, then `DISABLE` → replace → `ENABLE` in one transaction. (2) C14 asserts the guard function's owner and `pg_event_trigger.evtowner` = the bootstrap role. (3) **C14 converse:** `platform_audit_owner` owns exactly {`audit_forbid_mutation()` (invoker), `audit_vault_guard()` (invoker), `ensure_audit_partitions(integer)` (definer)} in `pg_proc`, and `platform_schema_owner` owns **0** `pg_proc` and **0** `pg_class` rows (mirror of the TASK-016 C11 converse for `platform_definer`). (4) C14 dependency check: no `pg_depend` row whose dependent object belongs to an audit-owned relation or function references an object outside `pg_catalog` owned by anyone other than `platform_audit_owner` or the bootstrap role (a check constraint on `audit_entries` calling a migrator function would otherwise make the guard's `sql_drop` the only stop and a `CREATE OR REPLACE` of that helper an unguarded semantic change). Negative fixtures: a migrator-owned `platform.audit_ddl_guard()` before the lane runs fails the lane; a second audit-owner definer fails C14; a check constraint on `audit_entries` calling a migrator function fails C14.
- **`ENABLE ALWAYS` (PR12-SEC-04 item 3, PR #12 code review security flag 2; architect decision).** Both event triggers and every audit row/statement trigger — including the per-partition `TRUNCATE` triggers created by `ensure_audit_partitions` — are created `ENABLE ALWAYS` (`ALTER EVENT TRIGGER … ENABLE ALWAYS`, `ALTER TABLE … ENABLE ALWAYS TRIGGER …`), so they also fire under `session_replication_role = replica`. C6 and C14 expect `tgenabled`/`evtenabled` = `'A'` (not the spike's `'O'`). **Stated limits:** this closes only the replica-mode bypass; it does not close `event_triggers = off` (if the RDS master can set it — COND-G4-PROD M5 check d), `ALTER EVENT TRIGGER … DISABLE` (superuser / documented master action) or the `GRANT platform_audit_owner … WITH SET TRUE; SET ROLE` path on RDS (PR12-SEC-04 item 1), which event triggers can neither prevent nor detect. Detection for those stays with the hourly verifier tripwire (TASK-116 asserts `evtenabled` of both event triggers and `tgenabled` of every audit trigger and partition clone and emits `audit_chain_broken` on any change) and, at M5, `pgaudit.log = 'ddl, role, misc_set'` with the PR12-SEC-04 filters (COND-G4-PROD).
- **Not ported from the SPK-08 prototype (PR12-SEC-08).** `audit_entries` is SYSTEM (no RLS; the viewer repository applies the scope; C1 allow-list): the prototype's `ENABLE`/`FORCE ROW LEVEL SECURITY` and placeholder policies are **not** ported; if RLS is ever added, the partitions keep zero privileges (C5). The prototype header lines record no security approval: TASK-021's bootstrap files carry the real rule-12 `@audit-ddl security-approved` marker with an entry in `tools/db/audit-ddl-reviewers.json`.

What it does not cover:
- **A cluster superuser.** The guard does not stop a superuser, who can `ALTER EVENT TRIGGER … DISABLE` or run with `session_replication_role = replica`, where event triggers do not fire. Tamper evidence against that actor is the hourly signed anchor (§5.5, §5.6) plus the M5 locked sink. *Amended 2026-11-13 (D-ARCH-076):* `ENABLE ALWAYS` closes the replica-mode case for every non-superuser; `event_triggers = off`, `ALTER EVENT TRIGGER … DISABLE` and the RDS master's `SET ROLE` path remain, detected by the TASK-116 tripwire and the M5 `pgaudit` filters only.
- **Linter versus guard.** The migration linter (§8.3) remains a text-based early warning; it is not a security boundary.
- **A squatted name created before the guard exists** (a database bootstrapped out of order). The lane order is fixed (bootstrap before the first `migrate deploy`; the SPK-08 F-01 lane-reordering option is rejected, D-SEC-PR12-01), and `ensure_audit_partitions` fails loudly on any foreign object under a partition name (§5.3), so the case is detected at the first daily run and by readiness, never silently skipped.
- **The first phase of a superuser `DETACH PARTITION … CONCURRENTLY`** (PR12-SEC-02 item d): `inhdetachpending = true` is committed even when the guard aborts the second phase. Caught by the readiness contiguity check (§5.3, `inhdetachpending` is a failure) and reported by the verifier as `SEQ_GAP`.

Tests (SEC-TC-43):
- As `platform_migrator`, each of `ALTER TABLE audit_entries DISABLE TRIGGER ALL`, `NO FORCE ROW LEVEL SECURITY`, `DROP TRIGGER`, `DETACH PARTITION`, `DROP TABLE public.audit_entries` and `DROP SCHEMA public CASCADE` fails.
- The same statements built through `DO $$ … EXECUTE 'ALTER TABLE audit_' || 'entries …' $$` fail too, with the guard's message wherever privilege did not already stop them.
- `SELECT platform.ensure_audit_partitions(3)` as `platform_app` still succeeds.
- *Added 2026-11-12 (SEC-P3-27):* SEC-TC-61 covers the search-path hijack (planted `public.pg_advisory_xact_lock(integer)` and `public.to_char(date, text)` are never called) and the schema renames. C14 (b) proves that the OID match holds even against a superuser.

### 5.3 Partition pre-creation

```sql
CREATE FUNCTION platform.ensure_audit_partitions(p_months_ahead integer DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp                                  -- amended 2026-11-12 (SEC-P3-27): was pg_catalog, public
SET "TimeZone" = 'UTC'
SET lock_timeout = '5s'
AS $$
DECLARE
  v_month   date;
  v_from    timestamptz;
  v_to      timestamptz;
  v_name    text;
  v_created integer := 0;
BEGIN
  IF p_months_ahead NOT BETWEEN 0 AND 12 THEN
    RAISE EXCEPTION 'months_ahead must be between 0 and 12';
  END IF;
  -- amended 2026-11-12 (SEC-P3-27 item 2): built-ins qualified, explicit casts so no better-matching overload can exist
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('audit:partitions')::bigint);   -- one creator at a time
  FOR i IN 0..p_months_ahead LOOP
    v_month := (pg_catalog.date_trunc('month', pg_catalog.now()) + pg_catalog.make_interval(months => i))::date;
    v_from  := v_month::timestamp AT TIME ZONE 'UTC';                  -- AT TIME ZONE parses to pg_catalog.timezone()
    v_to    := (v_month + interval '1 month')::timestamp AT TIME ZONE 'UTC';
    v_name  := 'audit_entries_' || pg_catalog.to_char(v_month::timestamp, 'YYYY_MM');
    IF pg_catalog.to_regclass('public.' || v_name) IS NULL THEN
      -- create detached, then ATTACH (SHARE UPDATE EXCLUSIVE on the parent instead of ACCESS EXCLUSIVE)
      EXECUTE pg_catalog.format('CREATE TABLE public.%I (LIKE public.audit_entries INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING GENERATED)', v_name);
      EXECUTE pg_catalog.format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (occurred_at >= %L AND occurred_at < %L)',
                     v_name, 'ck_' || v_name || '__range', v_from, v_to);
      EXECUTE pg_catalog.format('ALTER TABLE public.audit_entries ATTACH PARTITION public.%I FOR VALUES FROM (%L) TO (%L)',
                     v_name, v_from, v_to);                            -- parent indexes and row trigger are created/attached
      EXECUTE pg_catalog.format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION platform.audit_forbid_mutation()',
                     'trg_' || v_name || '__no_truncate', v_name);
      EXECUTE pg_catalog.format('REVOKE ALL ON public.%I FROM PUBLIC', v_name);
      INSERT INTO public.audit_partitions (id, partition_name, range_start, range_end, created_by, updated_by)
      VALUES (pg_catalog.uuidv7(), v_name, v_from, v_to,
              '00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000001')
      ON CONFLICT (partition_name) DO NOTHING;
      v_created := v_created + 1;
    END IF;
  END LOOP;
  RETURN v_created;
END $$;
ALTER FUNCTION platform.ensure_audit_partitions(integer) OWNER TO platform_audit_owner;   -- amended 2026-11-12 (SEC-P3-03): was platform_migrator
REVOKE ALL ON FUNCTION platform.ensure_audit_partitions(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.ensure_audit_partitions(integer) TO platform_app;
```

Amended 2026-11-12 (SEC-P3-03):
- **The only DDL path at runtime.** The function is owned by `platform_audit_owner` and is the only code path that runs DDL on audit objects outside the bootstrap lane. Inside it, `current_user = 'platform_audit_owner'`, so the `audit_ddl_guard` (§5.2) admits its `CREATE TABLE`, `ADD CONSTRAINT`, `ATTACH PARTITION`, `CREATE TRIGGER` and `REVOKE`, and the new partitions are owned by `platform_audit_owner`.
- **Who calls it.** `platform_app` keeps `EXECUTE` so that the daily `audit-maintenance` worker job can call it. The function only creates future months and takes no free-form input (`p_months_ahead` is bounded to 0–12), so `EXECUTE` gives no way to alter existing audit objects.
- **First call.** The first call moves from "the initial migration" to `prisma/bootstrap/10-audit.sql` (§4.4).

Amended 2026-11-12 (SEC-P3-27 items 1, 2 and 7): **the call path resolves functions and operators in `pg_catalog` only.**
- **Three layers.**
  - The function declares `SET search_path = pg_catalog, pg_temp`, and PostgreSQL never searches `pg_temp` for functions or operators.
  - Every built-in it calls is `pg_catalog.`-qualified, with casts that make the signature exact: `hashtext(…)::bigint` matches `pg_advisory_xact_lock(bigint)`, and `v_month::timestamp` matches `to_char(timestamp, text)`.
  - The operators (`||`, `+`, `>=`, `<`, `BETWEEN`) and casts, including those inside the `EXECUTE` strings and the range CHECK they create, resolve through the fixed path, so in `pg_catalog` only. `AT TIME ZONE` is parsed directly into `pg_catalog.timezone()`.
- **Effect.** A `public.pg_advisory_xact_lock(integer)` or `public.to_char(date, text)` planted by the migrator, which keeps `CREATE` on `public`, is **never called**, however well it matches.
- **No other code in the call path.** The function calls no migrator-owned function. The only non-catalog routine in its path is the trigger function `platform.audit_forbid_mutation()`, which is owned by `platform_audit_owner` and pinned the same way.
- **Consequence for ADR-0007.** With this, the §4.4 schema owner and the OID-matched guard (§5.2), the migrator credential can no longer reach code that runs as `platform_audit_owner`. That is what lets ADR-0007 amendment 7 item 1 state that "tampering needs the cluster superuser". SEC-TC-61 verifies it.

The initial migration calls `SELECT platform.ensure_audit_partitions(3);` (current month + 3, REQ-AUDIT-017). The daily `audit-maintenance` job calls it idempotently; ~~readiness reports the audit component degraded when fewer than 2 future partitions exist (`SELECT count(*) FROM audit_partitions WHERE range_start > now()`)~~ *(readiness rule replaced below, 2026-11-13)*, and the job alerts on any failure. The ATTACH of an empty table with a matching CHECK skips the validation scan.

#### Amendment (2026-11-13, PR12-SEC-02 MEDIUM items 2–4; D-SEC-PR12-01; SPK-08 §8 item 6; D-ARCH-076) — identity test and readiness contiguity. Binding on TASK-021 (function and `apps/api/src/platform/health/checks/audit-partitions.ts`), TASK-033 (tests).

- **Why.** `IF pg_catalog.to_regclass('public.' || v_name) IS NULL` is a *name* test: any `pg_class` relation of that name (an index on the migrator's own table, a view, a sequence, a matview, a composite type) made the function **skip the month without error**; an enum or domain made `CREATE TABLE` fail loudly (42710) instead. With `ensure(3)` keeping current + 3 months and one month X missing, the strictly-future count is 2 while X is +3, +2 or +1 and 3 once X is current, so the "degraded when < 2" rule **never fired**; the first symptom would have been `23514` "no partition of relation audit_entries found for row" on every audited transaction at 00:00 UTC of X — platform-wide failure of the booking/payment write path (the audit write is inside the business transaction, §5.4), plantable years ahead. Integrity holds (the failure is closed); availability does not. SEC-P3-37 item 6 ("readiness catches it") is superseded.
- **Item 2 — identity test that fails loudly.** The loop body replaces the `to_regclass` test with:
  ```sql
  SELECT c.relkind, c.relowner, i.inhparent, i.inhdetachpending
    INTO v_kind, v_relowner, v_parent, v_pending
    FROM pg_catalog.pg_class c LEFT JOIN pg_catalog.pg_inherits i ON i.inhrelid = c.oid
   WHERE c.relnamespace = 'public'::pg_catalog.regnamespace AND c.relname = v_name;
  IF FOUND THEN
    IF v_kind <> 'r' OR v_parent IS DISTINCT FROM 'public.audit_entries'::pg_catalog.regclass
       OR v_relowner <> pg_catalog.to_regrole('platform_audit_owner')::oid OR v_pending THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUDIT_PARTITION_NAME_TAKEN', DETAIL = v_name;
    END IF;
    INSERT INTO public.audit_partitions (…) VALUES (…) ON CONFLICT (partition_name) DO NOTHING;   -- registry row for a verified partition, whoever created it
    CONTINUE;
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_type t WHERE t.typnamespace = 'public'::pg_catalog.regnamespace AND t.typname = v_name) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUDIT_PARTITION_NAME_TAKEN', DETAIL = v_name;
  END IF;
  -- … create detached, CHECK, ATTACH, TRUNCATE trigger (ENABLE ALWAYS, §5.2), REVOKE, registry row, as above
  ```
  The whole call raises; nothing is skipped. The daily job already alerts on any failure. The function also verifies the existing partition's bounds (`pg_catalog.pg_get_expr(c.relpartbound, c.oid)` equals the expected `FOR VALUES FROM … TO …`) and raises `AUDIT_PARTITION_BOUNDS_MISMATCH` otherwise.
- **Item 3 — readiness is contiguity from the catalogue, not a count from `audit_partitions`.** `audit_partitions` is a table `platform_app` can `INSERT`/`UPDATE`; the catalogue is not. The `audit_partitions` readiness check (`apps/api/src/platform/health/checks/audit-partitions.ts`, TASK-021) asserts, for **each** month m in [current, current + 2], that an attached, non-pending (`inhdetachpending = false`) partition of `public.audit_entries` named `audit_entries_<YYYY_MM>`, `relkind = 'r'`, owned by `platform_audit_owner`, exists (`pg_inherits ⋈ pg_class`; `platform_app` reads the catalogue). Any missing month → `unavailable`. **In addition**, any `pg_class` row in `public` whose `relname ~ '^audit_entries_[0-9]{4}_[0-9]{2}$'` is not such a partition, or any `pg_type` row with `typrelid = 0` of that name, → `unavailable` **plus security event `audit_partition_squatted`** (with the object kind and name; never the owner's credential), whatever the month — so a far-future squat is caught on the day it is planted, not when the month starts. The check runs at start-up and on the slow readiness interval; the response body carries the component state only.
- **Item 4 — coverage.** The cases are listed in §5.2 "What it does not cover" and are C14 probes. **Tests (TASK-033; PR12-SEC-02 verification):** as the migrator, `CREATE INDEX audit_entries_<now + 5 months> ON public.probe(id)` → guard message (42501); with the guard disabled in a variant (superuser `ALTER EVENT TRIGGER … DISABLE` inside a rolled-back transaction): (i) `SELECT platform.ensure_audit_partitions(6)` raises `AUDIT_PARTITION_NAME_TAKEN` (repeat for `CREATE TYPE … AS ENUM` and `CREATE VIEW`), (ii) the readiness query returns `unavailable` and the event fires; unit test of the readiness arithmetic: one missing month at +1 or +2 → `unavailable`; `DETACH PARTITION … CONCURRENTLY` through `execute()` (outside a transaction) leaves `inhdetachpending = true` → `unavailable` (PR12-SEC-01 item d residue, documented).

### 5.4 Chaining procedure (what the application does inside the business transaction)

Executed by `packages/audit` as the **last** database work before `COMMIT`, after the business statements and the outbox insert, so the per-stream lock is held for 1–3 ms. The transaction isolation level is `READ COMMITTED` (mandatory: each statement must see the latest committed stream head after the lock is granted; under `REPEATABLE READ` the snapshot would predate the lock and chain to a stale head).

```sql
-- 1. Tokenise PER/SPER values (one statement per value; vault dedupes per subject/field/value)
-- amended 2026-11-12 (SEC-P3-08 item 1): key_id → ciphertext_key_id, + value_hmac_key_id; ciphertext AAD = (audit_pii_vault, ciphertext, $token, ciphertext_key_id)
INSERT INTO public.audit_pii_vault (token, subject_id, classification, entity_name, field, value_hmac, value_hmac_key_id,
                                    ciphertext, ciphertext_key_id, created_at, updated_at, created_by, updated_by, version)
VALUES ($token, $subject_id, $classification, $entity_name, $field, $value_hmac, $value_hmac_key_id,
        $ciphertext, $ciphertext_key_id, now(), now(), $actor, $actor, 1)
ON CONFLICT (subject_id, entity_name, field, value_hmac) DO NOTHING;
SELECT token FROM public.audit_pii_vault
 WHERE subject_id = $subject_id AND entity_name = $entity_name AND field = $field AND value_hmac = $value_hmac;

-- 2. Serialise writers of this stream (ADR-0007); SYSTEM entries use shard hash(correlation_id) mod 16
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('audit:' || $stream_id::text)::bigint);   -- qualified 2026-11-12 (SEC-P3-27, defence in depth; §4.4 amendment item 5)

-- 3. Read (or create) the head and the database clock
INSERT INTO public.audit_stream_heads (id, stream_id, entry_count, head_hash, last_verified_seq, last_verified_hash,
                                       created_at, updated_at, created_by, updated_by, version)
VALUES (uuidv7(), $stream_id, 0, '\x' || repeat('00', 32), 0, '\x' || repeat('00', 32), now(), now(), $actor, $actor, 1)
ON CONFLICT (stream_id) DO NOTHING;
SELECT entry_count, head_hash, head_occurred_at, clock_timestamp() AS db_now
  FROM public.audit_stream_heads WHERE stream_id = $stream_id;
```

4. In the application: `stream_seq = entry_count + 1`; `occurred_at = max(db_now, head_occurred_at + 1 µs)` truncated to microseconds (monotonic per stream even if the clock steps back); build the canonical object of every column except `prev_hash`, `entry_hash` and the generated `scope_org_id` (timestamps as `YYYY-MM-DDTHH:MM:SS.ffffffZ`, bytea as lower-case hex, absent values as JSON `null`, `hash_version` included); `entry_hash = SHA-256( UTF-8(JCS(canonical)) ‖ head_hash )` (RFC 8785 via `canonicalize`; first `prev_hash` is 32 zero bytes, DR-A09). `[REDACTED]` markers and `$pii` tokens are part of the hashed content.

```sql
-- 5. Append and advance the head (raw parameterised INSERT from packages/audit)
--    amended 2026-11-12 (SEC-P3-08 item 1): + ip_hash_key_id (now 37 parameters)
INSERT INTO public.audit_entries (id, occurred_at, stream_id, stream_seq, org_id, target_org_id, on_behalf_of_org_id,
       actor_type, user_id, api_key_id, job_name, actor_roles, session_id, ip_token, ip_hash, ip_hash_key_id, ip_coarse,
       user_agent_token, ua_parsed, source_app, correlation_id, action, entity_name, entity_id, outcome, reason_token,
       reauth_proof_id, signature_meaning, http_method, route, old_value, new_value, details, pii_token_count, hash_version,
       prev_hash, entry_hash)
VALUES ($1, $2, … , $37);

UPDATE public.audit_stream_heads
   SET entry_count = $seq, head_entry_id = $id, head_occurred_at = $occurred_at, head_hash = $entry_hash,
       updated_at = now(), updated_by = $actor, version = version + 1
 WHERE stream_id = $stream_id AND entry_count = $seq - 1;      -- exactly 1 row, else abort (cannot happen under the lock)
-- 6. COMMIT releases the advisory lock
```

`FAILED` outcome entries (REQ-AUDIT-010) and best-effort `VIEW` entries run the same procedure in their own short transaction; fail-closed reads (DR-A12) write the `VIEW`/`DOWNLOAD` entry and commit before the response (or pre-signed URL) is released. `hashtext` returns 32 bits, so two streams can share a lock slot; that only adds occasional serialisation, never a chain error (OI-21).

### 5.5 Hourly checkpoint and signed anchor (ADR-0007, amendments 3 and 7)

**Amendment (2026-11-12, SEC-P3-03; ADR-0007 amendment 7).** This section replaces the nightly checkpoint of the first version. What changed:
- the cadence is **hourly**, after every incremental verification (§5.6);
- the symmetric `HMAC-SHA256(AUDIT_CHECKPOINT_KEY, …)` anchor is dropped, together with the key;
- every checkpoint gets one row in `audit_anchors` (§3.4), signed with **ECDSA P-256 / SHA-256** under a private key that only the worker can use, and chained by `anchor_seq` and `prev_anchor_hash`;
- the same record is appended to the **mandatory** external sink `AUDIT_ANCHOR_SINK`;
- `audit_checkpoint_heads` stores deltas (§3.4);
- the head snapshot is taken once and reused, so the digest and the stored rows always describe the same set (the first version re-read `audit_stream_heads` for the `INSERT`, and could store heads newer than the digest).

Why ECDSA P-256 and not Ed25519: not KMS availability (AWS KMS has signed with `ECC_NIST_EDWARDS25519` since 2025-11-07). P-256/SHA-256 is FIPS 186-5 approved and is the one signature algorithm every target verifier already supports without new code or library versions: `openssl dgst -sha256 -verify` for regulators and auditors, WebCrypto `ECDSA` in every browser of the ADR-0026 §11 matrix for an in-browser verifier, Node 24 `crypto.verify`, and every KMS/HSM the platform may move to (Azure Key Vault has no Ed25519). KMS `ECDSA_SHA_256` with `MessageType = RAW` signs the same SHA-256 digest Node signs, so one verifier serves local and M5. ECDSA's signature malleability is harmless here because the verifier compares the sink record with the table record byte for byte (SEC-TC-44). The `algorithm` column is a CHECK-constrained enum so `ED25519` can be added later by extending the CHECK and the verifier (ADR-0007 amendment 8, D-ARCH-029). *Amended 2026-11-12 (SEC-P3-33 item 1): replaces the earlier sentence "AWS KMS offers no Ed25519 signing, and one algorithm for local and M5 keeps a single verifier", which was outdated; the choice stands (security review ruling 2).*

**Keys and configuration (ADR-0018 register).**

| Item | Value |
|---|---|
| Signing key | `AUDIT_ANCHOR_SIGNING_KEY_REF`, worker `audit-maintenance` processor only. Locally a PEM key file (git-ignored, generated by `npm run keys:dev`); at M5 a non-exportable KMS `ECC_NIST_P256` key used through `kms:Sign` (`SigningAlgorithm = ECDSA_SHA_256`, `MessageType = RAW`) |
| Verification keys | `AUDIT_ANCHOR_PUBLIC_KEYS` (`key_id → PEM`), held by the API (`GET /audit/chain/status`), the worker verifier and any third party. Old public keys are kept for as long as anchors signed with them exist |
| Signature | `signature = ECDSA-P256-SHA256(message = anchor_hash)`, DER-encoded. Node `crypto.sign('sha256', anchor_hash, key)` and KMS `Sign` with `RAW` both sign SHA-256(`anchor_hash`), so one verifier checks either (ECDSA signatures are randomised, so the bytes differ between runs). A third party checks with `openssl dgst -sha256 -verify pub.pem -signature sig.der anchor_hash.bin` |
| Sink | `AUDIT_ANCHOR_SINK`, **mandatory in every environment** (the worker refuses to start without it). `file:<path>` (append-only JSON Lines, `fsync` per record) in local, test and CI; at M5 `s3://…` (one object per anchor, `anchors/<anchor_seq 20 digits>.json`, S3 Object Lock compliance mode, worker role `s3:PutObject` only) or `cwlogs://<group>/<stream>` (retention-locked log group, no delete or put-retention permission for any app or CI role). Locking the sink is a G4-production precondition (ADR-0007 amendment 7 item 7) |
| Sink record | One JSON object with every `audit_anchors` column (`bytea` as lower-case hex, `signature` as base64, `created_at` in the hashed text form). *Ratified 2026-11-13 (SPK-08 A-3, PR12-SEC-05 b; D-ARCH-077):* **one line per record = the RFC 8785 (JCS) serialisation** of `{anchor_seq: <JSON number>, checkpoint_entry_id: <lower-case UUID>, created_at: <hashed text form>, heads_digest, prev_anchor_hash, anchor_hash: <lower-case hex>, algorithm, key_id, signature: <base64 of DER>}` followed by `\n`; the verifier compares table and sink **as strings of that line** (byte-exact), never parsed or semantically — Node accepts high-`s` ECDSA signatures, so detection of a malleated `(r, n−s)` rests entirely on this comparison |
| Anchor format (byte layouts), ratified 2026-11-13 (SPK-08 A-2, A-4, A-5; D-ARCH-077) — hash inputs: changing them later breaks every stored anchor | **A-2 `heads_digest`** = SHA-256 over the stream-head snapshot sorted by `stream_id` **ascending by the 16 raw UUID bytes** (= PostgreSQL `uuid` order = lower-case hex order), each item `stream_id (16 B) ‖ be64(entry_count) ‖ head_hash (32 B)`; the empty set digests to SHA-256 of the empty string; duplicate `stream_id`s are a writer error. ADR-0007 am. 6's `(stream_id, head_hash, stream_seq)` wording is superseded by this definition (ADR-0007 am. 9). **A-4 `created_at`** = `clock_timestamp()` read **in the anchor transaction** and rendered by PostgreSQL as `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`; the writer hashes exactly that text and the verifier re-reads it in the same form ("now, truncated to µs" in Node was not implementable, SPK-08 AF-2). **`anchor_hash`** = SHA-256(`be64(anchor_seq)` ‖ UTF-8(`created_at` text) ‖ `heads_digest` ‖ `prev_anchor_hash`) (unchanged). **A-5** signature storage is DER (OpenSSL, Node and KMS `Sign` all produce and verify DER); a WebCrypto verifier first converts DER → IEEE P1363 `r‖s`; TASK-116 parses DER with a **strict** parser (non-minimal integers and long-form lengths rejected). Golden vectors from the SPK-08 prototype move into a `packages/audit` unit test (TASK-116) |

**Procedure (worker `audit-maintenance`, once per hour after the incremental verification; SYSTEM actor; READ COMMITTED; one transaction).**

```sql
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('audit:anchors')::bigint);   -- one anchor writer; held across the signing call (qualified 2026-11-12, SEC-P3-27)
SELECT anchor_seq, anchor_hash FROM public.audit_anchors ORDER BY anchor_seq DESC LIMIT 1;   -- none → seq 0, 32 zero bytes
SELECT stream_id, entry_count, head_hash, head_occurred_at
  FROM public.audit_stream_heads ORDER BY stream_id;                     -- ONE snapshot (single statement), reused below
-- app: heads_digest = SHA-256 over the snapshot sorted by stream_id, each item stream_id(16 B) ‖ be64(entry_count) ‖ head_hash(32 B)
-- app: checkpoint_entry_id = uuidv7(); anchor_seq = prev + 1; created_at = now, truncated to µs
-- app: anchor_hash = SHA-256(be64(anchor_seq) ‖ UTF-8(created_at 'YYYY-MM-DDTHH:MM:SS.ffffffZ') ‖ heads_digest ‖ prev_anchor_hash)
-- app: signature = ECDSA-P256-SHA256(anchor_hash) via the signer (key file / KMS Sign; 2 s timeout, 2 retries) — outside any audit stream lock

-- delta heads: only streams whose entry_count moved since their last captured row (all streams on the first checkpoint)
INSERT INTO public.audit_checkpoint_heads (id, checkpoint_entry_id, stream_id, entry_count, head_hash, head_occurred_at,
                                           created_at, updated_at, created_by, updated_by, version)
SELECT uuidv7(), $checkpoint_entry_id, s.stream_id, s.entry_count, s.head_hash, s.head_occurred_at, now(), now(), $system, $system, 1
  FROM unnest($stream_ids::uuid[], $entry_counts::bigint[], $head_hashes::bytea[], $head_occurred_ats::timestamptz[])
         AS s(stream_id, entry_count, head_hash, head_occurred_at)
  LEFT JOIN LATERAL (SELECT c.entry_count FROM public.audit_checkpoint_heads c
                      WHERE c.stream_id = s.stream_id
                      ORDER BY c.checkpoint_entry_id DESC LIMIT 1) prev ON true      -- ix_audit_checkpoint_heads__stream_checkpoint
 WHERE prev.entry_count IS DISTINCT FROM s.entry_count;                  -- batched 10,000 streams per statement

INSERT INTO public.audit_anchors (anchor_seq, checkpoint_entry_id, created_at, heads_digest, prev_anchor_hash,
                                  anchor_hash, algorithm, key_id, signature)
VALUES ($anchor_seq, $checkpoint_entry_id, $created_at, $heads_digest, $prev_anchor_hash,
        $anchor_hash, 'ECDSA_P256_SHA256', $key_id, $signature);

-- LAST: append the SYSTEM-shard-0 checkpoint entry (procedure §5.4; takes the shard-0 lock for 1–3 ms):
--   id = $checkpoint_entry_id, action 'CREATE', entity_name 'chain_checkpoint', entity_id = $checkpoint_entry_id,
--   new_value = {"heads_digest":"<hex>","stream_count":n,"delta_count":d,"anchor_seq":k,"as_of":"<created_at>"}
COMMIT;
-- after COMMIT: append the anchor record to AUDIT_ANCHOR_SINK (retry with backoff for up to 15 min; idempotent by anchor_seq:
-- the sink reader treats byte-identical duplicates as one record, and a differing duplicate as ANCHOR_MISSING)
```

Design notes:
- **Lock order.** The KMS call happens under the dedicated `audit:anchors` lock, which only the hourly job takes. The shard-0 stream lock is taken last and held for milliseconds, as §5.4 requires, so a slow KMS call never stalls audit writes (`lock_timeout` 2 s).
- **Checkpoint value.** Following §12 OI-07, the value always holds the digest and counts, not the list of heads, whatever the number of streams.
- **No foreign key.** The anchor references the checkpoint entry by `checkpoint_entry_id`; a foreign key to the partitioned `audit_entries` is not possible on `id` alone, so the verifier resolves it.
- **Residual window.** Entries newer than the latest anchor (at most 1 h) can still be rewritten undetected by a cluster superuser who also recomputes the chain before the next checkpoint. Any change to an entry at or before an anchored head is detected by §5.6. ADR-0007 amendment 7 accepts this residual for this run; it closes at M5 with the locked sink.
- **Volume.** 24 anchors per day, plus delta head rows (§10.1).

### 5.6 Verification (hourly incremental, nightly full)

Per stream, keyset batches of 5,000 in `stream_seq` order; the time predicate prunes partitions on incremental runs:

```sql
SELECT id, occurred_at, stream_seq, org_id, target_org_id, on_behalf_of_org_id, actor_type, user_id, api_key_id, job_name,
       actor_roles, session_id, ip_token, ip_hash, ip_hash_key_id, ip_coarse, user_agent_token, ua_parsed, source_app,
       correlation_id, action, entity_name, entity_id, outcome, reason_token, reauth_proof_id, signature_meaning,
       http_method, route, old_value, new_value, details, pii_token_count, hash_version, prev_hash, entry_hash
  FROM public.audit_entries                                               -- + ip_hash_key_id (amended 2026-11-12, SEC-P3-08)
 WHERE stream_id = $stream_id
   AND stream_seq > $after_seq
   AND occurred_at >= $last_verified_occurred_at - interval '5 minutes'   -- omitted on the nightly full run
 ORDER BY stream_seq
 LIMIT 5000;
```

For each row the verifier asserts `stream_seq = expected`, `prev_hash = running_hash`, and recomputes `entry_hash`; it then sets `running_hash = entry_hash`. When caught up, `running_hash` must equal `audit_stream_heads.head_hash` (`HEAD_MISMATCH` otherwise) and the head's `last_verified_*` columns advance. The nightly run covers all 16 SYSTEM shards, the anchors (see the amendment below; every hourly run checks the latest anchor, and the nightly run checks every anchor since the previous nightly run) and global duplicates, partition by partition:

```sql
SELECT entry_hash FROM public.audit_entries_2026_11 GROUP BY entry_hash HAVING count(*) > 1;           -- DUPLICATE_ENTRY_HASH
SELECT stream_id, stream_seq FROM public.audit_entries GROUP BY 1, 2 HAVING count(*) > 1;              -- SEQ_DUPLICATE
```

A cheap SQL pre-check of linkage (no hash recomputation) finds the first break quickly:

```sql
SELECT id, stream_seq FROM (
  SELECT id, stream_seq, prev_hash,
         lag(entry_hash) OVER (ORDER BY stream_seq) AS expected_prev,
         lag(stream_seq) OVER (ORDER BY stream_seq) AS prev_seq
    FROM public.audit_entries WHERE stream_id = $stream_id AND stream_seq > $after_seq) s
 WHERE prev_seq IS NOT NULL AND (prev_hash <> expected_prev OR stream_seq <> prev_seq + 1)
 ORDER BY stream_seq LIMIT 1;
```

Results go to `audit_chain_verifications`; a break emits outbox event `audit.chain_broken`, security log event `audit_chain_broken`, an alert metric and degrades `/health/ready` (REQ-AUDIT-013). Budget: 1M entries in ≤ 5 min (NFR-AUDIT-003) — reading 1M rows in 200 batches plus 1M SHA-256 computations of ≈ 1 kB is well under a minute on the reference host.

#### Amendment (2026-11-12, SEC-P3-03; ADR-0007 amendment 7): anchor verification on every run

Anchor checking is no longer optional or nightly-only. The comparison happens on every hourly run, and the external sink is mandatory (§5.5). The verifier holds **only the public keys** (`AUDIT_ANCHOR_PUBLIC_KEYS`). There is no shared secret, and neither the API nor the verifier can mint an anchor. Every hourly run performs, after the chain walk above and before writing the next checkpoint (§5.5):

| Step | Check | Failure → `failure_kind` / event |
|---|---|---|
| (i) Anchor log integrity | Read the sink records and the `audit_anchors` rows in the range under check: **hourly** from the last anchor verified by the previous run, **nightly** every anchor since the previous nightly run. Require `anchor_seq` dense (+1) with no duplicates and in order, each `prev_anchor_hash` = the previous record's `anchor_hash` (32 zero bytes for seq 1), and the table and sink records byte-identical per `anchor_seq`. The newest table anchor may be missing from the sink only while the writer's sink retry (≤ 15 min) is still running | gap, duplicate, out-of-order record, broken `prev_anchor_hash`, or table/sink disagreement → **`ANCHOR_MISSING`**: run status `FAILED`, ERROR log, security event **`audit_anchor_missing`**, alert metric `audit_anchor_missing_total`, `/health/ready` degraded |
| (ii) Signature | For every new anchor: recompute `anchor_hash` from (`anchor_seq`, `created_at`, `heads_digest`, `prev_anchor_hash`), compare it with the stored value, then verify `signature` with the public key for `key_id` | mismatch, unknown `key_id` or invalid signature → **`CHECKPOINT_SIGNATURE_INVALID`**, security event `audit_chain_broken`, readiness degraded |
| (iii) Anchored heads | For the latest anchor: (a) reconstruct its full head set from `audit_checkpoint_heads` (the latest row per stream at or before that checkpoint, §3.4), recompute `heads_digest` and compare it with the anchor and with the checkpoint entry's `new_value.heads_digest`; (b) for **every stream**, fetch the entry at the anchored `(stream_id, stream_seq = entry_count)` using `head_occurred_at` for partition pruning (one PK-range probe per stream) and require its `entry_hash` = the anchored `head_hash`. The incremental chain walk above has already recomputed every entry after the previous run's position; the nightly full walk recomputes all entries, so content changes behind an unchanged stored hash are caught within 24 h and can never be legitimised | any difference → **`CHECKPOINT_HEAD_MISMATCH`** with `first_broken_stream_id`, existing security event **`audit_chain_broken`**, readiness degraded |

How the review's tamper case maps onto these checks (SEC-TC-44). A superuser alters an entry older than the last anchor and recomputes the chain, the stream heads and `audit_checkpoint_heads`:
- If the attacker also rewrites the anchor's `heads_digest`, the recomputed `anchor_hash` no longer verifies under the public key: `CHECKPOINT_SIGNATURE_INVALID`.
- If the attacker leaves the anchor untouched, step (iii) fails: `CHECKPOINT_HEAD_MISMATCH`.
- If the attacker deletes or reorders an anchor row, step (i) fails against the sink: `ANCHOR_MISSING`.

*Amended 2026-11-13 (SPK-08 A-1, A-6, A-7, AF-9, AF-12; PR12-SEC-05 a, c, d, f; D-ARCH-077) — verifier semantics, binding on TASK-116:*
- **Qualifier (AF-9/AF-12, PR12-SEC-05 a).** Checking only the latest anchor in (iii) is sound **together with a full walk from seq 1 in the same run (nightly)**. The **hourly** run is incremental (`stream_seq > last_verified_*`) and detects changes to anchored head rows; a rewrite **behind** an anchored head that leaves the head row intact passes the hourly run and is detected only by the nightly full walk (`PREV_HASH_MISMATCH` / `HASH_MISMATCH`, ≤ 24 h). The nightly run starts every stream at seq 1 from `ZERO32` and **ignores** `last_verified_*` (a value `platform_app` can update). Step (iii) is never skipped on hourly runs (the chain walk alone is fooled by every SEC-TC-44 tamper). TASK-116 adds SEC-TC-44 variant (d) "behind-head rewrite, head row intact" (hourly: no failure, documented; nightly: failure) plus the `algorithm ≠ ECDSA_P256_SHA256` and malleated-signature rows.
- **A-1 precedence.** The verifier runs steps (i)–(iii) **to completion** and emits the security event of **every** failing step. `failure_kind` records the most specific failure by precedence `CHECKPOINT_SIGNATURE_INVALID` > `CHECKPOINT_HEAD_MISMATCH` > `ANCHOR_MISSING` > chain kinds; `audit_chain_verifications` gains `failure_kinds text[]` (every kind observed) and a details column; a table/sink **content** mismatch (proof of tampering, not an outage) carries the distinct detail code `ANCHOR_SINK_MISMATCH` under `ANCHOR_MISSING`; `audit_anchor_missing` pages at the same severity as `audit_chain_broken`.
- **A-6 time window.** Step (i) tolerates an absent sink record only for the newest table anchor whose signed `created_at` lies within **[verifier now − 15 min, now + 2 min]** (the writer's sink retry window; the verifier cannot observe the retry itself); a future-dated anchor beyond + 2 min is a failure.
- **A-7.** Step (iii) runs on the latest anchor that passed (i) and (ii); if none in the range passed, (iii) is skipped and the run is already `FAILED`.
- **Readiness is secondary (PR12-SEC-05 f).** The `audit_chain` readiness check reads `audit_chain_verifications`, which `platform_app` can write; the security event emitted at failure time is the primary signal.
- **M5 sink (PR12-SEC-05 e, platform-architect, COND-G4-PROD).** S3 `PutObject` under Object Lock still creates new versions of an existing key: the writer uses a conditional put (`If-None-Match: *`) and the verifier treats more than one version per anchor key as a differing duplicate; an in-browser verifier takes public keys from an out-of-band published set, never from the API it verifies; key rotation records each `key_id`'s `anchor_seq` range in the sink so a retired, later-compromised key cannot sign verifiable new anchors.

The cluster superuser therefore cannot rewrite anything older than the latest anchor without detection within the nightly bound. The run records `anchor_seq_from/_to` in `audit_chain_verifications`. `GET /audit/chain/status` reports the latest run, the latest verified `anchor_seq`, its `created_at` and its `key_id`. An anchor older than 2 h (the job stopped) also degrades readiness.

Budget for step (iii)(b): one index probe per stream, pruned to one partition. That is about 125 k probes per hour in Y1 and about 1.7 M at Y5 (§10.1), roughly 10 s and 2 min on the reference host. If the measured cost at M5 exceeds 5 min, the tuning lever is: probe only the streams that changed since the previous anchor, plus a rotating 1/24 slice of the rest, while the nightly run checks all streams. That weakens the hourly bound for idle streams to 24 h, so it requires a security-analyst re-review before adoption.

### 5.7 PII vault DDL

```sql
CREATE TABLE public.data_subjects (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL, updated_by uuid NOT NULL, version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  kind       text NOT NULL CONSTRAINT ck_data_subjects__kind CHECK (kind IN ('USER','CONTACT')),
  ref_id     uuid NOT NULL,
  erased_at  timestamptz,
  CONSTRAINT ux_data_subjects__kind_ref UNIQUE (kind, ref_id)
);

CREATE TABLE public.audit_pii_vault (
  token          uuid PRIMARY KEY DEFAULT uuidv7(),
  created_at     timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL, updated_by uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1 CONSTRAINT ck_audit_pii_vault__version CHECK (version = 1),
  subject_id     uuid NOT NULL CONSTRAINT fk_audit_pii_vault__subject REFERENCES public.data_subjects (id),
  classification text NOT NULL CONSTRAINT ck_audit_pii_vault__classification CHECK (classification IN ('PERSONAL','SENSITIVE_PERSONAL')),
  entity_name    text NOT NULL CONSTRAINT ck_audit_pii_vault__entity CHECK (entity_name ~ '^[a-z][a-z0-9_]*$'),
  field          text NOT NULL CONSTRAINT ck_audit_pii_vault__field CHECK (field ~ '^[a-z][a-z0-9_]*$'),
  value_hmac     bytea NOT NULL CONSTRAINT ck_audit_pii_vault__hmac CHECK (octet_length(value_hmac) = 32),
  value_hmac_key_id text NOT NULL,                                                          -- amended 2026-11-12 (SEC-P3-08 item 1)
  ciphertext     bytea NOT NULL CONSTRAINT ck_audit_pii_vault__ct CHECK (octet_length(ciphertext) BETWEEN 29 AND 65536),  -- 12 B nonce + ≥1 B + 16 B tag
  ciphertext_key_id text NOT NULL,                                                          -- amended 2026-11-12 (SEC-P3-08 item 1): was key_id; AAD = (audit_pii_vault, ciphertext, token, ciphertext_key_id)
  CONSTRAINT ux_audit_pii_vault__subject_field_value UNIQUE (subject_id, entity_name, field, value_hmac)
);

CREATE FUNCTION platform.audit_vault_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp                         -- amended 2026-11-12 (SEC-P3-27): was unset (invoker's path)
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_user = 'platform_erasure'
     AND pg_catalog.current_setting('app.erasure_request_id', true) ~* '^[0-9a-f-]{36}$' THEN
    RETURN OLD;                                               -- M4/M5 erasure job only
  END IF;
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = pg_catalog.format('AUDIT_VAULT_IMMUTABLE: %s', TG_OP);
END $$;
CREATE TRIGGER trg_audit_pii_vault__guard BEFORE UPDATE OR DELETE ON public.audit_pii_vault
  FOR EACH ROW EXECUTE FUNCTION platform.audit_vault_guard();
CREATE TRIGGER trg_audit_pii_vault__no_truncate BEFORE TRUNCATE ON public.audit_pii_vault
  FOR EACH STATEMENT EXECUTE FUNCTION platform.audit_forbid_mutation();
-- amended 2026-11-12 (SEC-P3-03): bootstrap lane, owner platform_audit_owner
ALTER TABLE public.data_subjects   OWNER TO platform_audit_owner;
ALTER TABLE public.audit_pii_vault OWNER TO platform_audit_owner;
ALTER FUNCTION platform.audit_vault_guard() OWNER TO platform_audit_owner;
```

Erasure (M4/M5, A-045): `DELETE FROM audit_pii_vault WHERE subject_id = $1` by `platform_erasure`, then `data_subjects.erased_at = now()`; the viewer renders `[ERASED]` for tokens without a vault row. Because the chain hashes tokens, never values, no entry hash changes and archived partitions contain no personal data. Values classified `SECRET` never reach the vault (`[REDACTED]`, REQ-AUDIT-008).


---

## 6. Outbox, idempotency, saga, number sequences; transactions and consistency

### 6.1 Outbox (ADR-0004, REQ-PLAT-016/017)

```sql
CREATE TABLE public.outbox_events (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  created_at     timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL, updated_by uuid NOT NULL, version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  type           text NOT NULL CONSTRAINT ck_outbox_events__type CHECK (type ~ '^[a-z_]+\.[a-z_]+$'),
  aggregate_type text NOT NULL,
  aggregate_id   uuid NOT NULL,
  org_id         uuid,
  actor_id       uuid NOT NULL,
  payload        jsonb NOT NULL,
  correlation_id text NOT NULL,
  trace_context  text,
  published_at   timestamptz,
  attempts       integer NOT NULL DEFAULT 0,
  last_error     text CONSTRAINT ck_outbox_events__last_error CHECK (char_length(last_error) <= 500)
);
CREATE INDEX ix_outbox_events__unpublished ON public.outbox_events (created_at, id) WHERE published_at IS NULL;
CREATE INDEX ix_outbox_events__published_at ON public.outbox_events (published_at) WHERE published_at IS NOT NULL;
ALTER TABLE public.outbox_events SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
```

Relay (worker `outbox-relay`, every 500 ms, batches of 100):

```sql
BEGIN;
SELECT id, type, aggregate_type, aggregate_id, org_id, actor_id, payload, correlation_id, trace_context
  FROM public.outbox_events
 WHERE published_at IS NULL
 ORDER BY created_at, id
 LIMIT 100
 FOR UPDATE SKIP LOCKED;
-- enqueue each to BullMQ with jobId = id (dedupes a replay after a crash, EC-A39)
UPDATE public.outbox_events SET published_at = now(), attempts = attempts + 1, updated_at = now(), updated_by = $system, version = version + 1
 WHERE id = ANY($published_ids);
COMMIT;
```

Purge (housekeeping, daily): `DELETE FROM public.outbox_events WHERE id IN (SELECT id FROM public.outbox_events WHERE published_at < now() - interval '7 days' ORDER BY published_at LIMIT 5000)` repeated until 0 rows. Consumers record `processed_events (consumer, event_id)` in their own business transaction with `INSERT … ON CONFLICT DO NOTHING`; a conflict means the event was already handled (REQ-PLAT-017).

**Amendment (2026-11-12, SEC-P3-12; ADR-0013 amendment).** The relay reads the columns above, but the BullMQ job it enqueues carries only `{v: 2, kind: 'outbox_event', id: <outbox_events.id>, correlation_id, trace_context}`. It carries no `org_id`, no `actor_id` and no `payload`. The consumer calls `platform.job_context('outbox_event', id)` (§4.5), which reads `org_id`/`actor_id` from this SYSTEM row, the authoritative source. It then opens `withTenantTx` with them and reads the event `payload` from the row inside that transaction. The relay's `SELECT` list therefore needs only `id, correlation_id, trace_context`. Rows are purged 7 days after publish, so a job delivered later than that ends as `JOB_CONTEXT_NOT_FOUND` (non-retryable). This cannot happen in practice, because BullMQ retries finish within minutes.

### 6.2 Idempotency keys (REQ-API-009..011, DR-A20)

```sql
CREATE TABLE public.idempotency_keys (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  created_at       timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL, updated_by uuid NOT NULL, version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  scope_hash       bytea NOT NULL CONSTRAINT ck_idempotency_keys__scope_hash CHECK (octet_length(scope_hash) = 32),
  scope_org_id     uuid,
  actor_id         uuid,
  method           text NOT NULL,
  path             text NOT NULL,
  idem_key         text NOT NULL CONSTRAINT ck_idempotency_keys__key CHECK (idem_key ~ '^[\x21-\x7E]{1,255}$'),
  fingerprint      bytea NOT NULL CONSTRAINT ck_idempotency_keys__fingerprint CHECK (octet_length(fingerprint) = 32),
  status           text NOT NULL CONSTRAINT ck_idempotency_keys__status CHECK (status IN ('IN_PROGRESS','COMPLETED')),
  lease_until      timestamptz NOT NULL,
  response_status  smallint,
  response_headers jsonb,
  response_body    bytea,                                   -- amended 2026-11-12 (SEC-P3-08/-10): AES-256-GCM of the JSON body (was jsonb in clear)
  response_body_key_id text,                                -- AAD = (idempotency_keys, response_body, hex(scope_hash), response_body_key_id)
  expires_at       timestamptz NOT NULL,
  CONSTRAINT ux_idempotency_keys__scope_hash UNIQUE (scope_hash),
  CONSTRAINT ck_idempotency_keys__body_key CHECK ((response_body IS NULL) = (response_body_key_id IS NULL))
);
CREATE INDEX ix_idempotency_keys__expires_at ON public.idempotency_keys (expires_at);
```

Protocol:

1. **Claim** in its own autocommit statement (so a concurrent duplicate sees it):
   `INSERT INTO idempotency_keys (…, status, lease_until, expires_at) VALUES (…, 'IN_PROGRESS', now() + interval '30 seconds', now() + interval '24 hours') ON CONFLICT (scope_hash) DO NOTHING RETURNING id;`
2. **No row returned** ⇒ `SELECT status, fingerprint, lease_until, response_* FROM idempotency_keys WHERE scope_hash = $1`:
   expired (`expires_at < now()`) ⇒ delete it and retry the claim (key is new after 24 h); different fingerprint ⇒ 422 `IDEMPOTENCY_KEY_REUSED`; `COMPLETED` ⇒ replay stored status/headers/body with `Idempotent-Replayed: true` (no business action, audit entry or outbox event); `IN_PROGRESS` with a live lease ⇒ 409 `IDEMPOTENCY_IN_PROGRESS` + `Retry-After: 1`; `IN_PROGRESS` with an expired lease (crashed worker) ⇒ take over with `UPDATE … SET lease_until = now() + 30 s WHERE scope_hash = $1 AND lease_until < now()`.
3. **Complete inside the business transaction**: `UPDATE idempotency_keys SET status = 'COMPLETED', response_status = $s, response_headers = $h, response_body = $b, … WHERE id = $claim_id;` — atomic with the change, its audit entry and its outbox event.
4. **5xx or 429** ⇒ `DELETE FROM idempotency_keys WHERE id = $claim_id` so the retry re-executes (EC-A30). 4xx outcomes produced inside the business transaction are recorded in a separate short transaction after rollback.
5. **Purge**: `DELETE … WHERE expires_at < now()` in batches of 5,000 (housekeeping).

### 6.3 Saga tables (ADR-0014, DR-B03/B04, REQ-BOOK-020..024, REQ-PAY-018)

```sql
CREATE TABLE public.saga_executions (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  created_at      timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL, updated_by uuid NOT NULL, version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  org_id          uuid NOT NULL REFERENCES public.organisations (id),
  order_id        uuid NOT NULL REFERENCES public.orders (id),
  kind            text NOT NULL CONSTRAINT ck_saga_executions__kind CHECK (kind IN ('BOOKING','CANCELLATION')),
  shipment_id     uuid REFERENCES public.shipments (id),          -- CANCELLATION sagas
  cancellation_id uuid,
  status          text NOT NULL CONSTRAINT ck_saga_executions__status CHECK (status IN
                    ('PENDING','RUNNING','COMPENSATING','COMPLETED','PARTIALLY_COMPLETED','COMPENSATED','FAILED','NEEDS_REVIEW')),
  current_step    text,
  deadline_at     timestamptz NOT NULL,                              -- start + 30 min (REQ-BOOK-023)
  next_run_at     timestamptz,
  attempts        integer NOT NULL DEFAULT 0,
  last_error_code text,
  correlation_id  text NOT NULL,
  started_at      timestamptz, finished_at timestamptz,
  CONSTRAINT ck_saga_executions__cancellation CHECK (kind <> 'CANCELLATION' OR (shipment_id IS NOT NULL AND cancellation_id IS NOT NULL))
);
CREATE UNIQUE INDEX ux_saga_executions__order_booking ON public.saga_executions (order_id) WHERE kind = 'BOOKING';
CREATE UNIQUE INDEX ux_saga_executions__cancellation  ON public.saga_executions (cancellation_id) WHERE kind = 'CANCELLATION';
CREATE INDEX ix_saga_executions__org_order ON public.saga_executions (org_id, order_id);
CREATE INDEX ix_saga_executions__active_deadline ON public.saga_executions (deadline_at)
  WHERE status IN ('PENDING','RUNNING','COMPENSATING');

CREATE TABLE public.saga_steps (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  created_at       timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL, updated_by uuid NOT NULL, version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  org_id           uuid NOT NULL REFERENCES public.organisations (id),
  saga_id          uuid NOT NULL REFERENCES public.saga_executions (id),
  shipment_id      uuid REFERENCES public.shipments (id),          -- per-shipment steps
  step             text NOT NULL CONSTRAINT ck_saga_steps__step CHECK (step IN (
                     'AUTHORISE_PAYMENT','CREATE_CARRIER_SHIPMENT','CAPTURE_PAYMENT','GENERATE_DOCUMENTS',
                     'SCHEDULE_PICKUP','NOTIFY','VOID_AUTHORISATION','CANCEL_CARRIER_SHIPMENT','CANCEL_PICKUP',
                     'VOID_LABEL','REFUND_PAYMENT')),
  status           text NOT NULL CONSTRAINT ck_saga_steps__status CHECK (status IN (
                     'PENDING','RUNNING','SUCCEEDED','FAILED_RETRYABLE','FAILED_PERMANENT','AMBIGUOUS','COMPENSATED','SKIPPED')),
  attempts         smallint NOT NULL DEFAULT 0 CONSTRAINT ck_saga_steps__attempts CHECK (attempts BETWEEN 0 AND 10),
  idempotency_key  text NOT NULL,                                   -- '<saga_id>:<step>:<shipment_id|->'
  client_reference text,                                           -- persisted BEFORE the first carrier call (REQ-BOOK-021)
  outcome          jsonb,                                          -- refs only: carrier shipment ref, tracking numbers, gateway ids
  error_code       text,
  next_attempt_at  timestamptz,
  started_at       timestamptz, finished_at timestamptz,
  CONSTRAINT ux_saga_steps__idempotency_key UNIQUE (idempotency_key)
);
CREATE UNIQUE INDEX ux_saga_steps__saga_step_shipment ON public.saga_steps (saga_id, step, shipment_id) NULLS NOT DISTINCT;
CREATE INDEX ix_saga_steps__org_saga ON public.saga_steps (org_id, saga_id);
CREATE INDEX ix_saga_steps__next_attempt ON public.saga_steps (next_attempt_at) WHERE status = 'FAILED_RETRYABLE';
```

Each step transition is a tenant-scoped transaction: `UPDATE saga_steps SET status = …, attempts = attempts + 1, version = version + 1 WHERE id = $id AND version = $v` together with the shipment/payment state change, the transition history row, the audit entry and the next outbox event (DR-B04 G4). `CREATE_CARRIER_SHIPMENT` writes `client_reference = shipment.id` and commits **before** the carrier call; an `AMBIGUOUS` result on a carrier without idempotent create is never retried automatically (G2, REQ-BOOK-023). The sweeper finds overdue sagas and orphan payments through `saga_due_candidates` and `payment_sweeper_candidates` (§4.5, backed by `ix_saga_executions__active_deadline` and AP-PAY-04/05), then repairs each in its org's tenant scope.

**Amendment (2026-11-12, SEC-P3-12; ADR-0013 amendment).** Saga step jobs carry `{v: 2, kind: 'saga', id: <saga_executions.id>, correlation_id, trace_context}`. The step is part of the deterministic `jobId` (`booking:<saga_id>:<step>`), not of the payload. The processor resolves `org_id` and the initiating actor through `platform.job_context('saga', id)`, which reads `saga_executions.org_id` and `created_by`. The sweeper and candidate functions return `(saga_id, org_id)`; the scheduler uses only `saga_id` to enqueue, and the step processor never trusts the `org_id` that the candidate listing returned. Both the `saga_executions` and the `saga_steps` row are then read under that tenant's RLS, so a forged saga id from another organisation can only run in that organisation's own context.

### 6.4 Number sequences (DR-A24, DR-B22, REQ-DATA-015)

```sql
CREATE TABLE public.number_sequences (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  created_at         timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL, updated_by uuid NOT NULL, version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  scope              text NOT NULL CONSTRAINT ck_number_sequences__scope CHECK (scope IN ('ORDER','INVOICE','CREDIT_NOTE')),
  country            char(2) NOT NULL REFERENCES public.countries (code),
  next_value         bigint NOT NULL DEFAULT 1 CONSTRAINT ck_number_sequences__range CHECK (next_value BETWEEN 1 AND 100000000),
  allocation_enabled boolean NOT NULL DEFAULT true,
  CONSTRAINT ux_number_sequences__scope_country UNIQUE (scope, country)
);
```

Allocation (exact statement; inside the checkout transaction, as its last business statement so the row lock is held only until commit):

```sql
UPDATE number_sequences SET next_value = next_value + 1 WHERE scope = $1 AND country = $2 RETURNING next_value
```

`next_value` always means "next free number", so the allocated number is the returned value minus 1. The service additionally requires `allocation_enabled` (checked when the row is cached; `INVOICE`/`CREDIT_NOTE` rows are seeded with `false` until M2) and treats 0 rows as a configuration error (missing sequence row: 500 `INTERNAL_ERROR` plus an alert). The row lock serialises concurrent checkouts of one origin country for the remaining milliseconds of their transactions, which yields unique, increasing numbers; a rolled-back checkout leaves a gap (permitted). 100 parallel allocations yield 100 distinct numbers (REQ-DATA-015 test). `CHECK (next_value <= 100000000)` makes allocation fail loudly at the end of the 8-digit space instead of producing a 9-digit body.

Format: `<country>-<8-digit zero-padded n><check>` where `check` is the **Luhn mod 10** digit computed over the 8 digits (rightmost payload digit doubled first). Example: `n = 1234` → payload `00001234` → check digit `4` → `US-000012344`. The public lookup validates the check digit before any query (EC-A42). The country prefix is not covered by Luhn (it is a fixed alphabet validated against `countries`); uniqueness is guaranteed by `ux_orders__order_number` regardless.

### 6.5 Transactions, isolation and consistency rules

| Rule | Detail | Source |
|---|---|---|
| T1 One transaction per request | `withTenantTx` wraps execute + outbox insert + idempotency completion + audit entry (DR-A08). Long work (carrier calls, PDF rendering) never runs inside a database transaction. | ADR-0004, REQ-AUDIT-004 |
| T2 Isolation | `READ COMMITTED` everywhere (required by the audit chain, §5.4). Concurrency is controlled by optimistic `version` checks, unique constraints, conditional updates (`… WHERE status = 'X'`), `SELECT … FOR UPDATE` on the few rows that guard counts (owner count, address-book cap, saved-method cap) and the sequence row lock. `SERIALIZABLE` is not used: retries of serialisation failures would re-run the audit append. | REQ-RLS-011, DR-B20 |
| T3 Aggregate boundary | A transaction changes one aggregate (§1.3) plus outbox/audit/idempotency rows. Cross-aggregate effects (order → payment → shipment → documents → pickup → notification) travel as outbox events and saga steps. Exception: the guest claim updates the four quote tables, which are one aggregate. | DR-B04 G4 |
| T4 State transitions | `UPDATE shipments SET state = $to, state_changed_at = now(), version = version + 1 WHERE id = $id AND version = $v AND state = $from` + transition row + audit + outbox in one transaction; the first committer wins races such as cancel vs first scan (DR-B20, EC-B27). | REQ-BOOK-018/019 |
| T5 Timeouts | `statement_timeout` 5 s per request transaction (set in §4.1), `idle_in_transaction_session_timeout` 15 s, `lock_timeout` 2 s; Prisma interactive transaction `maxWait` 2 s, `timeout` 10 s. | REQ-SEC-015 |
| T6 Exactly-once effects over at-least-once delivery | Outbox + `processed_events` + deterministic BullMQ job IDs + per-step idempotency keys + gateway/carrier idempotency keys. | REQ-PLAT-014/017, DR-A25 |

---

## 7. Prisma 7 mapping notes

Facts below were checked against prisma.io/docs on 2026-11-12 (§ header). Items marked **verify in P5 spike** depend on preview features or behaviour not stated in the docs.

### 7.1 `prisma.config.ts` and connection URLs

```ts
// prisma.config.ts (repository root) — illustrative
import 'dotenv/config';                       // Prisma 7 does not load .env itself
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema',                    // multi-file schema folder (one file per module)
  migrations: {
    path: 'prisma/migrations',
    seed: 'node --import tsx prisma/seed/index.ts',   // `prisma db seed` only; never implicit
  },
  datasource: {
    url: env('DATABASE_MIGRATOR_URL'),        // CLI (migrate, db execute) runs as platform_migrator
    shadowDatabaseUrl: env('SHADOW_DATABASE_URL'),
  },
  experimental: { externalTables: true },     // preview; see §7.3
  tables: { external: ['public.audit_entries'] },
});
```

The runtime never uses the migrator URL: `apps/api` and `apps/worker` build the client from `packages/config` (`DATABASE_URL` for `platform_app`, secret-manager reference in AWS) through the driver adapter:

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '<generated client path>/client';
const adapter = new PrismaPg({ connectionString: config.db.appUrl, max: config.db.poolMax, idleTimeoutMillis: 10_000,
                               application_name: config.serviceName });
export const baseClient = new PrismaClient({ adapter });
```

Pool sizing: `pg` pool settings replace Prisma 6 defaults (Prisma 7 upgrade notes); start with `max = 10` per API task and `5` per worker task, sized so that tasks × max stays below the `platform_app` connection limit (200) and the RDS `max_connections` budget (platform-architect sizes RDS Proxy need at M5).

### 7.2 Generator

```prisma
generator client {
  provider        = "prisma-client"            // Prisma 7 generator; output is mandatory
  output          = "../generated/prisma"      // i.e. prisma/generated/prisma (git-ignored), imported via a workspace path alias
  previewFeatures = ["partialIndexes"]         // since 7.4; verify GA/preview status at 7.10 in the P5 spike
}
datasource db {
  provider = "postgresql"                      // URL lives in prisma.config.ts
}
```

The generated client is imported only by repository modules (`apps/api/src/modules/*/repository`, `apps/worker/src/**/repository`) and `packages/audit`'s store adapter (ESLint boundary rule, REQ-PLAT-002). Where the client lives (a `prisma/generated` alias vs. a dedicated workspace) is a principal-architect call; the fixed package list has no `db` package, so this document assumes the alias.

### 7.3 What Prisma expresses and what is raw SQL

| Concern | Expressed in | Notes |
|---|---|---|
| Tables, columns, types, FKs, plain unique/btree indexes | `schema.prisma` | `@db.Uuid`, `@db.Timestamptz(6)`, `@db.Date`, `@db.Time(6)`, `@db.Char(3)`, `@db.ByteA`, `BigInt`, `Json` (`@db.JsonB`), `String[]` |
| Partial indexes / partial uniques with simple predicates | `schema.prisma` with `partialIndexes`: `@@index([orgId, savedAt(sort: Desc), id(sort: Desc)], where: raw("saved_at IS NOT NULL AND deleted_at IS NULL"))` | Otherwise raw SQL; **verify in P5 spike** that `migrate dev` does not emit `DROP INDEX` for raw-SQL partial indexes (PR "preserve feature-gated partial indexes") |
| CHECK constraints, exclusion constraints, generated columns, GIN/trigram indexes, `NULLS NOT DISTINCT`, `INCLUDE` | Raw SQL in the migration | Prisma does not model CHECK constraints and leaves them untouched |
| RLS (`ENABLE`/`FORCE`, policies), roles, grants, functions, triggers, event trigger | Raw SQL | Policies generated from the §4.3 templates by a Node script (`tools/db/render-rls.ts`) into the migration file, never hand-typed per table |
| `audit_entries` partitioned table and partitions | Raw SQL; declared in `tables.external` so Migrate never diffs it; still modelled (`model AuditEntry { … @@id([occurredAt, id]) @@map("audit_entries") }`) for typed reads | `tables.external` is preview (`experimental.externalTables`). **Verify in P5 spike** that dynamically created partitions (`audit_entries_YYYY_MM`) are ignored by the differ; fallback: drop the model and access audit through TypedSQL (`$queryRawTyped`) in `packages/audit` |

Amendment (2026-11-12, SEC-P3-03):
- **External tables.** The audit objects are created in the bootstrap lane, so `tables.external` in `prisma.config.ts` lists **all** of them: `public.audit_entries`, `public.audit_stream_heads`, `public.audit_checkpoint_heads`, `public.audit_chain_verifications`, `public.audit_partitions`, `public.audit_anchors`, `public.audit_pii_vault`, `public.data_subjects`. They stay modelled for typed reads and writes.
- **Shadow database.** The shadow database used by `migrate dev` is initialised with the bootstrap-lane SQL (Prisma's shadow-database init hook for external tables). **Verify in P5 spike SPK-03** that the hook exists at 7.10 and that partitions created by `ensure_audit_partitions` are ignored by the differ. The fallback is unchanged: TypedSQL access in `packages/audit`. *Amended 2026-11-12 (SEC-P3-27 item 6):* the shadow init script is a migrator-runnable rendering of the bootstrap lane: no roles, no `SET ROLE`, no `OWNER TO` or `AUTHORIZATION`, no event triggers. It runs in a shadow database owned by the migrator, so Prisma's shadow reset still works there. The rendering keeps the `SET search_path = pg_catalog, pg_temp` lines. The evaluation is in §4.4, "fixed search path … no-member schema owner". *Amended 2026-11-12 (batch 0.2, D-ARCH-045):* the rendering also keeps the three `CREATE EXTENSION IF NOT EXISTS … WITH SCHEMA public` lines of `01-schemas.sql`: in the shadow database the migrator **is** the owner and may create trusted extensions, whereas in the real database the extensions are installed by the bootstrap role (the migrator no longer owns the database). TASK-003 confirmed that `@prisma/config` 7.10.1 exposes the hook as `migrations.initShadowDb` (`prisma/README.md`, SPK-03 record 2); exercising it with the rendered SQL remains SPK-03 (TASK-012) scope.
- **No audit DDL in Prisma migrations.** A Prisma migration never contains audit DDL (§8.3 rule 12).

Amendment (2026-11-13, SPK-08 TASK-012 PR #12 F-01, F-02, F-03, F-04, F-11; PR12-SEC-07; PR #12 code review R2-m1, n7; D-TASK012-01/02, D-SEC-PR12-01; D-ARCH-077). **The "verify in P5 spike" notes above are closed** with these results; TASK-021 implements the first three before its bootstrap files land.
- **F-01 — external partitions (row "`prisma migrate deploy`", before TASK-021 starts).** The first `migrate deploy` fails with **P3005** once the bootstrap lane has created the audit tables unless **every partition** is in `tables.external`: Prisma's "schema not empty" check counts `audit_entries_YYYY_MM`, and listing the eight parents is not enough. Non-existent external names are accepted, so the root `prisma.config.ts` lists `public.audit_entries_YYYY_MM` for a **generated, bounded window** (2026-01 to the current month + 24; a pure function of the clock, no DB access; 60 names verified). Security ruling (PR12-SEC-07, D-SEC-PR12-01): the generated window is approved; the alternative "first `migrate deploy` before `10-audit.sql`" is **rejected** (migrator DDL would run before the guard exists); the dedicated M5 `audit` schema stays the preferred long-term option. Later deploys and the differ are unaffected (dynamically created partitions are ignored by `migrate diff`/`migrate dev`). TASK-034's restore rehearsal uses the same config for its post-restore `migrate status`/`deploy`.
- **F-02/F-03 — shadow rendering (row "Shadow database", before TASK-021 starts).** `migrations.initShadowDb` exists in 7.10.1 and runs (negative control: a second run without the DROP fails with "function already exists"). Prisma resets only `public` of the shadow database, so the rendering emits `DROP SCHEMA IF EXISTS <s> CASCADE` before each `CREATE SCHEMA IF NOT EXISTS <s>` for every non-`public` schema it creates (`platform`), or makes every rendered statement idempotent. The rendering also strips `GRANT`/`REVOKE`/`ALTER DEFAULT PRIVILEGES` (F-03), not only roles, `SET ROLE`, `OWNER TO`, `AUTHORIZATION` and event triggers; policies `TO platform_app` are kept (the cluster has the roles). **Safety (PR12-SEC-07):** the `DROP … CASCADE` relies on the migrator owning the shadow database and its `platform`; against a real bootstrapped database (`platform_schema_owner` owns `platform`) it fails closed with `42501`, but on a non-bootstrapped developer database owned by the migrator a mis-set `SHADOW_DATABASE_URL` would wipe `platform` (incl. TASK-016's helper functions) — so the rendered init's **first statement refuses unless `current_database()` is owned by `current_user`**. The three `CREATE EXTENSION` lines stay in the rendering (A16).
- **F-04 — covering indexes.** `migrate dev --create-only` writes `DROP INDEX` + `CREATE INDEX … ("role_id")` **without `INCLUDE`** for `ix_role_permissions__role_id` into **every** new migration, and the A17 drift check tolerates the name, so a committed generated migration would silently lose the covering column (AP-AUTHZ-02). **Linter rule (owner TASK-024, due before the next migration-adding task merges — TASK-026):** a migration may not `DROP INDEX` a name on the covering-index tolerance list unless the same file re-creates it **with `INCLUDE`**; alternatively the catalog check compares `pg_index.indnkeyatts < indnatts` for the tolerated names. Module authors delete the two generated statements until then.
- **F-11 — partial indexes (row "Partial indexes").** `partialIndexes` is still **preview** in 7.10.1 and is read from the config schema. With it **off** (the repository today) Prisma keeps a raw-SQL partial index, but a plain `@@index` of the same name and columns hides the predicate from the differ; with it **on**, the next generated migration **drops** every partial index the schema does not declare and re-creates one whose declared predicate differs. **Rule:** when `partialIndexes` is enabled, every partial index is declared with its exact `where: raw(…)`; until then partial indexes stay raw SQL and are **not** declared as plain `@@index`. **Linter rule (owner TASK-024, same due point; PR #12 code review R2-m1 wording, mirroring the F-04 rule):** a generated migration must not `DROP INDEX` an index that an earlier migration created with `WHERE` unless the same file re-creates it **with a `WHERE` clause**; a predicate change is flagged for review (a plain re-create without `WHERE` — the preview-on + plain `@@index` path — is exactly the defect). The CI `migrate diff --exit-code` (once F-04 is resolved) catches undeclared ones after the preview is enabled. Due for the spec: before the first module migration with a partial index (AP-PAY/AP-ORD/AP-SHP tasks).

Workflow for a migration that needs raw SQL (REQ-SEC-009 allows raw SQL only in migrations and reviewed repository functions):

1. Edit `prisma/schema/*.prisma` for the parts Prisma can express.
2. `npx prisma migrate dev --create-only --name <module>_<change>` (generates `migration.sql` without applying it).
3. Append the raw SQL (CHECKs, policies via the render script, grants from the manifest, triggers) to `migration.sql`; add a hand-written `down.sql` beside it (§8.4); add the header block required by the linter (`-- migration-kind: expand|migrate|contract`, `-- data-changing: yes|no`, `-- reversible: yes|no`).
4. `npx prisma migrate dev` applies it to the local DB and the shadow DB; `npx prisma generate`.
5. CI runs `prisma migrate deploy` only (never `migrate dev`, never `db push`).

*Added 2026-11-12 (TASK-013 D-T013-09, A17).* Covering indexes are raw SQL: Prisma's `@@index([...], map: "<name>")` cannot express `INCLUDE (...)`, so `ix_role_permissions__role_id INCLUDE (permission_id)` (AP-AUTHZ-02) and any later covering index are written in `migration.sql` and declared in the schema under the same `map:` name without the include list. `prisma migrate diff --from-schema-datamodel --to-migrations` therefore reports those indexes as drift; the schema-drift check (TASK-016 catalog suite) compares the **migrations** against the database and lists the covering indexes it tolerates by name, so a hand-edited `INCLUDE` does not pass unnoticed either.

### 7.4 Naming

Models are PascalCase singular, fields camelCase, both mapped: `model ShipmentParty { id String @id @default(dbgenerated("uuidv7()")) @db.Uuid … orgId String @map("org_id") @db.Uuid … @@map("shipment_parties") }`. Every relation gets an explicit `map:` FK name matching P9 (`fk_shipment_parties__shipment_id`). Index names are given explicitly (`map: "ix_shipments__org_created"`) so raw-SQL and Prisma-generated names never collide.

### 7.5 Enums, money, decimals, bytes

- **Enums:** `String` columns with DB CHECKs (P7); the repository mapper narrows to the `packages/shared` union with a type guard, and C9 keeps lists equal. No `enum` blocks in the Prisma schema.
- **Money:** `BigInt` (`bigint`) mapped to JS `bigint` in repositories; the domain `Money` type in `packages/shared` carries `amount: bigint` (or a branded safe integer) and the API serialiser emits JSON integers after asserting `|amount| ≤ Number.MAX_SAFE_INTEGER`. **Never** `Decimal` for money (P5, NFR-DATA-001); a lint rule bans `Prisma.Decimal` outside the FX repository.
- **FX rates:** `Decimal @db.Decimal(18, 6)` converted to a string with `toFixed(6)` at the repository boundary (REQ-API-016).
- **Hashes/ciphertext:** `Bytes @db.ByteA` (`Uint8Array`).
- **IP prefixes:** `String @db.Inet` (the two `sessions` prefix columns); the service masks the address to /24 or /48 before writing.

### 7.6 Client extension: standard columns, soft delete, optimistic locking

The `$use` middleware API is removed in Prisma 7; one extension built with `Prisma.defineExtension` and `$extends({ query: { $allModels: { … } } })` provides:

- `create` / `createMany`: sets `id = uuidv7()` (app-side), `createdBy = updatedBy = ctx.actorId`, `version = 1`, and `orgId = ctx.orgId` for TENANT models when absent; rejects any of these fields if present in caller input (REQ-SEC-007 defence in depth).
- `update` / `updateMany`: sets `updatedBy`, `updatedAt = now`, `version: { increment: 1 }`; requires `where.version` for versioned models (`update({ where: { id, version } })` is a unique-where in Prisma); a `P2025` result maps to 412/409 (REQ-RLS-011).
- `findUnique`/`findFirst`/`findMany`/`count`/`aggregate` on soft-deletable models: adds `deletedAt: null` unless the call passes the explicit `withDeleted()` marker (allowed only in audit/erasure code).
- `delete` / `deleteMany` on soft-deletable models: rewritten to `update` setting `deletedAt`, `deletedBy`; on any model not on the hard-delete allow-list: throws (the DB also lacks the grant).
- Models whose rows the writer may not be able to read back (§4.3 RETURNING caveat) expose only `createMany`.

The extension only rewrites `args` and calls `query(args)`; it never opens its own transaction or uses the base client, so it runs inside the caller's interactive transaction (the Prisma docs warn that extension code that issues its own queries escapes the transaction). The context (`orgId`, `actorId`) comes from the `withTenantTx` closure, not from AsyncLocalStorage globals.

### 7.7 `withTenantTx`

```ts
// packages/… (illustrative; P5 implements)
export async function withTenantTx<T>(ctx: DbContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
  return extendedClient(ctx).$transaction(async (tx) => {
    // 2026-11-12 (ADR-0005 am. 10 items 4, 12, 16): eight settings, validated strings only, prior values read in the same
    // round trip. The real implementation validates every value before checkout (UUID | '', TENANT|OPERATOR, 64 hex | '',
    // correlation id, integer ms within bounds) and never binds NULL/undefined/Prisma.raw.
    const [prev] = await tx.$queryRaw<[{ org_id: string | null; actor_id: string | null; actor_scope: string | null; guest_token_hash: string | null }]>`
      WITH prev AS MATERIALIZED (SELECT current_setting('app.org_id', true) AS org_id, current_setting('app.actor_id', true) AS actor_id,
                                        current_setting('app.actor_scope', true) AS actor_scope, current_setting('app.guest_token_hash', true) AS guest_token_hash)
      SELECT prev.*, set_config('app.org_id', ${v.orgId}, true), set_config('app.actor_id', ${v.actorId}, true),
             set_config('app.actor_scope', ${v.scope}, true), set_config('app.guest_token_hash', ${v.guestTokenHash}, true),
             set_config('app.correlation_id', ${v.correlationId}, true),
             set_config('statement_timeout', ${v.statementTimeoutMs}, true), set_config('lock_timeout', ${v.lockTimeoutMs}, true),
             set_config('idle_in_transaction_session_timeout', ${v.idleInTransactionTimeoutMs}, true)
        FROM prev`;
    if (Object.values(prev).some((p) => p !== null && p !== '')) throw dbSessionContextLeak(); // item 16: event + not-ready
    return fn(asTenantDb(tx));
  }, { isolationLevel: 'ReadCommitted', maxWait: 2_000, timeout: 10_000 });
}
```

Repositories receive only `tx` (never the root client, ESLint rule); the API's request pipeline opens one `withTenantTx` per request (DR-A08) and the worker one per job step. `ctx.scope = 'OPERATOR'` is accepted only for admin-app tokens on routes declaring `tenancy: 'operator-cross-tenant'` (ADR-0005 amendments 2 and 5); workers never use a cross-tenant scope (they discover work through §4.5 and the global index tables).

---

## 8. Migration strategy, backup/restore rehearsal and zero-downtime probe

CLAUDE.md §5 database guardrail, NFR-DATA-004, NFR-AVAIL-003, NFR-REC-003, product brief §4.10.

### 8.1 Tooling and layout

- Prisma Migrate (`prisma migrate deploy` in CI/CD; `migrate dev --create-only` locally), raw SQL inside `migration.sql`, hand-written `down.sql` per migration, `prisma/sql/` for templates and the grant manifest, `tools/db/*.ts` (Node/TypeScript; no Python on the dev host) for the RLS renderer, the migration linter, the up→down→up test driver, the backfill runner and the backup/restore rehearsal.
- Migrations run as `platform_migrator` from a one-shot `migrate` container in Compose before `api`/`worker` start, and from a CD pipeline job in AWS (never from a terminal, CLAUDE.md §5).
- **Bootstrap lane (amended 2026-11-12, SEC-P3-03).** A second, separate lane runs `prisma/bootstrap/*.sql` before `migrate`.
  - **Credential and runner.** It uses the cluster-admin credential: the Compose `bootstrap` one-shot service locally, and at M5 a pipeline job with the break-glass RDS master secret. The runner is `tools/db/bootstrap.ts`.
  - **Files.** They are idempotent, applied in file-name order, and recorded in the ledger `public.bootstrap_migrations (file_name text PK, sha256 bytea, applied_at timestamptz, applied_by text)`. *Amended 2026-11-12 (batch 0.2, D-ARCH-048):* the file names are `NN-<name>.sql` with a two-digit ordinal: `00-roles.sql` (cluster- and database-level statements, the only file the restore rehearsal runs before `pg_restore`, §8.6), `01-schemas.sql` (schema-scoped statements, extensions, default privileges), `10-audit.sql` and `90-audit-ddl-guard.sql` (TASK-021). The plan sheet's `0001_roles_schemas.sql` was a drafting name and is withdrawn: one file for roles and schemas would break the §8.6 rule that only cluster/database-level statements run before `pg_restore`. The ledger is owned by the bootstrap superuser, has no grants to any platform role, and is on the SYSTEM allow-list. A changed SHA-256 for an applied file fails the run.
  - **Scope.** Roles, schemas and audit DDL live only here (§4.4, §5). Regular Prisma migrations can never contain audit DDL, because `platform_migrator` is not the owner and the DDL guard rejects it.
  - **Guardrails.** The backup and restore-test guardrail (§8.6) applies to bootstrap files exactly as it does to `data-changing: yes` migrations.

### 8.2 Expand → migrate → contract rules

| Phase | Allowed | Ships with | Rollback |
|---|---|---|---|
| **Expand** | New tables, nullable columns, columns with constant defaults, new indexes (`CONCURRENTLY` on existing tables), new CHECKs as `NOT VALID` then `VALIDATE CONSTRAINT`, new FKs `NOT VALID` then `VALIDATE`, new policies, widened CHECK (add new, keep old until contract) | Code that writes both shapes (dual-write) and still reads the old | `down.sql` drops what was added (always reversible) |
| **Migrate** | Backfill through the resumable runner (§8.5), never inside `migration.sql` for tables > 10,000 rows; then `SET NOT NULL` via a validated `CHECK (col IS NOT NULL)` (PostgreSQL skips the scan) or PostgreSQL 18 `NOT NULL … NOT VALID` + `VALIDATE` | Code that reads the new shape | Roll forward (fix the backfill) is the default; down = stop the runner, new columns stay unused |
| **Contract** | `DROP COLUMN/TABLE/INDEX/CONSTRAINT`, drop old CHECK, remove dual-write | A later release, once no deployed code reads the old structure (checked against the previous release tag) **and** a verified backup exists | Restore-based only; declared `reversible: no` |

### 8.3 Migration linter (Node script, CI gate)

Fails the build when a migration file:

1. Lacks the header (`migration-kind`, `data-changing`, `reversible`) or a `down.sql`.
2. Contains `DROP TABLE`, `DROP COLUMN`, `DROP INDEX`, `DROP CONSTRAINT`, `ALTER … DROP DEFAULT` outside a `contract` migration, or a `contract` migration that references an object still present in the previous release's Prisma schema.
3. Contains `RENAME` (table, column, constraint) — use add + backfill + drop.
4. Adds a column `NOT NULL` without a constant default, or `ALTER COLUMN … TYPE`, or `SET NOT NULL` without a preceding validated CHECK.
5. Creates an index without `CONCURRENTLY` on a table created by an earlier migration; or puts `CREATE INDEX CONCURRENTLY` in a file with other statements (~~PostgreSQL rejects it inside a multi-statement script; one statement per file, **verify in P5 spike** how Prisma submits single-statement files~~ *verified 2026-11-12 by TASK-016, PR #11 `prisma/README.md` "Rule 5", `tests/migrations/concurrent-index.int.test.ts`, Prisma 7.10.1 / PostgreSQL 18.6; ruled 2026-11-13, D-ARCH-071:* **`migrate deploy` runs a file's statements one at a time, outside any transaction block** — a `CREATE INDEX CONCURRENTLY` after a `SET lock_timeout` in the same file is applied, and a file whose second statement fails keeps the effects of its first (`finished_at` NULL, the first statement's table remains). **A migration file is therefore not atomic.** The one-statement rule stays for isolation — a failed concurrent build leaves an `INVALID` index that must be retried or dropped on its own — not because of `25001`. The consequences for rules 9, 11 and 15 and the new rule 17 are below).
6. Adds a FK or CHECK on an existing table without `NOT VALID`.
7. Touches audit storage with `UPDATE`, `DELETE`, `TRUNCATE`, `DROP`, `DETACH PARTITION`, `DISABLE TRIGGER`, `NO FORCE ROW LEVEL SECURITY`, `DISABLE ROW LEVEL SECURITY` (REQ-AUDIT-015), or disables RLS on any table.
8. Grants `DELETE` to `platform_app` on a table outside the allow-list, grants `BYPASSRLS`, `SUPERUSER`, or ownership to `platform_app`, or grants any privilege on a partition.
9. Drops a policy without re-creating it in the same file; or creates a table without the RLS block / allow-list entry (cross-checked with C1). *Amended 2026-11-13 (PR11-SEC-03 item 2, PR11-SEC-07; D-ARCH-071, D-ARCH-072):* (a) **every `CREATE POLICY`** in `prisma/migrations/**` must equal, after whitespace normalisation, a statement of `renderRls(entry)` for its table's manifest entry — "policy not rendered from the templates" otherwise; there is no exemption file (the DR-A14 sets are templates, §4.3); the renderer's own output lints clean (owner TASK-024); (b) because files are not atomic (rule 5), a **`GRANT … TO platform_app` on an RLS-class table must come after that table's `ENABLE` + `FORCE ROW LEVEL SECURITY` and its policies in the same file** (fixture `grant-before-force`); a grant placed earlier would leave a granted table without RLS as a durable state when a later statement fails (TASK-016 fix cycle).
10. Contains `UPDATE`/`DELETE`/`INSERT … SELECT` against an existing table without `data-changing: yes` (data-changing migrations trigger the backup guardrail, §8.6). Pure `INSERT` of new rows into reference tables by the seed is not a migration. *Clarified 2026-11-12 (TASK-013, D-ARCH-060; PR8-SEC-03, D-SEC-PR8-01):* a **generated seed migration** that only `INSERT … VALUES … ON CONFLICT ("id") DO NOTHING`s new rows into GLOBAL tables created earlier in the same or a previous migration (the authz `v<N>` seeds) is `data-changing: no` — it touches no existing row; a later authz migration that narrows a role (`DELETE FROM role_permissions …`), rewrites a description (`UPDATE`), **upserts (`INSERT … ON CONFLICT … DO UPDATE`) or `MERGE`s** is `data-changing: yes` and takes the §8.6 guardrail. The linter's `DATA_CHANGING` pattern covers the upsert and `MERGE` forms (TASK-016 or the PR #8 fix cycle, with a negative fixture).
11. Lacks `SET lock_timeout` at the top when it alters an existing table. *Amended 2026-11-13 (PR11-SEC-07 item 1; D-ARCH-071):* the **session form only** — `SET lock_timeout = …` or `SET SESSION lock_timeout = …`; **`SET LOCAL lock_timeout` fails the rule** (fixture `set-local-lock-timeout`), because each statement of a migration file runs in its own implicit transaction (rule 5) and outside a transaction block `SET LOCAL` "emits a warning and otherwise has no effect" (PostgreSQL *SET*): the following `ALTER TABLE` would run with no lock timeout at all, the pile-up NFR-AVAIL-003 guards against. The session value persists on the deploy connection into later files, so a file that sets a value **above** the migrator role default (`3s`, §4.4) ends with `RESET lock_timeout`.

**Non-atomic files — ordering principle (2026-11-13, PR11-SEC-07, D-ARCH-071).** Because `migrate deploy` applies statements one at a time and a failure leaves every earlier statement in place, **a migration is written so that every prefix of its statements leaves the schema safe**: `CREATE TABLE` → `ENABLE` + `FORCE ROW LEVEL SECURITY` → policies → grants (rule 9 b; `FORCE` with no policy is 0 rows, fail closed); a `SECURITY DEFINER` function is created *and granted* inside one `SET ROLE platform_definer; … RESET ROLE;` block (rule 15); data moves after structure. Recovery from a failed deploy is `down.sql` (idempotent against any prefix, rule 17) → `prisma migrate resolve --rolled-back <name>` (legitimate here: the migration **is** in the failed state, §8.4) → redeploy of the fixed file. No file may end inside `SET ROLE`.

**Amendment (2026-11-12, SEC-P3-03): audit DDL lane.** Rule 7 is extended, and one rule is added.

12. **Audit DDL outside the bootstrap lane, or without approval.**
    - **What counts as audit DDL.** Any `CREATE`, `ALTER`, `DROP`, `COMMENT`, `GRANT`, `REVOKE`, `CREATE TRIGGER`, `CREATE POLICY` or `CREATE OR REPLACE FUNCTION` that names an audit object: `audit_entries` or any `audit_entries_*` partition, `audit_stream_heads`, `audit_checkpoint_heads`, `audit_chain_verifications`, `audit_partitions`, `audit_anchors`, `audit_pii_vault`, `data_subjects`, `platform.audit_forbid_mutation`, `platform.audit_vault_guard`, `platform.ensure_audit_partitions` or `platform.audit_ddl_guard`. Statements that mention `platform_audit_owner` (`SET ROLE`, `OWNER TO`, `GRANT … TO`) count too.
    - **In `prisma/migrations/**`.** Such a statement fails the build **unconditionally**, with or without a marker.
    - **In `prisma/bootstrap/**`.** Such a statement needs the file header `-- @audit-ddl security-approved: <reviewer> <YYYY-MM-DD>` (regex `^-- @audit-ddl security-approved: [a-z0-9._-]+ \d{4}-\d{2}-\d{2}$`). `<reviewer>` must be listed in `tools/db/audit-ddl-reviewers.json` (security-analyst identities), and the date must not be later than the commit date. Existing bootstrap files are immutable; a change is a new file.
    - **Other checks.** The linter also rejects any `DO` block or function body in `prisma/migrations/**` that runs `EXECUTE` on a concatenated string, unless the statement carries `-- @dynamic-sql reviewed: <reviewer> <date>`.
    - **Limits.** The linter matches text and is an early warning, not the boundary. The boundary is ownership (§4.4) plus the identity-based `audit_ddl_guard` (§5.2), which also catches dynamic SQL at execution time. The bootstrap and `migrate` lanes run as separate CI and CD steps with separate credentials, and the `migrate` job never receives the cluster-admin credential.
    - **Stated limits of the by-form rules (added 2026-11-13; PR #11 code review R2-n2, PR11-SEC-16, PR11-SEC-17 c; D-ARCH-078).** Text rules cannot be complete over dynamic SQL, in either lane. Known forms that evade rules 11, 15 and 16 as text, and the outcome control that catches each: (a) **escape strings in `EXECUTE` operands** — PostgreSQL's `E'…'` syntax decodes `\xHH`, octal `\ooo`, `\uXXXX`/`\UXXXXXXXX` in the lexer, so `EXECUTE E'SET LOCAL \x61pp.org_id = ' || …` or `app\x2eorg_id` hides a key from rule 16 and the C-series while the setter name stays visible; **ruled:** `E'…'` strings are **refused outright, token-level** (the tokenizer already marks the `E` prefix; never a regex such as `/\be'/i`, which also matches a string ending in a lone `e`), exactly as `U&` identifiers already are (PR11-SEC-14 a); no committed migration, bootstrap file or template uses one; fixture `context-escape-string`; owner TASK-024 with the dynamic-SQL allow-list (PR11-SEC-14 b); (b) a setter whose **name and key are both built in `format()`**, and a **read via `pg_show_all_settings()`** — review items, optionally flagged as review-required by TASK-024's dynamic-SQL allow-list; (c) **rule 15 (c)** cannot see a role left set through `set_config('role', 'platform_definer', false)` or `DO $$ … EXECUTE 'SET ROLE …' $$` — outcome control: the C11 converse (`platform_definer` owns only the allow-listed objects) and the item-16 leak detector; `set_config('role'` / `'session_authorization'` literals are flagged (PR11-SEC-15 b, TASK-024); (d) **rule 11** tracks only `SET [SESSION] lock_timeout`: `SET "lock_timeout" = 0`, `SELECT set_config('lock_timeout', '0', false)` and a `SET` inside a `DO` body leave the session value raised for later files (availability only, NFR-AVAIL-003; a later file that alters a table must itself start with `SET lock_timeout`) — quoted names and the `set_config` form fold into `LOCK_TIMEOUT_VALUE` (TASK-024), `DO` bodies with PR11-SEC-15 a (TASK-021); (e) any `EXECUTE` of a non-literal in `DO` and function bodies is review-required (`-- @dynamic-sql reviewed`). The execution-level controls — catalog scans by form over `pg_proc.prosrc`, C3/C11/C13/C14 and the in-statement leak detector — are the boundary; the linter header lists the same limits.

**Amendment (2026-11-12, SEC-P3-27): definer search path.** One rule is added. It applies to `prisma/migrations/**` and `prisma/bootstrap/**`.

13. **`SECURITY DEFINER` without the fixed search path, or a bootstrap file without the path line.**
    - **Definer functions.** Every `CREATE [OR REPLACE] FUNCTION` or `CREATE [OR REPLACE] PROCEDURE` whose header (the text up to the body's opening `AS`) contains `SECURITY DEFINER` must also contain `SET search_path = pg_catalog, pg_temp`. The match is case-insensitive and whitespace-normalised, with `pg_temp` last and nothing else in the list.
    - **Statements that undo it.** The linter also rejects `ALTER FUNCTION … SECURITY DEFINER`, and any `ALTER FUNCTION … SET search_path`, `RESET search_path` or `RESET ALL` on a function, unless the statement sets exactly that value.
    - **The audit functions.** `platform.audit_forbid_mutation`, `platform.audit_vault_guard` and `platform.audit_ddl_guard` need the same `SET` clause, although they are not definer functions.
    - **Bootstrap files.** Every file in `prisma/bootstrap/**` must have `SET search_path = pg_catalog, pg_temp;` as its first statement, after the header comments and before any `SET ROLE`.
    - **Limits.** This is a text early warning. The boundary is the `proconfig` assertion of catalog tests C11 and C14 (§4.6), which also catches functions created through dynamic SQL.

**Amendment (2026-11-12, batch 0.2; D-ARCH-045, D-ARCH-049; `rulings/batch-0.2-rulings.md` items 1 and 5): rule 12 precision, rule 14, and rule ownership.**

- **Rule 12, which `platform_audit_owner` statements count.** *(Superseded 2026-11-12 by the batch 0.2 part 2 amendment below, D-ARCH-053: the bootstrap lane is deny-by-default; the list of marker-free forms is closed.)* "Statements that mention `platform_audit_owner` (`SET ROLE`, `OWNER TO`, `GRANT … TO`) count too" is made precise. In `prisma/migrations/**` **any** mention of the role fails. In `prisma/bootstrap/**` the marker is required for `SET [LOCAL|SESSION] ROLE platform_audit_owner`, `… OWNER TO platform_audit_owner` and **membership** grants (`GRANT platform_audit_owner TO <x>`); the role's own `CREATE ROLE`/`ALTER ROLE` attributes, its schema privilege grants (`GRANT USAGE, CREATE ON SCHEMA … TO platform_audit_owner`) and its `ALTER DEFAULT PRIVILEGES FOR ROLE platform_audit_owner …` row in `00-roles.sql`/`01-schemas.sql` do not touch an audit object and need no marker. This is the TASK-003 implementation (`tools/db/lint-migrations.ts`, `AUDIT_OWNER_ACTION`); security-analyst confirms it in the PR #5 review (PR decision 5).

**Amendment (2026-11-12, batch 0.2 part 2; D-ARCH-053; `rulings/batch-0.2-rulings.md` Part 2 item 10; implemented at TASK-003 PR #5 @4574a14 for PR5-SEC-02 and code-review m1/m2): rule 12 bootstrap lane is deny-by-default; rule 13 matches code-only text anywhere in the statement.**

- **Rule 12, bootstrap lane (deny-by-default).** In `prisma/bootstrap/**` a statement that names an audit object, or that mentions `platform_audit_owner` anywhere in its text (quoted or not, in code or in a body), needs the file's approval marker — **except** exactly these marker-free forms, each matched against the whole whitespace-normalised statement:
  - (a) `ALTER ROLE platform_audit_owner` followed only by negative attributes from `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`;
  - (b) `GRANT USAGE|CREATE[, USAGE|CREATE] ON SCHEMA <name>[, <name>…] TO platform_audit_owner` — the audit owner as the only grantee, no `WITH GRANT OPTION`;
  - (c) `ALTER DEFAULT PRIVILEGES FOR ROLE platform_audit_owner [IN SCHEMA <names>] REVOKE …`;
  - (d) the role-creation `DO` block of `00-roles.sql`, recognised by the SHA-256 of its whitespace-collapsed text pinned in the linter (`AUDIT_OWNER_CREATION_BLOCK`). The pin cannot drift: applied bootstrap files are immutable through `bootstrap_migrations.sha256`, so a changed block fails the bootstrap run as well as the linter.
  Everything else needs the marker, in particular (negative fixtures `tools/db/fixtures/lint/bootstrap/audit-owner-*`): membership grants in **any** position (`GRANT platform_audit_owner TO x`, `GRANT a, platform_audit_owner TO x`, `ALTER GROUP`), `SET [LOCAL|SESSION] ROLE`, `OWNER TO`, `REASSIGN OWNED BY`, `DROP OWNED BY`, `ALTER ROLE … LOGIN | PASSWORD | BYPASSRLS | SUPERUSER | RENAME | SET | VALID UNTIL`, `DROP ROLE`, `ALTER DEFAULT PRIVILEGES … GRANT`, schema grants `WITH GRANT OPTION`, and any `DO` block or function body whose text names the role (dynamic SQL). Consequence: a future bootstrap file that creates or alters roles carries the marker unless it uses only forms (a)–(c) — intended, since such a file is exactly what security-analyst must see. The migrations lane is unchanged: any mention of an audit object or of the role fails unconditionally.
- **Rule 13, code-only text.** The definer-function clause above — "whose header (the text up to the body's opening `AS`)" — is withdrawn: PostgreSQL accepts `SECURITY DEFINER` and `SET` clauses after the body (`… AS $$ … $$ LANGUAGE sql SECURITY DEFINER;`), which the header reading missed. The linter evaluates the statement's **code-only text**: the statement with string literals, dollar-quoted bodies and comments blanked by the tokenizer. For `CREATE [OR REPLACE] FUNCTION | PROCEDURE`: `SECURITY DEFINER` anywhere in the code-only text requires `SET search_path = pg_catalog, pg_temp` (`TO` accepted; `pg_temp` last; nothing else in the list) in the code-only text — a `search_path` set only inside the body (`PERFORM set_config(…)`, a `SET` inside the body) does **not** satisfy the rule, and `SECURITY DEFINER` that appears only inside a string or a body does not trigger it. For `ALTER FUNCTION | PROCEDURE`: `SECURITY DEFINER`, `RESET search_path`, `RESET ALL`, and `SET search_path` to anything other than the fixed value fail. The "Bootstrap files" first-statement rule and the "Limits" paragraph are unchanged. Fixtures: `tools/db/fixtures/lint/migrations/definer-after-body/*` (option after the body; path after the body; path only inside the body) and `definer-path/*`.
- **Rule 14 (added).** In `prisma/migrations/**`: `CREATE SCHEMA`, `CREATE EXTENSION`, `ALTER DATABASE`, `ALTER SCHEMA … OWNER TO`, `ALTER ROLE` and `CREATE ROLE`/`DROP ROLE` fail the build. Reason: the migrator owns neither the database nor the schemas (D-ARCH-033, D-ARCH-045), so each of these fails at `migrate deploy` with `42501` — including `CREATE SCHEMA IF NOT EXISTS` on an existing schema, because PostgreSQL checks `CREATE` on the database before the existence short-circuit. Schemas, extensions and roles are bootstrap-lane objects (§8.1). `migrate dev` may generate a `CREATE SCHEMA IF NOT EXISTS` line for a non-default schema; it is removed from the migration before commit, and this rule is what catches a forgotten one on the PR.
- **Ownership.** TASK-003 (PR #5) implemented rules 1, 2, 10, 12, 13 and the contract-reversibility check ("C"), each with negative fixtures. **Rules 3–9, 11 and 14 are owned by TASK-016** (Wave 0 batch 0.5, `database-engineer`), which adds the first real migration (`platform_rls_helpers`: policies, definer functions, grants) and closes US-074; the `migration-lint` required suite activates with US-074 (`docs/05-quality/tests/required-suites.json`), so the test cases it must carry land there. Mapping: rules 7, 8, 9 and 12 → **SEC-TC-33** (`DROP TRIGGER`, `DISABLE ROW LEVEL SECURITY`/`NO FORCE`, `BYPASSRLS`/`SUPERUSER`/ownership to `platform_app`, `ALTER POLICY`/`DROP POLICY` without re-creation, `DELETE` grants outside the allow-list, privileges on partitions, audit DDL); rules 2, 3, 4, 5, 6 and 11 → **NT-AVAIL-003-a** (`DROP` outside contract, `RENAME`, `NOT NULL` without a constant default or validated CHECK, `ALTER COLUMN … TYPE`, non-`CONCURRENTLY` index on a pre-existing table or `CONCURRENTLY` in a multi-statement file, FK/CHECK without `NOT VALID`, missing `SET lock_timeout`); rule 14 → SEC-TC-33 as well (privilege-bound statements). Rule 5's open question ("how Prisma submits single-statement files") is answered inside TASK-016 by running a one-statement `CREATE INDEX CONCURRENTLY` migration through `migrate deploy` in the Testcontainers harness; the linter's rule-5 fixture is written from that result. Until TASK-016 merges, no test title claims `[SEC-TC-33]` or `[NT-AVAIL-003-a]` (TASK-003 correctly did not).

**Amendment (2026-11-12, Wave 0 batch 3 Part 2; ADR-0005 am. 10 items 1 and 9; PR7-SEC-09, PR7-SEC-11; D-ARCH-065): rules 15 and 16, both owned by TASK-016, each with negative fixtures under `tools/db/fixtures/lint/`.**

15. **Definer-function ownership order.** In `prisma/migrations/**`, a `GRANT` or `REVOKE` on a function that appears *after* `ALTER FUNCTION … OWNER TO platform_definer` for the same function in the same file fails (the migrator holds `platform_definer` `WITH INHERIT FALSE`, so after the owner change it can no longer grant — a deploy-time `42501`). ~~A `CREATE [OR REPLACE] FUNCTION … SECURITY DEFINER` outside a `SET ROLE platform_definer; … RESET ROLE;` block is flagged (the preferred form; the "grants before `OWNER TO`" form is accepted). Fixtures: `definer-grant-after-owner-to` (fails), `definer-outside-set-role` (flagged), `definer-set-role-block` and `definer-grants-before-owner-to` (clean).~~ *Amended 2026-11-13 (PR11-SEC-07 items 2–3; ADR-0005 am. 10 item 9 as amended; D-ARCH-071):* **the `SET ROLE platform_definer; … RESET ROLE;` block is the only accepted form.** The "grants before `OWNER TO`" alternative is withdrawn: files are not atomic (rule 5), so a failed `ALTER FUNCTION … OWNER TO platform_definer` after a successful `GRANT EXECUTE … TO platform_app` would leave a **migrator-owned** `SECURITY DEFINER` function executable by `platform_app` as a durable state — and the migrator owns the SYSTEM/GLOBAL tables, which have no RLS. Rule 15 therefore fails (a) a `CREATE [OR REPLACE] FUNCTION | PROCEDURE … SECURITY DEFINER` outside the block, (b) any `ALTER FUNCTION | PROCEDURE | ROUTINE … OWNER TO platform_definer` in `prisma/migrations/**` (inside the block the function is born with the right owner; outside it the form is the withdrawn one), (c) a file whose last statement leaves the definer role set (no `RESET ROLE`; a later file on the same deploy connection would create objects owned by `platform_definer`, PR11-SEC-06). Fixtures: `definer-grant-after-owner-to` (fails), `definer-outside-set-role` (fails), `definer-grants-before-owner-to` (**now fails**), `definer-role-not-reset` (fails), `definer-set-role-block` (clean). The `handedOver` branch of the linter is removed (TASK-016 fix cycle).
16. **Tenant-context writes in SQL bodies.** In `prisma/migrations/**` (and, through catalog test C-series, in `pg_proc.prosrc` of every function in every non-system schema, `platform` included), any write form targeting the request context fails: `set_config(` with an `app.` key, `SET`/`SET SESSION`/`SET LOCAL` followed by `app.`, `RESET app.`/`RESET ALL`, `DISCARD`. A read of the four security keys (`current_setting('app.org_id'|'app.actor_id'|'app.actor_scope'|'app.guest_token_hash'`) is allowed only inside the §4.2 helpers (`platform.app_org_id`, `app_actor_id`, `app_guest_token_hash`, `app_is_operator`), matched by `regprocedure`; reads of `app.correlation_id` (trigger messages) are allowed anywhere. The rule is **by form, not by schema** — the earlier "non-platform functions" scope exempted exactly the schema that holds every `SECURITY DEFINER` function. Fixtures: a `platform` function calling `set_config('app.org_id', …, true)`, a `public` function running `SET app.org_id = …`, a non-helper reading `current_setting('app.org_id', true)` (each fails); the current catalogue and the §4.2 helpers (clean). *Amended 2026-11-13 (PR11-SEC-02, PR11-SEC-03 item 1, PR #11 code review m1; D-ARCH-071):* (a) **forms.** "Any write form" means any — the first implementation admitted `set_config('' || 'app.org_id', …)`, `"set_config"(…)`, `format('SET LOCAL %I = %L', 'app.org_id', …)`, `SET LOCAL "app".org_id`, `SET app . org_id`, `RESET "app".org_id` and the dynamic read `current_setting(k, true)`. One pattern list is shared by `scans.ts` and the linter: every `set_config(` call (quoted or not; an allow-list by `regprocedure` only if a legitimate caller ever appears), `SET`/`RESET` with quoted or spaced `app` parts, `RESET ALL`, `DISCARD`; outside the helpers any **mention** of a security key (quoted or `format`-built) and any non-literal `current_setting(` argument count as reads. Every evaded form from the PR #11 review table is an executed C-series fixture (which also proves it is valid SQL) and a linter fixture; rule 13 counts `SET "search_path"` as well. (b) **Operator atom.** Inside a `CREATE POLICY` statement — and only there — the normalised atom `current_setting('app.actor_scope', true) = 'OPERATOR'` is exempt from the read check, so the renderer's own operator template lints clean; `policy-tautology` and `policy-unkeyed` fixtures still fail through rule 9 a. Without this exemption TASK-037's first RLS migration fails lint, and loosening rule 16 for policies in general would open a hole (TASK-016 fix cycle; **required before the first `CREATE POLICY` migration**).
17. **`down.sql` is idempotent against any applied prefix (added 2026-11-13, PR11-SEC-07; D-ARCH-071; owner TASK-024).** Because a failed deploy leaves an arbitrary prefix of `migration.sql` applied (rule 5) and the recovery runs `down.sql` against that state, every `DROP TABLE | INDEX | POLICY | FUNCTION | TRIGGER | TYPE` and every `ALTER TABLE … DROP COLUMN | DROP CONSTRAINT` in `down.sql` carries `IF EXISTS`; `REVOKE` and `ALTER TABLE … NO FORCE | DISABLE ROW LEVEL SECURITY` are only allowed on objects the same migration's `migration.sql` created (rule 7 still forbids them on pre-existing tables). Fixture `down-without-if-exists` fails. The reversibility driver's prefix check (§8.4) is the execution-level proof.

### 8.4 Reversibility test: up → down → up (NFR-DATA-004)

Testcontainers job on (a) an empty database and (b) the seeded database:

1. `prisma migrate deploy` (all up) → `pg_dump --schema-only` normalised (strip comments/ordering) → snapshot S1 + catalog tests C1–C11.
2. For each migration in reverse: `prisma db execute --file <dir>/down.sql` then ~~`prisma migrate resolve --rolled-back <name>` (Prisma's documented down-migration workflow; `migrate resolve` only updates the history table, so the down SQL must run first)~~ mark the migration rolled back in the history table (see the amendment below).
3. `prisma migrate deploy` again → snapshot S2. Pass: `diff(S1, S2) = 0`, catalog tests green, and on the seeded run the row counts of reference tables equal the seed manifest. Migrations declared `reversible: no` (contract) are excluded from step 2 only when they are older than the current release, and their exclusion is printed.

**Amendment (2026-11-12, batch 0.2; D-ARCH-047; `rulings/batch-0.2-rulings.md` item 3): step 2 does not use `migrate resolve --rolled-back`.** Prisma's `migrate resolve --rolled-back` is defined only for a migration in the **failed** state: the Prisma docs state that the command "can only be used on failed migrations" (ORM docs, *Generating down migrations*), and on Prisma 7.10.1 applying it to a successfully finished migration fails with **P3012** "Migration `{name}` cannot be rolled back because it is not in a failed state" (verified by TASK-003 on PostgreSQL 18; the original step 2 copied the docs' down-migration recipe, whose context is a failed `up`). The driver `tools/db/up-down-up.ts` therefore, after `prisma db execute --file <dir>/down.sql` succeeds, marks the row itself through an injected `markRolledBack(name)` callback that runs, as `platform_migrator` (owner of `_prisma_migrations`), `UPDATE public._prisma_migrations SET rolled_back_at = now() WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL` and asserts exactly one row. `migrate deploy` then re-applies the migration, which is what step 3 needs (verified: `upIsRepeatable`). Boundaries: (a) this write is **test and development only** — the driver runs in the Testcontainers suite and `db:reset`-class local flows, never in CI/CD against a shared environment, where rollback stays roll-forward or restore-based (§8.2, CLAUDE.md §5); (b) the driver also snapshots **S0 before step 1** and requires `S_down = S0` when nothing was excluded, which proves each `down.sql` reverts its migration completely rather than merely letting `deploy` run again; (c) if `S_down ≠ S0` the driver stops before step 3 and reports the leftovers, because re-applying would collide with them. The `[NT-DATA-004-a]` empty-database half is claimed by `prisma/tests/migrations/up-down-up.int.test.ts`; the seeded half waits for TASK-023's seed framework.

**Amendment (2026-11-13, PR11-SEC-07, PR #11 code review §4 decision 4; D-ARCH-071): non-atomic files change the rollback reasoning.** TASK-016 proved that `migrate deploy` applies a file statement by statement with no file-level transaction (§8.3 rule 5 note). Three consequences:
1. **The failed state is a prefix, not "nothing".** A failed deploy leaves statements `1..k` applied, `_prisma_migrations.finished_at` NULL and the deploy stopped. The documented recovery — `down.sql`, then `prisma migrate resolve --rolled-back <name>`, then redeploy — is correct *for this state* (the migration is genuinely failed, so `resolve --rolled-back` is in scope; the P3012 restriction of the amendment above concerns *successful* migrations), **provided `down.sql` reverts any prefix**: rule 17 (`IF EXISTS` forms) is the text rule.
2. **Prefix reversibility is tested (owner TASK-024).** The driver `tools/db/up-down-up.ts` additionally, for every migration with `n` statements and every proper prefix `1..k` (`k < n`), applies the prefix statement by statement on a template clone (as `platform_migrator`, mirroring deploy), runs `down.sql`, marks the row rolled back and asserts the normalised schema equals the pre-migration snapshot; a `down.sql` that cannot revert a partial deploy is named with `k`. Cost is one clone per statement; the Testcontainers template clone is ~100 ms, so the Wave-0/1 migration set stays within the suite budget; if it grows beyond that, the check samples the prefixes that end a DDL statement and keeps full coverage for RLS/grant statements.
3. **Operational rule.** In CI/CD against a shared environment a failed deploy is still roll-forward or restore-based by default (§8.2, CLAUDE.md §5); the `down.sql` + `resolve --rolled-back` path is used only when the failed prefix is known safe (rule 9 b / rule 15 ordering) and the backup guardrail of §8.6 has run.

### 8.5 Throttled, resumable backfills

Backfills run in the worker (`housekeeping` queue, job `data-migration:<name>`), never inside `migration.sql` for large tables:

- Keyset batches by primary key (`WHERE id > $last ORDER BY id LIMIT $batch_size`), default 1,000 rows, each batch its own transaction; tenant tables are walked organisation by organisation (`org_ids_page`, §4.5) in that organisation's tenant scope, so RLS still applies, while GLOBAL and SYSTEM tables are batched directly, committing progress in `data_migration_runs.last_key` in the same transaction as the batch.
- Throttle: `pause_ms` between batches (default 200 ms), adaptive back-off when p95 API latency or replication lag exceeds thresholds (metrics read from the worker's own probes in M1; CloudWatch at M5); `PAUSED` status can be set at runtime.
- Idempotent per row (`UPDATE … WHERE new_col IS NULL`), so restarting from `last_key` is safe; completion recorded with row counts; every batch writes no audit entry, the run writes one `CONFIG_CHANGE` entry at start and at end (system actor).

### 8.6 Backup and restore rehearsal (guardrail before every data-changing migration)

Production (M5): RDS automated backups with PITR (RPO ≤ 5 min via continuous WAL archiving, NFR-REC-001), AWS Backup daily snapshots with cross-region copy, S3 versioning on document/raw buckets; the CD pipeline takes an on-demand snapshot, restores it to a temporary instance, runs the verification script and only then runs a `data-changing: yes` migration. This run (no AWS, $0) rehearses the same procedure on Compose (NFR-REC-003, weekly in CI and before each data-changing migration):

1. **Marker stream:** the rehearsal script creates a throwaway schema `rehearsal` (rehearsal stack only, never in migrations) and inserts a synthetic marker row every second during the backup; the restored maximum marker gives the observed data-loss window (NFR-REC-001, informational).
2. **Database backup:** `pg_dump --format=custom --file=platform.dump --dbname=platform` run as the Compose bootstrap superuser. `pg_dump` turns `row_security` off and errors when the dumping role cannot bypass RLS; because `FORCE` applies to the owner, the migrator cannot dump all rows — hence the superuser (Compose) or snapshots (RDS) (OI-16). Capture a manifest: per-table row counts (`SELECT count(*)` per table as superuser), `max(order_number)` per country, audit stream heads, `_prisma_migrations` head, document count and SHA-256 list.
3. **Object storage backup:** a Node script using `@aws-sdk/client-s3` copies the documents and raw-carrier buckets (all object versions' current version) from RustFS to a backup location (another bucket on a second RustFS container in the rehearsal stack), recording key, size and ETag (works against any S3-compatible endpoint; MinIO in NFR-REC-003 is superseded by RustFS).
4. **Restore into a fresh stack:** start an empty Postgres 18 + RustFS (`docker compose -p restore-<run>`), run the roles bootstrap (§4.4), `pg_restore --exit-on-error --jobs=4 --dbname=platform platform.dump`, copy the objects back.
5. **Verification script (`tools/db/verify-restore.ts`, exit 0 = pass):** row counts equal the manifest for every table; FK integrity (`ALTER TABLE … VALIDATE CONSTRAINT` is a no-op for restored validated constraints, so the script also runs generated anti-join orphan checks per FK from `pg_constraint`); catalog tests C1–C11 pass (roles, grants, RLS forced, triggers present); full audit chain verification (§5.6) passes and heads equal the manifest; `number_sequences.next_value` > allocated maximum per country; every `documents` row has an object whose recomputed SHA-256 equals `documents.sha256` (NFR-REC-003); `_prisma_migrations` head equals the manifest; a smoke API container boots against the restored DB and `/health/ready` is 200. Restore time is reported (≤ 15 min target, NFR-REC-002 sanity).
6. Archive the report as a CI artifact; a failed rehearsal blocks the data-changing migration (CLAUDE.md §5).

Amendment (2026-11-12, SEC-P3-03), applying to step 4 and step 5:
- **Step 4, what the bootstrap runs.** The restore runs **only** `prisma/bootstrap/00-roles.sql` before `pg_restore`. That file holds the cluster- and database-level statements that `pg_dump` does not carry: `CREATE ROLE`, role memberships, `ALTER ROLE … SET`, ~~`ALTER DATABASE … OWNER`~~ `REVOKE`/`GRANT CONNECT ON DATABASE` and the role-in-database `search_path` (*amended 2026-11-12, batch 0.2, D-ARCH-045: there is no database-owner transfer any more; the restore target is created by and stays owned by the bootstrap role*). Everything schema-scoped comes from the dump: `01-schemas.sql` content (including the extensions and the global default-privilege rows, which `pg_dump` emits as `CREATE EXTENSION` and `ALTER DEFAULT PRIVILEGES`), audit DDL and event triggers. Running `01-schemas.sql` first would make `pg_restore --exit-on-error` fail on `CREATE SCHEMA platform`. `pg_dump` emits event triggers at the very end of the archive, so they are created after every audit object has been restored with its owner. *Amended 2026-11-12 (SEC-P3-27): `00-roles.sql` now also creates `platform_schema_owner` and transfers `public` to it, and the dump carries the owner and ACL of both schemas. The guard derives the protected schema OIDs at call time (§5.2), so it protects the restored database without any per-database step, although every OID changes in a restore.*
- **Step 4, ordering is load-bearing.** Running `90-audit-ddl-guard.sql` before `pg_restore` would make the guard block the restore of the audit objects.
- **Step 5, added checks.** The verification also runs C13/C14 and the anchor checks of §5.6: the anchor log is dense and chained, signatures verify, and the restored `audit_anchors` equals the local file sink, which the rehearsal copies alongside the dump.

### 8.7 Zero-downtime probe (NFR-AVAIL-003)

CI starts the **previous release's** API image against the database migrated to the candidate schema, runs a k6 probe at 20 req/s across read and write routes during the expand migration and for 60 s after, and requires 0 failed requests; then runs the candidate image against the same schema. Together with the linter this proves that expand migrations are backward compatible with the code still running during a rolling or canary deploy.

---

## 9. Seed plan

REQ-DATA-001..017, REQ-RBAC-002/003/013, REQ-COMP-003/008, REQ-PRICE-020, REQ-NOTIF-005, D-020, D-022, DR-A27.

### 9.1 Rules

- Two seeds: **`reference`** (all environments, runs as `platform_migrator` because GLOBAL tables have no runtime write grant) and **`demo`** (never when `NODE_ENV=production`; runs as `platform_app` through the real services and `withTenantTx`, so RLS, audit and outbox behave as in production, REQ-DATA-001/002, EC-A41).
- Idempotent upsert by **natural key**; a second run yields identical row counts (REQ-DATA-001). Each dataset is hashed; `reference_dataset_versions` makes an unchanged dataset a no-op (no writes, no audit entry).
- Insert-only datasets (`fx_rates`, `compliance_packs` + sections, `pricing_config_versions` + children, `notification_templates`, `prohibited_items` of a pack version) are never updated: if the seed file for an existing natural key has a different content hash, the seed **fails** ("published version changed in place; add a new version").
- Every seeded row carries `source` (`ISO`, `SEED`, `SAMPLE`) and, where relevant, `reviewed_at = NULL` (unreviewed) (DR-A27, REQ-COMP-004).
- Seed actor = SYSTEM actor; configuration changes (packs, roles, pricing versions, templates, flags) write one `CONFIG_CHANGE` audit entry each in a SYSTEM shard (REQ-RBAC-013, REQ-COMP-008).
- Demo passwords come from `SEED_*` environment variables; the seed aborts before writing any user when `NODE_ENV=production` or when a password equals its local-only default outside local/test (REQ-DATA-002); passwords are never printed.
- No legacy data is used anywhere; all demo data is synthetic (product brief §13 rule 9).

### 9.2 Reference seed

| Dataset | Natural key | Content | Source / review |
|---|---|---|---|
| `currencies` | `code` | ISO 4217 in use: USD, INR, GBP, CAD, EUR, AUD, AED (+ all with minor units for completeness) | `ISO` |
| `countries` | `code` | All ISO 3166-1 (alpha-2/3, numeric, en/es/fr names), currency, unit system (IMPERIAL US, METRIC others), postcode regex + example (curated for launch, AU, AE, EU; others `CITY_ONLY`), location type, address format, default zone, `shipping_enabled` for US, IN, GB, CA, AU, AE + EU-27 (A-049) | `ISO`; formats `SEED`; es/fr names `translation_reviewed = false` |
| `subdivisions` | `code` | US 50 + DC + territories; CA 10 + 3; IN 28 + 8; primary IANA zone each | `ISO` |
| `holidays` | `(country, region, date, name_en)` | 2026–2027 national holidays US, IN, GB, CA | `SAMPLE`, unreviewed |
| `hs_codes` | `code` | ≥ 200 six-digit headings, en descriptions (es/fr where available) | `SAMPLE` |
| `export_reasons`, `incoterms` | `code` | 8 reasons; 11 Incoterms 2020, DAP default, DAP/DDP courier-usable | `SEED` |
| `fx_rates` | `(base, quote, as_of)` | Snapshot among USD, INR, GBP, CAD, EUR (both directions) | `SEED` (D-019) |
| `carriers`, `carrier_services` | `code`, `canonical_code` | MOCK (`MOCK_EXPRESS` 1–3 d, `MOCK_STANDARD` 3–5 d, `MOCK_ECONOMY` 5–9 d; all capabilities except landed cost), DHL Express, FedEx, UPS with ≥ 3 services each (limits, divisors 5000/139, cut-offs, liability terms) | `SEED`/`SAMPLE`, unreviewed |
| `carrier_accounts` | `code` | `MOCK_DEFAULT` (non-production), `DHL_PLATFORM_SANDBOX`, `FEDEX_PLATFORM_SANDBOX`, `UPS_PLATFORM_SANDBOX` with `secret_ref` names only (`env:…`) | `SEED` |
| `transit_days` | `(service, origin, destination)` | Every Mock service on every enabled lane; indicative DHL/FedEx/UPS on US→IN, US→CA, US→GB, US→US, IN→US, GB→US, CA→US | `SAMPLE` |
| `compliance_packs` + sections | `(country, version)` | US, IN, GB, CA, EU v1: tax rules (IN GST, GB VAT, CA GST/HST, US sales tax not collected on international by default), de-minimis, customs lanes, identity references (US→IN receiver references), privacy notice en/es/fr, consent rule, retention periods | `SEED`, `reviewed_at NULL` |
| `prohibited_items` | `(pack, item_key)` / `(carrier, item_key)` | Entries for every enabled-lane destination + per carrier, en/es/fr names, keywords, HS prefixes | `SAMPLE`, unreviewed |
| `permissions`, `roles`, `role_permissions` | `key`, `key`, `(role key, permission key)` | ~~From the `packages/authz` catalogue … the seed adds links only when the catalogue version increases~~ *Amended 2026-11-12 (D-T013-08, ADR-0008 am. 2, D-ARCH-060):* **not written by the reference seed.** The rows come from the generated versioned migration `prisma/migrations/<ts>_authz_seed_v<N>/` (40 permissions, 17 roles, 182 links at v1; deterministic UUIDv7 ids; `INSERT … ON CONFLICT DO NOTHING`; `created_by` = SYSTEM actor), so `migrate deploy` is the only writer and applied migrations are immutable: a grant change bumps `CATALOGUE_VERSION` and ships a new migration (REQ-RBAC-002 "never widens without a migration"; a narrowing migration is `data-changing: yes`, §8.3 rule 10). The reference seed's `authz` step (TASK-023) **verifies** parity between `packages/authz` and the three tables and fails on drift; the US-073 task (TASK-221) runs a **post-migrate reconciler** as `SYSTEM_JOB` (PR8-SEC-09): it digests the three tables as read from the database, compares with the last audited digest ~~in `reference_dataset_versions(dataset = 'authz_matrix', version, content_sha256)`~~ **read from the audit log itself — the latest `CONFIG_CHANGE` entry for `authz_matrix` in `audit_entries`** *(amended 2026-11-13, PR13-SEC-04/-08, PR #13 code review ruling on D-TASK023-01 (01); D-ARCH-075: `platform_app` holds `SELECT` only on `reference_dataset_versions`, so the reconciler writes no digest row there; the dataset name `authz_matrix` stays reserved and keys the audit entries; a `down.sql` therefore has no digest row to drop and a down → up cannot produce a second baseline; the dataset label column is `dataset_version`, §3.5)*, writes one `CONFIG_CHANGE` audit entry per changed version (role, old → new permission set; the first run back-fills the baseline ∅ → current) and writes nothing when the digest is unchanged — a re-run writes nothing (REQ-RBAC-013); a migration never inserts into `audit_entries`. *The same reconciler also audits every other audited dataset's `(dataset, dataset_version, content_sha256)` row and the drift-restore counter of §3.5, because the seed path runs as the migrator and may not write audit tables (D-ARCH-075).* Released seed directories are pinned by SHA-256 in `tools/authz/generate.ts` and never rewritten (PR8-SEC-01). The matrix document `docs/03-architecture/generated/role-permission-matrix.md` is generated from the same source | migration (`authz:generate`) |
| `shipment_state_rules`, `payment_status_rules` | `(from, to)` | DR-B01, DR-B27 from `packages/shared` | `SEED` |
| `pricing_config_versions` + rules | `version_key` / `(version, rule_key)` | v1: default margin 15 % (priority −1000), fuel rows per carrier with non-overlapping ranges, cover terms 2 % / min 5.00 / max 5000 USD, discount examples, volume tiers 10 → 3 %, 50 → 5 %; coupons (demo codes only in the demo seed) | `SEED` (A-060) |
| `notification_templates` | `(key, variant, version, locale)` | Every DR-B28 template in en/es/fr, v1 | `SEED` |
| `feature_flags` | `key` | Registered flags with defaults (`false` unless stated) | `SEED` |
| `number_sequences` | `(scope, country)` | `ORDER` for every shipping-enabled origin (`allocation_enabled = true`, `next_value = 1` **only on insert; never reset**); `INVOICE`/`CREDIT_NOTE` with `allocation_enabled = false` | `SEED` |
| Reserved users | `id` | SYSTEM and ANONYMOUS actors (§1.6) | `SEED` |
| Audit partitions | — | `SELECT platform.ensure_audit_partitions(3)` (idempotent) | — |

### 9.3 Demo seed (non-production only)

| Item | Natural key | Content |
|---|---|---|
| Operator organisation | deterministic seed UUID (`seedId('org:operator')`, a UUIDv7-shaped id derived from a namespace hash with a fixed 2026-01-01 timestamp) | type OPERATOR, placeholder brand name from `BRAND_*` |
| 8 staff users | `email` (`superadmin@operator.example`, `admin@…`, `operations@…`, `finance@…`, `support@…`, `sales@…`, `auditor@…`, `content@…`) | One per operator role, verified email, **no TOTP** (must enrol at first sign-in, REQ-AUTH-018, D-022). Amended 2026-11-12 (SEC-P3-14): with `APP_ENV ∈ {local, test}` the seed sets a `SEED_*` password. Otherwise it creates **no `user_credentials` row** and issues a `password_reset_tokens` row with `purpose = 'SET_PASSWORD'` (24 h), whose link is e-mailed. The first TOTP enrolment then needs the e-mailed enrolment code (`mfa_enrolment_codes`), and the 24 h enrolment deadline applies (§3.1) |
| Acme Exports | `seedId('org:acme-exports')` | BUSINESS_CUSTOMER, country US, USD |
| 5 Acme users | `email` (`owner@acme-exports.example`, `admin@…`, `shipper@…`, `finance@…`, `viewer@…`) | One per customer role, each also with a personal INDIVIDUAL org (REQ-AUTH-001 invariant) |
| Individual customer | `individual@customer.example` | Personal org only |
| Sample address book, saved quote, demo coupon | `(org, label)`, `seedId(...)`, `code` | Synthetic US and IN addresses (`.example` emails, fictional names and 555-style numbers) |

Users are created through the identity service (bcrypt cost from config) so that credentials, memberships, roles, audit entries and outbox events (`auth.email_verification` is suppressed for seeded verified users) are produced exactly as in production. Re-running finds users by email and orgs by seed id and changes nothing.

---

## 10. Volume and sizing, partitioning outlook, caching, data protection, retention, open issues

### 10.1 Volume projections

Baseline: the legacy aggregate shape (product brief Appendix A: 12,500 customers, 16,700 orders, 15,600 payments, 221,000 shipment rows of which ≈ 55,000 booked, 247,000 packages, 83,000 address-book entries) treated conservatively as **one year** of activity, multiplied by **10** for the §9 headroom target (A-028), then grown 50 % per year. Quotes are sized from the new behaviour (every rate request persists a quote with ≈ 9 options) rather than from legacy rows. Row sizes include tuple overhead; index factor is per table.

| Table | Y1 rows (design) | Y3 cumulative | Y5 cumulative | Avg row | Y5 heap + idx (est.) |
|---|---|---|---|---|---|
| `organisations` / `users` | 125 k | 0.6 M | 1.7 M | 0.5 kB | 2 GB |
| `address_book_entries` | 0.83 M | 3.9 M | 11 M | 0.4 kB | 9 GB |
| `quotes` | 5 M | 24 M | 66 M | 0.8 kB | 110 GB (without retention) |
| `quote_options` | 45 M | 214 M | 594 M | 1.5 kB (snapshot JSONB) | 1.3 TB (without retention) |
| `shipments` | 0.8 M | 3.8 M | 10.6 M | 1.2 kB | 25 GB |
| `shipment_parties` | 1.6 M | 7.6 M | 21 M | 0.4 kB | 15 GB |
| `customs_items` | 1.5 M | 7.1 M | 20 M | 0.25 kB | 8 GB |
| `shipment_state_transitions` | 6 M | 28 M | 79 M | 0.2 kB | 25 GB |
| `shipment_price_snapshots` | 1.6 M | 7.6 M | 21 M | 2 kB | 60 GB |
| `orders` / `payments` | 0.17 M / 0.18 M | 0.8 M | 2.3 M | 0.4 kB | 2 GB |
| `documents` (metadata) | 2.2 M | 10 M | 29 M | 0.3 kB | 14 GB (objects ≈ 150 kB each in S3: 4.4 TB at Y5) |
| `tracking_events` | 6.6 M | 31 M | 87 M | 0.4 kB | 60 GB |
| `notification_log` | 4.4 M | 21 M | 58 M | 0.4 kB | 40 GB |
| `audit_entries` | 50 M | 238 M | 660 M | 1.0 kB | ≈ 1.6 TB (10 indexes; ≈ 4–15 M rows per monthly partition) |
| `audit_pii_vault` | 10 M (dedupe per subject/field/value) | 48 M | 132 M | 0.2 kB | 40 GB |
| `outbox_events` | 20 M/yr flowing; ≤ 0.5 M resident (7-day purge) | — | — | 0.5 kB | < 1 GB |
| `idempotency_keys` | ≤ 0.1 M resident (24 h) | — | — | 1 kB | < 0.2 GB |
| `audit_checkpoint_heads` (2026-11-12, hourly deltas) | ≈ 25 M (≈ 50–100 k/day: streams whose head moved in the hour) | ≈ 120 M | ≈ 330 M | 0.12 kB | ≈ 70 GB (candidate for monthly range partitions on `created_at` at M5, archived with the audit partitions) |
| `audit_anchors` (2026-11-12) | 8,760 | 26 k | 44 k | 0.3 kB | < 20 MB |

Peak write rates at design load: ≈ 20 quote inserts/s (≈ 180 option rows/s), ≈ 5 bookings/s, ≈ 40 audit entries/s, ≈ 20 tracking events/s — comfortably within one RDS PostgreSQL Multi-AZ instance (e.g. `db.r7g.xlarge` class, sized by platform-architect).

### 10.2 Partitioning outlook

- **Now:** only `audit_entries` (monthly range, ADR-0007).
- **Quotes and options** dominate growth. With a retention rule that deletes unclaimed, unsaved, expired quotes after 90 days (OI-17), the resident set stays ≈ 1.3 M quotes / 11 M options and no partitioning is needed. Without retention, convert `quotes`, `quote_packages`, `quote_options` to monthly range partitions on `created_at` at M5 (PK becomes `(created_at, id)`; the FK from `shipments` needs `(quote_created_at, quote_id)`), using expand (new partitioned tables + dual-write) → migrate (backfill) → contract.
- **`tracking_events`, `notification_log`, `shipment_state_transitions`** reach 60–90 M rows by Y5; candidates for monthly partitions at M5 if their list queries (all `org_id`/`shipment_id`-led) degrade; not needed for M1 targets.

### 10.3 Replicas and caching

- **Replicas (M5):** one RDS read replica for the audit viewer, exports and reports (RLS applies on replicas; settings are per transaction). The primary serves all M1 traffic.
- **Caching (Redis / in-process):** reference data and compliance packs in process memory keyed by dataset version, HTTP `ETag` + `max-age=3600` (REQ-DATA-016); pricing configuration per version in memory; feature flags ≤ 30 s (REQ-PLAT-020); effective permissions ≤ 5 s (REQ-RBAC-008); carrier rate responses 300 s (DR-B15); service points 1 h; carrier OAuth tokens until 60 s before expiry (REQ-CARR-016). No business row is cached across requests.

### 10.4 Data protection

| Control | Design | Source |
|---|---|---|
| Classification | Every column tagged (§3); the registry in `packages/audit` drives audit tokenisation, Pino redaction and the C10 test | REQ-AUDIT-009, NFR-PRIV-001/003 |
| Encryption at rest | RDS/EBS/S3/ElastiCache encryption (M5); field-level AES-256-GCM envelope encryption for `mfa_totp.secret_ciphertext`, `shipment_party_identifiers.value_ciphertext`, `audit_pii_vault.ciphertext`, `idempotency_keys.response_body` and the outbox `payload.token_enc` (key per purpose and environment from env/KMS; sibling `<col>_key_id` and AAD per the amendment below); partner carrier credentials (M3) use per-tenant KMS data keys | product brief §4.3/§4.11/§4.12, ADR-0006/0007/0018 |
| Hashing | All tokens SHA-256 (256-bit randomness); passwords bcrypt ≥ 12; recovery codes HMAC-SHA256 under `RECOVERY_KEY` (ADR-0006; amended 2026-11-12, was "bcrypt"); identifiers used for lookups without disclosure are HMAC-SHA256 with per-purpose, per-environment keys (`login_attempt_counters`, `audit_entries.ip_hash`, vault dedupe, `mfa_challenges.ip_prefix_hmac`, `mfa_enrolment_codes.code_hmac`, public tracking hashes), each with a sibling `<col>_key_id` | DR-A01/A02, ADR-0018 |
| Secrets | No secret values in any column; carrier accounts hold `secret_ref` names only (CHECK pattern) | REQ-CARR-015, CLAUDE.md §5 |
| Public exposure | Public tracking resolves through `tracking_index` and returns only the DR-B31 fields; shared quotes return the allow-listed `public_snapshot` via `quote_share_resolve`; both are enforced by response-schema tests | DR-B31, NFR-PRIV-004 |
| Non-production data | Never production data outside production (product brief §10); environments use the synthetic demo seed. If a masked copy is ever needed (M5), the masking job applies the registry: `PER` → deterministic synthetic values (same input → same fake per run), `SPER` → removed and re-encrypted with a test key, `SEC` → removed (users must reset), vault ciphertext re-encrypted or dropped with a new chain started in the copy | §10 product brief |
| Erasure | Audit: vault deletion (§5.7). Operational tables (M4/M5): hard delete or anonymisation of `PER` columns by the retention job under `platform_erasure`-class privileges, keeping financial records per retention periods | A-045, D-027 |

#### Amendment (2026-11-12, SEC-P3-08 item 1): `key_id` siblings and AAD for every ciphertext and HMAC lookup column

This amendment follows the ADR-0018 amendment 1 key register. That register's configuration schema rejects identical values across any two keys (one key per purpose); this document only references that rule.

**Rules**
- **`key_id` sibling.** Every ciphertext column and every HMAC lookup column has a sibling `<col>_key_id text`. It is `NOT NULL` whenever the value column is non-null: either both columns are `NOT NULL`, or a pairing `CHECK ((col IS NULL) = (col_key_id IS NULL))` applies. The format is `<purpose>-v<n>`, enforced with `CHECK (… ~ '^[a-z][a-z0-9-]*-v[0-9]+$')`. Writes use the current key. Reads select the key by the stored `key_id`, so they are dual during rotation (the current key and `<NAME>_PREVIOUS`). HMAC lookups compute the hash under every live key and query `= ANY($hashes)`.
- **AES-256-GCM parameters.** A 96-bit random nonce per encryption and a 128-bit tag; the stored value is `nonce ‖ ciphertext ‖ tag`.
- **AAD.** AAD = table ‖ column ‖ row id or token ‖ key_id, encoded unambiguously as `UTF-8(JCS([table, column, row_ref, key_id]))` (RFC 8785, the canonicaliser already used by `packages/audit`). `row_ref` is the lower-case UUID text, or lower-case hex for `bytea` references. Because every row ID is generated by the application before the insert (P1), the AAD is known when the value is encrypted.
- **Why AAD.** A ciphertext copied to another row, column or key version fails GCM authentication (T-89).
- **Rotation.** A rotation is a throttled, resumable re-encryption or re-keying backfill (§8.5) filtered by `<col>_key_id`. The retired key is removed only after a count by `key_id` reaches 0. Exceptions: login counters, and vault dedupe as noted below.

| Table.column | Kind · key (ADR-0018 register) | Sibling `key_id` column | AAD row reference |
|---|---|---|---|
| `mfa_totp.secret_ciphertext` | AES-256-GCM · `MFA_ENCRYPTION_KEY` | `secret_ciphertext_key_id` (renamed from `key_id`) | `mfa_totp.id` |
| `mfa_recovery_codes.code_hmac` | HMAC-SHA256 · `RECOVERY_KEY` | `code_hmac_key_id` | — (HMAC) |
| `mfa_challenges.ip_prefix_hmac` | HMAC-SHA256 · IP-prefix binding key (**register entry to add**) | `ip_prefix_hmac_key_id` | — |
| `mfa_enrolment_codes.code_hmac` (new) | HMAC-SHA256 · enrolment-code key (**register entry to add**) | `code_hmac_key_id` | — |
| `login_attempt_counters.identifier_hmac` | HMAC-SHA256 · `LOGIN_COUNTER_KEY` | `identifier_hmac_key_id` | — (no dual read; counters restart) |
| `audit_pii_vault.ciphertext` | AES-256-GCM · `AUDIT_VAULT_KEY` | `ciphertext_key_id` (renamed from `key_id`) | `audit_pii_vault.token` |
| `audit_pii_vault.value_hmac` | HMAC-SHA256 · vault dedupe key (**register entry to add**; must not reuse `AUDIT_VAULT_KEY`) | `value_hmac_key_id` | — (no dual read: a new key yields a new token) |
| `audit_entries.ip_hash` | HMAC-SHA256 · `AUDIT_INDEX_KEY` | `ip_hash_key_id` | — (IP filter queries both ids for 90 d, per the register) |
| `tracking_index.customer_ref_postcode_hmac` | HMAC-SHA256 · `TRACKING_INDEX_KEY` | `customer_ref_postcode_hmac_key_id` | — |
| `outbox_events.payload.token_enc` | AES-256-GCM · `OUTBOX_PAYLOAD_KEY` | JSON sibling `payload.token_enc_key_id` | `outbox_events.id` (column name `payload.token_enc`) |
| `idempotency_keys.response_body` | AES-256-GCM · `IDEMPOTENCY_BODY_KEY` | `response_body_key_id` | `idempotency_keys.scope_hash` (hex) |
| `shipment_party_identifiers.value_ciphertext` | AES-256-GCM · shipment-identifier key (**register entry to add**; KMS envelope at M5) | `value_ciphertext_key_id` (renamed from `key_id`) | `shipment_party_identifiers.id` |
| `carrier_accounts.credentials_ciphertext` (M3 seam) | AES-256-GCM · per-tenant KMS data key (ADR-0011) | `credentials_ciphertext_key_id` | `carrier_accounts.id` |
| `user_credentials` | bcrypt pre-hash pepper `PASSWORD_PEPPER` | `pepper_key_id` **reserved**: added by the SEC-P3-16 backlog item, not now | — |

Not in the table: token hashes (`token_hash`, `share_token_hash`, `guest_token_hash`, `scope_hash`, `fingerprint`, `dedupe_key`). They are unkeyed SHA-256 values of 256-bit random tokens or of content; no key is involved, so they carry no `key_id`. Verification: SEC-TC-49 (a vault ciphertext swapped between two rows fails authentication; a read with the retired key works while new writes use the current key; the catalog check C10 is extended to assert that each column in the table above has its sibling).

### 10.5 Retention (recorded, not enforced in this run)

Retention periods are data in the compliance packs (`RETENTION` section, NFR-PRIV-005); jobs arrive in M4/M5. Engineering housekeeping that **is** enforced now (hard-delete allow-list, §4.4, and `purge_expired_tokens`, §4.5):

| Data | Rule in this run | Proposed long-term default (pack data, unreviewed) |
|---|---|---|
| Verification/reset tokens, MFA challenges, re-auth proofs | delete 7 days after expiry | same |
| Refresh tokens | delete 7 days after expiry/revocation | same |
| Idempotency keys | delete after 24 h | same |
| Outbox events / processed events | delete 7 / 30 days after publish/processing | same |
| Login attempt counters | delete 30 days after last failure | same |
| Unclaimed expired guest quotes | kept (DR-B14: no deletion during the run) | delete after 90 days (OI-17) |
| Drafts | CANCELLED after 30 days idle (REQ-ACCT-004); rows kept | anonymise after pack period |
| Shipments, orders, payments, documents | kept | per pack (tax/accounting periods, e.g. 6–10 years) |
| Audit entries | kept; partitions never dropped or detached (REQ-AUDIT-018) | archive closed partitions to S3 Object Lock at M5; DB retention per pack |
| Notification log | kept | 2 years |

### 10.6 Open issues for principal-architect

Alignment note: ADR-0005 and ADR-0007 (both Accepted, with threat-model amendments dated 2026-11-12) were published while this document was being written. The model above follows them: definer functions plus global index tables instead of a worker cross-tenant scope, a read-only operator branch with `app_is_operator()`, audit tables as SYSTEM class, a 16-shard SYSTEM stream, and tokenised IP, user agent and reason. Items the ADRs already settle are listed as resolved so reviewers can trace earlier drafts.

| ID | Issue | Proposal in this document | Owner / action |
|---|---|---|---|
| OI-01 | Cross-tenant discovery for worker schedulers | **Resolved** by ADR-0005 amendment 1: candidate definer functions (§4.5) and global index tables; no worker scope | — |
| OI-02 | ADR-0005 makes the definer functions owned by `platform_migrator`, but with `FORCE ROW LEVEL SECURITY` and policies `TO platform_app` only, a function running as the owner sees zero rows | Narrow `TO platform_migrator` policies (`FOR SELECT USING (true)` on the tables the functions read; `FOR DELETE` with an expiry predicate on token tables), asserted by C3. Tighter alternative: a dedicated `NOLOGIN` owner role for the functions so the migrator login role never gains read-all | principal-architect: ratify, or amend ADR-0005 with the dedicated owner role |
| OI-03 | Anonymous shared-quote reads | **Resolved** by ADR-0005 amendment 1: `quote_share_resolve` returning the allow-listed `public_snapshot` | — |
| OI-04 | Public tracking without tenant context | **Resolved** by ADR-0005 amendment 1: `tracking_index` global index table; this document adds `customer_ref_postcode_hmac` to it for REQ-TRACK-009 | principal-architect: confirm the added column |
| OI-05 | Global `entry_hash` uniqueness on a partitioned table | **Resolved** by ADR-0007 ("UNIQUE per partition; chain enforces across partitions"). This document adds `stream_seq` (= head `entry_count` + 1) as the explicit chain order and gap detector | principal-architect: confirm `stream_seq` |
| OI-06 | Personal data in audit columns | **Resolved** by ADR-0007 amendment 2 (`ip`, raw UA, `reason`, list-filter values tokenised; `ip_hash` + `ip_coarse` in clear) | — |
| OI-07 | `CHAIN_CHECKPOINT` is not in the REQ-AUDIT-002 action list; DR-B28 names `MFA_RECOVERY_USED` and `SESSION_REVOKED` actions that REQ-AUDIT-002 lacks; a checkpoint value listing every stream grows with the number of organisations | Checkpoint = `CREATE` on entity `chain_checkpoint`, value lists heads (ADR-0007) and falls back to digest + `audit_checkpoint_heads` above 10,000 streams; recovery-code use = `UPDATE` on `mfa_recovery_code`; session revocation = `UPDATE` on `session`. If PM prefers dedicated actions, the CHECK widens in an expand migration | product-manager via principal-architect |
| OI-08 | NFR-DATA-003 says 100 % of tables carry `updated_at/updated_by/version`; `audit_entries` is immutable | Exempt `audit_entries` (documented exemption list in the introspection test) | principal-architect: ratify; PM may reword NFR |
| OI-09 | `quote_packages` guest-capable | **Resolved** by ADR-0005 (lists it) | — |
| OI-10 | NFR-PRIV-004 (log stores recipient user ID only, no full address) vs REQ-NOTIF-012 (recipient address as at send time) | Store `recipient_user_id` + masked address `a***@domain` | product-manager: align wording |
| OI-11 | Classification vocabulary differs (NFR-PRIV-003 examples vs REQ-AUDIT-009/ADR-0007) | REQ-AUDIT-009 five levels | product-manager: align NFR example |
| OI-12 | Prisma preview features: `partialIndexes`, `tables.external`; partition children in the differ; `CREATE INDEX CONCURRENTLY` submission | P5 spike in the first DB task; fallbacks documented in §7.3/§8.3 | senior-developer (P4 task) |
| OI-13 | No requirement enumerates order statuses | `OPEN, CHECKOUT_PENDING, AUTHORISED, BOOKING, COMPLETED, PARTIALLY_COMPLETED, FAILED, CANCELLED` | api-designer: align OpenAPI enum |
| OI-14 | Pickup zone = sender address zone; multi-zone US states/CA provinces use the subdivision's primary zone | Approximation flagged; postcode → zone mapping later | principal-architect: accept as known limitation |
| OI-15 | The P3 brief puts `audit_pii_vault` deletion in `platform_app`'s hard-delete list | Dedicated `platform_erasure` role (unused until M4/M5); `platform_app` cannot delete vault rows | principal-architect: ratify tightening |
| OI-16 | `pg_dump` cannot dump FORCE-RLS tables as the owner | Compose rehearsal dumps as the bootstrap superuser; RDS uses snapshots/PITR | platform-architect: reflect in backup runbook |
| OI-17 | Quote/option growth (≈ 600 M option rows by Y5 without retention) | Retention: delete unclaimed, unsaved, expired quotes after 90 days (needs a PM decision; DR-B14 says no deletion during this run) | product-manager: decide for M4/M5 |
| OI-18 | SYSTEM audit stream contention | **Resolved** by ADR-0007 amendment 1 (16 shards) | — |
| OI-19 | `quote_claim_state(id)` in ADR-0005 reveals claim state for any quote id | Add the guest-token-hash argument and the retained `quotes.claimed_from_token_hash` so only a holder of that quote's token learns "claimed elsewhere" | principal-architect: confirm signature |
| OI-20 | `LAST_OWNER` is 422 in REQ-ORG-013/DR-A26 and 409 in REQ-ACCT-015/EC-B46 | Not a data issue; flagged for consistency | product-manager / api-designer |
| OI-21 | `hashtext` is 32-bit; unrelated streams can share a lock slot | Harmless (extra serialisation only); `hashtextextended(…, 0)` is an optional improvement | principal-architect: optional |
| OI-22 | NFR-REC-003 names MinIO; the P3 brief fixes RustFS | Rehearsal uses the S3 API only; works with either | product-manager: update NFR text |
| OI-23 | `shipment_state_rules` / `payment_status_rules` duplicate the TS state maps for DB backstop triggers | Kept small, seeded from code, equality-tested | principal-architect: confirm backstop is wanted |
| OI-24 | M1 guardrail CHECKs (`payments.livemode = false`, `carrier_accounts.environment = 'SANDBOX'`, `on_behalf_of_org_id IS NULL`, `surcharge_rules.kind = 'FUEL'`, `payments.method_type = 'CARD'`) must be relaxed when the respective milestone or G4 production approval arrives | Each relaxation is its own reviewed expand migration | release-manager / principal-architect |
| OI-25 | Cross-user session revocation (membership removal, user status change) touches another user's USER_OWNED `sessions` rows | Done by a worker job reacting to the outbox event, running with `app.actor_id` = the affected user (audit actor type `SYSTEM_JOB`, initiator in `details`); the Redis revocation set gives the ≤ 5 s effect (REQ-AUTH-009) | principal-architect + threat-modeler: ratify |

---

## 11. Handoff Report

- **Agent:** data-architect  **Phase:** P3 Architecture  **Task/Scope:** physical data model for M0 + M1 (`docs/03-architecture/data-model.md`)
- **STATUS:** DONE (Draft for G2; the open items in §10.6 need principal-architect ratification)
- **Summary:** Complete physical model (≈ 90 tables across 16 modules) with column types, nullability, constraints, tenant class, soft-delete flag, per-column classification and named access patterns with supporting indexes; RLS templates per class aligned with ADR-0005 as amended, the exact `set_config` statement, roles, grant matrix, the allow-listed definer-function list (§4.5, as ADR-0005 requires) and 12 catalog tests; partitioned, trigger-protected, hash-chained audit store aligned with ADR-0007 as amended (16 SYSTEM shards, tokenised IP/UA/reason, signed checkpoints); outbox, idempotency, saga and number-sequence DDL with the exact allocation SQL; Prisma 7 mapping; expand→migrate→contract rules, migration linter, up→down→up test, backfill runner, backup/restore rehearsal and zero-downtime probe; reference and demo seed plan; sizing, retention and data-protection notes.
- **Artifacts written/changed:** `docs/03-architecture/data-model.md` (new). No code, Prisma files or other documents changed.
- **Evidence:** Prisma 7 facts checked on prisma.io/docs and the Prisma changelog on 2026-11-12 (driver adapters, `prisma-client` generator output, `prisma.config.ts`, `$use` removal, `partialIndexes` preview since 7.4, `tables.external` preview, down-migration workflow); PostgreSQL 18 `uuidv7()` from release notes. Cross-checked against ADR-0005 and ADR-0007 (Accepted). No commands run against a database (design phase).
- **Decisions made (for principal-architect to log in DECISIONS.md/ADRs where not already covered):** CHECK-constrained text instead of PG enums; `stream_seq` + `audit_stream_heads.entry_count`; definer-read policies `TO platform_migrator` (OI-02); `platform_erasure` role (OI-15); `quote_claim_state` with token-hash argument (OI-19); worker-based cross-user session revocation (OI-25); `customer_ref_postcode_hmac` on `tracking_index`. All reversible by migration.
- **Assumptions / defaults applied:** legacy shape ≈ one year of activity, ×10 headroom, +50 %/yr growth for sizing; 90-day quote retention proposed but not applied; subdivision primary time zone for pickups.
- **Optional questions (non-blocking):** OI-07, OI-10, OI-11, OI-13, OI-17, OI-20, OI-22 for product-manager/api-designer, defaults already applied as stated.
- **Risks / follow-ups:** Prisma preview features and partition handling (OI-12, MEDIUM, senior-developer spike in the first DB task); definer ownership under FORCE RLS (OI-02, MEDIUM, principal-architect); quote table growth (OI-17, MEDIUM at M5, product-manager).
- **Recommended next agent & action:** principal-architect: ratify OI-02, OI-08, OI-15, OI-19, OI-25 and the added `tracking_index` column; api-designer: align enums (order status, document formats, audit actions) and public endpoints with §3; threat-modeler: review the §4.5 function list; senior-developer: plan the DB foundation tasks (bootstrap roles, initial migration, RLS renderer, linter, rehearsal) with the P5 spike first.


## 12. Principal-architect ratification and reconciliation (2026-11-12)

This section records the architect's decisions on the open items raised in §10.6 and reconciles the model with the API contract (`api/openapi.yaml`). Where it conflicts with earlier sections, this section wins; the earlier text is updated in P5 Wave 0 when the Prisma schema and SQL migrations are written.

| Item | Decision | Rationale / consequence |
|---|---|---|
| OI-02 — owner of the SECURITY DEFINER functions | **Ratified with one change:** the §4.5 functions are owned by a dedicated `NOLOGIN` role **`platform_definer`** (no table ownership, no DDL), which holds only the narrow policies drafted in §4.4 as `TO platform_migrator` (SELECT on the tables the functions read; DELETE with the expiry predicate on token tables). `platform_migrator` keeps no runtime policies. | A definer function runs with its owner's privileges; a defect in one must not run as the schema owner. ADR-0005 amendment 6 records this. Grant: `platform_app` EXECUTE on the functions only. |
| OI-05 — `entry_hash` uniqueness | **Ratified:** `UNIQUE (entry_hash, occurred_at)` per partition plus `stream_seq bigint` (dense per stream); the verifier checks global uniqueness and gap-free `stream_seq`. | PostgreSQL cannot enforce a global unique on a partitioned table without the partition key; the chain itself is the global guarantee (ADR-0007 amendment 6). |
| OI-07 — checkpoint size | **Ratified:** the nightly `CHAIN_CHECKPOINT` value holds the SHA-256 digest of the ordered `(stream_id, head_hash, stream_seq)` list plus the count; the full list lives in `audit_checkpoint_heads(checkpoint_entry_id, stream_id, head_hash, stream_seq)`; the external anchor signs the digest. | Keeps the entry small above 10 000 streams without losing verifiability. |
| OI-08 — `audit_entries` exempt from standard columns | **Ratified:** append-only tables (`audit_entries*`, `audit_pii_vault`, `audit_checkpoint_heads`, `outbox_events`, `processed_events`) are exempt from `updated_at/updated_by/version`; `id`, `created_at`-equivalents remain. | A row that can never be updated has no version. product-manager to add the exemption to NFR-DATA-003 (D-ARCH-006 list). |
| OI-15 — vault deletions by `platform_erasure` | **Ratified:** a separate `platform_erasure` role (used only by the M4/M5 erasure job task) holds DELETE on `audit_pii_vault` and on erasure-scoped document rows; `platform_app` never holds DELETE there. | Least privilege; ADR-0007 §erasure updated by reference. |
| Token purges via `purge_expired_tokens()` | **Ratified** (owned by `platform_definer`, scheduled by `housekeeping`). | Token tables are USER_OWNED; the API never needs a DELETE grant on them. |
| OI-19 — `quote_claim_state(id, guest_token_hash)` | **Ratified**, including the retained `claimed_from_token_hash` column. | Prevents probing claim state of arbitrary quote IDs (threat-model T-79 family). |
| OI-25 — revoking another user's sessions via a worker job | **Ratified with a constraint:** the API writes the Redis revocation set (`auth:revoked:<sid>`) synchronously for every affected session so REQ-AUTH-009's ≤ 5 s holds; the `sessions.revoked_at` update runs in the job scoped to that user. Session IDs of the affected user are read through the definer function `sessions_for_user(user_id)` (returns IDs only). | Keeps `sessions` USER_OWNED without delaying revocation. |
| `app_org_id()` returns NULL on malformed values | **Ratified** (fail closed, no cast error). | Same semantics as ADR-0005 §policies. |
| `tracking_index.customer_ref_postcode_hmac` | **Ratified:** HMAC-SHA256(`TRACKING_INDEX_KEY`, customer_reference ‖ postcode) enables `POST /public/tracking/lookup` without personal data in clear; `postcode` and `customer_reference` are never stored in the index. | Supports ADR-0016 amendment 2 (token-free, PII-free public lookups). |
| OI-13 — order status enum | **Reconciled to the API contract:** `OPEN`, `PENDING_PAYMENT`, `PAID`, `BOOKING`, `BOOKED`, `PARTIALLY_BOOKED`, `FAILED`, `CANCELLED` replaces `OPEN, CHECKOUT_PENDING, AUTHORISED, BOOKING, COMPLETED, PARTIALLY_COMPLETED, FAILED, CANCELLED` in §1.6 and §3 (`orders.status` CHECK). Mapping: `CHECKOUT_PENDING → PENDING_PAYMENT`, `AUTHORISED → PAID` (D-030: PAID = authorised), `COMPLETED → BOOKED`, `PARTIALLY_COMPLETED → PARTIALLY_BOOKED`. | One vocabulary across API, shipments (DR-B01) and orders; ADR-0016 amendment 5(e). |
| OI-17 — quote retention | **Recommended default (product-manager to confirm in a retention decision):** unclaimed quotes expired for more than 90 days and their options are hard-deleted by `housekeeping` (allow-listed); claimed/booked quotes are retained with the shipment. | Bounds the ≈ 600 M-row option growth; unclaimed guest quotes hold no account linkage. |
| OI-12 — Prisma preview features, partition children in the differ, `CREATE INDEX CONCURRENTLY` | **Accepted as Wave-0 spike SPK-03/SPK-01 scope** (risks.md); fallbacks documented in §7 stand. | — |
| `token_enc` in outbox payloads (api-designer) | **Ratified** per ADR-0004 amendment: AES-256-GCM under the outbox payload key; nulled after send and by housekeeping after 24 h; `outbox_events.payload` classification registers `token_enc` as SECRET for log redaction. | — |
| Wording items OI-10/11/20/22 (NFR-PRIV-004 vs REQ-NOTIF-012, classification vocabulary, `LAST_OWNER` status, MinIO → RustFS) | Forwarded to product-manager (D-ARCH-006 g covers MinIO; the others are listed in the P3 Handoff Report). | — |

### Amendments after the P3 security review (2026-11-12)

Source: `docs/05-quality/security/P3-architecture-security-review.md`; ADR-0005 amendment 6, ADR-0006 amendments 12–14, ADR-0007 amendment 7, ADR-0013 amendment, ADR-0018 amendment 1. Each change is marked in place as "Amended 2026-11-12 (SEC-P3-xx)" or "Amendment (2026-11-12, SEC-P3-xx)". Where this list and earlier text disagree, the amended text in place wins.

| # | Finding | Change | Sections |
|---|---|---|---|
| A1 | SEC-P3-03 | New `NOLOGIN NOINHERIT` role **`platform_audit_owner`** (no members) owns every audit table and partition, `audit_anchors`, `audit_pii_vault`, `data_subjects` and the functions `audit_forbid_mutation`, `audit_vault_guard`, `ensure_audit_partitions` (`SECURITY DEFINER`, `EXECUTE` for `platform_app`; the only runtime DDL path). `platform_migrator` is not a member and owns no audit object. Schema-owner `DROP TABLE` / `DROP SCHEMA … CASCADE` is named as a path and closed by the `sql_drop` guard | §1.5, §2.3, §3.4, §4.4, §5 intro, §5.1, §5.2, §5.3, §5.7, §4.6 C13 |
| A2 | SEC-P3-03 | **Bootstrap lane** `prisma/bootstrap/*.sql` (cluster-admin credential, `tools/db/bootstrap.ts`, ledger `bootstrap_migrations`) is the only place where roles, schemas and audit DDL are created; migration-linter rule 12 rejects audit DDL in `prisma/migrations/**` unconditionally and requires `-- @audit-ddl security-approved: <reviewer> <YYYY-MM-DD>` in the bootstrap lane; `tables.external` lists all audit tables; the restore rehearsal runs only `00-roles.sql` before `pg_restore` | §1.5, §4.4, §7.3, §8.1, §8.3, §8.6 |
| A3 | SEC-P3-03 | Statement-text event trigger withdrawn; **`platform.audit_ddl_guard()`** on `ddl_command_end` (`pg_event_trigger_ddl_commands()`) and `sql_drop` (`pg_event_trigger_dropped_objects()`) matches by object identity, raises `audit objects are immutable (SEC-P3-03)` unless `current_user = 'platform_audit_owner'`; must not be `SECURITY DEFINER`. Row and statement triggers kept; `audit_anchors` and `audit_checkpoint_heads` TRUNCATE triggers added | §5.2, §4.6 C14 |
| A4 | SEC-P3-03 | §5.5 becomes **"Hourly checkpoint and signed anchor"**: hourly `CHAIN_CHECKPOINT`, delta `audit_checkpoint_heads` (+ `head_occurred_at`), new table **`audit_anchors`** (dense `anchor_seq`, `prev_anchor_hash` chain, `anchor_hash`, algorithm `ECDSA_P256_SHA256`, `key_id`, DER `signature`) written in the same transaction; signing key `AUDIT_ANCHOR_SIGNING_KEY_REF` (worker only), verification keys `AUDIT_ANCHOR_PUBLIC_KEYS`; `AUDIT_CHECKPOINT_KEY` (HMAC) dropped; mandatory sink `AUDIT_ANCHOR_SINK` | §1.6, §1.7, §2.3, §3.4, §4.4, §5.5, §10.1 |
| A5 | SEC-P3-03 | Verifier: every hourly run checks anchor-log integrity (`ANCHOR_MISSING`, security event `audit_anchor_missing`), signatures (`CHECKPOINT_SIGNATURE_INVALID`) and the anchored heads of the latest anchor (`CHECKPOINT_HEAD_MISMATCH`, `audit_chain_broken`); nightly checks all anchors since the previous nightly run; the "only if configured" wording is removed; new `failure_kind` values and `anchor_seq_from/_to` | §1.7, §3.4, §5.6 |
| A6 | SEC-P3-12 | New allow-listed definer function **`platform.job_context(p_kind, p_id) → (org_id, actor_type, actor_id)`** (owner `platform_definer`, STABLE; kinds `outbox_event`, `saga`, `shipment`, `order`, `pickup`, `document`, `payment`, `tracking_poll`, `notification`, `quote`; unknown kind raises; no row = non-retryable); payload v2 carries IDs only; sensitive-definer list added | §1.7, §4.1, §4.3, §4.5, §4.6 C11, §6.1, §6.3, §3.5 `outbox_events` |
| A7 | SEC-P3-01 C1/C2, SEC-P3-11 | `sessions.authenticated_at` (the `auth_time` source, never changed by refresh); web absolute cap 30 days (admin 12 h) with a DB backstop CHECK; `refresh_tokens.expires_at = LEAST(now() + 30 min (admin) / 30 d (web), absolute)` | §3.1 `sessions`, `refresh_tokens` |
| A8 | SEC-P3-14 (also §9.3 staff seed row) | `users.status_reason` (CHECK incl. `MFA_ENROLMENT_OVERDUE`) and `users.first_signed_in_at`; housekeeping suspends OPERATOR members without active TOTP 24 h after first sign-in via the new candidate function `mfa_enrolment_overdue_candidates`; new table **`mfa_enrolment_codes`** (chosen over a purpose value on an existing token table; reasons in §3.1); `password_reset_tokens.purpose` (`RESET`, `SET_PASSWORD` 24 h); seeded staff outside local have no `user_credentials` row | §1.5, §1.7, §2.1, §3.1, §4.3, §4.5 |
| A9 | SEC-P3-08 item 1 | `<col>_key_id` sibling for every ciphertext and HMAC lookup column (renames `key_id` → `secret_ciphertext_key_id`, `ciphertext_key_id`, `value_ciphertext_key_id`; adds `code_hmac_key_id`, `ip_prefix_hmac_key_id`, `identifier_hmac_key_id`, `value_hmac_key_id`, `ip_hash_key_id`, `customer_ref_postcode_hmac_key_id`, `response_body_key_id`, `payload.token_enc_key_id`, M3 `credentials_ciphertext_key_id`; `pepper_key_id` reserved for SEC-P3-16); AES-256-GCM 96-bit nonce, 128-bit tag, AAD = JCS([table, column, row id or token, key_id]); `idempotency_keys.response_body` becomes ciphertext; `mfa_recovery_codes` aligned to ADR-0006 HMAC | §3.1, §3.4, §3.5, §3.8, §3.11, §3.16, §5.1, §5.4, §5.6, §5.7, §6.2, §10.4 |
| A10 | SEC-P3-25 | Definer functions, `app_is_operator` and definer-read policies owned by / targeted at **`platform_definer`** (was `platform_migrator`); C3/C11 updated; `sessions_for_user` (OI-25) listed in §4.5; `quote_share_resolve` serves `POST /public/shared-quotes/resolve` | §4.2, §4.3, §4.4, §4.5, §4.6 |
| A11 | SEC-P3-10 | `createQuoteShare` always mints a new token and revokes the previous active share; backstop `ux_quote_shares__quote_active` | §3.10 `quote_shares` |
| A12 | SEC-P3-13 | Raw carrier payload JSON replaces document bytes with `{"$blob": {sha256, size, media_type, document_id?}}`; allow-list redaction of tracking/response payloads | §3.8 `carrier_raw_payloads` |
| A13 | SEC-P3-27 (G2-C3) | **Search path.** Every `SECURITY DEFINER` function (the §4.5 list, `app_is_operator`, `job_context`, `ensure_audit_partitions`) and the non-definer audit functions `audit_forbid_mutation`, `audit_vault_guard` and `audit_ddl_guard` declare exactly `SET search_path = pg_catalog, pg_temp`. Relations are schema-qualified. The audit functions qualify built-ins: `pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(…)::bigint)`, `pg_catalog.to_char(v_month::timestamp, …)`, `pg_catalog.uuidv7()`, `pg_catalog.format`. The app-side audit advisory locks are qualified too. **Bootstrap.** Every bootstrap file starts with `SET search_path = pg_catalog, pg_temp;` before `SET ROLE`, and the runner sets the path at connection level. **Guard.** `audit_ddl_guard` qualifies the catalogs and matches the protected schemas **by OID, derived at call time** from the namespaces of objects owned by `platform_audit_owner` (not written into the body, because OIDs change in every restore). It refuses `ALTER SCHEMA … RENAME`, `OWNER TO` and `DROP SCHEMA` on them, and fails closed if the set is empty. **Schema owner (review item 6, recommended): adopted.** The new `NOLOGIN` no-member role `platform_schema_owner` owns `public` and `platform`, and the migrator gets `USAGE, CREATE`. This breaks nothing in Prisma Migrate: `deploy` needs only `CREATE`, the shadow database is migrator-owned, and `migrate reset` on the dev database was already blocked by the guard. It closes schema-owner drops and renames by privilege, including `DROP FUNCTION platform.audit_ddl_guard() CASCADE`. **Also:** `platform_definer` gets `CREATE` on `platform`, which PostgreSQL requires for `ALTER FUNCTION … OWNER TO`. C11 and C14 assert `proconfig` = `search_path=pg_catalog, pg_temp`, and C14 adds the OID rename probe. Linter rule 13. Negative test SEC-TC-61 | §4.2, §4.4, §4.5, §4.6 C11/C13/C14, §5.2, §5.3, §5.4, §5.5, §5.7, §7.3, §8.3, §8.6 |
| A14 | SEC-P3-32 (data part) | **Revocation audit.** The implicit revocation of the previous share writes its own audit entry (`UPDATE quote_share`, `revoked_at` null → value, `revoked_by` = actor) in the same transaction as `CREATE quote_share`. **Mint cap.** 10 per quote per rolling hour, then 429 `RATE_LIMITED`. It is enforced by a transactional PostgreSQL count, not a Redis counter, backed by the new `ix_quote_shares__quote_created ON (quote_id, created_at DESC)` (AP-QUO-09); races are serialised by `ux_quote_shares__quote_active`. **Resolve.** `quote_share_resolve` returns `(quote_id, public_snapshot, expires_at)` and selects only active shares (`revoked_at IS NULL AND expires_at > now()`): no row for unknown, revoked, superseded and expired tokens, so the API answers one byte-identical 404 for all of them (D-055, REQUIREMENTS.md v1.4 EC-B29/EC-B53; D-ARCH-032). The interim EC-B29 v1.3 reconciliation (200 `EXPIRED` minus options) was withdrawn the same day | §3.10 `quote_shares`, §4.5 |
| A18 | Wave-0 batch-3 rulings Part 2 (PR #7 round 2: code review R2-m1/R2-n1/R2-n2, security review PR7-SEC-11..14; `rulings/wave-0-batch-3-rulings.md` Part 2; D-ARCH-063..066) | **Context statement = eight settings + leak detector.** §4.1 adds `lock_timeout` and `idle_in_transaction_session_timeout` per transaction (configuration `DB_TX_*_MS`, TASK-016) and reads the prior values of the four security keys in a `MATERIALIZED` CTE in the same round trip — any non-NULL/non-`''` prior value is `DB_SESSION_CONTEXT_LEAK` (ADR-0005 am. 10 item 16); the role-level defaults paragraph records that `00-roles.sql` sets no `statement_timeout` and that `02-role-backstops.sql` (TASK-016) adds a 30 s backstop with a C13 row (item 12). **§4.3** GUEST_CAPABLE trigger conditions widened to `IS DISTINCT FROM` forms (org A → B and hash H1 → H2 also forbidden; TASK-051 proves them as the superuser). **§4.5** `platform.job_context` block rewritten under `SET ROLE platform_definer; … RESET ROLE;` (no `OWNER TO` before `GRANT`). **§7.7** sample aligned (eight settings, `$queryRaw`, `asTenantDb`). **§8.3** rules 15 (definer ownership order / `SET ROLE` block) and 16 (tenant-context write forms in SQL bodies, by form across every non-system schema) written down, owner TASK-016. | §4.1, §4.3, §4.5, §7.7, §8.3 |
| A19 | Wave-0 TASK-016 rulings (PR #11 code review M1/m1–m6/n1–n5 and security review PR11-SEC-01..11; `rulings/wave-0-task-016-rulings.md`; D-ARCH-071..074) | **Non-atomic migration files.** §8.3 rule 5 records the verified result (`migrate deploy` runs statements one at a time, no file-level transaction); rule 11 accepts the session form only (`SET LOCAL` is a no-op outside a transaction block) and ends raised values with `RESET`; rule 9 adds renderer equality for every `CREATE POLICY` and grant-after-`FORCE` ordering; rule 15 accepts only the `SET ROLE platform_definer … RESET ROLE` block (`OWNER TO platform_definer` and an unreset role fail; `handedOver` removed); rule 16 names the evaded forms and the operator-atom exemption inside `CREATE POLICY`; new rule 17 (`down.sql` `IF EXISTS` forms); an ordering principle ("every prefix leaves the schema safe") and the §8.4 prefix-reversibility check. **DR-A14** (§4.3): three named renderer templates selected by the manifest field `policySet`, positive status lists (`IN ('INVITED','ACTIVE','SUSPENDED')` replaces `<> 'REMOVED'`), exact `EXISTS` atoms, C3 derived from manifests + renderer with keyed-atom presence and recursion invariants; security-analyst sign-off is a merge condition of TASK-037/TASK-049. **§4.2** helper bodies qualified (`pg_catalog.`, `OPERATOR(pg_catalog.~*)`). **§4.4** `platform_definer` holds `EXECUTE` on `app_actor_id()` (granted before `SET ROLE` in the `app_is_operator` migration). **§4.1/§4.6** `lc_messages = 'C'` backstop row (five C13 rows), C5 includes `PUBLIC`, C11 converse ownership set, C13 case folding, C6–C10 owners (TASK-021 / TASK-024 / TASK-028), `immutable` and `runtimeReadOnly` manifest flags | §4.1, §4.2, §4.3, §4.4, §4.6, §8.3, §8.4 |
| A20 | Wave-0 sheet-fold-1 rulings (PR #12 SPK-08 / PR #13 seed framework / PR #11 round 3; `rulings/wave-0-sheet-fold-1.md`; D-ARCH-075..079) | **`reference_dataset_versions`:** `platform_app` `SELECT` only; single writer = the seed as migrator; the US-073 reconciler derives the last audited digest from `audit_entries`, writes no digest row, and audits every audited dataset plus the drift-restore counter; the migrator gains no audit privilege; `dataset_version` column; `pg.Client`, never a pool (§3.5, §4.4, §9.2). **Partition-name squatting (PR12-SEC-02):** guard matches the object's own name for every `pg_class`/`pg_type` kind; `ensure_audit_partitions` identity test raising `AUDIT_PARTITION_NAME_TAKEN`; readiness = contiguity from the catalogue + `audit_partition_squatted` event; plain `CREATE FUNCTION` for the guard, C14 owner/converse/dependency checks (PR12-SEC-03); `ENABLE ALWAYS` with stated limits (§5.2, §5.3). **Anchors:** A-2/A-3/A-4 byte layouts and JCS sink line ratified, A-1 precedence + `failure_kinds`, A-5 strict DER, A-6 clamp, A-7, AF-9/AF-12 nightly-walk qualifier (§5.5, §5.6). **§7.3:** F-01 generated `tables.external` window, F-02/F-03 shadow rendering with owner refusal, F-04/F-11 index rules (TASK-024), "verify in P5 spike" notes closed. **§8.3 Limits:** `E'…'` strings refused token-level; by-form limits (a)–(e) with their outcome controls | §3.5, §4.4, §5.2, §5.3, §5.5, §5.6, §7.3, §8.3, §9.2 |
| A17 | Wave-0 batch-3 rulings (TASK-013 PR #8 D-T013-08/09/11; SPK-03 F-10; `rulings/wave-0-batch-3-rulings.md` items 2 and 4; D-ARCH-058, D-ARCH-060) | **Authz tables are populated by a generated versioned migration**, not by the reference seed: §3.3 and the §9.2 row rewritten (reference seed = parity check; US-073 task writes the `CONFIG_CHANGE` entry per `CATALOGUE_VERSION` through `reference_dataset_versions('authz_matrix')`); §8.3 rule 10 clarified (insert-only generated seed = `data-changing: no`; narrowing = `yes`); §1.7 `role_scope` source note (`RoleScope` in `packages/authz` for now); §7.3 note on `INCLUDE` indexes vs `migrate diff`; §4.5 example reordered — grants **before** `OWNER TO platform_definer` (the migrator's `INHERIT FALSE` membership cannot grant after the owner change) | §1.7, §3.3, §4.5, §7.3, §8.3, §9.2 |
| A16 | batch 0.2 rulings (SEC-P3-34 items 1–3, 5; SEC-P3-37 items 1, 4; `rulings/batch-0.2-rulings.md`; D-ARCH-045..049) | **Database ownership.** The migrator does not own the database (SEC-P3-34 item 5 adopted, the review's *recommended* option); it holds `CONNECT` and `USAGE, CREATE` on both schemas. Extensions move to `01-schemas.sql` as the bootstrap role; the shadow-init rendering keeps them. Items 1–3 (role-in-database `search_path`, harness `options=-c search_path`, `pg_db_role_setting` assertion) are implemented in TASK-003, not deferred to M5. **Default privileges.** The per-schema `REVOKE` forms were PostgreSQL no-ops; the global `FOR ROLE … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` form is used for the three creating roles, the `TABLES` line is dropped (no built-in PUBLIC grant on tables), and C5/C11/C13 gain `pg_default_acl`, `pg_database.datdba` and `pg_db_role_setting` assertions. **Reversibility driver.** §8.4 step 2 sets `_prisma_migrations.rolled_back_at` directly (test/dev only) because `migrate resolve --rolled-back` is defined for failed migrations only (P3012). **Files.** `00-roles.sql`/`01-schemas.sql` are the names; the `infra/compose/postgres/initdb` path is withdrawn. **Linter.** Rule 12 made precise, rule 14 added, rules 3–9/11/14 owned by TASK-016 (SEC-TC-33, NT-AVAIL-003-a) | §4.4, §4.6 C5/C11/C13, §7.3, §8.1, §8.3, §8.4, §8.6 |
| A15 | SEC-P3-33 items 1 and 10 | **Item 1.** The ECDSA P-256 rationale is rewritten: KMS has supported Ed25519 since 2025-11-07, so the reason is not availability but FIPS 186-5 approval and support in every target verifier; malleability is harmless under byte-for-byte sink comparison; the `algorithm` CHECK is extensible (ADR-0007 amendment 8, D-ARCH-029). **Item 10.** C13 distinguishes the environments for `platform_audit_owner` and `platform_schema_owner`: no `pg_auth_members` row locally; on RDS exactly one row for the master with `admin_option = true`, `set_option = false`, `inherit_option = false`, treated as break-glass (platform.md §4.3). SPK-08 verifies RDS parity | §4.4, §4.6 C13, §5.5 |

Open points raised by these amendments, all non-blocking. Each is owned by principal-architect unless stated otherwise:
- **ADR-0018 register gaps.** The register has no entry yet for four keys this model uses: the shipment-identifier encryption key, the vault dedupe HMAC key, the MFA-challenge IP-prefix HMAC key and the enrolment-code HMAC key (§10.4).
- **New definer functions to ratify under ADR-0005 amendment 1.** `mfa_enrolment_overdue_candidates` was added for SEC-P3-14, and `sessions_for_user` is now listed in §4.5.
- **Wave-0 spikes.** Confirm on PostgreSQL 18 and RDS that `rds_superuser` can create the event triggers, and that the shadow-database hook of Prisma 7.10 handles the bootstrap-lane objects (SPK-03).
- **Option for M5.** Move the audit relations to a schema owned by `platform_audit_owner` (§4.4). *Amended 2026-11-12 (A13): still open. The no-member `platform_schema_owner` adopted now closes the schema-owner paths by privilege, so the move would add separation, not close a gap.*
- **SPK-08 additions (A13, A15; platform-architect with senior-developer).** On PostgreSQL 18 Testcontainers and, at M5, on RDS:
  - the exact statements by which the RDS master gets `SET` on `platform_audit_owner` and `platform_schema_owner` for the duration of the lane and ends with the ADMIN-only row C13 allows (for example `SET createrole_self_grant = 'set'`, then removal of the SET option);
  - that `prisma migrate deploy` and the shadow-database init run unchanged with the migrator holding only `USAGE, CREATE` on both schemas (*amended 2026-11-12, batch 0.2 / A16: the `migrate deploy`, `migrate status` and `db execute` half is **verified** by TASK-003 on PostgreSQL 18 with the migrator holding no database ownership either — `prisma/README.md` SPK-08 record 3; the shadow-init half (`migrations.initShadowDb` with the rendered bootstrap SQL including `CREATE EXTENSION`) remains SPK-03/TASK-012*);
  - SEC-TC-61 green.
- **SEC-TC-53 and SEC-TC-61 wording (security-analyst).**
  - SEC-TC-53: **settled (D-ARCH-032, D-055)** — it stays as the review wrote it: byte-identical 404s for unknown, revoked and expired tokens (and superseded ones, which are revoked rows); no `EXPIRED` view exists (§3.10 item 3, A14).
  - SEC-TC-61: add `DROP FUNCTION platform.audit_ddl_guard() CASCADE` and `DROP SCHEMA platform CASCADE` as the migrator (both must fail by privilege).
- **Notification log, invitee rows.** `notification_log` rows for invitees without an account (`recipient_user_id IS NULL`) are not visible under the current own-row policy, which predates this amendment. `job_context` returns the SYSTEM actor for them.
