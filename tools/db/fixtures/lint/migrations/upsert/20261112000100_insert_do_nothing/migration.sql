-- migration-kind: expand
-- data-changing: no
-- reversible: yes
INSERT INTO "public"."permissions" ("id", "key", "operator_only")
VALUES ('00000000-0000-7000-8000-000000000001', 'org:read', false)
ON CONFLICT ("id") DO NOTHING;
