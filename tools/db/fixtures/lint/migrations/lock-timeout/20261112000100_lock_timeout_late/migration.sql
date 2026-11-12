-- migration-kind: expand
-- data-changing: no
-- reversible: yes

ALTER TABLE public.fixture_items ADD COLUMN remark2 text;
SET lock_timeout = '2s';
