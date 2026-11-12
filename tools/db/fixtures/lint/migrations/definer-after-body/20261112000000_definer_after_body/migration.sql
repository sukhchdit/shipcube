-- migration-kind: expand
-- data-changing: no
-- reversible: yes
CREATE FUNCTION platform.fixture_after() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql SECURITY DEFINER;
