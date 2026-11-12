-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE FUNCTION platform.fixture_r() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('app.' || 'org_id', true) $$;
