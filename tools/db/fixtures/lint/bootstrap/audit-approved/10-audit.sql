-- @audit-ddl security-approved: security-analyst 2026-11-01
SET search_path = pg_catalog, pg_temp;
SET ROLE platform_audit_owner;
CREATE TABLE public.audit_entries (id uuid);
RESET ROLE;
