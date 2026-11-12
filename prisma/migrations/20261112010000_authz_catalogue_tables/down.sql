-- Reverts 20261112010000_authz_catalogue_tables (data-model.md §8.4): drops the three authz tables in reverse
-- dependency order. Their indexes, constraints and grants go with them. Run after the seed migration's down.sql.
DROP TABLE "public"."role_permissions";
DROP TABLE "public"."roles";
DROP TABLE "public"."permissions";
