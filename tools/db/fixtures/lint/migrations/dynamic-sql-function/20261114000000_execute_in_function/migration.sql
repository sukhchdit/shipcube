-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR11-SEC-14 b): EXECUTE in a function body.

CREATE FUNCTION public.fixture_dynamic() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SELECT 1';
END
$$;
