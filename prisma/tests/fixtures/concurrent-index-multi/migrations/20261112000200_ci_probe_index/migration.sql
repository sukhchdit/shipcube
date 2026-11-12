-- migration-kind: expand
-- data-changing: no
-- reversible: yes
--
-- Rule-5 probe, negative case: CREATE INDEX CONCURRENTLY next to another statement in the same file.
SET lock_timeout = '3s';
CREATE INDEX CONCURRENTLY "ix_ci_probe__ref" ON "public"."ci_probe" ("ref");
