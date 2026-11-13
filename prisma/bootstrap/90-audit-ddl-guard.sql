-- Bootstrap lane, file 90: the identity-based audit DDL guard (data-model.md §5.2 amendments SEC-P3-03, SEC-P3-27 and
-- 2026-11-13 PR12-SEC-02/03/04; ADR-0007 amendment 7; D-SEC-PR12-01, D-ARCH-076; TASK-021).
-- @audit-ddl security-approved: security-analyst 2026-11-13
--
-- Runner:      tools/db/bootstrap.ts with the cluster-admin credential (superuser locally), after 10-audit.sql. Event
--              triggers require superuser, so the function and both triggers are owned by the bootstrap role. No SET
--              ROLE in this file: the guard must NOT be owned by platform_audit_owner (C14).
-- Variables:   none.
-- Idempotent:  no, deliberately (PR12-SEC-03): plain CREATE FUNCTION, never CREATE OR REPLACE, so a pre-existing
--              platform.audit_ddl_guard() (for example one planted by the migrator, which keeps CREATE on platform)
--              fails this file with 42723 instead of keeping its foreign owner and ACL. The ledger applies the file once.
-- Immutable:   once applied, a change is a new file that asserts no platform.audit_ddl_guard exists with an owner
--              other than current_user, then ALTER EVENT TRIGGER ... DISABLE (both), replaces the function and
--              re-enables both triggers ALWAYS, in one transaction ("Changing the guard later", §5.2).
-- Data:        none. Classification under D-SEC-PR8-01 / linter rule 10: not data-changing. Rollback (local/CI only):
--              recreate the database with npm run db:reset --yes; on a shared environment the guard is never removed.
--
-- What it does: on ddl_command_end and sql_drop it raises 42501 for any command that creates, alters or drops an
-- audit object, a protected schema, or an object squatting an audit name, unless current_user is
-- platform_audit_owner (inside ensure_audit_partitions or the bootstrap lane only). It is NOT SECURITY DEFINER, or
-- current_user would always be its owner. It stops accidents and the migrator credential, not a cluster superuser
-- (who can disable event triggers); detection for that actor is the signed anchor chain and the TASK-116 tripwire.
SET search_path = pg_catalog, pg_temp;

CREATE FUNCTION platform.audit_ddl_guard() RETURNS event_trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r       record;
  v_owner oid;
  v_ns    oid[];                                                             -- protected schema OIDs
  v_rel   oid;
  v_hit   boolean;
  c_tbl   constant text   := '^(audit_[a-z0-9_]+|data_subjects)$';          -- audit tables and audit_entries_YYYY_MM partitions
  c_idx   constant text   := '^(ix_audit_|pk_audit_|ux_audit_|pk_data_subjects|ux_data_subjects__|audit_entries_)';
  c_fn    constant text[] := ARRAY['audit_forbid_mutation','audit_vault_guard','ensure_audit_partitions','audit_ddl_guard'];
  c_nsnm  constant text[] := ARRAY['public','platform'];                     -- sql_drop fallback only; never used on ddl_command_end
BEGIN
  IF current_user = 'platform_audit_owner' THEN
    RETURN;                                                                  -- ensure_audit_partitions / bootstrap lane only
  END IF;

  -- Protected schemas BY OID, derived at call time: every schema holding a relation or function owned by
  -- platform_audit_owner. A rename keeps the OID; a restore gets the right OIDs without a regeneration step.
  v_owner := pg_catalog.to_regrole('platform_audit_owner')::oid;
  SELECT pg_catalog.array_agg(s.ns) INTO v_ns
    FROM (SELECT c.relnamespace AS ns FROM pg_catalog.pg_class c WHERE c.relowner = v_owner
          UNION
          SELECT p.pronamespace       FROM pg_catalog.pg_proc  p WHERE p.proowner = v_owner) s;
  IF v_ns IS NULL THEN                                                       -- owner missing or owns nothing: fail closed
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'audit DDL guard cannot resolve the protected schemas (SEC-P3-27)';
  END IF;

  IF TG_EVENT = 'ddl_command_end' THEN
    FOR r IN SELECT * FROM pg_catalog.pg_event_trigger_ddl_commands() LOOP
      CONTINUE WHEN r.objid IS NULL OR r.objid = 0;                          -- e.g. GRANT rows, no-op CREATE ... IF NOT EXISTS
      v_hit := false;
      -- PR12-SEC-02 item 1: the object's OWN name, before the relation branch, so that no relation or type can squat
      -- a partition name (audit_entries_YYYY_MM) or an audit table name in a protected schema.
      IF r.object_type IN ('index','sequence','view','materialized view','composite type','foreign table') THEN
        SELECT c.relnamespace = ANY (v_ns) AND c.relname ~ c_tbl
          INTO v_hit FROM pg_catalog.pg_class c WHERE c.oid = r.objid;
      END IF;
      IF NOT COALESCE(v_hit, false) AND r.object_type IN ('type','domain') THEN
        SELECT t.typnamespace = ANY (v_ns) AND t.typname ~ c_tbl
          INTO v_hit FROM pg_catalog.pg_type t WHERE t.oid = r.objid;
      END IF;
      IF NOT COALESCE(v_hit, false) THEN
        IF r.object_type = 'schema' THEN
          -- ALTER SCHEMA ... RENAME / OWNER TO on a protected schema raises unless the schema ends the command in its
          -- bootstrap state (name public/platform, owner platform_schema_owner). That admits only the no-op re-assertion
          -- "ALTER SCHEMA public OWNER TO platform_schema_owner" of 00-roles.sql, which tools/db/bootstrap.ts
          -- reapplyDatabaseLevel re-runs on template clones; only the schema owner or a superuser can issue it.
          SELECT r.objid = ANY (v_ns)
                 AND NOT COALESCE(n.nspname = ANY (c_nsnm)
                                  AND n.nspowner = pg_catalog.to_regrole('platform_schema_owner')::oid, false)
            INTO v_hit FROM pg_catalog.pg_namespace n WHERE n.oid = r.objid;
        ELSIF r.object_type = 'function' THEN
          SELECT p.proowner = v_owner OR (p.pronamespace = ANY (v_ns) AND p.proname = ANY (c_fn))
            INTO v_hit FROM pg_catalog.pg_proc p WHERE p.oid = r.objid;      -- also stops overloads planted under an audit name
        ELSIF r.object_type IN ('table','table column','index','trigger','policy','table constraint','rule') THEN
          v_rel := CASE r.object_type
                     WHEN 'index'            THEN (SELECT i.indrelid FROM pg_catalog.pg_index      i WHERE i.indexrelid = r.objid)
                     WHEN 'trigger'          THEN (SELECT t.tgrelid  FROM pg_catalog.pg_trigger    t WHERE t.oid = r.objid)
                     WHEN 'policy'           THEN (SELECT p.polrelid FROM pg_catalog.pg_policy     p WHERE p.oid = r.objid)
                     WHEN 'table constraint' THEN (SELECT k.conrelid FROM pg_catalog.pg_constraint k WHERE k.oid = r.objid)
                     WHEN 'rule'             THEN (SELECT w.ev_class FROM pg_catalog.pg_rewrite    w WHERE w.oid = r.objid)
                     ELSE r.objid                                            -- 'table', 'table column'
                   END;
          -- PR12-SEC-02-a (TASK-021 port finding): ALTER TABLE ... ADD CONSTRAINT ... UNIQUE | PRIMARY KEY | EXCLUDE,
          -- ... USING INDEX and RENAME CONSTRAINT create or rename an index that ddl_command_end reports only as the
          -- 'table' / 'table constraint', so the own-name match above never sees it: also match the names of the
          -- relation's indexes. Prisma never emits audit names (SPK-08 F-08).
          SELECT c.relowner = v_owner OR (c.relnamespace = ANY (v_ns) AND c.relname ~ c_tbl)
                 OR EXISTS (SELECT FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
                             WHERE i.indrelid = v_rel AND ic.relnamespace = ANY (v_ns) AND ic.relname ~ c_tbl)
            INTO v_hit FROM pg_catalog.pg_class c WHERE c.oid = v_rel;
        END IF;
      END IF;
      IF COALESCE(v_hit, false) THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
          MESSAGE = 'audit objects are immutable (SEC-P3-03)',
          DETAIL  = pg_catalog.format('%s on %s %s by %s', r.command_tag, r.object_type, r.object_identity, current_user);
      END IF;
    END LOOP;

  ELSIF TG_EVENT = 'sql_drop' THEN
    -- Dropped objects are already gone from the catalogue: schemas match by OID first, and by name only as the fallback
    -- for a schema dropped together with every audit object it held (names are stable: renames are refused above).
    FOR r IN SELECT * FROM pg_catalog.pg_event_trigger_dropped_objects() LOOP
      IF r.object_type = 'schema' THEN
        v_hit := r.objid = ANY (v_ns) OR r.object_name = ANY (c_nsnm);
      ELSE
        v_hit := (COALESCE(pg_catalog.to_regnamespace(pg_catalog.quote_ident(r.address_names[1]))::oid = ANY (v_ns), false)
                  OR r.address_names[1] = ANY (c_nsnm))
             AND CASE
                   WHEN r.object_type IN ('table','table column','trigger','policy','table constraint','rule')
                                                   THEN r.address_names[2] ~ c_tbl
                   WHEN r.object_type = 'index'    THEN r.address_names[2] ~ c_idx
                   WHEN r.object_type = 'function' THEN r.address_names[2] = ANY (c_fn)
                   ELSE false
                 END;
      END IF;
      IF COALESCE(v_hit, false) THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
          MESSAGE = 'audit objects are immutable (SEC-P3-03)',
          DETAIL  = pg_catalog.format('DROP of %s %s by %s', r.object_type, r.object_identity, current_user);
      END IF;
    END LOOP;
  END IF;
END $$;
REVOKE ALL ON FUNCTION platform.audit_ddl_guard() FROM PUBLIC;

CREATE EVENT TRIGGER platform_audit_ddl_guard_end  ON ddl_command_end EXECUTE FUNCTION platform.audit_ddl_guard();
CREATE EVENT TRIGGER platform_audit_ddl_guard_drop ON sql_drop        EXECUTE FUNCTION platform.audit_ddl_guard();
-- PR12-SEC-04 item 3 / D-ARCH-076: fire also under session_replication_role = replica (evtenabled = 'A').
ALTER EVENT TRIGGER platform_audit_ddl_guard_end  ENABLE ALWAYS;
ALTER EVENT TRIGGER platform_audit_ddl_guard_drop ENABLE ALWAYS;
