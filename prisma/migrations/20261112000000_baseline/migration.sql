-- migration-kind: expand
-- data-changing: no
-- reversible: yes
--
-- Baseline of the Prisma migration history (TASK-003). Roles, schemas, extensions and default privileges come from the
-- bootstrap lane (prisma/bootstrap, cluster-admin credential); this lane runs as platform_migrator and starts empty.
-- The first module migrations (TASK-016 RLS helpers onwards) follow; every migration carries this header block and a
-- hand-written down.sql (data-model.md §7.3, §8.3, §8.4).
SELECT 1;
