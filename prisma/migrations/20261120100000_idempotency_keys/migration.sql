-- migration-kind: expand
-- data-changing: no
-- reversible: yes
--
-- HTTP idempotency keys (TASK-040; US-038; REQ-API-009..011, DR-A20, NFR-RES-005; ADR-0014 §HTTP idempotency and
-- amendments 1 and 4; data-model §3.5 and §6.2, §10.4). SYSTEM class (§1.5), module idempotency
-- (tools/db/table-classes/idempotency.json): no RLS, reached only through apps/api/src/platform/idempotency/** via
-- systemDelegates(tx) (PR19-SEC-01, D-ARCH-080). One row per (caller scope, method, path, key): scope_hash is the
-- SHA-256 of the scope, unique, so a concurrent duplicate's claim waits on the first claim and then finds it.
-- response_body is AES-256-GCM ciphertext (nonce ‖ ct ‖ tag) under IDEMPOTENCY_BODY_KEY, its key id beside it, with
-- the AAD binding the table, the column, hex(scope_hash) and the key id (SEC-TC-04, SEC-P3-08, SEC-P3-10): the only
-- PER column a SYSTEM table may hold (catalog C10 exception), kept 24 h. Rows are hard-deleted: a 5xx, 429 or failed
-- outcome releases its key, an expired key is deleted before it is claimed again, and the purge removes expired rows
-- (ix_idempotency_keys__expires_at), so platform_app holds SELECT, INSERT, UPDATE and DELETE (hardDelete, §4.4).
-- Full standard columns (catalog-std), so the standard-columns guard trigger of §7.6 is rendered from the manifest.
-- No BEGIN ATOMIC routine and no prisma/bootstrap file is added.
CREATE TABLE "public"."idempotency_keys" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "scope_hash" BYTEA NOT NULL,
    "scope_org_id" UUID,
    "actor_id" UUID,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "idem_key" TEXT NOT NULL,
    "fingerprint" BYTEA NOT NULL,
    "status" TEXT NOT NULL,
    "lease_until" TIMESTAMPTZ(6) NOT NULL,
    "response_status" SMALLINT,
    "response_headers" JSONB,
    "response_body" BYTEA,
    "response_body_key_id" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pk_idempotency_keys" PRIMARY KEY ("id"),
    CONSTRAINT "ck_idempotency_keys__version" CHECK ("version" >= 1),
    CONSTRAINT "ck_idempotency_keys__scope_hash" CHECK (octet_length("scope_hash") = 32),
    CONSTRAINT "ck_idempotency_keys__method" CHECK ("method" IN ('POST', 'PUT', 'PATCH', 'DELETE')),
    CONSTRAINT "ck_idempotency_keys__key" CHECK ("idem_key" ~ '^[\x21-\x7E]{1,255}$'),
    CONSTRAINT "ck_idempotency_keys__fingerprint" CHECK (octet_length("fingerprint") = 32),
    CONSTRAINT "ck_idempotency_keys__status" CHECK ("status" IN ('IN_PROGRESS', 'COMPLETED')),
    CONSTRAINT "ck_idempotency_keys__response_status" CHECK (
        "response_status" IS NULL OR ("response_status" BETWEEN 200 AND 499 AND "response_status" <> 429)
    ),
    CONSTRAINT "ck_idempotency_keys__completed" CHECK (("status" = 'COMPLETED') = ("response_status" IS NOT NULL)),
    CONSTRAINT "ck_idempotency_keys__body_key" CHECK (("response_body" IS NULL) = ("response_body_key_id" IS NULL)),
    CONSTRAINT "ck_idempotency_keys__body_key_id" CHECK (
        "response_body_key_id" IS NULL OR "response_body_key_id" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*-v[1-9][0-9]{0,5}$'
    )
);

CREATE UNIQUE INDEX "ux_idempotency_keys__scope_hash" ON "public"."idempotency_keys"("scope_hash");

CREATE INDEX "ix_idempotency_keys__expires_at" ON "public"."idempotency_keys"("expires_at");

-- Standard-columns guard for public.idempotency_keys, module idempotency: rendered by tools/db/render-rls.ts from prisma/sql/policy-templates; do not edit.
CREATE TRIGGER trg_idempotency_keys__std_columns BEFORE INSERT OR UPDATE ON public.idempotency_keys
  FOR EACH ROW EXECUTE FUNCTION platform.std_columns_guard();

-- Runtime grants (data-model §4.4; prisma/sql/grants.manifest, C5): SYSTEM hard-delete allow-list.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."idempotency_keys" TO platform_app;
