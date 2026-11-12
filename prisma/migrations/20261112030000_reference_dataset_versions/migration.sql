-- migration-kind: expand
-- data-changing: no
-- reversible: yes
--
-- Seed idempotency table (TASK-023; REQ-DATA-001, REQ-RBAC-013, REQ-COMP-008, data-model §3.5). SYSTEM class (§1.5):
-- no org_id and no RLS. One row per seeded dataset (e.g. `countries`, `compliance_pack:IN`, `authz_matrix`) holding the
-- version and the SHA-256 of its canonical content, so an unchanged dataset is a no-op (no writes, no audit entry).
-- The reference seed (platform_migrator) and the US-073 reconciler write it; platform_app may read, insert and update
-- (grant matrix, data-model §4.4) and never delete.
CREATE TABLE "public"."reference_dataset_versions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "dataset" TEXT NOT NULL,
    "dataset_version" TEXT NOT NULL,
    "content_sha256" BYTEA NOT NULL,
    "applied_at" TIMESTAMPTZ(6) NOT NULL,
    "row_count" INTEGER NOT NULL,

    CONSTRAINT "pk_reference_dataset_versions" PRIMARY KEY ("id"),
    CONSTRAINT "ck_reference_dataset_versions__version" CHECK ("version" >= 1),
    CONSTRAINT "ck_reference_dataset_versions__content_sha256" CHECK (octet_length("content_sha256") = 32),
    CONSTRAINT "ck_reference_dataset_versions__row_count" CHECK ("row_count" >= 0)
);

CREATE UNIQUE INDEX "ux_reference_dataset_versions__dataset" ON "public"."reference_dataset_versions"("dataset");

GRANT SELECT, INSERT, UPDATE ON TABLE "public"."reference_dataset_versions" TO platform_app;
