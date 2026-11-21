---
name: project-p5-task045
description: TASK-045 (HMAC cursors, keyset, INVALID_FILTER slot) r1 @b380f429 PASS_W_COND; r2 delta @3168c194 PASS_W_COND (main 658d9918, unpushed, D-SECPR045-02): C1-C3 closed, new LOW 08 smallint (045-C), INFO 09 timestamp keys (TASK-073); C4 lane B open
metadata:
  type: project
---

**Round 1** (2026-11-21, `b380f429`, D-SECPR045-01, record `docs/05-quality/security/PR-pending-TASK-045-security-review.md`; rename to `PR-<NNNN>-…` when the PR exists). Findings 01 LOW filter 500s (NUL/int4/year 0000/negative years), 02 LOW = R1-M1 (RLS-invisible boundary ends list), 03 LOW binding (`q`, actorScope, credential), 04 LOW latent key budget, INFO 05 expiry cap, 06 id-only boundary subquery (non-RLS tables, TASK-073 card), 07 audit ceiling.

**Round 2** (2026-11-21, delta `b380f429..3168c194`, appended on main `658d9918`, not pushed, D-SECPR045-02). Closed: 01 (classes found), 02, 03; 04/05 in code; 07 contract half (`/audit/` path + tag). New: **08 LOW latent = code R2-m1** (integer default int4 vs `smallint` `Invitation.sendCount`: 32768 → 500 22003/P2020; ruled: route to part 045-C, preferred fix = required min/max), **09 INFO = R2-n2 widened** (keys-path timestamp text outside `TIMESTAMP_TEXT`: year ≥ 10000, infinity, BC, LMT offsets → plain Error 500 per page; Joi `date().iso()` accepts `+010000-…` so body fields can store year 10000; TASK-073 rider). Open: C4 lane B on `3168c194` (merge condition), C5 part 045-C, F2' runbook line has no holder (asked for 045-C card), 06 (TASK-073 card `41bcb54a`), 07 module half (TASK-096, D-ORCH-150), F5 principal-architect.

**Why:** two rounds already; the next trigger is a new owned-path head (R2-m1 fixed in TASK-045 instead of 045-C), a main merge touching owned paths (stacked-build rule D-ORCH-150 → merge-only round), or part 045-C's own round.

**How to apply (next round on this task):** re-run the kit on the new head and on `3168c194` as the positive control; check 08 if fixed (declaration without range = ListSpecError; smallint 32768 = 400). Kit in session scratch `t045r2/probes/` (may vanish): `r2-p1-e2e.mts` (int-test DDL incl. `CREATE SCHEMA platform` + released helpers migration read from the extract, RLS reads as `SET LOCAL ROLE platform_app` + `set_config('app.org_id',…,true)`, 41 E-cases, R0-R5 + error identity), `r2-p2-codec.mts` (23-variant binding, expiry edges, key budget/kinds, V1-V18, declarations, ReDoS), `r2-p3-contract.mts`, `r2-p4-smallint.mts`, `r2-mutants.mjs` (21 mutants vs unit suites), `r2-sim.mjs` args `<clone> <combined> <r1> <main> <base> <head>` (12 scenarios incl. C7 round-1-alone). Run `.mts` via `node --conditions=@platform/source --import file:///<main>/node_modules/tsx/dist/esm/index.mjs`.

**Facts:**
- PGlite 0.4.3 socket server: the FIRST query of every new client after another client disconnected fails with P1017; wrap each DB op in a retry that recreates the client (not only after error responses).
- Scratch Jest on a partial `git archive` extract (apps packages prisma tools + `jest.config.ts`): also extract `tests/api/helpers` (jest globalTeardown `coverage-teardown.ts`), junction `node_modules` to main; `--selectProjects unit --maxWorkers=2 <dirs>` runs in ~4 s.
- `@prisma/adapter-pg` 7.10.1 `formatDateTime` pads the year without a sign (year -1 → `00-1-…`, 22007). Prisma `@db.SmallInt` is `Int` with an untyped parameter, so PG types it as the column (22003).
- Any SQLSTATE outside the mapped set is 500 `DB_ERROR` (`map-db-error.ts:238`). `EXPECTED_ROLE_SETTINGS` does not pin `TimeZone`.

Related: [[project-p5-task041]], [[project-p5-pr56-task029]], [[project-p5-pr32-route-pipeline]], [[project-security-review-conventions]]
