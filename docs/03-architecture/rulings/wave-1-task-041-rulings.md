# Wave-1 TASK-041 — rulings on the rate limiter (2026-11-20)

Owner principal-architect. Decisions D-ARCH-173 to D-ARCH-179. ADR-0016 amendment 12, ADR-0010 amendment 13.

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
- **What spends a unit.** The authentication slot refuses a request that presents a credential of a kind the route declares (`Authorization` for `session`, a refresh cookie, `X-Quote-Token`, one of the three signature headers for `signature`). One exception: 401 `ACCESS_TOKEN_EXPIRED` spends nothing. A credential the route does not declare is never read (D-ARCH-109) and never spends.
- **Who records it.** A wrapper around the authentication slot, composed in `createApp` around the default slot and around the `authenticate` test seam. No authenticator calls the limiter. The spend never changes the answer of the request that failed. A store failure uses the per-instance fallback.
- **Where it is read.** Step 0, on the credentialed rule only. The store call that counts the credentialed hit also returns the IP's failed count: one script over two keys, no second round trip. The in-memory store answers the same question.
- **Answer when the budget is spent** (failed count at or above the limit): 429 `RATE_LIMITED` before routing, `Retry-After` = the rest of the failed window, `RateLimit-Limit` = the limit, `RateLimit-Remaining: 0`, `RateLimit-Reset`. Counter label `step0-authn-failed`. Requests that take the anonymous rule are not affected.
- **Event.** `rate_limit_auth` with `class: 'authn-failed'`, `key_type: 'ip'`, once per key and window, emitted by the spend that reaches the limit.
- **Tests.** (1) 120 requests with a junk bearer to a `[session]` fixture route answer 401; the 121st answers 429 and the authentication slot is not entered (spy). (2) A credentialed request from a second IP is not affected. (3) A request without credentials from the first IP is still served. (4) A seam authenticator that answers `ACCESS_TOKEN_EXPIRED` 200 times causes no 429. (5) A junk bearer on an `[anonymous]` route spends nothing. (6) Two replicas share the budget. (7) With the store failing, the budget holds per instance. (8) The `startApi` composition has the wrapper (the production half, like the limiter itself).

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

> A request with a provider signature header counts as presenting a credential. Step 0 also keeps a **failed-authentication budget** per IP: each request whose presented credential the authentication slot refuses (an expired access token excepted) spends one unit of 120 a minute, and while the budget is spent every request from that IP that presents a credential is answered 429 before authentication, with `Retry-After`. Requests without credentials are not affected. The event is `rate_limit_auth` with class `authn-failed`.

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
- **Counting a failed credential against the anonymous key itself (the code review's wording of option (b)).** Rejected: anonymous visitors of a NAT would then lock out its signed-in users, and the reverse.
- **A second store call at step 0 to read the failed count (the security record's `peek` sketch).** Replaced by one script over two keys, so the hot path keeps one round trip.
- **A configuration key for the ceiling factor.** Not now. The factor is one named constant and the counter label `step0-credentialed` shows when a tenant's NAT reaches it.
- **Falling back for every class.** It is the simpler rule and I think it is the better one, but REQ-SEC-006 says the other routes fail open, and only the classes that drive carrier calls and unauthenticated writes need it today.
- **A per-instance fallback for the carrier admission controls.** Rejected for refusal: K replicas would multiply the anonymous bucket by K while the shared view is missing, and what that risks is slow to recover (a daily quota lasts until 00:00 UTC; carrier throttling is keyed by the shared egress IP).
