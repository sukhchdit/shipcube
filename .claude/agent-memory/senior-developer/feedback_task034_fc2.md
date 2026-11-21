---
name: task034-fc2
description: TASK-034 fix cycle 2 - Prisma 7.10 CLI stream layout (banner on stderr, status on stdout), never tail joined streams, harness-only CLI proof by rewriting the Compose exec prefix
metadata:
  type: feedback
---

- **Prisma 7.10 CLI streams:** "Loaded Prisma config…" and "Prisma schema loaded…" go to **stderr**. `migrate status`
  text ("N migrations found", "Following migration have not yet been applied:" + names) goes to **stdout**, then
  `process.exit(1)`. The diverged and failed forms use `console.error`, so they go to stderr. A "last N lines of stdout+stderr" detail
  therefore holds only the banner. Parse names from both streams into structured fields (tools/db/prisma-outcome.ts).
  Read the bundled source directly: `node_modules/prisma/build/cli.js` (indexOf + slice; grep -o on it is too slow).
- **Windows pipe writes are synchronous.** Output written right before `process.exit` survives a nested
  `spawnSync(..., stdio: 'inherit')` chain (probed with 300 KB). Do not blame lost output on the exit.
- **Harness-only proof of a Compose-based CLI (no host secrets):** call `main(argv, env, {...PROD_DEPS, archive:
  (t) => composeArchiveTool({...t, run})})`, where `run` rewrites `compose [-p P] exec -T svc` to
  `docker exec -i <container.getId()>` and delegates to the real `runProcess`. This proves argv parsing, binary stdout to
  a host file, stdin restore, exit codes, the report and `wx`. Record the prefix to pin `--project` and `--service`. Wrap the
  real Prisma deps in `withFileLock(PRISMA_TREE_LOCK, …)`. Not provable: Compose's own project and service lookup.
- **`node -e` with template literals in Bash failed again** ("bad substitution"). Use the Edit tool for TS edits that
  contain backticks or `${}`.

**Why:** one lane B cycle was lost to an assertion on a detail string that depended on stream order (2026-11-21).
**How to apply:** any tool that reports a child CLI's outcome, and any C4-style "manual Compose run" condition.
Related: [[task034-fc1]], [[task034-rehearsal]], [[feedback_pr23_fc1]]
