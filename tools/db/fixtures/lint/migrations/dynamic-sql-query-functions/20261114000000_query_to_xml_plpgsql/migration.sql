-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-06 b): query_to_xml in a PL/pgSQL body.

CREATE FUNCTION public.fixture_qx() RETURNS xml LANGUAGE plpgsql AS $$
BEGIN
  RETURN query_to_xml('SELECT 1', true, false, '');
END
$$;
