-- migration-kind: expand
-- data-changing: no
-- reversible: yes
CREATE FUNCTION platform.fixture_bad() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$ SELECT 1 $$;
CREATE FUNCTION platform.fixture_nopath() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
ALTER FUNCTION platform.fixture_lookup(uuid) SECURITY DEFINER;
ALTER FUNCTION platform.fixture_lookup(uuid) RESET search_path;
