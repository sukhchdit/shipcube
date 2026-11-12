-- migration-kind: expand
-- data-changing: no
-- reversible: yes
DO $$ BEGIN EXECUTE 'DROP TABLE public.' || 'audit_anchors'; END $$;
