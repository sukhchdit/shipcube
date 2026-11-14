-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Control: other settings and a key that only starts with role.

SELECT set_config('statement_timeout', '5s', false), set_config('rolex', 'x', false);
