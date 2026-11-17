# Code review: PR #56, TASK-029 (descriptor-driven automatic audit capture, record/flush, PR42-SEC-15/17/19), round 1

Reviewer: code-reviewer (principal engineer). Head reviewed: `4b02531` (full SHA `4b02531c0e4c9b0e3ef94d0732ed463c128b17de`, branch `feat/TASK-029-automatic-audit-capture`); code head `8b854ce` (`git diff --stat 8b854ce 4b02531` = the lane B evidence directory only). Diff base: `git diff origin/main...4b02531`.

Checked against: the TASK-029 sheet (WAVE-00.md, US-086 AT-01..07, AT-US-008-03 audit hop, AT-US-087-04 value hop, SPK-04 ordering, D-ARCH-106, ONE FLUSH PER TRANSACTION, STREAM EQUALS CONTEXT, CONFIG CONSUMER); ADR-0007 §Capture and amendments 10 and 11 item 3 (D-ARCH-122); REQ-AUDIT-002/005/010; ADR-0014 (idempotency response storage); D-ORCH-088 (PR42-SEC-17, PR42-SEC-19 / R3-m1, R3-n1 due here); D-TASK025-27 / PR42-SEC-15; D-TASK029-01..15 (DECISIONS.md on main).

```
VERDICT: CHANGES_REQUESTED
SUMMARY: record/flush, I1-I4, STREAM_MISMATCH, ascending head locks and the per-stream multi-row CTE are correct and
  well pinned (32 of 35 mutants killed; every writer, store, TenantDb and with-tenant-tx mutant dies). ONE MAJOR: a
  handler's RETURNED non-2xx status commits its writes (D-TASK029-04): a returned 404/400/403 commits a mutation with no
  entry, a returned 409/422/5xx commits it under a FAILED entry, contrary to ADR-0007 §Capture / REQ-AUDIT-010
  ("separate transaction because the business transaction rolled back") with no architect ruling. Seven MINORs, five NITs.
```

## 1. What I verified myself

Node 24 (fnm prefix), review worktree read-only (`git status` clean after every run), scratch copy `git archive 8b854ce` with a node_modules of junctions to the worktree's entries and `@platform/*` junctions to the copy's own workspaces. No Docker: the PostgreSQL side (`prisma/tests/audit/audit-capture-flush.int.test.ts`) is taken from lane B.

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` (ESLint + Stylelint + check-suppressions, `--max-warnings 0`) | exit 0; 6 suppressions, 0 findings |
| Prettier `--check` on the 37 changed non-evidence files | clean |
| Unit + api, targeted (packages/audit, platform/{audit,db,http,routing,tx,authz}, tests/generated/audit-descriptors, tools/lint/audit-capture-boundary) | 929 / 930 on the first run: `[AT-US-086-04]` failed with `fetch failed / read ECONNRESET` (see R1-n1); `capture.api.test.ts` alone 3 x 23 / 23 |
| Lane B `20261116T0436Z_8b854ce` | PASS; integration 323 / 323 includes the four `[D-ARCH-122]` PostgreSQL cases, the held-head AUDIT_LOCK_TIMEOUT and TENANT_CONCURRENCY_LIMIT cases; merged coverage 99.05 % / 97.04 %; packages/audit 100 % |
| Lane A run 43806951976 | fast-lane success; scans fail only at "Security-owned paths need a review record"; `security-integration` SKIPPED (gated on scans), so it has not run on this PR yet |
| Probe: a validated query value with NUL (`?city=%00Pune`) through `entryFor` + `prepareEntry` | refused, `INVALID_ENTRY` field `details.filter.{key}.value` (R1-m2) |

### 1.1 Mutation run (35 mutants, scratch `review/PR-56-cr/mutate.mjs`)

Killed (32): W1 stream check off; W2 record after flush; W3 second flush; W4 `flushed` set after the await; W5 I3 check never fails; W6 token-length check; W7 `handled()` without `.catch`; W8 actor stamp; S1 descending stream order; S2 head `WHERE entry_count = last.seq - 1`; T1 no `setImmediate` turn in `settle`; T2 statements not tracked; T3/X2 `contextOrgId` empty / org not passed; X1 I3 not enforced in `withTenantTx`; C1 SENSITIVE view swallowed; C2 returned 409 without FAILED; C4 flush skipped; C5 non-2xx view audited; A1 denial not awaited; A2 failed denial answered 403; E1 VIEW entry not awaited before send; E2 afterFailure skipped; D1 raw entity id; D2 FAILED for anonymous; D3 FAILED for every 4xx; D4 result_count; D5 unchecked ua_parsed; D6 source app; J1 body check off; J2 lone low surrogate; J3 keys unchecked.

Survived (3), see R1-m7: **C3** `|| isAuditPathFailure(error)` removed (the AUDIT_LOCK_TIMEOUT test's "no FAILED entry" holds only because the same store failure also fails the FAILED write); **C6** `denied()` required permission = `route.permission` instead of `permissionAuthenticated ?? permission`; **C7** `afterFailure` without its `.catch` (a failing FAILED write would replace the original error).

## 2. Findings

| ID | Severity | Location | Issue | Required fix |
|---|---|---|---|---|
| R1-M1 | MAJOR | `apps/api/src/platform/audit/capture.ts:91-107`, `apps/api/src/platform/tx/execute.ts:226-237` (D-TASK029-04) | A RETURNED result always commits the handler transaction. (a) A returned 4xx other than 409/422 (404, 400, 403) commits whatever the handler wrote with **no entry** (the PR's own test pins "a returned 404 commits no entry"); the guarantee "feature code never has to remember to audit" (US-086) and O4 then rest on handler discipline. (b) A returned 409/422/5xx commits the handler's writes under an entry whose outcome is FAILED, so an auditor reads "failed" for a change that persisted, without its diff. (c) ADR-0007 §Capture and the REQ-AUDIT-010 note say FAILED entries are written in a separate transaction *because the business transaction rolled back*; D-TASK029-04 contradicts an Accepted ADR without a principal-architect ruling (CLAUDE.md §5). (d) Under ADR-0014 a 5xx deletes the idempotency row, so a committed returned-5xx re-executes on retry. | Either (1) roll the handler transaction back for every returned status >= 400 that is not explicitly committable, writing FAILED (409/422/5xx) in its own transaction as the ADR says, and let TASK-040 commit only the idempotency completion; or (2) keep commit-on-return but fail closed when the transaction wrote anything under a status with no entry (the TenantDb guard can count write statements; a returned non-recorded status after a write = 500 + rollback), and record a returned-5xx rollback. Either way a principal-architect ruling amends ADR-0007 §Capture / REQ-AUDIT-010 wording for the returned-409/422 case. With a ruling that accepts the current behaviour plus a lint or runtime guard owned by a named card, this becomes MINOR. |
| R1-m1 | MINOR | `apps/api/src/start-api.ts:116`, `apps/api/src/platform/routing/pipeline.ts` `defaultPipelineSlots` | The production composition builds the capture with no tokeniser, IP index or UA parser (D-TASK029 follow-up). Every audited route, and every 403 on any permission-gated route (the denial entry always has an IP, a PII value), answers 500 `TOKENISER_UNAVAILABLE` in a deployed process. Latent today (`moduleRegistry` is empty; only NONE health routes mount), so deferral is acceptable, but the TASK-028 card carries no AC line for it (grep of WAVE-00 / plan-data: no "tokeniser", "startApi" or "composition" line). | Before merge: an AC line on the owning card (TASK-028, or whichever card the orchestrator names) "startApi passes the tokeniser / ipIndex / UA parser into createAuditCapture; a test composes startApi and writes one PERMISSION_DENIED entry". Preferably in-PR: make the gap fail at MOUNT, not per request (capture without a tokeniser refuses audited routes and permission-gated routes with `SlotNotImplementedError`, the PR32-SEC-03 C3 pattern), so the first module PR cannot ship 500s. |
| R1-m2 | MINOR | `apps/api/src/platform/audit/descriptor-runtime.ts:148-156`; `json-body.ts` covers bodies only | PR42-SEC-15 (c) is closed for JSON bodies but not for query strings: Express 5's `querystring` parser yields `"\u0000Pune"` for `?city=%00Pune`, Joi `string()` accepts it, and the list filter summary carries it into the entry, which the writer refuses (probe: `INVALID_ENTRY`, `details.filter.{key}.value`). SENSITIVE list view: a client-triggerable deterministic 503; NORMAL list view: the view is served and silently unaudited. | Refuse NUL / lone surrogates in query values and path params at the same boundary (400 MALFORMED_REQUEST), or let `filterSummary` replace an unstorable value by a fixed marker; add an api test with `%00` on a list route. |
| R1-m3 | MINOR (security flag) | `apps/api/src/platform/authz/authorise.ts:58-79`, `routing/pipeline.ts:30-40` | The PERMISSION_DENIED transaction runs in the authorise slot, BEFORE the route rate limiter. A low-privilege member (Viewer) can loop 403s: each takes a tenant admission permit and the org's stream head lock, so legitimate mutations of the same organisation see TENANT_CONCURRENCY_LIMIT / AUDIT_LOCK_TIMEOUT 503s (intra-tenant availability amplification). | Security-analyst to rate. Options: a per-principal denial limiter before the write, coalescing repeated denials, or moving the denial write after `rateLimit` (the 403 is answered after the limiter). Record the choice. |
| R1-m4 | MINOR | `capture.ts:72-74, 125-135`; `execute.ts:257-262` | `afterFailure` is awaited before the error is answered and is excluded only for AUDIT_* and TENANT_CONCURRENCY_LIMIT. For `TRANSACTION_UNAVAILABLE` (pool exhausted), `STATEMENT_TIMEOUT`, `LOCK_TIMEOUT` and an aborted client it opens a second transaction under the same congestion, roughly doubling the error latency (another pool connection timeout) and adding load; an aborted client gets a FAILED entry coded 500 INTERNAL_ERROR. | Add the congestion reasons to the exclusion set (same rationale the header gives), skip it for an aborted request, and bound it (do not hold the response on a best-effort write, or put it under the request deadline). |
| R1-m5 | MINOR | `descriptor-runtime.ts:193` | Captured USER entries carry no `roles` and no `sessionId`, which REQ-AUDIT-002 / AT-US-087-01 list as complete-entry fields; `Principal` has neither today and no card owns adding them to the capture. | Route it: the authenticator card that adds session id and role keys to `Principal` also maps them in `entryFor` (AC line), or record the gap in D-TASK029 with an owner. |
| R1-m6 | MINOR | `capture.ts:110-123`, `execute.ts:257` | VIEW/DOWNLOAD (`view`/`list`) routes run their handler in a read-WRITE transaction and record nothing in it; a GET handler that writes commits unaudited, and its NORMAL VIEW entry is best effort. | Run the handler transaction `readOnly: true` for `view`/`list` mode (a DOWNLOAD that must write declares a write action or an `additional[]` entry), or record a reason why not. |
| R1-m7 | MINOR | `capture.api.test.ts:536-545`, denial tests | Three survivors (§1.1): C3 (the "no FAILED entry after AUDIT_LOCK_TIMEOUT" assertion is vacuous because the FAILED write fails on the same store fault), C6 (`permissionAuthenticated` precedence in the denial entry untested), C7 (a failing FAILED write must not replace the original error). CLAUDE.md §9 "no silent catch-alls": `afterCommit` (NORMAL) and `afterFailure` swallow non-DB errors (a throwing `auditEntityId`, the missing runner) with no log line; only `AuditWriteError`s reach `onDbError`. | Tests: let the store fail only on the first append and assert zero FAILED attempts; a public route with `permissionAuthenticated` asserts `details.required_permission`; a failing FAILED write still answers the original 409. Log the swallowed failure class (no values) in both catches. |
| R1-n1 | NIT | `capture.api.test.ts:288-300` | `fetch` keeps sockets alive against Node's 5 s `keepAliveTimeout`; under a parallel run `[AT-US-086-04]` hit `ECONNRESET` once in four runs (the W0-FLAKE class). | Send `connection: close`, or set `server.keepAliveTimeout` above the suite length. |
| R1-n2 | NIT | `packages/audit/src/writer.ts:188` | The head rows' `created_by`/`updated_by` stamp is the FIRST recorded entry's user for every stream of a mixed flush. | Per-stream stamp from that stream's first entry, or document it. |
| R1-n3 | NIT | `tenant-db.ts:466-476` | Every `withTenantTx` (also read-only `load` transactions) now pays at least one `setImmediate` turn before COMMIT; under load the poll phase can make that milliseconds. | Note in the TASK-030 / perf budget record; skip the turn when the callback never started a statement. |
| R1-n4 | NIT | `descriptor-runtime.ts:136, 191` | A CREATE whose body has no well-formed `id` silently records `entity_id` null (AT-US-086-01 expects the new id). | Log a class-only warning (no value) when a CREATE resolves to null. |
| R1-n5 | NIT | `docs/sdlc/DECISIONS.md` D-TASK029-01 | The sheet names `audit-middleware.ts`; the file is `capture.ts` (recorded). Fold the name into the sheet at the next fold so TASK-033 / TASK-030 cross-references resolve. | Orchestrator sheet fold. |

## 3. Rulings on the developer's decisions

- D-TASK029-01, -02, -03, -05, -06, -07 (body part), -08, -10, -11, -12, -13, -15: accepted.
- **D-TASK029-04: not accepted as is** (R1-M1; needs a principal-architect ruling).
- D-TASK029-09 (PR42-SEC-17 H2 + T0 residual): accepted. The statement tracking and settle loop are pinned (T1, T2 killed; K1/K2/K8/K50, B1, B3 cases), and the T0 test documents the residual honestly. D-ORCH-088 allowed "refused or documented"; TASK-033 must carry the T0 shape by name.
- D-TASK029-14: accepted with R1-m4.
- Follow-up "production composition lacks tokeniser / ipIndex / UA parser": **acceptable to defer** while no audited or permission-gated route mounts, on the condition of R1-m1 (an owning AC line before merge; a mount-time refusal is the recommended in-PR hardening).

## 4. Closure of items due here

| Item | Status |
|---|---|
| D-ARCH-122 I1-I4, ascending lock order, one CTE per stream, STREAM_MISMATCH (+ SYSTEM shard for an org-less tx) | Closed (unit + PostgreSQL 18 integration; mutants W1-W5, S1, S2, X1 killed) |
| CONFIG CONSUMER (PR #42 R1-n5) | Closed (`[PR #42 R1-n5]` api tests bind 250 into the real store's lock statement) |
| PR42-SEC-17 | Closed with the documented T0 residual |
| PR42-SEC-19 / R3-m1 | Closed (W7 killed; JSDoc no longer endorses `void`) |
| R3-n1 negative fixture importing `capture.ts` | Closed (`tools/lint/audit-capture-boundary.test.ts` `[R3-n1]`) |
| PR42-SEC-15 (a)/(b) null-unless-valid | Closed (D1, D5 killed) |
| PR42-SEC-15 (c) | Closed for JSON bodies; open for query values (R1-m2) |
| US-086 AT-01..07, AT-US-008-03 audit hop, AT-US-087-04 value hop | Present with IDs in titles (AT-03 lint, AT-02/07 unit and generated, others api) |

## 5. Merge conditions

1. R1-M1 fixed, or ruled by principal-architect (ADR-0007 §Capture / REQ-AUDIT-010 amendment) with the remaining gap owned.
2. R1-m1 owner AC line exists on main (or the mount-time refusal lands in-PR).
3. MINORs fixed in-PR or routed with named owners in DECISIONS.md.
4. Security-analyst record on the final head; `security-integration` runs green on that head (it was skipped on run 43806951976).
5. Fresh lane B evidence if any code changes; do not merge main commits that only touch `.claude/agent-memory`; squash.

r2 = delta: re-run `review/PR-56-cr/mutate.mjs` (C3/C6/C7 must die) plus mutants for whatever R1-M1 adds, and the `%00` query probe (`probe-nul.mts`).

---

# Round 2

Head reviewed: `b5f2d9f` (full SHA `b5f2d9fd8b8c610a254e80008e79aecb627588be`; security r3 record, docs only). Code heads `f750cc4` (fix cycle 1) and `683a57d` (fix cycle 2); `git diff --stat 683a57d b5f2d9f` = evidence and the security record only. Delta reviewed: `4b02531..b5f2d9f`. Decisions checked: D-TASK029-16 (supersedes -04), D-TASK029-17..26, D-ORCH-109 card lines (all on origin/main).

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: R1-M1 is fixed as the ADR is written: a returned status >= 400 is thrown inside the handler transaction as
  RouteReturnedError, rolls back, is sent as returned, and 409/422/5xx get FAILED in their own transaction; afterCommit
  runs only after a commit. Every r1 MINOR is fixed or routed with an owner. 30 of 32 new mutants die (C3/C6/C7 now
  killed); one magnitude survivor and one equivalent. One MINOR (TASK-040 card line), four NITs incl. the PR56-SEC-14 ruling.
```

## R2.1 What I verified myself

| Check | Result |
|---|---|
| `npm run typecheck` at b5f2d9f | exit 0 |
| `npm run lint` | exit 0 (6 suppressions, 0 findings) |
| Prettier `--check` on the changed non-evidence files of `4b02531..b5f2d9f` | clean |
| Targeted unit + api (packages/audit, all of apps/api/src/platform, tests/generated/audit-descriptors, tools/lint/audit-capture-boundary), `--maxWorkers=2` | 62 suites, 1,388 / 1,388 pass |
| Same set at the default worker count on a contended host | 25 failures in 7 suites with 200-415 s suite durations (problem-handler, logging, serve, runtime-seams, json-body-text, audit-failure, execute-phases), all loopback suites incl. files this PR does not touch; each failing file passes alone (R2-n3) |
| Lane B `20261117T0335Z_683a57d` | PASS; api 173, integration 323, unit 6,058; merged 99.04 % / 96.98 % |
| Lane A at the head (run 44014221230, b5f2d9f) | fast-lane, scans, **security-integration** and ci-gate all SUCCESS. Lint, type-check and unit are SKIPPED on this docs-only head (proof from the code head), so the re-runs above are the independent check. Run 44012999702 (0ecd317) was the record-wait failure only |
| `probe-nul.mts` against 683a57d | `?city=%00Pune` and `?city=` now pass the filter summary (the only refusal left is the probe's own fake entry id, the same control result as r1) |

### R2.1.1 Mutation run (`review/PR-56-cr/mutate2.mjs` over an archive of 683a57d, 32 mutants)

- **r1 survivors, re-anchored: all killed.** C3 (congestion skip removed), C6 (denial records `route.permission`), C7 (`afterFailure` rethrows).
- **Rollback (R1-M1): all killed.**
  - R1: rollback removed.
  - R2: threshold moved to 500.
  - R3: a returned failure marked `committed: true`.
  - R4: `committed` ignored when scheduling afterCommit.
  - R5: a returned failure rethrown instead of sent.
  - R6: FAILED details for a returned result carry a code.
- **Disconnect identity and wait: four of six killed.**
  - Killed:
    - K1: any abort counts as a disconnect.
    - K2: the disconnect skip removed.
    - K3: the wait unbounded.
    - K6, K7, K8: each congestion reason dropped from the skip set.
  - **K4 survives** (R2-n1): `FAILED_ENTRY_WAIT_MS` raised from 1,000 to 10,000. The test asserts only `waited >= FAILED_ENTRY_WAIT_MS - 50`, a bound derived from the constant under test, so it moves with the regression.
  - **K5 is equivalent:** after a deadline abort, a later close no longer sets `disconnect`. Removing that guard creates a new error object that is never the thrown one, so `isDisconnect` stays false.
- **Read-only views, mount refusal, filter text, log lines: all killed.**
  - V1, V2: read-only view handler.
  - M1 to M4: mount refusal without a tokeniser, `mountDenials` not called, `canDeny` on dual-mode public routes, `additional[]` refusal.
  - F1 to F3: NUL, empty value, truncation.
  - L1, L2: `audit.view_unrecorded` and `audit.entity_id_unresolved` lines.
- **r1 spot rows still killed:** W1, C1, A2, E1.

## R2.2 Closure of round-1 findings

| r1 | Status | Evidence |
|---|---|---|
| R1-M1 | **Closed** (D-TASK029-16, -17, -25) | `execute.ts` throws `RouteReturnedError` for a returned status >= 400 inside the handler tx; `recordFailure` writes FAILED for 409/422/5xx in its own tx; `RunOutcome.committed` gates afterCommit; tests `[R1-M1] [PR56-SEC-09]` (409, 404/400/403, returned 500 + idempotency, anonymous 409) and `[PR56-SEC-10]`; R1-R6 killed. Follows ADR-0007 §Capture / REQ-AUDIT-010 as written, so no architect ruling is needed. |
| R1-m1 | **Closed** (D-TASK029-21, D-ORCH-109 TASK-028 line) | `requireTokeniser` at mount for audited routes; `mountDenials` from the authorise slot for every route that can answer 403 (`canDeny`); M1-M3 killed. |
| R1-m2 | **Closed** (D-TASK029-18) | `filterText`: empty/NUL values JSON-encoded, cut at `MAX_FILTER_TEXT` 1,024 code points without splitting a pair; probe and F1-F3. Sanitising instead of a 400 at the query boundary is accepted: the entry can no longer be dropped or failed by a client-chosen value, which was the finding. |
| R1-m3 | **Routed** | TASK-041 card line in D-ORCH-109 (per-actor denial budget, aggregated entry). Security owns the rating. |
| R1-m4 | **Closed** (D-TASK029-22, -26) | Skip set adds TRANSACTION_UNAVAILABLE, STATEMENT_TIMEOUT, LOCK_TIMEOUT (K6-K8 killed); the response waits at most `FAILED_ENTRY_WAIT_MS` (K3 killed; magnitude R2-n1); the disconnect skip is identity-based, so a deadline abort or a returned 409 after the client left still writes FAILED (K1, K2 killed). |
| R1-m5 | **Routed** | TASK-052 card line in D-ORCH-109. |
| R1-m6 | **Closed** (D-TASK029-23) | `readOnlyHandler` for view/list mode; V1/V2 killed. |
| R1-m7 | **Closed** (D-TASK029-24) | C3/C6/C7 killed; `audit.view_unrecorded`, `audit.failed_unrecorded`, `audit.entity_id_unresolved` with class-only fields (L1/L2 killed). |
| R1-n1 | **Closed** | `server.keepAliveTimeout = 120_000` in `capture.api.test.ts`. |
| R1-n2, R1-n3 | **Not taken, accepted** | Metadata-only stamp; the `setImmediate` turn is noted for the TASK-030 performance budget (D-TASK029 "Not taken"). |
| R1-n4 | **Closed** | `audit.entity_id_unresolved` (L2 killed). |
| R1-n5 | Open, orchestrator fold | Sheet still names `audit-middleware.ts`; no code impact. |

Also new and good in the delta: `x-audit.additional[]` routes refused at mount until a recording seam exists (PR56-SEC-04, M4 killed); `pipeline.ts` as the single composition point with an exact-file boundaries category, and the tx slot no longer re-exports the factory (PR56-SEC-02); the `audit` test seam removed from `PipelineOptions`; `RouteReturnedError.result` held in a private field.

## R2.3 New findings

| ID | Severity | Location | Issue | Fix |
|---|---|---|---|---|
| R2-m1 | MINOR | D-TASK029-17; D-ORCH-109 fold list | Because a returned 4xx now rolls back, ADR-0014's "store 2xx/4xx response" can no longer complete inside the handler transaction. D-TASK029-17 routes this to TASK-040, but D-ORCH-109's card-line list, which is what the next sheet fold applies, has no TASK-040 entry. Latent: the idempotency slot still refuses every `required`/`optional` route. | Add to the D-ORCH-109 fold list: "TASK-040: store the 4xx idempotency completion outside the rolled-back handler transaction; a returned 5xx leaves no completion (D-TASK029-16/17)". Not merge-blocking. |
| R2-n1 | NIT | `apps/api/src/platform/tx/execute-phases.test.ts:768-779` | Mutant K4 survives: raising `FAILED_ENTRY_WAIT_MS` tenfold passes. The only bound is derived from the constant itself (the PR #53 magnitude pattern). | `expect(FAILED_ENTRY_WAIT_MS).toBe(1_000)` (or `<=` the budget D-TASK029-22 states) next to the timing test. |
| R2-n2 | NIT (**PR56-SEC-14 ruling**) | `execute.ts` (`transaction === 'none'` returns `committed: true`), `define-route.ts:209-215` | A `transaction: 'none'` route that returns >= 400 still schedules `afterCommit`, while the JSDoc says "Never for a request whose write did not commit: … a returned status of 400 or more … schedules nothing". **Ruling: a NIT to fix in this PR if another commit lands anyway, otherwise with the next change to `execute.ts` (TASK-040).** No impact today: `none` is restricted to public NONE-audit routes, and no current `none` route has `afterCommit`. Prefer `committed: result.status < 400` for `none` routes, so the contract stays one rule; amending the JSDoc to carve out `none` (D-TASK029-25 wording) is acceptable. Same edit: rewrap the over-long JSDoc line at define-route.ts:211. | as stated |
| R2-n3 | NIT | loopback api suites | Under host contention (default workers, 200-415 s suites) 25 loopback tests in 7 suites failed, including unchanged files and `audit-failure.api.test.ts`; all pass at `--maxWorkers=2` and alone. The same W0-FLAKE class D-TASK029-25 recorded for `rls/api-cases.test.ts`. | Add these suites to the W0-FLAKE-3 scope (D-ORCH-113 (d)); no change in this PR. |
| R2-n4 | NIT | `execute.ts` `recordFailure` | After the 1 s wait elapses, the FAILED write continues detached and is not drained at shutdown (the afterCommit queue is). Best effort by design. | Note it in the JSDoc, or run it through the afterCommit queue's drain. |

## R2.4 Rulings on D-TASK029-16..26

- Accepted: 16 (supersedes 04), 17 (with R2-m1 routing), 18, 19, 20, 21, 22, 23, 24, 25 (with R2-n2), 26.
- "Not taken" for R1-n2 and R1-n3 accepted.

## R2.5 Merge conditions

1. The security r3 record is on the head and lane A run 44014221230 is green at b5f2d9f, including `security-integration`: **met**.
2. The R2-m1 TASK-040 line goes into the D-ORCH-109 fold list. This is an orchestrator docs action on main and does not block the merge.
3. The NITs are optional. If R2-n1 or R2-n2 is fixed in this PR, take fresh lane B evidence and re-run `mutate2.mjs` rows K4 and R4.
4. Squash. Do not merge main commits that only touch `.claude/agent-memory`.

---

# Round 3 (merge delta)

Head reviewed: `081684b` (full SHA `081684b7360109690b3e90d418e8a7f291886f04`; lane B evidence on top of code head `e81d0c9`). Delta: `191c38b..081684b` = merge `4e7f696` (origin/main at `0309d71`: PR #54 `44637dd`, PR #55 `11e2158`) plus `e81d0c9` (R2-n1, R2-n2 = PR56-SEC-14, R2-n4).

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The merge is a pure union. `git merge-tree --write-tree 191c38b 0309d71` gives tree 51fb11f, identical to 4e7f696.
  Semantically, both sides of the five shared files survive, and PR #54's raw-statement guard passes the real audit
  store SQL on PostgreSQL. e81d0c9 closes R2-n1, R2-n2 and R2-n4. D-ARCH-143 closes R2-m1 (TASK-040 card line) and R1-n5.
  9 mutants: 8 killed. One NIT survivor: the 'none'-route threshold is pinned only with a 503.
```

## R3.1 What I verified

| Check | Result |
|---|---|
| Merge purity | `git merge-tree --write-tree 191c38b 0309d71` = `51fb11f`; `git diff 51fb11f 4e7f696` is empty, so no hand resolution was made. Five files changed on both sides: `tenant-db.ts`, `tenant-db.test.ts`, `execute-phases.test.ts`, `start-api.ts`, `eslint.config.mjs`. |
| `tenant-db.ts` union | PR #54's `refusedRawStatement` check sits in `taggedOnly` (line 421), which runs before Prisma is called. PR42-SEC-17's `state.onStart(started)` (line 340), the `setImmediate` settle loop (482), `beforeCommitFailure` and `contextOrgId` are all present. The two do not interact: the guard refuses at call time, and tracking registers at `then`. |
| Tests from both sides survive | `it`/`describe` titles per side vs the merge: `tenant-db.test.ts` PR 29, main 26, merged 30; `execute-phases.test.ts` PR 38, main 29, merged 39. **0 titles missing from either side.** |
| `start-api.ts`, `eslint.config.mjs` | main's exit-code comment edits and the PR's `auditConfig: config` are both present. The PR's `api-pipeline-composition` category and allow (lines 335, 650) sit beside main's `platform/db-raw-sql` arms. |
| Audit store SQL under the merged raw guard | Lane B `20261117T0701Z_e81d0c9`: integration 331/331, 0 `<failure>`. Through the real `withTenantTx`/`TenantDb`, it runs `audit-capture-flush` 8, `audit-writer` 22, `audit-actions-v2` 12 and `audit-owner` 14, so the lock CTE with `set_config(..., true)` and the multi-row append pass PR #54's guard. |
| `npm run typecheck`, `npm run lint` at 081684b | exit 0 / exit 0 |
| Targeted unit + api (packages/audit, apps/api/src/platform, generated audit descriptors, audit-capture-boundary, **negative-fixtures**), `--maxWorkers=2` | 64 suites, 1,980/1,980 pass |
| Lane A run 44037544174 (081684b) | fast-lane: lint, format, type-check, unit, base-ref negative fixtures and build all **ran and succeeded** (no skip trap). The only red is ci-gate "Security-owned paths need a review record" (waits on the security merge-delta record). |
| Lane B `20261117T0701Z_e81d0c9` | PASS: api 173, catalog 102, integration 331, rls-cross-tenant 126, unit 6,719; merged 99.06 % / 97.08 % |

### R3.1.1 Mutation run (`review/PR-56-cr/mutate3.mjs`, archive of e81d0c9, `--maxWorkers=2`)

Killed (8):
- **K4:** `FAILED_ENTRY_WAIT_MS` x10 (now pinned).
- **R4:** `committed` ignored (also killed by the new `[PR56-SEC-14]` test).
- **N1:** a 'none' route is always committed.
- **R1:** rollback removed.
- **T1:** no `setImmediate` turn.
- **T2:** statements not tracked.
- **G1:** PR #54's raw-statement refusal disabled; its `[PR44-SEC-05]` test still pins it in the union.
- **X1:** I3 not enforced.

**Survived (1): N2.** The 'none'-route threshold `status < 400` changed to `< 500`. The new test returns only 503, so a 'none' route returning 404 would still schedule `afterCommit` (R3-n1).

## R3.2 Closure

| Item | Status |
|---|---|
| R2-n1 (wait magnitude) | **Closed**: `expect(FAILED_ENTRY_WAIT_MS).toBe(1_000)`, K4 killed. |
| R2-n2 = PR56-SEC-14 | **Closed** (D-TASK029-25a): a 'none' route has `committed: result.status < 400`; the afterCommit JSDoc states the one rule and is rewrapped; N1 is killed, but the 4xx half is unpinned (R3-n1). |
| R2-n4 | **Closed**: the `recordFailure` JSDoc states that a write still running after the wait is detached and not drained. |
| R2-m1 (TASK-040 4xx idempotency completion) | **Closed** by D-ARCH-143: the card line is on TASK-040; "a returned 4xx is completed in its own transaction after the rollback; a 5xx leaves no completion". |
| R1-n5 (sheet file name) | **Closed** by D-ARCH-143 (TASK-029 `capture.ts`). |
| R2-n3 (loopback flakes under contention) | Unchanged; W0-FLAKE-3 scope. |

## R3.3 New findings

| ID | Severity | Location | Issue | Fix |
|---|---|---|---|---|
| R3-n1 | NIT | `apps/api/src/platform/tx/execute-phases.test.ts` `[PR56-SEC-14]` | Only a 503 is tested, so mutant N2 (`< 500`) survives: a 'none' route returning 4xx would run `afterCommit` against the JSDoc. | Use `it.each([404, 503])`, or add a 404 row, with the next change to this file. Not merge-blocking. |
| R3-n2 | NIT | `apps/api/src/platform/tx/execute.ts` `recordFailure` JSDoc | One line still runs past the print width; Prettier does not reflow comments. | Rewrap with the next edit. |

## R3.4 Merge conditions

1. The security merge-delta record is on the final head, and ci-gate goes green (its only red step today is the record).
2. No code change after `e81d0c9`; if one lands, take fresh lane B evidence.
3. Squash. Do not merge main commits that only touch `.claude/agent-memory`.
