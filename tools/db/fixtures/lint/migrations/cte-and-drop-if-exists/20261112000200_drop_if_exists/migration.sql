-- migration-kind: expand
-- data-changing: no
-- reversible: yes
ALTER TABLE public.fixture_items DROP IF EXISTS note;
