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
