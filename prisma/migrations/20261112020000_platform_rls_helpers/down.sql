-- Reverts 20261112020000_platform_rls_helpers (data-model.md §8.4): drops the three plain RLS helpers. Their grants go
-- with them. No policy references them yet; once a module migration renders policies over them, that migration's
-- down.sql runs first (reverse order), so this file never drops a helper a policy still depends on.
DROP FUNCTION platform.app_guest_token_hash();
DROP FUNCTION platform.app_actor_id();
DROP FUNCTION platform.app_org_id();
