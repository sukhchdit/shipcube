-- Reverts 20261117000000_organisations_identity (data-model.md §8.4). Prefix-idempotent (rule 17): every DROP carries
-- IF EXISTS, so it also reverts a partially applied up. Tables first (their policies, triggers, indexes, grants and the
-- reserved users and the reserved operator organisation of D-ARCH-151 go with them), then the functions the policies
-- and triggers named. app_is_operator() is owned by platform_definer, so it is dropped inside the SET ROLE block the up
-- used.
DROP TABLE IF EXISTS "public"."membership_roles";
DROP TABLE IF EXISTS "public"."memberships" CASCADE;
DROP TABLE IF EXISTS "public"."invitations";
DROP TABLE IF EXISTS "public"."users" CASCADE;
DROP TABLE IF EXISTS "public"."organisations";

DROP FUNCTION IF EXISTS platform.role_scope_matches_org();
DROP FUNCTION IF EXISTS platform.organisations_personal_delete_guard();
DROP FUNCTION IF EXISTS platform.organisations_type_immutable();
DROP FUNCTION IF EXISTS platform.std_columns_guard();

SET ROLE platform_definer;
DROP FUNCTION IF EXISTS platform.app_is_operator();
RESET ROLE;
REVOKE EXECUTE ON FUNCTION platform.app_actor_id() FROM platform_definer;
