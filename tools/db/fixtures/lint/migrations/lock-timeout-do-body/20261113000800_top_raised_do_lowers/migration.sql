-- migration-kind: expand
-- data-changing: no
-- reversible: yes

SET lock_timeout = '10s';
DO $$
BEGIN
  SET lock_timeout = '2s';
END
$$;
