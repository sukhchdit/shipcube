-- Reverts 20261120000000_outbox_events (data-model.md §8.4): drops the outbox and the consumer dedupe table (their
-- indexes, constraints, guard triggers and grants go with them) and takes DELETE on job_executions back from
-- platform_app. Prefix-idempotent (rule 17). Dropping outbox_events loses unrelayed events: run it only on a database
-- whose outbox is drained (no row with published_at IS NULL).
REVOKE DELETE ON TABLE "public"."job_executions" FROM platform_app;
DROP TABLE IF EXISTS "public"."processed_events";
DROP TABLE IF EXISTS "public"."outbox_events";
