-- SPK-08 (TASK-012) THROWAWAY PROTOTYPE of prisma/bootstrap/90-audit-ddl-guard.sql. Test-only: applied by
-- prisma/tests/spikes/spk08-audit-owner.int.test.ts, NEVER part of prisma/bootstrap/** or prisma/migrations/**.
-- Source: data-model.md §5.2 amendments (SEC-P3-03, SEC-P3-27), verbatim. Run by the bootstrap superuser after
-- 10-audit.sql, with the pinned search path, in one transaction.
-- @audit-ddl security-approved: spike-only (SPK-08) 2026-11-12
SET search_path = pg_catalog, pg_temp;
CREATE OR REPLACE FUNCTION platform.audit_ddl_guard() RETURNS event_trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r       record;
  v_owner oid;
  v_ns    oid[];
  v_rel   oid;
  v_hit   boolean;
  c_tbl   constant text   := '^(audit_[a-z0-9_]+|data_subjects)$';
  c_idx   constant text   := '^(ix_audit__|pk_audit_|ux_audit_|ux_data_subjects__|audit_entries_)';
  c_fn    constant text[] := ARRAY['audit_forbid_mutation','audit_vault_guard','ensure_audit_partitions','audit_ddl_guard'];
  c_nsnm  constant text[] := ARRAY['public','platform'];
BEGIN
  IF current_user = 'platform_audit_owner' THEN
    RETURN;
  END IF;

  v_owner := pg_catalog.to_regrole('platform_audit_owner')::oid;
  SELECT pg_catalog.array_agg(s.ns) INTO v_ns
    FROM (SELECT c.relnamespace AS ns FROM pg_catalog.pg_class c WHERE c.relowner = v_owner
          UNION
          SELECT p.pronamespace       FROM pg_catalog.pg_proc  p WHERE p.proowner = v_owner) s;
  IF v_ns IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'audit DDL guard cannot resolve the protected schemas (SEC-P3-27)';
  END IF;

  IF TG_EVENT = 'ddl_command_end' THEN
    FOR r IN SELECT * FROM pg_catalog.pg_event_trigger_ddl_commands() LOOP
      CONTINUE WHEN r.objid IS NULL OR r.objid = 0;
      v_hit := false;
      IF r.object_type = 'schema' THEN
        v_hit := r.objid = ANY (v_ns);
      ELSIF r.object_type = 'function' THEN
        SELECT p.proowner = v_owner OR (p.pronamespace = ANY (v_ns) AND p.proname = ANY (c_fn))
          INTO v_hit FROM pg_catalog.pg_proc p WHERE p.oid = r.objid;
      ELSIF r.object_type IN ('table','table column','index','trigger','policy','table constraint','rule') THEN
        v_rel := CASE r.object_type
                   WHEN 'index'            THEN (SELECT i.indrelid FROM pg_catalog.pg_index      i WHERE i.indexrelid = r.objid)
                   WHEN 'trigger'          THEN (SELECT t.tgrelid  FROM pg_catalog.pg_trigger    t WHERE t.oid = r.objid)
                   WHEN 'policy'           THEN (SELECT p.polrelid FROM pg_catalog.pg_policy     p WHERE p.oid = r.objid)
                   WHEN 'table constraint' THEN (SELECT k.conrelid FROM pg_catalog.pg_constraint k WHERE k.oid = r.objid)
                   WHEN 'rule'             THEN (SELECT w.ev_class FROM pg_catalog.pg_rewrite    w WHERE w.oid = r.objid)
                   ELSE r.objid
                 END;
        SELECT c.relowner = v_owner OR (c.relnamespace = ANY (v_ns) AND c.relname ~ c_tbl)
          INTO v_hit FROM pg_catalog.pg_class c WHERE c.oid = v_rel;
      END IF;
      IF COALESCE(v_hit, false) THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
          MESSAGE = 'audit objects are immutable (SEC-P3-03)',
          DETAIL  = pg_catalog.format('%s on %s %s by %s', r.command_tag, r.object_type, r.object_identity, current_user);
      END IF;
    END LOOP;

  ELSIF TG_EVENT = 'sql_drop' THEN
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

DROP EVENT TRIGGER IF EXISTS platform_audit_ddl_guard;
CREATE EVENT TRIGGER platform_audit_ddl_guard_end  ON ddl_command_end EXECUTE FUNCTION platform.audit_ddl_guard();
CREATE EVENT TRIGGER platform_audit_ddl_guard_drop ON sql_drop        EXECUTE FUNCTION platform.audit_ddl_guard();
