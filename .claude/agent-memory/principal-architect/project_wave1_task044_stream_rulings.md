---
name: wave1-task044-stream-rulings
description: Context behind D-ARCH-217..224 (2026-11-21) — ADR-0016 amendment 14, ADR-0003 rules (m) to (q), ADR-0010 amendment 14, R-ARCH-41 on TASK-044 (SSE convention) — why part 044-B and not the lock holder, why the drain ends streams, the error-id resume gap found on the way, what is still owed, and the lessons
metadata:
  type: project
---

D-ARCH-217..224 answered TASK-044 code review round 1 (R1-M1, R1-m5, R1-m6, D-TASK044-03/-05) and security round 1 (D-SECPR044-01). The rules are in ADR-0016 amendment 14, the ADR-0003 amendment of 2026-11-21 (rules (m) to (q)), ADR-0010 amendment 14, platform.md §10.4, risks.md R-ARCH-41. Change lists, the texts for api-designer and product-manager and the 21 card lines are in `docs/03-architecture/rulings/wave-1-task-044-rulings.md`. This note keeps what those do not say. Related: [[wave1-task040-idempotency-rulings]], [[wave1-task041-ratelimit-rulings]].

**Why the rulings went the way they did:**
- The reviewer offered (a) "the lock holder changes `execute.ts`" or (b) "split the story". I took the split in form and (a) in content, as a second pull request of TASK-044 (part 044-B). The lock holder next in line was TASK-040 part 040-B, which is on the critical path (TASK-049, TASK-062, TASK-092). A stream finding there would hold US-038.
- The 31 s stream deadline is above the 25 s drain bound. That is sound only because the drain ends streams itself, so the slot uses 31 s only when it was given the drain signal. That coupling is my answer to the security record's condition "keep a stream's deadline below the 25 s drain". It meets the purpose, not the letter.
- platform.md §10.4 had said since P3 that streams get a terminal event at SIGTERM. Nobody had built it, and neither review cited it.
- The cache header: security-analyst had ruled an exact allow-list of two values while I was drafting. I ruled the form with no parser (the slot picks its constant by the kind of result). It writes the same two values.
- R1-m5: the access log already writes `http.request` with `aborted: true`. So I did not adopt the extra info line that the reviewer and security-analyst proposed.

**Found on the way (D-ARCH-220):** the module framed `error` with the id "last plus one", and the reader returns the last id as the resume point. A resume after `error` skipped the persisted result with that number. At the 30 s cap this was theoretical. My own drain ruling would have made it routine. Rule: `error` carries no `id`.

**Still owed:**
- security-analyst's concurrence on D-ARCH-218, -219, -221 and -223. It is a dispatch gate of part 044-B. If the drain reading is refused, the alternative is a cap below 25 s, which is a change of REQ-API-018 with product-manager.
- quality-gatekeeper verifies the three amendments; conditions may come back. Amendment 14 item 2 is a merge condition of part 044-A.
- product-manager records the US-042 split and rewords REQ-API-018, AT-US-042-06 and -07.
- Older and still open: QG-051-C5 (the guest-binding seam before TASK-091), the Stripe saved-500 rule before TASK-167.

**How to apply:** a card that mounts a stream operation gets PRECONDITION PART 044-B, STREAM DISCIPLINE (the producer signal goes to its own subscription only) and STREAM SLOT TTL (two transactions, the 31 s stream deadline, 5 s). A web task that reads a stream gets the client resume line. A timer that bounds requests (TASK-108) must stop at the start of a stream.

**Process lessons:**
1. Check which task mounts the operation before accepting a due point. The review and the dispatch both said "before TASK-091"; `task-map.csv` shows the stream routes on TASK-141 and TASK-173.
2. Check a quoted constant against the design document. "The ECS stop timeout is 30 s" came from a code comment; platform.md says 35 s.
3. When a ruling adds a new way for something to end, follow the client's next request. That is how the `error` id gap showed up.
4. A security record can land while I draft (it did, with two rulings on my items). Re-read `git log` and the tail of DECISIONS.md before fixing each ruling.
5. Plain `node:http` probes need no Docker and settle questions about the runtime:
   - an open response holds `server.close()`;
   - one abort signal shared by a stream and the code that waits for it loses the last frame;
   - a connection that was busy at `close()` still serves a new request;
   - `res.writableLength` counts bytes and counts everything written in the same turn.
6. Grep the sibling documents for an old clause before restating it. "Disconnect cancels upstream work" also stood in ADR-0010, in a diagram note of ARCHITECTURE.md and in the T-47 row of the threat model.
7. Card lines go into single-quoted strings of `plan-data.mjs`: no apostrophes and no backticks. Check them with a script before the commit.
