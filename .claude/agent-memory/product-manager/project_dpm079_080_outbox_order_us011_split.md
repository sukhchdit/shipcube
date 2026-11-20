---
name: dpm079-080-outbox-order-us011-split
description: D-PM-079/080 (2026-11-20) — outbox relay wording for QG-043-C5 (no relay fallback, one event queue, latency = insert to accepted enqueue, order ends at the enqueue confirmed), US-011 split (TASK-043 partial, dispatcher task completes), PR041-SEC-09 scope final; REQ 1.15, PRD 1.16, traceability 1.11, BACKLOG 1.3; A-115; next D-PM-081 / A-116
metadata:
  type: project
---

- **D-PM-079 (QG-043-C5, QG-043-C7 (c) of D-QG-002).**
  - "The outbox relay fallback" withdrawn from the REQ-PLAT-015 note and the US-010 notes (the relay is a loop in every worker with two gauges and alarms).
  - REQ-PLAT-017: "to their queues" → "to the event queue" (`outbox-relay`, consumer dispatches by type).
  - Latency metric accepted as insert → accepted enqueue, an upper bound of commit-to-enqueue; the step of AT-US-011-06 was reworded (title kept).
  - **Order confirmed as ending at the enqueue**; R-ARCH-37 not reopened; A-115. US-011 I-want now "published to the event queue at least once, in creation order per aggregate".
  - **US-011 split (M0 Must DC, 6 scenarios):** TASK-043 owns -01, -02, -03, -05, -06 and the relay half of -04; the dispatcher task (TASK-047 as proposed by D-ARCH-184; follows the dispatcher if hosted elsewhere, host must be Waves 0..2) owns the consumer half of -04 and completes. Complete at R0, PRD §7 unchanged.
  - BACKLOG 1.3: "Obligations Run 1 hands to M3 planning" — EPIC-B-305 outbound webhooks state their ordering contract.
- **D-PM-080.** Scope of the failed-authentication refusal final per D-ARCH-182 (refresh cookie counts only on csrf/refresh/logout routes); A-112, REQ-SEC-005 note, PRD R-16 updated. The open point noted in [[dpm073-078-ratelimit-us078-us040-split]] is closed.

**Why:** no Run 1 consumer derives state from event order (saga steps re-read state per ADR-0014, one notification per event, tracking ordered by event time, audit written in the business transaction), so requiring order through processing would buy a dispatcher serialisation nothing uses. The duplicate of AT-US-011-04 is absorbed on the TASK-043 branch by the BullMQ job id, which is not the "consumer discards by event ID" the step and REQ-PLAT-017 name.

**How to apply:**
- Rows that move together for the outbox: REQ-PLAT-015 note + REQ-PLAT-017 + US-010 notes + US-011 (I-want, notes, AT-06 step) + traceability REQ-PLAT-017 row. REQ-PLAT-016 stays wholly TASK-043.
- Before confirming "the Must is met by a weaker guarantee", list every consumer of the guarantee in the run and say why each is indifferent; then name the first later consumer that is not (here partner webhooks, M3) and put it in the backlog.
- A-115 trigger: a story whose AC needs events of one aggregate handled in order is not accepted into a wave before the architect delivers the per-aggregate serialisation (ADR-0004 am. 2 item 15).
- A test consumer inside the producing task is a stand-in; a test handler registered with the real dispatcher is acceptable proof.
- The previous handback's files had already been committed when the next coordinator message arrived (traceability was at 1.10 from D-SD-005): re-read version headers before bumping.
- EPIC-01 story file edited (lane-B tooling input): tell the orchestrator.

Related: [[d062-us008-delivery-split]], [[dpm072-job-payload-v2-wording]], [[dpm068-us061-062-delivery-split]].
