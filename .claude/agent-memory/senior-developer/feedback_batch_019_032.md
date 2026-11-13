---
name: batch-019-032-lessons
description: TASK-019/032 (2026-11-13) - two sonnet specialists finished first time; audit DDL guard vs planted probes, prisma/tests import limits, coverage afterAll flakes, lane B evidence step, un-gated push slip
metadata:
  type: feedback
---

**What happened:** two sonnet specialists both finished and reported on the first run: backend-developer on TASK-019 (84 tool uses) and database-engineer on the TASK-032 catalog suite (27 tool uses). In both cases I had committed the port or contract first and the brief named exact files. I did the TASK-032 extension myself, for about 200 calls in total including 3 gate rounds.

**Why:** these traps are generic to this repo's P5 flow and cost time or nearly produced a bad push.

**How to apply:**
- **`merge-base --is-ancestor` before EVERY push, chained with `&&`.** I pushed after `git fetch` showed main had moved, because the check was not `&&`-chained (repeat of [[pr21-fc1-lessons]]).
  - Main moved four times in one session: TASK-017 code, docs, then TASK-011 code.
  - When the pushed branch can no longer be reset, merge again and prove which parts of the delta are docs-only.
- **TASK-021's audit identity DDL guard** (`platform.audit_ddl_guard`, names `^(audit_[a-z0-9_]+|data_subjects)$`) refuses migrator DDL on those names.
  - Planted catalog probes must never use an `audit_` prefix.
  - Test the audit-family rules on synthetic catalogue rows instead.
- **Schema rules over `public` must tolerate other in-flight branches' tables.** Before finalising exemptions, read the open PR's bootstrap SQL (here `prisma/bootstrap/10-audit.sql`).
- **`prisma/tests/**` import limits:** only `tools/{db,test-support,authz}` and TOP-LEVEL files of `apps/*/src/platform/db/`. There are no subfolders and no `@platform/shared`.
  - Re-export through `platform/db/index.ts`.
  - Add any new platform/db file to the `files` of `tools/tsconfig.json`.
- **`test:coverage` flake under host load:** `afterAll` hooks hit the 5 s default (`seed.int.test.ts`, `spk03-rls-tx.int.test.ts`) even though every test passed. Re-run just those files under the lock and report both runs honestly.
- **Lane A now has a "Lane B evidence (quality:check-evidence)" step (TASK-011, PR #23).** It is a no-op while every suite in `tools/quality/required-suites.json` is `planned`.
  - Once W0-ACT-1 activates suites, PRs touching their paths need `npm run quality:heavy -- --profile pr` evidence.
  - Check `grep -c '"status": "active"'` on main before opening a PR.
- **Specialist sandbox and `locked.sh`:** the harness refuses `export PATH=…; bash locked.sh …` and refuses piping it to `tail`. Run it as a plain command: the script sets PATH itself.
- **Prisma 7 generated create inputs REQUIRE `createdBy`/`updatedBy`** (the columns have no default). Any server-stamping design needs a typed seam (`serverStamped<T>()`), or repositories cannot compile without passing the fields the extension rejects.

Related: [[merge-main-pass]], [[lane-a-pr-hygiene]], [[p5-dispatch]]
