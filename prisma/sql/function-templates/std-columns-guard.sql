-- template: platform.std_columns_guard() (data-model §7.6 amendment of 2026-11-13 "Database guard"; ADR-0009 am. 1;
-- PR26-SEC-03, D-ARCH-091; catalog C15). Shipped by TASK-024; applied verbatim, as platform_migrator, by the first
-- migration that creates a runtime-writable STD table (TASK-037), before the per-table triggers that
-- tools/db/render-rls.ts renders from the manifest flag stdColumns. Plain CREATE FUNCTION, never CREATE OR REPLACE over
-- a foreign owner. ASSERTION ONLY: it never assigns a column. SECURITY INVOKER on purpose (current_user is the writing
-- role); the actor is read through platform.app_actor_id() only (ADR-0005 am. 10 item 1). platform_migrator is exempt
-- (migration lane, reference seed). The message names the column, table and operation, never a value. A trigger
-- function needs no EXECUTE grant to fire; PUBLIC holds none (global default privileges, C11).
CREATE FUNCTION platform.std_columns_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_anonymous constant uuid := '00000000-0000-7000-8000-000000000002';
  v_actor     uuid;
  v_column    text;
BEGIN
  IF current_user = 'platform_migrator' THEN RETURN NEW; END IF;
  v_actor := COALESCE(platform.app_actor_id(), c_anonymous);
  IF TG_OP = 'INSERT' THEN
    v_column := CASE WHEN NEW.created_by IS DISTINCT FROM v_actor THEN 'created_by'
                     WHEN NEW.updated_by IS DISTINCT FROM v_actor THEN 'updated_by'
                     WHEN NEW.version    IS DISTINCT FROM 1       THEN 'version' END;
  ELSE
    v_column := CASE WHEN NEW.id         IS DISTINCT FROM OLD.id           THEN 'id'
                     WHEN NEW.created_at IS DISTINCT FROM OLD.created_at   THEN 'created_at'
                     WHEN NEW.created_by IS DISTINCT FROM OLD.created_by   THEN 'created_by'
                     WHEN NEW.updated_by IS DISTINCT FROM v_actor          THEN 'updated_by'
                     WHEN NEW.version    IS DISTINCT FROM OLD.version + 1  THEN 'version' END;
  END IF;
  IF v_column IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = pg_catalog.format('STD_COLUMNS_VIOLATION: %s on %s.%s (%s)', v_column, TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP);
  END IF;
  RETURN NEW;
END $$;
