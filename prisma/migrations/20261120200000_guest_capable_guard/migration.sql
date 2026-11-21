-- migration-kind: expand
-- data-changing: no
-- reversible: yes
--
-- The de-claim guard of the GUEST_CAPABLE class (TASK-051; US-080, REQ-RLS-013; ADR-0005 amendment 10 item 11,
-- data-model §4.3; PR7-SEC-04, PR7-SEC-12 (d), D-ARCH-062, D-ARCH-065). With both app.org_id and app.guest_token_hash
-- set, an UPDATE could move an organisation's row back to a guest (the tenant USING admits it, the guest WITH CHECK
-- admits the new values). The invariant: org_id moves only NULL -> value, once; a guest token hash is set only at insert
-- and may only be cleared. Rendered once by tools/db/render-rls.ts renderGuestCapableGuardFunction() and pasted
-- verbatim; owned by the migrator, not SECURITY DEFINER, fixed search path, no EXECUTE for PUBLIC (a trigger function
-- needs none to fire). No table and no trigger here: every GUEST_CAPABLE table gets tg_<table>__guest_capable_guard
-- from the renderer in the migration that creates it (the quote tables, TASK-087).
CREATE FUNCTION platform.guest_capable_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (OLD.org_id IS NOT NULL AND NEW.org_id IS DISTINCT FROM OLD.org_id)
     OR (NEW.guest_token_hash IS NOT NULL AND NEW.guest_token_hash IS DISTINCT FROM OLD.guest_token_hash) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'GUEST_DECLAIM_FORBIDDEN', TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION platform.guest_capable_guard() FROM PUBLIC;
