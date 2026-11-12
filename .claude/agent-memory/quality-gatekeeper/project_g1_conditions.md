---
name: g1-conditions-open-for-g2
description: G1 attempt 1 (2026-11-12) was PASS_WITH_CONDITIONS; five conditions G1-C1..C5 must be verified closed at G2
metadata:
  type: project
---

G1 attempt 1 verdict on 2026-11-12: PASS_WITH_CONDITIONS (file `docs/sdlc/gates/G1-attempt-1.md`). Open conditions to re-verify at G2:
- G1-C1 product-manager: reconcile REQ vs NFR default values (guest-quote rate limit 20/min vs 60/min; email-send limit 3/h vs 5/h; compose start 180 s vs 10 min; home JS 170 KB vs 200 kB; DR-A22 per-account auth limit).
- G1-C2 product-manager: retag REQ-UI-014 / REQ-AUTH-020 / REQ-UI-018 (M0 REQs delivered only by M1 stories); REQ-PICK-013 vs D-014 drop-off Should.
- G1-C3 product-manager: GAP-B-27 assumption row, 13 ASSUMED-without-GAP rows, 6 assumptions without validation, permission-N/A markers, NFR-MAINT-002 pipe escape.
- G1-C4 principal-architect + qa-lead: NFR section in traceability.md (90 NFR IDs).
- G1-C5 product-manager then senior-developer/qa-lead: "demo-critical" subset tag on Must stories for re-scoping order.

**Why:** G4 checklist requires all earlier PASS_WITH_CONDITIONS items closed, and G2 checklist needs one value per NFR parameter.
**How to apply:** At G2 attempt 1, check each item above against the current files before judging the architecture criteria; do not accept STATUS.md claims without opening the artefacts.
