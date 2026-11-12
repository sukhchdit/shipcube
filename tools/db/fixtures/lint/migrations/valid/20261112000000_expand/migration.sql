-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- audit_entries is only named in this comment, which the linter ignores.
CREATE TABLE public.fixture_items (id uuid PRIMARY KEY DEFAULT uuidv7(), note text);
SET ROLE platform_definer;
CREATE FUNCTION platform.fixture_lookup(p_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$ SELECT p_id $$;
RESET ROLE;
