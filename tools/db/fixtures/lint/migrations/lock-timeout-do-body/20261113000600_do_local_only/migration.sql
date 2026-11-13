-- migration-kind: expand
-- data-changing: no
-- reversible: yes

DO $$
BEGIN
  SET LOCAL lock_timeout = '10s';
  PERFORM set_config('lock_timeout', '10s', true);
END
$$;
