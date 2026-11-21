-- Reverts 20261121000000_idempotency_keys_completed_body (data-model.md §8.4): drops the check that a completed key
-- carries its sealed response. Prefix-idempotent (rule 17). No data changes.
SET lock_timeout = '3s';

ALTER TABLE "public"."idempotency_keys" DROP CONSTRAINT IF EXISTS "ck_idempotency_keys__completed_body";
