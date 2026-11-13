-- migration-kind: expand
-- data-changing: no
-- reversible: yes

DO $$
BEGIN
  EXECUTE 'SET LOCAL app.org_id = ''x''';
END
$$;
