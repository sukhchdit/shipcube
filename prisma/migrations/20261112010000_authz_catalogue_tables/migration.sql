-- migration-kind: expand
-- data-changing: no
-- reversible: yes
--
-- Authz catalogue tables (TASK-013; REQ-RBAC-001/002/013, data-model §3.3, ADR-0008 §2). GLOBAL class (§1.5): no
-- org_id and no RLS; every session may read, nobody writes at runtime. platform_app gets SELECT only, so role and
-- permission definitions change through versioned seed migrations alone (REQ-RBAC-013). The rows arrive with the
-- next migration (20261112010100_authz_seed_v1), generated from the packages/authz catalogue.
CREATE TABLE "public"."permissions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "operator_only" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "pk_permissions" PRIMARY KEY ("id"),
    CONSTRAINT "ck_permissions__version" CHECK ("version" >= 1),
    CONSTRAINT "ck_permissions__key_format" CHECK ("key" ~ '^[a-z_]+:[a-z_]+(:[a-z_]+)?$' OR "key" IN ('public', 'authenticated'))
);

CREATE TABLE "public"."roles" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "key" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT NOT NULL,

    CONSTRAINT "pk_roles" PRIMARY KEY ("id"),
    CONSTRAINT "ck_roles__version" CHECK ("version" >= 1),
    CONSTRAINT "ck_roles__scope" CHECK ("scope" IN ('OPERATOR', 'CUSTOMER', 'PARTNER'))
);

CREATE TABLE "public"."role_permissions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "pk_role_permissions" PRIMARY KEY ("id"),
    CONSTRAINT "ck_role_permissions__version" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "ux_permissions__key" ON "public"."permissions"("key");

CREATE UNIQUE INDEX "ux_roles__key" ON "public"."roles"("key");

-- AP-AUTHZ-01: roles by scope.
CREATE INDEX "ix_roles__scope" ON "public"."roles"("scope");

CREATE UNIQUE INDEX "ux_role_permissions__role_permission" ON "public"."role_permissions"("role_id", "permission_id");

-- AP-AUTHZ-02: permissions of roles (index-only scan for the effective-permission query, REQ-RBAC-008).
CREATE INDEX "ix_role_permissions__role_id" ON "public"."role_permissions"("role_id") INCLUDE ("permission_id");

ALTER TABLE "public"."role_permissions" ADD CONSTRAINT "fk_role_permissions__role_id" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "public"."role_permissions" ADD CONSTRAINT "fk_role_permissions__permission_id" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Runtime role: read-only (REQ-RBAC-013). No INSERT, UPDATE, DELETE or TRUNCATE.
GRANT SELECT ON TABLE "public"."permissions", "public"."roles", "public"."role_permissions" TO platform_app;
