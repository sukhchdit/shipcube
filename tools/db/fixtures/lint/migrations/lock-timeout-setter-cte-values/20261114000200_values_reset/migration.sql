-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Control: the same VALUES form followed by RESET lock_timeout.

VALUES (set_config('lock_timeout', '0', false));
RESET lock_timeout;
