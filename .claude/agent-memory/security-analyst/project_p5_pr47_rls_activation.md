---
name: project-p5-pr47-rls-activation
description: PR #47 (qa-lead manifest-only rls-cross-tenant activation, SEC-TC-29 to required) R1 @be8780b PASS_WITH_FOLLOW-UPS; D-SEC-PR47-01 SEC-TC-74 back to required (amends D-SEC-PR43-04/05); LOW 01 parked-but-implemented, LOW 02 heavy --base scopes diff gate unrecorded, INFO 03 flake scope; checks owed
metadata:
  type: project
---

Record: `docs/05-quality/security/PR-0047-qa-activate-rls-security-review.md` written uncommitted into worktree `Shipqube-ACT1` on 2026-11-14 (LF, 278 lines). Head `be8780b3ecb5bcfd7d7482b54f81e0ac4b6f087c`, merge base `47f942d`. Code twin on main `0ab9502` (APPROVED_WITH_NITS, R1-m1 = my SEC-01, R1-n1 widened by my SEC-02). D-ORCH-081 = merge whichever of #47/#42 is ready first.

**Verdict PASS_WITH_FOLLOW-UPS.** Manifest leaf diff = 14 leaves exactly as D-ORCH-071 + SEC-TC-29 move (code review D1 confirmed). PR43-SEC-08 (e) closed (run `20261114T1218Z_2430a25` rls 126/0/0, 13 [SEC-TC-06]).
- **PR47-SEC-01 LOW:** SEC-TC-74 parked though 16 passing C15 cases carry it. Probe: deleting all 16 from the catalog JUnit is silent under the parked manifest (recompute PASS, pendingImplemented []), reported under the moved one. Wave-0-exit `wave` run fails rule 7.
- **PR47-SEC-02 LOW:** `heavy.mjs --base` drives both selection and the US-006 `coverage diff:` gate (:700, :993, :1081); summary.json has no base key; check-evidence re-derives selection but never ties the diff gate to the range. Natural experiment: same tree, 14 diff cases (`cc2a57d^`) vs 1 (default). Fix: `selection_base` = merge-base in summary + ancestor-or-equal check at pr. devops 015-C before G3; interim: gate tables state `--base`, credited runs default or ancestor base.
- **PR47-SEC-03 INFO:** D-QA-019 FAIL run (untracked in ACT1) has 15 failures incl. 2 [SEC-TC-29] (pipeline-guards) and 4 in `health/server.test.ts`, which D-QA-019/D-ORCH-080 omit -> TASK-W0-FLAKE scope.

**D-SEC-PR47-01 (proposed text in record §6):** never park an ID a passing test on main carries (withdraws D-SEC-PR43-04 "73 and 74 via pending"); SEC-TC-74 to `catalog-c1-c14.required_cases` in the next manifest commit: (a) #47's union commit if #42 merges first, else (b) a qa-lead manifest-only PR after #47 (with SEC-TC-69..75 adoption); ratchet catalog `min_tests` (102 today) in the same commit; due before TASK-037 takes evidence and before the first wave run. TASK-037 merge condition stays in its sheet/review (PR43-SEC-07 remainder: reset-to-1, back-dated control, RLS-order on a real STD table, MERGE). SEC-TC-73 is carried by unit tests (`lint-migrations.test.ts`, `sql-text.test.ts`), suite `migration-lint` planned: unit.required_cases or leave out, not pending.

**Facts:** `nameHasId` has a right digit boundary only (SEC-TC-290 no, SEC-TC-29a yes); distinct SEC-TC tokens in the tree: 01..75 plus decoys 1, 99, 001, 014, 140, 480 (tools/quality/tools/ci tests only). `/prisma/` is wholly CODEOWNED. Lane A evaluates up to MAX_RUN_GROUPS=30 run dirs (touched first); squashed runs are rejected forever by R-ARCH-16. A hand-rolled `<testcase>...</testcase>` regex mis-attributes failures across self-closing cases: always use the real `parseJUnit`. The sim clone's `origin/main` is the main checkout's LOCAL main: use explicit SHAs.

**Why:** the move, the union round and the TASK-037 review all hang on these rulings.

**How to apply:**
- **Next manifest commit (union or qa-lead PR):** leaf diff = SEC-TC-74 to required + pending row gone + catalog min_tests ratchet (+ #42's two packages/audit names if union); fresh credited run with the packages/audit gate cases; record sim S3/S5 show any manifest commit voids this record.
- **TASK-037 review:** C15 (a) green on real tables, PR43-SEC-07 remainder cases titled [SEC-TC-74], base manifest already requires SEC-TC-74.
- **015-C:** SEC-02 fix + three fixtures (merge base, ancestor, branch-local refused).
- Kit (session scratch `pr47/probes`, may vanish): `p1.mjs` (leaf diff, summary/JUnit verify, pending semantics with negative control), `p2-hostscan.mjs`, `p3-fail.mjs`, `record-sim.mjs` (S0-S7 + S1c), `gl-emul.mjs` + `pr47/gl/gitleaks.toml`.

Related: [[project-p5-pr43-task024-rls-generator]], [[project-p5-pr28-w0act1]], [[project-p5-pr46-015b-lane-c]], [[project-p5-pr40-covhook]], [[project-p5-threat-model-v11-round]], [[project-security-review-conventions]]
