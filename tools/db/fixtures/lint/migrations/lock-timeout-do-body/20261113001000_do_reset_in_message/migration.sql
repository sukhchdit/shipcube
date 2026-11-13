-- migration-kind: expand
-- data-changing: no
-- reversible: yes

SET lock_timeout = '10s';
DO $$ BEGIN RAISE NOTICE 'RESET lock_timeout'; END $$;
