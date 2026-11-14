-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR #43 R1-m1): set_config in a materialized CTE raises the session value.

WITH s AS MATERIALIZED (SELECT set_config('lock_timeout', '0', false)) SELECT * FROM s;
