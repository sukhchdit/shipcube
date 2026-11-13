-- migration-kind: expand
-- data-changing: no
-- reversible: yes

SET lock_timeout = '10s';
DO $$ DECLARE s text := 'RESET lock_timeout'; BEGIN PERFORM 1; END $$;
