-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE FUNCTION platform.fixture_plain() RETURNS int LANGUAGE sql STABLE AS $$ SELECT 1 $$;
ALTER FUNCTION platform.fixture_plain() OWNER TO platform_definer;
