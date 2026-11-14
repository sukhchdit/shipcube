SET search_path = pg_catalog, pg_temp;
-- Negative fixture (PR24-SEC-05): an E-string inside a DO body's dynamic SQL.
DO $$
BEGIN
  EXECUTE 'SELECT E''x''';
END
$$;
