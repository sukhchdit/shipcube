-- migration-kind: expand
-- data-changing: no
-- reversible: yes
ALTER TABLE public.fixture_items ALTER COLUMN note DROP DEFAULT;
