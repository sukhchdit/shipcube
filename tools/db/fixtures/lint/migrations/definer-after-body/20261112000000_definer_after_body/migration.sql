-- migration-kind: expand
-- data-changing: no
-- reversible: yes
SET ROLE platform_definer;
CREATE FUNCTION platform.fixture_after() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql SECURITY DEFINER;
RESET ROLE;
