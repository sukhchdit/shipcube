-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Control: a DO block keeps its own handling (its literals are read as dynamic SQL, as for EXECUTE).

DO $$
BEGIN
  PERFORM query_to_xml('SELECT 1', true, false, '');
END
$$;
