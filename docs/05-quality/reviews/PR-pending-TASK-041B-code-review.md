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
