# Code review: TASK-041 part 041-B, failed-authentication budget, store breaker and fallback set (pre-PR, round 1)

| Field | Value |
|---|---|
| Task | TASK-041 part 041-B (rulings revision 2; ADR-0016 amendment 12 items 3, 4, 7, 8 and amendment 13; PR041-SEC-02 (b), PR041-SEC-09; R1-m4 of the part-A review) |
| Branch / head | `feat/TASK-041-part-b-rate-limit-rulings-rev2` at `e7354249`, not pushed, no PR number yet (opens after PR #82 merges; D-ORCH-150) |
| Delta reviewed | `be843ae1..e7354249`: `5164fd03` (feat), `1cbc5aef` (config test sentinel), `e7354249` (api/README §7 and §13); 23 files, 1,773+/105- |
| Base | PR #82 head `be843ae1` (part 041-A, approved; lane B PASS). `origin/main` is `a4ecdbf7`; `git merge-tree --write-tree origin/main e7354249` is clean today and no file of the branch is changed on main since the merge base `530629f4` |
| Reviewer | code-reviewer, 2026-11-21 |
| Bindings read | Brief `docs/04-plan/briefs/TASK-041B.md` (card verbatim); rulings `wave-1-task-041-rulings.md` §4, §5.2, §6 lines 9-14, §8; ADR-0016 amendment 12 items 3-11 and amendment 13 items 1-5; D-ARCH-181/182; D-API-003; security record PR-0082 R2.3 (E1-E5), R2.4 (PR041-SEC-09), R2.7; my part-A record PR-0082 (R1-m4, R2-n1, R2-n2); developer decisions D-TASK041-10..16 (handoff report) and D-TASK041-17 (commit body) |

```
VERDICT: CHANGES_REQUESTED (one MAJOR, closable by a fix or by an architect ruling; see §5)
SUMMARY: B1-B5, R1, E1-E3 and the D-ORCH-148 sentinel are built as ruled, the README rows are verbatim, and every
         brief acceptance row has a titled test; 19/19 api rows and 313 unit rows pass here, 9 of 12 mutants die.
         MAJOR R1-M1: the budget is read at step 0 and spent after the slot, so a concurrent burst passes the gate
         untouched (probe: limit 5, 60 parallel junk bearers = 60 authenticator calls, 60 x 401, zero 429).
```

## 1. What I verified myself

Host rule (dispatch): every command in the foreground, one at a time, no Docker, nothing run in the lane-B worktree. All runs below are on a `git archive e7354249` extract in my scratchpad, with a junction to the worktree's `node_modules` and the git-ignored `prisma/generated` copied in. The copy was compared file by file with `e7354249` after every mutation batch.

| Check | How | Result |
|---|---|---|
| Delta and base | `git log`/`git diff be843ae1..e7354249`; worktree `HEAD` = `e7354249`, clean | 3 commits, 23 files. The worktree's `@platform/*` links resolve to the same tree |
| Main drift | merge base `530629f4` with `origin/main` `a4ecdbf7`; `comm -12` of the two file lists; `git merge-tree --write-tree origin/main e7354249` | No shared file, merge-tree clean. The real check comes after #82's squash lands (§6 C5) |
| Unit Jest (new and changed suites) | `--selectProjects unit --testPathPatterns "rate-limit/(breaker\|authn-failed\|rate-limit)\.test\|access-token-precheck\|load-config\.test"` | 5 suites, 313/313 pass |
| API Jest, B1/B2/E2/E4/E5 rows | `--selectProjects api --testPathPatterns rate-limit/authn-failed\.api` | 19/19 pass (9.2 s) |
| Mutation selection | unit + api projects over `platform/rate-limit/`, `platform/authn/`, `start-api*`, `runtime-seams`, `capture.api` | 17 suites, 376/376 pass at the head (22 s) |
| 12 mutants | `mutate-041b.cjs` (scratchpad), one mutant at a time, restored in `finally` | 9 of 12 killed. Killed: K4 declared-credential check dropped, K5 gate `<=`, K6 outage gate not read from the fallback, K7 probe guard removed, K8 cookie-path check dropped, K9 `reached` off by one, K10 `public-tracking` back to fail-open, K11 counter label fixed, K12 `alg` check removed. **Survived: K1 kit store built without the breaker, K2 denial budget not given the breaker, K3 wrapper skipped for a replaced pipeline** (m2) |
| Probe P1, spellings | After the budget of IP A is spent (limit 5): 7 junk bearers each to `/api/v1/me`, `/api/v1/ME`, `/api/v1/me/`, `/api/v1/Me`, then a valid bearer to `/api/v1/ME` | `[401 x5, 429, 429]`, then 429 on every other spelling and on the valid bearer. Under the exact prefix every spelling is gated (the prefix spelling of A1 and the cookie spelling of am. 13 item 1 are the ruled residuals) |
| Probe P2, burst | Seam authenticator that refuses after 20 ms (a stand-in for a verification or a lookup), limit 5, 60 parallel junk bearers from IP A | **60 x 401, 0 x 429, authenticator entered 60 times, failed count 60** (R1-M1) |
| Probe P3, falsy rejection | Slot `() => () => Promise.reject(undefined)` on a `[session]` route, without and with a kit | Without the kit Express 5 answers 500 `INTERNAL_ERROR` (router 2.2.0: `next(error \|\| new Error('Rejected promise'))`). With the kit the wrapper calls `next()`, the request runs on as unauthenticated and authorise answers 401 (m1) |
| README §7 text | Every quoted line of rulings §5.2 searched in `git show e7354249:docs/03-architecture/api/README.md` | Both paragraphs present verbatim |
| README §13 cell | Compared with D-API-003 (`docs/sdlc/DECISIONS.md:5271`) | The `rate_limit_auth` Emitted-when cell equals the D-API-003 "full cell"; Event and Extra-fields cells unchanged (SEC-TC-63). Runtime row: (i) and (ii) applied (n6) |
| Valkey ACL | `infra/local/valkey/users.acl` (part-A read) | `~rl:*` covers `rl:step0:authn-failed:*`; `GET`, `PTTL`, `INCR`, `PEXPIRE` are in `+@all -@dangerous` |
| jose expiry rule | Read against E2: `exp <= now - tolerance` is jose's `JWTExpired` test | The helper matches it; a negative `exp` is `malformed` (spends) where jose would say expired: the stricter E2 reading, accepted |

**Not re-run here:** `npm run typecheck`, the repository ESLint run, the integration suite (Docker) and the whole api/generated projects. For those I rely on the developer's report (typecheck clean twice; ESLint 0 problems on the changed files; 92 + 13 suites green; coverage of changed files 99.47 % line / 96.35 % branch) and on lane B at the final head (§6 C2).

## 2. Findings

| ID | Severity | file:line | Issue | Required fix |
|---|---|---|---|---|
| R1-M1 | MAJOR | `apps/api/src/platform/rate-limit/limits.ts:141-144` (step 0 reads the gate), `apps/api/src/platform/rate-limit/authn-failed.ts:59-65` (the spend after the slot) | **A concurrent burst is not bounded by the failed-authentication budget.** The gate is read at step 0 and the unit is spent only after the authentication slot has refused. Every request that reaches step 0 before the earlier refusals have been spent passes the gate. Probe P2: limit 5, 60 parallel junk bearers from one IP gave 60 x 401, zero 429, 60 authenticator calls and a failed count of 60. The bound per IP and window is therefore the in-flight count, up to the credentialed ceiling (6,000/min), not `RATE_LIMIT_PUBLIC_PER_MIN`. ADR-0016 amendment 13 item 2 accepts the IP-wide lock "because a forged credential must not reach verification at the ceiling rate"; one burst per window does exactly that and still triggers the lock for the IP's valid users. The refusals that matter most are the refresh-cookie lookups of TASK-055 (I/O, R-ARCH-36 (a)). Neither the rulings, the security record nor the tests (all sequential) cover concurrency. Nothing is exposed until TASK-052/055/091/171/261 give the slot a cost. | Either (a) **code:** a per-instance in-flight reservation, with no extra round trip. Step 0 hands the peeked count to the wrapper (for example on `res.locals`); a per-IP counter of credentialed requests between step 0 and the slot's outcome is added to it; step 0 refuses with the gate reading when `peeked + inFlight >= limit`. The overshoot is then bounded by replicas x limit. Test: 60 parallel junk bearers with limit 5 enter the authenticator at most 5 times on one instance. Or (b) **ruling:** principal-architect records the residual and its bound (one burst per IP and window, up to the ceiling) in ADR-0016 amendment 13 and R-ARCH-36 as (d), security-analyst rates it in the QG-041-C4 round, and the forged-credential cards (TASK-052, -055, -091, -171, -261) gain a parallel-burst row so the residual is measured where it costs. (a) is my recommendation |
| m1 | MINOR | `apps/api/src/platform/rate-limit/authn-failed.ts:71` | **A slot promise rejected with a falsy value now continues the request.** `result.then(undefined, done)` passes `undefined` to `done`, which calls `next()`. Express 5 alone turns the same rejection into `new Error('Rejected promise')` and a 500 (probe P3). With the kit the request runs on without a principal; authorise answered 401 on the `[session]` fixture, but on a route that also declares `anonymous` it would be served anonymously, and the slot's fault is never logged. The wrapper changes the fail-closed default of the router it says it mirrors (D-TASK041-13). | `result.then(undefined, (error: unknown) => done(error \|\| new Error('Rejected promise')))`, as `router/lib/layer.js` does, and one unit row (`Promise.reject(undefined)` is passed on as an error and spends nothing) |
| m2 | MINOR | `apps/api/src/platform/rate-limit/kit.ts:35`, `apps/api/src/app.ts:174`, `apps/api/src/app.ts:207` | **The breaker and wrapper wiring of the composition is unpinned.** Mutants K1 (the kit's Valkey store built without the breaker), K2 (`storeBreaker: kit?.breaker` removed, so the denial budget gets its own unguarded calls) and K3 (the wrapper skipped when `deps.pipeline` replaces the slots) all survive the 17 rate-limit, authn, start-api, seams and capture suites. The B3 row "a failure of the limiter makes the denial budget skip the store" is proved on a pair the test builds by hand (`breaker.test.ts:134-158`), not on what `createRateLimitKit` and `createApp` compose; the same holds for D-TASK041-13's "replaced pipeline". This is the wiring-pin pattern of part A (R1-m3). | One api row through `createApp` (or `startApi`) with a hanging `FakeValkey`: the first request waits for the 250 ms bound, a following request and a denial make no store call (`valkey.calls` unchanged) until the cool-down; and one row with `pipeline:` plus `rateLimit:` in which a refusal of the replaced slot spends one unit |
| n1 | NIT | `apps/api/src/platform/rate-limit/limits.ts:162-166` | The JSDoc says a cookie route "can never be served under a path step 0 does not know". The Express routers are case-insensitive and not strict, so `/api/v1/auth/refresh/` (proved by `authn-failed.api.test.ts:315`) and `/API/V1/auth/refresh` are served under the anonymous budget. Amendment 13 item 1 accepts that; the comment overclaims | Say that another spelling takes the unauthenticated budget (amendment 13 item 1) |
| n2 | NIT | `apps/api/src/platform/rate-limit/breaker.test.ts:103-107` | Twenty wall-clock `< 5 ms` assertions run under lane B's load; one GC pause fails the suite. The deterministic proof is `valkey.calls === 1` (D-TASK041-16 says so) | Keep the call-count pin and bound the sum of the 20 (for example under 50 ms), or widen the per-call bound; if it ever flakes, widen it, never retry it |
| n3 | NIT | `apps/api/src/platform/authn/access-token-precheck.ts:38-42` | `nowSeconds` is not stated as whole seconds. jose compares against `Math.floor(Date.now() / 1000)`; a caller that passes a fractional clock moves the expired boundary by up to 1 s against the verification | State "whole seconds, as jose's `epoch()`" in the JSDoc (the E5 tests already pass `Math.floor`) |
| n4 | NIT | `apps/api/src/platform/rate-limit/authn-failed.ts:64`, `:71` | `.catch(() => undefined)` drops a throw of `kit.events.emit` without a line, and a rejection that arrives after `next` was already called is dropped too | A one-line comment that both are deliberate, or a `warn` with the error class only |
| n5 | NIT | `apps/api/src/platform/rate-limit/store.ts:124-136`, `:194-203` | `PEEK_SCRIPT` and the Valkey `peek` have no production caller (D-TASK041-11: only the memory fallback's `peek` is used). They are tested against a real Valkey, so they are cheap to keep | Keep, or drop them from the Valkey store until a caller needs them |
| n6 | NIT | `docs/03-architecture/api/README.md:510` | D-API-003 (ii) asked for "Shared with the `auth`-class fallback of ADR-0016 amendment 12 item 8"; the branch writes "Shared with the fallback of ADR-0016 amendment 12 item 8". The shorter text is more accurate for the wider set | api-designer notes it at the next fold; no change needed here |
| n7 | NIT | `apps/api/src/platform/rate-limit/store.ts:104-122` | `HIT_AND_PEEK_SCRIPT` takes `rl:step0:credentialed:<ip>` and `rl:step0:authn-failed:<ip>`, which land in different hash slots in a Valkey cluster (`CROSSSLOT`), as `TAKE_SCRIPT` already does (developer note 2). Valkey is not clustered in this run; `platform.md:1298` lists cluster mode only for "100x" | Route to data-architect and devops: add the two-key `rl:` scripts to the 100x line, with the hash-tag change of the key grammar that cluster mode would need |
| n8 | NIT | `apps/api/src/platform/rate-limit/authn-failed.ts:33-35` (D-TASK041-12) | A non-`AppError` out of the slot spends nothing and becomes a 500. If TASK-052 lets a raw jose error escape for some forged shape, that shape is a budget-free 500 | TASK-052 card: every forged or malformed bearer answers 401 through an `AppError`, never 500 (one test row per E2 shape) |

## 3. Requirements trace (brief "Acceptance")

| Row | Test | Status |
|---|---|---|
| B1 (1) to (7) | `authn-failed.api.test.ts:172-248` | Met (sequential); (6) shares one `FakeValkey`, the real two-replica Lua is in `rate-limit.int.test.ts` (lane B) |
| B1 (8) startApi with the production slot | `start-api.denial-budget.api.test.ts` new describe | Met |
| B1 (9) to (13) | `authn-failed.api.test.ts:270-357`, `authn-failed.test.ts:91-104` | Met; (13) through `createApp` and `bootFailureOf` |
| B2 | `authn-failed.api.test.ts:361` (121 signed requests), selector rows | Met |
| B3 | `breaker.test.ts` | Met on the module; composition unpinned (m2) |
| B4 | `rate-limit.test.ts` "[B4]" rows | Met |
| E2, E3 | `access-token-precheck.test.ts` | Met |
| E4, E5 | `authn-failed.api.test.ts:206-216`, `:414-461` (real `jose.jwtVerify`) | Met |
| PR041-SEC-09 / R2 (i) | `authn-failed.api.test.ts:280` | Met |
| Integration (two-key script, TTL repair, two replicas, key grammar, PTTL 1..60000) | `rate-limit.int.test.ts:142-195` | Written; first run in lane B |
| D-ORCH-148 | `load-config.test.ts:124-138` | Met; `<ttl?>` cannot be a Windows path substring, and `rendered` (message, formatter, JSON, inspect, stack) does not escape `<`, `>` or `?`, so the check is not vacuous |
| B5 README | `README.md` §7, §13 | Met (verbatim) |
| Part-A open items | R2-n1 (i)-(iii) closed; R2-n2 closed (`StepZeroOptions` is required); R1-m4 closed by B3; R1-m7 closed by the card ("Stories (completes) —", US-040 partial); R1-n6 still open (NIT, not in this delta) | |

## 4. Rulings on the developer decisions

| Decision | Ruling |
|---|---|
| D-TASK041-10 breaker around the bounded call and its reply check; one per `createApp`; only `RateLimitStoreError` opens it when closed, any failed probe re-opens it; malformed denial replies become `RateLimitStoreError` | **Accepted.** The placement is right (a malformed reply opens it: `breaker.test.ts:117`). The "one per process" claim holds because `startApi` calls `createApp` once; pin the wiring (m2) |
| D-TASK041-11 `hitAndPeek` and `peek` on the port; outage reads the gate from the fallback | **Accepted.** One round trip on the hot path, as rulings §8 requires. `peek` on Valkey is unused (n5) |
| D-TASK041-12 a spending refusal is a 4xx `AppError` other than `ACCESS_TOKEN_EXPIRED`; the wrapper waits for the spend | **Accepted.** Waiting makes the sequential bound exact. It does not make the concurrent bound exact (R1-M1). The non-`AppError` exemption creates a TASK-052 obligation (n8) |
| D-TASK041-13 wrap the slot in effect (default, seam, replaced pipeline); sync throw and rejection are refusals; first outcome only | **Accepted with m1** (falsy rejection) **and m2** (the replaced-pipeline branch is untested) |
| D-TASK041-14 literal cookie-route paths, refused at boot, exit 78 | **Accepted.** `LITERAL_PATH` admits only unreserved characters, so no path-to-regexp v8 token can pass; the trailing slash is refused too. JSDoc n1 |
| D-TASK041-15 pure pre-check helper for TASK-052 | **Accepted.** E1-E3 hold: length cap, three base64url segments, `alg === 'ES256'` before the payload is decoded, only a finite `exp` in 0..253402300799 at or before `now - tolerance` is expired, nothing of the payload is returned. TASK-052 consumes it or replaces it and re-runs E5. n3 |
| D-TASK041-16 B3 timing bounds plus the call count | **Accepted**, with n2 |
| D-TASK041-17 sentinel `<ttl?>` | **Accepted.** D-ORCH-148 is closed for TASK-284 and TASK-015 part 015-C (they drop the line) |
| Brief rule 4 (no new key, dependency or lockfile change) | Met: `package-lock.json` and `packages/config/src/schema.ts` are not in the delta |
| Brief rule 6 (files of other tasks) | Met: nothing under `idempotency/`, `tx/execute.ts`, `outbox/` or the worker |

## 5. What closes this round

R1-M1 by (a) a fix commit with the parallel-burst test, or (b) the architect ruling, security rating and card rows described in the finding. If (b), I re-check only the record and the cards, and the verdict becomes APPROVED_WITH_NITS without a code change. m1 and m2 are small and should ride the same fix commit; if they do not, they go to TASK-052's dispatch as conditions. A round 2 reviews the fix commits only.

## 6. Merge conditions

- **C1.** R1-M1 closed (§5).
- **C2. Lane B at the final head:** `rate-limit.int.test.ts` (three new real-Valkey cases: the two-key script, the TTL repair, two replicas reaching the limit once with the key grammar and PTTL in 1..60000); the api project, including `authn-failed.api.test.ts` (19), `limits.api.test.ts`, `start-api.denial-budget.api.test.ts` (B1 (8)) and `runtime-seams.api.test.ts`; the generated project (RBAC matrix composes `createApp` without a kit; the boot check of `refreshCookieRoutePaths` runs for every composition). Lane A: the `security-integration` job (owned paths under `apps/api/src/platform/**` and `packages/config/**`).
- **C3. Security round** QG-041-C4 second half on the final head: amendment 12 items 4 (with PR041-SEC-09 and E1-E5), 7 and 8; PR041-SEC-02 (b) closes here; R1-M1 option (b) needs their rating. `app.ts` and `pipeline.ts` changed, so their C3 of round 2 applies.
- **C4. QG-041-C2 second half** (product-manager: REQ-SEC-006, A-053, EC-A32 wording for the wider fallback set and `CARRIER_BUSY`) before merge, as the brief says.
- **C5. After PR #82 merges:** merge `origin/main` into this branch (no rebase). Then prove the merge: the squash of #82 must equal `be843ae1` on the part-A files (`git diff --stat be843ae1 <squash> -- <files of 530629f4..be843ae1>` empty, except files that main changed independently), and `git diff origin/main <merge>` must equal `git diff be843ae1 e7354249` file by file (or the fix head's delta), with any hand resolution in `app.ts`, `limits.ts`, `README.md` shown by `git show --cc`. A clean, pure merge does not need a code-review round; a hand-resolved code file does (delta only). The security binding then moves to the merge head.
- **C6.** The orchestrator records D-TASK041-10..17 in DECISIONS.md (brief rule 7), and routes n7 (cluster hash slots) and n8 (TASK-052 401-only row).

## 7. Good

- The wrapper is composed once in `createApp`, around whatever slot is in effect, so no authenticator can forget to spend, and it reads only the kinds the route declares (D-ARCH-109), with a unit table for each kind.
- One script, one round trip, and the outage path reads the gate from the same per-instance store the outage spends went to: the two halves cannot disagree during an outage.
- The breaker sees the bounded call and its reply check together, so a malformed reply opens it as a timeout does.
- The pre-check helper is pure, bounded before decoding, and the E5 rows run it in front of a real `jose.jwtVerify`.
- The sentinel fix removes the path dependence at its cause instead of filtering stack text.

## 8. Security flags (for security-analyst)

- R1-M1: the burst bypass of the failed-authentication budget (CWE-307 / CWE-770 class); P2 is reproducible with the probe in my scratchpad (`zzcrprobe.api.test.ts`, three cases, 3 s).
- m1: a falsy rejection of the authentication slot continues the request without a principal when the kit is composed (fail-open to anonymous on optional-auth routes).
- n7: two-key `rl:` scripts in a future cluster deployment.
- n8: raw (non-`AppError`) authenticator errors spend nothing.


---

# Round 2: delta `e7354249..83a85739` (fix cycle 1)

| Field | Value |
|---|---|
| Head | `83a85739` on `feat/TASK-041-part-b-rate-limit-rulings-rev2` (parent `e7354249`), not pushed, no PR number yet. The worktree `HEAD` is `83a85739` and clean |
| Delta reviewed | One commit, `83a85739` (`fix(api)`, D-TASK041-18 in the body): 13 files, 496+/42-. New: `apps/api/src/platform/rate-limit/in-flight.ts` and `in-flight.test.ts` |
| Base | PR #82 is still **OPEN** at `be843ae1` (`gh pr view 82`). `origin/main` is `bf9f3454`; the merge base is still `530629f4`, no file is changed on both sides, and `git merge-tree --write-tree origin/main 83a85739` is clean |
| Bindings read | Round 1 of this record; the commit body (D-TASK041-18); D-ORCH-157 (`docs/sdlc/DECISIONS.md:9082`); ADR-0016 amendment 12 item 11 and amendment 13; R-ARCH-36 (`docs/03-architecture/risks.md:42`) |
| Reviewer | code-reviewer, 2026-11-21 |

```
VERDICT: CHANGES_REQUESTED (one MAJOR, closable by a small fix or by the R-ARCH-36 (d) ruling now being drafted; see R2.5)
SUMMARY: R1-M1 is fixed for clients that wait for their answer: limit 5, 60 parallel junk bearers now reach the
         authenticator 5 times (probe P2 re-run), and R1-m1, R1-m2 (K1-K3) and n1-n5 are closed; 14/14 mutants die.
         MAJOR R2-M1: a client that aborts after admission frees its unit while its authentication still runs (P4b: 60 of 60).
```

## R2.1 What I verified myself

I ran everything in the foreground, one command at a time, with no Docker. Nothing ran in the lane-B worktree. All runs used a `git archive 83a85739` extract in my scratchpad (`review/TASK-041B-cr2/copy`), with a junction to the worktree's `node_modules` and the git-ignored `prisma/generated` copied in. After the mutation batch I compared the six mutated files byte for byte with `git show 83a85739:<file>`: all were equal.

| Check | How | Result |
|---|---|---|
| Delta | `git log` / `git diff e7354249..83a85739` | 1 commit, 13 files. Only `apps/api/src/**` is touched; no lockfile, config schema or file of another task |
| Main drift | merge base, `comm -12` of both file lists, `git merge-tree --write-tree origin/main 83a85739` | No shared file; merge-tree clean. #82 is not merged yet, so R2.6 C3 is still ahead |
| Jest selection | unit + api projects, `--testPathPatterns "platform/rate-limit/\|platform/authn/\|start-api\|runtime-seams\|capture\.api"`, `--maxWorkers=2` | **398/398 pass** (31 s) at the head |
| Prettier | `prettier --check` on the 13 changed files | Clean. Two comment lines are over the wrap width (R2-n3) |
| Probe P2 (round-1 burst, re-run) | `zzcr2probe.api.test.ts`. The seam refuses after 20 ms; limit 5; 60 parallel junk bearers from one IP | **5 x 401, 55 x 429; authenticator entered 5 times, peak concurrency 5, failed count 5** (round 1: 60 x 401, 0 x 429) |
| Probe P4a, abort at slot entry, parallel | 60 parallel requests; the socket is destroyed when the slot is entered; slot 200 ms | 5 entered, 55 x 429. All 60 passed step 0 before any abort, so the released units found no taker |
| **Probe P4b, abort after admission, staggered** | 60 junk bearers, one every 3 ms. Each client destroys its socket 15 ms after sending, which is after step 0 answered and before the 300 ms slot ends | **authenticator entered 60 times, 60 authentications in flight at once, failed count 60** (R2-M1) |
| Probe P4c, control | P4b without the abort | 5 entered, 5 x 401, 55 x 429 |
| Probe P5, reply-order race | `zzcr2race.ts` (tsx), over `createRateLimitKit` with the breaker-wrapped Valkey store. The client runs scripts in Valkey order and delivers queued replies in one synchronous step, as ioredis does for one socket chunk. Limit 1, Y admitted; X's step-0 script runs before Y's spend, and both replies are delivered together | X's admission (settled 0, held 1) runs **before** Y's release, so X is refused. When X runs after the spend, the gate refuses X. No undercount from reply interleaving in the production composition |
| Mutants | `mutate-041b-r2.cjs`, one at a time over the selection above | **14/14 killed.** K1, K2, K3 (round 1's survivors) now die. New: N1 close listener does not release; N2 `!closed` dropped; N3 ledger `>=` -> `>`; N4 non-spend path keeps the unit; N5 spend path keeps the unit; N6 release before the spend is issued; N7 outage path ignores `admit`; N8 `admit(0)`; N9 falsy rejection passed as is; N10 in-flight refusal retries after the gate window; N11 `ipLimiter` without the ledger |

**Not re-run here:** `npm run typecheck`, the repository ESLint run, the integration suite (Docker), the generated project and the whole api project. For these I rely on the developer's report (D-ORCH-157: lint 0, typecheck 0, unit 952, api files 50/50, changed-file coverage 99.79 % / 98.06 %) and on lane B at the merge head (R2.6 C4).

## R2.2 Closure of round-1 findings

| ID | Status | Evidence |
|---|---|---|
| R1-M1 | **Closed for waiting clients; reopened in part by R2-M1** | P2 re-run 5/55. The api row `authn-failed.api.test.ts` "60 parallel junk bearers with limit 5" kills N3 and N11. That row stays deterministic under load: `settled + held` never passes 5, so `entered` cannot pass 5 however the arrivals spread. A client that aborts after admission is not covered (R2-M1) |
| R1-m1 | Closed | `authn-failed.ts:83-85`. `Promise.reject(undefined)` and `Promise.reject(false)` become `Error('Rejected promise')`; a falsy synchronous throw becomes `Error('Thrown falsy value')`; none spends. The unit row kills N9. A falsy synchronous throw is stricter than the router (which would continue), which is the right side to err on |
| R1-m2 | Closed | K1 and K2 are killed by `start-api.denial-budget.api.test.ts` "[K1] [K2]" through `startApi`; K3 is killed by `authn-failed.api.test.ts` "[K3]" (replaced `pipeline` plus `rateLimit`). The K1/K2 row's dependence on the 5 s cool-down is R2-n2 |
| n1 | Closed | `limits.ts:184-186` now names the other spellings and the unauthenticated budget |
| n2 | Closed | The loop asserts `valkey.calls === 1` and `breaker.state() === 'open'`, with no wall clock. The one remaining bound (`>= STORE_TIMEOUT_MS - 5` on the first call) can only fail if a timer fires early |
| n3 | Closed | `access-token-precheck.ts:40-41` |
| n4 | Closed | Both silent drops are commented (`authn-failed.ts:57`, `:70-71`) |
| n5 | Closed | Kept, with the reason (`store.ts:124-129`) |
| n6 | Closed (routed) | README wording kept; api-designer notes it at the next fold |
| n7, n8 | Open, routed | Not in this delta; they stay with C7 |

## R2.3 Findings of this round

| ID | Severity | file:line | Issue | Required fix |
|---|---|---|---|---|
| R2-M1 | MAJOR | `apps/api/src/platform/rate-limit/limits.ts:153-158`, `apps/api/src/platform/rate-limit/authn-failed.ts:61-77` | **A client that aborts after admission frees its in-flight unit while its authentication still runs.** The `close` listener releases the unit whenever the response closes. Express does not stop a request whose client has gone, so the slot still runs, refuses, and spends later. The next admissions read `settled` without that refusal and `held` without its unit. Probe P4b: 60 junk bearers, one every 3 ms, each aborted 15 ms after sending, slot 300 ms, limit 5. Result: **60 authenticator entries, 60 in flight at once, 60 spends**; the control without the abort gives 5. Aborting is the natural behaviour of a flooding client, which never needs the 401. Per instance and window the bound becomes about `limit x (1 + slot latency / time from send to admission)`, not the `limit` that D-TASK041-18 states, and it grows when the slot slows down (the refresh-cookie lookup of TASK-055 under database pressure; R-ARCH-36 (a)). The JSDoc at `limits.ts:136-137` and the api test title "so an abort cannot skip the hold" cover only an abort **before** step 0 answers. As with R1-M1, nothing is exposed until TASK-052/055/091/171/261 give the slot a cost | Either (a) **code (recommended, a few lines):** once the wrapper has entered the slot for a holder, closing the response no longer releases its unit; the unit goes at the slot's outcome (`done`), after the spend. For example, `InFlightLedger.enter(holder)` marks it, and the `close` listener calls a `releaseIfNotEntered(holder)`. A slot that never settles then keeps its unit only for as long as it keeps the request, which the authenticator cards bound. Add one api row in the P4b shape (staggered requests, each aborted by the client after step 0 answered, slot slower than the abort): the authenticator is entered at most `limit` times. Fix the JSDoc and the test title. Or (b) **ruling:** principal-architect adds the abort case and its bound to the R-ARCH-36 (d) text being drafted under D-ORCH-157, and security-analyst rates it in the QG-041-C4 round |
| R2-m1 | MINOR | D-TASK041-18 (commit body; D-ORCH-157 `DECISIONS.md:9089-9093`); `in-flight.ts:1-14` | **The accepted cost is stated too narrowly for the R-ARCH-36 (d) text.** The ledger holds a unit for **every** credentialed request of the IP, valid ones included, from step 0 until the slot's outcome. That interval includes the JSON body upload, because `jsonBodyParser` runs between step 0 and the slot (`app.ts:214-216`). Three consequences follow. (1) With no failure at all, one IP with `RATE_LIMIT_PUBLIC_PER_MIN` (120 by default) credentialed requests between step 0 and authentication on one instance gets 429 `Retry-After: 1` on the next one. (2) After k refusals in the window, the IP's per-instance concurrency is `limit - k`. A client on a shared address can spend `limit - 1` and squeeze every user of that address to one request in that interval; `rate_limit_auth` is emitted only when the limit is reached. (3) A client holding 120 slow-body connections per instance (bounded by Node's default 300 s `requestTimeout`) keeps the IP refused without a spend or an event; only the `step0-authn-failed` counter rises. None of this is a new capability beyond the accepted residual (b), which locks the address outright with 120 junk requests a minute, but it is quieter. The D-ORCH-157 wording ("while the IP's failed-authentication limit is in flight") reads as if only failing requests counted | The R-ARCH-36 (d) / ADR-0016 am. 13 text says: "all credentialed requests of an IP, valid ones included, between step 0 and the authentication outcome, body upload included". It also names the squeeze (`limit - k`) and the quiet hold. security-analyst rates (2) and (3) with (d). No code change is required |
| R2-n1 | NIT | `limits.ts:121-124`, `limiter.ts:146` | An in-flight refusal and a request refused because its client had already gone are counted as `step0-authn-failed`, the same label as a spent window. TASK-214's alert cannot tell a lock from an in-flight squeeze, and it counts aborted clients as refusals | Route to TASK-214: a distinct label (for example `step0-authn-inflight`), or no count for a closed response |
| R2-n2 | NIT | `apps/api/src/start-api.denial-budget.api.test.ts:299-314` | The K1/K2 row relies on the real `BREAKER_COOLDOWN_MS` (5 s): the two later requests must finish within about 4.75 s of the breaker opening. A longer host stall in lane B sends a probe, and `valkey.calls === 1` fails. The risk is low | If it ever flakes, inject the breaker's clock through the kit dependencies; never retry it |
| R2-n3 | NIT | `apps/api/src/platform/rate-limit/kit.ts:4` (171 columns), `authn-failed.api.test.ts:4` (194 columns) | Comment lines over the wrap width. Prettier does not reflow comments | Rewrap with the next commit |

## R2.4 Rulings

| Item | Ruling |
|---|---|
| `in-flight.ts` ledger | **Accepted with R2-M1.** Check and hold happen in one synchronous step after the last `await`. Units are per IP (`clientIpKey(req.ip)`, the key of the gate and the spend). The holder is the `Response`, so a request holds at most one unit and `release` is idempotent (N1, N4, N5, N6 pinned). Memory: one map entry per IP with a request in flight, deleted at its last release, and one `WeakMap` entry per held response; nothing outlives the requests. Every admitted request is released exactly once in effect: at the slot's outcome, or at `close` when the slot is never reached (404, body-parser error, a refusal before the slot). That holds except that `close` also releases too early (R2-M1). P5 shows no undercount from reply interleaving |
| `consumeGated`'s `gated()` | **Accepted.** A spent gate refuses with the rest of its window before the rule is consulted; a request the rule refuses holds nothing; an in-flight refusal retries after 1 s (N10 pinned). `admit` is not asked when the gate is spent or the rule refuses (`in-flight.test.ts` "is not asked") |
| Rule-then-gate order on the outage path | **Correct.** (1) The order is needed. The gate's peek must be the last `await` before `admit`, otherwise a concurrent request could change `held` between the reading and the admission. (2) In `fallback` mode the rule's hit is now counted even when the gate refuses. That matches the healthy path: `HIT_AND_PEEK_SCRIPT` always `INCR`s `KEYS[1]` before it reads the gate (`store.ts:104-121`), so before this change the outage path was the inconsistent one. (3) No production caller uses `fallback` here: `ipLimiter` passes `fail-open` (`limits.ts:149`), so the rule's decision on the outage path is a constant and nothing is counted. The behaviour change has no production effect today |
| `ipLimiter` close and admit | **Accepted with R2-M1.** Never admitting a request whose response closed before the store answered is right (pinned by the api row and N2). The listener is registered in the same synchronous step that handles the request, so a `close` cannot be missed. Releasing on `close` after the slot was entered is R2-M1 |
| The wrapper's release | **Accepted.** Non-spend path: released before `next` (N4). Spend path: released in `finally`, after the spend has landed and before `next` (N5, N6). The unit test pins that the unit is still held while the spend is issued. Releasing at authentication rather than at `close` means long handlers (SSE streams, uploads after authentication) do not hold units |
| D-TASK041-18 | **Accepted with R2-M1 and R2-m1.** (i) Slack 0 per instance: met for clients that wait (P2, the api row, N3/N11), not for clients that abort (R2-M1). (ii) The cross-replica bound N x `RATE_LIMIT_PUBLIC_PER_MIN` per IP and window is the honest residual of a per-instance ledger without an extra round trip (rulings §8). The two-replica row pins at most 5 per replica. Recording it as R-ARCH-36 (d) is right. (iii) The cost (429 `Retry-After: 1`, slow uploads included) is acceptable under the accepted residual (b), with the wording of R2-m1 |
| `tests/serve.ts` lazy-start race | **Correct.** The map now stores the listening promise synchronously on the first call, so parallel first calls share one server, and `closeServedApps` closes the only one. Round 1's 59 leaked servers cannot recur |

## R2.5 What closes this round

R2-M1 can be closed in either of two ways:

- **(a) Fix commit (recommended).** It needs the abort-after-admission api row and the JSDoc/title fix. Round 3 then reviews that delta only, re-runs P4b, and adds a mutant that restores the early release.
- **(b) Ruling.** Principal-architect puts the abort case and its bound into the R-ARCH-36 (d) wording now being drafted, and security-analyst rates it. Then I re-check only the text, and the verdict becomes APPROVED_WITH_NITS with no code change.

R2-m1 rides the (d) wording either way. R2-n1 goes to TASK-214. R2-n2 and R2-n3 are optional.

## R2.6 Merge conditions (these replace round 1's §6)

- **C1.** R2-M1 is closed as described in R2.5.
- **C2.** The R-ARCH-36 (d) and ADR-0016 amendment 13 text (principal-architect, dispatched in D-ORCH-157) states the N x limit bound, the scope of the hold (R2-m1) and, if C1 takes option (b), the abort bound.
- **C3. After PR #82 merges** (it is still open at `be843ae1`):
  - Merge `origin/main` into this branch; do not rebase.
  - Prove the squash of #82 equals `be843ae1` on the part-A files: `git diff --stat be843ae1 <squash> -- <files of 530629f4..be843ae1>` is empty, except for files main changed independently.
  - Prove `git diff origin/main <merge>` equals `git diff be843ae1 <final head>` file by file.
  - Show any hand resolution (`app.ts`, `limits.ts`, `README.md` are the candidates) with `git show --cc`.
  - A pure merge needs no code-review round. A hand-resolved code file needs a delta round.
  - Today `merge-tree` against `origin/main` `bf9f3454` is clean and no file is shared.
- **C4. Lane B on that merge head**, not on the stacked head (D-ORCH-150, D-ORCH-157):
  - `rate-limit.int.test.ts`: the three real-Valkey cases of round 1.
  - The api project, with `authn-failed.api.test.ts` (25 rows, including the five R1-M1/D-TASK041-18 rows and the K3 row), `start-api.denial-budget.api.test.ts` (the K1/K2 row; R2-n2 timing), `limits.api.test.ts` and `runtime-seams.api.test.ts`.
  - `in-flight.test.ts`; the generated project; coverage of the changed files.
  - Lane A: the `security-integration` job.
- **C5. Security round** QG-041-C4 second half on the final head: amendment 12 items 4, 7 and 8 with PR041-SEC-09 and E1-E5, and PR041-SEC-02 (b). It also rates R-ARCH-36 (d), R2-m1 (2) and (3), and R2-M1 if C1 takes option (b). `app.ts` and `pipeline.ts` changed, so their C3 of round 2 of the security record applies.
- **C6.** QG-041-C2 second half (product-manager: REQ-SEC-006, A-053, EC-A32 wording) before merge, unchanged from round 1.
- **C7.** The orchestrator routes:
  - n7 (cluster hash slots) to data-architect and devops;
  - n8 (TASK-052 401-only row);
  - R2-n1 (counter label) to TASK-214.

  D-TASK041-10..17 (`DECISIONS.md:8823`) and D-TASK041-18 (D-ORCH-157) are recorded.

## R2.7 Good

- The admission sits in the one place that cannot race: the same synchronous step as the store reply, after the last `await`. The outage path was reordered to keep that true. P5 confirms it against in-order reply delivery through the real breaker-wrapped store.
- No extra store round trip, and the ledger cleans itself up: no timers and no sweeps, and memory is proportional to requests in flight.
- The release comes after the spend has landed, and a unit test pins it (the unit is still held while the spend is issued), so a sequential reader never sees neither the unit nor the spend.
- The new api rows prove the claims through `createApp` and `startApi`, not on hand-built pairs. All three round-1 survivors now die.
- The `serve.ts` fix removes the leak at its cause instead of raising Jest's timeouts.

## R2.8 Security flags (for security-analyst)

- R2-M1: an abort after admission skips the in-flight hold (CWE-307 / CWE-770 class). It is reproducible with `zzcr2probe.api.test.ts` case P4b in my scratchpad (`review/TASK-041B-cr2/copy/apps/api/src/platform/rate-limit/`).
- R2-m1: valid requests count toward the hold. Also: the `limit - k` squeeze of a shared address, and slow-body holds without a spend or an event.
- Round 1's n7 and n8 stand.

---

# Round 3: delta `83a85739..12b8a10a` (fix cycle 2)

| Field | Value |
|---|---|
| Head | `12b8a10a` on `feat/TASK-041-part-b-rate-limit-rulings-rev2` (parent `83a85739`), not pushed, no PR number yet. The worktree `HEAD` is `12b8a10a` and clean |
| Delta reviewed | One commit, `12b8a10a` (`fix(api)`, D-TASK041-19..22 in the body): 12 files, 420+/73-. Only `apps/api/src/platform/rate-limit/**`, `apps/api/src/start-api.denial-budget.api.test.ts` and `docs/03-architecture/api/README.md` are touched |
| Base | PR #82 is still **OPEN** at `be843ae1`. `origin/main` is `bf9f3454`, the merge base is still `530629f4`, no file is changed on both sides, and `git merge-tree --write-tree origin/main 12b8a10a` is clean |
| Bindings read | Rounds 1 and 2 of this record; the commit body; ADR-0016 amendment 13 item 6 (`f8794de2`); rulings `wave-1-task-041-rulings.md` §9 (9.1 to 9.5); D-ARCH-225..227 and D-ORCH-158 (`docs/sdlc/DECISIONS.md`); security record round 1 (`e8067a31`: PR041-SEC-10..14) |
| Reviewer | code-reviewer, 2026-11-21 |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: R2-M1 is closed: the entered unit is released only by its outcome. Probe P4b re-run gives 5 authenticator
         entries (round 2: 60), also for a half-close and for the rulings' case B. 13 of 14 new mutants die; the
         survivor is the breakerClock seam itself. R2-m1, R2-n1, R2-n2 and R2-n3 are closed. Three NITs, no MAJOR.
```

## R3.1 What I verified myself

I ran every command in the foreground, one at a time, with no Docker. Nothing ran in the lane-B worktree. All runs used a `git archive 12b8a10a` extract in my scratchpad (`review/TASK-041B-cr3/copy`), with a junction to the worktree's `node_modules` and the git-ignored `prisma/generated` copied in. After the mutation batches I compared every mutated file byte for byte with `git show 12b8a10a:<file>`: all were equal.

| Check | How | Result |
|---|---|---|
| Delta | `git log` / `git diff 83a85739..12b8a10a` | 1 commit, 12 files, all in the scope that rulings §9.3 names. No lockfile, config schema or file of another task |
| Main drift | merge base, `comm -12` of both file lists, `git merge-tree --write-tree origin/main 12b8a10a` | No shared file; merge-tree clean. #82 is not merged yet, so C3 is still ahead |
| Jest selection | unit + api projects, `--testPathPatterns "platform/rate-limit/\|platform/authn/\|start-api\|runtime-seams\|capture\.api"`, `--maxWorkers=2` | **411/411 pass** at the head (round 2: 398; the 13 new rows are H2 x 2, H3, H4/H5, the R2-n1 row, two wrapper units, two ledger units and the `held` assertions) |
| Prettier, ESLint | `prettier --check` and `eslint --max-warnings 0` on the 12 changed files; `node tools/lint/check-suppressions.mjs` | Prettier clean; ESLint exit 0 with no output. `check-suppressions` needs a git work tree, so it cannot run in an archive copy: for it I rely on D-ORCH-158 (0 findings) |
| **Probe P4b (round 2, re-run)** | `zzcr3probe.api.test.ts`, through `createApp`. 60 junk bearers from one IP, one every 3 ms; each client destroys its socket 15 ms after sending; seam slot 300 ms; limit 5 | **Authenticator entered 5 times, peak 5, failed count 5, ledger 0 at the end** (round 2 at `83a85739`: 60, 60, 60) |
| Probe P4b, half-close | The same with `socket.end()` in place of the destroy | 5 entries, peak 5, failed 5, ledger 0 |
| Probe P4d, rulings §9.2 case B | 12 waves of 5, 20 ms apart; slot 600 ms; each client destroys its socket 4 ms after sending | 5 entries, peak 5, failed 5, ledger 0 (the architect's probe at `83a85739`: 60) |
| **Probe P8, D-TASK041-20 end to end** | 20 signature requests to the `signature` route, each with a complete gzip JSON body (inflates to about 200 KB); the client destroys the socket the moment the last byte is written | **20 of 20 reached the wrapper with `enter() === false`**: the close had released the unit while the body was inflated. Slot entered 0 times, nothing spent, ledger 0, and `server.close()` returned in 2 ms (no request or socket left open) |
| Probe P9, an authenticator that never answers | 5 bearers for which the seam never calls `next`; each client leaves after 20 ms; then a valid bearer | The 5 units stay held and the valid bearer gets 429 with `Retry-After: 1`. This is the designed behaviour (no timer; rulings §9.4, am. 13 item 6 "Release"): an authenticator that never answers is a defect, which the TASK-214 gauge shows |
| startApi wiring of the new seams | `start-api.ts:147`; `grep` for `inFlight:` and `breakerClock` outside tests | startApi passes `{ settings, valkey }` only. The only non-test readers are `kit.ts:28-47`, with the defaults of round 2 (`createInFlightLedger()`, `createStoreBreaker({})`) |
| Mutants | `mutate-041b-r3.cjs`, one at a time over the selection above | **13/14 killed** (R3.4) |

**Not re-run here:** `npm run typecheck`, the integration suite (H6 needs Docker), the generated project and the whole api project. For these I rely on the developer's report (D-ORCH-158: ESLint clean over the repo, check-suppressions 0, unit 956/956, the three api files 54/54) and on lane B at the merge head (C4).

## R3.2 Closure of round-2 findings

| ID | Status | Evidence |
|---|---|---|
| R2-M1 | **Closed** (option (a), as D-ARCH-226 requires) | `in-flight.ts:52-90`: a unit is `{ key, entered }`; `enter` marks it, `releaseUnentered` frees only an unmarked unit and leaves the holder `GONE`, `release` frees it either way. `authn-failed.ts:59` enters before `inner(...)`; `limits.ts:159-163` calls `releaseUnentered` at the close; `authn-failed.ts:69` and `:82` release at the outcome, the second after the spend. P4b, P4b half-close and P4d give 5 entries (round 2: 60). H2 (destroy and half-close) is the api row R2-M1 asked for, and it kills R1 (release at every close), R2 (no enter) and R14. The JSDoc of `in-flight.ts`, `ipLimiter` and `authn-failed.ts` states the rule; the old title "so an abort cannot skip the hold" is gone |
| R2-m1 | **Closed** | ADR-0016 amendment 13 item 6, "When honest traffic meets it" and "When a client causes it", says what R2-m1 asked: every credentialed request counts, valid ones included, from step 0 to the outcome, body upload included; the `limit - k` room with no event below the limit; slow bodies that hold units without a spend or an event, up to the 300 s request timeout (30 s with TASK-108). security-analyst rated the cost LOW (PR041-SEC-11) and the bound INFO (PR041-SEC-12) |
| R2-n1 | **Closed** (ruled into this cycle by D-ARCH-227, not TASK-214) | `counter.ts:17` adds `step0-authn-inflight`; `limiter.ts:151` marks a hold refusal `held: true`; `limits.ts:123` maps it; `limits.ts:171-173` counts nothing for a request whose client left before step 0 answered. H4/H5 and the H1 split kill R8 and R9; the R2-n1 row kills R10. The spent-gate refusal carries no `held` (`in-flight.test.ts` "[H5]") |
| R2-n2 | **Closed** | `kit.ts:28` and `:37`: the `breakerClock` seam; the K1/K2 row freezes it at 0 (`start-api.denial-budget.api.test.ts:310`). R12 survives by design: with a fast host the row passes on the real clock too; the seam only removes the stall risk |
| R2-n3 | **Closed** | `kit.ts:1-7` and `authn-failed.api.test.ts:1-8` are rewrapped |
| n7, n8 (round 1) | Open, routed | Unchanged; they stay with C7 |

## R3.3 Findings of this round

| ID | Severity | file:line | Issue | Required fix |
|---|---|---|---|---|
| R3-n1 | NIT | `apps/api/src/platform/rate-limit/rate-limit.int.test.ts:197-243` (H6) | Two parts of H6 prove less than its title says. (1) `expect(landedWhenSecondIssued).toBeLessThan(gate.limit)` cannot fail: the second wave is issued in the same synchronous step that pushes the fifth spend, whose `.then` cannot have run, so `landed` is at most 4 there. (2) `limiter.spend` sends its script synchronously (`store.ts:174`, `breaker.ts:48-53`), so all five spends are queued on the connection before any second-wave script. Valkey runs them first, every second-wave peek reads 5, and `gated()` refuses on the spent gate without asking the ledger. The second wave therefore proves that a spend sent before a peek on one connection is seen by it. The ledger over real reply delivery is proved by the first wave only (60 peeks that all read 0, 5 admitted). Both facts are worth having, and the row is correct | When the file is next touched: drop or replace the vacuous assertion (for example, count the second wave's refusals that carry `held: true` and expect 0, which states the order fact directly), and say in the title which wave proves what. No change needed for merge |
| R3-n2 | NIT | `apps/api/src/platform/rate-limit/authn-failed.test.ts:236-255` | D-TASK041-20 is pinned by the wrapper and ledger units only (mutants R3, R4, R6 and R7 die there; no api row fails for R3). The path is real: probe P8 reaches it 20 times out of 20 with a complete gzip body and an immediate disconnect. Without the `return`, each such request would run the authenticator outside the hold, which is the remaining way around it | Optional: an api row in the P8 shape (complete body, disconnect, slot entered 0 times, ledger 0) |
| R3-n3 | NIT | `apps/api/src/platform/rate-limit/kit.ts:25-28`; `apps/api/src/start-api.denial-budget.api.test.ts:222-226` | The two new dependencies are test seams, but unlike `authenticate` (`AuthenticateSeamError`, `app.ts:155`) they are accepted in live mode, and the startApi row checks `valkey`, `settings` and the absent `authenticate` but not that `rateLimit` carries nothing else. Today startApi passes `{ settings, valkey }` (`start-api.ts:147`), so nothing is exposed | Optional: in the startApi row, `expect(Object.keys(composed.rateLimit ?? {}).sort()).toEqual(['settings', 'valkey'])`; and "Test seam:" at the start of both JSDoc lines |

## R3.4 Mutants

`mutate-041b-r3.cjs`, one at a time, over the 411-row selection:

| Mutant | Result | Killed by |
|---|---|---|
| R1 the close releases at every close (round 2's code) | Killed | H2 destroy and half-close |
| R2 the wrapper never calls `enter` | Killed | H2, the wrapper unit "[R2-M1]" |
| R3 the wrapper ignores the result of `enter` | Killed | the wrapper unit "[D-TASK041-20]" (unit only; R3-n2) |
| R4 `enter` lets a `GONE` holder in | Killed | both D-TASK041-20 units |
| R5 `releaseUnentered` ignores `entered` | Killed | H2, both R2-M1 units |
| R6 `releaseUnentered` forgets the holder instead of marking it `GONE` | Killed | both D-TASK041-20 units |
| R7 `admit` admits a `GONE` holder | Killed | the ledger unit (step 0 never asks for a closed response, so this is a unit-level contract) |
| R8 no `step0-authn-inflight` label | Killed | H1 split, H4/H5 |
| R9 `gated()` drops `held` | Killed | H1, H4/H5, the consumeGated units |
| R10 a closed request is counted | Killed | the R2-n1 row |
| R11 the kit ignores `deps.inFlight` | Killed | H2, H3, H4 (they read the harness ledger) |
| R12 the kit ignores `breakerClock` | **Survived, by design** | (the seam removes a stall risk; the row passes on the real clock on a fast host) |
| R13 the close releases nothing | Killed | 6 rows, first the H3 404 row |
| R14 `release` leaves an entered unit held | Killed | 41 rows, from B1 (1) on: every admitted request keeps its unit |

## R3.5 Rulings

| Item | Ruling |
|---|---|
| D-TASK041-19 (C-1, the release rule) | **Accepted.** It is the shape of R2-M1 option (a) and of rulings §9.3 C-1, with no timer. Every admitted holder is released exactly once in effect: by `releaseUnentered` at the close when the slot was never entered, else by `release` at the outcome. The `GONE` mark keeps a released holder from entering or being admitted again. Memory stays as in round 2: the per-key count map is deleted at the last release, and the `WeakMap` entry (`Unit` or `GONE`) dies with the response |
| D-TASK041-20 (a holder released before the slot cannot enter; neither the slot nor `next()` runs) | **Accepted. The request is left unanswered, and that is safe.** (1) A `ServerResponse` emits `close` only once the response has finished or its socket has gone. Nothing between step 0 and the slot finishes a response and then continues: the CORS preflight and the OPTIONS responder answer requests step 0 never gates, and a body-parser error goes to the problem handler, not the route. So `enter() === false` means the socket is gone, and there is nobody to answer. (2) Nothing registered before the slot waits for `next()`: the request context is an `AsyncLocalStorage` scope; the access line is written at the close with `aborted: true` (`request-logger.ts:88`); the call deadline and the transaction start at step 8 (`execute.ts:204-209`). (3) Calling `next()` instead would run the authenticator outside the hold, which is the bypass P8 shows: 20 of 20 requests reached this branch. Probe P8 also shows nothing left open (`server.close()` in 2 ms, ledger 0). One wording point: the comment at `authn-failed.ts:56-58` says "the response is closed", which is exact; a future reader may want "the socket has gone" next to it |
| D-TASK041-21 (C-2, the label and `held`) | **Accepted.** `held?: true` sits on the refusal variant only, and `gateRefusal`'s return type is narrowed so the spread type-checks. Using the decision, not `Retry-After`, is right (a spent window can end in 1 s). Not counting a request whose client left before step 0 answered covers the three step-0 labels of a credentialed request, which matches the `StepZeroLabel` JSDoc and is a superset of what am. 13 item 6 requires. The comment at `limits.ts:169-170` is correct: `answer` runs in the `.then` of the decision, and no macrotask (and so no `close`) can run between the admission and it |
| D-TASK041-22 (test seams `inFlight` and `breakerClock`; NITs) | **Accepted with R3-n3.** The defaults are unchanged, startApi never passes either, and both are inert in production. The three suppression texts now name TASK-041 |
| README §7 sentence (C-3) | **Accepted.** The three sentences are verbatim from rulings §9.3 C-3, after "whether its own credential is valid or not." |
| H1 to H6 | **Accepted.** H1's label split derives the hold refusals from `Retry-After: 1`, which is sound in the fake (a 60 s window opened within the row). H2 is deterministic in the count: once five refusals have landed the gate is spent, so `entered` cannot pass 5 however slowly the arrivals run; under heavy load some clients leave only after their answer, which weakens the row's power but cannot make it flaky. H3 and H4 use raw sockets with a short body, so the unit is held in the body parser for as long as the row needs. H6 is correct, with R3-n1 |

## R3.6 Merge conditions (these replace round 2's R2.6)

- **C1.** Closed (R2-M1 by fix; D-ARCH-226).
- **C2.** Closed (ADR-0016 am. 13 item 6, `f8794de2`). quality-gatekeeper verifies item 6 before merge, as D-ARCH-225 and rulings §9.5 require.
- **C3. After PR #82 merges** (still open at `be843ae1`), unchanged from round 2 and refined by D-ORCH-158: merge `origin/main` into the branch (no rebase); prove that the squash of #82 equals `be843ae1` on the part-A files; prove that `git diff origin/main <merge>` equals `git diff be843ae1 12b8a10a` file by file (or the head then current); show any hand resolution with `git show --cc`. A pure merge needs no further code-review round; a hand-resolved code file needs a delta round.
- **C4. Lane B on that merge head:** `rate-limit.int.test.ts` with the three real-Valkey rows of round 1 **and H6**; the api project, including `authn-failed.api.test.ts` (H1 to H5 and the R2-n1 row), `start-api.denial-budget.api.test.ts`, `limits.api.test.ts` and `runtime-seams.api.test.ts`; `in-flight.test.ts` and `authn-failed.test.ts`; the generated project; coverage of the changed files. Lane A: the `security-integration` job. The loopback rows (H2 to H4) must pass without retries; a retry hides a real failure here.
- **C5. Security delta round** on the final head: PR041-SEC-10 verified closed (it is R2-M1), and the D-TASK041-20 confirmation that D-ORCH-158 asks for. My ruling above is the code-review half.
- **C6.** QG-041-C2 second half (product-manager) before merge, unchanged; it now includes the one PRD §9 R-16 / A-112 sentence of rulings §9.5.
- **C7.** The orchestrator routes round 1's n7 (cluster hash slots) and n8 (TASK-052 401-only row). R3-n1 to R3-n3 are optional; they may ride a later commit of this branch or the next TASK-041 change.

## R3.7 Good

- The fix is the smallest one that closes the hole: one boolean per unit, one sentinel and three ledger operations, with no timer and no extra store call.
- `enter()` sits at the only point that cannot race, the first statement of the wrapper. A close after it releases nothing, and a close before it releases the unit and also stops the request.
- H2 reproduces the attack shape of R2-M1 through `createApp` with real sockets, both ways a client can leave, and fails at `83a85739`.
- Hold refusals are told apart by a flag on the decision, not by a header value. That keeps trigger (iv) of the residual readable.
- The `breakerClock` seam fixes the cause of R2-n2 instead of widening a bound.

## R3.8 Security flags (for security-analyst)

- R2-M1 / PR041-SEC-10: closed here by fix; P4b, the half-close and case B each give 5 entries. Probe file: `review/TASK-041B-cr3/copy/apps/api/src/platform/rate-limit/zzcr3probe.api.test.ts` in my scratchpad.
- D-TASK041-20: P8 shows that the branch is reachable (a complete compressed body, then a disconnect) and that it ends the request with nothing open. Without the branch, such a request would be the remaining way around the hold.
- P9: an authenticator that never answers keeps its unit, so the address's hold on that instance stays full (429 `Retry-After: 1` for valid credentials) until the process restarts. This is by design (am. 13 item 6, rulings §9.4) and depends on every authenticator card having its own timeout (TASK-052/055/091/171/261).

# Round 4: the stacked merge `aade2672` and fix cycle 3 (`aade2672..214ec79b`)

| Field | Value |
|---|---|
| Head | `214ec79b` on `feat/TASK-041-part-b-rate-limit-rulings-rev2`, pushed (`origin/feat/TASK-041-part-b-rate-limit-rulings-rev2` = `214ec79b`), no PR number yet. Parent `aade2672`, the merge of `12b8a10a` with main `3d54cef8` (D-ORCH-167) |
| Delta reviewed | (1) the merge `aade2672`; (2) one commit `214ec79b` (`fix(api)`, D-TASK041-23 in the body): 6 files, 447+/15-, namely `app.ts`, `authn-failed.ts`, `kit.ts` (JSDoc only), `authn-failed.test.ts`, `authn-failed.api.test.ts`, `start-api.denial-budget.api.test.ts` |
| Base now | `origin/main` = `88fd7360`, 19 commits past `3d54cef8`, all under `docs/` and `.claude/`. `git merge-tree --write-tree origin/main 214ec79b` is clean |
| Bindings read | D-ORCH-163 (stacked-merge rule), D-ORCH-167 (the merge), D-ARCH-230 (C-4), D-ARCH-234 (the callback form), D-QG-009 (what this round must check), rulings file §10.3, §10.4 and §11.3; rounds 1 to 3 of this record |
| Reviewer | code-reviewer, 2026-11-21 |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The stacked merge is pure: the explicit-base merge-tree equals its tree and the raw diffs are equal (26 paths,
         no union). C-4 is built as D-ARCH-230 and rulings 10.4 word it; the five named mutants and nine more die by
         reading, one survives (R4-n1). H8 asserts the error line; H1 to H6 are unedited. Five NITs, no MAJOR.
```

## R4.1 What I verified myself

Git and reading only, as the dispatch requires: no Jest, no build, no lint, no Docker, nothing in the lane-B worktree. Every mutant verdict below is **by reading** (which assertion fails, and why), not by a run. The developer's memory note says that a scripted runner killed seven mutants; I did not see its output.

| Check | How | Result |
|---|---|---|
| Merge parents | `git cat-file -p aade2672` | Parents `12b8a10a` (the round-3 head) and `3d54cef8` (main); tree `13c4925f` |
| **D-ORCH-163 rule, tree** | `git merge-tree --write-tree --merge-base=be843ae1 12b8a10a 3d54cef8`. `be843ae1` is the predecessor head (PR #82); it is an ancestor of `12b8a10a` and not of main, which has its squash | Exit 0, no conflict, tree **`13c4925f`**: identical to the tree of `aade2672` |
| **D-ORCH-163 rule, raw diff** | `git diff --raw --no-renames 3d54cef8 aade2672` against `git diff --raw --no-renames be843ae1 12b8a10a` (also compared with rename detection on) | 26 lines each, `cmp` equal. **No listed union is needed.** The merge took nothing from main into 041-B's paths and dropped nothing of 041-B |
| Main since the merge | `git diff --name-only 3d54cef8 origin/main`, minus `docs/` and `.claude/` | Empty. A re-merge before the PR is docs-only and needs no code-review round if the same raw-diff proof holds |
| fc3 scope | `git diff --stat aade2672 214ec79b` | 6 files, all inside rulings 10.4: `authn-failed.ts`; `app.ts` (one call site that hands over `{ log: logger }`); the tests; two riders (the R3-n2 row; the R3-n3 pin plus "Test seam:" JSDoc on `kit.ts`). `in-flight.ts` is not touched, as 10.4 requires |
| H1 to H6 unedited | `git diff -U0 aade2672 214ec79b -- authn-failed.api.test.ts` has two hunks: `-10,0 +11` (the `gzipSync` import) and `-748,0 +750,153` (new blocks after the last describe). `rate-limit.int.test.ts` and `in-flight.test.ts` are not in the delta | **Unedited.** H2 to H5 sit at lines 586 to 711 and H6 at `rate-limit.int.test.ts:197`; neither file loses a line. The five deleted lines of `authn-failed.test.ts` are the mechanical third argument (`k.options`) on four existing wrapper units ([R2-M1], [D-TASK041-20] and two B1 units), none of which is an H row |
| Callers of the changed signature | `git grep "withAuthnFailedBudget("` | `app.ts:209` and the unit file only. The third argument is required, so a caller that forgets the logger does not compile |
| Seams that meet C-4 (the developer's claim; D-QG-009's "not read") | Every `createApp` composition with `rateLimit`: `capture.api.test.ts:158`, `idempotency.api.test.ts:112`, `limits.api.test.ts:55`, `composition.int.test.ts:74`, `tests/generated/rbac/matrix-app.ts:182` (delegates to the stub), `start-api` (the production stub), `runtime-seams` (no seam) | All are plain functions that report through `next` before they return (row 1 of rulings 11.3). The only callback-form slots (row 5) are `slowSeam` (`authn-failed.api.test.ts:480`) and the unit row "a plain slot ... is waited for", and both are test seams. The production stub `authenticate.ts` reports before it returns. So the form that C-4 does not end exists only in tests, which is what D-ARCH-234 accepts |

**Not run here:** typecheck, lint, prettier and every test. For these I rely on lane B on `214ec79b` (C4 below). It has not run yet: no `.orch` record names this head.

## R4.2 Fix cycle 3 against D-ARCH-230 (C-4) and D-ARCH-234

| Requirement (rulings 10.4) | Code at `214ec79b` | Status |
|---|---|---|
| A promise that fulfils with no outcome ends the slot; a rejection is an outcome as before | `authn-failed.ts:155-156`: `result.then(endedWithoutOutcome, (error) => done(error \|\| new Error(...)))` | Met |
| No promise: with `headersSent` and no outcome the slot has ended; with nothing started the wrapper waits | `:157-158`; the callback form falls through and waits | Met. The unit row "a plain slot ... is waited for: it reports from a callback" pins the wait (0 released and 1 held until the report, then 1 spend and no line) |
| Answered itself: mark the outcome known, release, call nothing more, no spend | `:142-146` (`settled = true`, `release`, return) | Met. `release` is idempotent: `in-flight.ts` deletes the holder, so the later `close` finds nothing to free |
| Nothing answered: report `new Error(SLOT_UNREPORTED_MESSAGE)` through the wrapper's own outcome path (500, no spend, released) | `:147` → `done` → `spendsAuthnBudget(error)` is false for a plain `Error` → `release`, `next(error)` | Met |
| The error line: `api.authn_slot_unreported`, level error, `operation_id`, and `status` only when one was written, once a minute per operation and instance, no request data | `:94-104`; `lineWrittenAt` is one `Map` per wrapper (one wrapper per `createApp`), keyed by the mounted operation ids | Met. D-TASK041-23 is **Accepted** (R4.5) |
| No listener on the response; the close releases only a unit that never entered; the `finish` releases nothing | The delta adds no `res.on` | Met. H9 pins it |
| `app.ts` only hands over a logger | `app.ts:205-209` | Met |
| The JSDoc of `withAuthnFailedBudget` states the contract | `:74-85`: an outcome is `next` once, a throw or a rejection; an authenticator never starts or ends the response; the promise rule; "a slot that returns no promise may report later from a callback, and the wrapper waits for it while nothing has been answered" | Met for D-ARCH-230. The one sentence that D-ARCH-234 item 7 adds is owed at the next touch and is not a condition (R4-n4) |
| D-ARCH-234: C-4 does not end the callback form, and that is acceptable only for test seams | The seam census in R4.1 | Holds. No product authenticator and no production composition has the form, and card line 21 (NO CALLBACK FORM) keeps TASK-052 and the other authenticator cards out of it |

Two more points from reading the wrapper:

- **The `settled` guard in `endedWithoutOutcome` is load-bearing, and correct.** A plain slot that reports success synchronously can have the rest of the pipeline answer synchronously before `inner` returns, so `headersSent` is true at `:157`; the guard makes that a no-op. For an `async` slot that reports and then fulfils, the guard stops the line from being written. H10 pins both through its async rows.
- **The status in the line.** When something other than the slot answered (later, the TASK-108 timer), the line carries that status (503). The comment at `:101` says so ("the slot (or whatever answered)"). Acceptable.

## R4.3 D-QG-009's asks

**(a) The five mutants of rulings 10.4, plus ten more of my own, by reading:**

| # | Mutant | Verdict | Killed by (the assertion that fails) |
|---|---|---|---|
| M1 | A release at `finish` (`res.once('finish', () => kit.inFlight.release(res))` in the wrapper) | Killed | api H9 (`:823`): the timer's 503 at 60 ms frees the five units and the second five (200 ms) are admitted, so `entered` is 10 and the second statuses are 503, not `[429, '1']` |
| M2 | No check at fulfilment (`result.then(undefined, ...)`, the `12b8a10a` line) | Killed | api H7 async (`:768`): `held(KEY_A)` is 5 and the valid bearer gets 429. Unit H7 async: `released()` is 0. Unit H8: `passed` is `[]`. api H8 would hang until the 120 s Jest timeout (slow, but H7 kills first) |
| M3 | No `headersSent` check at the return (drop `:157-158`) | Killed | api H7 plain (held 5, the valid bearer gets 429); unit H7 plain (`released()` 0, no line) |
| M4 | The unanswered case calls `next()` with no error | Killed | api H8 (`:787`): the request goes on with the fail-closed `ANONYMOUS` principal (`principalOf`) to `authorise`, which answers 401 `AUTH_REQUIRED` on the `session` route (`authorise.ts:167-168`), not `[500, 'INTERNAL_ERROR']`. Unit H8: `(undefined as Error).message` throws |
| M5 | The unanswered case spends | Killed | api H8: with a budget of 5, the sixth of the eight sequential requests is refused 429 at step 0, and `failedKey` is defined. Unit H8: `spends()` is 1 |
| M6 | No error line in the unanswered case (D-QG-009 observation 2) | Killed | api H8 `:817` and unit H8 expect `[['api.authn_slot_unreported', { operation_id: 'getProfile' }]]` |
| M7 | No error line in the answered case | Killed | api H7 `:783`, unit H7 |
| M8 | No once-a-minute rule | Killed | unit H7 (two entries, one line), api H7 (five entries, one line), api H8 (thirteen entries, one line), the throttle unit `:450` |
| M9 | The minute is kept globally, not per operation | Killed | the throttle unit (`listAddresses` gets its own line at `INTERVAL - 1`) |
| M10 | `<` becomes `<=` in the minute check | Killed | the throttle unit (a third line is expected at exactly `INTERVAL`) |
| M11 | `status` is always written | Killed | api H8 and unit H8 expect no `status` (it would be 200) |
| M12 | No `if (settled) return` in `endedWithoutOutcome` | Killed | unit H10: "accepts (async)" and "refuses (async)" fulfil after they report and would write a line, but `o.lines` must be `[]` |
| M13 | The answered branch does not release | Killed | api and unit H7 |
| M14 | The answered branch calls `next()` | Killed | unit H7 (`passed` must be `[]`); api H7 would write a second response |
| M15 | The answered branch does not set `settled = true` | **Survives** | No row has a slot that answers itself and reports afterwards (R4-n1) |

All five named mutants die, and so does M6, the mutant of D-QG-009 observation 2.

**(b) Does H8 assert the error line `api.authn_slot_unreported`?** Yes, at both layers. api H8 at `authn-failed.api.test.ts:817` expects exactly one line, with no `status`, over 13 requests, including the five whose clients left. Unit H8 is at `authn-failed.test.ts:409-421`. D-QG-009 observation 2 is closed.

**(c) Are H1 to H6 unedited?** Yes (R4.1). They still run on the old seams. Those are row-1 or row-5 forms, so no C-4 branch applies to them. That is why the callback form stays allowed for seams (D-ARCH-234, "Why not close the form in the wrapper now").

**(d) The `headersSent` race (D-QG-009 observation 1; D-ARCH-234 item 6).** By reading, it is as the gatekeeper described, with one consequence the text does not state:

- At the return (`:157`) the wrapper reads `res.headersSent`, not who set it. Only a callback-form slot (row 5) reaches that check with no outcome: rows 1 and 2 have reported (settled) before the wrapper looks, and row 3 is judged at fulfilment.
- Today nothing can answer a request between step 0 and the slot and still let it reach the slot. The CORS and OPTIONS responders end the chain, and a body-parser error goes to the problem handler (round 3, ruling on D-TASK041-20). With TASK-108 the request timer can: it answers 503 while the body is still being read, and Express continues the chain once the body completes. If that completion lands after `end()` and before the response's `close` (which frees the unit through `releaseUnentered`), the slot is entered with `headersSent` already true.
- A row-5 slot in that window is misread as row 4. The line is written with status 503, **the unit is released at the return while the callback still runs**, and the later refusal is dropped (no spend). So the cost is one authentication outside the hold per request that hits the window, the class of R2-M1, and not only "its later refusal is not spent". It needs the callback form, which only test seams have, and a window that only TASK-108 opens. That makes it a NIT, not a condition (R4-n2).
- The remedy is one line. Add `const startedBefore = res.headersSent;` before `inner(...)`, and change `:157` to `else if (!startedBefore && res.headersSent)`. A row-5 slot entered after another party answered is then waited for, like every row-5 slot. Rows 1 to 4 do not change: a slot cannot start a response that is already started without throwing, and the `catch` turns the throw into an outcome.

## R4.4 Findings of this round

| ID | Severity | file:line | Issue | Required fix |
|---|---|---|---|---|
| R4-n1 | NIT | `apps/api/src/platform/rate-limit/authn-failed.ts:143` | M15 survives. No row pins "a later report is dropped" for a slot that answered itself. Without `settled = true`, that later report would spend and call `next(error)` into an answered response. The comment at `:135-137` promises the drop | A unit row in the H7 shape: the slot answers 401, then calls `next(new AppError('AUTH_REQUIRED'))` from a 1 ms timer. Expect `passed` `[]`, `spends()` 0, `released()` 1 |
| R4-n2 | NIT | `authn-failed.ts:154-158` | The `headersSent` race of R4.3 (d). With TASK-108, a callback-form slot entered after the timer answered is released at the return while it still runs, and its refusal is dropped. Test seams only; D-ARCH-234 item 6 records the limit | Optional: the `startedBefore` guard of R4.3 (d), at the next commit that touches the file or under card line 22 (TASK-108). If it is not taken, principal-architect adds the "authentication outside the hold" consequence to the second limit in rulings 11.3 |
| R4-n3 | NIT | `authn-failed.ts:139-147`, `:156` | `writeLine` runs before the state changes, and the fulfilment callback at `:156` has no rejection handler. A logger that throws there would cause an unhandled rejection (process exit under Node 24 defaults) and leave the unit held. `done` already guards the event sink with `.catch(() => undefined)` for the same reason. The platform logger writes to `process.stdout` and does not throw in practice | Write the line last (after `release` or `done`), or wrap `writeLine` in a `try`/`catch` that swallows, as the event-sink guard does |
| R4-n4 | NIT (owed, not a condition) | `authn-failed.ts:23-28`, `:80-85` | The sentence of D-ARCH-234 item 7 and rulings 11.3 on the limit of the callback form is missing: a slot that never reports is held until restart; the form is for test seams; a product authenticator reports before it returns, or returns a promise and reports before it fulfils. The module header bullet "A slot that ends without an outcome is ended by the wrapper" has no exception either | The words of rulings 11.3, or the developer's own, at the next commit that touches the file |
| R4-n5 | NIT | `apps/api/src/platform/rate-limit/authn-failed.api.test.ts:847-901` (the R3-n2 rider) | The row relies on timing: the socket close must be handled before zlib finishes inflating 900 kB. The margin is generous (P8 20/20 at 200 kB; the developer 10/10 at 900 kB). Still, a fast inflate on an idle host or a slow close on a loaded one fails it (`enters` contains `true`) or makes it hang in `until`. Neither would mean a product defect | No change now. If lane B shows it red once, do not retry (C4). Report it, and gate the inflate in the row (a slow `Content-Encoding` stream or a larger body) |

The riders **close** round 3's R3-n2 and R3-n3. The gzip row reaches the wrapper with `enter() === false` 10 times out of 10 and enters the slot 0 times. The startApi row pins `['settings', 'valkey']` (`start-api.denial-budget.api.test.ts:225-226`), and `kit.ts` says "Test seam:" on both lines. **R3-n1 stays open**: H6 is not edited this cycle, by rule, so it moves to the next TASK-041 change. Round 1's n7 and n8 stay with C7.

## R4.5 Rulings

| Item | Ruling |
|---|---|
| D-TASK041-23 (the minute in one `Map` per wrapper; a required `options` argument with `log` and a `now` seam) | **Accepted.** It keeps the line off the kit and off the security-event channel, as 10.4 asks, and a route mounted twice shares one minute. The map is bounded by the mounted operation ids. Only the unit rows use the `now` seam; `app.ts` passes none |
| The riders (the PR041-SEC-15 / R3-n2 row, the R3-n3 pin) | **Accepted** in this commit, as rulings 10.4 allows. R3-n1 is rightly left out, because H6 must stay unedited |
| The stacked merge `aade2672` | **Pure** under the D-ORCH-163 rule, with no union. It needs no review beyond this record |
| Round 3's verdict on fix cycle 2 | Stands, as D-ARCH-230 says |

## R4.6 Merge conditions (these replace round 3's R3.6)

- **C1, C2.** Closed in round 3. D-QG-009 rules QG-041B-C1 CLOSED and QG-041B-C2 CLOSED_WITH_FOLLOW_UP; this round is the code-review half of its follow-up 2.
- **C3.** Closed: PR #82 is merged and the stacked merge `aade2672` is proven pure (R4.1). Main is now 19 docs-only commits ahead. If main is merged again before the PR, repeat the raw-diff proof. A docs-only main delta needs no further code-review round; any change to code needs a merge round.
- **C4. Lane B on `214ec79b`, or on the final merge head:**
  - `rate-limit.int.test.ts` with H6 against a real Valkey (QG-041B-C5 (a));
  - the api project, including `authn-failed.api.test.ts` (H1 to H5, H7 to H9, the R2-n1 row, the gzip row), `start-api.denial-budget.api.test.ts`, `limits.api.test.ts` and `runtime-seams.api.test.ts`;
  - the unit files `authn-failed.test.ts` (H10 and the C-4 units) and `in-flight.test.ts`;
  - the generated project;
  - typecheck, lint, prettier and `check-suppressions` on the branch;
  - coverage of `authn-failed.ts` (the new rows should cover every C-4 branch);
  - gitleaks-full (D-ORCH-168).

  The loopback rows (H2 to H4, H8 with leaving clients, the gzip row) must pass **without retries**. R4-n5 explains what a red gzip row would mean.
- **C5. Security delta round on `214ec79b`** (D-ARCH-230; follow-up 2 of D-QG-009). It re-runs PA2, PG, PH and the timer case; closes or narrows PR041-SEC-16, with rows 5a and 5b of rulings 11.3 rated; reads the R4-n2 consequence against row 5; and takes QG-041B-C4 (PR041-SEC-11 with the burst case). That round carries the binding.
- **C6.** QG-041B-C3 is CLOSED_WITH_FOLLOW_UP (D-PM-090, D-PM-092). The api/README §7 sentence of rulings 10.7 must be on the merge head (D-QG-009, residual 4). The client sentence waits for QG-041B-C7 (a).
- **C7.** The orchestrator routes round 1's n7 and n8, R3-n1, and R4-n1 to R4-n5. None of them holds the merge. R4-n4 is owed at the next touch of `authn-failed.ts`, per D-ARCH-234.

## R4.7 Good

- C-4 is exactly the ruled form. It adds no listener on the response, and its two checks sit at the only two ends the wrapper can see, so nothing about the response can release an entered unit.
- The unanswered case reuses `done`, so the 500, the absent spend and the release come from the one path that rounds 1 to 3 already proved.
- H9 passes on the old head on purpose: it pins the reason remedy (b) was declined, and it kills the build-F mutant directly.
- The gzip rider wraps `inFlight.enter` to prove that the D-TASK041-20 guard really ran 10 times. It does not rely on "0 entries", which a request that never arrived would also give.
- The startApi row pins the exact key set of `rateLimit`, so a test fails if a future seam leaks into production.

## R4.8 Security flags (for security-analyst)

- R4-n2: once TASK-108 exists, a callback-form slot entered between the timer's answer and the close is released at the return while it still runs. That is one authentication outside the hold per such request, on top of the dropped spend that D-ARCH-234 item 6 records. Only test seams have this form today. Please rate it with rows 5a and 5b.
- R4-n3: a throwing logger on the fulfilment path causes an unhandled rejection. LOW or INFO by my reading, because the platform logger does not throw.
- The census in R4.1: no production composition has the callback form. The matrix seam and the stub both report before they return.
