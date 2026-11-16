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
