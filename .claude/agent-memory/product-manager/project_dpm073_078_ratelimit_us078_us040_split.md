---
name: dpm073-078-ratelimit-us078-us040-split
description: D-PM-073..078 (2026-11-20) — rate-limiter order and store-outage wording (QG-041-C2), US-078 deleted-organisation reversal (D-ARCH-180), M2 backlog obligations, REQ-SEC-012 cite, US-040 delivery split (completer TASK-141, partial at R0); versions REQ 1.14, NFR 1.8, PRD 1.15, traceability 1.9, BACKLOG 1.2; A-111..A-114; rows that move together; next D-PM-079 / A-115
metadata:
  type: project
---

Six entries in one run. Counts unchanged 434 / 91 / 293 / DC 134. Next IDs: D-PM-079, A-115, PRD risk R-17.

- **D-PM-073 (QG-041-C2 first half).** Order accepted as ruled: a route-agnostic per-IP limit before routing and authentication (120/min without a credential header; ceiling 10 × authenticated = 6,000/min under `/api/v1` with one; failed-authentication budget 120/min from TASK-041 part 041-B), class limits after authorisation. "The per-IP limit of the route's class before authentication" is withdrawn everywhere. AT-US-040-06 and -10 confirmed as written (titles are map keys).
- **D-PM-074 (second half).** Fallback set = `auth`, `email-send`, `public-quote`, `public-tracking`, `quote-create` + failed-authentication budget; the rest fails open. Carrier admission controls refuse (`CARRIER_BUSY`), never per-instance (ADR-0010 am. 13). AT-US-293-15 steps replaced; its title still says "falls back to per-instance counting" (retitle recommended to qa-lead).
- **D-PM-075.** US-078 in the architect's exact wording; scenario 4 reversed: a job of a soft-deleted organisation completes in its own context (was: fails with audit `FAILED`). Closes the PM half of the TASK-047 dispatch gate.
- **D-PM-076.** `BACKLOG.md` subsection "Obligations Run 1 hands to M2 planning" (a table, no IDs, no story): organisation-closure pending work (EPIC-B-203); engine derives or verifies volumetric weight when a rate card prices by billable weight (EPIC-B-205).
- **D-PM-077.** REQ-SEC-012 "ADR-0013 am. 1". The same hunk in `.orch/held/api-designer-readme-fixes.patch` no longer applies.
- **D-PM-078.** US-040 (M0 Must, non-DC, 17 scenarios) split: TASK-041 route-level -01, -02, -03 rows 1/3/4, -05..-12, -17; TASK-052 -03 row 2 (+ repeats -06 on the real login); TASK-049 -13, -14; TASK-091 -04 and -03 row 5; TASK-141 -15, -16 and completes. Partial at `v0.1.0-m0` (110 of 113 M0 Must complete; US-040, US-061, US-062 partial). Needs a `waveExceptions` entry (through 4) — senior-developer's.

**Why:** the limiter is mounted before routing, so it cannot know a route's class; a per-instance carrier budget multiplies the quota exposure by the replica count; a refused job of a deleted organisation strands money and cannot be redriven; "completes US-040" on TASK-041 would have counted Must scenarios as covered on rule-helper tests.

**How to apply:**
- Rows that move together for the limiter: REQ-SEC-005 + DR-A08 + DR-A22 + NFR-SEC-005 + A-035 + US-040 notes (D-035: one set of values). For the outage: REQ-SEC-006 + EC-A32 + A-053 + REQ-CARR-022 + REQ-CARR-023 + DR-B32 + US-293 (notes, AT-15) + US-040 notes.
- PR041-SEC-09 was ruled as the product position asked (D-ARCH-182) and marked final by D-PM-080 ([[dpm079-080-outbox-order-us011-split]]). Still able to move the wording: R-ARCH-36 (a) rated above LOW at TASK-055 reopens the order itself; one post-launch event hitting more than one user of an address reopens the lock design.
- A routing that names N rows undercounts again: the architect named REQ-SEC-006, A-053, EC-A32; AT-US-293-15, two REQ-CARR notes and DR-B32 contradicted them. Grep the stories for the withdrawn behaviour, not only for the IDs.
- Read the tail of DECISIONS.md again just before writing an entry: D-ARCH-181 and D-SECPR041-02 landed mid-run and changed one decision item (the lock scope).
- Delivery split checks that mattered here: split an outline scenario by Examples row when the review found rows on helper tests; assign by what the scenario's steps name, not by the class name (AT-US-040-13 is all registrations → TASK-049, not the verification task); look for a duplicate scenario in the story that owns the route (AT-US-135-11/-12 = AT-US-040-15/-16, so the completer only adds IDs); check the wave band in `gen.mjs` (M0 Must non-DC completes in waves 0..3) and say that an exception is needed; check the completer's `d:` for the partial owner (TASK-141 has no visible edge to TASK-041).
- At P6 acceptance of US-040: for each owned scenario, the passing test must be in the owner task's route-level suite; `ac-trace.json` pools IDs from titles and the TASK-041 helper tests keep their IDs (A-114).
- Seen, not decided: TASK-076 code review R1-n8 (imperial dimensions rounded to whole mm before the volumetric step) is addressed to PM/architect; default "accept per DR-B06" stated in D-PM-076, not logged as an assumption.
- Three story files were edited (EPIC-03, EPIC-06, EPIC-16): lane-B tooling inputs, the orchestrator times the commit ([[dpm068-us061-062-delivery-split]]).

Related: [[dpm072-job-payload-v2-wording]], [[d062-us008-delivery-split]], [[d065-gherkin-append-only]], [[g2c3-requirement-closure]].
