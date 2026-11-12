-- migration-kind: expand
-- data-changing: no
-- reversible: yes

SET ROLE platform_definer;
CREATE FUNCTION platform.fixture_dup() RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET search_path = public AS $$ SELECT 1 $$;
RESET ROLE;
