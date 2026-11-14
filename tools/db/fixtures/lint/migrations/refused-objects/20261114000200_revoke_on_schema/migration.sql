-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR11-SEC-15 d): REVOKE … ON SCHEMA too.

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
