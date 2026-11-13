-- Bootstrap lane, file 10: the audit store (ADR-0007 amendments 2 and 7; data-model.md §3.4, §4.4, §5.1-§5.3, §5.7;
-- SEC-P3-03, SEC-P3-27, PR12-SEC-02/03/04/08, D-ARCH-076, D-SEC-PR12-01; TASK-021).
-- @audit-ddl security-approved: security-analyst 2026-11-13
--
-- Runner:      tools/db/bootstrap.ts with the cluster-admin credential, after 02-role-backstops.sql and before
--              90-audit-ddl-guard.sql (the identity guard is installed last so that this file's DDL is not inspected).
-- Variables:   none.
-- Owner:       every object below is created under SET ROLE platform_audit_owner (NOLOGIN, no members, §4.4), so the
--              migrator credential owns no audit object and cannot disable a trigger, detach a partition or replace a
--              function ("must be owner"). Audit DDL never appears in prisma/migrations/** (linter rule 12); the
--              tables are listed in tables.external of prisma.config.ts so that Prisma Migrate never diffs them.
-- Idempotent:  no. The runner's ledger (public.bootstrap_migrations) applies the file exactly once per database, in one
--              transaction; a partial run rolls back completely.
-- Immutable:   once applied, a change is a new file (NN-audit-*.sql with its own rule-12 marker).
-- Data:        creates empty tables; the only rows written are the audit_partitions registry rows of the first
--              ensure_audit_partitions(3) call. Classification under D-SEC-PR8-01 / linter rule 10: additive, not
--              data-changing. Guardrail: data-model §8.1 applies the §8.6 backup/restore guardrail to every bootstrap
--              file; until M5 the only databases are ephemeral local/CI ones rebuilt from this lane. Rollback (local
--              and CI only, never on a database holding audit rows): recreate the database with npm run db:reset
--              --yes, which reruns the lane without this file once it is reverted; a dropped audit store is never a
--              roll-forward option on a shared environment (REQ-AUDIT-014).
--
-- Not ported from the SPK-08 prototype (PR12-SEC-08): audit_entries is SYSTEM (no RLS, ADR-0005); the viewer
-- repository applies the scope, and the partitions keep zero privileges (C5).
SET search_path = pg_catalog, pg_temp;
SET ROLE platform_audit_owner;

-- §5.1 Partitioned table ----------------------------------------------------------------------------------------------
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
  ip_hash_key_id      text,
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
ALTER TABLE public.audit_entries OWNER TO platform_audit_owner;

-- §3.4 audit_stream_heads (SYSTEM; mutable under the stream lock only) -------------------------------------------------
CREATE TABLE public.audit_stream_heads (
  id                        uuid        NOT NULL DEFAULT uuidv7() CONSTRAINT pk_audit_stream_heads PRIMARY KEY,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid        NOT NULL,
  updated_by                uuid        NOT NULL,
  version                   integer     NOT NULL DEFAULT 1 CONSTRAINT ck_audit_stream_heads__version CHECK (version >= 1),
  stream_id                 uuid        NOT NULL CONSTRAINT ux_audit_stream_heads__stream_id UNIQUE,
  entry_count               bigint      NOT NULL DEFAULT 0 CONSTRAINT ck_audit_stream_heads__entry_count CHECK (entry_count >= 0),
  head_entry_id             uuid,
  head_occurred_at          timestamptz,
  head_hash                 bytea       NOT NULL DEFAULT decode(repeat('00', 32), 'hex')
                              CONSTRAINT ck_audit_stream_heads__head_hash CHECK (octet_length(head_hash) = 32),
  last_verified_seq         bigint      NOT NULL DEFAULT 0
                              CONSTRAINT ck_audit_stream_heads__last_verified_seq CHECK (last_verified_seq >= 0),
  last_verified_hash        bytea       NOT NULL DEFAULT decode(repeat('00', 32), 'hex')
                              CONSTRAINT ck_audit_stream_heads__last_verified_hash CHECK (octet_length(last_verified_hash) = 32),
  last_verified_occurred_at timestamptz
);
ALTER TABLE public.audit_stream_heads OWNER TO platform_audit_owner;

-- §3.4 audit_partitions (SYSTEM; metadata only) -----------------------------------------------------------------------
CREATE TABLE public.audit_partitions (
  id                      uuid        NOT NULL DEFAULT uuidv7() CONSTRAINT pk_audit_partitions PRIMARY KEY,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid        NOT NULL,
  updated_by              uuid        NOT NULL,
  version                 integer     NOT NULL DEFAULT 1 CONSTRAINT ck_audit_partitions__version CHECK (version >= 1),
  partition_name          text        NOT NULL CONSTRAINT ux_audit_partitions__partition_name UNIQUE
                            CONSTRAINT ck_audit_partitions__partition_name CHECK (partition_name ~ '^audit_entries_[0-9]{4}_[0-9]{2}$'),
  range_start             timestamptz NOT NULL,
  range_end               timestamptz NOT NULL,
  closed_at               timestamptz,
  row_count_at_close      bigint      CONSTRAINT ck_audit_partitions__row_count CHECK (row_count_at_close >= 0),
  archived_at             timestamptz,
  archive_object_key      text,
  archive_manifest_sha256 bytea       CONSTRAINT ck_audit_partitions__manifest_sha256
                            CHECK (archive_manifest_sha256 IS NULL OR octet_length(archive_manifest_sha256) = 32),
  CONSTRAINT ck_audit_partitions__range CHECK (range_end > range_start)
);
CREATE INDEX ix_audit_partitions__range_start ON public.audit_partitions (range_start);
ALTER TABLE public.audit_partitions OWNER TO platform_audit_owner;

-- §3.4 audit_chain_verifications (SYSTEM; the run row is updated as it progresses) ------------------------------------
CREATE TABLE public.audit_chain_verifications (
  id                       uuid        NOT NULL DEFAULT uuidv7() CONSTRAINT pk_audit_chain_verifications PRIMARY KEY,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid        NOT NULL,
  updated_by               uuid        NOT NULL,
  version                  integer     NOT NULL DEFAULT 1 CONSTRAINT ck_audit_chain_verifications__version CHECK (version >= 1),
  run_kind                 text        NOT NULL CONSTRAINT ck_audit_chain_verifications__run_kind CHECK (run_kind IN ('INCREMENTAL','FULL')),
  status                   text        NOT NULL CONSTRAINT ck_audit_chain_verifications__status
                             CHECK (status IN ('RUNNING','PASSED','FAILED','ERROR')),
  started_at               timestamptz NOT NULL,
  finished_at              timestamptz,
  streams_checked          integer     NOT NULL DEFAULT 0 CONSTRAINT ck_audit_chain_verifications__streams CHECK (streams_checked >= 0),
  entries_checked          bigint      NOT NULL DEFAULT 0 CONSTRAINT ck_audit_chain_verifications__entries CHECK (entries_checked >= 0),
  first_broken_stream_id   uuid,
  first_broken_entry_id    uuid,
  first_broken_occurred_at timestamptz,
  failure_kind             text        CONSTRAINT ck_audit_chain_verifications__failure_kind CHECK (failure_kind IN (
                             'HASH_MISMATCH','PREV_HASH_MISMATCH','SEQ_GAP','SEQ_DUPLICATE','DUPLICATE_ENTRY_HASH',
                             'HEAD_MISMATCH','CHECKPOINT_HEAD_MISMATCH','CHECKPOINT_SIGNATURE_INVALID','ANCHOR_MISSING')),
  checkpoint_entry_id      uuid,
  anchor_seq_from          bigint,
  anchor_seq_to            bigint,
  CONSTRAINT ck_audit_chain_verifications__anchor_range
    CHECK (anchor_seq_from IS NULL OR anchor_seq_to IS NULL OR anchor_seq_to >= anchor_seq_from)
);
CREATE INDEX ix_audit_chain_verifications__started ON public.audit_chain_verifications (started_at DESC);
ALTER TABLE public.audit_chain_verifications OWNER TO platform_audit_owner;

-- §3.4 audit_checkpoint_heads (SYSTEM; append-only) -------------------------------------------------------------------
CREATE TABLE public.audit_checkpoint_heads (
  id                  uuid        NOT NULL DEFAULT uuidv7() CONSTRAINT pk_audit_checkpoint_heads PRIMARY KEY,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_by          uuid        NOT NULL,
  version             integer     NOT NULL DEFAULT 1 CONSTRAINT ck_audit_checkpoint_heads__version CHECK (version = 1),
  checkpoint_entry_id uuid        NOT NULL,
  stream_id           uuid        NOT NULL,
  entry_count         bigint      NOT NULL CONSTRAINT ck_audit_checkpoint_heads__entry_count CHECK (entry_count >= 0),
  head_hash           bytea       NOT NULL CONSTRAINT ck_audit_checkpoint_heads__head_hash CHECK (octet_length(head_hash) = 32),
  head_occurred_at    timestamptz,
  CONSTRAINT ux_audit_checkpoint_heads__checkpoint_stream UNIQUE (checkpoint_entry_id, stream_id)
);
CREATE INDEX ix_audit_checkpoint_heads__stream_checkpoint ON public.audit_checkpoint_heads (stream_id, checkpoint_entry_id DESC);
ALTER TABLE public.audit_checkpoint_heads OWNER TO platform_audit_owner;

-- §3.4 audit_anchors (SYSTEM; append-only; ADR-0007 amendment 7) -----------------------------------------------------
CREATE TABLE public.audit_anchors (
  anchor_seq          bigint      NOT NULL CONSTRAINT pk_audit_anchors PRIMARY KEY
                        CONSTRAINT ck_audit_anchors__anchor_seq CHECK (anchor_seq >= 1),
  checkpoint_entry_id uuid        NOT NULL CONSTRAINT ux_audit_anchors__checkpoint_entry_id UNIQUE,
  created_at          timestamptz NOT NULL,
  heads_digest        bytea       NOT NULL CONSTRAINT ck_audit_anchors__heads_digest CHECK (octet_length(heads_digest) = 32),
  prev_anchor_hash    bytea       NOT NULL CONSTRAINT ck_audit_anchors__prev_anchor_hash CHECK (octet_length(prev_anchor_hash) = 32),
  anchor_hash         bytea       NOT NULL CONSTRAINT ux_audit_anchors__anchor_hash UNIQUE
                        CONSTRAINT ck_audit_anchors__anchor_hash CHECK (octet_length(anchor_hash) = 32),
  algorithm           text        NOT NULL CONSTRAINT ck_audit_anchors__algorithm CHECK (algorithm = 'ECDSA_P256_SHA256'),
  key_id              text        NOT NULL CONSTRAINT ck_audit_anchors__key_id CHECK (key_id ~ '^[a-z][a-z0-9-]*-v[0-9]+$'),
  signature           bytea       NOT NULL CONSTRAINT ck_audit_anchors__signature CHECK (octet_length(signature) BETWEEN 8 AND 72)
);
ALTER TABLE public.audit_anchors OWNER TO platform_audit_owner;

-- §5.7 PII vault ------------------------------------------------------------------------------------------------------
CREATE TABLE public.data_subjects (
  id         uuid        NOT NULL DEFAULT uuidv7() CONSTRAINT pk_data_subjects PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid        NOT NULL,
  updated_by uuid        NOT NULL,
  version    integer     NOT NULL DEFAULT 1 CONSTRAINT ck_data_subjects__version CHECK (version >= 1),
  kind       text        NOT NULL CONSTRAINT ck_data_subjects__kind CHECK (kind IN ('USER','CONTACT')),
  ref_id     uuid        NOT NULL,
  erased_at  timestamptz,
  CONSTRAINT ux_data_subjects__kind_ref UNIQUE (kind, ref_id)
);
ALTER TABLE public.data_subjects OWNER TO platform_audit_owner;

CREATE TABLE public.audit_pii_vault (
  token             uuid        NOT NULL DEFAULT uuidv7() CONSTRAINT pk_audit_pii_vault PRIMARY KEY,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL,
  updated_by        uuid        NOT NULL,
  version           integer     NOT NULL DEFAULT 1 CONSTRAINT ck_audit_pii_vault__version CHECK (version = 1),
  subject_id        uuid        NOT NULL CONSTRAINT fk_audit_pii_vault__subject REFERENCES public.data_subjects (id),
  classification    text        NOT NULL CONSTRAINT ck_audit_pii_vault__classification
                      CHECK (classification IN ('PERSONAL','SENSITIVE_PERSONAL')),
  entity_name       text        NOT NULL CONSTRAINT ck_audit_pii_vault__entity CHECK (entity_name ~ '^[a-z][a-z0-9_]*$'),
  field             text        NOT NULL CONSTRAINT ck_audit_pii_vault__field CHECK (field ~ '^[a-z][a-z0-9_]*$'),
  value_hmac        bytea       NOT NULL CONSTRAINT ck_audit_pii_vault__hmac CHECK (octet_length(value_hmac) = 32),
  value_hmac_key_id text        NOT NULL CONSTRAINT ck_audit_pii_vault__hmac_key_id CHECK (value_hmac_key_id ~ '^[a-z][a-z0-9-]*-v[0-9]+$'),
  ciphertext        bytea       NOT NULL CONSTRAINT ck_audit_pii_vault__ct CHECK (octet_length(ciphertext) BETWEEN 29 AND 65536),
  ciphertext_key_id text        NOT NULL CONSTRAINT ck_audit_pii_vault__ct_key_id CHECK (ciphertext_key_id ~ '^[a-z][a-z0-9-]*-v[0-9]+$'),
  CONSTRAINT ux_audit_pii_vault__subject_field_value UNIQUE (subject_id, entity_name, field, value_hmac)
);
CREATE INDEX ix_audit_pii_vault__subject ON public.audit_pii_vault (subject_id);
ALTER TABLE public.audit_pii_vault OWNER TO platform_audit_owner;

-- §5.2 Immutability triggers ------------------------------------------------------------------------------------------
CREATE FUNCTION platform.audit_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '42501',
    MESSAGE = pg_catalog.format('AUDIT_IMMUTABLE: %s on %s is not permitted', TG_OP, TG_TABLE_NAME);
END $$;
ALTER FUNCTION platform.audit_forbid_mutation() OWNER TO platform_audit_owner;
REVOKE ALL ON FUNCTION platform.audit_forbid_mutation() FROM PUBLIC;

-- §5.7 vault guard: only the M4/M5 erasure job (platform_erasure with an erasure request id) may delete a vault row.
CREATE FUNCTION platform.audit_vault_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_user = 'platform_erasure'
     AND pg_catalog.current_setting('app.erasure_request_id', true) ~* '^[0-9a-f-]{36}$' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = pg_catalog.format('AUDIT_VAULT_IMMUTABLE: %s', TG_OP);
END $$;
ALTER FUNCTION platform.audit_vault_guard() OWNER TO platform_audit_owner;
REVOKE ALL ON FUNCTION platform.audit_vault_guard() FROM PUBLIC;

-- The row trigger on the partitioned parent is cloned to every partition (tgparentid); statement (TRUNCATE) triggers
-- are not, so ensure_audit_partitions adds one per partition. Every trigger is ENABLE ALWAYS (PR12-SEC-04 item 3,
-- D-ARCH-076): it also fires under session_replication_role = replica.
CREATE TRIGGER trg_audit_entries__no_update_delete
  BEFORE UPDATE OR DELETE ON public.audit_entries
  FOR EACH ROW EXECUTE FUNCTION platform.audit_forbid_mutation();
CREATE TRIGGER trg_audit_entries__no_truncate
  BEFORE TRUNCATE ON public.audit_entries
  FOR EACH STATEMENT EXECUTE FUNCTION platform.audit_forbid_mutation();
ALTER TABLE public.audit_entries ENABLE ALWAYS TRIGGER trg_audit_entries__no_update_delete;
ALTER TABLE public.audit_entries ENABLE ALWAYS TRIGGER trg_audit_entries__no_truncate;

CREATE TRIGGER trg_audit_checkpoint_heads__immutable
  BEFORE UPDATE OR DELETE ON public.audit_checkpoint_heads
  FOR EACH ROW EXECUTE FUNCTION platform.audit_forbid_mutation();
CREATE TRIGGER trg_audit_checkpoint_heads__no_truncate
  BEFORE TRUNCATE ON public.audit_checkpoint_heads
  FOR EACH STATEMENT EXECUTE FUNCTION platform.audit_forbid_mutation();
ALTER TABLE public.audit_checkpoint_heads ENABLE ALWAYS TRIGGER trg_audit_checkpoint_heads__immutable;
ALTER TABLE public.audit_checkpoint_heads ENABLE ALWAYS TRIGGER trg_audit_checkpoint_heads__no_truncate;

CREATE TRIGGER trg_audit_anchors__immutable
  BEFORE UPDATE OR DELETE ON public.audit_anchors
  FOR EACH ROW EXECUTE FUNCTION platform.audit_forbid_mutation();
CREATE TRIGGER trg_audit_anchors__no_truncate
  BEFORE TRUNCATE ON public.audit_anchors
  FOR EACH STATEMENT EXECUTE FUNCTION platform.audit_forbid_mutation();
ALTER TABLE public.audit_anchors ENABLE ALWAYS TRIGGER trg_audit_anchors__immutable;
ALTER TABLE public.audit_anchors ENABLE ALWAYS TRIGGER trg_audit_anchors__no_truncate;

CREATE TRIGGER trg_audit_pii_vault__guard
  BEFORE UPDATE OR DELETE ON public.audit_pii_vault
  FOR EACH ROW EXECUTE FUNCTION platform.audit_vault_guard();
CREATE TRIGGER trg_audit_pii_vault__no_truncate
  BEFORE TRUNCATE ON public.audit_pii_vault
  FOR EACH STATEMENT EXECUTE FUNCTION platform.audit_forbid_mutation();
ALTER TABLE public.audit_pii_vault ENABLE ALWAYS TRIGGER trg_audit_pii_vault__guard;
ALTER TABLE public.audit_pii_vault ENABLE ALWAYS TRIGGER trg_audit_pii_vault__no_truncate;

-- §5.3 Partition pre-creation, with the 2026-11-13 identity test (PR12-SEC-02 items 2-4) -----------------------------
-- An existing object under a partition name is accepted only when it is an attached, non-pending, audit-owned plain
-- partition of public.audit_entries with exactly the expected bounds; anything else (an index, view, sequence,
-- matview, composite type, enum, domain, a foreign table, a detached or wrong-bounds table) raises 42501. Nothing is
-- skipped silently. The function is the only DDL path on audit objects outside this lane; it calls no routine outside
-- pg_catalog except the audit-owned trigger function above.
CREATE FUNCTION platform.ensure_audit_partitions(p_months_ahead integer DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET "TimeZone" = 'UTC'
SET lock_timeout = '5s'
AS $$
DECLARE
  c_actor    constant uuid := '00000000-0000-7000-8000-000000000001';   -- SYSTEM actor id of the audit-maintenance job
  v_owner    oid := pg_catalog.to_regrole('platform_audit_owner')::oid;
  v_parent   oid := pg_catalog.to_regclass('public.audit_entries')::oid;
  v_public   oid := pg_catalog.to_regnamespace('public')::oid;
  v_month    date;
  v_from     timestamptz;
  v_to       timestamptz;
  v_name     text;
  v_bound    text;
  v_rel      oid;
  v_kind     "char";
  v_relowner oid;
  v_actual   text;
  v_links    integer;
  v_ours     integer;
  v_created  integer := 0;
BEGIN
  IF p_months_ahead IS NULL OR p_months_ahead NOT BETWEEN 0 AND 12 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'months_ahead must be between 0 and 12';
  END IF;
  IF v_owner IS NULL OR v_parent IS NULL OR v_public IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUDIT_STORE_MISSING';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('audit:partitions')::bigint);   -- one creator at a time
  FOR i IN 0..p_months_ahead LOOP
    v_month := (pg_catalog.date_trunc('month', pg_catalog.now()) + pg_catalog.make_interval(months => i))::date;
    v_from  := v_month::timestamp AT TIME ZONE 'UTC';
    v_to    := (v_month + interval '1 month')::timestamp AT TIME ZONE 'UTC';
    v_name  := 'audit_entries_' || pg_catalog.to_char(v_month::timestamp, 'YYYY_MM');
    v_bound := pg_catalog.format('FOR VALUES FROM (%L) TO (%L)', v_from, v_to);

    SELECT c.oid, c.relkind, c.relowner, pg_catalog.pg_get_expr(c.relpartbound, c.oid)
      INTO v_rel, v_kind, v_relowner, v_actual
      FROM pg_catalog.pg_class c
     WHERE c.relnamespace = v_public AND c.relname = v_name;
    IF FOUND THEN
      SELECT pg_catalog.count(*)::integer,
             pg_catalog.count(*) FILTER (WHERE i.inhparent = v_parent AND NOT i.inhdetachpending)::integer
        INTO v_links, v_ours
        FROM pg_catalog.pg_inherits i
       WHERE i.inhrelid = v_rel;
      IF v_kind <> 'r' OR v_relowner <> v_owner OR v_links <> 1 OR v_ours <> 1 THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUDIT_PARTITION_NAME_TAKEN', DETAIL = v_name;
      END IF;
      IF v_actual IS DISTINCT FROM v_bound THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUDIT_PARTITION_BOUNDS_MISMATCH', DETAIL = v_name;
      END IF;
      INSERT INTO public.audit_partitions (partition_name, range_start, range_end, created_by, updated_by)
      VALUES (v_name, v_from, v_to, c_actor, c_actor)
      ON CONFLICT (partition_name) DO NOTHING;                         -- registry row for a verified partition
      CONTINUE;
    END IF;
    IF EXISTS (SELECT FROM pg_catalog.pg_type t WHERE t.typnamespace = v_public AND t.typname = v_name) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUDIT_PARTITION_NAME_TAKEN', DETAIL = v_name;
    END IF;

    -- create detached, then ATTACH (SHARE UPDATE EXCLUSIVE on the parent instead of ACCESS EXCLUSIVE); the matching
    -- CHECK lets ATTACH skip the validation scan. ATTACH creates/attaches the parent's indexes and clones its row trigger.
    EXECUTE pg_catalog.format('CREATE TABLE public.%I (LIKE public.audit_entries INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING GENERATED)', v_name);
    EXECUTE pg_catalog.format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (occurred_at >= %L AND occurred_at < %L)',
                              v_name, 'ck_' || v_name || '__range', v_from, v_to);
    EXECUTE pg_catalog.format('ALTER TABLE public.audit_entries ATTACH PARTITION public.%I FOR VALUES FROM (%L) TO (%L)',
                              v_name, v_from, v_to);
    EXECUTE pg_catalog.format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION platform.audit_forbid_mutation()',
                              'trg_' || v_name || '__no_truncate', v_name);
    EXECUTE pg_catalog.format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER %I', v_name, 'trg_' || v_name || '__no_truncate');
    EXECUTE pg_catalog.format('REVOKE ALL ON public.%I FROM PUBLIC', v_name);
    INSERT INTO public.audit_partitions (partition_name, range_start, range_end, created_by, updated_by)
    VALUES (v_name, v_from, v_to, c_actor, c_actor)
    ON CONFLICT (partition_name) DO NOTHING;
    v_created := v_created + 1;
  END LOOP;
  RETURN v_created;
END $$;
ALTER FUNCTION platform.ensure_audit_partitions(integer) OWNER TO platform_audit_owner;
REVOKE ALL ON FUNCTION platform.ensure_audit_partitions(integer) FROM PUBLIC;

-- §4.4 grant matrix (prisma/sql/grants.manifest; catalog test C5). audit_entries: the parent only, never a partition.
GRANT SELECT, INSERT ON public.audit_entries, public.audit_checkpoint_heads, public.audit_anchors,
                        public.audit_pii_vault, public.data_subjects TO platform_app;
GRANT SELECT, INSERT, UPDATE ON public.audit_stream_heads, public.audit_partitions,
                                public.audit_chain_verifications TO platform_app;
GRANT SELECT, DELETE ON public.audit_pii_vault TO platform_erasure;
GRANT SELECT ON public.data_subjects TO platform_erasure;
GRANT UPDATE (erased_at, updated_at, updated_by, version) ON public.data_subjects TO platform_erasure;
GRANT EXECUTE ON FUNCTION platform.ensure_audit_partitions(integer) TO platform_app;
RESET ROLE;

-- First call (§5.3 "First call"): the current month and the next three (REQ-AUDIT-017). SECURITY DEFINER, so the
-- partitions are owned by platform_audit_owner although the caller is the bootstrap role.
SELECT platform.ensure_audit_partitions(3);
