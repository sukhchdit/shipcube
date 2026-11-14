-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR11-SEC-16): an E-string inside dynamic SQL.

DO $$
BEGIN
  EXECUTE 'SELECT E''\x61pp''';
END
$$;
