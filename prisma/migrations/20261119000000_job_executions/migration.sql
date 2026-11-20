-- migration-kind: expand
-- data-changing: no
-- reversible: yes
--
-- Idempotency ledger of job effects (TASK-039; US-010; REQ-PLAT-014, NFR-RES-004, NFR-SCALE-002; ADR-0013 §4;
-- data-model §3.5 and §4.4, D-ARCH-171). SYSTEM class (§1.5), module worker (tools/db/table-classes/worker.json): no
-- org_id and no RLS. A worker processor claims (queue, BullMQ job id) in the transaction of its effect (Prisma
-- createMany with skipDuplicates: a target-less INSERT … ON CONFLICT DO NOTHING); a re-delivered job finds the
-- committed key and runs no second effect. Unique per queue, because BullMQ scopes job ids per queue (code review
-- R1-m1, PR039-SEC-02). One row per completed job: written once, never updated, so platform_app holds SELECT and INSERT
-- only (one line each in prisma/sql/grants.manifest, C5). DELETE and the 30-day purge (ix_job_executions__completed_at)
-- arrive with TASK-043 (D-ARCH-171). result is reserved and kept unset (ck_job_executions__result_unset, PR039-SEC-05):
-- its first writer drops the CHECK in its own migration and states what the column holds.
-- Full standard columns (catalog-std), so the standard-columns guard trigger of §7.6 is rendered from the manifest.
-- No BEGIN ATOMIC routine and no prisma/bootstrap file is added.
CREATE TABLE "public"."job_executions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "job_key" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "result" JSONB,
    "completed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_job_executions" PRIMARY KEY ("id"),
    CONSTRAINT "ck_job_executions__version" CHECK ("version" >= 1),
    CONSTRAINT "ck_job_executions__job_key" CHECK (char_length("job_key") BETWEEN 1 AND 200),
    CONSTRAINT "ck_job_executions__queue" CHECK ("queue" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
    CONSTRAINT "ck_job_executions__status" CHECK ("status" IN ('completed')),
    CONSTRAINT "ck_job_executions__result_unset" CHECK ("result" IS NULL)
);

CREATE UNIQUE INDEX "ux_job_executions__queue_job_key" ON "public"."job_executions"("queue", "job_key");

CREATE INDEX "ix_job_executions__completed_at" ON "public"."job_executions"("completed_at");

-- Standard-columns guard for public.job_executions, module worker: rendered by tools/db/render-rls.ts from prisma/sql/policy-templates; do not edit.
CREATE TRIGGER trg_job_executions__std_columns BEFORE INSERT OR UPDATE ON public.job_executions
  FOR EACH ROW EXECUTE FUNCTION platform.std_columns_guard();

-- Runtime grants (data-model §4.4; prisma/sql/grants.manifest, C5): insert-only ledger.
GRANT SELECT, INSERT ON TABLE "public"."job_executions" TO platform_app;
