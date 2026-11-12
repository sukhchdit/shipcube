-- migration-kind: expand
-- data-changing: no
-- reversible: yes

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT DELETE ON TABLES TO platform_app;
