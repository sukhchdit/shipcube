-- migration-kind: expand
-- data-changing: no
-- reversible: yes

DO $$ BEGIN UPDATE public.roles SET name = name; END $$;
