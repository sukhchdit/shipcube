-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture: set_config(…, true) is local, like SET LOCAL, and does not count as the first SET.

SELECT set_config('lock_timeout', '10s', true);
ALTER TABLE public.fixture_items ADD COLUMN remark9 text;
