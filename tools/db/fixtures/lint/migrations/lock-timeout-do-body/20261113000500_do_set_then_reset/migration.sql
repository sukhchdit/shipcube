-- migration-kind: expand
-- data-changing: no
-- reversible: yes

DO $$
BEGIN
  SET lock_timeout = '10s';
  RESET lock_timeout;
END
$$;
