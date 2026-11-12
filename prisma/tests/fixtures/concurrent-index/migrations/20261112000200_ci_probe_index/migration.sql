-- migration-kind: expand
-- data-changing: no
-- reversible: yes
--
-- Rule-5 probe, positive case: exactly one statement, on a table created by an earlier migration.
CREATE INDEX CONCURRENTLY "ix_ci_probe__ref" ON "public"."ci_probe" ("ref");
