---
name: qg-040-adr-0014-amendments-5-9-conditions
description: D-QG-003 and D-QG-004 (2026-11-20) verified ADR-0014 amendments 5 to 16, ADR-0013 am. 6, the ADR-0003 call-phase amendment, ADR-0012 am. 5 and ADR-0018 am. 9 (idempotency store, claim order, purge, TASK-040 parts, If-Match before call); D-QG-010 (2026-11-21) verified amendment 18 (lease from the write) and raised QG-040-C9; which QG-040 conditions are still open and what to re-verify at the 040-B merge, TASK-085, TASK-096, TASK-187 and G3
metadata:
  type: project
---

D-QG-003 (commit 5451a677) = PASS_WITH_CONDITIONS for ADR-0014 amendments 5 to 9 and ADR-0013 amendment 6 (D-ARCH-191..195), conditions QG-040-C1..C6. D-QG-004 (commit f65d7955, judged at 1012fa6f) re-verified them against D-ARCH-200..204 and verified the new Accepted text (ADR-0003 amendment of 2026-11-20 rules (i) to (l), ADR-0014 amendments 10 to 16, ADR-0012 amendment 5, ADR-0018 amendment 9, R-ARCH-39) = PASS_WITH_CONDITIONS. Next free id is D-QG-005.

Closed by D-QG-004: C1 (a)-(d), C2 (the ruling: version compared after `load` and before `call`), C3 (b), C4 items 1 to 3, C5, C6 except the map rows. No QG-040 condition gates the part 040-A merge; only the review R4.4 and D-SECPR040-02 lists do.

Still open:
- QG-040-C3 (a): `openapi.yaml` must carry the two `ReauthProof*` sentences of ADR-0014 amendment 14, with an api-designer acknowledgement; second pull request of part 040-B.
- QG-040-C4: P-1 (CODEOWNERS line for `apps/worker/src/platform/idempotency/`, devops, TASK-015 part 015-C) and the P-3 reading with the ledger claim, both in part 040-B; `threat-model.md` T-79, R-05, AC-14, SEC-TC-04 still say "no secrets stored" (before G3).
- QG-040-C6: `gherkin-test-map.md` rows AT-US-038-01 and -06 (qa-lead).
- QG-040-C7 principal-architect with api-designer, security-analyst, product-manager, before TASK-085 is dispatched: ADR-0012 amendment 5 says `checkoutOrder` never confirms an intent, "with the Mock gateway as with Stripe"; the contract (`checkoutOrder` description, 201 text, `x-audit.additional` for a synchronous Mock authorisation) and api/README §8 say the Mock authorises synchronously. Also: which step confirms a Mock intent in the M0 saga (AT-US-202-01), SEC-COND-06 / SEC-TC-37, the US-199 reading.
- QG-040-C8 senior-developer: fold of the D-ARCH-200..204 card lines (TASK-040 part 040-B, TASK-096 replacing its placeholder, TASK-085, TASK-092, TASK-170, TASK-214), the order of TASK-096 against TASK-062 and TASK-092, and a dispatch gate on TASK-167 for the architect's open item (Stripe replays a saved 500 for a derived key).

- QG-040-C9 (D-QG-010, `7c1fad4a`, 2026-11-21) principal-architect, senior-developer folds, before TASK-187 is dispatched (Wave 7): ADR-0014 amendment 18 (D-ARCH-232: the lease counts every stretch from the write, `max(30 s, timeout + max(D + T, 3 × T) + 1 s + 5 s)`, 38.25 s at the defaults) is verified for the slot as built at `9d1687b1`, with no superseding ADR. The re-authentication check of amendment 7 (T187-1: its own committed transaction after the claim and before `load`) adds one T that no row counts: without a `load`, a route with a `call` is 1.25 s past the lease at the defaults. Item 18 or the TASK-187 card must say how that stretch is counted (a renewal after the check, or rows and a term), and the lease test gains the row.
- I withdrew "The lease rule is right" of D-QG-004 item 2: I had counted from the commit, as the text did.

**Why:** G4 requires every earlier condition closed; C7 and the TASK-167 item gate Wave 2 and Wave 6 tasks and sit on no card yet.
**How to apply:** At G3 read the test code: proofs (a) to (g) on PostgreSQL 18, the lease table test (5, 8, 9, 12, 120 s), the sealed envelope and its check, the three PR040-SEC-07 contract pins, the TASK-096 tests (stale `If-Match` with a `call`: 412 and the call fake not invoked), the call table with a fault test per `inert` and `reachable` row, the C7 outcome in the contract and the Mock gateway, US-038 Implemented only with every part merged. Related: [[qg-043-adr-0004-amendment-2-conditions]], [[qg-041-adr-0016-amendment-12-conditions]], [[adr-amendment-verification-heuristics]].
