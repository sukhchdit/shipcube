-- Bootstrap lane, file 01: schema platform, schema-scoped grants, trusted extensions and default privileges
-- (data-model.md §4.2, §4.4 amendments; SEC-P3-27 item 6, SEC-P3-34 item 5, SEC-P3-37 item 1; TASK-003).
--
-- Runner:      tools/db/bootstrap.ts with the cluster-admin credential, after 00-roles.sql. Schema-scoped content is
--              carried by pg_dump, so the restore rehearsal does not run this file before pg_restore (§8.6).
-- Variables:   none.
-- Idempotent:  yes.
-- Immutable:   once applied, a change is a new file.
SET search_path = pg_catalog, pg_temp;

CREATE SCHEMA IF NOT EXISTS platform AUTHORIZATION platform_schema_owner;
ALTER SCHEMA platform OWNER TO platform_schema_owner;
REVOKE ALL ON SCHEMA platform FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA platform TO platform_migrator;        -- RLS helpers and the §4.5 functions
GRANT USAGE ON SCHEMA platform TO platform_app, platform_erasure;
GRANT USAGE, CREATE ON SCHEMA platform TO platform_definer;         -- ALTER FUNCTION ... OWNER TO needs CREATE of the new owner
GRANT USAGE, CREATE ON SCHEMA public, platform TO platform_audit_owner;  -- ensure_audit_partitions creates partitions in public
GRANT USAGE ON SCHEMA public TO platform_definer, platform_erasure;

-- Trusted extensions (SEC-P3-34 item 5): installed here by the bootstrap role, because the migrator no longer owns the
-- database and so cannot run CREATE EXTENSION. Their objects live in public, owned by the bootstrap role.
CREATE EXTENSION IF NOT EXISTS pg_trgm    WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS btree_gin  WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;

-- Default privileges (SEC-P3-37 item 1: after schema platform exists). PostgreSQL adds per-schema default privileges
-- to the global ones and cannot revoke a global default per schema, and functions are EXECUTE-able by PUBLIC by
-- global default. The revocations are therefore global (no IN SCHEMA): every function the migrator, the definer or the
-- audit owner creates, in platform or public, starts without EXECUTE for PUBLIC; grants to platform_app are explicit.
ALTER DEFAULT PRIVILEGES FOR ROLE platform_migrator    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE platform_definer     REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE platform_audit_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
