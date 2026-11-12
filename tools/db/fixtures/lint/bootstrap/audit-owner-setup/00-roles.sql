-- Role definition and schema grants for the audit owner, as in data-model.md §4.4: no audit object, no marker needed.
SET search_path = pg_catalog, pg_temp;
ALTER ROLE platform_audit_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
GRANT USAGE, CREATE ON SCHEMA public, platform TO platform_audit_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE platform_audit_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
