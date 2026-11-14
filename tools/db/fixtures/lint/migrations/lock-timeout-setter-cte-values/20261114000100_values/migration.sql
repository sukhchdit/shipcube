-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR #43 R1-m1): set_config in VALUES.

VALUES (set_config('lock_timeout', '0', false));
