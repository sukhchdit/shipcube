-- PR5-SEC-02 / CR m1 bypass form without the @audit-ddl marker: rule 12 must fire.
SET search_path = pg_catalog, pg_temp;
GRANT USAGE ON SCHEMA platform TO platform_audit_owner WITH GRANT OPTION;
