# Code review: TASK-041 Valkey rate limiting and the T-39 denial budget (pre-push, round 1)

| Field | Value |
|---|---|
| Task | TASK-041 (US-040 Must; US-087 partial; T-39, PR56-SEC-03, PR21-SEC-01 step 5, PR48-SEC-06, PR61-SEC-12, AT-US-087-04) |
| Head | `e6f484a` (`0d87b1a` implementation, `56cf335` merge of main `29fe2a1`, `e6f484a` loopback transport and README §13 row); not pushed, no PR number yet |
| Base | `origin/main` `f8e9086` at dispatch; main is now `2ec81df` (docs only, no overlap with the branch, see §1) |
| Reviewer | code-reviewer, 2026-11-20 |
| Bindings read | CLAUDE.md; TASK-041 card (WAVE-01); US-040 AT-US-040-01..17; ADR-0016 §8 and amendment 1; api/README §7 and §13; D-SECT39-01; PR61-SEC-12; developer decisions D-TASK041-01..09 as listed in the dispatch |

```
VERDICT: APPROVED_WITH_NITS (merge conditions C1-C6 below)
SUMMARY: The engine, the class table, the trusted proxy chain, the IPv4-mapped unmapping and the T-39 denial budget
         follow US-040 and D-SECT39-01 item by item. The atomic Lua steps, the closed details set, the carry claim and
         restore, the 429 headers and the startApi composition are all tested. No BLOCKER or MAJOR. Eight MINOR
         findings: a step-0 ceiling that any request can raise by sending a header, a missing email-send security event,
         unpinned outage wiring and fields, no breaker on a slow store, O(n) eviction in the fallback stores, the matrix
         seam not listed, ATs credited on helpers only, and a superseded ADR-0016 §8 library choice.
```

## 1. What I verified myself

| Check | How | Result |
|---|---|---|
| Merge `56cf335` is a pure union | `git merge-tree --write-tree 0d87b1a 29fe2a1` = `d1269db`; `git diff --stat d1269db 56cf335` is empty | Pure. The branch delta against `29fe2a1` is 28 files (2,728+/43-), all TASK-041 |
| Main drift since `29fe2a1` | `git diff --name-only 29fe2a1 origin/main` (8 docs files: ADR-0004/0005/0013, data-model, risks, a rulings file, the TASK-075 security record, DECISIONS) `comm -12` with the branch files | No overlap. ADR-0005 amendment 14 (D-ARCH-162..167) does not touch the denial budget or authorise |
| Format | `prettier --check` on the 28 changed files (read-only in the worktree) | Clean |
| Lint | `eslint --max-warnings 0` on the 25 changed `.ts` files (single process, read-only) | Clean |
| Types | `tsc -p` scratch config, `noEmit`, over the changed `apps/*` and `packages/*` `.ts` files plus everything they import, with the worktree's `tsconfig.base.json` (strict, `exactOptionalPropertyTypes`, `@platform/source`) | Clean |
| Probe (tsx on a `git archive` extract) | `clientIpKey` spellings; memory store at capacity; step-0 rules; `windowEndsAt`; `denialKeys` hostile segments; memory carry; limiter fallback then recovery; budget under a malformed reply | `::ffff:1.2.3.4` and `::ffff:0102:0304` give `1.2.3.4`; IPv6 is keyed by its `/64` `networkForm`; garbage gives `unknown`; `windowEndsAt` gives `2027-01-15T08:01:00Z`; a malformed reply falls back and reports `authz-denial`. **A new key in a full memory store costs about 0.9 ms (m5).** The step-0 credentialed ceiling is 6,000/min (m1) |
| express-rate-limit `ipKeyGenerator` 8.7.3 (`dist/index.mjs`) | Read the source | Unmaps `isMapped4()` and the IPv4-compatible notation before `/64`, so a dual-stack listener's `::ffff:a.b.c.d` never collapses every IPv4 client into `::/64` |
| Valkey ACL (`infra/local/valkey/users.acl`) | `user api ... ~rl:* +@all -@dangerous` | `EVAL`, `GETDEL`, `TIME`, `PEXPIRE` and both key prefixes are allowed. The client has no `keyPrefix`, `commandTimeout` is 2 s and `maxRetriesPerRequest` is 1 |
| Card, US-040 and D-SECT39-01 trace | Read each item against the code and tests (§4) | See §4 |

**Not re-run (host rule: lane B uses this machine):** no `npm`, Jest, Docker or full gates. For `rate-limit.int.test.ts` (first run in lane B) and every other Jest suite I rely on the coming lane-B run. The `.env.example` parity test is known to be red (C5).

## 2. Findings

| ID | Severity | file:line | Issue | Required fix |
|---|---|---|---|---|
| R1-m1 | MINOR | `apps/api/src/platform/rate-limit/limits.ts:80-81`, `policy.ts:276-283`, header comment `limits.ts:7-9` | **Any client can raise the step-0 ceiling by sending a header.** `presentsCredential` reports presence, not validity, so any non-blank `Authorization` or `X-Quote-Token` header moves a request from the 120/min anonymous rule to the 6,000/min credentialed rule (probe: `stepZeroRule(..., true)` limit 6000). D-ARCH-109 makes anonymous routes ignore the foreign credential, so the step-5 class limits still bound pipeline routes. The paths with no step-5 slot are protected only by step 0: `/api/docs/*` (PR21-SEC-01 step 5), the 404 fallback and the OPTIONS preflights. For them the "unauthenticated 120/min/IP" of DR-A22 becomes 6,000/min. The same header lets a forged-bearer flood reach JWT verification at 100/s per IP, and it lets an IP drive about 5,990 `rate_limit_auth` WARN lines a minute through a refused `auth` route. The comments "so a flood of forged credentials cannot bypass it" and "never reaches bcrypt or JWT verification" overclaim. This is D-TASK041-03, still open for the architect. | Choose one and record it (architect ruling, C1): (a) paths outside the module mount (docs, fallback, OPTIONS) always use the anonymous rule; (b) the authn slot's 401 for a presented but invalid credential also takes a unit of the anonymous step-0 key, so forged credentials cost the anonymous budget; or (c) accept and document the residual. In every case, reword the two comments. |
| R1-m2 | MINOR | `limits.ts:116` | **`rate_limit_auth` is emitted for the `auth` class only.** README §13 defines it as "`auth` or `email-send` class limit hit", with fields class and key type. The step-5 `email-send:ip` rule is live, and its refusals emit nothing. | `if (SECURITY_RATE_LIMIT_CLASSES.includes(klass)) kit.events.emit('rate_limit_auth', { class: klass, key_type: 'ip' })`, plus a test row for `email-send` |
| R1-m3 | MINOR | `app.ts:159-161`; `packages/shared/src/logging/security-event.test.ts:131-134`; `limits.api.test.ts:271` | **Outage-event wiring and its fields are not pinned.** (a) No test composes `createApp` with an audit config and a failing Valkey. Deleting `onStoreUnavailable: denialOutageReporter(events)`, `denialCounter: kit?.counter` or `denialLog` from `app.ts` would fail nothing: the capture suite passes its own budget, and the startApi suite never fails the store. The card's test "a store failure uses the fallback and logs the event" is proven only on the bare budget. (b) The new event is filtered out of the `sql_state` loop, but its allow-list `['store', 'scope']` is never asserted. The test comment says "Pinned here as well, so a README edit alone cannot widen an allow-list". (c) AT-US-040-09 checks the event name only. The logger collects warn and error into one array, so ERROR is not asserted. | Add `expect(SECURITY_EVENT_FIELDS.rate_limit_store_unavailable).toEqual(['store', 'scope'])`. Add one api test: startApi or `createApp` with `rateLimit` + `auditConfig` and `valkey.failure` set. It asserts the 403/429 sequence, ONE `security.rate_limit_store_unavailable` at level error with `{store:'valkey', scope:'authz-denial'}` and no host text, and the counter label. Split the harness logger by level. |
| R1-m4 | MINOR | `limiter.ts:86-93`, `denial-budget.ts:220-229` | **No breaker when Valkey is slow.** If Valkey hangs (as opposed to refusing connections), every request waits for the 250 ms store timeout at step 0 and again at step 5, and a denial waits a third time. Each request gains up to 500-750 ms for as long as the brownout lasts. CLAUDE.md §9 asks for circuit breaking where it matters, and O2 (first quote result ≤ 1.5 s) is a run outcome. | After a store failure, use the fallback or fail open directly for a short cool-down (for example 5 s, one half-open probe), shared by the limiter and the budget. Test it with a hanging fake: the second call does not wait. |
| R1-m5 | MINOR | `store.ts:115-131`, `denial-budget.ts:146-159` | **Eviction in the fallback stores is O(n) per new key.** When `windows.size >= 50_000`, every new key runs `prune()`, which scans all entries and then removes one, so the next new key scans again. Measured: about 0.9 ms per new key at capacity. The fallback serves the security classes during an outage, and a client with a /48 has 65,536 distinct /64 keys, so the event loop is the cost. Also, the memory `slots` map and the denial `carries` map have no bound. | Remove expired entries on a timer or once per N inserts. At the cap, evict a batch from the head of the insertion-ordered `Map` (for example 10 %) without a full scan. Bound `slots` and `carries` the same way. Add a test that fills the store past the cap and asserts the size bound, which the test titled "the in-memory store is bounded" (`rate-limit.test.ts:393`) does not check. |
| R1-m6 | MINOR | `tests/generated/rbac/matrix-app.ts:1-31, 66-72, 138` | **The matrix seam is not listed.** The card's RBAC MATRIX SEAM line (PR48-SEC-06, D-ARCH-134) asks that the seam be listed in the matrix app's still-stubbed list. The seam is the absence of `rateLimit`, so the matrix app's `ipLimiter` passes through. The production half is pinned (`start-api.denial-budget.api.test.ts:198-204`); the listing half is missing. | In `matrix-app.ts`, name the omitted `rateLimit` dependency as a seam in the header comment and next to `STUBBED_CREDENTIAL_KINDS`, with its retirement owner, or have qa-lead (owner of `tests/generated`) do it in a companion commit. The orchestrator records which. |
| R1-m7 | MINOR | `rate-limit.test.ts:96, 140, 206`; card "Stories (completes) US-040" | **ATs credited on helper-level tests.** AT-US-040-04 (quote-create), -13 (registration in two classes) and -15/-16 (stream slots) are tagged on unit tests of the rule helpers (`quoteCreateRules`, `emailSendRules`, `limiter.acquire`). The route behaviour these ATs specify does not exist yet: no route consumes the helpers. AT-US-040-14 is not covered (known). `quality:trace` reads IDs from titles, so G3 would count these Must ACs as covered. The card says TASK-041 completes US-040. | Retitle the helper tests (keep the IDs in a describe that says "rule helper; route behaviour owned by TASK-xxx"), or keep the IDs and have product-manager or the orchestrator record US-040 as partial (C3). Name the owners: TASK-049 for -13/-14 and the per-account rule, the createQuote task for -04, the stream tasks for -15/-16, TASK-176 for the failed-tracking 10/min. Each owner re-carries its ID at route level. |
| R1-m8 | MINOR | `apps/api/src/platform/rate-limit/*` vs ADR-0016 §8 and amendment 1, api/README §7 | **The implementation contradicts accepted ADR text.** ADR-0016 §8 and README §7 name `express-rate-limit` 8 + `rate-limit-redis` 6. The thin custom engine (D-TASK041-01) contradicts that. Amendment 1 says the pre-authentication limiter applies "class `public`/`auth` as declared per route"; the step-0 rule is route-agnostic, and `auth:ip` runs at step 5 (D-TASK041-03, -05). On the merits I accept the engine: it is a smaller surface, it gives the atomic TTL-anchored Lua that D-SECT39-01 requires, and it emits exactly the three draft-06 headers. CLAUDE.md §5 still requires a principal-architect amendment that quality-gatekeeper verifies. | Architect amendment to ADR-0016 §8 / amendment 1 and README §7 (C1). Then remove the unused `rate-limit-redis` from `apps/api/package.json:55` in this task or a named follow-up (`express-rate-limit` stays for `ipKeyGenerator`). |
| R1-n1 | NIT | `packages/shared/src/logging/security-event.ts:50-51` | "Not in the README §13 catalogue yet" is stale: `e6f484a` added the row. | Reword: "README §13 runtime table (api-designer to acknowledge)". |
| R1-n2 | NIT | `store.ts:5-6`, `policy.ts:134-136` | "coarse network prefixes only" overclaims. An IPv4 client is keyed by its full address (`rl:public:ip:203.0.113.7`) for up to an hour. That is personal data in Valkey, ephemeral and needed, but not "coarse". | Reword ("the IPv4 address or the IPv6 /64, TTL at most one window"); see SECURITY-FLAGS S3. |
| R1-n3 | NIT | `limits.ts:82-84, 111-119` | `.then(answer, next)`: an exception thrown inside `answer` (for example `setHeader` after headers were sent) is not caught by the `next` rejection handler of the same `then`. It becomes an unhandled rejection, which Node's default mode turns into a process crash. Nothing sends a response before step 0 today. `authorise.ts` already uses the safe `.catch(next)` form. | `.then((decision) => answer(...)).catch(next)` in both places. |
| R1-n4 | NIT | `limits.ts:56` | Step 5 overwrites the step-0 `RateLimit-*` headers even when step 0 is closer to exhaustion. A client can read `Remaining 100` and get a step-0 429 on its next request. README §7's "closest to exhaustion" is honoured within one class only. | Keep the closer reading across stages (store it on `res.locals` at step 0 and compare it at step 5), or document the choice. |
| R1-n5 | NIT | `rate-limit.int.test.ts:70-79, 122-133` | The concurrent (50 hits, 30 denials) and first-EVAL cases run with the production 250 ms store timeout. Under lane-B load, one slow reply sends a call to the fallback (budget) or rejects it (store), and a timeout would then look like a Lua defect. This suite proves the Lua semantics, not the timeout. | Pass `timeoutMs: 5_000` to `createValkeyStore` / `createDenialBudget` in this suite. |
| R1-n6 | NIT | `rate-limit.test.ts:79-96` | The outline row AT-US-040-03-5 (quote-create per user, 31) has no row tag; it is covered inside the -04 test. | Add `[AT-US-040-03-5]` to that title. |
| R1-n7 | NIT | `limits.ts:84`, `counter.ts` | Step-0 credentialed refusals are counted under the label `authenticated`, which is the step-5 class name, so the two refusal sources cannot be told apart. The counter is not exposed to any exporter yet. | Use a `step0-credentialed` label. Name TASK-214 as the export owner in the counter's doc comment. |
| R1-n8 | NIT | `apps/api/src/platform/audit/capture.api.test.ts` | The file is on the loopback ratchet allow-list (global `fetch`). The new T-39 block uses `serve.ts`, the rest does not. | Convert the file and remove its allow-list entry if C4 grants this task the `api-audit-mw` lock, else leave it to that lock's next holder. |

## 3. Rulings on the developer decisions (code-review view; the architect and security rulings stand above these)

| Decision | Ruling |
|---|---|
| D-TASK041-01 custom engine instead of express-rate-limit + rate-limit-redis | Sound on the merits. It needs the ADR-0016 §8 / README §7 amendment (R1-m8, C1). |
| D-TASK041-02 250 ms store timeout; security classes fall back to memory, the rest fail open | Matches README §7, ADR-0016 item 8 and D-SECT39-01 item 5. Add the breaker (R1-m4). |
| D-TASK041-03 step-0 policy with a 10× authenticated per-IP ceiling | Accepted for NAT fairness (AT-US-040-11). The header-presence bypass needs a ruling (R1-m1). |
| D-TASK041-04 registration, per-account, per-address, quote-create and failed-tracking deferred to route tasks with helpers | Accepted as engineering. The traceability consequence is R1-m7 / C3. |
| D-TASK041-05 auth per-IP at step 5 | Accepted. Login routes are anonymous, so authn does no verification work before step 5, and step 5 still runs before the handler's bcrypt (AT-US-040-06 green). It is part of the C1 amendment because amendment 1 says "before authentication". |
| D-TASK041-06 429 headers set before the problem handler | Correct; the tests prove the headers survive the problem handler. |
| D-TASK041-07 budget composed when the capture is built | Exactly D-SECT39-01 item 6, and the startApi composition is tested. |
| D-TASK041-08 `window_ends_at` format | RFC 3339 UTC rounded up to the second with no fraction, per item 2. |
| D-TASK041-09 README §13 row on orchestrator authority | Acceptable. The api-designer acknowledgement is C2. |

## 4. Requirement trace

- **US-040.** Covered end to end through `createApp`: -01, -02, -03 (rows 1, 3, 4; row 2 as a helper unit), -05, -06, -07, -08, -09, -10 (auth class only, R1-m2), -11, -12 (unit), -17. Helper level only: -04, -13, -15, -16 (R1-m7). Not covered: -14 (known; TASK-049).
- **T-39 / D-SECT39-01.**
  - Item 1: no new action; the aggregated entry is the crossing request's own entry.
  - Item 2: closed `DenialMark`, mapped by `capture.denied`. The stored-details deep-equal covers plain, crossing and opener entries.
  - Item 3: key grammar (`segment` refuses `:` and pattern characters, empty becomes `system`); TTL-anchored window; one script per denial; PTTL test; GETDEL claim.
  - Item 4: no IP, user agent or route in the budget keys (asserted). Vault and `ip_hash` rows are written for N+1 entries only (asserted).
  - Item 5: 429 headers (asserted); failed writes answer 5xx; carry restore (asserted); per-instance fallback (asserted); event (R1-m3).
  - Item 6: composition (asserted).
  - SEC-TC-15 N+2 sequence plus next-window carry: asserted through the real capture and through startApi.
- **PR21-SEC-01 step 5.** Docs path limited by step 0 (asserted); see R1-m1 for the header bypass.
- **AT-US-087-04 / EC-A12.** `trust proxy` = `TRUST_PROXY_HOPS`; a forged leading XFF is ignored (asserted); hops 0 reads the socket.
- **PR61-SEC-12.** Unmapping on the parsed groups, one row per spelling plus negative rows; the limiter key unmaps through `ipKeyGenerator` (probe).
- **PR48-SEC-06.** Production half pinned; listing half R1-m6.

## 5. Merge conditions

- **C1 (principal-architect).** Amend ADR-0016 §8 and amendment 1 and README §7 for D-TASK041-01, -03 and -05, and rule on R1-m1 (option a, b or c). Quality-gatekeeper verifies the amendment, per CLAUDE.md §5.
- **C2 (api-designer).** Acknowledge the README §13 `rate_limit_store_unavailable` runtime row (D-TASK041-09).
- **C3 (orchestrator / product-manager).** Record D-TASK041-01..09 in DECISIONS.md: none is in the repository today. Mark US-040 partial in task-map/traceability, with the owners of -04, -13, -14, -15/-16 and the per-account and failed-tracking rules (R1-m7).
- **C4 (orchestrator).** The branch edits `audit/capture.ts` + its test (`api-audit-mw`) and `app.ts` / `start-api.ts` (`api-platform-core`). The card's locks still lack both (D-SECT39-01 card line 2). Confirm that no parallel holder exists, and fold the lock line.
- **C5 (user).** Add the 18 placeholder lines to `.env.example` so the parity test is green. Agents are denied that file.
- **C6 (lane B and security).** A lane-B PASS on the pushed head. `rate-limit.int.test.ts` runs for the first time there. The security-analyst record on the head.

The MINOR findings may be fixed in this task (preferred for m2, m3 and m6, which are a few lines each) or routed with named owners in the merge record. The NITs are optional.

## GOOD

- One atomic Lua step per denial, with the window anchored by the key's own TTL, and a TTL repair branch so no key is ever left without one. D-SECT39-01 item 3 is implemented to the letter and tested on the fake and on real Valkey.
- `DenialMark` is a closed typed mark that `capture.denied` maps to the details set itself, and it range-checks the carry a second time. The slot cannot inject free-form details.
- The carry restore runs on the failed-opener path only. The unit stays spent and the aggregated failure carries nothing, exactly as item 5 says.
- Store errors are class-only (`RateLimitStoreError(reason)`), the cause is never logged, and a test asserts that the host text is absent.
- `RATE_LIMIT_DEFAULTS` is one table feeding the schema bounds, the policy and the tests, with `satisfies` tying each name to a schema key.
- The startApi composition test drives the real `startApi` with a single seam (authenticate), so "production passes the real limiter" is a fact, not a comment.
- IPv4-mapped unmapping decided on parsed groups, with negative rows (`::fffe:`, `::1:ffff:`, `64:ff9b::`) that pin the boundary.

## SECURITY-FLAGS (for security-analyst)

- **S1 (R1-m1).** The step-0 credentialed ceiling is selected by header presence: any client gets 6,000/min per IP on non-pipeline paths (docs, fallback, OPTIONS) and amplifies `rate_limit_auth` logging. CWE-770 / OWASP API4.
- **S2.** `TRUST_PROXY_HOPS` defaults to 1 (config). Where the API port is reachable without passing the edge (`compose.debug.yaml` publishes `127.0.0.1:3000`, so local only; `npm run dev:api`; a misconfigured target group), a client-supplied `X-Forwarded-For` becomes `req.ip`. That rotates every per-IP limit key and the audit IP. This is pre-existing config, but TASK-041 makes it load-bearing. Confirm the deployment topology, or default to 0 outside Compose.
- **S3 (R1-n2).** Full IPv4 addresses are held in Valkey rate-limit keys for up to an hour (personal data under GDPR / DPDP; ephemeral). Confirm that this is acceptable, or key the IP rules by a keyed hash.
- **S4 (R1-m4).** No breaker: a Valkey brownout adds up to 750 ms per request (availability).

---

# Round 2: part 041-A at `3a6b4c8b` (2026-11-20)

| Field | Value |
|---|---|
| Head | `3a6b4c8b` on `feat/TASK-041-valkey-backed-rate-limiting-per` (`ba4d0aaa` merge of main `6ab40f28` + fix commit `3a6b4c8b`); read from the main checkout's object store; the evidence worktree stays at `e6f484a` and was not touched |
| Scope | Part 041-A only: the change list A1-A8 of `rulings/wave-1-task-041-rulings.md` (D-ARCH-173..179, ADR-0016 am. 12), my round-1 m1/m2/m3/m5/m6/m8 and NITs, and QG-041-C1 of D-QG-001, which I check here. Part 041-B (B1-B5, including R1-m4) is not in this PR |
| Also read | D-QG-001, D-API-003, D-ARCH-181, D-ORCH-140 |

```
VERDICT: APPROVED_WITH_NITS (part 041-A; merge conditions R2-C1..R2-C5 below)
SUMMARY: A1-A8 are implemented as ruled, and each has the tests the rulings name. QG-041-C1 is MET at this head: the
         README §7 text matches rulings §5.1 verbatim, rate-limit-redis is gone from package.json and the parsed
         lockfile, and TRUST_PROXY_HOPS defaults to 0 with the staging/production guard and tests. Round-1 m1, m2, m3,
         m5, m6 and m8 are closed; m4 is routed to 041-B by D-ARCH-177; m7 is still open with product-manager and the
         orchestrator. No new BLOCKER, MAJOR or MINOR; two NITs.
```

## R2.1 What I verified myself

| Check | How | Result |
|---|---|---|
| Merge `ba4d0aaa` is pure | `git merge-tree --write-tree e6f484a 6ab40f28`, then `git diff --stat <tree> ba4d0aaa` | Empty diff: a pure union. The fix commit `3a6b4c8b` touches 29 files (+473/-86) |
| Main drift since the merge (main is now `06263078`) | `comm -12` of `6ab40f28..HEAD` against the branch's own files (`6ab40f28..3a6b4c8b`) | No overlap. The newer main commits are docs only (D-ARCH-181, D-ORCH-140, review records) |
| Lockfile (A5) | Parsed `packages` maps of `ba4d0aaa` and `3a6b4c8b` | Removed: `node_modules/rate-limit-redis` only. Changed: the `apps/api` entry only (the dependency dropped). Nothing added. `git grep rate-limit-redis` outside docs and the lockfile: no hit |
| README §7 (A7, QG-041-C1) | Each `>` paragraph of rulings §5.1 checked with `grep -F` against `git show 3a6b4c8b:docs/03-architecture/api/README.md` | All five replacement texts (two paragraphs, Headers, Store outage, IP) are present verbatim; the old library sentence and the old outage and IP paragraphs are gone |
| Format | `prettier --check` on the changed `.ts`/`.md`/`.json` files, in a `git archive` copy of `3a6b4c8b` | Clean |
| Lint | `eslint --max-warnings 0` on the 25 changed `.ts` files in the copy, with the copy's own `@platform/*` packages linked in place of the worktree's | Clean |
| Types | Strict `tsc --noEmit` scratch project over every `.ts` file the branch changes since `29fe2a1` (1,376 files checked, 47 of them from the copy's `packages/config/src`) | Clean |
| Probe: fallback cost (R1-m5) | tsx on the copy: fill each store to 50,000 entries, then time 20,000 new keys | Window store 0.015 ms and denial store 0.015 ms per new key at the cap (round 1: about 0.9 ms). The most recent key is still counted |
| Not run (host rule) | Jest, npm, Docker | I rely on lane B for every suite, including the first run of `rate-limit.int.test.ts` with its new 5 s bound |

The copy, all its junctions and the probe were removed afterwards; the worktree `../Shipqube-TASK-041` still shows a clean `git status`.

## R2.2 Change list A1-A8 against the code

| Item | Code | Tests | Status |
|---|---|---|---|
| A1: credentialed rule only for non-OPTIONS requests under `/api/v1` | `limits.ts` `underPrefix` (exact, case-sensitive) plus the `req.method !== 'OPTIONS'` check; `createApp` passes `API_PREFIX` | A3 rows below | Met |
| A2: reworded texts | `limits.ts` header, `policy.ts` ceiling comment and keys comment, `store.ts` header; the test title as dictated | n/a | Met, verbatim |
| A3: tests and counter label | Counter label `step0-credentialed` | `limits.api.test.ts`: `/api/docs/`, `OPTIONS /api/v1/...` and `/nope` with a junk bearer refused at the 4th request, counted as `unauthenticated`; extra rows `/api/v10` and `/API/v1`; `/api/v1/mine` stays under the ceiling; the ceiling test asserts `{ 'step0-credentialed': 1 }` | Met (two rows beyond what was asked) |
| A4: `rate_limit_auth` once per key and window | `RateDecision.first` = `count === limit + 1`, taken from the store's count with nothing new stored; emitted for `SECURITY_RATE_LIMIT_CLASSES` | 13 logins give three 429s, one event and a counter of 3; the next window emits again (2 events, counter 4); an `email-send` row | Met |
| A5: remove `rate-limit-redis` | `apps/api/package.json` and the lockfile (parsed, §R2.1) | n/a | Met |
| A6: `TRUST_PROXY_HOPS` default 0 plus guard | `schema.ts` (default 0 and the dictated description); `trustProxyGuard` (`api` service, `isHardenedAppEnv`: `missing` when unset, `forbidden-in-environment` / `trustProxy.hops` for 0); registered in `GUARDS` (count pinned to 16); hardened test env sets 2; `compose.env` keeps 1 | `trust-proxy.test.ts`: default 0, the two guard rows for staging and production, 1/2/5 accepted, local and test accept unset and 0, the worker is exempt, 6 is invalid | Met. The `.env.example` line is the user's (R2-C1) |
| A7: README §7 | Verbatim (§R2.1) | n/a | Met |
| A8: O(1) eviction (PR041-SEC-01, R1-m5) | `bounded-map.ts`: sweeps at most 8 entries from the head per new key, evicts the oldest at the bound, updates in place; used for windows, slots and the denial windows and carries | Per-insert inspection ≤ `SWEEP_PER_INSERT` over 20,000 keys; the size bound; window, slot and denial stores past a cap of 50 or 100 | Met; probe confirms |
| A8: live refusal without `rateLimit` (PR041-SEC-08) | `RateLimitMissingError` in `assertBootable` | `pipeline-audit-privacy.test.ts` (live throws; test mode and no mode do not); live fixtures in two other suites now pass `rateLimit` | Met |
| A8: matrix seam listed (R1-m6) | `matrix-app.ts` header names the absence of `rateLimit` as the fourth seam, with its guard and retirement | n/a | Met |
| A8: outage wiring and field allow-list pinned (R1-m3) | `security-event.test.ts` pins `['store','scope']` and level `error` | startApi with Valkey failing: the 403/429 shape holds, the audit append count is N+1, and exactly one line each for scopes `authz-denial` and `rate-limit`, at level error, with `store: 'valkey'`, no host text and no dropped attributes. Deleting the budget's reporter wiring in `app.ts` now fails this test | Met |

## R2.3 Round-1 findings

| ID | Status at `3a6b4c8b` |
|---|---|
| R1-m1 step-0 ceiling chosen by header presence | **Closed** for 041-A by A1/A3 (option (a)). Option (b), the failed-authentication budget, is part 041-B (B1), due before TASK-052 is dispatched (D-ARCH-175) |
| R1-m2 missing `email-send` event | **Closed** (A4, with the once-per-window rule) |
| R1-m3 outage wiring unpinned | **Closed** (A8 row above) |
| R1-m4 no breaker | **Routed** to 041-B (B3; D-ARCH-177: required, not merge-blocking for 041-A) |
| R1-m5 O(n) eviction | **Closed** (A8; probe 0.9 ms → 0.015 ms) |
| R1-m6 matrix seam not listed | **Closed** |
| R1-m7 ATs credited on helper tests; card says "completes US-040" | **Open.** The card on main still reads "Stories (completes) US-040", and AT-US-040-04/-13/-15/-16 are still tagged on helper-level tests. Owner: orchestrator / product-manager (R2-C3) |
| R1-m8 ADR-0016 §8 contradiction | **Closed**: ADR-0016 am. 12 (D-ARCH-173), verified by D-QG-001; brief §3.2 / CLAUDE.md §2 standing recorded by D-ARCH-181, with the user's acceptance in D-ORCH-140; `rate-limit-redis` removed |
| R1-n1 stale comment | Closed (reworded; see R2-n1 for its new wording) |
| R1-n2 "coarse prefixes" overclaim | Closed (A2) |
| R1-n3 `.then(answer, next)` | Closed: `.then(...).catch(next)` in both slots |
| R1-n4 header overwrite across stages | Closed by documentation (README §7 and the `limits.ts` header, as ruled in A8) |
| R1-n5 int-test bound | Closed: `LOAD_TIMEOUT_MS = 5_000` in every store and budget of the suite |
| R1-n6 `AT-US-040-03-5` tag | Open (NIT; trace pooling does not need it) |
| R1-n7 step-0 counter label, export owner | Closed (`step0-credentialed`; TASK-214 named in `counter.ts` and `kit.ts`) |
| R1-n8 capture test still on global `fetch` | Open, optional (the task now holds `api-audit-mw`; the ratchet allows leaving it) |

## R2.4 New findings

| ID | Severity | file:line | Issue | Fix |
|---|---|---|---|---|
| R2-n1 | NIT | `docs/03-architecture/api/README.md` §13 (`rate_limit_auth` row, l. 479; `rate_limit_store_unavailable` row); `packages/shared/src/logging/security-event.ts:51` | D-API-003 gave wording for this head, and none of it has landed. (i) The runtime row should say "*acknowledged D-API-003*". (ii) "ADR-0016 item 8" should become "ADR-0016 amendment 12 item 8", with the fallback-set wording. (iii) The `rate_limit_auth` Emitted-when cell should add "logged once per key and window, at the first refusal (a counter counts every refusal; §7)". As it stands, the row describes per-refusal emission, which A4 changed. The code comment still says "api-designer to acknowledge". | Apply the three cell edits and the comment in this PR, or leave them to api-designer's next README fold, which D-API-003 allows for (i) and (ii). |
| R2-n2 | NIT | `apps/api/src/platform/rate-limit/limits.ts` `ipLimiter(kit, apiPrefix = '/api/v1')` | The default duplicates `API_PREFIX`. A test composition that calls `ipLimiter(kit)` directly would silently keep a stale prefix if the version prefix ever changed. | Drop the default and make the parameter required, since `createApp` always passes it. |

## R2.5 Merge conditions (part 041-A)

Closed since round 1:
- **C1.** ADR part: D-QG-001. QG-041-C1: checked here, MET. QG-041-C3: D-ARCH-181.
- **C2.** D-API-003 accepts the §13 row and the §7 text.
- **C3 (decisions half).** D-ORCH-140 records D-TASK041-01..13 as accepted.
- **C4.** The locks `api-audit-mw` and `api-platform-core` are folded into the card.

Open:
- **R2-C1 (user; was C5).** Add the 18 placeholder lines and `TRUST_PROXY_HOPS=0` (A6) to `.env.example` on the branch, so the parity tests are green.
- **R2-C2 (product-manager; QG-041-C2, first half).** A D-PM entry on the step order as ruled, on the reading of AT-US-040-10 and on the title of AT-US-040-06, before 041-A merges.
- **R2-C3 (orchestrator / product-manager; R1-m7).** Mark US-040 as partial on the card and in task-map, with owners named for -04, -13, -14, -15/-16 and the per-account and failed-tracking rules. Alternatively, retitle the helper tests so their AT IDs do not credit route behaviour.
- **R2-C4 (security-analyst; QG-041-C4, first half).** A delta round on `3a6b4c8b`, with concurrence or findings on amendment 12 items 2, 3, 5, 6 and 9.
- **R2-C5 (lane B).** A PASS on the pushed head (`3a6b4c8b` or its successor). It includes the first run of `rate-limit.int.test.ts`, `trust-proxy.test.ts` and the new startApi outage case.

Part 041-B (B1-B5, closing R1-m4 and PR041-SEC-02 (b)) gets its own review before TASK-052 is dispatched.

## R2.6 GOOD (round 2)

- `first` is derived from the count the store already returns, so once-per-window logging needed no new key and holds per instance during an outage.
- `BoundedMap` is small and generic, and is reused by all four fallback maps. Its O(1) claim is tested by counting predicate calls rather than by timing.
- The outage test reads startApi's real log lines and pins both scopes, the level, the fields and the absence of the host name, which closes the mount-only wiring gap.
- The A3 rows go beyond what was asked: `/api/v10` and `/API/v1` pin the exact, case-sensitive prefix.
