# PR-pending: TASK-041 part 041-B (failed-authentication budget, in-flight hold, store breaker, fallback set), security review

**File name.** Part 041-B is built stacked on PR #82 (D-ORCH-150) and gets its own pull request only after #82 merges. Once that PR exists, the orchestrator renames this file on main, with `git mv` in a docs-only commit, to `docs/05-quality/security/PR-<NNNN>-TASK-041B-security-review.md` (`<NNNN>` = the part-B PR number, zero-padded to 4 digits). The content stays as it is. Main's `check-security-owned-paths.mjs` counts only `PR-<NNNN>-*.md` records of that PR. Order (D-ORCH-136, D-ORCH-138): open the PR as a draft, rename on main, confirm that the PR's merge ref contains the renamed record, mark the PR ready.

| Field | Value |
|---|---|
| PR | Not opened. Branch `feat/TASK-041-part-b-rate-limit-rulings-rev2`, stacked on PR #82's head `be843ae1`, not pushed. Four commits: `5164fd03` (feat: B1 to B4, E1 to E3 helper), `1cbc5aef` (D-ORCH-148 sentinel), `e7354249` (api/README §7 and §13), `83a85739` (fix cycle 1: the in-flight ledger of R1-M1, R1-m1, R1-m2, NITs; D-TASK041-18) |
| Head | 83a857398ae67baeaf7e6cd0faef7b322b0cb07c |
| Delta reviewed | `be843ae1..83a85739`: 26 files, 2,231+/109-. No lockfile, no `packages/config/src/schema.ts`, no new dependency |
| Owned paths changed | 21 in the part-B delta (main's checker, `--base be843ae1 --head 83a85739`): `apps/api/src/platform/authn/access-token-precheck{,.test}.ts`, 18 files under `apps/api/src/platform/rate-limit/` (`authn-failed{,.test,.api.test}.ts`, `breaker{,.test}.ts`, `in-flight{,.test}.ts`, `counter.ts`, `denial-budget.ts`, `kit.ts`, `limiter.ts`, `limits.ts`, `policy.ts`, `store.ts`, `rate-limit{.test,.int.test}.ts`, `tests/fake-valkey.ts`, `tests/serve.ts`) and `apps/api/src/platform/routing/pipeline.ts`. Against `origin/main` today (parts A and B together) the checker counts 36 |
| Unowned paths changed | 5: `apps/api/src/app.ts`, `apps/api/src/start-api.denial-budget.api.test.ts`, `packages/config/src/load-config.test.ts`, `packages/shared/src/logging/security-event.ts`, `docs/03-architecture/api/README.md` (§7 and §13) |
| Lane A / lane B evidence | None for this head. Lane B on the stacked head `e7354249` was void (D-ORCH-150); the credited run is the one on the merge head after #82 merges (D-ORCH-157) |
| Binding items checked | ADR-0016 amendment 12 items 3, 4, 7, 8, 11 and amendment 13 items 1 to 6 (item 6 as committed on local main `f8794de2`); `rulings/wave-1-task-041-rulings.md` revision 3 (B1 to B5, §5.2, §9, card lines 10 to 19); D-ARCH-182, D-ARCH-225, D-ARCH-226, D-ARCH-227; D-PM-080, D-PM-088; D-ORCH-150, D-ORCH-151, D-ORCH-157; D-TASK041-10 to D-TASK041-18; the brief `docs/04-plan/briefs/TASK-041B.md`; my rounds 1 to 3 of part 041-A (`PR-0082-TASK-041-security-review.md`: R2.3 E1 to E5, R2.4 PR041-SEC-09); code review rounds 1 and 2 (`PR-pending-TASK-041B-code-review.md`, `596cbfc3`, `86cdef9a`); REQ-SEC-015 |
| Reviewer / date | security-analyst, 2026-11-21, round 1 of part 041-B (QG-041-C4 second half, D-QG-001). Host rule: no Docker, no Jest, nothing run in the part-B worktree (not even read-only git; every object was read from the main checkout's store). Method: single-process Node 24 probes on `git archive` extracts of `83a85739` (head), `e7354249` (positive control: before the in-flight ledger) and a patched scratch copy of the head (the C-1 fix candidate). Sources type-stripped by a resolve/load hook; bare packages (Express 5.3.0, jose 6.2.15, body-parser 2.4.0) and the generated Prisma client from the main checkout, which part B does not change. The real `createApp` with the branch's `FakeValkey`; raw TCP clients on loopback; a client abort is `socket.resetAndDestroy()` |

## 1. Summary

Part 041-B builds what amendments 12 and 13 rule, and the probes found one gap, which the code review found independently and the architect has already ruled:

- **B1, the budget, and the in-flight hold.** For clients that wait for their answer, the fix of R1-M1 holds exactly: limit 5, 60 parallel junk bearers enter the authenticator 5 times (the e7354249 control: 60). With Valkey replies delivered in batches, as ioredis delivers one socket read, it still holds exactly in 12 of 12 runs: six authenticator shapes, batched and direct (probe PD). It does **not** hold for clients that disconnect after admission: the response `close` releases the unit while the authentication still runs. Limit 5, a 20 ms authenticator: 13 entries; a 200 ms authenticator: 84 entries (probe PA). This is **PR041-SEC-10** (LOW at this head, = code review R2-M1), ruled by D-ARCH-226 into fix cycle 2. The fix shape of rulings §9.3 C-1, applied to a scratch copy, gives 5 and 5, and the ledger empties after every one of 11 request outcomes (probe PB).
- **Residual R-ARCH-36 (d), rated as asked.** The bound across instances (`N × limit`) is accepted, **PR041-SEC-12** INFO. The cost, a 429 with `Retry-After: 1` for valid credentials while the hold of an address is full, is a lever a co-located client can pull without one refused credential and without an event, up to Node's default 300 s request timeout per connection. It gives that client no reach beyond the lock of amendment 13 item 2. **PR041-SEC-11** is LOW: accepted, with the label of D-ARCH-227 and one addition to the TASK-108 card line. My rating is LOW, so reopen trigger (vi) of amendment 13 item 6 does not fire. I concur with the wording of item 6 and R-ARCH-36 (d), with three additions (section 4).
- **B2, B3, B4, R1, E1 to E5, m1, the outage path and README §7/§13 hold as ruled.** One shared breaker per process (the code review pins the wiring with K1 to K3). The fallback set is the one of D-PM-088, which closes PR041-SEC-03 on the HTTP side. The pre-check helper meets E1 to E3: 27 of 27 shapes, and jose agrees on the two that matter. Two INFO items: an event-loop stall above 250 ms opens the breaker although the store answered (**PR041-SEC-13**), and the pre-check costs about 100 µs at its 4 KiB cap for a deeply nested payload, against 1.9 µs typical (**PR041-SEC-14**).
- **PR041-SEC-09 is closed.** R1 and R2 (i) are implemented and tested (B1 (9) to (13)). With the hold of an address full, sign-in with a stale refresh cookie from that address is still served.
- **PR041-SEC-02 (b) is implemented.** It closes when the delta round verifies C-1, because the same control decides it.

0 Critical, 0 High, 0 Medium. **PASS_WITH_CONDITIONS**: fix cycle 2 (D-ARCH-226 C-1, D-ARCH-227 C-2, C-3, tests H2 to H5) must pass a security delta round before merge. Fix cycle 2 changes owned paths, so it voids this record's binding by design.

## 2. Findings

| ID | Severity | CWE / OWASP 2021 | Where (`83a85739`) | Title | Owner, due |
|---|---|---|---|---|---|
| PR041-SEC-10 | LOW (MEDIUM if it reached an authenticator with a lookup) | CWE-307 / A07 | `rate-limit/limits.ts:154-157` (the close listener), `rate-limit/authn-failed.ts:82` (the slot is entered whatever the response state) | A client that disconnects after admission frees its in-flight unit while its authentication still runs (= code review R2-M1) | senior-developer, fix cycle 2 of part 041-B (D-ARCH-226, rulings §9.3 C-1, test H2); verified in my delta round before merge |
| PR041-SEC-11 | LOW | CWE-410 / A04 | `rate-limit/in-flight.ts:34-40`, `rate-limit/limiter.ts:143-147`, `app.ts:214-216` (step 0, then the JSON body parser, then the slot) | Residual R-ARCH-36 (d), the cost: the hold refuses valid credentials of an address with `Retry-After: 1`, and a co-located client can fill it with unfinished bodies, without a refused credential or an event | Accepted (D-ARCH-225). Label C-2 in fix cycle 2 (D-ARCH-227); TASK-108 card line 17 gains the declared-oversize body (section 3); TASK-214 card line 18 |
| PR041-SEC-12 | INFO | CWE-770 / A04 | `rate-limit/in-flight.ts` (per-instance ledger) | Residual R-ARCH-36 (d), the bound: `N × limit` refused authentications per address and window across `N` instances | Accepted (D-ARCH-225); real-Valkey reply order by test H6 in lane B |
| PR041-SEC-13 | INFO | CWE-636 / A04 | `rate-limit/store.ts:62` (the 250 ms timer), `rate-limit/breaker.ts:49` | An event-loop stall above 250 ms opens the breaker although the store answered in time, so for 5 s the step-0 hits and the fail-open classes are not limited on that instance | TASK-214 (an event-loop delay gauge beside the breaker-state gauge); accepted under D-PM-088 amendment 3 |
| PR041-SEC-14 | INFO | CWE-400 / A04 | `authn/access-token-precheck.ts:18`, `:31` | At the 4 KiB cap a deeply nested payload makes the pre-check cost about 100 µs, and the token is classified `expired`, which spends nothing | TASK-052, optional: a cap near 1 KiB (about 23 µs) |

## 3. Findings in detail

### PR041-SEC-10 (LOW): a disconnect after admission frees the unit while the authentication runs (= code review R2-M1)

**Where.** `ipLimiter` registers `res.once('close')` and releases the unit there without a condition (`limits.ts:154-157`). The wrapper enters the slot whether or not the response is still open (`authn-failed.ts:82`), and it releases again at the outcome. Express does not stop a request whose client has gone. So the authentication still runs, refuses, and spends later, but its unit is already free. Admissions in between read `settled` without that refusal and `held` without its unit.

**Probe PA** (the real `createApp`, `FakeValkey`, a seam authenticator that refuses a junk bearer after a delay, limit 5, raw sockets; each client resets its connection 5 ms after sending, which is after step 0 has answered on loopback):

| Extract | Shape | Authenticator entries | Peak concurrent | Failed count |
|---|---|---|---|---|
| `83a85739` | 60 parallel, clients stay | 5 | 5 | 5 |
| `83a85739` | 60, one every 2 ms, clients stay | 5 | 5 | 5 |
| `83a85739` | 60, one every 2 ms, **reset at 5 ms**, slot 20 ms | **13** | 10 | 13 |
| `83a85739` | 200, one every 1 ms, reset at 5 ms, slot 200 ms; control without the reset: 5 | **84** | 82 | 84 |
| `83a85739` | 60, one every 2 ms, reset at 5 ms, slot 1 ms | 5 | 1 | 5 |
| `e7354249` (positive control) | 60 parallel, clients stay | 60 | 60 | 60 |
| `e7354249` | 60, one every 2 ms, reset at 5 ms, slot 20 ms | 12 | 10 | 12 |
| C-1 candidate (scratch copy) | the 20 ms and the 200 ms reset shapes | 5 and 5 | 5 and 5 | 5 and 5 |

Every spend landed on the address's own key. With `TRUST_PROXY_HOPS=0` the peer address is cached at step 0, so a reset socket does not move the spend to `unknown`: 11 spends, all on the address. The overshoot is about arrival rate × time in the slot. It is nothing for a CPU-only refusal and grows with a lookup. Under database pressure (TASK-055) it approaches the credentialed ceiling, which is R1-M1's bound again. Aborting needs no co-location and little timing: any moment between the answer of step 0 and the outcome of the slot works, and that window is as long as the lookup. A flooding client never needs the 401.

**Rating.** At this head the slot is the TASK-020 stub, so impact is Low and likelihood High: **LOW**. If it reached TASK-055's refresh-cookie lookups unfixed: impact Medium (lookups up to the ceiling for forged cookies, the cost amendment 13 item 2 accepts the lock to prevent), likelihood High: **MEDIUM**. D-ARCH-226 requires the fix before merge, so it never gets there.

**Remediation (ruled: D-ARCH-226, rulings §9.3 C-1).** Mark the holder as entered before the wrapper calls the slot. The close listener releases only a holder that is not marked; the outcome releases as now, after the spend. My scratch copy applied this shape: `enter(holder)` in the ledger, called before `inner(...)`, and a close handler that releases only an unmarked holder. It also had a 60 s cap timer, which §9.4 declines; the cap played no part in the results, because every authentication of probe PA settled within 200 ms. Probes PA and PB then gave 5, 5 and an empty ledger. **No timer:** I concur with §9.4. A timer shorter than the slowest authentication gives the burst back. It holds on one condition (section 4, item 6 (b)): every authenticator that does I/O must have a bounded latency and a test for it. Otherwise a slot that never settles keeps its unit for good once the client is gone. My scratch copy showed this: a hung slot plus a reset client leaves 1 unit held.

**Verification test.** H2 of rulings §9.3 (destroyed and half-closed clients, staggered inside one slot delay: `limit` entries, ledger 0 afterwards). A mutant that restores the release at every close must fail H2. The admission check "closed before the store answered" must stay (its api row, mutant N2 of the code review). My delta round re-runs probe PA on the fix head.

### PR041-SEC-11 (LOW): the cost of the hold, and the lever it gives a co-located client (residual R-ARCH-36 (d))

**What the hold reaches.** A unit is held from step 0 until the authentication outcome, for every credentialed request of the address, valid ones included. The JSON body parser runs in between (`app.ts:214-216`). While `limit − settled` units are held on an instance, the next credentialed request there is refused with `Retry-After: 1` (`limiter.ts:146`).

**Probe PB** (head, limit 5): five `POST` requests with a **valid** bearer, `Content-Length: 20` and 5 bytes sent:

- a valid `GET` from the same address: 429, `Retry-After: 1`, `RateLimit-Limit: 5`, `RateLimit-Remaining: 0`;
- another address: 200;
- a sign-in from the held address carrying a stale `__Host-rt_web`: 200, because R1 keeps it under the unauthenticated budget;
- no `rate_limit_auth` event, failed count 0, the counter shows `step0-authn-failed: 1`.

The `http.Server` of `app.listen` has `requestTimeout` 300,000 ms and `headersTimeout` 60,000 ms (Node defaults; `start-api.ts:165` sets none). **One more shape:** a request that declares a `Content-Length` above the 1 MB limit holds its unit without sending the body. body-parser 2.4.0 reads off the entire request before it passes the 413 on (`read.js` `dump` → `onFinished`). In the probe the 413 never came, and the unit was freed only when the client left.

**Rating as a DoS lever.**

- **Impact Medium:** the credentialed service of an address is refused on the held instances, valid bearers and token refresh included, renewable for as long as the connections stay.
- **Likelihood Low:** the client must share the victims' address, hold `limit` connections per instance (`N × 120` at the defaults), and keep them open. It already has a cheaper way to the wider lock of amendment 13 item 2: two refused credentials a second.

So **LOW**. What the hold adds is stealth: no refused credential and no event. The squeeze of R2-m1 adds the same. A client keeps `settled = limit − 1` and leaves one unit per instance, and the event marks only the spend that reaches the limit. The signal of D-ARCH-227 answers both: its own label, a gauge, an alert, and reopen trigger (iv). Non-malicious triggers need more than a second of average time between step 0 and the authentication outcome at the ceiling's rate. That is rare, and its answer is a retryable 429.

**Remediation and conditions.**
- (a) C-2 of rulings §9.3 (label `step0-authn-inflight`; a request whose client left before step 0 answered counts under neither label), fix cycle 2, test H5.
- (b) TASK-108 card line 17: the 30 s of REQ-SEC-015 must run from the arrival of the request, so that it ends the body phase between step 0 and the slot. A deadline inside the tx slot starts after authentication and does not. The test also covers a request that declares a `Content-Length` above the limit and sends nothing.
- (c) TASK-214 card line 18 as written.
- (d) product-manager adds the R-16 sentence of D-ARCH-225.

### PR041-SEC-12 (INFO): the bound across instances (residual R-ARCH-36 (d))

The ledger is per instance. One parallel burst therefore reaches `N × limit` refused authentications per address and window: 360 to 1,440 a minute at 3 to 12 API tasks, twice that while two colours serve, and twice again across a window boundary. I checked the architect's figures. 1,440 × about 400 µs (my measurement of an ES256 verification, round 2 probe P7) is about 0.58 s of one core per minute and address. 1,440 indexed reads a minute is 24 a second, below the 100 a second that residual (a) accepts for a valid cookie.

**Probe PD** checked the per-instance bound under batched replies. The fake executes each script at call time and delivers the replies in batches, in call order, in one synchronous step (what ioredis does with one socket read). 200 parallel junk bearers through the real `createApp`, with a synchronous refusal, 1, 3 and 8 microtask hops, `setImmediate` and a 1 ms timer, batched and direct: 12 of 12 entered exactly 5. The `e7354249` control entered 77. This agrees with the code review's P5. The proof against a real client is H6 in lane B.

**Accepted.** Reopen trigger (iii) (a store client that does not answer in call order, cluster mode) covers the premise.

### PR041-SEC-13 (INFO): an event-loop stall opens the breaker

**Probe PE.** The head's `createValkeyStore` with its breaker, over a loopback "store" that answers at once. The event loop was stalled synchronously right after the call was sent:

| Stall | Outcome | Breaker |
|---|---|---|
| 0 ms | ok | closed |
| 100 ms | ok | closed |
| 200 ms | ok | closed |
| 300 ms | `timeout` | open |
| 600 ms | `timeout` | open |

After a stall the timers phase runs before the poll phase, so the 250 ms timer fires before the reply that is already waiting is read. For 5 s the instance then fails open on the step-0 hits and the fail-open classes, and keeps per-instance counters for the fallback set. The failed-authentication gate stays in force, per instance. An unauthenticated flood of large JSON bodies can stall a loop. D-PM-088 amendment 3 accepts "one slow store call" as an outage, so this is not a new acceptance. It only says that the slow call can be the API's own loop. Recommendation for TASK-214: export the event-loop delay (`perf_hooks.monitorEventLoopDelay`) next to the breaker-state gauge, and say in the runbook that an open breaker with a healthy Valkey points at the API's own loop.

### PR041-SEC-14 (INFO): the pre-check's worst case at its cap

**Probe PF.** `precheckAccessToken` decodes header and payload with `JSON.parse` after the length and segment checks. A 4,078-character token with a past `exp` and a deeply nested array in the payload costs about 103 µs per call; a typical token costs 1.9 µs. Such a token is `expired`, which spends nothing. Cost scales with the cap: about 23 µs at 1 KiB and 46 µs at 2 KiB. E3 holds (the parse is bounded), and the worst case is about a quarter of a verification, bounded by the credentialed ceiling. Optional for TASK-052: a cap near 1 KiB, since the helper's own comment says the platform's tokens are well under 1 KiB.

## 4. QG-041-C4 second half: concurrence

| Item | Position |
|---|---|
| Amendment 12 item 4 / B1, the budget (with PR041-SEC-02 (b)) | **Concur**, subject to PR041-SEC-10. The spending side keys on what the route declares: a junk bearer on an anonymous route spends nothing, and a 404 with a bearer spends nothing. A 4xx `AppError` other than `ACCESS_TOKEN_EXPIRED` spends; a 5xx or a raw error does not, and leaves the ledger empty (probe PB matrix). The reading side is one script over two keys. `rate_limit_auth` class `authn-failed` fires once, at `count === limit`. Valkey `INCR` is atomic, so the fleet sees one event per window |
| Amendment 13 items 1 and 2 / R1, R2 (i) (PR041-SEC-09) | **Concur; PR041-SEC-09 closed.** Cookie routes need literal paths, refused at boot with exit 78 (`RefreshCookiePathError`, `bootFailureOf` logs the operation and the metadata path, no request data). `LITERAL_PATH` reads route metadata at boot, never request input. Other spellings take the unauthenticated budget (ruled; code review P1) |
| Amendment 13 item 3 / E1 to E5 | **Concur.** E1 to E3: probe PF, 27 of 27 shapes as expected (alg not `ES256`, `alg` only under `__proto__`, two or four segments, padding, `+/`, over the cap, a missing, string, null, boolean, infinite (`1e400`), negative or out-of-range `exp` give `malformed`; past, `-0` and fractional `exp` give `expired`; the tolerance boundary matches jose's `exp <= now - tolerance`). jose oracle: a forged future-`exp` token gives `verify`, then `ERR_JWS_SIGNATURE_VERIFICATION_FAILED`; a genuine expired token gives `expired` and `ERR_JWT_EXPIRED`. The helper returns a classification only, reads nothing else of the payload and logs nothing. An early refusal can only reject, so it is no signature oracle. E4: the exemption keys on the code alone (`spendsAuthnBudget`); `ACCESS_TOKEN_EXPIRED` → 401, no spend, unit released (PB matrix); no §13 event exists for bearer refusals. E5: the `[E5]` and `[E2]` api rows run the helper in front of the real `jose.jwtVerify`. The authenticator half is TASK-052's (card line 11), plus PR041-SEC-14 (optional) |
| Amendment 13 item 6 and R-ARCH-36 (d), the wording (D-ARCH-225 to D-ARCH-227, committed on local main `f8794de2`) | **Concur, with three additions:** (a) "a body that it never completes" includes a declared `Content-Length` above the body limit with no bytes sent, because body-parser answers the 413 only once the request has ended (PR041-SEC-11); the TASK-108 timeout must run from the request's arrival. (b) "No timer" rests on bounded authenticators. TASK-055, and any later authenticator that does I/O, needs a card line: with the database not answering, the slot settles within its pool-acquire or statement timeout and the unit is released (the gauge returns to 0). (c) "No security event for the hold": **concur**. It is a capacity signal; the label, the gauge, the alert and trigger (iv) carry it. My rating of (d) is LOW (PR041-SEC-11) and INFO (PR041-SEC-12), so trigger (vi) does not fire. The abort case is not a residual, as D-ARCH-226 says: it is PR041-SEC-10, to be fixed |
| Amendment 12 item 7 / B3, one shared breaker | **Concur.** One breaker per `createRateLimitKit`, handed to the denial budget by `createApp` (`storeBreaker: kit?.breaker`). The code review pins K1 to K3 through `startApi` and `createApp`. While the breaker is open, every call fails at once with `RateLimitStoreError('unavailable')`. After the cool-down there is one probe, and the other calls keep failing fast. Its reply check is inside the breaker, so a malformed reply opens it. The breaker does not change the fail-closed or fail-open mode of any class: each caller's mode decides, as before. Note PR041-SEC-13. A carry restore of the denial budget during an open breaker fails fast; that is PR041-SEC-06's residual, which goes into §10.4 H, mine before G3 |
| Amendment 12 item 8 / B4, the fallback set (D-PM-088 wording) | **Concur; PR041-SEC-03 closed on the HTTP side.** `classPolicy` gives `public-quote`, `public-tracking`, `auth` and `email-send` the per-instance fallback. `public`, `authenticated`, `webhook` and `csp-report` fail open, and so do the step-0 hits and the stream slots (`acquire` → true). The failed-authentication budget falls back: `spend` → `fallback.hit`, and the gate reads `fallback.peek`. The three service helpers are fallback rules only if their consumer passes the mode. D-PM-088 amendment 2 and its STORE OUTAGE CASE card lines (TASK-049, -052, -091) are the right control. The carrier side stays TASK-190 (ADR-0010 amendment 13) |
| Amendment 12 item 3 / B2, signature headers | **Concur.** Non-blank `Stripe-Signature`, `X-Mock-Signature` or `X-Carrier-Signature` selects the credentialed rule (unit rows include a list value and a blank one). As with any header, a client can add one to reach the ceiling: residual (c) of R-ARCH-36, unchanged. Refused signatures spend only on routes that declare `signature` |
| The outage-path change (in `fallback` mode the rule's hit is counted even when the gate refuses) | **Concur.** It matches the healthy path (`HIT_AND_PEEK_SCRIPT` always `INCR`s `KEYS[1]` before it reads the gate). It has no production effect: step 0 passes `fail-open`. The rule-then-gate order keeps the gate's peek as the last `await` before `admit` |
| m1, a falsy rejection or throw | **Concur.** `Promise.reject(undefined)` and a falsy throw become errors: 500, no spend, unit released (PB matrix). A falsy throw is stricter than the router, which would continue the request |
| n7, two-key scripts under a Valkey cluster | **Concur with the routing** (data-architect and devops: hash tags in the `rl:` key grammar before cluster mode). In cluster mode every two-key call (the step-0 gate, the denial budget) would fail `CROSSSLOT`. Each failure re-opens the breaker after a single-key probe has closed it. The gate and the denial budget would run per instance, with `rate_limit_store_unavailable` once a minute: loud, not silent. Amendment 13 item 6 already makes cluster mode a reason to prove the bound again |
| n8, raw authenticator errors spend nothing | **Concur with the routing**, widened: TASK-052, TASK-055, TASK-091, TASK-171 and TASK-261 each answer every refused presented credential with a 4xx `AppError`, one test row per forged shape. A shape that escapes as a raw error is a 500 that spends nothing, does not close the gate, and logs an error line each time. It would be a finding against that task |
| README §7 and §13 (B5) | **Concur.** §7 has the §5.2 text verbatim (code review). The §13 `rate_limit_auth` cell matches the code (the spend that reaches the limit). The C-3 sentence of rulings §9.3 rides fix cycle 2 |

## 5. Part-A findings at this head

| ID | State |
|---|---|
| PR041-SEC-02 (b) | Implemented. Closes at the delta round that verifies C-1 (PR041-SEC-10) |
| PR041-SEC-03 (INFO) | **Closed on the HTTP side** (B4). Carrier admission stays TASK-190 |
| PR041-SEC-04, -07 (INFO) | Open with data-architect and devops, unchanged |
| PR041-SEC-06 (INFO) | Open, mine before G3 (§10.4 H). The breaker adds one more way to lose a carry (a restore during an open breaker), the same residual |
| PR041-SEC-09 (LOW) | **Closed.** R1 and R2 (i) as ruled by D-ARCH-182, tests B1 (9) to (13), probe PB (sign-in with a stale cookie served while the address is held) |
| E1 to E5 | Verified for this part (section 4). The authenticator half stays with TASK-052 |

## 6. Probes and scans

| Probe | What | Result |
|---|---|---|
| PA | Abort after admission, head against `e7354249` and the C-1 candidate | Section 3, PR041-SEC-10 |
| PB | Hold by unfinished bodies with valid bearers; release and leak matrix of 11 outcomes on head and candidate: 404, malformed body 400, a declared oversize body, 415, expired, raw throw, falsy rejection, junk bearer on an anonymous route, abort mid-body, hung slot with the client gone, a spending 401 | Head: the ledger is empty after every case. Candidate: the same, except that the hung slot whose client left keeps 1 unit, the case of section 4 item 6 (b) |
| PD | Per-instance bound under batched in-order replies | 12 of 12 exactly `limit`; control 77 |
| PE | Breaker under an event-loop stall | Section 3, PR041-SEC-13 |
| PF | Pre-check shapes, cost, jose oracle | 27/27; 1.9 µs typical, 103 µs worst at the cap |
| Gitleaks (emulated, v8.30.1 default rules as pinned in `ci.yml`) | The four part-B commits, added lines per hunk | An over-approximation (keyword and regex only, 221 rules) gives 29 `generic-api-key` candidates. All are identifiers, configuration names, test keys built from documentation-range addresses (`203.0.113.0/24`) or imports. With the rule's entropy 3.5, its allowlists and its 1,446 stopwords, 0 hits; the runtime positive controls fire. The same scan of part A's range (lane B gitleaks-full passed on it) gives 0 as well. Lane B runs the real image at the merge head |

No `.env*` file is in the delta, and none was opened.

## 7. Code review twin and the architect's rulings

- **Code review round 2** (`86cdef9a`) found the abort gap as R2-M1 (probe P4b: 60 of 60) before this round was written. Its R2-m1 and R2-n1 are the cost wording and the label. PR041-SEC-10 is R2-M1 with my independent probe and a validated fix shape, so I keep its owner and its fix: option (a).
- **D-ARCH-225 to D-ARCH-227** (local main `f8794de2`, not yet on `origin/main` when this round was written) rule the release (C-1), the label (C-2), the README sentence (C-3) and tests H1 to H6. My findings follow those rulings. D-ARCH-226 says this round "does not need to rate an abort bound, because none is accepted", and I agree: PR041-SEC-10 is a defect to fix, not a residual.

## 8. Record binding and simulation

- **The binding.** This round's `Head` row names `83a85739`. It is the only `Head` row of the file, and the only `Verdict` row is the last row.
- **Fix cycle 2 voids it by design.** C-1, C-2 and the tests change `in-flight.ts`, `limits.ts`, `authn-failed.ts`, `counter.ts`, `limiter.ts` and their tests, all owned. So a security delta round (C1 below) appends a round with its own `Head` row on the fix-2 head.
- **After PR #82 merges.** The part-B PR's net change is then the part-B delta, provided #82's squash equals `be843ae1` on the part-A files (code review C3), and its owned set is the 21 paths above. The binding survives the merge of main into the branch as long as every one of those 21 paths ends with the blob of the bound head. A main-side change to one of them that the merge keeps voids it, and so does a #82 squash that differs from `be843ae1` on a file part B also changes.
- **The merge will not be a pure union.** This repository squash-merges pull requests (`(#79)`, `(#78)` … on main), so #82 lands as one commit with one parent. Merging that main into the part-B branch then has merge base `530629f4`, and **16 files conflict**: 11 add/add conflicts, one for each file part A created and part B changed (`counter.ts`, `denial-budget.ts`, `kit.ts`, `limiter.ts`, `policy.ts`, `store.ts`, `rate-limit.test.ts`, `rate-limit.int.test.ts`, `tests/fake-valkey.ts`, `tests/serve.ts`, `start-api.denial-budget.api.test.ts`), and 5 content conflicts (`app.ts`, `limits.ts`, `pipeline.ts`, `security-event.ts`, the README) (simulated: `git merge-tree` of the part-B head and a simulated squash). The correct resolution is mechanical, the part-B head's blob for every conflicted file, and D-ORCH-150's "union of identical trees" holds only in that sense. Code review C3's "a pure merge needs no code-review round" does not apply literally. The resolution is proven by blob equality (item 3 below), not by `merge-tree` equality. The alternative is that the orchestrator merges #82 with a merge commit, after which the merge is clean.

**What the merge-only round must check** (after #82 merges and `origin/main` is merged into the branch, no rebase):
1. #82's squash equals `be843ae1` on every file of `530629f4..be843ae1` that main did not change on its own.
2. Every conflicted file of the merge carries the branch head's blob, and every other file the blob `merge-tree` gives. List them with `git show --cc`.
3. `git diff --raw <main> <merge>` equals `git diff --raw be843ae1 <branch head>`, old and new blob of every path. The PR then shows exactly part B. The checker alone cannot see a resolution that drops a part-B change, or a main change, from an owned file: in the simulation both still pass it (S7b, S11, S12 below). Only this equality catches them.
4. The owned set under main's checker (`--base <main> --head <merge>`) equals the part-B set, and none of it changed between the bound head and the merge.
5. `package-lock.json` and `packages/config/src/schema.ts` are untouched by part B (true at `83a85739`), so main's lockfile moves cannot void the record.
6. Gitleaks over the merge's first-parent diff, which brings main's text in.
7. The record checker on the merge-ref form, with the renamed record.

**Simulation.** Main's real `tools/ci/check-security-owned-paths.mjs` ran in a `--shared` sparse clone of the main checkout, with scenario commits built by plumbing. This record was placed as `PR-9999-TASK-041B-security-review.md` on a simulated main in which #82 is squash-merged: one parent, `origin/main` `bf9f3454`, and tree = `git merge-tree --write-tree origin/main be843ae1`, which equals `be843ae1` on every part-A file. The part-B head was merged into it, conflicts resolved to the branch blob unless a row says otherwise. The checker ran `--pr 9999 --base <simulated main with the record> --head <merge>`. The column "item 3" is the old-and-new-blob equality of the merge-only round.

| Scenario | Expected | Checker | Item 3 |
|---|---|---|---|
| S1 The merge ref: record on main after the squash, part-B head merged (16 conflicts, all to the branch blob) | pass | pass (`83a85739`, 21 owned) | equal (26 files) |
| S2 Control: no record | fail | `missing` | equal |
| S3 Control: the placeholder name only | fail | `missing` | equal |
| S4 Control: the last `Verdict` row `FAIL` | fail | `missing` | equal |
| S5 Control: the `Head` row names `be843ae1` | fail | `missing` (owned paths changed after it) | equal |
| S6 Control: fix cycle 2 changes `in-flight.ts` after the head | fail | `missing` (`in-flight.ts` changed after it) | differs |
| S7a Control: main changes `policy.ts`, and the merge keeps both changes | fail | `missing` (`policy.ts` changed after it) | differs |
| S7b Main changes `policy.ts`, and the merge drops main's edit | checker pass, item 3 catches | pass | **differs** |
| S8 A docs-only main commit after the record | pass | pass | equal |
| S9 A lane-B evidence commit on the branch after the head | pass | pass | equal (with the evidence commit as branch head) |
| S10 The `Head` row with the 8-character SHA | pass | pass | equal |
| S11 One conflict (`limits.ts`) resolved to the squash side, which drops part B there | checker pass, item 3 catches | pass (20 owned) | **differs** |
| S12 Main changes the unowned `app.ts`, and the merge drops main's edit | checker pass, item 3 catches | pass | **differs** |

13 of 13 as expected. The record has one `Head` row and one `Verdict` row, the last row of the file. S7b, S11 and S12 are why item 3 is a condition of the merge-only round and not optional.

## 9. Conditions and routes

**Conditions (merge of part 041-B).**
- **C1.** Fix cycle 2: C-1 (release rule, D-ARCH-226), C-2 (label, D-ARCH-227), C-3 (README §7 sentence), tests H2 to H5, then a **security delta round** on the fix-2 head. That round re-runs probes PA and PB (H2 shapes with reset and half-closed clients: `limit` entries, ledger 0), checks the label split and the uncounted early abort, and closes PR041-SEC-10 and PR041-SEC-02 (b).
- **C2.** Lane B on the merge head after #82: `rate-limit.int.test.ts` including H6 (real Valkey, reply order), the api project (`authn-failed.api.test.ts`, `start-api.denial-budget.api.test.ts`, `limits.api.test.ts`, `runtime-seams.api.test.ts`), `in-flight.test.ts`, the generated project and gitleaks-full. Hosted lane A and `security-integration` when billing allows.
- **C3.** The merge-only round of section 8 after #82 merges, with items 1 to 7. It can be one round with C1's delta if the merge comes first. After a squash of #82 the merge has 16 conflicts, so the orchestrator either resolves each to the branch blob and the round proves it (items 2 and 3), or merges #82 with a merge commit (D-ORCH-150 is the orchestrator's). code-reviewer: the "pure merge" exemption of code review C3 does not cover this merge.
- **C4.** The rename of this record and the merge-ref check (D-ORCH-136/138).

**Routes (card lines, for senior-developer's next fold unless stated).**
- TASK-108 (extends card line 17): the 30 s timeout of REQ-SEC-015 runs from the arrival of the request and ends a request whose body stalls between step 0 and the authentication slot; test rows: a stalled body and a declared `Content-Length` above the body limit with no bytes sent are both ended at the timeout, their in-flight units released, and a following credentialed request of the address is served (PR041-SEC-11).
- TASK-055, and every later authenticator that does I/O (extends card line 16): the authentication slot settles within a bounded time when the database does not answer (pool-acquire or statement timeout), its unit is released, and the gauge of held units returns to 0 (the premise of "no timer", D-ARCH-226 item 3; PR041-SEC-10).
- TASK-052, TASK-055, TASK-091, TASK-171, TASK-261: every refused presented credential is a 4xx `AppError`; one test row per forged shape (code review n8, widened).
- TASK-214 (extends card line 18): an event-loop delay gauge next to the breaker-state gauge; the runbook says that an open breaker with a healthy Valkey points at the API's own loop (PR041-SEC-13).
- TASK-052 (optional): `ACCESS_TOKEN_MAX_LENGTH` near 1 KiB (PR041-SEC-14).
- product-manager: the PRD §9 R-16 / A-112 sentence of D-ARCH-225 (already routed there).
- Mine, before G3: threat model R-13, T-11, T-39 and T-93 aligned with ADR-0016 amendments 12 and 13 (item 6 included), and PR041-SEC-06 in §10.4 H.

| Verdict | **PASS_WITH_CONDITIONS.** Round 1 of part 041-B at `83a85739`: 0 Critical, 0 High, 0 Medium. QG-041-C4 second half: concurrence on ADR-0016 amendment 12 items 4, 7 and 8 and amendment 13 items 1 to 3; amendment 13 item 6 / R-ARCH-36 (d) wording concurred with three additions; residual (d) rated LOW (cost, PR041-SEC-11) and INFO (bound, PR041-SEC-12), so trigger (vi) does not fire. New: PR041-SEC-10 LOW (= code review R2-M1: a client that disconnects after admission frees its unit; probe 13 and 84 entries at limit 5; fix shape validated: 5 and 5), ruled by D-ARCH-226 into fix cycle 2; PR041-SEC-11 LOW (accepted cost: valid credentials 429 while the hold is full; a quiet hold by unfinished bodies, including a declared oversize body, up to Node's 300 s); PR041-SEC-12, -13, -14 INFO. Closed: PR041-SEC-09; PR041-SEC-03 on the HTTP side. Conditions: C1 fix cycle 2 (C-1, C-2, C-3, H2 to H5) with a security delta round before merge; C2 lane B on the merge head including H6; C3 merge-only round after #82 merges, proving by old-and-new blob equality that the 16 conflicts a squash of #82 causes resolve to the part-B head (record binding simulated with main's checker, 13 of 13 as expected); C4 rename and merge-ref check |

# Round 2: delta `83a85739..12b8a10a` (fix cycle 2)

| Field | Value |
|---|---|
| PR | Not opened. Branch `feat/TASK-041-part-b-rate-limit-rulings-rev2`, stacked on PR #82's head `be843ae1`, not pushed, upstream unset. Fix cycle 2 is one commit on `83a85739` (D-ORCH-158). Its body carries developer decisions D-TASK041-19 to D-TASK041-22 |
| Head | 12b8a10a6e193d44ec26ee0694c94468ef00f6d1 |
| Delta reviewed | `83a85739..12b8a10a`: 12 files, 420+/73-. 10 are security-owned: `authn-failed{,.test,.api.test}.ts`, `counter.ts`, `in-flight{,.test}.ts`, `kit.ts`, `limiter.ts`, `limits.ts`, `rate-limit.int.test.ts`. 2 are unowned: `start-api.denial-budget.api.test.ts` and api/README §7. `be843ae1..12b8a10a` changes no lockfile, no `package.json`, no `packages/config/src/schema.ts`, no lint configuration and no tool |
| Owned paths, whole part B | 21 under main's checker (`--base be843ae1 --head 12b8a10a`). It is the same set as in round 1, so the 26-file delta and the 21 owned paths are unchanged |
| Lane A / lane B evidence | None for this head; round 1's C2 stands. D-ORCH-158 reports these host results: ESLint clean, check-suppressions 0, unit tests 956/956, the three api files 54/54. I did not re-run them |
| Binding items checked | Rulings §9.3 C-1 to C-3 and tests H1 to H6; D-ARCH-225 to D-ARCH-227; ADR-0016 amendment 13 item 6 as it stands on main `f2055342`; D-TASK041-19 to D-TASK041-22 (commit body); D-ORCH-158; my round 1 (C1 and the section 4 additions); code review rounds 2 (`86cdef9a`) and 3 (`f49a7ff1`, APPROVED_WITH_NITS). Round 3 landed on local main while this round was being written. I read it before finalising: its R3-n2 is the twin of PR041-SEC-15, its R3-n3 concerns the seams (R2.6), and its probe P9 is the hang case of PR041-SEC-16 |
| Reviewer / date | security-analyst, 2026-11-21. Round 2 of part 041-B: a delta round, condition C1 of round 1. Same host rule and method as round 1: nothing was run in the part-B worktree, no Docker, no Jest. I ran single-process Node 24.22.3 probes on `git archive` extracts of `12b8a10a` (head) and `83a85739` (positive control), and on seven scratch copies of the head: six mutants and one candidate hardening. Every probe went through the real `createApp`, with the branch's `FakeValkey` and raw loopback sockets |

## R2.1 Summary

- **PR041-SEC-10 is closed.** C-1 is built as ruled.
  - `enter` marks the holder before the slot. The close of the response calls `releaseUnentered`. The outcome calls `release`, after the spend has landed.
  - The abort probe (PA2) gives 5 authenticator entries at limit 5 in all six shapes: a reset, a destroy or a half-close, 5 ms after sending or once inside the slot, with a 20 ms, 200 ms or 400 ms slot.
  - The ledger is empty after every run.
  - The previous head gives 11 to 117 entries. A mutant that restores the release at every close gives 9, 98 and 60.
- **PR041-SEC-02 (b) is closed** by the same control. With part A's (a), PR041-SEC-02 is closed in full.
- **C-2 holds** (probe PC):
  - a refusal by the hold is counted under `step0-authn-inflight` and carries `held: true`;
  - a refusal by the spent budget is counted under `step0-authn-failed`;
  - a request whose client left before step 0 answered is counted under neither label;
  - the hold emits no event;
  - mutants M4 and M5 each move a count.
- **C-3 is verbatim.** The sentence of rulings §9.3 appears once, directly after "whether its own credential is valid or not.".
- **D-TASK041-20 holds, and it carries weight in production.**
  - The window is real: the JSON parser inflates `gzip` request bodies asynchronously between step 0 and the slot.
  - Through that window the head enters the authenticator 0 times.
  - The previous head, and the two mutants that drop the guard, enter it 31, 20 and 28 times at limit 5.
  - Nothing is left hanging: the client had already gone, the server ends with 0 connections, and every response object is garbage-collected.
  - Only unit rows test it: **PR041-SEC-15** (INFO), the twin of code review R3-n2.
- **The new test seams cannot be reached from production.** `startApi` passes the literal `{ settings: config, valkey }`.
- **New: PR041-SEC-16** (LOW). C-1 makes the outcome the only release of an entered unit. An authentication slot that answers the client itself, or never reports, therefore keeps its unit until the process restarts. Five such answers lock the address's credentialed requests on that instance (probe PH). The previous head released the unit at the close.
  - Pre-existing since `5164fd03`, and missed in round 1: such a refusal spends nothing.
  - The only production slot today is the TASK-020 stub, which always calls `next`.
  - The fix is a contract sentence and test rows on the authenticator cards. A cheap hardening in the wrapper, release at `finish`, was validated on a scratch copy and is offered to the architect.
- **My round-1 additions (a) and (b) to the (d) wording are not folded yet** at `f2055342`. D-ORCH-158 routes them to the architect's next touch of amendment 13 item 6. They are not a merge condition.

0 Critical, 0 High, 0 Medium. **PASS_WITH_CONDITIONS**: C1 is discharged, and C2 (lane B on the merge head, including H6), C3 (the merge-only round after #82) and C4 (the rename) remain.

## R2.2 Round-1 items at this head

| ID | State |
|---|---|
| PR041-SEC-10 (LOW) | **Closed.** C-1 (`in-flight.ts:71-82`, `limits.ts:159-163`, `authn-failed.ts:59`). PA2 gives 5 entries in every shape and an empty ledger. Mutant M1 (release at every close) gives 9, 98 and 60. Mutant M3 (no `enter` call) gives 12, 33 and 60. The api row H2 exists (both ways of leaving). The fail-before-fix claim of the commit body (49 and 60 entries on `83a85739`) is consistent with my control runs |
| PR041-SEC-02 (b) | **Closed**: the budget is bounded on one instance for clients that stay and clients that leave. Part A's round 2 closed (a), so PR041-SEC-02 is closed |
| PR041-SEC-11 (LOW, accepted) | (a) **done**: the label of C-2 (probe PC; the hold of probe PB is now counted under `step0-authn-inflight`). (b) the TASK-108 card line (timeout from arrival, declared-oversize body), (c) TASK-214 and (d) the product-manager sentence stay routed |
| PR041-SEC-12 (INFO, accepted) | Unchanged. PD re-run on the head: 12 of 12 runs exactly 5 (a synchronous refusal, 1, 3 and 8 microtask hops, `setImmediate`, a 1 ms timer; batched and direct replies). H6 against a real Valkey stays lane B's (C2). Its model releases after the spend lands, as the wrapper does |
| PR041-SEC-13, -14 (INFO) | Unchanged (TASK-214; TASK-052, optional) |
| PR041-SEC-03 | Closed on the HTTP side (round 1); carrier side TASK-190 |
| PR041-SEC-04, -06, -07 (INFO) | Unchanged |

## R2.3 Probes

**PA2, abort after admission** (limit 5; a seam authenticator that refuses a junk bearer after the slot delay; authenticator entries; "in the slot" means the client leaves once its request is in the authenticator, or once it is answered, which is the H2 shape):

| Shape | `12b8a10a` | `83a85739` (control) | M1: release at every close | M3: no `enter` |
|---|---|---|---|---|
| 60, one every 2 ms, reset 5 ms after sending, slot 20 ms | **5** | 12 | 9 | 12 |
| 200, one every 1 ms, reset at 5 ms, slot 200 ms | **5** | 117 | 98 | 33 |
| 60, one every 2 ms, half-close at 5 ms, slot 20 ms | **5** | 11 | n/a | n/a |
| 60, one every 3 ms, destroy in the slot, slot 400 ms (H2 "destroy") | **5** | 52 | 60 | 60 |
| As above, half-close in the slot (H2 "half-close") | **5** | 60 | n/a | n/a |
| As above, reset in the slot | **5** | 60 | n/a | n/a |

On the head the peak concurrency in the authenticator was 5 and the ledger was empty after every run. Mutants M2 and M6 (the D-TASK041-20 guard dropped) also give 5 in these shapes, because a body-less `GET` reaches the slot in the same tick as step 0's answer. The guard matters only where the pipeline waits between the two (probe PG).

**PG, the window of D-TASK041-20.** `POST` with a junk bearer and a `gzip` JSON body: 918 bytes on the wire, 900 kB inflated, under the 1 MB limit. The client leaves 0 to 12 ms after sending. body-parser's `inflate` is on by default, and `jsonBodyParser` does not turn it off. A load hook counted the wrapper's early return; it observes only and changes no behaviour.

- **Sequential, 65 attempts per way of leaving** (the slot refuses with `ACCESS_TOKEN_EXPIRED`, so nothing is spent and the gate stays open):

  | Leave | Early returns (slot not entered) | Slot entered | Other | Ledger after | Server connections after | Responses collected / created | Access lines `aborted: true` with `route: null` | Error lines |
  |---|---|---|---|---|---|---|---|---|
  | reset | 50 | 12 | 3 | 0 | 0 | 63 / 63 | 50 | 0 |
  | destroy | 46 | 19 | 0 | 0 | 0 | 66 / 66 | 46 | 0 |

- **Burst** (120 junk bearers with that body, one every 1 ms, reset 10 ms after sending, slot 200 ms, limit 5): the head enters the authenticator **0** times, with 74 early returns. The control `83a85739` enters it **31** times. M2 (`enter`'s false ignored) enters it **20** times, M6 (`enter` true for a released holder) **28** times. With a reset 2 or 6 ms after sending, few requests get into the window (0 or 1 entries in every build).

**PC, the label split** (C-2):

| Case | Head | M4: no `held` flag | M5: count when gone | `83a85739` |
|---|---|---|---|---|
| Hold full (5 valid bearers with unfinished bodies), then a valid `GET` | 429, `Retry-After: 1`, `step0-authn-inflight` +1 | `step0-authn-failed` +1 | as head | `step0-authn-failed` +1 |
| Budget spent (5 × 401), then a valid `GET` | 429, `Retry-After: 60`, `step0-authn-failed` +1 | as head | as head | as head |
| Client leaves before step 0 answered (store hangs to its 250 ms bound) | no label, slot not entered, ledger 0 | as head | `step0-authn-inflight` +1 | `step0-authn-failed` +1 |

One `rate_limit_auth` event was emitted in every build, for the spend that reached the limit. The hold emitted none.

**PB, release matrix** (head): the 11 outcomes of round 1 leave the ledger empty, with one exception. A hung slot whose client left keeps 1 unit. That is the case D-ARCH-226 item 3 accepts: no timer, and the gauge shows it. In the hold part, a valid `GET` from the held address gets 429 with `Retry-After: 1`. Another address gets 200, and sign-in with a stale cookie gets 200. There is no event and no spend.

**PH, a slot that answers the client itself** (PR041-SEC-16): five junk bearers are answered `401` by the slot with `res.status(401).json(…)` and no `next`.

| Build | Units held after | Failed count | Valid bearer at 0 s / 1.5 s / 3 s |
|---|---|---|---|
| `12b8a10a` | **5, for good** | 0 | 429 `Retry-After: 1` / 429 / 429 |
| `83a85739` | 0 (the close released them) | 0 | 200 / 200 / 200 |
| Candidate F (head plus a release at `finish`) | 0 | 0 | 200 / 200 / 200 |

Candidate F passes PA2 in four shapes (reset at 5 ms with slots of 20 ms and 200 ms; destroy and half-close in the slot): 5 entries each. Its PB matrix is the same as the head's.

**Gitleaks** (emulated, v8.30.1 default rules as pinned in `ci.yml`), over the 420 added lines of `12b8a10a`:

- the over-approximation (keyword and regex only, 221 rules) gives 0;
- `generic-api-key` with its entropy, allowlists and 1,446 stopwords gives 0;
- the runtime positive controls fire.

No `.env*` file is in the delta, and none was opened.

## R2.4 Findings of this round

| ID | Severity | CWE / OWASP 2021 | Where (`12b8a10a`) | Title | Owner, due |
|---|---|---|---|---|---|
| PR041-SEC-15 | INFO | CWE-307 / A07 | `authn-failed.ts:59`; tests `authn-failed.test.ts` `[D-TASK041-20]`, `in-flight.test.ts` `[D-TASK041-20]` | The D-TASK041-20 guard carries weight in production (`gzip` bodies) and has unit rows only (= code review R3-n2) | senior-developer: next fold, or with TASK-052's disconnect rows (card line 16); optional, as R3-n2 |
| PR041-SEC-16 | LOW (MEDIUM if an authenticator shipped with the shape) | CWE-772 / A04 | `authn-failed.ts:64-94` (only `done` releases an entered unit), `limits.ts:159-163` (the close releases only an unentered one) | An authentication slot that never reports its outcome keeps its unit until the process restarts, and its refusal spends nothing | Card lines for TASK-052, -055, -091, -171, -261 (senior-developer, next fold). The optional hardening is principal-architect's call (amendment 13 item 6 "Release") |

### PR041-SEC-15 (INFO): the D-TASK041-20 guard has unit rows only (= code review R3-n2)

The wrapper's `if (!kit.inFlight.enter(res)) return;` is what keeps a request that its client left during body inflation out of the authenticator. Probe PG shows the gap it closes: 20 to 31 entries at limit 5 without it, 0 with it. Its tests are two unit rows with plain objects as holders. The api rows of H3 cover a slow body whose client leaves. body-parser turns that case into an error, so the request never reaches the wrapper. By my reading, the unit rows kill M2 (`[entered, passed]` would be `[1, 1]`) and M6 (`enter(gone)` would be true). I did not run Jest. A change in how the holder reaches the wrapper (a proxied `res`, a different holder object) would pass both unit rows.

Code review round 3 reached the same result independently: its probe P8 got 20 of 20 early returns with a complete `gzip` body and an immediate disconnect, and its R3-n2 asks for the same api row, as optional. I keep its owner and fix form.

**Recommendation.** One api row through `createApp`: limit 5, a `POST` with a `gzip` JSON body and a junk bearer, the client leaves before the body is inflated. Expect 0 authenticator entries, ledger 0, and the address served afterwards. Mutant M2 must fail it. Probe PG shows that a reset 10 ms after sending a 900 kB-inflating body reaches the window reliably on this host.

### PR041-SEC-16 (LOW): a slot that never reports its outcome keeps its unit for good

**What changed.** Before C-1, every close of the response released the unit. Now an entered unit is released only by the wrapper's `done`. `done` runs only when the slot calls `next` (with or without an error), throws, or returns a promise that rejects. Two slot shapes never get there:

- a slot that writes the answer itself (`res.status(401).json(…)`, a redirect) and returns;
- a slot that awaits something that never settles, or catches an error and returns without `next`.

**Probe PH.** Five junk bearers are answered 401 by the slot itself. They keep 5 units for good. The valid credentials of that address are then refused with 429 and `Retry-After: 1` on that instance, at 0 s, at 1.5 s and at 3 s, until the process restarts. `83a85739` released the units at the close and served the valid bearer.

**Second half (pre-existing since `5164fd03`, missed in round 1).** The same refusal spends nothing (failed count 0 on both heads). Amendment 12 item 4 says every refusal of the slot spends. The wrapper sees only refusals passed on through `next`, a throw or a rejection. Code review n8 and my round-1 route cover raw errors, not answers written by the slot.

**Rating.**

- **At this head: LOW.** The only production authentication slot is the TASK-020 stub, which always calls `next`. `startApi` passes no `authenticate` and no `pipeline` seam.
- **Impact Medium.** A per-instance lock of every credentialed request of an address, valid ones included, NAT neighbours included, until restart. Once a slot with the shape exists, honest refusals alone fill it: `limit` refused credentials of the address on an instance.
- **Likelihood Low.** It needs an authenticator that breaks the slot's implicit contract, and the slot contract (`routing/slot.ts`) does not state it.
- **MEDIUM if it shipped in an authenticator.** The hang variant is D-ARCH-226 item 3's accepted defect class (the gauge shows it; code review round 3 probe P9 shows the same lock and rules it by design). Round 1's addition (b) bounds it for I/O. The direct-answer variant is not a hang: the client got its answer, so nothing but the gauge would show it.

**Remediation.**

- **(a) Required, as card lines** (TASK-052, -055, -091, -171, -261; this extends round 1's route "every refused presented credential is a 4xx `AppError`").
  - The authentication slot reports its outcome only by calling `next` once, with or without an error, by throwing, or by rejecting. It never writes the response.
  - Each task adds one api row per refused shape: the failed count rises by 1, and the held count is back to 0 after the response.
  - Optional: a lint restriction on response writes (`res.status`, `.json`, `.send`, `.end`, `.redirect`) under `apps/api/src/platform/authn/**`.
  - The sentence belongs in the JSDoc of `RouteSlot` or of `authenticate.ts` when TASK-052 replaces the stub.
- **(b) Optional hardening, the architect's call**, because it adds a release to amendment 13 item 6 "Release". The wrapper also treats the response's `finish` before an outcome as the outcome and releases the unit there. A client cannot cause `finish` by leaving, so R2-M1 does not come back.
  - Validated on a scratch copy by registering `res.once('finish', …)` right after `let settled = false;`: if the outcome has not settled, mark it settled and release. Results: PH 0 units and 200; PA2 5 in four shapes; PB unchanged.
  - Whether that path should also spend, or log a defect line, is a design question I leave to the architect. I would at least log it.

**Verification test.** An api row with a seam slot that answers 401 itself, `limit` times. With (b), a valid credential is then served. With (a) alone, the authenticator tasks' rows catch the shape before it ships.

## R2.5 D-TASK041-20: a holder released before the slot does not enter

The orchestrator asked four questions about the early return. The answers are below.

- **When `enter` returns false.** Only when `releaseUnentered` has already run (`GONE`), which is step 0's handler for the response `close`. In Node 24 that event fires once the response has finished or the connection has gone (destroyed, reset, half-closed and ended, or Node's own request timeout, which writes a 408 when nothing was written yet and destroys the socket).
  - Between step 0 and the slot, nothing finishes a response and then continues the chain. The request context, the access log, CORS preflight, the JSON parser and the context slot either call `next` or end the request themselves (`OPTIONS`, preflight and docs are never credentialed).
  - So on this pipeline a false `enter` means the client has gone. The access line was written at the close (`aborted: true`, `route: null`).
- **Is the request left hanging?** No. Nobody waits for it. Probe PG: 96 early returns over two ways of leaving, 0 server connections afterwards and no error line. Nothing writes to the closed response, because the wrapper calls neither the slot nor `next`.
- **Resource leak?** None found.
  - Every response object, the early returns included, was garbage-collected: 63 of 63 and 66 of 66 under `FinalizationRegistry` after forced GC.
  - The ledger keeps a `GONE` mark in a `WeakMap` keyed by the response, which goes with it.
  - No step before the slot starts a timer, a transaction or a stream slot that a later step would release. `contextSlot` only sets the descriptor and the deprecation headers.
  - The address is served normally afterwards.
- **Counting.** The early return is counted under no label. It was admitted, not refused, and the access line records the abort. I agree.
- **TASK-108 note.** If the 30 s timeout of REQ-SEC-015 answers a stalled request itself, its `finish` and `close` release the unentered unit, and a body that completes later stops at the wrapper. That is correct. If the timeout fires after the slot was entered, the outcome releases the unit. TASK-108 needs no new card line for this.

## R2.6 The test seams of D-TASK041-22

`RateLimitDependencies.inFlight` and `.breakerClock` default to a fresh ledger and to the breaker's own `Date.now` (`kit.ts:37`, `:47`). The only production composition is `startApi` → `createApp`. `startApi` passes the object literal `rateLimit: { settings: config, valkey: services.valkey }` (`start-api.ts:147`), so neither seam is set.

- `config` is the env-derived, Joi-validated `Config`. It sits under `settings`, so it can reach neither seam, and it holds no functions.
- No other production file calls `createApp`, `createRateLimitKit`, `createInFlightLedger` or `createStoreBreaker` (`git grep` excluding tests and `tests/`).
- `startApi`'s own `createApp` injection, used by `start-api.denial-budget.api.test.ts` to set the clock, is the part-A test seam. It is unchanged.

**Concur.** Code review R3-n3 (optional) asks the startApi row to assert that `rateLimit` carries only `settings` and `valkey`, and notes that unlike `authenticate` these seams are not refused in live mode. I concur with that row as a regression pin. Refusing the seams in live mode would also be acceptable, but it is not needed while `startApi` builds the literal.

## R2.7 My round-1 additions to the (d) wording

| Addition | State on main `f2055342` |
|---|---|
| (a) A declared `Content-Length` above the body limit with no bytes sent belongs to "a body that it never completes"; the TASK-108 timeout runs from the arrival of the request | **Not folded.** Amendment 13 item 6 still reads "a body that it never completes" and "becomes the 30 s of REQ-SEC-015 with TASK-108". The card line (TASK-108, round 1 routes) carries the substance |
| (b) "No timer" rests on bounded authenticators: a card line for TASK-055 and every later authenticator that does I/O | **Not folded** into the ADR text. The JSDoc of `in-flight.ts` at this head says it ("every authenticator is bounded by its own timeouts, and one that never answers shows as a unit that stays held") |
| (c) No security event for the hold | Concurred in round 1; built so (probe PC) |

`f8794de2` predates my round. D-ORCH-158 records that the architect folds (a) and (b) into amendment 13 item 6 at its next touch. The PR041-SEC-16 contract sentence belongs in the same "Release" paragraph. None of this is a merge condition of part 041-B, because the code is right either way. I check the fold in my G3 threat-model alignment (round 1 route).

## R2.8 Record binding, simulation and the merge-only checklist

- **Binding.** The `Head` row of this round names `12b8a10a`. The file now has two `Head` rows: round 1's `83a85739` and this one. The checker passes on any named commit of the PR after which no owned path changed. That is `12b8a10a`, because the fix cycle changed owned paths after `83a85739`. This round's `Verdict` row is the last row of the file.
- **What voids it.**
  - A fix cycle 3 that touches an owned path.
  - A main-side change to one of the 21 owned paths that the merge keeps.
  - A #82 squash that differs from `be843ae1` on a file part B also changes.
  - A lane-B evidence commit on the branch keeps it.
- **The merge-only round after #82 (C3).** Round 1's items 1 to 7 stand. Item 3 now reads: `git diff --raw <main> <merge>` equals `git diff --raw be843ae1 12b8a10a`, old and new blob of every path. If a further fix cycle follows, the bound head replaces `12b8a10a` there. In the simulation below, the merge still has **16 conflicts** (11 add/add, 5 content), the same set as round 1, because fix cycle 2 touched no file outside it.

**Simulation.** Main's real `tools/ci/check-security-owned-paths.mjs` ran in a `--shared` sparse clone of the main checkout. The record with this round appended was placed as `PR-9999-TASK-041B-security-review.md` on a simulated main, where #82 is squash-merged as one commit on `origin/main` `f2055342` with tree `git merge-tree --write-tree origin/main be843ae1`. The part-B head `12b8a10a` was then merged into it, with conflicts resolved to the branch blob unless a row says otherwise. The checker ran `--pr 9999 --base <simulated main with the record> --head <merge>`. "Item 3" is the old-and-new-blob equality of the merge-only round.

| Scenario | Expected | Checker | Item 3 |
|---|---|---|---|
| S1 The merge ref: the record (rounds 1 and 2) on main after the squash, `12b8a10a` merged (16 conflicts, all to the branch blob) | pass | pass (`12b8a10a`, 21 owned; a note says that `83a85739` is followed by owned changes) | equal (26 files) |
| S2 Control: no record | fail | `missing` | equal |
| S3 Control: the placeholder name only | fail | `missing` | equal |
| S4 Control: this round's `Verdict` row `FAIL` | fail | `missing` (verdict FAIL) | equal |
| S5a Control: the round-1 record only (its row names `83a85739`) | fail | `missing` (owned paths changed after it) | equal |
| S5b Control: this round's head row names `83a85739` | fail | `missing` | equal |
| S6 Control: a fix cycle 3 changes `in-flight.ts` after the head | fail | `missing` | differs |
| S7a Control: main changes `policy.ts`, and the merge keeps both changes | fail | `missing` | differs |
| S7b Main changes `policy.ts`, and the merge drops main's edit | checker pass, item 3 catches | pass | **differs** |
| S8 A docs-only main commit after the record | pass | pass | equal |
| S9 A lane-B evidence commit on the branch after the head | pass | pass | equal (with the evidence commit as branch head) |
| S10 The head row with the 8-character SHA | pass | pass | equal |
| S11 One conflict (`limits.ts`) resolved to the squash side, which drops part B there | checker pass, item 3 catches | pass (20 owned) | **differs** |
| S12 Main changes the unowned `app.ts`, and the merge drops main's edit | checker pass, item 3 catches | pass | **differs** |

14 of 14 as expected. #82's simulated squash equals `be843ae1` on every part-A file, and the merge carries the blob of `12b8a10a` for each of the 26 part-B files.

The record has two `Head` rows (rounds 1 and 2) and two `Verdict` rows; the last row of the file is this round's `Verdict` row.

## R2.9 Conditions and routes

**Conditions (merge of part 041-B).**

- **C1 of round 1 is discharged**: fix cycle 2 passed this delta round.
- **C2 stands.** Lane B runs on the merge head after #82: H6 against a real Valkey, the api project with the new H rows, `in-flight.test.ts`, the generated project and gitleaks-full. Hosted lane A and `security-integration` run when billing allows.
- **C3 stands.** The merge-only round after #82 merges covers items 1 to 7 of round 1 section 8, with item 3 bound to `12b8a10a`. It is not a pure merge (16 conflicts).
- **C4 stands.** The rename and the merge-ref check (D-ORCH-136/138).
- If code review round 3 leads to a further commit that touches an owned path, a delta round of mine binds that head before C3.

**Routes (card lines, for senior-developer's next fold unless stated).**

- TASK-052, TASK-055, TASK-091, TASK-171, TASK-261 (extends round 1's route): the authentication slot reports its outcome only through `next` once, a throw or a rejection, and never writes the response. One api row per refused shape: the failed count rises by 1, and the held count is back to 0 after the response (PR041-SEC-16 (a)).
- principal-architect (optional, amendment 13 item 6 "Release"): the wrapper releases an entered unit at `finish` when no outcome has been reported, and possibly logs a defect line or spends. Candidate validated (PR041-SEC-16 (b)). Folding round 1's additions (a) and (b) is already routed by D-ORCH-158.
- senior-developer (next fold or with TASK-052's disconnect rows): the `gzip`-body api row for D-TASK041-20 (PR041-SEC-15).
- Round 1's routes stand unchanged: TASK-108, TASK-055 bounded slot latency, TASK-214 event-loop gauge, TASK-052 cap, product-manager R-16 sentence, and mine before G3.

| Verdict | **PASS_WITH_CONDITIONS.** Round 2 of part 041-B (delta `83a85739..12b8a10a`, fix cycle 2) at `12b8a10a`: 0 Critical, 0 High, 0 Medium. Closed: PR041-SEC-10 (C-1 verified; abort probe 5 entries in six shapes at limit 5, ledger empty; control 11 to 117, mutants 9 to 98) and PR041-SEC-02 (b), so PR041-SEC-02 is closed in full. C-2 verified (label `step0-authn-inflight`, `held` flag, an early abort counted under no label, no event), C-3 verbatim, D-TASK041-20 confirmed (0 authenticator entries through the `gzip` window against 20 to 31 without the guard; no hang, no leak), the D-TASK041-22 test seams unreachable from production. New: PR041-SEC-15 INFO (the D-TASK041-20 guard has unit rows only), PR041-SEC-16 LOW (a slot that never reports its outcome keeps its unit until restart, and its refusal spends nothing; card lines, optional hardening validated). Round 1's additions (a) and (b) to the (d) wording not folded yet (D-ORCH-158 routes them; not a merge condition). C1 discharged; conditions C2 (lane B on the merge head with H6), C3 (merge-only round after #82, item 3 bound to `12b8a10a`, 16 conflicts) and C4 (rename and merge-ref check) remain |
