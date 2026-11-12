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

ALTER TABLE "public"."updown_probe" ADD CONSTRAINT "ck_updown_probe__name" CHECK (char_length("name") BETWEEN 1 AND 200);
