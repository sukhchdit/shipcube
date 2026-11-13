-- migration-kind: expand
-- data-changing: no
-- reversible: yes

DO $$
BEGIN
  EXECUTE 'SET SESSION lock_timeout TO ''1min''';
END
$$;
