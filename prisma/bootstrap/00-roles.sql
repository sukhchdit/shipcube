-- Bootstrap lane, file 00: cluster roles and database-level grants (data-model.md §4.4 and its amendments,
-- ADR-0005 am. 7-8, ADR-0007 am. 7-8, D-ARCH-033; SEC-P3-34 item 1 and item 5; TASK-003).
--
-- Runner:      tools/db/bootstrap.ts with the cluster-admin credential (Compose bootstrap service locally, a pipeline job
--              with the break-glass RDS master at M5). Never run by platform_migrator.
-- Variables:   :'migrator_password', :'app_password' (from the secret manager / Compose secret files) and :"db_name"
--              (set by the runner to current_database(), never by the caller). The file holds placeholders, never values.
-- Idempotent:  roles are created when missing and their attributes are then (re)asserted; every other statement is
--              idempotent. The restore rehearsal (data-model §8.6) runs only this file before pg_restore, because
--              pg_dump carries none of these cluster- and database-level statements.
-- Immutable:   once applied, a change is a new file (the runner fails on a changed SHA-256).
SET search_path = pg_catalog, pg_temp;

-- Roles. CREATE ROLE has no IF NOT EXISTS; the DO block creates a missing role with no attributes, the ALTER ROLE
-- statements below set every attribute so a pre-existing role is brought to the same state.
DO $roles$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['platform_migrator', 'platform_app', 'platform_erasure', 'platform_schema_owner',
                           'platform_definer', 'platform_audit_owner'] LOOP
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = r) THEN
      EXECUTE pg_catalog.format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END
$roles$;

ALTER ROLE platform_migrator     LOGIN   NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT
                                 PASSWORD :'migrator_password';
ALTER ROLE platform_app          LOGIN   NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
                                 CONNECTION LIMIT 200 PASSWORD :'app_password';
ALTER ROLE platform_erasure      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;   -- unused until M4/M5
ALTER ROLE platform_schema_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;  -- no members
ALTER ROLE platform_definer      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
ALTER ROLE platform_audit_owner  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;  -- no members

-- The migrator may assign function ownership to platform_definer but inherits none of its policies (PostgreSQL 16+).
-- platform_audit_owner and platform_schema_owner are granted to nobody (catalog test C13).
GRANT platform_definer TO platform_migrator WITH INHERIT FALSE, SET TRUE;

-- Schema public: owned by the no-member schema owner BEFORE any database-level change (SEC-P3-27 item 6).
ALTER SCHEMA public OWNER TO platform_schema_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO platform_app;
GRANT USAGE, CREATE ON SCHEMA public TO platform_migrator;   -- tables, _prisma_migrations

-- Database: SEC-P3-34 item 5 (recommended) is adopted. The database stays owned by the bootstrap role, so the
-- migrator cannot ALTER DATABASE ... SET a search path for every session, nor CREATE SCHEMA. The trusted extensions
-- that needed database ownership are installed by 01-schemas.sql as the bootstrap role instead.
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO platform_app, platform_migrator;

-- Role settings (role-wide).
ALTER ROLE platform_app SET search_path = pg_catalog, public;   -- runtime role, not a definer context; no TEMPORARY
ALTER ROLE platform_app SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE platform_app SET lock_timeout = '2s';
ALTER ROLE platform_migrator SET lock_timeout = '3s';

-- SEC-P3-34 item 1: privileged sessions of the bootstrap role in this database resolve names in pg_catalog only.
-- A role-in-database setting outranks any database-wide default (which the migrator can no longer set anyway).
ALTER ROLE CURRENT_USER IN DATABASE :"db_name" SET search_path = pg_catalog, pg_temp;
