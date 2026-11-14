CREATE OR REPLACE FUNCTION public.fixture_open() RETURNS integer LANGUAGE sql
BEGIN ATOMIC
  SELECT 1;
DROP TABLE public.fixture_items;
