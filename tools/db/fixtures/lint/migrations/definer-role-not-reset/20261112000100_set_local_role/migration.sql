-- migration-kind: expand
-- data-changing: no
-- reversible: yes

SET LOCAL ROLE platform_definer;
CREATE FUNCTION platform.fixture_job() RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT 1 $$;
RESET ROLE;
