-- Reverts 20261120200000_guest_capable_guard (data-model.md §8.4): drops the de-claim guard function. No trigger uses it
-- while no GUEST_CAPABLE table exists; a later migration that adds one depends on it and is reverted first.
-- Prefix-idempotent (rule 17).
DROP FUNCTION IF EXISTS platform.guest_capable_guard();
