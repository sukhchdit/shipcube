-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE FUNCTION platform.app_org_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT NULLIF(current_setting('app.org_id', true), '')::uuid $$;
CREATE FUNCTION platform.fixture_trigger_message() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('app.correlation_id', true) $$;
CREATE FUNCTION platform.fixture_path() RETURNS void LANGUAGE sql AS $$ SELECT set_config('search_path', 'pg_catalog', true) $$;
