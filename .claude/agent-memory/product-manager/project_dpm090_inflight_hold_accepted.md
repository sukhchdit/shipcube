---
name: dpm090-inflight-hold-accepted
description: D-PM-090 (2026-11-21) — QG-041B-C3 of D-QG-008: in-flight hold of the failed-authentication budget accepted as a per-instance concurrency bound (429 Retry-After 1 beyond 120 less counted failures, valid credentials included); R-16 second form, A-112, NFR-SEC-005 rows, REQ-SEC-005 note, DR-A22 pointer, BACKLOG M3 obligation; PRD 1.24, REQ 1.23, NFR 1.9, BACKLOG 1.4; what withdraws the acceptance; a second PM run worked on the same condition; next D-PM-091, A-120
metadata:
  type: project
---

D-PM-090 accepted the product consequence of ADR-0016 amendment 13 item 6 as restated (D-ARCH-228..231): on each API instance at most 120 credentialed requests of one address, less its counted failures of the minute, may be between step 0 and their authentication result at once; the excess that arrives together gets 429 `Retry-After: 1`, valid or not. No value, ID or count changed (434 / 91 / 293 / DC 134). The per-credential design stays on file.

**Why:** nobody in Run 1 sends such a burst (browsers do not, no API keys before M3); the refusal is immediate, retryable and loses nothing; the hold is what keeps a parallel forged burst inside the budget D-PM-073 accepted; the alternative puts new state on every credentialed request and part 041-B gates TASK-052 (M0 sign-in).

**How to apply:**
- The acceptance is conditional. It comes back if: security-analyst rates PR041-SEC-11 above LOW (QG-041B-C4); the gatekeeper's closing entry changes item 6; TASK-065 ships without the retry rule as narrowed by D-PM-092 (a `RATE_LIMITED` answer with `Retry-After` 1 is repeated after that second plus up to 1 s random delay, at most three times; a longer wait is shown and repeated by the user; see [[dpm092-rate-limited-client-rule]], which amends item 2 first point and item 3 (b), (c) of D-PM-090); a Run 1 change request adds a client action of more than 20 requests at once; M3 planning (BACKLOG obligation on EPIC-B-303/304).
- Where the applied text is not the architect's offered text: "do not exceed the budget" (offered "stay below"; the 120th of 120 is admitted); NFR row "5 valid bearers in authentication together at a budget of 5 are all answered 200" (the offered valid-credential row passes when everything is refused); "less room" sentence in R-16 and A-112; load runs get no relaxed NFR-PERF pass line (the room is the unauthenticated per-IP value, DR-A22, so raising that limit raises the room); limit cases send credentialed requests in sequence (AT-US-040-03 "authenticated per user", AT-US-040-11).
- Rows that move together for the hold: PRD §9 R-16 + A-112 + NFR-SEC-005 (target, method, pass line) + REQ-SEC-005 note + DR-A22 + US-040 notes + BACKLOG M3 obligation.
- At P6 acceptance: read the TASK-065 retry test; check the NFR in-authentication rows exist as tests (two were held as card lines for senior-developer); ask qa-lead for the `step0-authn-inflight` count of the G3 e2e run.
- An offered "verbatim" text still needs a read against the mechanism: check boundary words (below / at most) and whether each test row can pass on a broken build.
- Concurrency: two orchestrator sessions (B and C) dispatched this condition to two product-manager runs. The other run edited story files in the main checkout mid-run and cited "D-PM-090" there before any entry existed (US-040 note, US-135 note). Before taking an ID, grep `docs/` for the next D-PM number, not only the DECISIONS tail, and re-read the tail just before and after appending. Say in the entry what the ID does not cover. See [[dpm089-us042-split-stream-wording]] for the same rule about the tail.
- Not verified at the time: part 041-B test code (worktree not found without a shell), a real Valkey client or authenticator, requests per page of the unbuilt clients.

Related: [[dpm073-078-ratelimit-us078-us040-split]], [[dpm088-store-outage-as-built]], [[dpm079-080-outbox-order-us011-split]].
