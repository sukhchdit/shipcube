-- migration-kind: expand
-- data-changing: no
-- reversible: yes

DO $$
BEGIN
  EXECUTE 'SET lock_timeout = 0';
END
$$;
RESET lock_timeout;
