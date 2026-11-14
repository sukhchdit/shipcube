-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Control: a top-level set_config raises, a later one lowers to 2s.

SELECT pg_catalog.set_config('lock_timeout', '10s', false);
ALTER TABLE public.fixture_items ADD COLUMN remark9 text;
SELECT set_config('lock_timeout', '2s', false);
