-- migration-kind: expand
-- data-changing: no
-- reversible: yes

SET lock_timeout = '10s';
ALTER TABLE public.fixture_items ADD COLUMN remark3 text;
