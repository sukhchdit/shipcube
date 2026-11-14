-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (rule 17, PR11-SEC-07): down.sql DROPs without IF EXISTS.

SELECT 1;
