-- Handing out the audit owner role is audit DDL: it needs the approval marker (and C13 forbids it anyway).
SET search_path = pg_catalog, pg_temp;
GRANT platform_audit_owner TO platform_migrator;
