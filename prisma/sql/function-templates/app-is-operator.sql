-- template: platform.app_is_operator() (data-model §4.2; ADR-0005 amendments 2 and 6, am. 10 item 9; SEC-P3-25,
-- SEC-P3-27; lead decision 5 of TASK-016).
--
-- NOT shipped by TASK-016: the body reads public.memberships and public.organisations, which TASK-037 creates, and a
-- SQL body is validated at CREATE time (check_function_bodies is never turned off). TASK-037 copies this block into
-- the migration that creates those two tables, after their RLS blocks and their definer-read policies (the function
-- reads through p_memberships__definer_read / p_organisations__definer_read).
--
-- Order matters (F-10): the migrator holds platform_definer WITH INHERIT FALSE, SET TRUE, so the function is created
-- and granted INSIDE the SET ROLE block (preferred form; linter rule 15). platform.app_actor_id() is owned by the
-- migrator, so its EXECUTE grant to the definer is issued before SET ROLE: the function runs as platform_definer and
-- PUBLIC holds no EXECUTE on the helpers (01-schemas.sql default privileges).
GRANT EXECUTE ON FUNCTION platform.app_actor_id() TO platform_definer;

SET ROLE platform_definer;
CREATE FUNCTION platform.app_is_operator() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
  SELECT pg_catalog.current_setting('app.actor_scope', true) = 'OPERATOR'
     AND EXISTS (SELECT 1
                   FROM public.memberships m
                   JOIN public.organisations o ON o.id = m.org_id
                  WHERE o.type = 'OPERATOR'
                    AND m.user_id = platform.app_actor_id()
                    AND m.status = 'ACTIVE')
$$;
REVOKE EXECUTE ON FUNCTION platform.app_is_operator() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.app_is_operator() TO platform_app;
RESET ROLE;
