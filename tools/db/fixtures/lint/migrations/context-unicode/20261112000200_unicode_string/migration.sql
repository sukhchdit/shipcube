-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR11-SEC-14 a): a U& string escape hides SET LOCAL app.org_id in dynamic SQL.

CREATE FUNCTION public.f_unicode_string() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE U&'SET LOCAL \0061pp.org_id = ''00000000-0000-0000-0000-000000000000''';
END $$;
