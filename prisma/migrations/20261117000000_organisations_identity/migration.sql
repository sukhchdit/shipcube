-- migration-kind: expand
-- data-changing: no
-- reversible: yes
--
-- Organisations and the minimal users table (TASK-037; US-061, US-062; REQ-ORG-001..004, REQ-AUTH-001, DR-A04..A06,
-- DR-A14; data-model §3.1, §3.2, §4.3, §7.6, §8.3; ADR-0005, ADR-0009 am. 1; D-ARCH-071/072/091/123). The first
-- tenant tables. Order follows the prefix-safety principle (§8.3): CREATE TABLE -> reserved rows (before FORCE; the
-- migrator is subject to RLS afterwards) -> platform.std_columns_guard() (template, verbatim) ->
-- platform.app_is_operator() (template, verbatim: its SQL body is validated against memberships and organisations,
-- and every operator policy below names it) -> domain triggers -> the RLS blocks rendered by tools/db/render-rls.ts
-- from the module manifests (identity.json, organisations.json), pasted verbatim (ENABLE + FORCE -> policies ->
-- definer GRANT -> std-columns trigger) -> runtime GRANTs (rule 9 b: after ENABLE + FORCE).
--
-- users is created here, not by TASK-049 (D-TASK037-01): memberships.user_id and organisations.personal_owner_user_id
-- reference it, the DR-A14 users set ships with whichever task creates the table, and the reserved actors of §1.6
-- need it. Columns that reference tables of later tasks (users.display_currency -> currencies, organisations
-- country/region/currency columns) arrive with those tasks as nullable expand columns.
--
-- No BEGIN ATOMIC routine and no prisma/bootstrap file is added (TASK-290 / PR43-SEC-11, PR52-SEC-01 prerequisite).
-- No membership is written with status INVITED (D-ARCH-123): the value stays a reserved CHECK member only.

-- ---------------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------------

CREATE TABLE "public"."users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,
    "email" TEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ(6),
    "display_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "status_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status_reason" TEXT,
    "first_signed_in_at" TIMESTAMPTZ(6),
    "locale" TEXT NOT NULL DEFAULT 'en',
    "time_zone" TEXT,
    "unit_system" TEXT,
    "theme" TEXT,
    "admin_sidebar_collapsed" BOOLEAN NOT NULL DEFAULT false,
    "table_density" TEXT NOT NULL DEFAULT 'COMFORTABLE',
    "personal_org_id" UUID,
    "last_active_org_id" UUID,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "deletion_requested_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_users" PRIMARY KEY ("id"),
    CONSTRAINT "ck_users__version" CHECK ("version" >= 1),
    CONSTRAINT "ck_users__email_normalised" CHECK ("email" = lower("email") AND char_length("email") BETWEEN 3 AND 254),
    CONSTRAINT "ck_users__display_name" CHECK (char_length("display_name") BETWEEN 1 AND 100),
    CONSTRAINT "ck_users__status" CHECK ("status" IN ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
    CONSTRAINT "ck_users__status_reason_value" CHECK ("status_reason" IN ('MFA_ENROLMENT_OVERDUE', 'ADMIN_ACTION', 'VERIFICATION_EXPIRED', 'USER_REQUEST')),
    CONSTRAINT "ck_users__status_reason" CHECK ("status_reason" IS NULL OR "status" IN ('SUSPENDED', 'DEACTIVATED')),
    CONSTRAINT "ck_users__locale" CHECK ("locale" IN ('en', 'es', 'fr')),
    CONSTRAINT "ck_users__unit_system" CHECK ("unit_system" IN ('METRIC', 'IMPERIAL')),
    CONSTRAINT "ck_users__theme" CHECK ("theme" IN ('LIGHT', 'DARK', 'SYSTEM')),
    CONSTRAINT "ck_users__table_density" CHECK ("table_density" IN ('COMFORTABLE', 'COMPACT')),
    -- PR26-SEC-04: exactly the two reserved actors of §1.6 are system users, and no other row may claim the flag.
    CONSTRAINT "ck_users__is_system" CHECK ("is_system" = ("id" IN ('00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000002')))
);

CREATE TABLE "public"."organisations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,
    "type" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "legal_name" TEXT,
    "contact_email" TEXT,
    "contact_phone_e164" TEXT,
    "default_locale" TEXT NOT NULL DEFAULT 'en',
    "personal_owner_user_id" UUID,

    CONSTRAINT "pk_organisations" PRIMARY KEY ("id"),
    CONSTRAINT "ck_organisations__version" CHECK ("version" >= 1),
    CONSTRAINT "ck_organisations__type" CHECK ("type" IN ('OPERATOR', 'BUSINESS_CUSTOMER', 'PARTNER', 'INDIVIDUAL')),
    CONSTRAINT "ck_organisations__display_name" CHECK (char_length("display_name") BETWEEN 1 AND 120),
    CONSTRAINT "ck_organisations__legal_name" CHECK (char_length("legal_name") <= 200),
    CONSTRAINT "ck_organisations__contact_email" CHECK ("contact_email" = lower("contact_email") AND char_length("contact_email") BETWEEN 3 AND 254),
    CONSTRAINT "ck_organisations__contact_phone_e164" CHECK ("contact_phone_e164" ~ '^\+[1-9][0-9]{6,14}$'),
    CONSTRAINT "ck_organisations__default_locale" CHECK ("default_locale" IN ('en', 'es', 'fr')),
    CONSTRAINT "ck_organisations__personal_owner" CHECK (("type" = 'INDIVIDUAL') = ("personal_owner_user_id" IS NOT NULL)),
    CONSTRAINT "fk_organisations__personal_owner_user_id" FOREIGN KEY ("personal_owner_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "public"."memberships" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "invitation_id" UUID,
    "activated_at" TIMESTAMPTZ(6),
    "suspended_at" TIMESTAMPTZ(6),
    "removed_at" TIMESTAMPTZ(6),
    "removed_by" UUID,

    CONSTRAINT "pk_memberships" PRIMARY KEY ("id"),
    CONSTRAINT "ck_memberships__version" CHECK ("version" >= 1),
    -- INVITED is a reserved value (D-ARCH-123, data-model §1.7): no M0/M1 code writes it.
    CONSTRAINT "ck_memberships__status" CHECK ("status" IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED')),
    CONSTRAINT "fk_memberships__org_id" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "fk_memberships__user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "public"."membership_roles" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "org_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "granted_by" UUID NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" UUID,

    CONSTRAINT "pk_membership_roles" PRIMARY KEY ("id"),
    CONSTRAINT "ck_membership_roles__version" CHECK ("version" >= 1),
    CONSTRAINT "fk_membership_roles__org_id" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "fk_membership_roles__membership_id" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "fk_membership_roles__role_id" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "public"."invitations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "org_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "status" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "send_count" SMALLINT NOT NULL DEFAULT 1,
    "last_sent_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "accepted_by_user_id" UUID,
    "revoked_by" UUID,

    CONSTRAINT "pk_invitations" PRIMARY KEY ("id"),
    CONSTRAINT "ck_invitations__version" CHECK ("version" >= 1),
    CONSTRAINT "ck_invitations__email" CHECK ("email" = lower("email") AND char_length("email") BETWEEN 3 AND 254),
    CONSTRAINT "ck_invitations__locale" CHECK ("locale" IN ('en', 'es', 'fr')),
    CONSTRAINT "ck_invitations__token_hash" CHECK (octet_length("token_hash") = 32),
    CONSTRAINT "ck_invitations__status" CHECK ("status" IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
    CONSTRAINT "ck_invitations__send_count" CHECK ("send_count" BETWEEN 1 AND 4),
    CONSTRAINT "fk_invitations__org_id" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "fk_invitations__role_id" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- Inserted in the same transaction as the user and its personal organisation (REQ-ORG-002): checked at COMMIT.
ALTER TABLE "public"."users" ADD CONSTRAINT "fk_users__personal_org_id" FOREIGN KEY ("personal_org_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "public"."users" ADD CONSTRAINT "fk_users__last_active_org_id" FOREIGN KEY ("last_active_org_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "public"."memberships" ADD CONSTRAINT "fk_memberships__invitation_id" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------------------------------------------------
-- Indexes (access patterns AP-ID-01, AP-ORG-02/03/06..13; every tenant index leads with org_id, REQ-RLS-001)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE UNIQUE INDEX "ux_users__email" ON "public"."users"("email") WHERE "deleted_at" IS NULL;
-- DR-A06: exactly one OPERATOR organisation, enforced by the database (REQ-ORG-001).
CREATE UNIQUE INDEX "ux_organisations__single_operator" ON "public"."organisations"("type") WHERE "type" = 'OPERATOR';
CREATE UNIQUE INDEX "ux_organisations__personal_owner" ON "public"."organisations"("personal_owner_user_id") WHERE "personal_owner_user_id" IS NOT NULL AND "deleted_at" IS NULL;
-- REQ-ORG-003: one non-removed membership per (organisation, user); a REMOVED row stays as history.
CREATE UNIQUE INDEX "ux_memberships__org_user_live" ON "public"."memberships"("org_id", "user_id") WHERE "status" <> 'REMOVED';
CREATE INDEX "ix_memberships__org_status_created" ON "public"."memberships"("org_id", "status", "created_at", "id");
CREATE INDEX "ix_memberships__user_status" ON "public"."memberships"("user_id", "status") INCLUDE ("org_id");
CREATE UNIQUE INDEX "ux_membership_roles__membership_role_live" ON "public"."membership_roles"("membership_id", "role_id") WHERE "revoked_at" IS NULL;
CREATE INDEX "ix_membership_roles__org_role_live" ON "public"."membership_roles"("org_id", "role_id") WHERE "revoked_at" IS NULL;
CREATE UNIQUE INDEX "ux_invitations__org_email_pending" ON "public"."invitations"("org_id", "email") WHERE "status" = 'PENDING';
CREATE INDEX "ix_invitations__org_status_created" ON "public"."invitations"("org_id", "status", "created_at" DESC, "id" DESC);
CREATE UNIQUE INDEX "ux_invitations__token_hash" ON "public"."invitations"("token_hash");

-- ---------------------------------------------------------------------------------------------------------------------
-- Reserved actors (data-model §1.6; PR26-SEC-04; D-TASK037-03): the SYSTEM and ANONYMOUS users, no credentials.
-- Written here, before ENABLE + FORCE, because the reference seed runs as platform_migrator and FORCE leaves the
-- migrator no policy on users afterwards. Idempotent on the primary key.
-- ---------------------------------------------------------------------------------------------------------------------

INSERT INTO "public"."users" ("id", "created_by", "updated_by", "email", "display_name", "status", "is_system")
VALUES ('00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000001',
        'system@reserved.invalid', 'System', 'ACTIVE', true),
       ('00000000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000001',
        'anonymous@reserved.invalid', 'Anonymous', 'ACTIVE', true)
ON CONFLICT ("id") DO NOTHING;

-- Reserved operator organisation (data-model §1.6, §3.2; DR-A06; ADR-0005 amendment 12; D-ARCH-151). The one OPERATOR
-- organisation exists from this migration in every environment, so ux_organisations__single_operator is occupied and no
-- runtime role can create another. Written before ENABLE + FORCE for the same reason as the reserved users.
INSERT INTO "public"."organisations" ("id", "created_by", "updated_by", "type", "display_name")
VALUES ('00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000001',
        '00000000-0000-7000-8000-000000000001', 'OPERATOR', 'Operator')
ON CONFLICT ("id") DO NOTHING;

-- ---------------------------------------------------------------------------------------------------------------------
-- platform.std_columns_guard() (prisma/sql/function-templates/std-columns-guard.sql, verbatim; PR26-SEC-03,
-- D-ARCH-091): this is the first migration that creates a runtime-writable standard-column table.
-- ---------------------------------------------------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------------------------------------------------
-- platform.app_is_operator() (prisma/sql/function-templates/app-is-operator.sql, verbatim; D-TASK016-01 decision 3,
-- D-ARCH-071): its body reads memberships and organisations (created above), and the operator policy of every RLS
-- block below calls it, so it is created after the tables and before the blocks.
-- ---------------------------------------------------------------------------------------------------------------------

-- template: platform.app_is_operator() (data-model §4.2; ADR-0005 amendments 2 and 6, am. 10 item 9; SEC-P3-25,
-- SEC-P3-27; lead decision 5 of TASK-016).
--
-- NOT shipped by TASK-016: the body reads public.memberships and public.organisations, which TASK-037 creates, and a
-- SQL body is validated at CREATE time (check_function_bodies is never turned off). TASK-037 copies this block into
-- the migration that creates those two tables, after their RLS blocks and their definer-read policies (the function
-- reads through p_memberships__definer_read / p_organisations__definer_read).
--
-- Order matters (F-10): the migrator holds platform_definer WITH INHERIT FALSE, SET TRUE, so the function is created
-- and granted INSIDE the SET ROLE block (preferred form; linter rule 15). platform.app_actor_id() is owned by the
-- migrator, so its EXECUTE grant to the definer is issued before SET ROLE: the function runs as platform_definer and
-- PUBLIC holds no EXECUTE on the helpers (01-schemas.sql default privileges).
GRANT EXECUTE ON FUNCTION platform.app_actor_id() TO platform_definer;

SET ROLE platform_definer;
CREATE FUNCTION platform.app_is_operator() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
  SELECT pg_catalog.current_setting('app.actor_scope', true) = 'OPERATOR'
     AND EXISTS (SELECT 1
                   FROM public.memberships m
                   JOIN public.organisations o ON o.id = m.org_id
                  WHERE o.type = 'OPERATOR'
                    AND m.user_id = platform.app_actor_id()
                    AND m.status = 'ACTIVE')
$$;
REVOKE EXECUTE ON FUNCTION platform.app_is_operator() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.app_is_operator() TO platform_app;
RESET ROLE;

-- ---------------------------------------------------------------------------------------------------------------------
-- Domain triggers (REQ-ORG-001/002/004; data-model §3.2). SECURITY INVOKER, fixed search_path, no context read. The
-- BEFORE ROW triggers sort before trg_<table>__std_columns ("p", "r" and "sc" < "st"), so no trigger runs after the
-- standard-columns guard (C15 (b), PR43-SEC-05 c); the type check is an AFTER trigger and only raises.
-- ---------------------------------------------------------------------------------------------------------------------

-- REQ-ORG-001: an organisation's type never changes (raises ORG_TYPE_IMMUTABLE, SQLSTATE P0001).
CREATE FUNCTION platform.organisations_type_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.type IS DISTINCT FROM OLD.type THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ORG_TYPE_IMMUTABLE: organisations.type cannot change';
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_organisations__type_immutable AFTER UPDATE OF type ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION platform.organisations_type_immutable();

-- REQ-ORG-002 / DR-A06: a personal organisation keeps its owner for life (raises PERSONAL_OWNER_IMMUTABLE). Together
-- with the immutable type this keeps ck_organisations__personal_owner stable and closes the "re-point the owner, then
-- delete" path (code review R1-m3).
CREATE FUNCTION platform.organisations_personal_owner_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.personal_owner_user_id IS DISTINCT FROM OLD.personal_owner_user_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PERSONAL_OWNER_IMMUTABLE: organisations.personal_owner_user_id cannot change';
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_organisations__personal_owner_immutable AFTER UPDATE OF personal_owner_user_id ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION platform.organisations_personal_owner_immutable();

-- AT-US-062-04: a personal organisation is not soft-deleted while its owner is an active user (raises
-- PERSONAL_ORG_OWNER_ACTIVE). Hard delete is never granted at runtime (no DELETE privilege for platform_app). The
-- owner is read from OLD (the stored row), so the guard does not depend on the owner being immutable (R1-m3).
CREATE FUNCTION platform.organisations_personal_delete_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  -- Fail closed: unless the owner row is visible AND deleted or deactivated, the owner counts as active.
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND OLD.personal_owner_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.users u
                      WHERE u.id = OLD.personal_owner_user_id AND (u.deleted_at IS NOT NULL OR u.status = 'DEACTIVATED')) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PERSONAL_ORG_OWNER_ACTIVE: a personal organisation of an active user cannot be deleted';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_organisations__personal_delete_guard BEFORE UPDATE OF deleted_at ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION platform.organisations_personal_delete_guard();

-- REQ-ORG-004 database backstop: a role's scope matches its organisation's type (OPERATOR -> OPERATOR,
-- BUSINESS_CUSTOMER | INDIVIDUAL -> CUSTOMER, PARTNER -> PARTNER); raises ROLE_NOT_ALLOWED_FOR_ORG_TYPE. Shared by
-- membership_roles and invitations (the invited role). The expected scope is computed into a variable first: a bare
-- CASE … END inside an IF condition ends the condition at the CASE's first THEN (42601; code review R1-B1).
CREATE FUNCTION platform.role_scope_matches_org() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_type     text;
  v_scope    text;
  v_expected text;
BEGIN
  SELECT o.type INTO v_type FROM public.organisations o WHERE o.id = NEW.org_id;
  SELECT r.scope INTO v_scope FROM public.roles r WHERE r.id = NEW.role_id;
  v_expected := CASE v_type WHEN 'OPERATOR' THEN 'OPERATOR' WHEN 'PARTNER' THEN 'PARTNER' ELSE 'CUSTOMER' END;
  IF v_type IS NULL OR v_scope IS NULL OR v_scope IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ROLE_NOT_ALLOWED_FOR_ORG_TYPE: role scope does not match the organisation type';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_membership_roles__scope_matches_org BEFORE INSERT OR UPDATE OF role_id, org_id ON public.membership_roles
  FOR EACH ROW EXECUTE FUNCTION platform.role_scope_matches_org();
CREATE TRIGGER trg_invitations__role_scope BEFORE INSERT OR UPDATE OF role_id, org_id ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION platform.role_scope_matches_org();

-- ---------------------------------------------------------------------------------------------------------------------
-- Row-level security, rendered by tools/db/render-rls.ts (identity, organisations), pasted verbatim. memberships
-- precedes users (p_users__org_member_read reads it) and organisations (p_organisations__member_read reads it).
-- ---------------------------------------------------------------------------------------------------------------------

-- RLS for public.invitations (TENANT; definerRead), module organisations: rendered by tools/db/render-rls.ts from prisma/sql/policy-templates; do not edit.
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations FORCE ROW LEVEL SECURITY;

CREATE POLICY p_invitations__tenant ON public.invitations
  FOR ALL TO platform_app
  USING      (org_id = platform.app_org_id())
  WITH CHECK (org_id = platform.app_org_id());

CREATE POLICY p_invitations__operator ON public.invitations
  FOR SELECT TO platform_app
  USING (current_setting('app.actor_scope', true) = 'OPERATOR' AND platform.app_is_operator());

CREATE POLICY p_invitations__definer_read ON public.invitations
  FOR SELECT TO platform_definer
  USING (true);
GRANT SELECT ON public.invitations TO platform_definer;

-- Standard-columns guard for public.invitations, module organisations: rendered by tools/db/render-rls.ts from prisma/sql/policy-templates; do not edit.
CREATE TRIGGER trg_invitations__std_columns BEFORE INSERT OR UPDATE ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION platform.std_columns_guard();

-- RLS for public.membership_roles (TENANT), module organisations: rendered by tools/db/render-rls.ts from prisma/sql/policy-templates; do not edit.
ALTER TABLE public.membership_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_roles FORCE ROW LEVEL SECURITY;

CREATE POLICY p_membership_roles__tenant ON public.membership_roles
  FOR ALL TO platform_app
  USING      (org_id = platform.app_org_id())
  WITH CHECK (org_id = platform.app_org_id());

CREATE POLICY p_membership_roles__operator ON public.membership_roles
  FOR SELECT TO platform_app
  USING (current_setting('app.actor_scope', true) = 'OPERATOR' AND platform.app_is_operator());

-- Standard-columns guard for public.membership_roles, module organisations: rendered by tools/db/render-rls.ts from prisma/sql/policy-templates; do not edit.
CREATE TRIGGER trg_membership_roles__std_columns BEFORE INSERT OR UPDATE ON public.membership_roles
  FOR EACH ROW EXECUTE FUNCTION platform.std_columns_guard();

-- RLS for public.memberships (TENANT; policySet dr-a14-memberships, definerRead), module organisations: rendered by tools/db/render-rls.ts from prisma/sql/policy-templates; do not edit.
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships FORCE ROW LEVEL SECURITY;

CREATE POLICY p_memberships__tenant ON public.memberships
  FOR ALL TO platform_app
  USING      (org_id = platform.app_org_id())
  WITH CHECK (org_id = platform.app_org_id());

CREATE POLICY p_memberships__own_read ON public.memberships
  FOR SELECT TO platform_app
  USING (user_id = platform.app_actor_id());

CREATE POLICY p_memberships__operator ON public.memberships
  FOR SELECT TO platform_app
  USING (current_setting('app.actor_scope', true) = 'OPERATOR' AND platform.app_is_operator());

CREATE POLICY p_memberships__definer_read ON public.memberships
  FOR SELECT TO platform_definer
  USING (true);
GRANT SELECT ON public.memberships TO platform_definer;

-- Standard-columns guard for public.memberships, module organisations: rendered by tools/db/render-rls.ts from prisma/sql/policy-templates; do not edit.
CREATE TRIGGER trg_memberships__std_columns BEFORE INSERT OR UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION platform.std_columns_guard();

-- RLS for public.organisations (TENANT; policySet dr-a14-organisations, definerRead), module organisations: rendered by tools/db/render-rls.ts from prisma/sql/policy-templates; do not edit.
ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisations FORCE ROW LEVEL SECURITY;

CREATE POLICY p_organisations__active ON public.organisations
  FOR ALL TO platform_app
  USING      (id = platform.app_org_id())
  WITH CHECK (id = platform.app_org_id());
CREATE POLICY p_organisations__member_read ON public.organisations
  FOR SELECT TO platform_app
  USING (EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.org_id = organisations.id
                    AND m.user_id = platform.app_actor_id()
                    AND m.status IN ('ACTIVE','SUSPENDED')));

CREATE POLICY p_organisations__operator ON public.organisations
  FOR SELECT TO platform_app
  USING (current_setting('app.actor_scope', true) = 'OPERATOR' AND platform.app_is_operator());

CREATE POLICY p_organisations__definer_read ON public.organisations
  FOR SELECT TO platform_definer
  USING (true);
GRANT SELECT ON public.organisations TO platform_definer;

-- Standard-columns guard for public.organisations, module organisations: rendered by tools/db/render-rls.ts from prisma/sql/policy-templates; do not edit.
CREATE TRIGGER trg_organisations__std_columns BEFORE INSERT OR UPDATE ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION platform.std_columns_guard();

-- RLS for public.users (USER_OWNED; policySet dr-a14-users, definerRead), module identity: rendered by tools/db/render-rls.ts from prisma/sql/policy-templates; do not edit.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;

CREATE POLICY p_users__own ON public.users
  FOR ALL TO platform_app
  USING      (id = platform.app_actor_id())
  WITH CHECK (id = platform.app_actor_id());
CREATE POLICY p_users__org_member_read ON public.users
  FOR SELECT TO platform_app
  USING (EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.user_id = users.id
                    AND m.org_id = platform.app_org_id()
                    AND m.status IN ('ACTIVE','SUSPENDED')));

CREATE POLICY p_users__operator ON public.users
  FOR SELECT TO platform_app
  USING (current_setting('app.actor_scope', true) = 'OPERATOR' AND platform.app_is_operator());

CREATE POLICY p_users__definer_read ON public.users
  FOR SELECT TO platform_definer
  USING (true);
GRANT SELECT ON public.users TO platform_definer;

-- Standard-columns guard for public.users, module identity: rendered by tools/db/render-rls.ts from prisma/sql/policy-templates; do not edit.
CREATE TRIGGER trg_users__std_columns BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION platform.std_columns_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- Runtime grants (data-model §4.4; prisma/sql/grants.manifest, C5): never DELETE (soft delete, status history).
-- ---------------------------------------------------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON TABLE "public"."users" TO platform_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."organisations" TO platform_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."memberships" TO platform_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."membership_roles" TO platform_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."invitations" TO platform_app;
