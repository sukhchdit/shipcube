---
name: task020b-lessons
description: TASK-020 part 020-B (2026-11-13) - generated Prisma client package wiring, fixture stand-ins under ignored paths, tamper tests vs Joi describe(), specialist turn cap again, baseline timing worktree
metadata:
  type: feedback
---

020-B: I did the Prisma client package, import discipline and runner activation myself (about 150 calls); one opus backend-developer took the declared-credential follow-up and stopped at the 80-turn cap (119 tool uses, no report) with the work complete. Salvage took about 10 calls: tsc, eslint, a mutation script (9/9 killed), commit.

**Why:** these traps recur whenever a PR touches the generated client, lint fixtures or Joi internals.

**How to apply:**
- **Specialist cap is the norm for a 6-item follow-up.** Brief it, but plan the salvage (tsc, eslint on its files, jest on its dirs, mutation of its guards) from the start.
- **Fixture files under a globally ignored path** (`prisma/generated/**`) make the fixture runner report "File ignored", which fails the "every other fixture lints clean" check. Keep the stand-in as an import target only and skip it in `tools/lint/lint-fixtures.mjs`. Prove the bare workspace specifier with REPO_PROBES (real resolution), not with fixtures.
- **Keep old lint message substrings when you extend a message.** The base-ref suite matches substrings, for example "the root database client (platform/db/client.ts) is private".
- **Tampering a Joi schema** (`$_terms` or `_definition` set to undefined) breaks Joi's own `describe()` and construction. Test the walker function directly; export it for its tests.
- **Making the runner always-on** turned the config pair DB_CONNECTION_TIMEOUT_MS < 2000 (tenant-tx maxWait) into a boot failure. Test configs using 1000 broke. Check cross-key constraints when a component becomes non-optional.
- **`prisma generate` rewrites files in place.** In a 1 ms polling probe the files never disappeared. Suites that import the generated client at module load are therefore low-risk against the deps:rebuild test in the same lane.
- **Baseline timings (R-ARCH-28):** measure them in a finished worktree detached at origin/main with healthy node_modules. A broken worktree (missing `chalk`) gave a bogus rc=1. Host load makes the before/after numbers noisy, so say so in the PR.
- The `a "$x" ... &&` gate→evidence chain worked. Kill the queued evidence script (`kill <bash pid>`) as soon as a gate fails, before it takes docker.lock.

Related: [[pr32-fc2]], [[p5-dispatch]], [[lane-b-evidence-run]]
