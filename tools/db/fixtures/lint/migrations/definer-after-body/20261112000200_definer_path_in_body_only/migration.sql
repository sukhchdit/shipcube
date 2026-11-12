-- migration-kind: expand
-- data-changing: no
-- reversible: yes
CREATE FUNCTION platform.fixture_body_path() RETURNS int SECURITY DEFINER AS $$ SET search_path = pg_catalog, pg_temp; SELECT 1 $$ LANGUAGE sql;
