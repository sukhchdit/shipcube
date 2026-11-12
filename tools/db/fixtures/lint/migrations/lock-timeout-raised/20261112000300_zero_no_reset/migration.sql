-- migration-kind: expand
-- data-changing: no
-- reversible: yes

SET lock_timeout = 0;
ALTER TABLE public.fixture_items ADD COLUMN remark6 text;
