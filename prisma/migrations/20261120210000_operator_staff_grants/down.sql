-- Reverts 20261120210000_operator_staff_grants (data-model.md §8.4): restores the lifecycle guard of
-- 20261117000000_organisations_identity, body byte-identical, then drops the grants. The function comes first because
-- it must stop reading the table before the table goes. Prefix-idempotent (rule 17).
CREATE OR REPLACE FUNCTION platform.memberships_lifecycle_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_rule text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_rule := CASE WHEN NEW.user_id IS DISTINCT FROM platform.app_actor_id() THEN 'the member is not the actor'
                   WHEN NEW.status  IS DISTINCT FROM 'ACTIVE'                 THEN 'a membership is created ACTIVE' END;
  ELSE
    v_rule := CASE WHEN NEW.user_id IS DISTINCT FROM OLD.user_id THEN 'user_id cannot change'
                   WHEN NEW.org_id  IS DISTINCT FROM OLD.org_id  THEN 'org_id cannot change'
                   WHEN OLD.status = 'REMOVED' AND NEW.status IS DISTINCT FROM 'REMOVED' THEN 'REMOVED is terminal' END;
  END IF;
  IF v_rule IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = pg_catalog.format('MEMBERSHIP_LIFECYCLE_VIOLATION: %s', v_rule);
  END IF;
  RETURN NULL;
END $$;

DROP TABLE IF EXISTS "public"."operator_staff_grants";
