-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE FUNCTION platform.fixture_a(p text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE format('SET LOCAL %I = %L', 'app.org_id', p); END $$;
