-- migration-kind: expand
-- data-changing: no
-- reversible: yes

SET lock_timeout = '2s';
ALTER TABLE public.fixture_items ADD COLUMN qty int NOT NULL;
