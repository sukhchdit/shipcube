# Dispatch brief: TASK-041 part 041-B, failed-authentication budget, store breaker, fallback set (rulings revision 2)

- **Plan fold / dispatch plan:** D-SD-005 (card lines of rulings §6 items 9 to 14), D-SD-011 (the `load-config.test.ts:136` line of D-ORCH-148). The card section below is copied verbatim from `docs/04-plan/tasks/WAVE-01.md`. If they differ, the generated card governs.
- **Orchestrator decision:** D-ORCH-150. Part 041-B is built STACKED on the part 041-A branch, because PR #82 (041-A, head `be843ae1`, code `0614a90f`, approved, lane B PASS) cannot merge while hosted CI refuses jobs (D-ORCH-146). Part 041-B is opened as its own pull request only after #82 merges; then `origin/main` is merged into it.
- **Branch:** `feat/TASK-041-part-b-rate-limit-rulings-rev2`, created from `origin/feat/TASK-041-valkey-backed-rate-limiting-per` at `be843ae1`. Worktree `../Shipqube-TASK-041B`. Do not touch the 041-A branch or its worktrees.
- **Specialist and model:** senior-developer in person, one agent (host load: at most two build agents). Card: backend-developer, sonnet, complexity M; this is the second part, on the critical path, so it is built at opus level.
- **Why now:** TASK-052 and TASK-048 are not dispatched until part 041-B is merged (TASK-052 card: DISPATCH GATE: TASK-041 PART 041-B MERGED; rulings §2). Critical path TASK-035 → 039 → 043 → 049 → 052 → … → 121.
- **Dependencies:** part 041-A (PR #82), on which this branch stacks. ADR-0016 amendments 12 and 13 (D-ARCH-173..179, D-ARCH-181, D-ARCH-182), D-PM-080 (scope final), D-API-003 (§7 and §13 text acknowledged).
- **Locks:** TASK-041 keeps its card locks for this part: `api-ratelimit`, `api-authz`, `api-routing`, `pkg-audit-redaction`, `api-audit-mw`, `api-platform-core`, plus `lint` (held since 041-A).
- **Merge conditions (from the reviews of part 041-A):** a code review of part 041-B (code review §"Part 041-B gets its own review before TASK-052 is dispatched"), and the security round of QG-041-C4, second half: ADR-0016 amendment 12 items 4 (with PR041-SEC-09 and E1 to E5), 7 (breaker) and 8 (fallback set, closes PR041-SEC-03 on the HTTP side); PR041-SEC-02 (b) closes with this part. QG-041-C2, second half (REQ-SEC-006, A-053, EC-A32 wording for the wider fallback set and `CARRIER_BUSY`) is product-manager's, due before this part merges.

## Read first

- `docs/03-architecture/rulings/wave-1-task-041-rulings.md` §4 (B1 to B5, revision 2 in B1), §5.2 (README §7 text), §6 lines 9 to 14, §8 (rejected options).
- ADR-0016 amendment 12 items 2 to 8 and 10, amendment 13 items 1 to 5 (`docs/03-architecture/adr/ADR-0016-api-conventions.md`).
- Security record `docs/05-quality/security/PR-0082-TASK-041-security-review.md` §R2.3 (E1 to E5), §R2.4 (PR041-SEC-09, R1, R2 (i), the verification test), §R2.7 routes, §R3 (ruled).
- Code review `docs/05-quality/reviews/PR-0082-TASK-041-code-review.md` (R1-m4 routed to B3; R2-n1 and R2-n2 nits).
- DECISIONS.md: D-QG-001 (QG-041-C1 to C4), D-API-003 (§7 and the §13 `rate_limit_auth` cell with part 041-B), D-ARCH-182, D-PM-080, D-ORCH-148, D-ORCH-150.
- On the branch: `apps/api/src/platform/rate-limit/**`, `apps/api/src/app.ts` (`createApp` composition), `apps/api/src/platform/routing/pipeline.ts` (denial budget composition, `bootFailureOf`), `apps/api/src/platform/authn/authenticate.ts` (the TASK-020 stub), `packages/shared/src/http/credentials.ts` (`presentedKinds`).

## Scope notes (lead)

- **B1, the budget.** Key `rl:step0:authn-failed:<ip key>`, fixed 60 s window anchored by the key's TTL, limit `RATE_LIMIT_PUBLIC_PER_MIN`; no new configuration key.
  - Spending side: a wrapper around the authentication slot in effect, composed by `createApp` whenever the rate limiters are composed (default slot, `authenticate` seam, replaced pipeline). A refusal is an `AppError` with a 4xx status out of the slot (a synchronous throw or a rejected promise included); the only exemption keys on the code `ACCESS_TOKEN_EXPIRED` (E4). The request must present a credential of a kind the route declares (`Authorization` for `session`, a refresh cookie, `X-Quote-Token`, a signature header for `signature`); a foreign credential never spends (D-ARCH-109). The refusal goes on unchanged after the spend settles. The spend that reaches the limit emits `rate_limit_auth` with `class: 'authn-failed'`, `key_type: 'ip'`.
  - Reading side: step 0, on the credentialed rule only, one script over two keys (the credentialed hit and the failed count; no second round trip). Spent (count at or above the limit): 429 `RATE_LIMITED` before routing, `Retry-After` = rest of the failed window, `RateLimit-Limit` = the limit, `RateLimit-Remaining: 0`, `RateLimit-Reset`; counter label `step0-authn-failed`.
  - Outage: the spend falls back per instance; the step-0 hit still fails open, but the gate is read from the per-instance fallback, where the spends of the outage went.
- **Revision 2, R1.** A refresh cookie counts as a presented credential at step 0 only when `req.path` is exactly the path of a route that declares `refresh-cookie`. `createApp` derives the set from the mounted module routes and passes it to `ipLimiter` with the prefix (R2-n2: no default prefix). A `refresh-cookie` route whose path is not literal is refused at boot, with a `bootFailureOf` line.
- **B2.** `Stripe-Signature`, `X-Mock-Signature`, `X-Carrier-Signature` (non-blank) select the credentialed rule. The limiter has its own selector; `presentsCredential` of `@platform/shared` is unchanged (cache marking).
- **B3.** One breaker per process, in-house (about 40 lines, injectable clock), shared by the limiter (step 0, step 5, stream slots, B1) and the denial budget: a `RateLimitStoreError` opens it; open for 5 s, every call fails at once with `RateLimitStoreError('unavailable')`; then exactly one probe; success closes, failure re-opens. The breaker must see the bounded call (250 ms) and its reply check. No new dependency (`opossum` stays in `packages/carriers`).
- **B4.** `public-quote` and `public-tracking` become `fallback`; `authAccountRule`, `emailSendRules`, `quoteCreateRules` are documented as `fallback` rules for the consuming services.
- **E1 to E5.** The session authenticator is TASK-052's. This part owns the wrapper half: the exemption by code alone, and the E5 tests through the wrapper (200 forged past-`exp` tokens: 200 × 401 `ACCESS_TOKEN_EXPIRED`, zero verifications, zero spends and authenticator store calls, no security event, no 429; a forged future-`exp` token verified once and spending one unit). A pure pre-check helper that meets E1 to E3 may ship for TASK-052 to consume; record the choice as `D-TASK041-nn`.
- **D-ORCH-148.** `packages/config/src/load-config.test.ts:136`: the sentinel must not be a path substring (strip stack paths or use a sentinel that cannot be one).
- **B5, api/README §7.** The §5.2 text verbatim; and the §13 `rate_limit_auth` Emitted-when cell of D-API-003 (Event and Extra-fields cells unchanged: SEC-TC-63). The README is a tooling input and rides this pull request, as on 041-A.
- **Out of scope.** The session authenticator (TASK-052), refresh-cookie refusals and cookie clearing (TASK-055), guest token (TASK-091), signature verification (TASK-171, TASK-261), metric export and the `authn-failed` alert (TASK-214), carrier admission (TASK-190), client retry on 429 (TASK-065).

## Acceptance (IDs in test titles)

- `[B1 (1)]` to `[B1 (7)]`, `[B1 (9)]` to `[B1 (13)]` (rulings B1), `[B1 (8)]` through `startApi` with the production authentication slot.
- `[B2]` 121 signed webhook requests from one IP are not refused by step 0.
- `[B3]` hanging store: the first call waits the 250 ms bound, each of the next 20 returns in under 5 ms; after the cool-down one probe; a failure of the limiter makes the denial budget skip the store.
- `[B4]` outage rows for `public-quote` and `public-tracking`.
- `[E4]`, `[E5]` as above; `[E2]` and `[E3]` rows for the pre-check helper if it ships.
- `[PR041-SEC-09]` / `[R2 (i)]`: a valid credential from a locked IP gets 429 with `Retry-After` (the accepted scope, pinned).

## Tests and evidence

- Unit: breaker, store scripts through the fake client, limiter `consumeGated` / `spend`, the wrapper's control flow, the selector, the cookie paths, the pre-check. Coverage of changed files at least 85 % line and 75 % branch (95 % is the authz/audit/pricing bar; the limiter is held to it in practice).
- API (`*.api.test.ts`, no containers): the B1, B2 and E5 rows through `createApp`, and B1 (8) through `startApi`. Lane B runs them with the rest of the api project.
- Integration (lane B, real Valkey 8): the new two-key script (counts the first key, reads the second without counting, gives a TTL-less key a TTL), and two replicas spending to the limit once with the key grammar and PTTL in 1..60000.
- Expected lane A extras: `security-integration` (paths under `apps/api/src/platform/**`, `packages/config/**`).

## `.env.example` lines this task may need

None. The budget reuses `RATE_LIMIT_PUBLIC_PER_MIN`; the cool-down (5 s) and the token length cap are named constants.

## Working rules for this part (the TASK-043 brief rules, adjusted)

1. **Worktree and branch.** Only the worktree and branch above, stacked on 041-A (D-ORCH-150), not on `origin/main`. The main checkout is shared: never stash, reset or commit files you did not write.
2. **Node.** Every node or npm command starts with `export PATH="$APPDATA/fnm/aliases/default:$PATH";`. Install with `npm ci --ignore-scripts`, `npm run deps:rebuild`, `npm run db:generate`. Tools run through `npm exec --no --`, never `npx`.
3. **Host checks.** Each a foreground command with an explicit timeout of at most 8 minutes, one at a time: ESLint `--max-warnings 0`, Prettier, `npm run typecheck`, unit Jest `--runInBand` for the touched workspaces with coverage on the changed files. No Docker: integration and the api project run in the orchestrator's lane B queue.
4. **No new configuration key, no new dependency, no lockfile change.** Prefer schema defaults and named constants; `.env*` is user-only and is never read.
5. **api/README rows.** Only the §7 text of rulings §5.2 and the §13 cells D-API-003 gave; no other cell changes.
6. **Files owned by other tasks.** No edit under `apps/api/src/platform/idempotency/**`, `apps/api/src/platform/tx/execute.ts`, `apps/api/src/platform/outbox/**` or the worker. The new `apps/api/src/platform/authn/access-token-precheck.ts` is a pure helper TASK-052 consumes; the authentication slot itself stays the TASK-020 stub.
7. **No DECISIONS.md or STATUS.md edit.** Developer decisions are `D-TASK041-nn` (next free: 10) in the commit bodies and the Handoff Report; the orchestrator records them.
8. **Security-owned paths.** Every changed path under `apps/api/src/platform/**` and `packages/config/**` is listed in the report; the security round of QG-041-C4 (second half) binds to the pushed head.
9. **Commits.** Conventional Commits, lower-case subject with the task ID, body lines under 100 characters, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, uniquely named message files (the scratchpad is shared). Local commits only; no push until #82 merges and `origin/main` is merged in. No secret-shaped literal in tests: build tokens at run time.
10. **Tests carry their IDs** in the titles.
11. **Handoff Report** per `docs/sdlc/templates/HANDOFF.md`: worktree, branch, head, files with the security-owned paths marked, commands and counts, `D-TASK041-nn` verbatim, `.env.example` lines (none), lane B cases, open questions.

## Card (generated by docs/04-plan/generator/gen.mjs, verbatim)

#### TASK-041 — Valkey-backed rate limiting per class with RateLimit headers

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-141, TASK-073) | US-040 (M0 Must) Redis-backed rate limiting and headers<br>US-087 **DC** (M0 Must) Action types, actor types and complete entry fields |
| REQs | REQ-API-014, REQ-SEC-005, REQ-SEC-006, REQ-AUDIT-002, REQ-AUDIT-003, REQ-AUDIT-011 |
| NFRs | NFR-SEC-005 |
| Spikes / security / decisions | PR21-SEC-01, D-ARCH-084, D-ARCH-125, PR48-SEC-06, D-TASK027-11, D-ARCH-134, T-39, SEC-TC-15, PR56-SEC-03, D-SEC-PR56-01, D-ORCH-109, D-ARCH-142, PR61-SEC-12, D-SEC-PR61-03, D-ORCH-135, D-ARCH-173, D-ARCH-174, D-ARCH-175, D-ARCH-176, D-ARCH-177, D-ARCH-178, D-ARCH-179, D-SECT39-01, D-SECPR041-01, PR041-SEC-02, D-SD-004, D-ARCH-181, D-ARCH-182, PR041-SEC-09, D-SECPR041-02, D-PM-078, D-SD-005 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-036 |
| Batch · locks | 1.2 · api-ratelimit, api-authz, api-routing, pkg-audit-redaction, api-audit-mw, api-platform-core |
| Branch | `feat/TASK-041-valkey-backed-rate-limiting-per` |
| Priority | Must · demo-critical |

> Scheduling note: Non-DC enabler of US-155 (DC) and US-022.

**Files / modules**
- apps/api/src/platform/rate-limit/** (classes: auth, email-send, quote-create, public-read, ...)
- packages/config rate-limit keys
- apps/api/src/platform/rate-limit/denial-budget.ts (per-actor denial budget port: Valkey-backed, in-memory fallback)
- apps/api/src/platform/authz/authorise.ts (refuse takes the budget before capture.denied) and apps/api/src/platform/routing/pipeline.ts (the budget is composed into the authorise slot)
- packages/audit/src/network.ts (+ test): IPv4-mapped addresses unmapped from the parsed groups (PR61-SEC-12)
- apps/api/src/platform/audit/capture.ts (+ capture.api.test.ts): denied takes the closed typed mark of D-SECT39-01 item 2
- apps/api/src/app.ts and apps/api/src/start-api.ts (trust-proxy setting of AT-US-087-04, the RBAC-matrix createApp seam, the startApi budget composition; D-SECT39-01 card line 2, D-ARCH-147 table)

**Acceptance tests to write**
- SCENARIO OWNERSHIP (D-PM-078; code review R1-m7 and R2-C3): this task proves through mounted routes AT-US-040-01, -02, -03 rows 1, 3 and 4, -05 to -12 and -17 (429 problem+json, RateLimit-* headers, shared across 2 API replicas); the tests of quoteCreateRules, emailSendRules, authAccountRule and the stream slots are engine proofs and complete no scenario; AT-US-040-03 row 2 is owned by TASK-052, AT-US-040-13 and -14 by TASK-049, AT-US-040-04 and AT-US-040-03 row 5 by TASK-091, AT-US-040-15 and -16 by TASK-141, which completes US-040
- PR21-SEC-01 step 5 (PR #21 security review; D-ARCH-084; owner resolved here, not TASK-108): the step-0 per-IP limiter (ADR-0016 am. 1) fills the pipeline slot TASK-020 fixed BEFORE `routes` (path-less), so /api/docs/* is limited like every other public route; the TASK-020 pipeline-order test stays green and a test proves a docs path returns 429 after the step-0 budget
- AT-US-087-04 (D-ARCH-125; PR #42 code review R1-m5; ADR-0016 am. item 1; EC-A12): this task owns the trusted proxy chain — the Express trust-proxy setting is derived from TRUST_PROXY_HOPS (hops of the edge; ADR-0016 amendment 12 item 9 narrows amendment 1 to a hop count; D-QG-001 QG-041-C3 (c); D-ARCH-181) in the api composition, so req.ip is the first untrusted hop; api test: a request whose X-Forwarded-For carries a forged leading address from an untrusted hop yields req.ip (and therefore the audit entry IP that TASK-029 copies and the step-0 limiter key) equal to the first untrusted hop, never the forged value; the local edge proxy in Compose counts as one trusted hop; US-087 is partial here
- RBAC MATRIX SEAM (PR48-SEC-06; PR #48 code review R1-m3; D-TASK027-11; D-ARCH-134): when the step-0 per-IP limiter becomes real, the generated matrix (tests/generated/rbac) needs a seam to pass it — a createApp option reachable only from tests (no environment variable or configuration switch) plus a test that the production composition passes the real limiter; the seam is listed in the still-stubbed list of the matrix app (TASK-289) and retired like the credential seams when its owner lands
- T-39 PER-ACTOR DENIAL BUDGET (threat-model T-39, MEDIUM; PR56-SEC-03 = PR #56 code review R1-m3; D-SEC-PR56-01; D-ORCH-109; D-ARCH-142; DUE before the first route with a catalogued permission is registered in moduleRegistry: TASK-049 depends on this task and every identity and organisation route task descends from TASK-049 (generator-verified); the route tasks of wave 2 and later that do not descend from it — TASK-087 quote, TASK-091 guestquote, TASK-092 saga and the like — start after batch 1.2 by wave order, and the orchestrator does not back-fill a route task with a catalogued permission ahead of this task): authorisation runs before the route limiter (DR-A08), so the authorise slot takes one unit of a per-actor budget BEFORE it writes PERMISSION_DENIED; key = the organisation id (or the literal system for an organisation-less principal), a colon and the actor id, or the credential kind for a principal without a user actor (an anonymous request answers 401, which is not audited, and stays with the step-0 per-IP limiter); window 60 s, anchored by the Valkey key's TTL at the window's first denial, one atomic script per denial (D-SECT39-01 item 3); AUTHZ_DENIAL_BUDGET_PER_MIN in packages/config (default 20, validated 1..600); (a) denials 1..N of a window are audited one by one and answer 403 as now (D-TASK029-06 unchanged: a failed write answers 500 or 503, never a silent 403); (b) denial N+1 writes ONE aggregated PERMISSION_DENIED entry (details: required_permission plus aggregated true, threshold, window_seconds, window_ends_at (closed set, D-SECT39-01 item 2; no count); no entity id) and answers 429 RATE_LIMITED with Retry-After = the rest of the window, RateLimit-Limit N, RateLimit-Remaining 0, RateLimit-Reset; (c) every further denial of the window writes nothing and answers 429; (d) the number suppressed is kept under a second key (TTL 24 h) and is written as details.suppressed_in_previous_window on the first audited denial of the same actor in a later window, claimed atomically by the denial that opens a window, restored when its entry is not written, omitted when 0; a counter metric per rate class and the request log (status 429) carry it meanwhile — one actor therefore costs at most N+1 audit transactions a minute; Valkey outage: the budget falls back to an in-memory per-instance counter with the runtime security event of D-SECT39-01 item 5 (api-designer change request), at most once a minute per instance (the ADR-0016 item 8 rule for the auth class), never to unlimited writes; tests: [SEC-TC-15] N+2 denials in one window give N entries, one aggregated entry and two 429 answers, and the first denial of the next window carries suppressed_in_previous_window = 1; two API replicas share one budget; a store failure uses the fallback and logs the event; the k6 denied-flood case (p95 and 503 rate of the legitimate writes of the same tenant stay inside their budget while a Viewer floods) stays with qa-lead in the abuse suite; the aggregated-entry shape is confirmed by security-analyst (D-SECT39-01)
- PR61-SEC-12 (INFO, CWE-1289; D-SEC-PR61-03; D-ORCH-135): network.ts unmaps an IPv4-mapped IPv6 address from its parsed groups, so every spelling (::ffff:a.b.c.d, ::ffff:7f00:1, the expanded 0:0:0:0:0:ffff:... forms, upper case) is coarsened as the IPv4 address it carries, for the audit IP index and for the trusted-proxy chain of this task; one test row per spelling
- TWO PARTS (ADR-0016 amendment 12; D-ARCH-173..179; rulings/wave-1-task-041-rulings.md sections 3 and 4): part 041-A is the first pull request with changes A1 to A8; part 041-B (failed-authentication budget, signature headers in the step-0 selector, store breaker, fallback set, api/README section 7 additions of section 5.2) is merged before TASK-052 is dispatched and closes PR041-SEC-02 (b); part 041-B may be a second pull request or ride the first (orchestrator choice); the task stays partial on the STATUS board until 041-B merges (D-SD-004: a part on this card, not a new task id)
- T-39 TESTS ADDED BY D-SECT39-01 (card line 8): the stored details deep-equal the closed sets (crossing; opener with carry; plain); N+K denials from K distinct IPs and user agents add vault and ip_hash rows for the N+1 entries only; every Valkey key under the two prefixes matches the item 3 grammar; budget-key PTTL in 1..60000; the carry is restored after a failed opener write; the startApi composition answers 429 at N+1; the counter has no organisation or actor label
- PART 041-B REVISION 2 (ADR-0016 amendment 13; D-ARCH-182; PR041-SEC-09): the refresh cookie selects the credentialed rule only on the paths of routes that declare refresh-cookie, derived by createApp from route metadata; tests B1 (9) to (13) of the rulings file; the wrapper exemption keys on the code ACCESS_TOKEN_EXPIRED alone
- LATENT TEST DEFECT (D-ORCH-148; S4): packages/config/src/load-config.test.ts:136 asserts that the rendered error does not contain abc, and the rendered error includes a stack path, so it fails in any worktree whose path holds that substring; carried by whichever of TASK-284, TASK-041 part 041-B and TASK-015 part 015-C first changes a test under packages/config, the others drop it: strip stack paths before the check or use a sentinel that cannot be a path substring
- Covers the scenarios of AT-US-040-01 … AT-US-040-17 that belong to its layer; US-040 closes in TASK-141
- Covers the scenarios of AT-US-087-01 … AT-US-087-08 that belong to its layer; US-087 closes in TASK-073

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`packages/audit/**`, `packages/config/**`, `apps/api/src/platform/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.
