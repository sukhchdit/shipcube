-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR #43 R1-m2): EXECUTE procedure; (a variable).

CREATE FUNCTION public.fixture_proc_var() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  procedure text := 'SELECT 1';
BEGIN
  EXECUTE procedure;
END
$$;
