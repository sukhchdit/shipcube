---
name: qg-041b-adr-0016-amendment-13-item-6-conditions
description: D-QG-008 (2026-11-21) verified ADR-0016 amendment 13 item 6 (in-flight hold, R-ARCH-36 (d)) for TASK-041 part 041-B with conditions QG-041B-C1..C6; what to re-verify at the closing entry, at the merge and at G3
metadata:
  type: project
---

D-QG-008 (commit 8553b002, 2026-11-21, not pushed by me) = PASS_WITH_CONDITIONS on the in-flight hold of the failed-authentication budget (D-ARCH-225..227, amendment commit f8794de2, code at 12b8a10a). Next free id is D-QG-009.

Open conditions:
- QG-041B-C1 principal-architect, before 041-B merges: the cost sentence "120 in flight only when each takes more than a second on average" is wrong. The hold is a concurrency bound: at limit 120, 300 valid bearers at once with one ES256 verification each gave 179 x 429 (my probe on the compiled head, 4 of 4 runs). Trigger (iv) and the TASK-214 alert wording follow; the stop of amendment 14 item 4 (stream reconnects) is assessed as a burst source.
- QG-041B-C2 principal-architect, before TASK-052 is dispatched: item 6 "Release" gains D-TASK041-20, the PR041-SEC-16 outcome contract with a ruling on release-at-finish, security additions (a) oversize body / timeout from arrival and (b) bounded slot latency; stale "open at the fix head" sentences in the ADR and risks.md; pointers in am. 12 item 4, nfr-strategy SEC-005, platform.md 5.4.
- QG-041B-C3 product-manager, before 041-B merges (after C1): D-PM entry on the corrected form; PRD 9 R-16, A-112; reading of NFR-SEC-005 ("shared across replicas", "no 429 at the limit") and the REQ-SEC-005 note.
- QG-041B-C4 security-analyst, merge-only round: PR041-SEC-11 rating with the burst case; threat model before G3 (also the open half of QG-041-C4).
- QG-041B-C5 senior-developer / qa-lead: (a) H6 green in lane B on the merge head before merge; (b) with the TASK-052 burst rows: a committed row in which arrivals continue while spends land (a 2 ms wait between the store reply and the admission gives 7 entries at limit 5 and survives H1-H5), plus R3-n1; (c) a "refused body" release row with TASK-108.
- QG-041B-C6 senior-developer (card line) / performance-engineer (before G3): the P6 load run records refusals under step0-authn-inflight and the step-0-to-outcome time.

**Why:** the new text of C1 and C2 is Accepted text again and needs one closing D-QG entry (as D-QG-006); G4 needs every condition closed.
**How to apply:** At the closing entry read item 6 and risks.md R-ARCH-36 (d) on main, not the D-ARCH summary; check the D-PM entry accepts the burst form, not the "slow request" form. At G3 look for the QG-041B-C5 (b) row in the TASK-052 tests and the C6 figures in the perf report. Fold D-SD-012 (2f6a89d5) already carries card lines 15-19, PR041-SEC-16 (a) and both security additions. Related: [[qg-041-adr-0016-amendment-12-conditions]], [[adr-amendment-verification-heuristics]].
