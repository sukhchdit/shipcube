-- Reverts 20261119000000_job_executions (data-model.md §8.4): drops the job idempotency ledger. Its unique index,
-- constraints, guard trigger and grants go with it. Prefix-idempotent (rule 17). Dropping it loses only the duplicate
-- guard of jobs already completed; no business state lives here.
DROP TABLE IF EXISTS "public"."job_executions";
