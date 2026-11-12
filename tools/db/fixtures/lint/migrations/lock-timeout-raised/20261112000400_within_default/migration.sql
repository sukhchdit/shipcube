-- migration-kind: expand
-- data-changing: no
-- reversible: yes

SET lock_timeout = '3s';
ALTER TABLE public.fixture_items ADD COLUMN remark7 text;
