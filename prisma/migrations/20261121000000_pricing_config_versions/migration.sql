-- migration-kind: expand
-- data-changing: no
-- reversible: yes
--
-- Pricing configuration versions (TASK-080; US-140; D-010, REQ-PRICE-003, REQ-PRICE-020; ADR-0015 §4; data-model §3.9
-- and §9). GLOBAL class (§1.5), module pricing (tools/db/table-classes/pricing.json): no org_id and no RLS. A version
-- is a published, immutable set of pricing rules; quotes and booked shipments record the version they used. The rule
-- tables arrive with US-152; until then the rules are configuration as code (packages/pricing/src/config/sample.ts)
-- and this row carries its version key and content hash.
-- Single writer: the reference seed as platform_migrator, the table owner (insert-only dataset, data-model §9.1).
-- platform_app holds SELECT only (one line in prisma/sql/grants.manifest, C5; runtimeReadOnly in the manifest), so no
-- runtime role writes the standard columns and no standard-columns guard is rendered (no stdColumns flag).
-- Immutable when published: an AFTER UPDATE OR DELETE row trigger raises when the old row has published_at set. It
-- only raises (RETURN NULL), so it never runs after a BEFORE row trigger's change (C15 (b) does not apply).
-- No BEGIN ATOMIC routine and no prisma/bootstrap file is added.
CREATE TABLE "public"."pricing_config_versions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "version_key" TEXT NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "content_sha256" BYTEA NOT NULL,
    "source" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "pk_pricing_config_versions" PRIMARY KEY ("id"),
    CONSTRAINT "ck_pricing_config_versions__version" CHECK ("version" >= 1),
    CONSTRAINT "ck_pricing_config_versions__version_key" CHECK ("version_key" ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
    CONSTRAINT "ck_pricing_config_versions__content_sha256" CHECK (octet_length("content_sha256") = 32),
    CONSTRAINT "ck_pricing_config_versions__source" CHECK ("source" IN ('SEED', 'SAMPLE', 'ADMIN')),
    CONSTRAINT "ck_pricing_config_versions__notes" CHECK ("notes" IS NULL OR char_length("notes") <= 2000)
);

CREATE UNIQUE INDEX "ux_pricing_config_versions__version_key" ON "public"."pricing_config_versions"("version_key");

-- AP-PRICE-01: the active version at instant T is the published one with the latest effective_from <= T.
CREATE INDEX "ix_pricing_config_versions__effective" ON "public"."pricing_config_versions"("effective_from" DESC)
  WHERE "published_at" IS NOT NULL;

-- data-model §3.9: a published version never changes (raises PRICING_VERSION_IMMUTABLE, SQLSTATE P0001). SECURITY
-- INVOKER, fixed search_path, no context read.
CREATE FUNCTION platform.pricing_config_versions_immutable_when_published() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PRICING_VERSION_IMMUTABLE: a published pricing configuration version cannot change; add a new version';
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_pricing_config_versions__immutable_when_published AFTER UPDATE OR DELETE ON public.pricing_config_versions
  FOR EACH ROW EXECUTE FUNCTION platform.pricing_config_versions_immutable_when_published();

-- Runtime grants (data-model §4.4; prisma/sql/grants.manifest, C5): read-only configuration.
GRANT SELECT ON TABLE "public"."pricing_config_versions" TO platform_app;
