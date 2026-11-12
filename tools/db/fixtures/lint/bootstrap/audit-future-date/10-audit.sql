-- @audit-ddl security-approved: security-analyst 2099-01-01
SET search_path = pg_catalog, pg_temp;
CREATE TABLE public.audit_entries (id uuid);
