-- SPK-04 (TASK-018) THROWAWAY PROTOTYPE: a TENANT business table for the audit A/B benchmark. Test-only: applied by
-- prisma/tests/spikes/spk04/runner.ts after the migrations; NEVER part of prisma/migrations/**.
-- RLS: ENABLE + FORCE with the policy text of prisma/sql/policy-templates/tenant.sql (data-model §4.3 TENANT).
-- Run by the bootstrap superuser with the pinned search path, in one transaction, as the migrator.
SET search_path = pg_catalog, pg_temp;
SET ROLE platform_migrator;

CREATE TABLE public.spk04_orders (
  id             uuid        NOT NULL DEFAULT uuidv7() CONSTRAINT pk_spk04_orders PRIMARY KEY,
  org_id         uuid        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_by     uuid        NOT NULL,
  version        integer     NOT NULL DEFAULT 1 CONSTRAINT ck_spk04_orders__version CHECK (version >= 1),
  status         text        NOT NULL CONSTRAINT ck_spk04_orders__status CHECK (status IN ('DRAFT','QUOTED','BOOKED','CANCELLED')),
  origin_country text        NOT NULL,
  dest_country   text        NOT NULL,
  weight_grams   integer     NOT NULL CONSTRAINT ck_spk04_orders__weight CHECK (weight_grams > 0),
  sender_name    text        NOT NULL,
  sender_email   text        NOT NULL,
  receiver_phone text        NOT NULL
);
CREATE INDEX ix_spk04_orders__org_created ON public.spk04_orders (org_id, created_at DESC, id DESC);

ALTER TABLE public.spk04_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spk04_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY p_spk04_orders__tenant ON public.spk04_orders
  FOR ALL TO platform_app
  USING      (org_id = platform.app_org_id())
  WITH CHECK (org_id = platform.app_org_id());

GRANT SELECT, INSERT, UPDATE ON public.spk04_orders TO platform_app;
RESET ROLE;
