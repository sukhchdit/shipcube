-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-03): a RETURNS TABLE column named begin.

CREATE FUNCTION public.fixture_begin_table() RETURNS TABLE (begin timestamptz) LANGUAGE sql AS $$ SELECT now() $$;
DROP TABLE public.fixture_items;
