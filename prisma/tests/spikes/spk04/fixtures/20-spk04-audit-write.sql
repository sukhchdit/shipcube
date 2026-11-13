-- SPK-04 (TASK-018) THROWAWAY PROTOTYPE of the audit write-path tables (audit_stream_heads, data_subjects,
-- audit_pii_vault). Test-only: applied by prisma/tests/spikes/spk04/runner.ts to a Testcontainers database AFTER
-- prisma/tests/spikes/spk08/10-audit.sql and BEFORE prisma/tests/spikes/spk08/90-audit-ddl-guard.sql. It is NEVER part
-- of prisma/bootstrap/** or prisma/migrations/** (the real audit DDL is TASK-021's).
--
-- Source: data-model.md §5.7 (data_subjects, audit_pii_vault, platform.audit_vault_guard() and its triggers) verbatim;
-- audit_stream_heads per the data-model column list (STD columns + stream_id UNIQUE, entry_count, head_entry_id,
-- head_occurred_at, head_hash, last_verified_seq, last_verified_hash, last_verified_occurred_at); grants per
-- data-model lines 2687-2688 / 2767.
-- SPK-04 simplification: no RLS policies on these three tables (the benchmark measures the write path; RLS on
-- audit_entries and on the business table is the real ENABLE + FORCE text).
-- Run by the bootstrap superuser with the pinned search path, in one transaction.
SET search_path = pg_catalog, pg_temp;
SET ROLE platform_audit_owner;

CREATE TABLE public.audit_stream_heads (
  id                        uuid        NOT NULL DEFAULT uuidv7() CONSTRAINT pk_audit_stream_heads PRIMARY KEY,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid        NOT NULL,
  updated_by                uuid        NOT NULL,
  version                   integer     NOT NULL DEFAULT 1 CONSTRAINT ck_audit_stream_heads__version CHECK (version >= 1),
  stream_id                 uuid        NOT NULL CONSTRAINT ux_audit_stream_heads__stream UNIQUE,
  entry_count               bigint      NOT NULL DEFAULT 0 CONSTRAINT ck_audit_stream_heads__count CHECK (entry_count >= 0),
  head_entry_id             uuid,
  head_occurred_at          timestamptz,
  head_hash                 bytea       NOT NULL DEFAULT pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
                              CONSTRAINT ck_audit_stream_heads__head_hash CHECK (octet_length(head_hash) = 32),
  last_verified_seq         bigint      NOT NULL DEFAULT 0,
  last_verified_hash        bytea       NOT NULL CONSTRAINT ck_audit_stream_heads__verified_hash CHECK (octet_length(last_verified_hash) = 32),
  last_verified_occurred_at timestamptz
);
ALTER TABLE public.audit_stream_heads OWNER TO platform_audit_owner;

-- §5.7 verbatim
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
  value_hmac_key_id text NOT NULL,
  ciphertext     bytea NOT NULL CONSTRAINT ck_audit_pii_vault__ct CHECK (octet_length(ciphertext) BETWEEN 29 AND 65536),
  ciphertext_key_id text NOT NULL,
  CONSTRAINT ux_audit_pii_vault__subject_field_value UNIQUE (subject_id, entity_name, field, value_hmac)
);

CREATE FUNCTION platform.audit_vault_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_user = 'platform_erasure'
     AND pg_catalog.current_setting('app.erasure_request_id', true) ~* '^[0-9a-f-]{36}$' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = pg_catalog.format('AUDIT_VAULT_IMMUTABLE: %s', TG_OP);
END $$;
CREATE TRIGGER trg_audit_pii_vault__guard BEFORE UPDATE OR DELETE ON public.audit_pii_vault
  FOR EACH ROW EXECUTE FUNCTION platform.audit_vault_guard();
CREATE TRIGGER trg_audit_pii_vault__no_truncate BEFORE TRUNCATE ON public.audit_pii_vault
  FOR EACH STATEMENT EXECUTE FUNCTION platform.audit_forbid_mutation();
ALTER TABLE public.data_subjects   OWNER TO platform_audit_owner;
ALTER TABLE public.audit_pii_vault OWNER TO platform_audit_owner;
ALTER FUNCTION platform.audit_vault_guard() OWNER TO platform_audit_owner;

GRANT SELECT, INSERT ON public.audit_pii_vault TO platform_app;
GRANT SELECT, INSERT ON public.data_subjects TO platform_app;
GRANT SELECT, INSERT, UPDATE ON public.audit_stream_heads TO platform_app;
RESET ROLE;
