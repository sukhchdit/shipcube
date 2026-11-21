---
name: qg-051-adr-0005-amendment-15-conditions
description: D-QG-005 (2026-11-21) verified ADR-0005 amendment 15 items 37 to 39 (23001 on PostgreSQL 18, owner column must separate owners, staff grant on UPDATE to ACTIVE) for TASK-051 with conditions QG-051-C1..C6; what gates the TASK-051 merge, the TASK-087 and TASK-091 dispatches, and what to read at G3
metadata:
  type: project
---

D-QG-005 (commit 35c1305d, judged at 0e0e5aa0, 2026-11-21) = PASS_WITH_CONDITIONS for ADR-0005 amendment 15 (D-ARCH-207..214; rulings file `wave-1-r-arch-34-operator-rulings.md` §8). The three rules are sound; no condition asks to change them. Next free id is D-QG-006.

Open conditions:
- QG-051-C1 principal-architect, before TASK-051 merges: (a) item 37 says every foreign key of the Platform is RESTRICT on both actions, but data-model §3.11 designs `fk_customs_items__declaration_currency … ON UPDATE CASCADE` (also not org-bound); (b) the TASK-087 card line of rulings §8.9 says "C16 (b) reports both", yet one index over both owner columns under default NULLS DISTINCT passes C16 (b) and enforces nothing.
- QG-051-C2 senior-developer, plan fold before TASK-051 merges: the 16 lines of rulings §8.9 (the TASK-091 DISPATCH GATE among them, also in STATUS), the D-SECPR051-01 card lines (PR051-SEC-02 (a)/(b), -04, -05), a line on TASK-092 for `ux_saga_steps__saga_step_shipment` (no owner column). plan-data.mjs still said 23503 for TASK-146 and TASK-237.
- QG-051-C3 product-manager (with senior-developer, qa-lead), D-PM entry before TASK-051 merges: US-080 is M0 Must and "completes" on TASK-051, while six of seven scenarios have HTTP halves on TASK-091 (Wave 2) and TASK-146 (batch 5.1).
- QG-051-C4 TASK-051 fix cycle + security delta round, before the merge: items 38 and 39 had only PGlite 17.5 probes; lane B on PostgreSQL 18 at the fix head must show C2/C6 = 23001, the four pin combinations, three tripwire tokens, the six planted probes, four T2-O cases, O7.
- QG-051-C5 principal-architect with security-analyst, before TASK-091 is dispatched: the pipeline seam that binds a guest token hash for createQuote (anonymous) and the claim operations, as an ADR-0003 route-descriptor note, plus its own D-QG verification.
- QG-051-C6 principal-architect with security-analyst, before TASK-087 is dispatched: C16 (a) reads neither `conenforced` nor `convalidated`; PostgreSQL 18 accepts `FOREIGN KEY … NOT ENFORCED` (from the release notes, not run by me).

**Why:** G4 requires every earlier condition closed; C5 and C6 gate Wave 2 dispatches and do not block the TASK-051 merge, so they are easy to lose.
**How to apply:** At the TASK-051 merge check look for C1 to C4 only. At G3 read the test code on PostgreSQL 18: C2/C6 at 23001 and C3 at 23503, the "sqlState only" assertion, `c16_g_both`, the C16 (b) probes on `c16_gparent` and `c16_parent`, O7 with both hand-run mutant reports, the route-table test of rulings §8.8 item 4 on TASK-091, SEC-TC-79..81 and SEC-TC-07 with the same-organisation round, T-35. Related: [[qg-040-adr-0014-amendments-5-9-conditions]], [[adr-amendment-verification-heuristics]].
