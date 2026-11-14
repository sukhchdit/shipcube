-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Control: ALL TABLES IN SCHEMA is no schema privilege; SELECT is no RLS-independent privilege.

GRANT SELECT ON ALL TABLES IN SCHEMA public TO platform_migrator;
