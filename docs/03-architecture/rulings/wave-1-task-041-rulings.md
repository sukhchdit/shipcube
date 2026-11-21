# Wave-1 TASK-041 — rulings on the rate limiter (2026-11-20)

Owner principal-architect. Decisions D-ARCH-173 to D-ARCH-179. ADR-0016 amendment 12, ADR-0010 amendment 13.

**Revision 2 (2026-11-20, D-ARCH-182, ADR-0016 amendment 13; security round 2, PR041-SEC-09 and E1 to E5).** Part 041-A is unchanged. In part 041-B, B1 gains the route rule for the refresh cookie, the true scope of the lock, tests (9) to (13) and the wrapper conditions; section 5.2 and card lines 10 to 14 follow.

**Revision 3 (2026-11-21, D-ARCH-225 to D-ARCH-227, ADR-0016 amendment 13 item 6; part 041-B code review R1-M1 of round 1 and R2-M1, R2-m1, R2-n1 of round 2; developer decision D-TASK041-18).** The in-flight hold of the failed-authentication budget is accepted as a rule of step 0, with residual R-ARCH-36 (d). Two changes are merge conditions of part 041-B: when a hold is released, and a counter label of its own. Section 9 and card lines 15 to 19 are new; sections 1 to 8 are unchanged except one pointer in B1.

**Revision 4 (2026-11-21, D-ARCH-228 to D-ARCH-231, ADR-0016 amendment 13 item 6 as restated; D-QG-008 conditions QG-041B-C1 and QG-041B-C2; PR041-SEC-16).** The cost of the hold is a bound on concurrency, accepted with the design unchanged. The release rule is complete, and one change (C-4) goes to fix cycle 3 of part 041-B: the wrapper ends a slot that ends without an outcome. Section 10 and card lines 20 to 26 are new; lines 23 and 24 replace parts of lines 18 and 19. Sections 1 to 9 are unchanged except one pointer in B1.

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
- **In-flight hold (revision 3).** Step 0 also refuses a credentialed request, with `Retry-After: 1`, while the failed count plus the address's requests still in authentication on the instance reaches the limit. The rule, its release, its label and tests H1 to H6 are in section 9. Revision 4 restates its cost as a bound on concurrency and completes the release rule (change C-4, tests H7 to H10): section 10.
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

Revision 4 (2026-11-21, D-ARCH-228 to D-ARCH-231; section 10). Lines 23 and 24 replace parts of lines 18 and 19, which D-SD-012 placed verbatim.

20. **TASK-041, DoD notes (add):** "PART 041-B REVISION 4 (ADR-0016 amendment 13 item 6 as restated; D-ARCH-228 to D-ARCH-231; D-QG-008 conditions QG-041B-C1 and QG-041B-C2; PR041-SEC-16): fix cycle 3 carries change C-4 of the rulings file section 10.4: a slot that ends without an outcome is ended by the wrapper (it answered the client itself: the unit is released and nothing is spent; nothing was answered: the wrapper reports an error, 500, and that outcome releases the unit), with the error line api.authn_slot_unreported at most once a minute per operation and instance; nothing about the response releases an entered unit, neither its close nor its finish; tests H7 to H10; due before TASK-052 is dispatched".
21. **TASK-052, TASK-055, TASK-091, TASK-171 and TASK-261, add to AUTHENTICATION SLOT OUTCOME:** "ASYNC SLOT (ADR-0016 amendment 13 item 6 Release; D-ARCH-230; PR041-SEC-16): the authenticator is an async function that awaits its work and reports before it returns (next once, a throw or a rejection); it never starts or ends the response (setting a header such as Set-Cookie or Cache-Control is allowed) and starts no work that reports after its promise has settled; the wrapper of TASK-041 answers 500 for a slot whose promise fulfils without an outcome and writes api.authn_slot_unreported, so each row per refused shape also asserts that this line was not written; optional: an ESLint restriction on res.status, json, send, end, redirect, write, writeHead and flushHeaders in the authenticator module of this task".
22. **TASK-108, add:** "REQUEST TIMER AND THE AUTHENTICATION SLOT (ADR-0016 amendment 13 item 6 Release; D-ARCH-230): the timer counts from the arrival of the request and may answer 503 while the authentication slot of that request is still running; that answer releases no in-flight unit of a request that entered the slot, the outcome of the slot does, and a refusal that lands afterwards is still spent; test with a limit of 5 and an authenticator that refuses later than the timer answers: five junk credentials are answered 503 by the timer, five more are sent while the first five are still in authentication and are answered 429 with Retry-After 1, the authenticator is entered 5 times and 5 units are spent; a request the timer answered before its body completed does not enter the slot when the rest of the body arrives (D-TASK041-20)".
23. **TASK-214, RATE-LIMIT METRICS.** The card gains the lock `api-ratelimit`. In line 18 as folded, the words from "a gauge of the in-flight units held on the instance" to "an alert on refusals under step0-authn-inflight" are replaced by: "two gauges read from the ledger through a read-only accessor that this task adds to in-flight.ts under the lock api-ratelimit: the in-flight units held on the instance summed over addresses, and the age in seconds of the oldest held unit; a histogram of the time from the admission at step 0 to the authentication outcome; alert AuthnInFlightSustained: refusals under step0-authn-inflight on one instance in each of five consecutive minutes (the increase over 1m is above 0, for 5m), severity ticket, so that one burst does not fire it; alert AuthnInFlightUnitStuck: the oldest held unit on an instance is older than 60 s, for 1m, severity ticket; no alert on a single refusal: the counter is read in the monthly review of the step-0 counters (A-112); a lane A test pins both names, expressions, for values and labels". The runbook sentence of the same line gains: "the hold is a bound on concurrency: the room of an address on an instance is the limit less its counted failures, and what arrives beyond it at the same moment is refused whatever the pace (ADR-0016 amendment 13 item 6 as restated; D-ARCH-228, D-ARCH-229); a stuck unit points at an authenticator that hung, and the error line api.authn_slot_unreported names an authenticator that ended without an outcome".
24. **TASK-065, 429 IS NOT AN AUTHENTICATION FAILURE.** The two clauses that line 19 appended, from "a 429 from step 0 was refused before routing" to the end, are replaced by: "every 429 RATE_LIMITED is handled by one rule, whichever stage answered it, because a client cannot tell them apart: the same request is sent again after Retry-After plus a random delay of up to 1 s, with the same Idempotency-Key where the operation takes one, at most three times before the normal error state; test with an injected random source: ten parallel requests that are each answered 429 with Retry-After 1 are sent again at ten different moments, and each succeeds (ADR-0016 amendment 13 items 5 and 6; D-ARCH-229)".
25. **The card that owns the P6 load profile (TASK-280 holds the harness; senior-developer places the line), QG-041B-C6:** "IN-FLIGHT HOLD IN THE LOAD RUN (ADR-0016 amendment 13 item 6; D-QG-008 QG-041B-C6; D-ARCH-229): the load run records the refusals under step0-authn-inflight and the time from the admission at step 0 to the authentication outcome (p50, p95, p99), together with the rate limits and the number of client addresses the run used; a run whose virtual users share one address is refused beyond the room by design, and its count is recorded and not judged; a refusal under the label in a run whose virtual users have their own addresses reopens the cost of the hold (trigger viii)".
26. **TASK-142 and TASK-182, add to CLIENT RESUME and CLIENT RECONNECT:** "the random delay of up to 1 s before the stream is reopened is also what keeps the reconnects of one address after a server stop below the in-flight room of step 0 (ADR-0016 amendment 13 item 6; amendment 14 item 4; D-ARCH-228); it is not removed or shortened".

Not a card line, for the same fold: if fix cycle 3 takes the rows of QG-041B-C5 (b) and (c) and of PR041-SEC-15 (section 10.4), OPTIONAL API ROW, GZIP BODY on TASK-041 is done, and the two C5 rows are not added to TASK-052 and TASK-108. Otherwise C5 (b) goes to the PARALLEL BURST rows of TASK-052 and C5 (c) beside the declared-oversize row of TASK-108, as D-QG-008 routes them.

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

## 10. Revision 4: the hold as a bound on concurrency, and the release contract (D-ARCH-228 to D-ARCH-231)

**Inputs.** D-QG-008 (PASS_WITH_CONDITIONS; conditions QG-041B-C1 and QG-041B-C2 are the architect's; probe QG-P1; five observations). Code review rounds 2 and 3 and security rounds 1 and 2 of part 041-B. The branch at `12b8a10a`, read by SHA. D-SD-012 (card lines 15 to 19 as folded). REQ-SEC-005, REQ-SEC-015, NFR-SEC-005, PRD §9 R-16, A-112. platform.md §5.4, §5.5 and §10.4. Card lines 20 and 21 of the TASK-044 rulings. D-ORCH-162, which landed while this was written: part 041-A is on main as `61c53b5e`, and part 041-B is merged onto it by the procedure of D-ORCH-158.

**Edited.** ADR-0016 (amendment 13 item 6 restated; dated pointers in amendment 12 item 4, amendment 13 items 2 and 5 and amendment 14 item 4), risks.md 1.32 (R-ARCH-36 (d)), nfr-strategy.md (the SEC-005 cell), platform.md §5.4 (one sentence), this file, DECISIONS.md. Not edited: `api/README.md`, the requirement and story files, the plan files, the threat model.

### 10.1 Rulings

| # | Question | Ruling | Where |
|---|---|---|---|
| 1 | QG-041B-C1 (a): the cost of residual (d) | **Restated as a bound on concurrency (D-ARCH-228).** On one instance an address has room for `limit − settled` credentialed requests between step 0 and their authentication outcome. What arrives beyond the room at the same moment is answered 429 with `Retry-After: 1`, whatever the pace and whatever one authentication takes. The sentence "120 are in flight only when each takes more than a second on average" is withdrawn; its arithmetic stays for paced traffic only. | ADR-0016 am. 13 item 6; risks.md |
| 2 | Is it acceptable that a burst of valid credentials is refused, or must the design change? | **Accepted. The design does not change (D-ARCH-228).** No browser traffic of this run reaches the room, the answer is a retry after one second of a request of which nothing ran, and the clients retry by rule. product-manager decides the product side (QG-041B-C3, text in 10.5); "not accepted" comes back with the per-credential design. | am. 13 item 6 |
| 3 | "Nothing is refused before TASK-052, because the production slot is synchronous" (D-QG-008, "What stands") | **Not adopted in that form.** A synchronous slot is refused too when the store replies of one read are judged together (10.2, rows 5 and 6). Before TASK-052 no honest request is affected for another reason: the stub accepts no credential. | am. 13 item 6 |
| 4 | QG-041B-C1 (b): trigger (iv) and the alert of card line 18 | **Reworded (D-ARCH-229).** Sustained refusals alert and reopen; one burst is counted and reviewed monthly. A second alert on the age of the oldest held unit replaces "a floor that never returns to 0". | am. 13 item 6 "Signal", "Reopened by"; card lines 23 and 25 |
| 5 | QG-041B-C1 (c): the stop of amendment 14 item 4 as a source of bursts | **Assessed: not a source,** given the stream caps and the random delay of up to 1 s before a client reopens. That delay is now named as part of the stop rule. | am. 13 item 6; am. 14 item 4; card line 26 |
| 6 | QG-041B-C2 (a): D-TASK041-20 | **In the Accepted text.** A request whose unit the close released does not enter the slot and goes no further. | am. 13 item 6 "Release" |
| 7 | QG-041B-C2 (b): what an outcome is; the contract of PR041-SEC-16 | **In the Accepted text (D-ARCH-230).** An outcome is `next` once, a throw or a rejection. An authenticator never starts or ends the response. A slot that has not reported when it returns returns a promise that stays pending until it reports. | am. 13 item 6 "Release"; am. 12 item 4 |
| 8 | PR041-SEC-16 remedy (b): release at the `finish` of the response when no outcome was reported | **Declined in that form; its purpose is adopted in another (D-ARCH-230).** A `finish` can come from the request timeout while the slot still runs (10.3: ten authentications at once at a limit of 5, none spent). The wrapper ends a slot that ends without an outcome: change C-4 (10.4). | am. 13 item 6 "Release" |
| 9 | QG-041B-C2 (c) and (d): security-analyst's additions (b) and (a) | **Folded.** "No timer" rests on a bounded slot latency for every authenticator that does I/O. A declared `Content-Length` above the limit with no body holds a unit; the timeout of TASK-108 counts from the arrival of the request. | am. 13 item 6 |
| 10 | QG-041B-C2 (e) and (f): the sentences about `83a85739`; pointers | **Updated.** Fix cycle 2 closed both at `12b8a10a`. Pointers are in amendment 12 item 4, the SEC-005 cell of nfr-strategy.md and platform.md §5.4. | ADR-0016; risks.md; nfr-strategy.md; platform.md |
| 11 | D-QG-008 observations 1 to 5 | (1) The worst minute is in "Why that bound is accepted". (2) One client rule for every `RATE_LIMITED` answer (card line 24; a sentence for api-designer in 10.7). (3) Trigger (viii) reads the load run. (4) TASK-214 adds the ledger accessor under the lock `api-ratelimit` (card line 23). (5) The register row lists all eight triggers. | as named |

### 10.2 Probe A: the hold is a bound on concurrency

Scripts in the scratchpad, not committed; this recipe is complete. They import the compiled `ipLimiter`, `withAuthnFailedBudget` and `createRateLimitKit` from `apps/api/dist` of the part-B worktree at `12b8a10a` by file URL. Nothing was run or written in that worktree, and its compiled files matched the source at the head where the hold is concerned. The app is step 0, then `express.json()`, then the wrapped slot, then a handler, in the order of `app.ts`. Limit 120. One client address, one instance, raw loopback sockets opened before the burst. Node 24.22.3, no Docker, no Jest.

Two stores. The first is the kit's in-memory store, as in QG-P1. The second wraps the branch's `FakeValkey`: it runs each script when it is called and delivers the replies produced since the last delivery in one synchronous step, as one read of a store connection does (the model of code review probe P5 and security probe PD).

| # | Store | Load | Authenticator | Answers |
|---|---|---|---|---|
| 1 | in memory | 300 at once | synchronous | 300 × 200 |
| 2 | in memory | 300 at once | one ES256 verification (WebCrypto) | 120 or 121 × 200, **179 or 180 × 429 with `Retry-After: 1`**, all under `step0-authn-inflight`, no event |
| 3 | in memory | 300 at once | a lookup of 5 ms | 263 to 284 × 200, **16 to 37 × 429** |
| 4 | in memory | 100, 120 and 121 at once | one ES256 verification | all 200 |
| 5 | replies per read | 300 at once | **synchronous** | 284 or 285 × 200, **15 or 16 × 429**; the replies came in batches of 127 or 128, 128 and 44 or 45, and each batch above 120 lost its excess |
| 6 | replies per read | 130 at once | synchronous | 122 × 200, **8 × 429** (batches of 128 and 2) |
| 7 | replies per read | 120 and 121 at once | synchronous | all 200 |
| 8 | replies per read | 300 at once | one ES256 verification | 164 × 200, 136 × 429 |
| 9 | either | 300 paced at 100 a second | ES256, or a lookup of 5 ms | all 200 |
| 10 | either | 300, each after a random delay within 1 s | ES256, or a lookup of 5 ms | all 200; at most 64 in authentication at once |

Rows 1 to 4 and 9 reproduce QG-P1. Rows 5 to 7 are new: the admission of every reply of one read happens before any of those requests moves on, so the time the slot takes is not what decides. The size of a read (128 here) belongs to this host and this fake.

What the probe does not show: a real Valkey client (how many replies one read carries), a real authenticator, the edge. The clients and the server share one process, so arrivals are read in larger groups than separate clients would give; row 10 therefore overstates how many are in authentication at once. A retry row was run and proves nothing: on loopback the retried requests open new connections and no longer arrive together. With 1,000 reconnects in one second the loopback refused connections, so that size was not measured.

### 10.3 Probe B: what releases an entered unit

The same harness with a limit of 5, the in-memory store, and four builds of the wrapper: the compiled `authn-failed.js` of `12b8a10a` and three scratch copies of it. A stand-in for the request timer of TASK-108 sits in front of step 0 and answers 503 through the response when nothing has answered after a set time.

- **Head:** `12b8a10a` unchanged.
- **F:** a release at the `finish` of the response when no outcome was reported (security-analyst's candidate F).
- **G:** F, but only once the slot has ended (it returned, and a promise it returned has settled).
- **C-4:** the ruled form (10.4). No listener on the response.

| Case | Head | F | G | C-4 |
|---|---|---|---|---|
| PH: the slot answers five junk bearers itself with 401, from a plain function or from an `async` function; then a valid bearer | 5 units held for good; the valid bearer gets 429 at 0 s and at 1.5 s | 0 held; 200 | 0 held; 200 | 0 held; 200; five defects reported |
| PH from a callback (the slot returns nothing and answers 5 ms later) | 5 held for good | 0 held | 0 held | **5 held for good** (outside the contract twice; the age gauge shows it) |
| T2: the timer answers 503 at 60 ms, an `async` slot refuses at 300 ms | the unit is held until the outcome; 1 spend | **released at the 503 while the slot runs; no spend** | held until the outcome; 1 spend | held until the outcome; 1 spend |
| T2 with a slot that reports from a callback | held; 1 spend | released early; no spend | released early; no spend | held; 1 spend |
| T2 burst: five junk bearers are answered by the timer while their slot runs (400 ms); five more arrive 200 ms after the first | 5 entries, peak 5, 5 spends; the second five get 429 | **10 entries, 10 at once, 0 spends** | 5, 5, 5 | 5, 5, 5 |
| An `async` slot ends without reporting and without answering; the clients wait | held for good; the clients hang | held until something answers | held until something answers | answered 500 at once; 0 held; 0 spends |
| The same, and the clients leave after 40 ms, with or without the timer | 5 held for good | 5 held for good (an answer to a closed socket gives no `finish`) | 5 held for good | 0 held |
| PA2: 60 junk bearers, one every 3 ms, each client leaves 15 ms after sending (destroy or half-close), slot 300 ms | 5 entries, 5 spends, ledger 0 | the same | the same | the same |
| H1: 60 parallel junk bearers, the clients stay | 5 entries; 5 × 401, 55 × 429 | the same | the same | the same |
| A conforming `async` slot: accepted, refused, expired, thrown, refused by a throw | 200, 401, 401, 500, 401; 2 spends; no defect | the same | the same | the same |
| An `async` slot answers itself and then also reports a refusal 20 ms later | 5 spends, ledger 0 | 0 spends: the report comes after the `finish` and is dropped | 5 spends, ledger 0 | 5 spends, ledger 0 |

Reading. F closes PH and reopens the class of R2-M1 through the timer: a client makes the timer fire with a slow body, and the timer's answer frees the unit while the authentication still runs. G keeps the timer case right only for a slot that returns a promise. C-4 keeps it right for every slot, because nothing about the response releases an entered unit, and it also ends a slot that returns without reporting or answering. Its one gap is a slot that returns no promise and answers from a callback later.

### 10.4 Exact change for fix cycle 3 of part 041-B

One commit on the part-B head: `12b8a10a`, or its merge with main now that part 041-A is there (D-ORCH-162); the order is the orchestrator's. Due before TASK-052 is dispatched. If part 041-B is merged first, the change is a third part of TASK-041 under the same locks with the same due date.

**C-4. A slot that ends without an outcome (`authn-failed.ts`; `app.ts` only to hand the wrapper a logger).**

- After the slot's handler has returned:
  - it returned a promise: a rejection is an outcome, as today; a fulfilment while no outcome has been reported means the slot ended without an outcome;
  - it returned no promise: when no outcome has been reported and the response has been started (`res.headersSent`), the slot ended without an outcome; when no outcome has been reported and nothing was started, the wrapper waits, as today (a slot that reports from a callback; the test seams do this).
- A slot that ended without an outcome:
  - writes the error line below;
  - when the response has been started: the wrapper marks the outcome as known, releases the unit and calls nothing more. No `next`, no spend.
  - when nothing was started: the wrapper reports `new Error('The authentication slot ended without an outcome')` through its own outcome path. That is the path of any error that is not an `AppError`: no spend, the unit released, 500 `INTERNAL_ERROR` from the problem handler.
- The error line is `api.authn_slot_unreported`, level error, with `operation_id` and `status` (the status the slot wrote; absent when it wrote none). At most once a minute per operation and instance, the pattern of `createOutageReporter`. No request data and no header value. It is an application log line, not a security event: api/README §13 does not change.
- No listener on the response is added. The close keeps releasing only a unit that never entered. The `finish` releases nothing.
- The JSDoc of `withAuthnFailedBudget` states the contract: an outcome is `next` once, a throw or a rejection; an authenticator never starts or ends the response; a slot that has not reported when it returns returns a promise that stays pending until it reports. `in-flight.ts` is not changed.

**Tests.**

- **H7** (new; fails on `12b8a10a`). Limit 5, through `createApp` with the `authenticate` seam. A seam slot answers a junk bearer itself with 401 and reports nothing, once from a plain function and once from an `async` function after an `await`. After five such requests the ledger holds 0, a request with a credential the seam accepts is served, the failed count is 0 and the error line was written once.
- **H8** (new; fails on `12b8a10a`). An `async` seam slot returns without reporting and without answering. Every request is answered 500 `INTERNAL_ERROR`. The ledger holds 0 and the failed count is 0. With clients that leave 40 ms after sending (raw sockets) the ledger holds 0 too, and the next valid request is served.
- **H9** (new; passes on `12b8a10a`; it pins why the `finish` releases nothing). Limit 5. An `async` seam slot refuses a junk bearer 400 ms after it was entered. 60 ms after it was entered the response is answered 503 from a timer, as the request timer of TASK-108 will do. Five such requests, then five more 200 ms after the first. The authenticator is entered 5 times, 5 units are spent, the second five are answered 429 with `Retry-After: 1`, and the ledger holds 0 at the end.
- **H10** (new; unit). A conforming slot (accepts, refuses, expired token, throws, rejects, reports twice) writes no error line and releases its unit exactly once.
- H1 to H6 stay green without an edit. A seam that is an `async` function and reports after its promise has fulfilled is outside the contract; it is corrected in the test, not allowed for in the wrapper.

**Mutants for the review round.** A release at `finish` (H9: 10 entries and no spend). No check at fulfilment (H7 `async`, H8). No check of `headersSent` at the return (H7 plain). The unanswered case calls `next()` without an error (H8: not 500). The unanswered case spends (H8: failed count).

**May ride the same commit (rows only, no product code; the orchestrator decides).** The delta rounds are owed in any case, so these no longer need to wait for another task: the `gzip` row of PR041-SEC-15 and R3-n2; R3-n1 (the H6 assertion) and R3-n3 (the seam pin); QG-041B-C5 (b), a row in which arrivals continue while the spends land (the QG-P2 shape); QG-041B-C5 (c), a row for a refused body (malformed JSON and 413 with a credential: the unit is released and the slot is not entered).

**What changes in the rounds.**

- code-reviewer: round 4 on the delta, with the mutants above. H1 to H6 and the verdict on fix cycle 2 stand.
- security-analyst: a delta round on the new head, which then carries the binding. It re-runs PA2, PG and PH, runs the timer case, and closes or keeps PR041-SEC-16. It can take the re-rating of PR041-SEC-11 (QG-041B-C4) in the same round.
- Lane B on the merge head is unchanged in kind: H6 against a real Valkey, and the api project now with H7 to H9.
- quality-gatekeeper: one closing entry for QG-041B-C1 and QG-041B-C2 on the restated item 6.

### 10.5 Text for product-manager (QG-041B-C3)

A D-PM entry accepts this form of the refusal, or does not. If it does not, the question comes back to principal-architect, and the next step is the per-credential design of item 6. The recommendation is to accept.

1. **PRD §9 R-16, risk cell, after the sentence that ends "are refused while it lasts."**
   > The same refusal has a second, shorter form (ADR-0016 amendment 13 item 6, D-ARCH-228). Each API instance lets one address have at most 120 requests with a credential between the first limiter and their authentication result at the same moment, less the refused credentials already counted in that minute. Requests beyond that number that arrive together are answered 429 with `Retry-After: 1`, valid credentials included. No refused credential and nothing slow is needed, and the pace over the minute does not matter. A browser does not send that many at once. The form is met by a client that sends more than that in parallel on purpose (a script or an integration that uses a session token, a load generator), by retries that all arrive in the same instant, and by a client on the address that keeps requests open with unfinished bodies.
2. **R-16, likelihood and impact of the second form.** Likelihood Low: no browser traffic of M1 puts more than 120 requests of one address on one instance in the same instant, and production starts with three instances. Impact Low: the excess is answered at once, nothing of the request ran, the client repeats it after a second, and no data or money is at risk.
3. **R-16, mitigation cell, added.**
   > The web and admin clients repeat every 429 after `Retry-After` plus a random delay of up to one second (TASK-065). Detection: the counter `step0-authn-inflight` and two alerts, one on refusals that last five minutes and one on a request that never leaves authentication (TASK-214). A single burst is counted and read in the monthly review. Re-opened by refusals that last, by refusals on more than three days of a month, and by the first client that sends in parallel by design (API keys and partner integrations, M3).
4. **A-112, after "can share one NAT address before the ceiling is felt".**
   > That sentence is about the rate over a minute. Separately, at most 120 credentialed requests of one address, less its refused credentials of the minute, may be between the first limiter and their authentication result on one API instance at the same moment (ADR-0016 amendment 13 item 6). Ten users at 600 a minute each use less than one such place on average. More than 120 requests sent in the same instant to one instance, about 360 across the three instances production starts with, have their excess answered 429 with `Retry-After: 1`.
   In its validation cell: the monthly review of the step-0 counters includes `step0-authn-inflight`.
5. **NFR-SEC-005, a reading in two points.**
   - "Redis-backed, shared across replicas" is true of every counter, the count of refused credentials included. The room for requests in authentication is kept per instance and in memory by design. So for refused credentials sent in parallel the budget holds per instance: `N` instances let up to `N × 120` of one address reach verification in a window (R-ARCH-36 (d)). The two-replica run proves the shared count for requests sent one after another. Suggested addition to the method: 2 replicas, a budget of 5, 60 parallel forged bearers: each replica enters authentication at most 5 times.
   - The pass line "429 on the (limit+1)th request in 100% of cases and no 429 at the limit" holds for requests sent one after another, which is how the method sends them. A 429 with `Retry-After: 1` from the room is not a breach of a listed limit and can come below every one of them. Suggested addition: "Requests of one IP sent in parallel are also bounded per instance by the failed-authentication budget (120 less its counted failures in authentication at once; 429 with `Retry-After: 1` beyond). This is outside the pass line above and has its own rows: 60 parallel forged bearers at a budget of 5 enter authentication 5 times; 30 parallel valid bearers at a budget of 5 are each answered 200 or 429 with `Retry-After: 1`."
   - Suggested addition to the target cell, after "(an expired access token spends none)": "the same budget bounds, per API instance, how many credentialed requests of an IP may be in authentication at once (120 less its counted failures; 429 with `Retry-After: 1` beyond)".
6. **REQ-SEC-005 note, after "requests without a credential are not affected."**
   > The budget also bounds what is in authentication at one moment. On each API instance the credentialed requests of an IP that were admitted and are not yet authenticated, together with its counted failures, stay below the budget; a further credentialed request is answered 429 with `Retry-After: 1`, whether its own credential is valid or not (ADR-0016 amendment 13 item 6, D-ARCH-228). This part is kept per instance in memory, not in Redis, so for one parallel burst of refused credentials the budget holds per instance (R-ARCH-36 (d)).
   The shall-statement stays true as it is: the counters are in Redis.

### 10.6 Considered and not adopted

- **Counting only the requests whose credential fails later.** Step 0 cannot know it before the outcome. A hold that starts with the first failure of an address lets the first burst of every window through, which is R1-M1 again.
- **A separate, higher limit for held units.** The bound on one instance becomes `limit` plus that number. The case moves to the higher number and does not go away. One browser already stays below 120.
- **A pass for a recently verified credential.** It removes the squeeze and the lock by held bodies for users already verified. It does not help a first use, and a fan-out after a token refresh is a first use. It keeps credential digests in memory. On file.
- **One unit per credential, with the later requests waiting for the first outcome.** It is the design that removes a burst under one token and keeps the bound. It adds a digest per request, waiting requests with release paths of their own, and a review like the one this hold needed. No client of this run sends such a burst. On file, and named for trigger (vii).
- **A queue that makes a request wait for a unit instead of refusing it.** The waiting request needs a fresh failed count when its turn comes, or a forged burst passes one after another. That is a second read of the store or a local copy of the count with its window.
- **A hold for the refresh cookie only.** Parallel forged bearers would then reach verification at the ceiling rate. That is the hold side of the narrower design that security-analyst did not take in D-SECPR041-02.
- **A cap on parallel requests in the web and admin API client.** A browser already caps them. A bulk action above 20 at once is trigger (vii).
- **Release at `finish`, with or without the check that the slot has ended** (builds F and G of 10.3). F frees a unit while its authentication runs. G does so for a slot that reports from a callback, and it needs a listener on the response for a gain that C-4 has without one.
- **Spending a unit when a slot answers 4xx itself.** The wrapper cannot see the error code, so it could not exempt an expired token (condition E4), and normal expiry behind a large NAT would spend the budget.
- **The ledger accessors in fix cycle 3.** They change the ledger for a consumer in Wave 7. TASK-214 adds them under the lock.

### 10.7 Routed

- **senior-developer:** fix cycle 3 with C-4 and H7 to H10; card lines 20 to 26 at the next fold, where lines 23 and 24 replace parts of lines 18 and 19 as folded by D-SD-012.
- **code-reviewer** and **security-analyst:** the delta rounds of 10.4. For security-analyst also: remedy (b) is declined as proposed, with the timer case of 10.3 as the reason; the re-rating of PR041-SEC-11 (QG-041B-C4) now has rows 5 and 6 of 10.2; a rating above LOW is trigger (vi).
- **product-manager:** 10.5 (QG-041B-C3).
- **api-designer:** api/README §7 rides a pull request of TASK-041, not main. Two sentences. After the sentence that C-3 added: "This is a bound on how many requests are in authentication at one moment, so it can refuse valid credentials that arrive together even when no credential was refused." In the Headers paragraph: "A client cannot tell which stage answered `RATE_LIMITED`. It repeats the same request after `Retry-After`, with the same `Idempotency-Key` where the operation takes one."
- **quality-gatekeeper:** the restated item 6 is new Accepted text (CLAUDE.md §5). Nothing Accepted is contradicted: one sentence of item 6 is withdrawn by name, and item 6 was verified with the condition that it be restated. One closing entry covers QG-041B-C1 and QG-041B-C2. QG-041B-C1 holds the merge of part 041-B; QG-041B-C2 and C-4 hold the dispatch of TASK-052.
- **qa-lead:** in Compose and in the end-to-end runs every worker shares one client address. The failed-authentication budget and the room are therefore shared by the whole run: a suite that sends refused credentials on purpose spends the budget of every worker for that minute. This has been so since D-ARCH-175; the hold adds that more than 120 credentialed requests in parallel from the runner are refused.
- **performance-engineer:** card line 25 (QG-041B-C6).
