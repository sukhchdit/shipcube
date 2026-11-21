-- template: guest-capable-guard-function (data-model §4.3 amendment; ADR-0005 am. 10 item 11; D-ARCH-062, D-ARCH-065).
-- Shipped by migration 20261120200000_guest_capable_guard (TASK-051), which holds this rendering verbatim (pinned by
-- prisma/tests/harness/guest-claim-probe.test.ts): changing this file changes no database, so a change needs a new
-- migration that replaces the function, and the pin then moves to that migration. Invariant: org_id transitions only
-- NULL -> value, once; a guest token hash is set only at insert and may only be cleared. Owned by the migrator, not
-- SECURITY DEFINER, fixed search path. A trigger function needs no EXECUTE grant to fire.
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
