-- SPK-08 (TASK-012) THROWAWAY PROTOTYPE of the bootstrap-lane file prisma/bootstrap/10-audit.sql. Test-only: it is applied
-- by prisma/tests/spikes/spk08-audit-owner.int.test.ts to a Testcontainers database and is NEVER part of
-- prisma/bootstrap/** or prisma/migrations/** (the real audit DDL is TASK-021's).
--
-- Source: data-model.md §4.4 amendment (SEC-P3-03, SEC-P3-27), §5.1 (verbatim), §5.2 (verbatim), §5.3 (verbatim).
-- Spike simplifications (marked "SPK-08:"): only audit_entries and a minimal audit_partitions; a placeholder RLS policy.
-- Run by the bootstrap superuser with the pinned search path, in one transaction.
-- NOT security-approved (SPK-08 prototype); the real bootstrap file needs the rule-12 audit-DDL marker with a reviewer entry.
SET search_path = pg_catalog, pg_temp;
SET ROLE platform_audit_owner;

-- §5.1 verbatim
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

-- RLS: ENABLE + FORCE (data-model §4.6 C1). SPK-08: placeholder policies, not the §5 policy text.
ALTER TABLE public.audit_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY p_audit_entries__app_select ON public.audit_entries FOR SELECT TO platform_app
  USING (scope_org_id = NULLIF(pg_catalog.current_setting('app.org_id', true), '')::uuid);
CREATE POLICY p_audit_entries__app_insert ON public.audit_entries FOR INSERT TO platform_app
  WITH CHECK (correlation_id IS NOT NULL);

-- SPK-08: minimal audit_partitions (data-model §3, `audit_partitions`), enough for ensure_audit_partitions.
CREATE TABLE public.audit_partitions (
  id                 uuid        NOT NULL DEFAULT uuidv7() CONSTRAINT pk_audit_partitions PRIMARY KEY,
  partition_name     text        NOT NULL CONSTRAINT ux_audit_partitions__partition_name UNIQUE,
  range_start        timestamptz NOT NULL,
  range_end          timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1,
  CONSTRAINT ck_audit_partitions__range CHECK (range_end > range_start)
);

-- §5.2 verbatim (the audit_entries part; checkpoint heads and anchors are not prototyped)
CREATE FUNCTION platform.audit_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '42501',
    MESSAGE = pg_catalog.format('AUDIT_IMMUTABLE: %s on %s is not permitted', TG_OP, TG_TABLE_NAME);
END $$;

CREATE TRIGGER trg_audit_entries__no_update_delete
  BEFORE UPDATE OR DELETE ON public.audit_entries
  FOR EACH ROW EXECUTE FUNCTION platform.audit_forbid_mutation();

CREATE TRIGGER trg_audit_entries__no_truncate
  BEFORE TRUNCATE ON public.audit_entries
  FOR EACH STATEMENT EXECUTE FUNCTION platform.audit_forbid_mutation();
ALTER FUNCTION platform.audit_forbid_mutation() OWNER TO platform_audit_owner;

-- §5.3 verbatim
CREATE FUNCTION platform.ensure_audit_partitions(p_months_ahead integer DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
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
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('audit:partitions')::bigint);
  FOR i IN 0..p_months_ahead LOOP
    v_month := (pg_catalog.date_trunc('month', pg_catalog.now()) + pg_catalog.make_interval(months => i))::date;
    v_from  := v_month::timestamp AT TIME ZONE 'UTC';
    v_to    := (v_month + interval '1 month')::timestamp AT TIME ZONE 'UTC';
    v_name  := 'audit_entries_' || pg_catalog.to_char(v_month::timestamp, 'YYYY_MM');
    IF pg_catalog.to_regclass('public.' || v_name) IS NULL THEN
      EXECUTE pg_catalog.format('CREATE TABLE public.%I (LIKE public.audit_entries INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING GENERATED)', v_name);
      EXECUTE pg_catalog.format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (occurred_at >= %L AND occurred_at < %L)',
                     v_name, 'ck_' || v_name || '__range', v_from, v_to);
      EXECUTE pg_catalog.format('ALTER TABLE public.audit_entries ATTACH PARTITION public.%I FOR VALUES FROM (%L) TO (%L)',
                     v_name, v_from, v_to);
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
ALTER FUNCTION platform.ensure_audit_partitions(integer) OWNER TO platform_audit_owner;
REVOKE ALL ON FUNCTION platform.ensure_audit_partitions(integer) FROM PUBLIC;

-- §4.4 bootstrap-lane grants (the audit_entries / audit_partitions subset)
GRANT SELECT, INSERT ON public.audit_entries TO platform_app;
GRANT SELECT, INSERT, UPDATE ON public.audit_partitions TO platform_app;
GRANT EXECUTE ON FUNCTION platform.ensure_audit_partitions(integer) TO platform_app;
-- SPK-08: the current month only (the "+1 partition"); the test then calls ensure_audit_partitions(3) as platform_app.
SELECT platform.ensure_audit_partitions(0);
RESET ROLE;
