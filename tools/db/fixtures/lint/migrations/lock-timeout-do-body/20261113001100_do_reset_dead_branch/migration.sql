-- migration-kind: expand
-- data-changing: no
-- reversible: yes

SET lock_timeout = '10s';
DO $$ BEGIN IF false THEN RESET lock_timeout; END IF; END $$;
