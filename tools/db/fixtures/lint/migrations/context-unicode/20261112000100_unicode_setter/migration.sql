-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR11-SEC-14 a): a U& identifier escape spells the setter function name.

CREATE FUNCTION public.f_unicode_setter(p text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM U&"\0073et_config"('app.org_id', p, true);
END $$;
