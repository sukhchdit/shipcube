-- migration-kind: expand
-- data-changing: no
-- reversible: yes

DO $$ BEGIN EXECUTE 'DELETE FROM public.fixture_items'; END $$;
