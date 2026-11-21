---
name: qg-041b-adr-0016-amendment-13-item-6-conditions
description: D-QG-008 and its closing entry D-QG-009 (2026-11-21) on ADR-0016 amendment 13 item 6 (in-flight hold, R-ARCH-36 (d)) for TASK-041 part 041-B; which of QG-041B-C1..C7 are open and what to re-verify at the next entry, at the merge and at G3
metadata:
  type: project
---

D-QG-008 (`8553b002`) = PASS_WITH_CONDITIONS on the in-flight hold. D-QG-009 (`7c6d3654`, not pushed by me) is the closing entry for the architect's answer D-ARCH-228..231 (`e306a60f`). Next free id is D-QG-010.

State after D-QG-009:
- QG-041B-C1 CLOSED (cost restated as a bound on concurrency; two alerts; trigger (iv); stream reconnects assessed).
- QG-041B-C2 CLOSED_WITH_FOLLOW_UP: the text is complete. Owed by code before TASK-052 is dispatched: change C-4 in `authn-failed.ts` and tests H7 to H10 (rulings file section 10.4, fix cycle 3 on `aade2672`), code review round 4 with five mutants, a security delta round that closes or keeps PR041-SEC-16.
- QG-041B-C3 CLOSED_WITH_FOLLOW_UP on D-PM-090 (`f7b6b1a4`; US-040 note landed in `3acebd35`). The acceptance lapses if PR041-SEC-11 is rated above LOW, and it rests on the client rule of card line 24.
- QG-041B-C4 OPEN (security-analyst): PR041-SEC-11 re-rated with the burst case, in the delta round; threat model before G3.
- QG-041B-C5 OPEN: (a) H6 on a real Valkey in lane B on the merge head; (b) and (c) may ride fix cycle 3.
- QG-041B-C6 OPEN: card line 25 at the fold; load-run measurement before G3.
- QG-041B-C7 NEW: (a) principal-architect with ux-designer, product-manager confirms, before card line 24 is folded and TASK-065 is dispatched: the "one client rule for every RATE_LIMITED" repeats automatically after `Retry-After`, while the UX flows (F10 R14, F01, F04, US-248 screen states) show the retry time and class windows run to an hour; (b) principal-architect before TASK-052: item 6 and the risk row name the slot shape C-4 does not end (no promise, answers from a callback later) and what the wrapper does with a slot that returns no promise and has not reported; (c) qa-lead before the first suite that signs in runs against Compose: TEST-STRATEGY.md says that all suites share one address, one failed-authentication budget and one room.
- The fold of card lines 20 to 26 was not done at D-QG-009 (`plan-data.mjs` at D-SD-012); lines 18 and 19 as folded are stale.

Residual merge conditions of part 041-B from this gate: QG-041B-C4 rating LOW or below; QG-041B-C5 (a); if fix cycle 3 is on the branch, round 4 and the security delta on that head plus lane B with H7 to H9; the "bound on concurrency" sentence in api/README section 7; the records' own conditions.

**Why:** a touch of item 6 for QG-041B-C7 (a) or (b) is Accepted text again and needs one more closing entry together with QG-041B-C4; G4 needs every condition closed.
**How to apply:** At the next entry read item 6 "Answer" and "Release" on main, then the UX flows; check that C-4 exists as TypeScript and that H8 asserts the error line `api.authn_slot_unreported`. I withdrew one sentence of D-QG-008: a synchronous slot is refused too, because the admission runs inside `consumeGated` and the request moves on in a later `.then`. At G3 look for the QG-041B-C5 (b) row and the C6 figures. Related: [[qg-041-adr-0016-amendment-12-conditions]], [[adr-amendment-verification-heuristics]].
