-- migration-kind: expand
-- data-changing: no
-- reversible: yes

SET SESSION lock_timeout = '2s';
ALTER TABLE public.fixture_items ADD COLUMN remark2 text;
