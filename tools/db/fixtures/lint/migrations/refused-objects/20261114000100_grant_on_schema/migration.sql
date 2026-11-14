-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR11-SEC-15 d): schema privileges are bootstrap-only.

GRANT USAGE ON SCHEMA public TO platform_app;
