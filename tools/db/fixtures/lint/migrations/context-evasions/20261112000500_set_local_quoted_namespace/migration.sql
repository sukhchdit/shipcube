-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE FUNCTION public.fixture_a() RETURNS void LANGUAGE plpgsql AS $$ BEGIN SET LOCAL "app".org_id = '00000000-0000-0000-0000-000000000000'; END $$;
