-- migration-kind: expand
-- data-changing: no
-- reversible: yes

DO $$
BEGIN
  PERFORM set_config('app.org_id', gen_random_uuid()::text, false);
END
$$;
