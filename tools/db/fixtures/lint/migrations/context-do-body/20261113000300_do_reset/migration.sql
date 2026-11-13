-- migration-kind: expand
-- data-changing: no
-- reversible: yes

DO $$
BEGIN
  RESET app.org_id;
END
$$;
