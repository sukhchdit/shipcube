-- migration-kind: expand
-- data-changing: no
-- reversible: yes
CREATE TABLE "public"."ci_probe" ("id" UUID NOT NULL DEFAULT uuidv7(), "ref" TEXT NOT NULL, CONSTRAINT "pk_ci_probe" PRIMARY KEY ("id"));
