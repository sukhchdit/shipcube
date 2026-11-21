---
name: dpm092-rate-limited-client-rule
description: D-PM-092 (2026-11-21) — QG-041B-C7 (a) of D-QG-009: RATE_LIMITED client rule as narrowed by D-ARCH-233 confirmed (auto-repeat only at Retry-After 1, at most three times; longer wait shown and repeated by the user); D-PM-090 item 2 first point and item 3 (b), (c) amended in the new entry; P1 to P7 accepted, four with one addition; R-16 mitigation cell, A-112; PRD 1.26; uncommitted (no shell); next D-PM-093, A-120
metadata:
  type: project
---

D-PM-092 confirmed the narrowed client rule and kept the acceptance of [[dpm090-inflight-hold-accepted]]: the web and admin clients repeat a `RATE_LIMITED` answer by themselves only when `Retry-After` is 1 (1 s plus up to 1 s random, at most three times, about six seconds of loading state at worst); a longer or missing `Retry-After` is shown with the retry time and the user repeats. No value, ID, scenario or count changed (434 / 91 / 293 / DC 134; 1,612 map rows).

**Why:** every refusal by the in-flight bound carries `Retry-After: 1`, so the narrowed rule still turns it into a delay. The wider rule of D-ARCH-229 ("repeat every 429 after Retry-After") would have held a sign-in or tracking lookup through windows of a minute to an hour behind a loading state, against US-031, US-167 and US-248. D-PM-090 item 3 (c) accepted that wording without reading it against those stories; the gatekeeper found it (D-QG-009 finding 1).

**How to apply:**
- DECISIONS.md is append-only: a later entry amends an earlier one by quoting "was" and "now reads", and says the earlier entry is not edited. The only in-place edit is the "next entry" pointer in D-PM-068 (now D-PM-093).
- Where the applied text goes beyond the architect's offered text: P1 and P5 gain the sentence on what a fourth refusal shows (the rate-limited state with a retry time of one second, D-UX-037); P3 and P6 name three TASK-065 tests, not two (the repeat, the longer wait, four refusals in a row give four sends and then `RATE_LIMITED` to the caller). P2 and P4 are verbatim. P7 applied: "about 360 across the three instances" is gone from A-112.
- Check an offered validation row against a build that never stops: two tests that pass on an unbounded retry do not prove "at most three".
- When accepting a client or UI rule, read it against the story steps that show a message or a state (search the stories for the problem code) before accepting.
- At P6 acceptance: read the three TASK-065 tests; a test of a rate-limited screen state must serve `Retry-After` above 1, or the client absorbs the refusal (TEST-STRATEGY §10.4 rule 2).
- The acceptance comes back on: PR041-SEC-11 above LOW; a gatekeeper verification that changes item 6 again; TASK-065 without the narrowed rule or its bound of three; a change of the number of repeats; a Run 1 client action of more than 20 requests at once; M3 planning.
- A product authenticator in the callback form (D-ARCH-234) is a defect for the unit row of card line 21, not an accepted risk.
- Rows that move together for the client rule: PRD §9 R-16 mitigation cell + A-112 statement, validation and source. NFR-SEC-005, the REQ-SEC-005 note, the US-040 notes and BACKLOG do not state the client rule.
- Not committed by this run (no shell): `docs/sdlc/DECISIONS.md`, `docs/01-requirements/PRD.md`, `docs/01-requirements/ASSUMPTIONS.md`.

Related: [[dpm090-inflight-hold-accepted]], [[dpm091-held-story-landing]], [[dpm073-078-ratelimit-us078-us040-split]].
