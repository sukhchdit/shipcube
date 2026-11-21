-- Reverts 20261121000000_pricing_config_versions (data-model.md §8.4): drops the pricing configuration versions table,
-- then the two functions its triggers named. Its indexes, constraints, triggers and grants go with the table.
-- Prefix-idempotent (rule 17). The next reference seed run re-inserts the sample version row.
DROP TABLE IF EXISTS "public"."pricing_config_versions";

DROP FUNCTION IF EXISTS platform.pricing_config_versions_no_truncate();

DROP FUNCTION IF EXISTS platform.pricing_config_versions_immutable_when_published();
