---
name: dpm087-us080-delivery-split
description: D-PM-087 (2026-11-21) — QG-051-C3 of D-QG-005: US-080 (M0 Must DC) partial on TASK-051 (database halves) and TASK-091 (getQuote halves), completed by TASK-146 (claim halves, Wave 5); fourth story partial at v0.1.0-m0 (109/113 Must, 71/74 DC at Wave 2 exit); "account" in AT-US-080-05 = another organisation; PRD 1.21, REQ 1.20, A-118; story notes and traceability row held; next D-PM-088 / A-119
metadata:
  type: project
---

D-PM-087: fifth use of the delivery-split pattern and the first split by *layer* (database half / HTTP half of the same scenario, D-ARCH-213) instead of by scenario. US-080 keeps M0 Must DC. TASK-051 = database halves of AT-US-080-01..07 on `gc_` probe tables, completes only AT-03 (a database property). TASK-091 (Wave 2) = AT-01/-02 through `getQuote`. TASK-146 (Wave 5, completes US-166) = AT-04..07 at `claimQuote`, completes US-080. A scenario is accepted only with both halves passing.

**Why:** AT-05/-06 state 409/401, which a database cannot answer (it answers 0 rows and `42501`), and the audit entry of AT-07 is written by the service. The claim needs pipeline-seam case (c) (header-derived hash in a signed-in caller's context, undesigned, QG-051-C5), so pulling it into M0 would put that ruling on the R0 path for an operation the M0 demo never calls. R0 mounts none of `claimQuote`, `createShipment`, `saveQuote` (A-118).

**How to apply:**
- "What keeps a split story inside M0" has four parts worth stating each time: tags unchanged; the demo-critical part is work the M0 demo depends on (name the dependency chain to TASK-121); a checkpoint at a wave exit; proof that the open part cannot be exercised in R0, plus the trigger if a task mounts it early.
- A DC M0 story may be partial at R0 only when its §6.1 part lands inside Waves 0-2. `waveExceptions` needs `dcBy` tasks that hold the story in `part` inside the band (here `guestclaim`, `guestquote`, `through:5`).
- Look for the duplicate scenarios in the story that owns the route (US-166 scenarios 1-3, 6, 8 = AT-US-080-04..07), so the completer adds IDs, not tests. Then check the wording against that story and the contract: "account X / account Y" in US-080 and the REQ-RLS-013 note read as different accounts, but REQ-QUOTE-016, the contract (200) and AT-US-166-04 are organisation-level. Resolved as a note, no step change.
- When the orchestrator gives an edit allow-list (here REQUIREMENTS, PRD, ASSUMPTIONS; stories and `docs/04-plan/**` excluded), hold everything else as text inside the DECISIONS entry. The REQ-RLS-013 traceability row was held for that reason and because senior-developer's fold (QG-051-C2) was open on the same file. `docs/sdlc/traceability.md` is not a lane-B tooling input (`required-suites.json` lists stories and api only).
- The PR worktree is `../Shipqube-TASK-<nnn>`; its test titles already said "(database half)", which settled the halves quickly.
- D-PM-068's "Numbering" line carries a running "The next entry is D-PM-xxx" pointer; update it with each entry.
- R0 arithmetic after this entry: 109 of 113 M0 Must complete (US-040, US-061, US-062, US-080 partial); 71 of 74 M0 DC complete at the Wave 2 exit. US-038 may not be partial at R0 (D-PM-083).

Related: [[dpm068-us061-062-delivery-split]], [[dpm073-078-ratelimit-us078-us040-split]], [[dpm081-082-idempotency-audit-us038-split]], [[d062-us008-delivery-split]], [[g1-closure-and-dc-tag]].
