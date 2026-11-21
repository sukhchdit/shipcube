---
name: qg-051-adr-0005-amendment-15-conditions
description: D-QG-005 and D-QG-006 (2026-11-21) on ADR-0005 amendment 15 for TASK-051 (PR #83); QG-051-C1..C4 closed, which conditions are still open (C5 seam before TASK-091, C6 build half on TASK-298, C7 card items, C8 map rows and story notes) and what to read at G3
metadata:
  type: project
---

D-QG-005 (commit 35c1305d) = PASS_WITH_CONDITIONS for ADR-0005 amendment 15 items 37 to 39 (D-ARCH-207..214; rulings file `wave-1-r-arch-34-operator-rulings.md` §8), conditions QG-051-C1..C6. D-QG-006 (commit bb2d7d0a, judged at main 74536b8e, code head 39cac6e5, evidence head 57e8ad62) closed C1 to C4 and verified the text D-ARCH-215/216 added (item 37 is a rule for every foreign key, merged or designed; C16 arms (c) constraint state and (d) referential actions; the customs key corrected through `org_id`). Next free id is D-QG-007.

Closed by D-QG-006: C1 (D-ARCH-215, a9bac01a), C2 (plan fold D-SD-011, 41bcb54a; new TASK-298), C3 (D-PM-087, 6e523316: US-080 partial on TASK-051 and TASK-091, completed by TASK-146), C4 (lane B run `20261121T0607Z_39cac6e` on PostgreSQL 18 PASS; D-SECPR051-02). No QG-051 condition holds PR #83.

Still open:
- QG-051-C5 principal-architect with security-analyst, before TASK-091 is dispatched: the pipeline seam that binds a guest token hash for createQuote (anonymous) and the claim operations, as an ADR-0003 route-descriptor note, plus its own D-QG verification. No ruling existed on 2026-11-21.
- QG-051-C6, build half: the ruling (D-ARCH-216) is accepted and the due point moved to "TASK-298 merged before TASK-087 opens its PR". Closes when the lane B run of TASK-298 shows the six plants of arm (c) and the three of arm (d), and the lane B run of TASK-087 is on a head that contains TASK-298.
- QG-051-C7 senior-developer, next plan fold, before TASK-298 is dispatched: (a) PR051-SEC-06 (INFO; column pairs as an array, the quoted `"a=x"` plant) on the TASK-298 card; (b) a task for the `[SEC-TC-79]` tag on O7, due before G3, never on PR #83; (c) the PostgreSQL 18 mutant report of O1 and O7 in that task's PR (only the code reviewer ran them, on PGlite 17.5).
- QG-051-C8 qa-lead and orchestrator, before TASK-091 merges: `gherkin-test-map.md` rows AT-US-080-01 to -07 still name one suite (`rls-cross-tenant`, -07 `audit-generator`) while the database halves run in `integration`; each of -01, -02, -04..-07 must name both halves. The held story notes of US-080 and US-166 (`.orch/held/D-PM-087-stories.note.md`) are landed.

**Why:** G4 requires every earlier condition closed; C5 to C8 gate dispatches and later merges and sit outside the TASK-051 pull request, so they are easy to lose.
**How to apply:** At G3 read the test code, not the trace: arms (c) and (d) in the catalog JUnit with nine plants and the PR051-SEC-06 outcome; the O7 tag and both mutant reports on PostgreSQL 18; AT-US-080-01, -02, -04..-07 each with a passing route-level test of its owner on the real quote tables; the four customs cases of TASK-154 (23001 declaration first, 23503 line first, the one statement, another organisation's line); the duplicate cases on the real `quote_packages` (TASK-087) and `quote_shares` (TASK-237); the route-table test of rulings §8.8 item 4 on TASK-091; SEC-TC-79..81; T-35. Related: [[qg-040-adr-0014-amendments-5-9-conditions]], [[adr-amendment-verification-heuristics]].
