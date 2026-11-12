-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE FUNCTION public.fixture_switch_org() RETURNS void LANGUAGE plpgsql AS $$ BEGIN SET app.org_id = '00000000-0000-0000-0000-000000000000'; END $$;
