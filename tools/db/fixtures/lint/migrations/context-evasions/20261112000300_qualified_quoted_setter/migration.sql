-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE FUNCTION platform.fixture_a(p text) RETURNS void LANGUAGE sql AS $$ SELECT pg_catalog."set_config"('app.org_id', p, true) $$;
