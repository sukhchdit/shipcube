-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR11-SEC-17 c): quoted name, raised, no RESET.

SET "lock_timeout" = '10s';
ALTER TABLE public.fixture_items ADD COLUMN remark9 text;
