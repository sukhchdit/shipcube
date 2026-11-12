-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE FUNCTION platform.fixture_r() RETURNS text LANGUAGE plpgsql STABLE AS $$ DECLARE v text; BEGIN EXECUTE format('SHOW %s', 'app.org_id') INTO v; RETURN v; END $$;
