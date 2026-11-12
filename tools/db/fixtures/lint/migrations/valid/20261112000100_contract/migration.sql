-- migration-kind: contract
-- data-changing: no
-- reversible: no
SET lock_timeout = '2s';
ALTER TABLE public.fixture_items DROP COLUMN note;
