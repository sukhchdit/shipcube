-- migration-kind: expand
-- data-changing: no
-- reversible: yes

DO $$ BEGIN SET app . org_id = '00000000-0000-0000-0000-000000000000'; END $$;
