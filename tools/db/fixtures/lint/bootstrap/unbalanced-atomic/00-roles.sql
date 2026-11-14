SET search_path = pg_catalog, pg_temp;
-- Negative fixture (PR43-SEC-03, rule L): the file ends inside a BEGIN ATOMIC block.
CREATE FUNCTION public.fixture_open() RETURNS integer LANGUAGE sql
BEGIN ATOMIC
  SELECT 1;
