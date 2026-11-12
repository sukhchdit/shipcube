# Code review: PR #7, TASK-008 (SPK-03 spike: RLS with Prisma 7 interactive transactions and pooled connections), round 1

| Field | Value |
|---|---|
| PR | https://github.com/sukhchdit/shipcube/pull/7 |
| Branch / head | `feat/TASK-008-spk-03-spike-rls-prisma` @ `985a552`. One commit over merge-base `84ac551`: 2 files, +888/−0 (`docs/04-plan/spikes/SPK-03.md`, `prisma/tests/spikes/spk03-rls-tx.int.test.ts`) |
| Reviewer | code-reviewer (independent), 2026-11-12 |
| Inputs | WAVE-00.md TASK-008; risks.md R-ARCH-03; PLAN.md §9 spike table; ADR-0005 (Decision, Consequences, am. 1–9); data-model.md §4.1–§4.4; DECISIONS.md D-TASK008-01, D-ORCH-004, D-ORCH-010; `prisma/bootstrap/00-roles.sql`; `apps/api/src/platform/db/client.ts`; `eslint.config.mjs`; Prisma 7.10.1 runtime and `@prisma/adapter-pg` sources in the worktree's `node_modules` |

```
VERDICT: CHANGES_REQUESTED
SUMMARY: A strong spike. All four exit items have real evidence on PG 18.6. The GO verdict is sound: I checked the
         Prisma internals it relies on in the shipped sources. One MAJOR: the (d) wall-clock micro-benchmark asserts in
         the permanent, required integration suite with about 2x margin, on the noisy host where heavy suites run. Gate
         it behind an opt-in flag; that fix is about 5 lines. Seven MINORs, mostly about pinning the binding findings
         (F-02/F-03/F-04/F-06/F-09) more precisely for TASK-016, plus C-1 ownership.
```

## 1. Verification performed by the reviewer

**Constraint (D-ORCH-010, dispatch brief).** I did not run npm ci, builds, Docker or the full suites. The 17 spike tests need Testcontainers, so I **did not execute them**. Their pass status comes from the PR-body evidence: senior-developer, head `985a552`, `test:integration` 6 suites 45/45, and the specialist's run 4 at 17/17 in 28.5 s. I verified by reading code and by reading the vendor sources the findings cite. The worktree stayed clean (`git status --porcelain` empty) throughout.

| Check | Result |
|---|---|
| Prettier `--check` on both changed files (Node v24.22.3) | clean |
| ESLint `--max-warnings 0` on `prisma/tests/spikes/spk03-rls-tx.int.test.ts` alone (type-aware, 14 s) | exit 0 |
| Test count / mapping | 17 `it` blocks: (a) 3, (b) 4, (c) 4, (d) 1, (e) 5. They match the PR-body table and SPK-03 §1–§5 |
| Jest wiring | `jest.config.ts` roots include `<rootDir>/prisma`, and the integration project matches `**/*.int.test.{ts,tsx}`. The spike therefore runs in **every** `npm run test:integration` (relevant to M1) |
| F-01 (nested `$transaction` = savepoint) | `@prisma/client/runtime/client.js`: the transaction manager's nested path pushes `prisma_sp_<n>` through the adapter's `createSavepoint`. `client.d.ts` deny-list = `$connect, $disconnect, $on, $use, $extends`. Confirmed |
| F-03 (defaults) | `client.js`: `maxWait: …transactionOptions?.maxWait ?? 2e3, timeout: …?.timeout ?? 5e3`. Confirmed |
| (d) "one extra round trip" claim | `@prisma/adapter-pg/dist/index.mjs:702-726`: `startTransaction` sends `BEGIN` as its own `executeRaw` before the callback runs. The context statement cannot share that round trip. Confirmed |
| Pool-reset behaviour (basis of m4) | `@prisma/adapter-pg/dist/index.mjs:676-684`: `PgTransaction.commit()` / `rollback()` call `client.release()` with no `DISCARD`/`RESET`. The transaction manager sends `COMMIT`/`ROLLBACK` SQL first, and on the maxWait-discard path (`#o`) it sends `ROLLBACK` before release. Transaction-local settings are safe; session-level ones survive into the next checkout |
| Helper SQL vs spec | `spk03_app_org_id/actor_id/guest_token_hash` are verbatim data-model §4.2 (names aside). `spk03_app_is_operator` is a simplification (see n6). Policy templates match §4.3 TENANT / GUEST_CAPABLE / operator `FOR SELECT` |
| Role settings the findings rely on | `prisma/bootstrap/00-roles.sql:40` `GRANT platform_definer TO platform_migrator WITH INHERIT FALSE, SET TRUE`, `:56-57` `platform_app` `idle_in_transaction_session_timeout 15s`, `lock_timeout 2s`. They match F-03, F-09 and F-10 |
| §4 arithmetic | The derived deltas recompute from the run-4 table: 2.923−2.439 = 0.484, 9.723−7.190 = 2.533, 9.723−9.004 = 0.719, 7.089−5.578 = 1.511. Correct (but see n1 for ranges quoted elsewhere) |
| Branch freshness | Merge-base `84ac551` is behind `origin/main` (TASK-005 merge `b1597fd` and docs). Main-side non-docs changes are `packages/config/**`, `tools/config/**`, `.env.example`, `compose.env` and `package-lock.json`, so there is **zero file overlap** with this PR. The merge is a pure union. `SPK03_REPORT` is a test-only env read, not a config-schema key, so the `.env.example` parity test is unaffected |
| CI | `gh pr view 7 --json statusCheckRollup` → `[]` (lane A not merged yet; D-ORCH-004 bootstrap rule applies) |

## 2. Findings

| ID | Sev | File:line | Issue | Required fix |
|---|---|---|---|---|
| **M1** | **MAJOR** | `prisma/tests/spikes/spk03-rls-tx.int.test.ts:502-620` (asserts `:617-618`) | **Wall-clock micro-benchmark asserted in the permanent, required integration suite.** `expect(result.p95StatementVsSelect1).toBeLessThanOrEqual(1)` compares two p95s of client-observed latency. The doc records exactly the noise that will break it: derived deltas moved 1.3–3.6 ms between runs (§4), and in run 4 the two distributions' p99 already differ by 3.3 ms (7.662 vs 4.370). The 0.484 ms observed value sits on the steep part of that tail with only about 2× headroom. Heavy suites run **locally on this shared host** (D-ORCH-001), which is where the noise was measured, so a red run would block unrelated PRs. The benchmark also adds about 10 s (450 rounds × 6 variants) to every integration run. The server-side assertion (0.087 vs 1 ms) is safe but guards nothing a regression could break. | Make the whole `describe('SPK-03 (d) …')` opt-in: `const benchmark = process.env['SPK03_BENCH'] === '1' ? describe : describe.skip;`. Update the SPK-03 §0 command and §6 C-1 so the C-1 run uses `SPK03_BENCH=1`. **Ruling on the reviewer-focus question:** opt-in now, not "once C-1 is closed". Exit (d) is a one-time measurement and SPK-03 §4 is its record; it is not a regression guard. |
| m1 | MINOR | `…int.test.ts:139-157, 363, 655-656, 667, 686` | **The binding error shapes are not pinned.** F-06 tells the error mapper to read `meta.driverAdapterError.cause.code`, and F-03 tells it to map `P2028`. However, `sqlState()` walks any `meta/cause/driverAdapterError` path and then falls back to a message regex. e2/e3 assert only message text; e3 uses `/expired\|closed\|timeout/i`. The exact shapes exist only in the uncommitted `SPK03_REPORT` JSON, so a Prisma bump that moved the code would not turn the spike red. TASK-016 will build its mapper on these shapes. | In (b), `expect(error).toMatchObject({ code: 'P2010', meta: { driverAdapterError: { cause: { code: '42501' } } } })` once. In e2 and both e3 rejections, `toMatchObject({ code: 'P2028' })`. Tighten the e3 regex to the actual "expired transaction" text. |
| m2 | MINOR | `…int.test.ts:69-74`; SPK-03.md §0 | **The prototype sets ADR-0005's 4 settings, but the spec TASK-016 implements (data-model §4.1) sets 6**, adding `app.correlation_id` and `set_config('statement_timeout', $6, true)`. Not shown: (i) a parameterised, transaction-local `statement_timeout` is honoured and **reverts** on the pooled connection. That is an exit-(a) isolation property: a leaked timeout is cross-request state, and F-03 builds its `timeout ≥ statement_timeout` advice on it. (ii) (d) measured 4 calls, not 6 (negligible, but say so). | Add the two settings to `setContext` and to the raw-`pg` variant. In the COMMIT/ROLLBACK reset test, assert `current_setting('statement_timeout')` is back to the role default. Optionally assert a `pg_sleep` beyond the local timeout raises `57014`. Alternatively, list this explicitly in §5 as a TASK-016 test. |
| m3 | MINOR | SPK-03.md:165 (W-2), :134 (F-02) | **W-2 says F-02 "is addressed by the existing lint rule". No such rule exists.** `eslint.config.mjs:198` lets every `repository`/`db-platform` file import `@prisma/client` and the generated client. Nothing stops a service from receiving the root client through DI. F-02's failure is **silent** (0 rows → spurious 404s) and starves the pool under load (P2028), which is the worst kind for a "binding" finding. | Reword W-2 to "the lint rule TASK-016 must add (ADR-0005)". Extend F-02's action with a **runtime guard**: `withTenantTx` runs `fn` inside an `AsyncLocalStorage` scope, and the root client is wrapped with a `$extends` query hook (F-05 proves hooks see raw operations) that throws `ROOT_CLIENT_IN_TENANT_TX` while the scope is active. That turns the silent fail-closed into a loud test failure. |
| m4 | MINOR | SPK-03.md:136 (F-04) | **F-04's guard is aimed at the wrong statement.** `SET LOCAL` is transaction-scoped and cannot leak. The REQ-RLS-003 leak hazard is **session-level** `SET app.*`, `set_config(…, false)` and `RESET`. adapter-pg returns connections without any reset (`index.mjs:676-684`), so a session-level value set by any code path rides into the next request's checkout. | Change F-04's action to ban session-level `SET`, `set_config(…, false)`, `RESET`/`DISCARD` and `$executeRawUnsafe` outside `platform/db` (lint plus a Semgrep backstop). Add a cheap negative control on `single`: a session-level `set_config('app.org_id', A, false)` is visible in the **next** transaction. This documents the hazard and proves the guard is needed. |
| m5 | MINOR | SPK-03.md:141 (F-09) | **F-09 (claim loser gets `55P03` once the winner holds the lock longer than `lock_timeout` 2 s) is labelled an inference but is binding on the claim service's error mapping.** It is cheap to prove with the existing race test (hold the winner more than 2 s). | Either add the test here (assert loser `sqlState === '55P03'`), or route it explicitly to TASK-016 as a required test, not a recommendation. |
| m6 | MINOR | `…int.test.ts:337` | **The 50-parallel isolation test depends on the default `maxWait` 2000 ms.** 50 transactions of about 7 round trips each queue 25 deep on 2 connections. On a slow host the last checkout can pass 2 s and fail with P2028, which is a false failure: maxWait is not what the test checks. | Pass `{ maxWait: 20_000, timeout: 20_000 }` to this `withTenantTx`. |
| m7 | MINOR | D-TASK008-01; SPK-03.md:149-151 | **C-1 has two owners ("TASK-016 or performance-engineer") and no due gate. The spike file's lifecycle is only in the spike doc.** The WAVE-00 DoD boilerplate says "throwaway code is not merged". The sheet's own Files list names this test file. **Ruling:** merging it as evidence is correct (the specific sheet wins over the boilerplate), but it needs one owner and a removal trigger. | Orchestrator action, not author code: C-1 → **TASK-016**, due before G3. Add to TASK-016's sheet: "port the (a)–(c)/(e) assertions into the RLS foundations / TASK-024 suite, run (d) with `SPK03_BENCH=1` on ubuntu-latest (C-1), then delete `prisma/tests/spikes/spk03-rls-tx.int.test.ts`". |
| n1 | NIT | SPK-03.md:11, :120; test `:616` | The header says the end-to-end p95 delta was "1.5–3.6 ms". The §4 runs are 1.914 / 2.533 / 3.599 (= 1.9–3.6, as in the PR body and D-TASK008-01). ":120" and the test comment say "1.3 and 3.6", mixing in the control and raw-`pg` deltas. ":120" also says "p95 of a difference", but the code (`:595`) computes a difference of p95s. | Align the ranges and the wording. |
| n2 | NIT | SPK-03.md §4 | The strongest argument for GO-despite-literal-(d) is implicit. The raw-`pg` delta (1.511 ms) shows the FALLBACK pays the same extra round trip, so the literal criterion cannot tell GO from FALLBACK. | State it in one sentence in the "Interpretation" list. |
| n3 | NIT | test `:224`; SPK-03.md:142 (F-10) | The SQL comment states "cannot grant afterwards" as fact, while F-10 says the reverse order was not exercised. F-10 also misses the consequence for later migrations: `CREATE OR REPLACE` of a definer-owned function needs ownership, so the migrator must `SET ROLE platform_definer` for it too (PG 16+ ownership checks respect `INHERIT FALSE`). | Soften the comment to "expected to fail; not exercised". Add the `CREATE OR REPLACE` note to F-10 for TASK-016/TASK-051. |
| n4 | NIT | SPK-03.md:135 (F-03) | Not mentioned: when `maxWait` expires, the `pg.Pool` checkout stays queued. Prisma later receives the connection, sends `ROLLBACK` and releases it (`client.js` transaction manager `#o`). Under pool exhaustion, P2028s therefore do not shed queue load. | Add to F-03: keep `maxWait ≤ connectionTimeoutMs` and size the 503/Retry-After accordingly. |
| n5 | NIT | test `:357` | The title says "every INSERT is rejected", but only `spk03_shipments` INSERTs are exercised with no context. | Add a `spk03_quotes` guest-shaped INSERT under `NO_CONTEXT` (→ 42501), or retitle. |
| n6 | NIT | SPK-03.md:28 | `spk03_app_is_operator()` reads one membership table, with no `ACTIVE` status and no OPERATOR-organisation join. That is fine for the spike but not "verbatim". | Say it is simplified and that amendment 2's status semantics were not exercised. |
| n7 | NIT | test `:458` | The claim-race waiter loop is bounded by count (40 × (25 ms + query)), not by a deadline. Its slack is coupled to `platform_app` `lock_timeout` 2 s: if the loop ever lengthens, the loser gets `55P03` and the test fails confusingly. | Use a 1.5 s deadline and comment the coupling. |
| n8 | NIT | test `:326, :648, :670` | F-07 states the reset value is `''`, but every assertion accepts `['', null]`. | Keep the tolerance where the helpers are under test, but assert `afterCommit.org === ''` once to pin F-07. |

## 3. Deviation rulings

| Topic | Ruling |
|---|---|
| Exit (d) re-interpreted as "cost of the `set_config` statement" (literal end-to-end delta 1.9–3.6 ms on this host, not asserted) | **Accepted for the GO decision.** `BEGIN` is a separate adapter round trip (verified), and the raw-`pg` fallback pays the same extra round trip (1.511 ms), so the literal number cannot change GO vs FALLBACK. The end-to-end budget remains open as C-1 (single owner per m7). |
| Throwaway spike code merged into the repo | Accepted as evidence because the sheet names the file. It needs a lifecycle (m7), and its benchmark must not gate the shared suite (M1). |
| No versioned migration; the sheet's migration DoD bullet | Correct. The DoD migration bullet is sheet boilerplate and does not apply to an in-test schema. TASK-016 owns `platform_rls_helpers`. |
| Out of scope (`migrate dev` partial indexes, `initShadowDb`, shadow DB, transaction-mode poolers) | Accepted. They are not in the sheet's acceptance and are listed in §6 with routing. Orchestrator to confirm the TASK-016 vs SPK-08 assignment. |
| W-1 | Accurate: one extra round trip plus about 0.1 ms server-side. Forward to principal-architect as written. |
| W-2 | The substance is accurate: Prisma 7.10.1 nests as a savepoint on the same connection (verified). The "existing lint rule" clause is wrong (m3). Forward to principal-architect after the rewording. |
| F-01..F-13 framed as binding on TASK-016 | Agreed. The framing is right, and each finding names a consumer and an action. m1/m3/m4/m5 sharpen four of them; TASK-016's sheet should cite SPK-03 §5 by ID. |

## 4. Merge conditions

1. Fix M1 (opt-in `SPK03_BENCH=1` for the (d) describe, doc command and C-1 updated). Re-review is a delta check of that commit; the head-only gates per D-ORCH-004 must be re-recorded.
2. m1, m2 and m6 are recommended in the same fix cycle, since all are small test edits. Otherwise route them to TASK-016 explicitly in SPK-03 §5.
3. m3, m4 and m5: reword W-2, F-02, F-04 and F-09 as above (doc-only), or the orchestrator routes them to TASK-016's sheet.
4. Orchestrator: m7 (C-1 → TASK-016, due before G3; port-then-delete trigger), and merge `main` (pure union, no overlap) before the gatekeeper's head-gate run.
5. security-analyst review (D-ORCH-004: required from the first task). This PR touches `prisma/**`, so the `security-integration` job applies once lane A exists (D-ARCH-021).

## 5. What is good

- Real production plumbing: the runtime client comes from `createDatabaseClient` as `platform_app` (NOBYPASSRLS, asserted from `pg_roles`) with the generated client. The schema is built as `platform_migrator` on a cloned template, so the RLS evidence is not a superuser artefact.
- Same-connection proof uses `pg_backend_pid()` on a `poolMax 1` client, and interleaving uses deferred promises instead of sleeps. The claim race is observed in `pg_stat_activity` (`wait_event_type = 'Lock'`), not just inferred from the outcome.
- Negative controls are well chosen: malformed GUCs (including `' OR true --` and comma lists), uppercase and truncated hashes, mass-assignment `SET org_id`, operator scope without membership, and membership without scope.
- The (d) design is careful: warm-up, rotating order, a same-shape `SELECT 1` control, and a server-side `EXPLAIN ANALYZE` figure. It is honest that the literal criterion is host-bound. The issue (M1) is only where the assertion lives.
- F-12 (`--selectProjects` is variadic) is a useful harness catch for the dispatch template.

## 6. SECURITY-FLAGS (for security-analyst)

- **F-06 / CWE-209:** the 42501 message names the table. The error mapper must never echo it; map to 404/403 per ADR-0005. With m1 the shape is pinned.
- **Session-level context leak (m4):** adapter-pg releases connections without a reset. Any `SET app.*`, `set_config(…, false)` or `RESET` path would carry tenant context across requests (REQ-RLS-003, CWE-668). Recommend a lint/Semgrep ban plus a negative-control test.
- **Silent root-client use (F-02, m3):** fail-closed but silent, with a pool-starvation DoS under load. Recommend the ALS runtime guard in TASK-016.
- **`$executeRawUnsafe` (F-04):** the only way to use `SET LOCAL` is string interpolation. Confirm the repo-wide ban outside `platform/db` and the tests.
- **Operator branch:** `platform_app` can set `app.actor_scope = 'OPERATOR'` itself. The spike confirms membership is the real control (not-a-member → 0 rows). TASK-016's catalog test should keep the negative case.
- Test-only interpolated SQL (`SETUP_SQL` UUIDs, e4 `$executeRawUnsafe`) is fine in a test. No secrets, and the report file is opt-in and local.

## Round 2 (head 065aa3e)

| Field | Value |
|---|---|
| Head | `065aa3e`. The code delta is `985a552..518d281` (one fix commit, `518d281`, 2 files, +314/−115). `c21485d` and `065aa3e` are normal merges of `origin/main` (`4b02c9b`, `151add9`) |
| Reviewer | code-reviewer (independent), 2026-11-12 |
| Inputs | Fix comment https://github.com/sukhchdit/shipcube/pull/7#issuecomment-6829046302; `git diff c21485d..518d281`; ADR-0005 am. 10 (D-ARCH-058, revised by D-ARCH-062); DECISIONS D-TASK008-02 and D-ORCH-011; WAVE-00.md TASK-016 sheet; data-model §4.1; `prisma/bootstrap/00-roles.sql`; `apps/api/src/platform/db/client.ts`; `@prisma/adapter-pg` 7.10.1 and `@prisma/client` 7.10.1 runtime sources |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: M1 is closed correctly. The (d) describe is opt-in via SPK03_BENCH=1 and reports as "skipped" by default. §0 shows both
         commands, and C-1 has one owner (TASK-016) due before G3. m1–m6 are closed in-PR with deterministic tests, and m7 is closed in the doc.
         Nothing is open in the PR. Two MINORs are routed: an ADR-0005 am. 10 clause the new negative control contradicts, and the TASK-016 C-1 line missing SPK03_BENCH=1.
```

### R2.1 Verification performed by the reviewer

**Constraint (dispatch brief).** I ran no npm ci, build, Docker or suite, and ran no command in the `Shipqube-TASK-008` worktree. The test results are the developer's gate on `518d281`: lint, format:check, typecheck and build exit 0; unit 753/753; `test:integration -i` 6 suites, 47 passed + 1 skipped; audit clean. The developer re-ran lint, format and unit on `065aa3e`. I did not execute the spike tests myself. I checked everything below by SHA, by reading the code, and by reading the vendor sources.

| Check | Result |
|---|---|
| Merge purity | `git diff --stat 151add9 065aa3e` touches only the 2 PR files. `git diff 518d281 065aa3e` on the PR files is empty. `c21485d` = `985a552` ∪ `4b02c9b`, and the diff against main again touches only the 2 PR files. Since `151add9`, `origin/main` has moved to `cb69b04` (docs/.claude only, so it does not overlap the PR files) |
| Prettier `--check` (Node v24.22.3, repo `.prettierrc`) on copies of both files at `518d281` | clean |
| M1 gating | `const benchmark = process.env['SPK03_BENCH'] === '1' ? describe : describe.skip` (T:679). The `pg.Pool` and all 2 700 timed iterations are inside the `it`, so a skipped run creates nothing. Jest reports the test as skipped, which matches the developer's "1 skipped". The client-observed `p95StatementVsSelect1` assertion is gone (recorded only, T:785-789). The server-side ≤ 1 ms check remains inside the opt-in. `SPK03_BENCH` is a test-only env read, like `SPK03_REPORT`, and is not a config-schema key |
| m1 pins vs vendor source | `adapter-pg/dist/index.mjs:400-536`: `convertDriverError` spreads `{ originalCode, originalMessage }` and then `mapDriverError`. `42501`/`42601`/`55P03`/`57014` fall to `default` → `{ kind: 'postgres', code, … }`. `40001`/`40P01`/`23505`/`22P02` map to named kinds without `code`. So `rawPgError()` pins the right shape, and the F-06 "mapped kinds omit `code`" claim holds. The `errorFormat` default (`client.js`: `minimal` only when `NODE_ENV === 'production'`) is confirmed too |
| m2 six settings | `setContext`, `CONTEXT_SQL` and the EXPLAIN variant all bind the same six data-model §4.1 settings (data-model.md:2386-2391 on main, still six). The new test reads `statement_timeout` and `app.correlation_id` through `sessionSettings` on `single`. The pid is equal at baseline, inside, after COMMIT and after the 57014 ROLLBACK, so the revert is proven on the same pooled backend. Baseline `'0'` is consistent with `00-roles.sql:55-57`, where `platform_app` has no `statement_timeout`. The trailing `pg_sleep(0.3)` proves the 200 ms limit did not survive |
| m4 negative control: deterministic? | Yes. It uses `single` (`poolMax 1`), so there is one backend, and every step asserts `pid === sessionLevel.pid`. If the pool recycled the connection (`idleTimeoutMillis` 10 000 in `client.ts`, while the steps are milliseconds apart), the test would fail loudly on pid; it can never pass falsely. The leak is proven on both the next transaction and an autocommit statement. Bonus evidence: after `withTenantTx(B)` the session value A comes back (SET LOCAL reverts to the session value). `RESET app.org_id` runs in `finally` on the same single-connection pool, and the clean state is asserted afterwards, so `single`'s later users (e2–e4) start clean even if an assertion inside fails |
| m5 55P03 test | The winner holds the row lock until `loserSettled`. The loser's wait ends at `lock_timeout` 2 s, before the default context `statement_timeout` of 5 000 ms and well within its 10 s transaction timeout. The loser always reaches the lock, because it starts after `firstUpdated` on the second pool connection. Waiter detection keeps the 1.5 s deadline (n7). The final owner is asserted. Deterministic |
| m6 | `{ maxWait: 20_000, timeout: 20_000 }` on the 50-parallel test (T:468), with a comment explaining why |
| Interaction of the new default `statement_timeout` 5 000 ms with existing tests | e3's `pg_sleep(2.6)` holder and the claim races stay below it. e3's 5.3 s expiry is a client-side `delay`, not a statement. No test changes meaning |
| Docs vs ADR-0005 am. 10 | W-1, W-2, F-01..F-13 and C-1 ownership match. Three ADR-side discrepancies are listed below (R2-m1, R2-n1, R2-n2). SPK-03 is the accurate side in each case |
| Plan | The WAVE-00.md TASK-016 sheet (:589) carries C-1 and port-then-delete. See R2-m2 |
| CI | `gh pr view 7 --json statusCheckRollup` → `[]` (no checks on `065aa3e`; the D-ORCH-004 bootstrap rule applies) |

### R2.2 Round-1 closure

| ID | Status | Evidence |
|---|---|---|
| M1 | **Closed** | Opt-in describe (T:679-681). SPK-03 §0 shows the default and `SPK03_BENCH=1` commands with run 7 and run 6 results. §4 states that (d) is opt-in and is the record. §6 C-1 uses the flag |
| m1 | **Closed** | `toMatchObject(rawPgError(…))` for 42501 (b, twice), 57014 (a), 55P03 (c), 42601 (e4). P2028 is pinned in e2, in e3-expired (`meta: { operation: 'query', timeout: 5000 }`) and in e3-maxWait. The e3 regex is tightened to "A query cannot be executed on an expired transaction" |
| m2 | **Closed** | Six settings. The revert is asserted after COMMIT and after ROLLBACK. 57014 is proven. The (d) variants measure six (§4 run 6) |
| m3 | **Closed (doc)** | F-02 says no lint rule exists today, says TASK-016 must add one, and adds the ALS `NESTED_TENANT_TX` + `ROOT_CLIENT_IN_TENANT_TX` runtime guard. W-2 is reworded |
| m4 | **Closed** | F-04 now names the session-level hazard and the ban list. The negative-control test is in place (above) |
| m5 | **Closed** | Test proven. F-09 is relabelled "Proven" |
| m6 | **Closed** | As above |
| m7 | **Closed in PR / one plan gap** | SPK-03 §6: owner TASK-016, due before G3, port (including the F-04 control and the pinned shapes), run (d) with the flag, record, delete. The orchestrator's sheet edit landed but omits the flag (R2-m2) |
| n1 | Closed | 1.9–3.6 ms, "difference of two p95s", throughout. A residual wording drift is noted in R2-n3 |
| n2 | Closed | §4 Interpretation, third bullet |
| n3 | Closed | The SQL comment is softened. F-10 covers `CREATE OR REPLACE` and `SET ROLE platform_definer` |
| n4 | Closed | F-03, second bullet |
| n5 | Closed | Guest-shaped `spk03_quotes` INSERT → 42501 under `NO_CONTEXT` |
| n6 | Closed | §0 "Helpers": simplified, amendment 2 status not exercised |
| n7 | Closed | `waitForLockWaiter` uses a 1.5 s deadline, and its comment explains the coupling to `lock_timeout` |
| n8 | Closed | `expect(afterCommit.org).toBe('')` |

### R2.3 Findings

| ID | Sev | File:line | Issue | Required fix |
|---|---|---|---|---|
| R2-m1 | MINOR (routed: principal-architect) | `docs/03-architecture/adr/ADR-0005-tenancy-row-level-security.md:111` (am. 10 item 4, on main) | **The ADR asks for a negative control that "proves a session-level `app.*` cannot be set by `platform_app`". This PR's negative control proves the opposite, and PostgreSQL cannot make it true.** Placeholder `app.*` GUCs are `USERSET`. `GRANT/REVOKE SET ON PARAMETER` has no effect on `USERSET` parameters, the `SET` statement cannot be revoked, and `set_config` must stay executable for the transaction-local form. The TASK-016 sheet (WAVE-00.md:590, "session-scope negative control") inherits the ambiguity. A TASK-016 developer would either write a test that cannot pass or weaken it until it passes vacuously. | Reword item 4 to: "a session-scope negative control proves that a session-level `app.*` set by `platform_app` **leaks** to the next checkout (SPK-03 F-04). The token ban (item 1), the fresh-connection probe and this control are the guard, because PostgreSQL cannot deny a `USERSET` placeholder to a role." Port the spike's control verbatim. Not a PR #7 change. |
| R2-m2 | MINOR (routed: orchestrator / plan) | `docs/04-plan/tasks/WAVE-00.md:589` and `generator/plan-data.mjs` (TASK-016 acceptance, C-1) | **The C-1 line says the spike file "runs in the hosted `security-integration` job … with `SPK03_REPORT` uploaded", but does not set `SPK03_BENCH=1`.** After this fix, that run skips (d), and the uploaded report has no `d_overhead_ms`, so C-1 would be "done" with no measurement. ADR am. 10 item 13 says TASK-016's run sets the flag, but the acceptance line the developer works from does not. "Due before G3" (round 1 m7) is also only in SPK-03 §6. | Add "with `SPK03_BENCH=1`" and "due before G3" to the TASK-016 C-1 acceptance line, and regenerate. Also add: "the ported suite asserts the server-side `set_config` p95 ≤ 1 ms without the flag" (see R2-n2). |
| R2-n1 | NIT (routed: principal-architect) | ADR-0005:109 (am. 10 item 2) | "The root client stays private to `apps/api/src/platform/db` (existing lint rule)" is the same claim round 1 m3 corrected in SPK-03 W-2. No such rule exists: `eslint.config.mjs:118,141,193-198` lets repositories import `@prisma/client`/the generated client, and nothing stops a service or repository from importing `platform/db/client.ts`. The TASK-016 sheet correctly requires "no repository imports the root client module" as new lint. | Change "(existing lint rule)" to "(lint rule added by TASK-016)". |
| R2-n2 | NIT (routed: principal-architect) | ADR-0005:105 (W-1) and :119-120 (items 12, 13) | (i) "The spike's own client-observed assertion is behind `SPK03_BENCH=1`": the fix removed that assertion outright, so it is now recorded and never asserted. The server-side ≤ 1 ms check is also behind the flag, so the default suite asserts nothing for (d) until TASK-016 ports it. (ii) Item 12 lists `statement_timeout` among the `platform_app` role defaults, but `00-roles.sql:55-57` sets none, and the spike baseline is `'0'`. (iii) Item 12 adds `lock_timeout` and `idle_in_transaction_session_timeout` to the per-transaction context statement, but data-model §4.1 (:2386-2391) still lists six settings. | Reword (i). Correct (ii). Amend data-model §4.1 to the eight-setting statement, or state that item 12 overrides it. |
| R2-n3 | NIT (optional in-PR, else none) | `prisma/tests/spikes/spk03-rls-tx.int.test.ts:787`; SPK-03.md:11 vs :138 | The round-trip p50 is quoted three ways: test comment "~1.4–1.7 ms", header "≈ 1.1–1.7 ms", §4 "~1.1–1.4 ms". The `SELECT 1` statement p50 is 1.408 in run 4 and 1.103 in run 6. The 1.7 figure is the `set_config` statement, not a bare round trip. | Use "~1.1–1.4 ms p50" in all three places. The file is deleted by TASK-016 anyway. |

### R2.4 Deviation rulings (round 2)

| Topic | Ruling |
|---|---|
| The client-observed `p95StatementVsSelect1` assertion was dropped, not merely gated | **Accepted.** It matches ADR am. 10 W-1 ("reported, never asserted"). An assertion with about 2× headroom is a poor C-1 instrument even on ubuntu-latest, and the server-side check carries the "statement is cheap" claim. |
| The default context `statement_timeout` is 5 000 ms for every spike transaction | Accepted. It equals the interactive-transaction default timeout, matching F-03's `timeout ≥ statement_timeout`, and no existing test's meaning changes (R2.1). |
| The F-02 runtime guard (`ROOT_CLIENT_IN_TENANT_TX` `$extends` hook) goes beyond ADR am. 10 item 2 (no exported client + `NESTED_TENANT_TX`) | Not a conflict. The ADR is the binding text, and the hook is a stronger recommendation TASK-016 may adopt. Each control closes a different path: the ADR's control stops an imported client, and the hook catches a client reached through DI. |

### R2.5 Merge conditions

1. None in the PR's code or docs.
2. security-analyst round 2 on `065aa3e` (D-ORCH-004).
3. Gatekeeper: no CI checks on `065aa3e` (`statusCheckRollup` empty), so the bootstrap rule applies. `origin/main` is now `cb69b04` (docs only, no overlap with the 2 PR files); a further merge-main is optional for code purposes.
4. Orchestrator, before TASK-016 is dispatched: R2-m2 (sheet line). Route R2-m1, R2-n1 and R2-n2 to principal-architect, with R2-m1 before TASK-016 starts.

### R2.6 What is good (round 2)

- The negative control is the strongest addition. It pins the leak on the next transaction and on autocommit, and shows a wrapper does not cure an already-leaked session (`SET LOCAL` reverts to A). It keeps itself clean with `RESET` in `finally` and a post-condition assertion.
- The `rawPgError()` single source of truth plus `toMatchObject` turns F-06 into a regression guard, and the comment correctly steers the mapper to `originalCode`.
- `waitForLockWaiter` is factored out with a deadline and the `lock_timeout` coupling documented. It is reused by the new 55P03 test, which proves F-09 without sleeps.
- The fix comment maps every finding to a change and a proof, and states the code-tree equality of the merge.

### R2.7 SECURITY-FLAGS (round 2)

- **R2-m1:** ADR am. 10 item 4 specifies a control PostgreSQL cannot provide. The real REQ-RLS-003 guard for session-level `app.*` is lint/Semgrep + the `prosrc` scan + the fresh-connection probe. The negative control documents the residual (CWE-668).
- The new test-only session-level `set_config(…, false)` is confined to `single` and reset in `finally`. No secrets or PII; `SPK03_REPORT` is still opt-in and local.
