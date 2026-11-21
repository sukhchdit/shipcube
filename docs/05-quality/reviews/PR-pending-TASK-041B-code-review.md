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
