-- migration-kind: expand
-- data-changing: no
-- reversible: yes

DO $$
BEGIN
  PERFORM set_config('lock_timeout', '0', false);
END
$$;
