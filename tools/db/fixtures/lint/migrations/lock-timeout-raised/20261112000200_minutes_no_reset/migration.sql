-- migration-kind: expand
-- data-changing: no
-- reversible: yes

SET SESSION lock_timeout TO '1min';
ALTER TABLE public.fixture_items ADD COLUMN remark5 text;
