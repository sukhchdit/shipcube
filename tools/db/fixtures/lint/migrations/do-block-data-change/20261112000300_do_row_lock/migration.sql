-- migration-kind: expand
-- data-changing: no
-- reversible: yes

DO $$ BEGIN PERFORM 1 FROM public.fixture_items FOR UPDATE; RAISE NOTICE 'checked'; END $$;
