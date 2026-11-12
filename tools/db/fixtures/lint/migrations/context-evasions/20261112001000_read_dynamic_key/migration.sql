-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE FUNCTION platform.fixture_r(k text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting(k, true) $$;
