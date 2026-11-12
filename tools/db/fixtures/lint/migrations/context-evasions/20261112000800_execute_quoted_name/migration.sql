-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE FUNCTION platform.fixture_a(p text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'SET LOCAL "app.org_id" = ' || quote_literal(p); END $$;
