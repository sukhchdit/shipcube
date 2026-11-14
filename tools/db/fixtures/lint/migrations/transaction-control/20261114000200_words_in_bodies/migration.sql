-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Control: transaction words inside a DO body, a string, a CASE … END and a BEGIN ATOMIC body.

DO $$
BEGIN
  RAISE NOTICE 'COMMIT later';
END
$$;
SELECT CASE WHEN true THEN 'begin' ELSE 'rollback' END;
CREATE FUNCTION public.fixture_atomic() RETURNS int LANGUAGE sql
BEGIN ATOMIC
  SELECT CASE WHEN true THEN 1 ELSE 0 END;
  SELECT 2;
END;
