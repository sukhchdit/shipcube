-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE FUNCTION public.fixture_a() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RESET "app".org_id; END $$;
