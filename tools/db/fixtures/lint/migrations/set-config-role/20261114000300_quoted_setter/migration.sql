-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR11-SEC-15 b): quoted setter name (the quoted key also fails rule 16).

SELECT "set_config"('"role"', 'platform_definer', true);
