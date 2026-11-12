-- migration-kind: expand
-- data-changing: no
-- reversible: yes
INSERT INTO "public"."permissions" ("id", "key", "operator_only")
VALUES ('00000000-0000-7000-8000-000000000001', 'org:read', true)
ON CONFLICT ("key") DO UPDATE SET "operator_only" = EXCLUDED."operator_only";
