-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR11-SEC-14 a): a U& identifier escape spells SET LOCAL app.org_id inside a function body.

CREATE FUNCTION public.f_unicode_ident(p text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL U&"\0061pp".org_id = '00000000-0000-0000-0000-000000000000';
END $$;
