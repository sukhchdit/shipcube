-- PR5-SEC-02 / CR m1 bypass form without the @audit-ddl marker: rule 12 must fire.
SET search_path = pg_catalog, pg_temp;
DO $grant$
BEGIN
  EXECUTE 'GRANT platform_audit_owner TO platform_migrator';
END
$grant$;
