-- migration-kind: expand
-- data-changing: no
-- reversible: yes

DO $$
BEGIN
  EXECUTE format('SET lock_timeout = %L', '10s');
END
$$;
