-- audit fixture without an approval marker
SET search_path = pg_catalog, pg_temp;
CREATE TABLE public.audit_entries (id uuid);
