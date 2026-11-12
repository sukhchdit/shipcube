-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE FUNCTION platform.fixture_switch_org(p_org uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('app.org_id', p_org::text, true) $$;
