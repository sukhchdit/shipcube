-- @audit-ddl security-approved: mallory 2026-11-01
SET search_path = pg_catalog, pg_temp;
CREATE TABLE public.audit_entries (id uuid);
