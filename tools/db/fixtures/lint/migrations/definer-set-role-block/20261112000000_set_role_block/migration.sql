-- migration-kind: expand
-- data-changing: no
-- reversible: yes

SET ROLE platform_definer;
CREATE FUNCTION platform.fixture_job() RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT 1 $$;
REVOKE EXECUTE ON FUNCTION platform.fixture_job() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.fixture_job() TO platform_app;
RESET ROLE;
