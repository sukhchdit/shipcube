-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR24-SEC-11, SEC-TC-73): the RESET inside a rolled-back block is undone.

SET lock_timeout = '10s';
BEGIN;
RESET lock_timeout;
ROLLBACK;
