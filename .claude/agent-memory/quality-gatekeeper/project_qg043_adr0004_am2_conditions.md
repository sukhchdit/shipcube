---
name: qg-043-adr-0004-amendment-2-conditions
description: D-QG-002 (2026-11-20) verified ADR-0004 amendment 2 / ADR-0013 amendment 5 (outbox relay, dispatch by consumer, order contract) for TASK-043 with conditions QG-043-C1..C7; what to re-verify at the TASK-043 merge, at the dispatcher dispatch and at G3
metadata:
  type: project
---

D-QG-002 (commit abd17e2d, 2026-11-20) = PASS_WITH_CONDITIONS for the outbox amendments (in-process relay loop under a PostgreSQL advisory lock, enqueue inside the claim transaction as the one T-83 exception, one queue `outbox-relay` with a dispatcher, order key = insert time under the aggregate row lock, R-ARCH-37). Judged at d7925b70. Next free id is D-QG-003.

Open conditions:
- QG-043-C1 principal-architect, before TASK-043 merges: dated note in ADR-0005 am. 11 item 17/21 for the exception; ADR-0013 Alternatives "Redis lock in the consumer" pointer; ARCHITECTURE.md §5.2 node; data-model §6.1 advisory-lock table misses the session lock of `tools/db/bootstrap.ts`; item 11 batch-size limit of "other aggregates go on".
- QG-043-C2 principal-architect, before the dispatcher task (proposed TASK-047) is dispatched: who enqueues the handler's follow-up job and what a redelivery does when the claim exists (crash between handler commit and follow-up enqueue).
- QG-043-C3 principal-architect + security-analyst, before TASK-078 is dispatched: the `token_enc` overwrite with `published_at IS NOT NULL` matches no row while the mark is uncommitted.
- QG-043-C4 security-analyst: concurrence on the T-83 exception in the TASK-043 security round; threat-model T-83 row before G3.
- QG-043-C5 product-manager, D-PM entry before TASK-043 merges: REQ-PLAT-015 note and US-010 notes ("outbox relay fallback"), REQ-PLAT-017 "their queues" and "commit to enqueue", US-011 "in order" ending at the enqueue. D-PM-079 answered it; its EPIC-01 story edits were uncommitted at e52e77d6 (D-QG-003) and are on main since a3d0a02b (D-QG-004).
- QG-043-C6 senior-developer plan fold: F1..F12 on the TASK-043 card; dispatcher host, sequencing, publish rule, handler rules, grammar, alarms on TASK-047/049/078/214 before batch 1.4 dispatch; an owner task for the 24 h `token_enc` housekeeping (none existed).
- QG-043-C7 backend-developer / architect / qa-lead, before TASK-043 merges: lane B two-session advisory-lock test; F3 both arms; gherkin-test-map AT-US-011-03 and the consumer half of AT-US-011-04.

**Why:** G4 requires every earlier condition closed; C2 and C3 gate later dispatches and are easy to lose because they do not block the TASK-043 merge.
**How to apply:** At G3 open the files, not STATUS.md: F3 and the lock test green on PostgreSQL 18, the two-events-in-reverse test on every handler task, the dispatcher's redelivery test, the merge order of TASK-047 before TASK-049, the two alarms and readiness component on TASK-214, `withTenantTx` narrowed to `CORRELATION_ID_PATTERN`. Related: [[qg-041-adr-0016-amendment-12-conditions]], [[g2-conditions-open-for-g3]].
