-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE FUNCTION platform.fixture_job() RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT 1 $$;
GRANT EXECUTE ON FUNCTION platform.fixture_job() TO platform_app;
