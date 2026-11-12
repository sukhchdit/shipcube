-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE FUNCTION platform.fixture_job() RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT 1 $$;
ALTER FUNCTION platform.fixture_job() OWNER TO platform_definer;
REVOKE EXECUTE ON FUNCTION platform.fixture_job() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.fixture_job() TO platform_app;
