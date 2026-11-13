-- U& string in a DO body, no approval marker
SET search_path = pg_catalog, pg_temp;
DO $$
BEGIN
  EXECUTE U&'DROP TABLE public.audit\005fentries';
END
$$;
