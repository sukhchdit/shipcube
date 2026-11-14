-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR11-SEC-17 c): a top-level set_config raises the value.

SELECT set_config('lock_timeout', '10s', false);
ALTER TABLE public.fixture_items ADD COLUMN remark9 text;
