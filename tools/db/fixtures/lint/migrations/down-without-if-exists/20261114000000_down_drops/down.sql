DROP TABLE public.fixture_items;
ALTER TABLE public.fixture_owners DROP COLUMN remark, DROP CONSTRAINT IF EXISTS ck_fixture_owners__x;
DROP INDEX IF EXISTS public.ix_fixture_items__x;
ALTER TABLE public.fixture_owners DROP COLUMN IF EXISTS remark2, DROP CONSTRAINT IF EXISTS ck_fixture_owners__y;
DROP FUNCTION IF EXISTS public.fixture_f();
