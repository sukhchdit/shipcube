CREATE OR REPLACE FUNCTION public.begin() RETURNS integer LANGUAGE sql AS 'SELECT 1';
DROP TABLE public.fixture_items;
COMMIT;
