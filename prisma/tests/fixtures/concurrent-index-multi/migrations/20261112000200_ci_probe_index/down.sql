-- Reverts the fixture index (one statement: DROP INDEX CONCURRENTLY has the same restriction).
DROP INDEX CONCURRENTLY "public"."ix_ci_probe__ref";
