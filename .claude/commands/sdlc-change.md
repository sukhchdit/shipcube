---
description: Submit a change request / new feature into a running or completed SDLC
argument-hint: <description of change>
---
Change request: $ARGUMENTS

1. product-manager: impact analysis and accept/defer/reject decision (logged). Include principal-architect if ADRs, contracts or the data model are affected.
2. If accepted: update requirements and design, re-run G1/G2 checks for the changed scope via quality-gatekeeper, have senior-developer plan a new wave, and run P5 → P6 → G3 → P7 → G4 for it.
