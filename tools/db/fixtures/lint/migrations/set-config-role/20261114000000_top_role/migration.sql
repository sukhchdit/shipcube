-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR11-SEC-15 b): set_config('role', …) at top level.

SELECT set_config('role', 'platform_definer', false);
