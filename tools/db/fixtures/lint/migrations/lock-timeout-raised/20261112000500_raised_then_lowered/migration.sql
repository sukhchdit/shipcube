-- migration-kind: expand
-- data-changing: no
-- reversible: yes

SET lock_timeout = 10000;
ALTER TABLE public.fixture_items ADD COLUMN remark8 text;
SET lock_timeout TO DEFAULT;
