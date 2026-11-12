-- PR5-SEC-02 / CR m1 bypass form without the @audit-ddl marker: rule 12 must fire.
SET search_path = pg_catalog, pg_temp;
ALTER DEFAULT PRIVILEGES FOR ROLE platform_audit_owner GRANT UPDATE, DELETE ON TABLES TO platform_app;
