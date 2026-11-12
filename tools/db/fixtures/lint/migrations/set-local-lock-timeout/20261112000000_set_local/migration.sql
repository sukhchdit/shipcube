-- migration-kind: expand
-- data-changing: no
-- reversible: yes

SET LOCAL lock_timeout = '2s';
ALTER TABLE public.fixture_items ADD COLUMN remark text;
