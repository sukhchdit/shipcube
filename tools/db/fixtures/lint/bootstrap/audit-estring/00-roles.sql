SET search_path = pg_catalog, pg_temp;
-- Negative fixture (PR24-SEC-05): an E-string spells an audit object in hex.
SELECT E'audit\x5fentries';
