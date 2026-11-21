# Wave-1 TASK-041 — rulings on the rate limiter (2026-11-20)

Owner principal-architect. Decisions D-ARCH-173 to D-ARCH-179. ADR-0016 amendment 12, ADR-0010 amendment 13.

**Revision 2 (2026-11-20, D-ARCH-182, ADR-0016 amendment 13; security round 2, PR041-SEC-09 and E1 to E5).** Part 041-A is unchanged. In part 041-B, B1 gains the route rule for the refresh cookie, the true scope of the lock, tests (9) to (13) and the wrapper conditions; section 5.2 and card lines 10 to 14 follow.

**Revision 3 (2026-11-21, D-ARCH-225 to D-ARCH-227, ADR-0016 amendment 13 item 6; part 041-B code review R1-M1 of round 1 and R2-M1, R2-m1, R2-n1 of round 2; developer decision D-TASK041-18).** The in-flight hold of the failed-authentication budget is accepted as a rule of step 0, with residual R-ARCH-36 (d). Two changes are merge conditions of part 041-B: when a hold is released, and a counter label of its own. Section 9 and card lines 15 to 19 are new; sections 1 to 8 are unchanged except one pointer in B1.

**Inputs.** Code review `docs/05-quality/reviews/PR-pending-TASK-041-code-review.md` (`7d24349`: merge condition C1, R1-m1, R1-m2, R1-m4, R1-m8, security flags S1 to S4). Security review `docs/05-quality/security/PR-pending-TASK-041-security-review.md` (`d52a340`, D-SECPR041-01: PR041-SEC-01 to -08). Developer decisions D-TASK041-01, -03 and -05 as the code review lists them. The implementation at `e6f484a`, read from the worktree `../Shipqube-TASK-041` (read only). ADR-0016 §8 and amendments 1 and 7, api/README §7, D-SECT39-01, the TASK-041 card, DR-A08, DR-A22, REQ-SEC-005, REQ-SEC-006, NFR-SEC-005, US-040, ADR-0010 amendments 2, 3, 4 and 10, platform.md §4.4 and §6.

**Edited (main checkout, docs only).** ADR-0016 (amendment 12), ADR-0010 (amendment 13), ADR-0025 (one entry), ARCHITECTURE.md (one diagram label), nfr-strategy.md and nfr-traceability.md (one cell each), platform.md (§4.4 client IP, §6 configuration line, OI-16), risks.md (R-ARCH-36), DECISIONS.md.

**Deliberately not edited.** `api/README.md` is a lane-B tooling input, and the TASK-041 branch already edits it (§13 row). The §7 text of section 5 below rides the TASK-041 pull requests, so no evidence on another open PR goes stale. The requirement and story files belong to product-manager (section 7). The plan files belong to senior-developer (section 6).

**Not run here.** No test, type check, container or lint. Statements about the code come from reading `e6f484a`; statements about costs are estimates and are marked as such.

## 1. Decisions

| # | Question | Ruling | Where |
|---|---|---|---|
| 1 | D-TASK041-01: own engine instead of `express-rate-limit` + `rate-limit-redis` | **Accepted (D-ARCH-173).** `rate-limit-redis` leaves `apps/api/package.json` and the lockfile in this PR. `express-rate-limit` stays for one function, `ipKeyGenerator`; no middleware of it is created. | ADR-0016 am. 12 item 1; ADR-0025 |
| 2 | D-TASK041-03: step-0 policy; R1-m1 / PR041-SEC-02 | **Accepted with two changes (D-ARCH-174, D-ARCH-175).** Option (a) now, in a precise form: the credentialed ceiling applies only to a request under `/api/v1` that is not `OPTIONS`. Option (b) before TASK-052, as a per-IP failed-authentication budget read by the step-0 script. Option (c) is not chosen. The `rate_limit_auth` event is logged once per key and window. | ADR-0016 am. 12 items 2 to 4 and 6 |
| 3 | D-TASK041-05: the per-IP part of `auth` at step 5 | **Accepted, for every class (D-ARCH-176).** Step 0 is the limiter that runs before authentication; class rules run after authorisation and before validation and the handler. The clause "class `public`/`auth` as declared per route" of amendment 1 is withdrawn. One residual is recorded (R-ARCH-36). | ADR-0016 am. 12 item 5 |
| 4 | R1-m4 / S4: no breaker | **Required, not merge-blocking (D-ARCH-177).** It ships in part 041-B, before TASK-052 is dispatched. | ADR-0016 am. 12 item 7 |
| 5 | S2 / PR041-SEC-05: `TRUST_PROXY_HOPS` default | **The default 1 is wrong; it becomes 0 in this PR (D-ARCH-179).** In staging and production the API refuses to start unless the value is set and at least 1. Compose keeps its explicit 1. The Terraform pin and the deploy smoke check go to devops. | ADR-0016 am. 12 item 9; platform.md |
| 6 | PR041-SEC-03: store-failure mode of the carrier admission controls, and its owner | **They never fail open; they refuse (D-ARCH-178).** Owner TASK-190. The HTTP classes `public-quote`, `public-tracking` and `quote-create` join the per-instance fallback set in part 041-B. | ADR-0010 am. 13; ADR-0016 am. 12 item 8 |
| 7 | PR041-SEC-01 and PR041-SEC-08 | No ruling needed. I agree with both and with their place in this PR's fix cycle. | Section 3, A8 |

## 2. Delivery in two parts

TASK-041 is delivered in two parts under its own locks (`api-ratelimit`, `api-authz`, `api-routing`, `pkg-audit-redaction`, plus `api-audit-mw` and `api-platform-core` per D-SECT39-01 card line 2).

- **Part 041-A** is the pull request under review, with the changes of section 3. It closes the merge condition C1 of the code review. TASK-049 waits for it and for nothing else in this file.
- **Part 041-B** is the changes of section 4. It may be a second pull request or part of the first; the orchestrator chooses. It is merged before TASK-052 is dispatched, because TASK-052 writes the first real authenticator against it. PR041-SEC-02 (b) is open until then and closes with it.

Why part 041-B can follow: the failed-authentication budget guards verification work, and none exists before TASK-052 (the authentication slot is the TASK-020 stub, and `moduleRegistry` is empty at `e6f484a`). The breaker matters in a deployed environment, and this run has none before then. The first `public-quote` and `public-tracking` routes are wave 2.

## 3. Part 041-A: exact changes (merge-blocking)

**A1. Step-0 rule selection (`rate-limit/limits.ts:80-81`; R1-m1 option (a), PR041-SEC-02 (a)).** The credentialed rule is taken only when all three hold:

1. the method is not `OPTIONS`;
2. the path is `/api/v1` or starts with `/api/v1/` (exact, case-sensitive; `createApp` passes the prefix, the limiter does not import `app.ts`);
3. `presentsCredential(req.headers)` is true.

Every other request takes the anonymous rule: the API docs, `OPTIONS`, and any path outside `/api/v1`, whatever headers it carries. A path spelled in another case takes the anonymous rule too, which is the strict direction.

Known and accepted: a path under `/api/v1` that no route serves (404 or 405) with a credential header takes the credentialed rule, because step 0 runs before routing. The answer is a problem document that costs no more than a 429. I do not ask the fallback to count it a second time.

**A2. Comments and one test title.** Three texts overclaim and are reworded:

- `limits.ts:7-9`: replace "and the ten times the `authenticated` limit per IP when one is, so a flood of forged credentials cannot bypass it. It runs before the authentication slot, so a flood never reaches bcrypt or JWT verification." with: "and against a per-IP ceiling of ten times the `authenticated` limit when a request under /api/v1 presents a credential header. The ceiling is chosen by the presence of the header, not by its validity: it bounds a flood per IP, it does not tell a forged credential from a valid one (ADR-0016 am. 12 items 3 and 4)."
- `policy.ts:144-147`: replace "while a flood of forged credentials from one IP still stops here" with "and a flood from one IP that presents credentials, valid or forged, stops at this ceiling".
- `limits.api.test.ts:289`: retitle to "a request under /api/v1 that presents a credential is counted against the per-IP ceiling of ten times the per-user limit".
- `store.ts:5-6` (R1-n2), and the same phrase wherever it recurs: "coarse network prefixes only" becomes "the IPv4 address or the IPv6 /64, kept for one window at most".

**A3. Tests for A1 (`limits.api.test.ts`).** With `RATE_LIMIT_PUBLIC_PER_MIN: 3` and a junk `Authorization` header on every request:

- `GET /api/docs/`: the 4th request is 429;
- `OPTIONS /api/v1/reference/countries`: the 4th request is 429;
- `GET /nope` (no route, outside `/api/v1`): the 4th request is 429;
- the existing ceiling test still passes for `GET /api/v1/reference/countries`.

The step-0 counter label for a credentialed refusal becomes `step0-credentialed` (R1-n7). I ask for this nit because item 3 of the amendment names that counter as the signal for tuning the ceiling.

**A4. `rate_limit_auth` is logged once per key and window (`limits.ts:116`; R1-m2; S1 log volume).**

- The event is emitted by the first refusal of a window for a key: the hit whose count is the limit plus one. Later refusals of the same key and window emit nothing.
- It is emitted for the `auth` and the `email-send` class (`SECURITY_RATE_LIMIT_CLASSES`), with `class` and `key_type: 'ip'`.
- The counter counts every refusal, as now.
- The refused `RateDecision` carries the fact (for example `first: boolean`), taken from the count the store returned. Nothing new is stored.
- During a store outage the per-instance fallback makes this once per instance.
- Tests: 13 logins from one IP give three 429 answers, exactly one event and a counter of 3; one row for `email-send`; the first refusal of the next window emits again.

**A5. Dependencies (`apps/api/package.json:55`).** Remove `rate-limit-redis` and update `package-lock.json` in the same commit. `express-rate-limit` stays. `policy.ts` imports `ipKeyGenerator` from it and nothing else; no other file imports the package.

**A6. `TRUST_PROXY_HOPS` (`packages/config/src/schema.ts:287`, `guards.ts`; S2, PR041-SEC-05).**

- The schema default becomes `0`. Description: "Reverse-proxy hops trusted for the client IP: 0 = none (the socket peer), 1 behind the Compose edge, 2 behind CloudFront + ALB. Must be set in staging and production."
- New guard for the `api` service in staging and production (`isHardenedAppEnv`): an unset value is the issue `{ key: 'TRUST_PROXY_HOPS', code: 'missing' }`; the value 0 is `{ key: 'TRUST_PROXY_HOPS', code: 'forbidden-in-environment', rule: 'trustProxy.hops' }`.
- Tests: the default is 0; the two guard rows; local and test accept an unset value and 0.
- `compose.env` keeps `TRUST_PROXY_HOPS=1` (the `edge` proxy is the one hop). No change.
- `.env.example` line 26 should read `TRUST_PROXY_HOPS=0`. Agents may not edit that file: the orchestrator adds this to the user's edit of code review C5 (the 18 new lines).

**A7. api/README §7.** The text of section 5.1 replaces the named paragraphs in this pull request. api-designer acknowledges it together with the §13 row (code review C2).

**A8. Agreed without a ruling, in this fix cycle.** PR041-SEC-01 with R1-m5 (O(1) eviction in the fallback stores, as the security record validated it), PR041-SEC-08 with R1-m6 (a `live` composition without `rateLimit` is refused in `assertBootable`; the seam is listed in the matrix app), R1-m3 (outage wiring and field allow-list pinned). R1-n4 is closed by documentation: the README text of section 5.1 says that a response which passed both stages carries the reading of the route's class.

## 4. Part 041-B: exact changes (before TASK-052 is dispatched)

**B1. Failed-authentication budget (PR041-SEC-02 (b); ADR-0016 am. 12 item 4).**

- **Key and window.** `rl:step0:authn-failed:<ip key>`, a fixed window of 60 s anchored by the key's TTL at the first failure. The limit is `RATE_LIMIT_PUBLIC_PER_MIN`: a failed credential is an unauthenticated request, so it gets the size of the unauthenticated budget. No new configuration key.
- **What spends a unit.** The authentication slot refuses a request that presents a credential of a kind the route declares (`Authorization` for `session`, a refresh cookie, `X-Quote-Token`, one of the three signature headers for `signature`). One exception: 401 `ACCESS_TOKEN_EXPIRED` spends nothing. The exemption keys on that error code alone (E4); every other refusal spends, a malformed token or one without a usable `exp` included (E2). A credential the route does not declare is never read (D-ARCH-109) and never spends.
- **Who records it.** A wrapper around the authentication slot, composed in `createApp` around the default slot and around the `authenticate` test seam. No authenticator calls the limiter. The spend never changes the answer of the request that failed. A store failure uses the per-instance fallback.
- **Which requests take the credentialed rule (R1, revision 2).** As in A1, with one change: a refresh cookie counts only when `req.path` is exactly the path of a route that declares `refresh-cookie` (`/api/v1/auth/csrf`, `/api/v1/auth/refresh`, `/api/v1/auth/logout` today). `createApp` derives the set from the mounted routes and passes it to the limiter with the prefix; it refuses a `refresh-cookie` route whose path has a parameter. A request that carries only the cookie on any other path takes the unauthenticated budget. `Authorization`, `X-Quote-Token` and the signature headers (B2) select the rule as before.
- **Where it is read.** Step 0, on the credentialed rule only. The store call that counts the credentialed hit also returns the IP's failed count: one script over two keys, no second round trip. The in-memory store answers the same question.
- **Answer when the budget is spent** (failed count at or above the limit): 429 `RATE_LIMITED` before routing, `Retry-After` = the rest of the failed window, `RateLimit-Limit` = the limit, `RateLimit-Remaining: 0`, `RateLimit-Reset`. Counter label `step0-authn-failed`. Requests that take the anonymous rule are not affected. Every request that takes the credentialed rule is refused, valid credentials included: this is the accepted scope (ADR-0016 amendment 13 item 2) and test (10) pins it.
- **In-flight hold (revision 3).** Step 0 also refuses a credentialed request, with `Retry-After: 1`, while the failed count plus the address's requests still in authentication on the instance reaches the limit. The rule, its release, its label and tests H1 to H6 are in section 9.
- **Event.** `rate_limit_auth` with `class: 'authn-failed'`, `key_type: 'ip'`, once per key and window, emitted by the spend that reaches the limit.
- **Tests.** (1) 120 requests with a junk bearer to a `[session]` fixture route answer 401; the 121st answers 429 and the authentication slot is not entered (spy). (2) A credentialed request from a second IP is not affected. (3) A request without credentials from the first IP is still served. (4) A seam authenticator that answers `ACCESS_TOKEN_EXPIRED` 200 times causes no 429. (5) A junk bearer on an `[anonymous]` route spends nothing. (6) Two replicas share the budget. (7) With the store failing, the budget holds per instance. (8) The `startApi` composition has the wrapper (the production half, like the limiter itself). Revision 2, with the budget spent for IP A: (9) a request from A that carries only `__Host-rt_web` to the sign-in route is not refused at step 0 and is counted under the unauthenticated budget; (10) a request from A with a credential the seam authenticator would accept gets 429 with `Retry-After`; (11) a credentialed request from IP B is served; (12) a request from A that carries only the cookie to `/api/v1/auth/refresh` gets 429, and before the lock the same request takes the credentialed rule while the same cookie on `/api/v1/reference/countries` takes the unauthenticated budget; (13) `createApp` refuses a `refresh-cookie` route with a path parameter.

**B2. Signature headers select the credentialed rule (`limits.ts`).** The step-0 selector also counts a non-blank `Stripe-Signature`, `X-Mock-Signature` or `X-Carrier-Signature` as a presented credential. Without it a provider is held to 120/min per IP by the anonymous rule, below the 600/min of the `webhook` class. `presentsCredential` in `@platform/shared` is not changed (the problem handler uses it for cache marking); the limiter has its own selector. One test row: 121 signed webhook requests from one IP are not refused by step 0.

**B3. Store breaker (R1-m4, S4; ADR-0016 am. 12 item 7).**

- One breaker per process for the rate-limit store, shared by the limiter (step 0, step 5, stream slots, B1) and the denial budget.
- It opens when a store call ends in a `RateLimitStoreError`. While open, for a cool-down of 5 s, every store call fails at once with `RateLimitStoreError('unavailable')` and the client is not touched, so each caller takes its fallback or fail-open path without a wait.
- After the cool-down exactly one call goes through as the probe. Success closes the breaker; failure opens it for another cool-down. Other calls keep failing fast while the probe is in flight.
- In-house, about 40 lines, injectable clock. No new dependency: `opossum` stays in `packages/carriers`.
- The outage event is unchanged (once a minute per scope). The breaker state becomes a gauge when TASK-214 exports the counters.
- Tests: with a hanging fake the first call waits the 250 ms bound and each of the next 20 returns in under 5 ms; after the cool-down one probe is sent; a failure of the limiter makes the denial budget skip the store.

**B4. Fallback set (PR041-SEC-03; `policy.ts`).** `public-quote` and `public-tracking` change from `fail-open` to `fallback`. The service helpers `authAccountRule`, `emailSendRules` and `quoteCreateRules` are documented as `fallback` rules for the services that consume them. `public`, `authenticated`, `webhook`, `csp-report`, the step-0 hits and the stream slots still fail open (REQ-SEC-006). Test rows for the two classes in the outage suite.

**B5. api/README §7.** The additions of section 5.2 ride this part's pull request.

## 5. api/README §7 text

### 5.1 With part 041-A

Replace the first two paragraphs of §7 ("Counters live in Redis…" and "There are two stages…") with:

> Counters live in Valkey and are shared by all API instances. The limiter is the platform's own fixed-window engine (`apps/api/src/platform/rate-limit`; ADR-0016 amendment 12): one atomic script per rule, with the window anchored by the key's TTL at its first hit. Every route declares `x-rate-limit-class`, and route metadata carries the same value.
>
> There are two stages (ADR-0016 amendments 1 and 12, threat model R-13). **Step 0** is a coarse per-IP limiter mounted before routing, so it does not know the route. It counts every request except the two probes. A request under `/api/v1`, other than `OPTIONS`, that presents a credential header is counted against a per-IP ceiling of ten times the `authenticated` limit (6,000/min by default), so users behind one NAT keep their own per-user budgets. Every other request (no credential, the API docs, `OPTIONS`, any path outside `/api/v1`) is counted against the unauthenticated budget of 120/min per IP. The ceiling is chosen by the presence of the header, not by its validity. **Step 5** applies the rules of the route's class after authorisation and before validation and the handler: per IP for the public and authentication classes, per user for `authenticated`. IPv6 clients are keyed by their /64 prefix, IPv4 clients by their address; an IPv4-mapped IPv6 address counts as the IPv4 address.

In the **Headers** paragraph, replace the two sentences from "In express-rate-limit 8 these separate headers…" to "…is raised with the principal-architect." with:

> The limiter sets them itself; the combined `RateLimit` header and `RateLimit-Policy` of draft-07 are not sent (ADR-0016 amendments 7 and 12). A response that passed both stages carries the reading of the route's class; a 429 from step 0 carries the step-0 reading. A refusal in the `auth` or `email-send` class is the security event `rate_limit_auth` (§13), logged once per key and window at the first refusal; a counter counts every refusal.

Replace the **Redis outage** paragraph with:

> **Store outage.** A store call is bounded by 250 ms. The `auth` and `email-send` classes then use per-instance in-memory counters with the same limits; all other classes and step 0 fail open (REQ-SEC-006). The instance logs the runtime security event `rate_limit_store_unavailable` at most once a minute per scope (§13).

Replace the **IP** paragraph with:

> **IP.** The client IP is the first address that is not one of the `TRUST_PROXY_HOPS` trusted proxy hops: 0 trusts none (the socket peer), 1 is the Compose `edge`, 2 is CloudFront + ALB. Spoofed `X-Forwarded-For` values are ignored (EC-A12). The default is 0, and in staging and production the API refuses to start unless the value is set and at least 1.

### 5.2 With part 041-B

Append to the second paragraph:

> A request with a provider signature header counts as presenting a credential. Step 0 also keeps a **failed-authentication budget** per IP: each request whose presented credential the authentication slot refuses (an expired access token excepted) spends one unit of 120 a minute, and while the budget is spent every request from that IP that takes the credentialed rule is answered 429 before authentication, with `Retry-After`, whether its own credential is valid or not. A refresh cookie selects the credentialed rule only on the three routes that read it (`getCsrfToken`, `refreshSession`, `logoutSession`); on every other route a request that carries only the cookie counts as unauthenticated, so sign-in and public reads are never refused by this budget. The event is `rate_limit_auth` with class `authn-failed`.

Replace the **Store outage** paragraph with:

> **Store outage.** A store call is bounded by 250 ms, and after a failure the instance skips the store for 5 s and then probes it with one call. The `auth`, `email-send`, `public-quote`, `public-tracking` and `quote-create` rules and the failed-authentication budget then use per-instance in-memory counters with the same limits; the other classes and the step-0 hits fail open (REQ-SEC-006 as amended). The instance logs the runtime security event `rate_limit_store_unavailable` at most once a minute per scope (§13).

## 6. Card lines for the next plan fold (senior-developer)

No apostrophes, as plan-data needs.

1. **TASK-041, DoD notes:** "TWO PARTS (ADR-0016 amendment 12; D-ARCH-173..179; rulings/wave-1-task-041-rulings.md sections 3 and 4): part 041-A is the first pull request with changes A1 to A8; part 041-B (failed-authentication budget, signature headers in the step-0 selector, store breaker, fallback set) is merged before TASK-052 is dispatched and closes PR041-SEC-02 (b)". Locks: add `api-audit-mw` and `api-platform-core` if D-SECT39-01 card line 2 is still not folded.
2. **TASK-052, dependency and lines:** depends on TASK-041 part 041-B. "AUTHENTICATOR COST RULES (ADR-0016 amendment 12 item 4; D-ARCH-175; PR041-SEC-02): (a) the session authenticator checks the token structure and the exp claim of the unverified payload first and answers 401 ACCESS_TOKEN_EXPIRED for an expired token without verifying the signature; (b) it makes no Valkey or database call before the ES256 signature has verified; (c) it never calls the limiter: the wrapper of TASK-041 counts its refusals; tests: a forged bearer causes zero store and database calls (spies); 121 forged bearers from one IP through the startApi composition give 120 times 401 and then 429 before the authenticator runs; 200 expired tokens from one IP cause no 429".
3. **TASK-055:** "REFRESH COOKIE REFUSALS (ADR-0016 amendment 12 item 4; D-ARCH-175; R-ARCH-36): every refusal of a presented refresh cookie (unknown, rotated, revoked, expired) is a 401 raised in the authentication slot, so the wrapper of TASK-041 counts it; the 401 response clears the cookie; test: 121 unknown cookies from one IP give 429 at the 121st before any lookup; security-analyst rates the R-ARCH-36 residual (a valid cookie costs one indexed read per request up to the credentialed ceiling before the public class limit) in this review".
4. **TASK-091:** "GUEST TOKEN COST (ADR-0016 amendment 12 item 4; D-ARCH-175): the guest authenticator does no I/O; it derives the token hash, and the quote row is matched by the handler query after the step-5 class limit; a refusal the authenticator raises itself is counted by the wrapper of TASK-041; test: a forged X-Quote-Token causes no database call before the public class limit has been consumed".
5. **TASK-171 and TASK-261:** "SIGNATURE REFUSALS (ADR-0016 amendment 12 item 4; D-ARCH-175): a failed signature is a 401 raised in the authentication slot and no database call precedes the verification; the wrapper of TASK-041 counts it; test: 121 bad signatures from one IP give 429 at the 121st".
6. **TASK-190:** "ADMISSION STORE FAILURE (ADR-0010 amendment 13; D-ARCH-178; PR041-SEC-03): when the admission counters cannot be read or written, anonymous fan-out to the account and, for an account with CARRIER_DAILY_QUOTA above 0, rates-pool calls of verified callers are refused locally (LOCAL_REJECT, CARRIER_BUSY; cached results still served); transactional calls are never refused and are counted in process and added to the daily counter on recovery; store calls are bounded and share a breaker; event rate_limit_store_unavailable with scope carrier-admission at most once a minute; tests: with the store failing, a guest quote gets CARRIER_BUSY for the account and makes zero carrier calls, a booking still reaches the carrier, and the count of the outage is added afterwards".
7. **TASK-215:** "TRUST PROXY PIN (ADR-0016 amendment 12 item 9; D-ARCH-179; PR041-SEC-05): the api task definition sets TRUST_PROXY_HOPS=2; a Terraform test (or Checkov custom policy) fails unless that value, the CloudFront origin-facing prefix list on sg-alb and the ALB rule that refuses a request without X-Origin-Verify are all present".
8. **TASK-214:** "the rate-limit counters (labels: the classes, authz-denial, unauthenticated, step0-credentialed, step0-authn-failed) and the store-breaker state are exported; PR041-SEC-04: a key-count gauge for the rl: prefix next to the Valkey memory alarms of D-ARCH-160".

9. **TASK-041, acceptance line AT-US-087-04:** "hops or CIDRs of the edge" becomes "hops of the edge" (ADR-0016 amendment 12 item 9 narrows amendment 1 to a hop count; D-QG-001 QG-041-C3 (c); D-ARCH-181).

10. **TASK-041, DoD notes (replaces nothing; add):** "PART 041-B REVISION 2 (ADR-0016 amendment 13; D-ARCH-182; PR041-SEC-09): the refresh cookie selects the credentialed rule only on the paths of routes that declare refresh-cookie, derived by createApp from route metadata; tests B1 (9) to (13) of the rulings file; the wrapper exemption keys on the code ACCESS_TOKEN_EXPIRED alone".
11. **TASK-052, replaces part (a) and the tests of the AUTHENTICATOR COST RULES line:** "(a) EXP PRE-CHECK UNDER E1 TO E5 (ADR-0016 amendment 13 item 3; D-ARCH-182; D-SECPR041-02): the unverified exp is used only to refuse an expired token early; every token that passes is verified in full (algorithms ES256 only, issuer, audience, the same clock tolerance) and nothing else of the unverified payload is read or logged; only a well-formed token whose exp is a finite number in the past is expired, anything else malformed is AUTH_REQUIRED and spends; the pre-check is bounded by a length cap, three base64url segments and alg equal to ES256 before the payload is decoded; ACCESS_TOKEN_EXPIRED is raised only there or by the library expiry check inside the tolerance and emits no security event; tests: 200 forged tokens with a past exp give 200 times 401 ACCESS_TOKEN_EXPIRED with zero signature verifications, zero store and database calls, no security event and no 429; a forged token with a future exp causes one verification and spends one unit; 121 forged bearers with a future exp from one IP through the startApi composition give 120 times 401 and then 429 before the authenticator runs; a forged bearer causes zero store and database calls". Parts (b) and (c) stay.
12. **TASK-214, add to RATE-LIMIT METRICS:** "an alert on the security event rate_limit_auth with class authn-failed and on the counter step0-authn-failed (ADR-0016 amendment 13 item 4; PR041-SEC-09; PRD R-16): the runbook entry says that every credentialed request of that address is refused for up to 60 s and names the two narrower designs".
13. **TASK-065:** "429 IS NOT AN AUTHENTICATION FAILURE (ADR-0016 amendment 13 item 5; D-ARCH-182): on 429 the web and admin clients wait for Retry-After and retry, on refreshSession too, and never sign the user out or clear the session because of it; test: a 429 on refresh followed by a 200 keeps the session".
14. **TASK-055, add to REFRESH COOKIE REFUSALS:** "the cookie selects the credentialed rule and the lock only on the three cookie routes (ADR-0016 amendment 13 item 1); test: with the budget of an IP spent, a sign-in request that carries a stale refresh cookie is served".
15. **TASK-041, DoD notes (add):** "PART 041-B REVISION 3 (ADR-0016 amendment 13 item 6; D-ARCH-225 to D-ARCH-227; code review R1-M1; D-TASK041-18): step 0 admits a credentialed request only while the failed count plus the units held for the address on the instance is below the limit; a unit is released by the outcome of the authentication slot, and by the close of the response only while the slot has not been entered; a refusal by the hold is counted under the label step0-authn-inflight and emits no security event; tests H1 to H6 of the rulings file section 9; the README section 7 sentence of section 9.3".
16. **TASK-052 and TASK-055, add to the forged-credential tests:** "PARALLEL BURST (ADR-0016 amendment 13 item 6; R-ARCH-36 (d)): through the startApi composition with the real authenticator and a limit of 5, 60 parallel requests with a forged credential enter the authenticator at most 5 times, and 60 such requests sent in waves by clients that disconnect after sending enter it at most 5 times; counted as signature verifications for a bearer and as lookups for a refresh cookie (spies)".
17. **TASK-108, add:** "REQUEST TIMEOUT AND THE STEP-0 HOLD (ADR-0016 amendment 13 item 6; R-ARCH-36 (d)): the 30 s request timeout also ends a request whose body stalls, and until this task the bound is the Node default of 300 s; test: a credentialed request that sends its headers and never completes its body is ended at the timeout, its in-flight unit is released, and a following credentialed request of the address is served".
18. **TASK-214, add to RATE-LIMIT METRICS (extends lines 8 and 12):** "the label step0-authn-inflight is exported with the others; a gauge of the in-flight units held on the instance, summed over addresses (a floor that never returns to 0 is a unit that was never released); an alert on refusals under step0-authn-inflight; the runbook entry of line 12 gains: a refusal by the hold lasts a second at a time, needs no refused credential, logs no security event and is told from the lock by its label (ADR-0016 amendment 13 item 6; D-ARCH-227)".
19. **TASK-065, add to line 13:** "a 429 from step 0 was refused before routing, so every method may be retried; a 429 with Retry-After 1 is retried with jitter and a bounded number of attempts before the normal error state (ADR-0016 amendment 13 item 6)".

Not a card, for devops-engineer: the first pipeline that deploys to a real target (not this run; `DEPLOY_TARGET_*` are blank) gets a post-deploy smoke step that sends one request through the public hostname and fails when the audit IP or the access-log `ip` of that request is an ALB or CloudFront address (PR041-SEC-05). It is a precondition of G4 for a production release.

## 7. Routed, not edited here

- **product-manager (wording; nothing waits for it).**
  - DR-A08 first step, DR-A22, REQ-SEC-005, NFR-SEC-005 and the US-040 note say "the per-IP limit of the route's class is applied before authentication". As built and ruled: the per-IP limiter that runs before authentication is route-agnostic (unauthenticated budget, credentialed ceiling, failed-authentication budget); the class rules run after authorisation and before validation and the handler. Suggested DR-A08 first step: "coarse per-IP pre-authentication rate limit (429 `RATE_LIMITED`, before any credential or token verification; route-agnostic: 120/min per IP without a credential, a per-IP ceiling with one, and a per-IP failed-authentication budget; ADR-0016 amendments 1 and 12)", and the fifth step: "rate limit of the route's class (per IP or per user; 429)".
  - REQ-SEC-006, A-053, EC-A32: the per-instance fallback covers `auth`, `email-send`, `public-quote`, `public-tracking` and `quote-create`; the others fail open. The carrier admission controls refuse instead of failing open (ADR-0010 amendment 13); this is visible to users during an outage as `CARRIER_BUSY` for real carriers.
  - AT-US-040-10 ("emitted and counted"): the event is logged once per key and window and a counter counts every refusal. I read the scenario as satisfied; product-manager confirms or rewords.
  - AT-US-040-06: the scenario body holds as tested (no password hash comparison, no token verification). Its title says "before authentication"; the limit runs after the authentication slot, which does no work on an anonymous route.
- **api-designer:** acknowledge the §7 text of section 5 and decide whether the §13 description cell of `rate_limit_auth` names the class `authn-failed` (part 041-B). The §13 table is parsed by SEC-TC-63: only a description cell may change.
- **security-analyst:** delta round on the fix head (their C3). PR041-SEC-02 (a) closes with part 041-A, (b) with part 041-B. R-ARCH-36 is theirs to rate at TASK-055.
- **qa-lead:** SEC-TC-41 gains the outage row of card line 6 when TASK-190 is dispatched.
- **data-architect:** PR041-SEC-07 (client IPs in Valkey keys and snapshots) is a data-inventory line. I did not rule a keyed hash: the keys stay as built.

## 8. What I considered and did not adopt

- **Per-IP class rules in front of the authentication slot (the literal reading of DR-A08).** It would bound every lookup an authenticator makes, for valid and forged credentials alike, at the class limit. It needs a third stage in the route pipeline, and with the failed-authentication budget the only case it still adds is R-ARCH-36. Not adopted now. The trigger to reopen it is in R-ARCH-36.
- **No lock, or a lock for the refresh cookie only (the security record's R2 (ii)), revision 2.** Not adopted now. My own estimate is that the lock saves little: a request refused at step 0 still costs its parsing, its log line and a store call, so a forged-bearer flood at the ceiling becomes a few times cheaper, not fifty. What it puts at risk is an office losing its signed-in service to one broken or hostile client. security-analyst and product-manager both prefer to keep the bound and have accepted that risk in writing, the lock is reversible, and nothing is exposed before a production release, so I ruled with them. ADR-0016 amendment 13 item 4 holds the trigger and the two narrower designs.
- **Putting the three cookie routes under the unauthenticated budget at step 0.** It would bound valid-cookie lookups too, but on a carrier-grade NAT the anonymous traffic of strangers (public tracking) would then starve the token refresh of signed-in users. A dedicated per-IP rule for those three paths avoids that and is the second design of amendment 13 item 4.
- **Counting a failed credential against the anonymous key itself (the code review's wording of option (b)).** Rejected: anonymous visitors of a NAT would then lock out its signed-in users, and the reverse.
- **A second store call at step 0 to read the failed count (the security record's `peek` sketch).** Replaced by one script over two keys, so the hot path keeps one round trip.
- **A configuration key for the ceiling factor.** Not now. The factor is one named constant and the counter label `step0-credentialed` shows when a tenant's NAT reaches it.
- **Falling back for every class.** It is the simpler rule and I think it is the better one, but REQ-SEC-006 says the other routes fail open, and only the classes that drive carrier calls and unauthenticated writes need it today.
- **A per-instance fallback for the carrier admission controls.** Rejected for refusal: K replicas would multiply the anonymous bucket by K while the shared view is missing, and what that risks is slow to recover (a daily quota lasts until 00:00 UTC; carrier throttling is keyed by the shared egress IP).

## 9. Revision 3: the in-flight hold of the failed-authentication budget (D-ARCH-225 to D-ARCH-227)

**Inputs.** Code review `docs/05-quality/reviews/PR-pending-TASK-041B-code-review.md` (R1-M1). Fix cycle 1 at `83a85739` on `feat/TASK-041-part-b-rate-limit-rulings-rev2`, read with `git show`: `in-flight.ts`, `limiter.ts` (`consumeGated`, `gated`), `limits.ts` (`ipLimiter`), `authn-failed.ts`, `counter.ts`, `app.ts` (the mount order). Developer decision D-TASK041-18 (D-ORCH-157 and the commit body). platform.md §5.4. Round 2 of the same code review (`86cdef9a`: R2-M1, R2-m1, R2-n1, probes P4b and P5) landed while this section was being written; the probe of section 9.2 was run before I read it, and the two agree. No security record of the part 041-B round existed when this was written.

### 9.1 Rulings

| # | Question | Ruling | Where |
|---|---|---|---|
| 1 | D-TASK041-18: a per-instance ledger of the credentialed requests in authentication; step 0 admits while `settled + held < limit` | **Accepted as a rule of step 0 (D-ARCH-225).** It closes R1-M1 for clients that stay connected, with no store call added. | ADR-0016 am. 13 item 6 |
| 2 | The bound across instances, `N × RATE_LIMIT_PUBLIC_PER_MIN` per address and window | **Accepted as residual R-ARCH-36 (d) (D-ARCH-225).** 360 to 1,440 a minute at 3 to 12 API tasks, against a ceiling of 6,000. | am. 13 item 6; risks.md |
| 3 | The cost: a valid credential is answered 429 with `Retry-After: 1` while the limit is in flight on an instance, slow request bodies included | **Accepted as part of the lock of amendment 13 item 2 (D-ARCH-225)**, with rulings 4 and 5 as conditions. No change of design. | am. 13 item 6 |
| 4 | The unit is released at every close of the response (code review R2-M1, which offers a fix (a) or a ruling (b)) | **Not accepted; option (a) (D-ARCH-226).** A client that disconnects after admission frees its unit while its authentication still runs, and the burst is back (review probe P4b; section 9.2, cases B and C). The case is not recorded as a residual. Change C-1. | am. 13 item 6 "Release" |
| 5 | A refusal by the hold is counted under `step0-authn-failed` and logs no event (code review R2-n1, routed there to TASK-214) | **Not accepted as built (D-ARCH-227).** The hold gets its own counter label in fix cycle 2: trigger (iv) of the residual reads it, and the fix cycle is open for C-1 in any case. TASK-214 keeps the export, the gauge and the alert. Change C-2. No event is required. | am. 13 item 6 "Signal" |
| 6 | The wording of the cost (code review R2-m1) | **Taken into item 6:** every credentialed request counts, valid ones included, from step 0 to the authentication outcome, body upload included; the room is `limit − k` after `k` failures, with no event below the limit; held slow bodies need no spend and log no event. | am. 13 item 6 |

### 9.2 Probe

A read-only script in the scratchpad (not committed; this recipe is complete) imported the compiled `ipLimiter`, `withAuthnFailedBudget` and `createRateLimitKit` from `apps/api/dist` of the clean worktree `../Shipqube-TASK-041B` at `83a85739` and mounted them in an Express app: step 0, then the wrapped authentication slot. The slot was a seam authenticator that refuses a junk bearer with `AUTH_REQUIRED` after a fixed delay and counts its entries. The kit ran on its in-memory store, with a limit of 5. The clients were raw TCP sockets on loopback, on Node 24.22.3. No Docker.

| Case | Load | Result |
|---|---|---|
| A | 60 parallel junk bearers, the clients stay; authenticator delay 300 ms | Authenticator entered 5 times; 5 × 401, 55 × 429 with `Retry-After: 1`. The developer's row holds |
| B | 12 waves of 5 junk bearers, 20 ms apart; authenticator delay 600 ms; each client destroys its connection 4 ms after it sent its request | **Authenticator entered 60 times, 60 at once.** After every wave the ledger held 0 or 1 unit while 5 to 60 authentications ran. One `rate_limit_auth` event |
| C | As B, with a half-close in place of the destroy | **Authenticator entered 60 times, 60 at once** |
| D | `express.json` between step 0 and the slot, the order of `app.ts`; 5 `POST` requests with a junk bearer, `Content-Length: 1000` and 6 bytes of body | Held 5, authenticator entered 0. Three requests with a bearer the seam accepts: 3 × 429 with `Retry-After: 1`, no event. After the 5 clients left: held 0, and the valid bearer is served |

The code review reached the same result through `createApp` in a Jest extract (R2.1, probe P4b: 60 staggered junk bearers, each aborted 15 ms after sending, slot 300 ms: 60 entries, 60 at once; control 5). Its probe P5 drove the breaker-wrapped Valkey store with a simulated client that delivers queued replies in one step, and found no undercount from reply interleaving.

What neither probe shows: a real Valkey (the reply order the bound rests on; test H6), a real authenticator, and what the edge does with a client that disconnects or sends a slow body. The Compose `edge` and the ALB may or may not pass either on to the API; the rule does not rely on them.

Why cases B and C matter: the refusals with a cost are the refresh-cookie lookups of TASK-055, which wait for the database. A client that sends its request and closes the connection needs no timing skill for that; the window is as long as the lookup.

### 9.3 Exact changes for fix cycle 2 of part 041-B

**C-1. When a unit is released (`in-flight.ts`, `limits.ts`, `authn-failed.ts`).**

- The wrapper marks the holder as entered before it calls the slot.
- The close handler that step 0 registers releases only a holder that is not marked. The check "the response closed before the store answered" stays as it is.
- The outcome of the slot releases the unit as today, after the spend has landed when the slot refused. It does so whether or not the response is still open.
- No timer. Every authenticator is bounded by its own timeouts (CLAUDE.md §9). One that never answers is a defect; it shows as a held unit that stays (the gauge of card line 18), not as a silent loss of the bound.
- The JSDoc of `in-flight.ts` and of `ipLimiter` states the rule. The sentence "the response close releases it when the slot is never reached" of the commit body is the rule; the code released at every close.

**C-2. A label for the hold (`counter.ts`, `limits.ts`, `limiter.ts`).**

- `StepZeroLabel` gains `step0-authn-inflight`. A refusal by the hold is counted there; a refusal by a spent budget stays under `step0-authn-failed`.
- The decision says which of the two it is. The value of `Retry-After` does not: the rest of a failed window can be 1 s too.
- A request whose client had gone before step 0 answered is not admitted, as today, and is not counted as a refusal under either label: nobody was refused, and the access line records the abort (R2-n1).
- The hold emits no security event. `rate_limit_auth` stays the event of refused credentials (api/README §13 is not changed).

**C-3. api/README §7 (rides the pull request, as B5).** After the sentence that ends "whether its own credential is valid or not." in the paragraph of section 5.2:

> The budget also counts the credentialed requests of the IP that an instance has admitted and whose authentication is not decided yet. When these and the counted failures together reach the limit on that instance, a further credentialed request is answered 429 with `Retry-After: 1`. Such a refusal is counted, and it is not a security event.

**Tests.**

- **H1** (exists). Limit 5, 60 parallel junk bearers, the clients stay: the authenticator is entered 5 times; 5 × 401 and 55 × 429 with `Retry-After: 1`.
- **H2** (new; fails on `83a85739`; the api row that R2-M1 asks for). Limit 5, a seam authenticator that refuses after a delay; requests with a junk bearer staggered inside one delay (12 waves of 5, or the P4b shape of one every 3 ms), and every client disconnects after its request was admitted and before the authenticator answers. Once with a destroyed connection and once with a half-close. The authenticator is entered 5 times in each. After the outcomes the ledger holds 0 for the address. The JSDoc of `ipLimiter` and the test title "so an abort cannot skip the hold" are corrected with it.
- **H3** (one exists, one new). A request that never enters the slot releases its unit at the close: the 404 row, and a client that leaves while its body is read.
- **H4** (new). With `limit` requests of an address holding their units on unfinished bodies, a request with a credential the seam accepts is answered 429 with `Retry-After: 1`, no event is emitted and the authenticator is not entered; after the clients leave, the same request is served.
- **H5** (new). The hold refusal of H1 or H4 increments `step0-authn-inflight` and not `step0-authn-failed`; a refusal by the spent budget does the reverse.
- **H6** (new; lane B, `rate-limit.int.test.ts`). The limiter and the ledger against a real Valkey: limit 5, 60 parallel gated calls, each admitted call spends and then releases, and 60 more gated calls are issued while those spends are in flight. Exactly 5 of the 120 are admitted. This is the proof of the reply order that the bound on one instance rests on; the stores of the unit and api rows answer in order by construction.

### 9.4 Considered and not adopted

- **A timer that releases an entered unit.** Any timer shorter than the slowest authentication gives the burst back, and a longer one adds nothing to the outcome. The gauge shows a unit that never comes back.
- **A reservation in the store now.** It would make the bound `limit` for the whole fleet. It costs one more store call per authenticated request, and a slow body would then hold a unit of the fleet, not of one instance. `N × 120` refusals a minute cost the authenticators of this run next to nothing. On file (amendment 13 item 6).
- **Admission at the authentication slot, with a second read of the budget there.** A body in transit would hold nothing. It is the second store call that section 8 already declined for the hot path. On file.
- **The JSON body parser after the authentication slot.** A provider signature covers the request body (a Stripe signature is computed over the raw payload), so on a `signature` route the body is read before authentication in any design, and the pipeline order is the one of DR-A08.
- **A security event for a refusal by the hold.** The event vocabulary of §13 is about refused credentials, and a hold that is full with honest slow requests is a capacity signal. The label and the alert carry it. security-analyst may ask for more in its round.
- **A slack above 0 on one instance, or a separate limit for held units.** Either raises the bound on one instance above the budget and removes no case of the cost.

### 9.5 Routed

- **senior-developer:** fix cycle 2 of part 041-B with C-1, C-2, C-3 and H1 to H6; card lines 15 to 19 at the next fold.
- **code-reviewer:** round 2 (`86cdef9a`) asks for one of two closures of R2-M1. This ruling takes (a), the fix commit; (b) is declined, so no abort bound is recorded. Merge condition C2 of R2.6 is answered by amendment 13 item 6 (the `N × limit` bound and the scope of the hold in the words of R2-m1). One difference from R2.6 C7: the label of R2-n1 is ruled into fix cycle 2, not left to TASK-214 alone. Round 3 reviews the fix delta.
- **security-analyst:** the rating of residual (d) in the part 041-B round (D-SECPR041B-01); cases B, C and D; concurrence that the hold needs no security event. A rating above LOW reopens the design (amendment 13 item 6).
- **product-manager:** PRD §9 R-16 and A-112 describe the lock as caused by 120 refused credentials. One sentence is missing: the same refusal can last a second at a time on one instance while 120 credentialed requests of the address are in flight there, with no refused credential. No value changes and nothing waits for it.
- **api-designer:** the §7 sentence of C-3. §13 is unchanged.
- **quality-gatekeeper:** amendment 13 item 6 adds a rule to an Accepted ADR and widens when a valid credential is refused (CLAUDE.md §5). Its verification is a merge condition of part 041-B. Fix cycle 2 does not wait for it.
