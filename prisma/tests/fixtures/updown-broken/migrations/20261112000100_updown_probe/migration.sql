-- migration-kind: expand
-- data-changing: no
-- reversible: yes
CREATE TABLE "public"."updown_probe" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "updown_probe_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ix_updown_probe__name" ON "public"."updown_probe"("name");

CREATE SEQUENCE "public"."updown_probe_leftover_seq";
