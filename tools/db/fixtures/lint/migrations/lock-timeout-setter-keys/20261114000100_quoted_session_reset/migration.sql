-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Control: SET SESSION "lock_timeout" TO … then RESET "lock_timeout".

SET SESSION "lock_timeout" TO '10s';
ALTER TABLE public.fixture_items ADD COLUMN remark9 text;
RESET "lock_timeout";
