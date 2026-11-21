---
name: dpm089-us042-split-stream-wording
description: D-PM-089 (2026-11-21) — QG-044-C2 of D-QG-007: US-042 split over TASK-044 parts 044-A/044-B, not partial at v0.1.0-m0, Wave 2 exit not held; REQ-API-018 releases the stream's own work (no carrier call cancelled); AT-US-042-06 retitled with three steps; AT-US-135-13 appended; AT-US-042-07 = bearer-only 401; REQ-API-017 id except `error`; REQ-SEC-015 timer until the response starts; REQ 1.22, PRD 1.23, A-119; next D-PM-090, A-120
metadata:
  type: project
---

D-PM-089 decided rulings §7 items 1 to 7 of `docs/03-architecture/rulings/wave-1-task-044-rulings.md` (D-ARCH-217..224) plus the gatekeeper's REQ-SEC-015 reading. Sixth use of the delivery-split pattern, second in the "two parts of one task" form (D-PM-082).

- **Split.** Part 044-A (fixture streams, test composition) proves AT-US-042-02, -03, -04, -06, -07, -08 and the module half of -01 and -05. Part 044-B (tx slot, default pipeline) completes -01 (`private, no-cache, no-store` for a caller who is not anonymous) and -05 (cap at 30 s, no deadline override). No stream is mounted before 044-B (TASK-141, TASK-173 preconditions).
- **R0.** US-042 may NOT be partial at `v0.1.0-m0` (joins US-038). R0 stays 109/113. The Wave 2 exit is not held: the exit text states whether 044-B is on main; 71/74 DC if yes, 70/74 with US-042 named if no.
- **Wording.** REQ-API-018: "release the stream's own work (its subscription and timers) within 1 s"; the stream slot is deliberately not named there (it is REQ-CARR-009 / REQ-SEC-005, built by the stream routes). REQ-API-017 shall-statement: id "on every event except the stream-level `error` event". REQ-SEC-015 parenthesis: "(an event stream that has started is bounded by REQ-API-018 instead)". REQ-PLAT-022 note: a stream open at SIGTERM is ended with `error` within 1 s.
- **Deviations from the architect's proposed text, both deliberate.** AT-US-042-06 has three steps, not four: "work that the stream did not start is not cancelled" cannot be shown on a fixture. It became appended scenario AT-US-135-13 "Closing a stream does not cancel carrier calls" (owner TASK-141). AT-US-042-07 is the `[session]` case only (401); the 404 of a `[session, quote-token]` stream is AT-US-135-06, whose When-step gains "no bearer token and no quote token".

**Why:** a step must be provable by the task that owns the scenario. A fourth step on a fixture would be an assertion no mutant can fail, and a 404 half in AT-US-042-07 would keep an M0 story open until TASK-141 (no guest-token authenticator before TASK-091, no such stream before TASK-141). Not partial at R0 because part 044-B waits for no M1 route and changes the pipeline R0 ships (disconnect during a `call`, the drain signal).

**How to apply:**
- Before adopting proposed Gherkin, read the test as built in the task worktree (`../Shipqube-TASK-044/tests/api/event-stream.api.test.ts`). Test titles there carry the AT ID, not the scenario title, so a retitle renames no test.
- "May a split story be partial at R0?" turns on whether the completer waits for M1 work. If it does not, hold it to the tag and say whether the Wave 2 exit is held (only when Waves 0 to 2 need it, as for US-038).
- DECISIONS.md is appended by other agents while I work: re-read the tail before appending and after.
- Held for others, all in the entry: US-042, US-135 and US-045 story text; map rows (AT-US-042-06 title, AT-US-042-07 suite `api`, new AT-US-135-13); traceability rows of REQ-API-017/018; four fold lines (TASK-044, TASK-141, TASK-108, wave texts).
- Comes back to me if: security-analyst refuses D-ARCH-219 (QG-044-C3, the cap changes); part 044-B is the last item holding the tag; QG-044-C7 rules `carrier_error` without an id (REQ-CARR-009 and US-135 notes say "each event").
- Rows that move together for streams: REQ-API-017 + REQ-API-018 + REQ-SEC-015 + REQ-PLAT-022 note + US-042 / US-135 / US-045 notes + A-119 + PRD §7 paragraph.

Related: [[dpm081-082-idempotency-audit-us038-split]], [[dpm087-us080-delivery-split]], [[dpm073-078-ratelimit-us078-us040-split]], [[d065-gherkin-append-only]], [[dpm071-acceptance-created-by]].
