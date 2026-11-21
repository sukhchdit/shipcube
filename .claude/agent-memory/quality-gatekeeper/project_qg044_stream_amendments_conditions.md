---
name: qg044-stream-amendments-conditions
description: D-QG-007 (2026-11-21) verified ADR-0016 am. 14, ADR-0003 rules (m)-(q), ADR-0010 am. 14 for TASK-044 = PASS_WITH_CONDITIONS; QG-044-C1..C7 open, with owners and due points
metadata:
  type: project
---

D-QG-007 (commit `9d815b15` on main, judged at `a4ecdbf7`) = PASS_WITH_CONDITIONS on the TASK-044 stream amendments (D-ARCH-217..224). ADR-0016 amendment 14 item 2 (`error` carries no `id`) is VERIFIED, which meets the merge condition of part 044-A that names the gatekeeper.

Open conditions:
- **QG-044-C1** senior-developer, before part 044-A merges and before 044-B dispatch: the plan fold of the 21 card lines of `rulings/wave-1-task-044-rulings.md` §8; US-042 shown partial; D-SECPR044-01 F2/F4 and R1-n3 placed on TASK-141/TASK-173 cards; lines from C4, C6, C7.
- **QG-044-C2** product-manager (+ orchestrator for held story text, qa-lead for map rows AT-US-042-06/-07), before part 044-A merges: rulings §7 items 1 to 6, plus the REQ-SEC-015/US-045 "event-stream route is exempt" reading.
- **QG-044-C3** security-analyst, before part 044-B is dispatched: concurrence on D-ARCH-218, -219 (31 s deadline against its "below the 25 s drain" condition), -221, -223; T-47 and AC-46 cells by the 044-B security round. A refusal of -219 means new Accepted text and a new verification.
- **QG-044-C4** principal-architect then senior-developer, before 044-B dispatch: a proof of the `deadline` cut (none of proofs (a) to (i) covers it); log levels asserted in (d) and (h).
- **QG-044-C5** api-designer + 044-B developer, before part 044-B merges: the eight contract texts of rulings §6.
- **QG-044-C6** principal-architect, before TASK-083 is dispatched: what a stop does to a fan-out in flight (`afterCommit.drain()` now runs about 1 s after SIGTERM and aborts it while readers are sent to another replica).
- **QG-044-C7** principal-architect + database-engineer, before TASK-087 is dispatched: the persisted per-quote event sequence has no column in data-model §3.10, and `carrier_error` has no row.

**Why:** the amendments are sound, but at the verdict nothing was folded, the PM wording and the security concurrence were pending, and the resume that a stop now makes routine rests on a sequence the data model does not hold.
**How to apply:** when asked to close these, verify each as in [[adr-amendment-verification-heuristics]]; answers to C4, C6 and C7 are new Accepted text. The next gatekeeper decision id is D-QG-008. G3 additions are listed at the end of the D-QG-007 entry. Commit mechanics: [[shared-main-checkout-mechanics]].
