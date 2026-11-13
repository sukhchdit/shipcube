-- Reverts 20261112030000_reference_dataset_versions (data-model.md §8.4): drops the seed idempotency table. Its unique
-- index, constraints and grants go with it. The next reference seed run recreates the version rows.
DROP TABLE "public"."reference_dataset_versions";
