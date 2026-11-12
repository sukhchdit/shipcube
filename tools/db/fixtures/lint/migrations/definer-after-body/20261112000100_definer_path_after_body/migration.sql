-- migration-kind: expand
-- data-changing: no
-- reversible: yes
SET ROLE platform_definer;
CREATE FUNCTION platform.fixture_after_ok() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp;
CREATE FUNCTION platform.fixture_body_only() RETURNS text AS $$ SELECT 'security definer' $$ LANGUAGE sql;
RESET ROLE;
