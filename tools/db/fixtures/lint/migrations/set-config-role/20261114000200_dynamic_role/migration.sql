-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR11-SEC-15 b): the role key in dynamic SQL.

DO $$
BEGIN
  EXECUTE 'SELECT set_config(''Role'', ''platform_definer'', false)';
END
$$;
