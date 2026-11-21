---
name: wave1-task041-ratelimit-rulings
description: TASK-041 rate limiter rulings D-ARCH-173..182 and 225..231 (ADR-0016 am. 12 and 13 incl. item 6 in-flight hold as a concurrency bound, release contract and change C-4 / R-ARCH-36 (d), ADR-0010 am. 13) — two-part delivery, what is still owed, and the lessons from ruling it
metadata:
  type: project
---

Ruled 2026-11-20 (commit `a9a48017`) on code review C1 and security record D-SECPR041-01 of TASK-041. Details: `docs/03-architecture/rulings/wave-1-task-041-rulings.md`.

- **D-ARCH-173** own fixed-window engine accepted; `rate-limit-redis` removed in the PR; `express-rate-limit` kept only for `ipKeyGenerator`.
- **D-ARCH-174** step 0 is route-agnostic (amendment 1's "class as declared per route" withdrawn); credentialed ceiling only under `/api/v1` and never `OPTIONS`; `rate_limit_auth` once per key and window.
- **D-ARCH-175** per-IP failed-authentication budget (`rl:step0:authn-failed`), read in the step-0 script, recorded by a wrapper around the authentication slot; `ACCESS_TOKEN_EXPIRED` exempt (exp checked before signature).
- **D-ARCH-176** class rules stay at pipeline step 5 for every class; a pre-auth class stage (literal DR-A08) was considered and not adopted; residual R-ARCH-36 (valid refresh cookie lookups before the `public` limit).
- **D-ARCH-177** store breaker required, shared by limiter and denial budget.
- **D-ARCH-178** carrier admission controls refuse on store failure (owner TASK-190); `public-quote`, `public-tracking`, `quote-create` join the per-instance fallback set.
- **D-ARCH-179** `TRUST_PROXY_HOPS` default 0, required and at least 1 in staging/production; `CloudFront-Viewer-Address` not read.

**Why:** the path-less step 0 (D-ARCH-084) cannot know the route, and NAT fairness needs a ceiling chosen by header presence; the budget and the route rule bound what presence buys.

**How to apply:**
- TASK-041 ships as **part 041-A** (merge gate of TASK-049) and **part 041-B** (budget, breaker, signature headers, fallback set), which must be merged **before TASK-052 is dispatched**. If asked about TASK-052/055/091/171/261, check that their cards carry the authenticator cost rules (rulings file section 6).
- Still owed by others: product-manager wording of DR-A08 / DR-A22 / REQ-SEC-005 / NFR-SEC-005 / REQ-SEC-006 / A-053; api/README §7 text rides the TASK-041 PRs (never edit it on main); TASK-215 Terraform pin; deploy smoke check with the first real target.
- Reopen the pre-auth class stage if security-analyst rates R-ARCH-36 (a) above LOW at TASK-055.

**Follow-up D-ARCH-181 (`00c4efdb`, gatekeeper condition QG-041-C3 of D-QG-001):** the engine is a deviation from brief §3.2 ("`express-rate-limit` with a Redis store", a SHOULD) under the CLAUDE.md §2 fixed-stack rule; recorded with the user's acceptance of 2026-11-20 *as the orchestrator reported it* (I saw no orchestrator entry holding it). Also corrected: the failed-auth budget is wider than the `auth` class (stops every credentialed request of an IP); "only carrier is the Mock before TASK-190" was wrong (fixture adapters land in 4.4/4.5).

**Follow-up D-ARCH-182 (`7ce982d8`, security PR041-SEC-09, ADR-0016 am. 13):** the refresh cookie selects the credentialed rule and the lock only on the three `refresh-cookie` routes (path set derived by `createApp`); the lock stays for every credentialed request with its true scope recorded (security-analyst and product-manager both chose it; PRD R-16); E1..E5 bind the `exp` pre-check; 429 must never sign a client out (TASK-065). Reopen trigger: one event hitting more than one user of an address; narrower designs ready (lock only the cookie; dedicated step-0 rule for the cookie routes). The user's engine acceptance is D-ORCH-140.

**Follow-up D-ARCH-225..227 (2026-11-21, ADR-0016 am. 13 item 6, rulings file section 9, risks 1.31; part 041-B code review R1-M1, D-TASK041-18):** the per-instance in-flight hold (`settled + held < limit` at step 0) is accepted; R-ARCH-36 (d) = bound `N × limit` across instances (3..12 API tasks) plus the cost that valid credentials get 429 `Retry-After: 1` while the hold is full (same requests as the lock of item 2; reachable without a refused credential by slow bodies, since the JSON body parser sits between step 0 and the authentication slot). Two merge conditions of part 041-B, found by my probe and independently by code review round 2 (`86cdef9a`: R2-M1, R2-n1), which landed mid-task: (C-1) the fix head `83a85739` released the unit at every response close, so clients that disconnect after admission bring the burst back (limit 5, 60 entries); a close may release only while the slot has not been entered; I took the review's option (a) (fix) and declined (b) (record an abort bound); (C-2) the hold refusal needs its own counter label `step0-authn-inflight` (it shared `step0-authn-failed` and logs no event), ruled into fix cycle 2 although the review routed it to TASK-214. Owed by others: fix cycle 2 with tests H1..H6, security rating of (d) in D-SECPR041B-01 (none existed when I ruled), gatekeeper verification of item 6 (merge condition), product-manager sentence in PRD R-16 / A-112, fold of card lines 15..19 (TASK-041, -052, -055, -108, -214, -065). Reopen triggers and the two designs on file (store reservation; admission at the authentication slot) are in item 6.

**Lessons:**
- A bound a developer reports ("slack 0") is a claim. For a hold or a reservation, list every release path and ask of each: is the work it guards still running? The close-of-response "safety net" released while the authentication ran.
- A clean worktree with a current `dist` can be probed read-only without Jest or Docker: a scratchpad `.mjs` that takes express through `createRequire(<worktree>/apps/api/package.json)` and imports the compiled modules (and `packages/shared/dist/index.js` for `AppError`) by `pathToFileURL`; raw `net` sockets give the disconnect and slow-body shapes. Check `git status` clean and dist newer than src first.
- Run `git log` once more right before the commit, not only before writing: a parallel review of the same head landed while I wrote and offered two closures. Say which option the ruling takes and where it differs from the review's routing, so the orchestrator does not have to reconcile two records.
- For an accepted cost of a concurrency hold, compute when honest traffic reaches it (arrival ceiling × hold time) and read what runs between the hold and its release; then check which counter label and event the new refusal path really produces, because the residual's trigger depends on that signal.
- `__Host-rt_web` is `Path=/` on the app's host: any rule keyed on "a credential is present" catches every returning browser, sign-in included. Check passive credentials before writing "requests without a credential still pass".
- When a ruling is a trade between a security bound and user-visible availability, read the latest D-PM and D-SEC entries first: here both owners had already taken a position (and committed requirement text) while I was still weighing alternatives. Rule with them unless the architecture forbids it, and record my own estimate plus the reopen trigger.
- Before accepting a library deviation, grep `shipping-platform-brief.md` §3 for the library: a §3.2 item is a SHOULD that needs an ADR, and the fixed-stack rule is the user's, so the entry must name both and the orchestrator must put it to the user.
- A user approval relayed by another agent is recorded with its provenance, never as something I verified.
- When comparing a new control with an existing one ("already true of X"), check the scopes are the same; the gatekeeper caught an understated comparison.
- The coordinator can add scope mid-task (the security record arrived after the code review); re-read `git log` and DECISIONS for new records before writing, and re-check the next free D-ARCH number (168..172 were taken while I read).
- Do not copy a factual claim from another agent's record into an ADR without opening the source: "DHL shared origin" was cited as a carrier penalty and is not one.
- Requirements (DR-A08 etc.) can restate an ADR clause; when an implementation deviates, grep the requirement files too and route the wording to product-manager.
- Guarded DECISIONS append worked under concurrent commits: check the file has no uncommitted diff, append from a scratch file, `git commit -- <paths>`, then verify numstat is insert-only.
