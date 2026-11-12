-- migration-kind: expand
-- data-changing: no
-- reversible: yes
--
-- Row-level security helper functions (TASK-016; US-074, US-075; REQ-RLS-001/002/004; data-model §4.2, §4.4;
-- ADR-0005 and its amendments 6, 9 and 10). Plain SQL helpers in schema platform, owned by platform_migrator:
-- unset, empty ('', F-07) or malformed settings evaluate to NULL, so every policy comparison is false and the query
-- returns zero rows instead of raising (fail closed, REQ-RLS-004).
--
-- No SET clause on purpose: a SET clause stops the planner from inlining the helpers, which would cost the index
-- condition `org_id = platform.app_org_id()` (data-model §4.2). They are not SECURITY DEFINER and run with the
-- caller's rights and search path (platform_app: pg_catalog, public).
--
-- EXECUTE: the bootstrap lane revokes the built-in PUBLIC EXECUTE default globally for functions the migrator creates
-- (01-schemas.sql, D-ARCH-046); the REVOKE below restates it, and every EXECUTE is an explicit grant (data-model §4.4
-- grant matrix, C11).
--
-- platform.app_is_operator() is NOT created here: it is SECURITY DEFINER over public.memberships and
-- public.organisations, which TASK-037 creates, and a SQL function body is validated at CREATE time
-- (check_function_bodies stays on). Its template is prisma/sql/function-templates/app-is-operator.sql; TASK-037 ships
-- it under SET ROLE platform_definer (ADR-0005 am. 10 item 9, linter rule 15).

CREATE FUNCTION platform.app_org_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN current_setting('app.org_id', true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN current_setting('app.org_id', true)::uuid END
$$;

CREATE FUNCTION platform.app_actor_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN current_setting('app.actor_id', true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN current_setting('app.actor_id', true)::uuid END
$$;

CREATE FUNCTION platform.app_guest_token_hash() RETURNS bytea LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN current_setting('app.guest_token_hash', true) ~ '^[0-9a-f]{64}$'
              THEN decode(current_setting('app.guest_token_hash', true), 'hex') END
$$;

REVOKE EXECUTE ON FUNCTION platform.app_org_id(), platform.app_actor_id(), platform.app_guest_token_hash() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.app_org_id(), platform.app_actor_id(), platform.app_guest_token_hash() TO platform_app;
