-- migration-kind: expand
-- data-changing: no
-- reversible: yes
--
-- Operator staff grants and the operator rule of the membership lifecycle guard (PR65-SEC-02 (b), PR65-SEC-04 (a);
-- D-ARCH-165, D-ARCH-166; ADR-0005 amendment 14 items 35 and 36; data-model §3.2). An ACTIVE membership of the OPERATOR
-- organisation is what platform.app_is_operator() reads, and D-ARCH-156 makes every membership insert a self-insert, so
-- a session whose context names the operator organisation could create its own. The guard now refuses a membership of
-- an OPERATOR organisation unless a grant row names the member. platform_app holds SELECT only on the grants: the
-- provisioning lane writes them as platform_migrator. user_id is a logical reference (no foreign key): the lane
-- writes the grant for the id of the user it has just created.

CREATE TABLE "public"."operator_staff_grants" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "user_id" UUID NOT NULL,

    CONSTRAINT "pk_operator_staff_grants" PRIMARY KEY ("id"),
    CONSTRAINT "ck_operator_staff_grants__version" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "ux_operator_staff_grants__user_id" ON "public"."operator_staff_grants"("user_id");

GRANT SELECT ON TABLE "public"."operator_staff_grants" TO platform_app;

-- The function of 20261117000000_organisations_identity, replaced in place: the trigger and its column list are
-- unchanged. New: the operator rule, on INSERT and on an UPDATE that makes the row ACTIVE (fail closed: an
-- organisation the session cannot see counts as OPERATOR; PR051-SEC-03: the insert rule alone let a suspended
-- membership return without a grant), and the INVITED rule on UPDATE (PR65-SEC-04 (a): the insert rule alone left
-- INVITED reachable by UPDATE).
CREATE OR REPLACE FUNCTION platform.memberships_lifecycle_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_rule text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_rule := CASE WHEN NEW.user_id IS DISTINCT FROM platform.app_actor_id() THEN 'the member is not the actor'
                   WHEN NEW.status  IS DISTINCT FROM 'ACTIVE'                 THEN 'a membership is created ACTIVE'
                   WHEN NOT EXISTS (SELECT 1 FROM public.organisations o WHERE o.id = NEW.org_id AND o.type <> 'OPERATOR')
                    AND NOT EXISTS (SELECT 1 FROM public.operator_staff_grants g WHERE g.user_id = NEW.user_id)
                                                                              THEN 'an operator membership needs a staff grant' END;
  ELSE
    v_rule := CASE WHEN NEW.user_id IS DISTINCT FROM OLD.user_id THEN 'user_id cannot change'
                   WHEN NEW.org_id  IS DISTINCT FROM OLD.org_id  THEN 'org_id cannot change'
                   WHEN OLD.status = 'REMOVED' AND NEW.status IS DISTINCT FROM 'REMOVED' THEN 'REMOVED is terminal'
                   WHEN NEW.status = 'INVITED' AND OLD.status IS DISTINCT FROM 'INVITED' THEN 'INVITED is reserved'
                   WHEN NEW.status = 'ACTIVE' AND OLD.status IS DISTINCT FROM 'ACTIVE'
                    AND NOT EXISTS (SELECT 1 FROM public.organisations o WHERE o.id = NEW.org_id AND o.type <> 'OPERATOR')
                    AND NOT EXISTS (SELECT 1 FROM public.operator_staff_grants g WHERE g.user_id = NEW.user_id)
                                                                              THEN 'an operator membership needs a staff grant' END;
  END IF;
  IF v_rule IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = pg_catalog.format('MEMBERSHIP_LIFECYCLE_VIOLATION: %s', v_rule);
  END IF;
  RETURN NULL;
END $$;
