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
