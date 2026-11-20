-- migration-kind: expand
-- data-changing: no
-- reversible: yes
--
-- Transactional outbox and consumer dedupe (TASK-043; US-011; REQ-PLAT-016, REQ-PLAT-017, NFR-RES-004, NFR-SCALE-002;
-- ADR-0004; data-model §3.5, §6.1, §10.5; D-ARCH-167, D-ARCH-171). Both tables are SYSTEM class (§1.5): no RLS.
-- - outbox_events, module outbox (tools/db/table-classes/outbox.json): one row per domain event, written by
--   apps/api/src/platform/outbox/writer.ts in the business transaction; the worker relay claims unpublished rows in
--   (created_at, id) order with FOR UPDATE SKIP LOCKED (ix_outbox_events__unpublished), enqueues one payload v2 job per
--   row and sets published_at. org_id has no foreign key on purpose (§6.1: an event of a deleted organisation stays a
--   fact). correlation_id has the ADR-0016 §15 grammar of a job payload, so a row can always be relayed.
-- - processed_events, module worker (tools/db/table-classes/worker.json): (consumer, event_id) dedupe of outbox
--   consumers; insert-only.
-- Both are on the hard-delete allow-list (hardDelete): the daily outbox-purge housekeeping job deletes rows published
-- or processed more than 30 days ago, and with it job_executions rows completed more than 30 days ago, so this file
-- also grants DELETE on job_executions (D-ARCH-171; worker.json gains hardDelete). processed_events is insert-only, so
-- platform_app holds no UPDATE on it (least privilege; D-TASK043-04). Full standard columns (catalog-std): the
-- standard-columns guard triggers are rendered from the manifests. No BEGIN ATOMIC routine and no prisma/bootstrap file.
CREATE TABLE "public"."outbox_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "org_id" UUID,
    "actor_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "trace_context" TEXT,
    "published_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "pk_outbox_events" PRIMARY KEY ("id"),
    CONSTRAINT "ck_outbox_events__version" CHECK ("version" >= 1),
    CONSTRAINT "ck_outbox_events__type" CHECK ("type" ~ '^[a-z_]+\.[a-z_]+$'),
    CONSTRAINT "ck_outbox_events__aggregate_type" CHECK ("aggregate_type" ~ '^[a-z][a-z_]{0,62}$'),
    CONSTRAINT "ck_outbox_events__correlation_id" CHECK ("correlation_id" ~ '^[A-Za-z0-9-]{8,64}$'),
    CONSTRAINT "ck_outbox_events__attempts" CHECK ("attempts" >= 0),
    CONSTRAINT "ck_outbox_events__last_error" CHECK (char_length("last_error") <= 500)
);

CREATE INDEX "ix_outbox_events__unpublished" ON "public"."outbox_events"("created_at", "id") WHERE "published_at" IS NULL;

CREATE INDEX "ix_outbox_events__published_at" ON "public"."outbox_events"("published_at") WHERE "published_at" IS NOT NULL;

CREATE INDEX "ix_outbox_events__aggregate" ON "public"."outbox_events"("aggregate_type", "aggregate_id", "created_at");

ALTER TABLE "public"."outbox_events" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);

CREATE TABLE "public"."processed_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "consumer" TEXT NOT NULL,
    "event_id" UUID NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_processed_events" PRIMARY KEY ("id"),
    CONSTRAINT "ck_processed_events__version" CHECK ("version" >= 1),
    CONSTRAINT "ck_processed_events__consumer" CHECK ("consumer" ~ '^[a-z][a-z0-9_.-]{0,62}$')
);

CREATE UNIQUE INDEX "ux_processed_events__consumer_event" ON "public"."processed_events"("consumer", "event_id");

CREATE INDEX "ix_processed_events__processed_at" ON "public"."processed_events"("processed_at");

-- Standard-columns guard for public.outbox_events, module outbox: rendered by tools/db/render-rls.ts from prisma/sql/policy-templates; do not edit.
CREATE TRIGGER trg_outbox_events__std_columns BEFORE INSERT OR UPDATE ON public.outbox_events
  FOR EACH ROW EXECUTE FUNCTION platform.std_columns_guard();

-- Standard-columns guard for public.processed_events, module worker: rendered by tools/db/render-rls.ts from prisma/sql/policy-templates; do not edit.
CREATE TRIGGER trg_processed_events__std_columns BEFORE INSERT OR UPDATE ON public.processed_events
  FOR EACH ROW EXECUTE FUNCTION platform.std_columns_guard();

-- Runtime grants (data-model §4.4 SYSTEM hard-delete allow-list; prisma/sql/grants.manifest, C5).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."outbox_events" TO platform_app;
GRANT SELECT, INSERT, DELETE ON TABLE "public"."processed_events" TO platform_app;
-- job_executions joins the hard-delete allow-list with its purge (D-ARCH-171; data-model §3.5, §10.5).
GRANT DELETE ON TABLE "public"."job_executions" TO platform_app;
