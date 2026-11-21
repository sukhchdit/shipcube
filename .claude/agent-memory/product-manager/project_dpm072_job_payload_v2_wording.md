---
name: dpm072-job-payload-v2-wording
description: D-PM-072 (2026-11-19, PR64-SEC-10) — requirement text moved from job payload v1 to v2 (identifiers only, tenant context from platform.job_context); REQ-PLAT-014, REQ-RLS-008, DR-A25, EC-A38, US-010 AT-03/04; REQUIREMENTS 1.13, PRD 1.14; US-078 rewording still owed before TASK-047; rows that move together
metadata:
  type: project
---

D-PM-072: job payloads are v2 everywhere in the requirement text. A payload carries `v`, `kind`, `id`, `correlation_id`, `trace_context` and never `org_id`, `actor_id` or business data; the worker resolves tenant context from PostgreSQL (`platform.job_context(kind, id)`); the deterministic job ID (`<kind>.<id>[.<step>]`) is the idempotency key, there is no idempotency-key field. Edits: REQ-PLAT-014 and REQ-RLS-008 (shall-statements and notes), DR-A25 (also job-ID form, occurrence rule for recurring keys, retention bounds 24 h/10,000, 7 d/1,000, 14 d/2,000), EC-A38 (reasons `JOB_CONTEXT_NOT_FOUND`, `MISSING_TENANT_CONTEXT`, `PAYLOAD_INVALID`), US-010 Notes and two Given-steps: AT-US-010-03 "missing correlation_id", AT-US-010-04 "lacks kind or id, or carries org_id or actor_id". Titles, order, count (7) unchanged. REQUIREMENTS 1.13, PRD 1.14; counts 434 / 91 / 293 / DC 134; traceability (1.8) untouched. Next IDs: D-PM-073, A-111.

**Why:** payload v1 was never implemented (ADR-0013 amendment 1, SEC-P3-12); TASK-035 refuses a v1 payload at dequeue. TASK-039 is specified from US-010 and REQ-PLAT-014, so two scenarios and a shall-statement asked for fields the schema refuses. The routing named only DR-A25, EC-A38 and the US-010 Notes; the two REQ rows they cite stated v1 in their shall-statements, so they moved too.

**How to apply:**
- Rows that move together from now on: REQ-PLAT-014 + REQ-RLS-008 + DR-A25 + EC-A38 + US-010 Notes + US-078. DR-A25 repeats the ADR-0013 retention constants, so an amendment of them is also a DR-A25 edit.
- **US-078 was reworded by D-PM-075 (2026-11-20)** after D-ARCH-180; nothing is owed any more. See [[dpm073-078-ratelimit-us078-us040-split]]. Titles kept (map keys).
- When rewording a scenario after an architecture change, check which task can prove it at its batch. `platform.job_context` and the worker tenant transaction arrive with TASK-047 (batch 1.4); TASK-039 (batch 1.2) has only TASK-035. AT-US-010-04 was therefore worded as the dequeue refusal, and the resolution half left with US-078.
- Pre-agreed default, not yet triggered: if TASK-039 can prove AT-US-010-01 (M0 mock-booking job) or AT-US-010-07 (tenant-scoped access) only with a stand-in, split US-010 in the [[d062-us008-delivery-split]] form (TASK-047 owns AT-US-010-07) instead of accepting the stand-in.
- A finding that names N rows undercounts: grep REQUIREMENTS.md for the withdrawn fact, shall-statements included (same lesson as [[dpm071-acceptance-created-by]]).
- This agent had no shell in that run: the consistency script and the gherkin drift test were not run. Say so in the handoff rather than quoting counts as measured.
- Seen, not mine: `api/README.md` §13 gives the `job_context_mismatch` reason as `PAYLOAD_TENANT_FIELD`, the code logs `PAYLOAD_INVALID`; api/README cites "ADR-0013 am. 2" for what is amendment 1 (api-designer's held patch); the REQ-SEC-012 cite was fixed by D-PM-077.

Related: [[d065-gherkin-append-only]], [[d063-allow-parity-wording]], [[dpm068-us061-062-delivery-split]].
