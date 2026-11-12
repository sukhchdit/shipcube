---
name: g2-conditions-open-for-g3
description: G2 attempt 1 (2026-11-12) PASS_WITH_CONDITIONS; G1-C1..C5 verified closed (C4 Design at 90/91); five G2 conditions due P4 exit / P5 start must be re-verified at G3
metadata:
  type: project
---

G1-C1/C2/C3/C5 verified closed at G2 (D-035/036/037, A-078, DC=134). G1-C4 Design column closed except NFR-RES-007 (now G2-C1); Test column carried as G2-C5.

G2 attempt 1 verdict 2026-11-12 (`docs/sdlc/gates/G2-attempt-1.md`, judged at commit f530ca1): PASS_WITH_CONDITIONS. Open conditions to re-verify at G3:
- G2-C1 principal-architect: NFR-RES-007 row in nfr-traceability.md + nfr-strategy.md; totals 90 → 91.
- G2-C2 principal-architect: traceability.md REQ Design column (was 0/434 filled); ARCHITECTURE.md §6 add REQ-AUTH-025/026, CARR-022/023, count 434; Redis 7 → Valkey 8 labels; R-ARCH-10 closed.
- G2-C3 architect/data-architect/api-designer/PM/security-analyst: SEC-COND-05/06/07 (SEC-P3-27/28/29) design closed by P4 exit; SEC-P3-30/33 doc drift incl. REQ-AUTH-018 vs ADR-0006 am. 14; SEC-TC evidence at G3; SEC-COND-03 item 7 (locked audit-anchor sink) is a G4-production precondition.
- G2-C4 ux-designer: UX README relabel S-C07/S-D08 Must (US-027), classify US-291/292/293, admin 28-min idle dialog, CVC note.
- G2-C5 qa-lead: nfr-traceability.md Test column for 91 NFRs before P5 start.

**Why:** G3 checklist needs every NFR to have a test and every Must AC a passing test; G4 requires all earlier PASS_WITH_CONDITIONS items closed.
**How to apply:** At G3, open the files (not STATUS.md) for each item; also compare lane-B evidence `summary.json` SHAs with the gate SHA (R-ARCH-16).
