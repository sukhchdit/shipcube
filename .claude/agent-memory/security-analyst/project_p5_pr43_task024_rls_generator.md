---
name: project-p5-pr43-task024-rls-generator
description: PR #43 (TASK-024 generated RLS suite, DR-A14 sets, std_columns_guard, linter 11c/17/18/19/20/L) R1 @8ac271d PASS_W_COND; R2 @585f163 2026-11-14 PASS_WITH_FOLLOW-UPS (C1/C2 closed); new LOW 11 splitter over-count + END resync, LOW 12 positiveStatus vacuity, INFO 13; union/activation checklists
metadata:
  type: project
---

Record: `docs/05-quality/security/PR-0043-TASK-024-security-review.md` in worktree `Shipqube-TASK-024` (uncommitted after R2, LF, 661 lines). R1 head `8ac271d`, R2 head `585f16318279f8f7f0975b762ea4412e84bf95f8` (code head `9d679f0`, merge base `c998fae`). Lane A counts 182 owned paths.

**R2 verdict PASS_WITH_FOLLOW-UPS (2026-11-14).** C1 (PR43-SEC-03 splitter `begin`) and C2 (PR43-SEC-01 registration-only API cases) closed; LOW 02/04/05/06 closed; INFO 07/08/09 claimed parts closed; 10 partly (catalog schema scope). Proposed D-SEC-PR43-05.
- **PR43-SEC-11 LOW** (= code review R2-m1, extended): inside a BEGIN ATOMIC body, `AS case`, `t.case`, bare-label `SELECT 1 case`, and `SELECT begin atomic` (column + bare label) over-count; a later top-level `END;` resyncs and everything between lints clean. The reviewer's previous-token fix closes only the first two. Structural fix validated on scratch: CASE depth per body statement (throw at `;` with open CASE = rule L) + nested BEGIN ATOMIC only after a routine head; all 488 `.sql` of the extract split identically.
- **PR43-SEC-12 LOW:** `ApiCrossTenantCase.positiveStatus` unconstrained; mis-mapped param + `positiveStatus: 404` passes against a leaking route (proved with the PR's real `runApiCase` on a stub server). Due before the first `API_CASES` entry.
- **PR43-SEC-13 INFO:** after D-ARCH-123, users-row consent rests on the service layer (`p_memberships__tenant` FOR ALL). TASK-227/231 + abuse suite.
- **Activation (D-SEC-PR43-04 adjusted, D-ORCH-071):** manifest-only qa-lead PR right after #43, before TASK-037 and the first tenant/user/guest route; its run shows rls-cross-tenant 126/0/0 (uncredited under rule 4 is fine).

**Facts:** PG 18 `gram.y`: CASE, END, BEGIN, ATOMIC are all `bare_label_keyword`; `ColLabel`/`attr_name` admit reserved words; `routine_body_stmt: stmt | ReturnStmt` (grammar allows nested CREATE FUNCTION). RLS footnote (a), `has_table_privilege` ignores column grants, FK/unique bypass RLS (from R1). The `generated` Jest project runs in lane B coverage-only even while the suite is `planned` (`coverage merge: generated coverage run`, heavy.mjs:734).

**Why:** the merge is allowed; the open items land in TASK-037/051/027/227 and the activation PR, and every union that touches an owned path voids the R2 binding.

**How to apply:**
- **Merge-only round triggers:** #44 (`443c2f1`) ratchet `tools/repo/test-lane-idle-timeout.test.ts` forces `cross-tenant.int.test.ts:549` 15_000 → `TEST_LANE_TX_IDLE_TIMEOUT_MS` (owned file; sim S9), and #44 changes `createApp` (serve() must still swap only the authenticate slot). #39 textual conflicts in `check-workflow-policy.{mjs,test.ts}`; #42 eslint + negative-fixtures.
- **TASK-037 checks:** PR43-SEC-11 fix with 4 shape fixtures + `AS end`; DR-A14 real tables (record §6); SEC-07 rest; SEC-10 rest.
- **Record-sim kit (session scratch `pr43r2/`):** `sim/record-sim.sh` (S0-S11; sparse set works with `cygpath -m` for `-C`), `build.mjs` (placeholder fill needs `key(?![0-9])`: SIM_S1 is a prefix of SIM_S10), `lint/p1..p6`, `api/p4-cases.mjs`, `filescan.mjs`, `gl/`.

Related: [[project-p5-pr11-rls-review]], [[project-p5-pr26-standard-columns]], [[project-p5-pr44-020c]], [[project-p5-pr32-route-pipeline]], [[project-p5-wave0-rls-spike]], [[project-security-review-conventions]]
