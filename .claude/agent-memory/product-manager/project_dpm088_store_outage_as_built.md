---
name: dpm088-store-outage-as-built
description: D-PM-088 (2026-11-21) — QG-041-C2 second half checked against TASK-041 part 041-B as built (e7354249); D-PM-074 set and CARRIER_BUSY refusal stand; REQ-SEC-006 shall-statement clause, note, EC-A32, A-053, A-111 amended for precision; service-consumed rule helpers are met by the route task; REQ 1.21, PRD 1.22; next D-PM-089, A-119
metadata:
  type: project
---

D-PM-088 accepted the store-outage wording of D-PM-074 against the build and amended four points. No value, ID or count changed (434 / 91 / 293 / DC 134).

- **Shall-statement of REQ-SEC-006:** "other routes and the route-agnostic per-IP limit fail open" became "the other classes and the two request counters of the route-agnostic per-IP limit (the unauthenticated budget and the credentialed ceiling) fail open". The failed-authentication budget is part of stage one and does NOT fail open.
- **Delivery:** class rules `public-quote`, `public-tracking` and the budget fall back from part 041-B. `quoteCreateRules`, `authAccountRule`, `emailSendRules` are helpers; the consuming service passes `onStoreFailure`. REQ-SEC-006 is met for them by the route task with an outage case through the route: TASK-052, TASK-049, TASK-091.
- **"Unavailable":** one failed, malformed or > 250 ms store call opens one process breaker for 5 s for every rule, the stream caps and the denial budget; per instance.
- **A-053 accepted (b) to (d):** counts not carried between shared and per-instance counters; the failed-authentication refusal can end early at a switch; fail-open classes are unenforced for 5 s per slow call. Trigger: > 30 min/month of `rate_limit_store_unavailable` scope `rate-limit` re-opens "fallback for every class".
- **A-111:** refusal per instance, at least the breaker cool-down; nothing exists before TASK-190; no sandbox credentials or COND-SANDBOX-DEMO run on a build without TASK-190.

**Why:** tests and acceptance are written from these rows; TASK-041 lists REQ-SEC-006 and would have closed `quote-create` on a comment in `policy.ts` (the silent drop of D-PM-078 again).

**How to apply:**
- A gate condition "due before part B merges" can already be worded before the build ([[dpm073-078-ratelimit-us078-us040-split]], D-PM-074). The later job is a comparison with the code as built, not a rewrite. Read the build before deciding that nothing changes.
- For any "class X falls back / is limited" requirement, check whether the rule is a class rule in the pipeline or a helper a service consumes. A helper means the route task owns the proof.
- Held for others: US-040 note sentence (story file), the REQ-SEC-006 traceability row (Task(s) TASK-041, TASK-049, TASK-052, TASK-091), four card lines. All in the entry.
- Open at the time of writing: no code review or security round of part 041-B on main; lane B still running. A change to the set, 250 ms, 5 s or the counters moves the wording again. A rating above LOW for the early end of the refusal reopens A-053 (c).
- Without a shell: `.git/refs/heads/<branch>` gives the head, `.git/worktrees/<name>/gitdir` the worktree path, `logs/HEAD` the commit subjects, `COMMIT_EDITMSG` the last message only. Sibling worktrees (`../Shipqube-TASK-xxx`) are readable. Commit bodies and tree cleanliness cannot be checked: say so in the entry.
- Rows that move together for the outage now also include A-111 and the PRD §11 row. See [[dpm079-080-outbox-order-us011-split]] for D-PM-080 (lock scope).
