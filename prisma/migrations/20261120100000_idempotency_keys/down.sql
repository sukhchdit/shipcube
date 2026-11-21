-- Reverts 20261120100000_idempotency_keys (data-model.md §8.4): drops the HTTP idempotency key store. Its indexes,
-- constraints, guard trigger and grants go with it. Prefix-idempotent (rule 17). Dropping it loses only the replay
-- records of the last 24 hours (a retry then executes again); no business state lives here.
DROP TABLE IF EXISTS "public"."idempotency_keys";
