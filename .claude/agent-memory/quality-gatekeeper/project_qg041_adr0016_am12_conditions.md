---
name: qg-041-adr-0016-amendment-12-conditions
description: D-QG-001 (2026-11-20) verified ADR-0016 amendment 12 / ADR-0010 amendment 13 for TASK-041 C1 with conditions QG-041-C1..C4; what to re-verify at the 041-A merge and at G3
metadata:
  type: project
---

D-QG-001 (commit 940bff28, 2026-11-20) = VERIFIED_WITH_CONDITIONS for the rate-limiter amendment (own fixed-window engine instead of express-rate-limit + rate-limit-redis; route-agnostic step 0; class rules at step 5; TRUST_PROXY_HOPS default 0). First entry of the D-QG series; next free id is D-QG-002. ADR verifications under CLAUDE.md §5 are recorded as a D-QG entry only (no file under docs/sdlc/gates or docs/05-quality).

Open conditions:
- QG-041-C1 senior-developer / api-designer: api/README §7 text (rulings §5.1), `rate-limit-redis` removed, default 0 + boot guard at the 041-A PR head; §5.2 with part 041-B.
- QG-041-C2 product-manager: D-PM entry on REQ-SEC-005 (Must) / DR-A08 / DR-A22 / NFR-SEC-005 "per-IP class limit before authentication" before 041-A merges; REQ-SEC-006 / A-053 / EC-A32 before 041-B merges.
- QG-041-C3 principal-architect: explicit note against brief §3.2 + CLAUDE.md §2 fixed-stack rule (user-visible deviation); platform.md lines naming `rate-limit-redis` for `valkey-compat`; amendment 1 pointer item 9.
- QG-041-C4 security-analyst: concurrence on rules added after their record (exp read before signature, expired token spends nothing, IP lock-out at 120 bad credentials/min); threat model R-13/T-11/T-39/T-93 before G3.

**Why:** G4 requires every earlier condition closed, and G3 must see part 041-B merged before TASK-052 was dispatched (plan DISPATCH GATE line, D-SD-004).
**How to apply:** At G3 open the files, not STATUS.md: PR order of 041-B vs TASK-052, tests A3/A4/B1(1)-(8)/B3 of `docs/03-architecture/rulings/wave-1-task-041-rulings.md`, NFR-SEC-005 2-replica run, TASK-190 outage tests + SEC-TC-41 row, TASK-215 Terraform pin, R-ARCH-36 (a) rating at TASK-055. Related: [[g2-conditions-open-for-g3]].
