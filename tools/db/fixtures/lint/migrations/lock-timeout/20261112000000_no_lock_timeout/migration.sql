-- migration-kind: expand
-- data-changing: no
-- reversible: yes

ALTER TABLE public.fixture_items ADD COLUMN remark text;
