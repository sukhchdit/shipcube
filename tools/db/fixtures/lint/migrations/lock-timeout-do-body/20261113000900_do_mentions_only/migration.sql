-- migration-kind: expand
-- data-changing: no
-- reversible: yes

DO $$
BEGIN
  -- SET lock_timeout = 0 (a comment)
  RAISE NOTICE 'the lock_timeout stays at the role default: %', 'lock_timeout';
END
$$;
