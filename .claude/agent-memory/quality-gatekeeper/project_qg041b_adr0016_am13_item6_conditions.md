---
name: qg-041b-adr-0016-amendment-13-item-6-conditions
description: D-QG-008, D-QG-009 and D-QG-010 (2026-11-21) on ADR-0016 amendment 13 item 6 (in-flight hold, R-ARCH-36 (d), the RATE_LIMITED client rule, the callback slot form) for TASK-041 part 041-B; which of QG-041B-C1..C8 are open and what to re-verify at the next entry, at the merge and at G3
metadata:
  type: project
---

D-QG-008 (`8553b002`) = PASS_WITH_CONDITIONS on the in-flight hold. D-QG-009 (`7c6d3654`) closed C1 and C2 on D-ARCH-228..231. D-QG-010 (`7c1fad4a`, not pushed by me) verified the touch for C7 (D-ARCH-233, D-ARCH-234, `76d5e46b`; D-UX-037, D-PM-092, D-QA-023). Next free id is D-QG-011.

State after D-QG-010:
- QG-041B-C1 CLOSED. QG-041B-C2 CLOSED_WITH_FOLLOW_UP: change C-4 and H7 to H10 are on the branch at `214ec79b` (read, not run; H8 asserts `api.authn_slot_unreported`); code review round 4 is APPROVED_WITH_NITS (D-CRPR041B-01); the security delta round on `214ec79b` was running.
- QG-041B-C3 CLOSED_WITH_FOLLOW_UP on D-PM-090 as amended by D-PM-092. The acceptance lapses if PR041-SEC-11 is rated above LOW, if item 6 changes again, or if the number of repeats changes.
- QG-041B-C4 OPEN (security-analyst): PR041-SEC-11 with the burst case, and what remains of PR041-SEC-16 (rows 5a and 5b of rulings 11.3). It gets its own closing entry; threat model before G3.
- QG-041B-C5 OPEN: (a) H6 on a real Valkey in lane B on the merge head, with H7 to H9. QG-041B-C6 OPEN: card line 25 at the fold; load-run measurement before G3.
- QG-041B-C7 (a) CLOSED_WITH_FOLLOW_UP, (b) CLOSED, (c) CLOSED_WITH_FOLLOW_UP. The client rule: an automatic repeat only for `Retry-After: 1`, three times at most; a longer wait is shown and the user repeats. No superseding ADR.
- QG-041B-C8 NEW (principal-architect, with ux-designer if the flow changes; before TASK-065 is dispatched): item 6 and card line 24 say "the client sends nothing more by itself" and "no component repeats one on a timer"; F10 §1.1 (D-UX-037) lets a poll of data on screen go on after `Retry-After` with no state shown. The developer text must say what a poll does, with a test row, plus rows for the same key on the repeat, a missing `Retry-After`, and the requests that waited for a rate-limited refresh.
- Follow-ups of D-QG-010: (1) senior-developer folds card lines 20 to 26 (line 21 before TASK-052, line 24 before TASK-065; not folded at `3b807c24`); (2) api-designer: the client sentence of rulings 11.6 in api/README §7, with one sentence on whether every `RATE_LIMITED` answer comes before any effect of its request; (3) qa-lead: TEST-STRATEGY §10.4 rules 2 and 6 were written before D-ARCH-233 (a served 429 for a UI state needs `Retry-After` above 1; J-M1-04 c must not depend on the last second of a window), before TASK-279; (4) the JSDoc sentence in `authn-failed.ts` (R4-n4).

Residual merge conditions of part 041-B from this gate: QG-041B-C4 rating LOW or below; QG-041B-C5 (a); the security delta round on `214ec79b`; the "bound on concurrency" sentence in api/README §7; the records' own conditions.

**Why:** G4 needs every condition closed; C8 and follow-up 2 gate TASK-065, card line 21 gates TASK-052.
**How to apply:** At the closing entry for C4 read the security record's rating of rows 5a and 5b and of PR041-SEC-11, then check whether item 6 was touched for C8 (it need not be if a card line follows my reading: "Not before the time" binds a poll). At G3 read the TASK-065 tests against card line 24 (a) to (g) and F10 §1.1, the QG-041B-C5 (b) row and the C6 figures. Related: [[qg-041-adr-0016-amendment-12-conditions]], [[adr-amendment-verification-heuristics]].
