-- migration-kind: expand
-- data-changing: no
-- reversible: yes

DO $$
BEGIN
  PERFORM set_config('statement_timeout', '5s', true);
  RAISE NOTICE 'request context untouched';
END
$$;
