-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR #43 R1-m2): EXECUTE function; (a variable).

CREATE FUNCTION public.fixture_fn_var() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  function text := 'SELECT 1';
BEGIN
  EXECUTE function;
END
$$;
