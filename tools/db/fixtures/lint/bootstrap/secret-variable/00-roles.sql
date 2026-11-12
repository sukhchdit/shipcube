-- secret-variable fixture (PR5-SEC-12)
SET search_path = pg_catalog, pg_temp;
SELECT :'readonly_secret';
