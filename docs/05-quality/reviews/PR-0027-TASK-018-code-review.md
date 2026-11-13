# Code review: PR #27, TASK-018 (SPK-04 audit write throughput spike), round 1

| Field | Value |
|---|---|
| Head reviewed | `aa1cfb1c6c12d154e5a33482235235459b389551` (branch `feat/TASK-018-spk-04-spike-audit-write`; merge of origin/main `94e8808` + evidence move) |
| Reviewer | code-reviewer (read-only; probes on a scratch `git archive` extract, cleaned up) |
| Date | 2026-11-13 |

VERDICT: **CHANGES_REQUESTED**

SUMMARY:
- The spike is honest about being INCONCLUSIVE and the numbers in `SPK-04.md` match `summary.json` for every table row. The routing to principal-architect is a defensible risk call, and the SQL defects it reports are real (re-verified). The write path is the real `createDatabaseRuntime` / `withTenantTx` as `platform_app`.
- Two MAJORs. (M1) The DB-coupled harness (`server.ts`, `runner.ts`, fixtures 20/30) is dead on arrival once open PR #24 (TASK-021, same batch 0.6) merges. PR #24 deletes the `spk08/10-audit.sql` and `90-audit-ddl-guard.sql` that `runner.ts` reads, and its real `10-audit.sql` creates the tables fixture 20 re-creates. No CI lane runs `runner.ts`, so the rot would be silent. (M2) The spike doc states as fact several things the committed artefacts do not show or contradict (CPU-not-limiting numbers, "structural in both repetitions", the lock-hold model, "R-ARCH-04 is confirmed").
- Both are cheap to fix (one deletion commit plus a doc pass). Round 2 is a delta check; I expect APPROVED_WITH_NITS.

## 1. What I verified myself, and what I did not

| Check | Result |
|---|---|
| `gh pr view 27` checks on the exact head | `fast-lane` SUCCESS (lint, format, typecheck, unit, build run in CI on `aa1cfb1`); `scans` FAILURE and `ci-gate` FAILURE only because "Security-owned paths need a review record" (eslint.config.mjs; no `PR-0027-*.md` yet). Expected first-run state. |
| 27 SPK-04 unit tests (`jest prisma/tests/spikes/spk04 --selectProjects unit`, extract + node_modules junction) | 3 suites, 27 passed |
| ESLint on `tests/load/spikes/spk04-audit.js` with the PR config | exit 0. With the new `tests/load/**/*.js` block removed: 8 errors (`import-x/no-unresolved` x2, `no-undef` `__ENV` x4, `__VU`, `__ITER`). The block is needed and does exactly that. |
| Table rows of SPK-04 §2.1 / §2.2 vs `summary.json` / `summary.md` (both runs) | All match (p50/p95/p99, deltas, rps, dropped, errors, CPU, audit p95, hot lock waits, round-trip counts 15/12/12/12/9 and 9/10/10/10/7) |
| Independent JCS check: spike `canonicalize` vs the `canonicalize` package (installed for `packages/audit`) over 20 000 seeded random values with hostile keys/strings/numbers | 0 differences. One divergence: a lone surrogate (`'\ud800'`) is rejected by the package and accepted by the spike (R1-n2). |
| Pinned entry-hash vector | `chain.test.ts` compares `entryHash` with a SHA-256 over a hand-written canonical string, independent of `canonicalObject`. Sound. |
| The data-model §5.4 / SQL-text defects (PGlite, PG 17.5) | `'\x' \|\| repeat('00',32)` into bytea gives 42804; `decode(repeat('00',32),'hex')` is accepted; `pg_catalog.extract(epoch FROM ..)` is a syntax error (42601) while `pg_catalog.extract('epoch', ..)` works; `pg_catalog.unnest(a, b)` does not exist (42883) while unqualified `unnest(a, b)` works. All four routed findings are correct. |
| Evidence location vs `quality:check-evidence` / `quality:prune` | `check-evidence.mjs` matches only `docs/05-quality/(tests\|security\|performance)/runs/<id>/`; `prune.mjs` reads only `<root>/runs`. `performance/spikes/SPK-04/` is outside both. D-TASK018-05 is sound and the deviation from the sheet line is recorded. |
| Isolation of the fixtures | No glob in `tools/db`, `jest.config.ts`, Semgrep or CI reaches `prisma/tests/spikes/spk04/fixtures/*.sql`; the runner's bootstrap copy filters `^0\d-`. They are not in the bootstrap or migration lanes and not in seeds. |
| Harness change since the evidence runs | `git diff c037470 aa1cfb1 -- prisma/tests/spikes/spk04 tests/load` is two comment/path lines in `runner.ts`. The committed harness is the one that produced the evidence. |

Not re-run (per the dispatch): Docker, the benchmark, k6, `test:unit` full, build, coverage, integration. I relied on the CI `fast-lane` result for lint/format/typecheck/build on the exact head. The `dirty` flag in the 150 rps `summary.json` is true and the 300 rps one false (R1-n4).

## 2. Findings

| ID | Severity | Where | Problem | Required fix |
|---|---|---|---|---|
| R1-M1 | **MAJOR** | `prisma/tests/spikes/spk04/{server.ts,runner.ts,fixtures/20-*.sql,fixtures/30-*.sql}`; SPK-04 §7/§8; D-TASK018-02 item 6 | **The harness is broken by PR #24 and nothing would notice.** `runner.ts:100-104` reads `spk08/10-audit.sql` and `spk08/90-audit-ddl-guard.sql`. PR #24 (open, head `6f498c4`) **deletes** both (167 + 91 lines) plus `spk08/prisma.config.ts` and the SPK-08 audit-owner suite, and adds `prisma/bootstrap/10-audit.sql`, whose own `CREATE TABLE` statements include `audit_stream_heads` and the vault/`data_subjects` (30 matches), so fixture 20 (`CREATE TABLE public.audit_stream_heads` etc.) would also collide. `preAuditBootstrapDir` filters `^0\d-`, so `10-audit.sql` / `90-*.sql` of the real lane are not picked up either. `runner.ts` / `server.ts` are not imported by any test, are type-checked only (paths are runtime strings) and take about 16 min of Docker per rate, so lane A/B stay green and the harness silently rots. SPK-04 §8 puts the deletion of fixture 20 and the SPK-08 files at "when TASK-030 lands"; SPK-08 §8.1 and PR #24 put it at TASK-021, one task earlier. This is the PR #12 M3 pattern. It also contradicts the sheet DoD "throwaway code is not merged" (the sheet's Files list names only the k6 script and "SQL fixtures"; the DB harness is not listed). | Rule per section 3 (recommended: drop the DB-coupled files). Whichever way the ruling goes, §0/§7/§8 and D-TASK018-02 item 6 must match the merged tree. |
| R1-M2 | **MAJOR** | SPK-04.md header Verdict, §2.1 (para after table), §4, §5.1, §6, D-TASK018-01, PR body | **Claims stated as established that the artefacts do not support or contradict.** (a) §2.1: "replica processes used about 0.26 cores each and Postgres about 0.5 cores (docker stats 54 %), so neither the app tier nor the DB CPU was the limit". There is no per-process CPU series in any artefact (no `0.26`). The 54 % is the `docker stats` sample of the **collapsed rep 1 `off`** arm; the arm the sentence is about (`on`, rep 2) shows **134 %** (`batched` rep 2 106 %, rep 1 `on` 144 %, rep 1 `batched` 195 %). The conclusion may still hold on a 16-vCPU VM, but the evidence cited is misattributed. (b) "structural, and showed up in both 300 rps repetitions": all 6 arms at 300 rps are invalid (10 invalidity reasons), rep 1 `off` itself collapsed (p95 2 001 ms, 5.3 % errors), and the only repetition with a usable baseline (rep 2) has `on` itself invalid (1.14 % dropped, 26.7 % busy samples). (c) §5.1 "lock-hold time is round trips x RTT": the harness never measures hold time (`lockMs` is the lock statement including the wait). Back-of-envelope with the doc's own model: 5 round trips x 1.5 ms = 7.5 ms, so rho = 60 x 7.5 ms = 0.45 and an M/D/1 mean wait of about 3 ms. Measured hot-lock wait p50 at 300 rps is 97.7 ms (p95 228.6). Fitting the data needs a hold of about 15 ms, i.e. about 2x the model, while at 150 rps (30 rps on the stream) wait p50 0.7 ms / p95 5.2 ms fits about 7.5 ms. The implied hold roughly doubled between the two rates. Host CPU contention (72 % mean, 27 % of samples > 85 % at 300 rps vs 42 to 53 % at 150 rps) is one candidate, and it is exactly the confounder TEST-STRATEGY §7.10 exists to exclude; a COMMIT/WAL-flush floor that batching cannot shrink is another. The "at most 3 round trips under the lock" budget in §5.1 is therefore a hypothesis, not a measured spec. (d) §6 "R-ARCH-04 is confirmed on this host at 60 rps per stream" and the PR/DECISIONS wording "exit not met" overstate INCONCLUSIVE evidence. (e) "batched alone also missed the budget at 60 rps per stream" rests on one arm that is invalid only by 0.8 percentage points of CPU share (10.8 % vs 10 %). The same arm configuration at **half the rate** (150 rps, both reps) collapsed to p95 1.9 to 2.8 s with hot-lock p95 475 to 538 ms, against p95 255 ms / hot-lock p95 168 ms at 300 rps. A 10x spread between identical configurations at different rates means something other than lock queueing varies between arms; the evidence cannot rank batched. | Edit text only; no re-run. (1) Replace the CPU sentence with what is recorded (the per-arm `docker stats` values above) or delete it. (2) Reword the verdict as "exit NOT DEMONSTRATED: INCONCLUSIVE under §7.10 at 300 rps (0 of 6 arms valid); direction: a hot stream at 60 rps queues; R-ARCH-04 is not retired", and say rep 1 is not evidence of anything but host disturbance. (3) Mark the round-trips x RTT model and the 3-round-trip budget as hypotheses, record the 7.5 ms vs about 15 ms discrepancy, and add "measure grant-to-COMMIT hold time per request and the WAL flush share" to the TASK-280 re-run scope. (4) State that batched cannot be ranked (the 150 vs 300 rps anomaly) and that §5.4 (EXPLAIN against a >= 100k-row vault) is a precondition, not a footnote. (5) Align the vocabulary: the sheet allows GO / FALLBACK, the tool has four verdicts (`FALLBACK-INSUFFICIENT`), the PR title says FALLBACK. Use one sentence in the header, D-TASK018-01 and the PR body. |
| R1-m1 | MINOR | SPK-04.md §2.2, §4, §6; `verdict.ts` pooling | **Statistical method cannot resolve a 15 ms budget on this host.** n = 2 repetitions, mean of 2 deltas, fixed order off, on, batched. The `off` baseline p95 moved 12.6 to 30.0 ms between reps (17 ms, more than the budget). Rep 2 `off` ran right after rep 1 `batched`, an invalid arm with Postgres at 95 to 114 % CPU, and has a 192.8 ms p99 tail, which flatters `on` (rep 2 delta -2.3 / -149.8). The pooled "+9.9 ms / -45.2 ms is inside the budget" is therefore an artefact of one noisy baseline; the clean-baseline repetition (rep 1: +22.1 / +59.4) **fails** both budgets at 150 rps. The doc reports both, which is good, but §6 proposes "pooling as the mean of repetitions" for NFR-AUDIT-005 and the PR body leads with the pooled figure. | Say in §2.2 that at 150 rps the budget is also not demonstrated (1 of 2 clean-baseline repetitions fails). For TASK-280 and the NFR wording: at least 5 repetitions, ABBA or Latin-square order, DB state reset or reused identically per arm, report median delta and range, per-repetition pass. Do not propose mean-of-2 pooling in §6. |
| R1-m2 | MINOR | `fixtures` -> SPK-08 `10-audit.sql:74-79`; SPK-04 §5.2(iv); D-TASK018-04 item 3; PR body "FORCE RLS intact" | **Prototype artefact routed as a rule.** The benchmark runs on the SPK-08 prototype, where `audit_entries` has ENABLE + FORCE RLS and placeholder policies. The current data-model (L1315, L3242, PR12-SEC-08) says `audit_entries` is SYSTEM, **no RLS**, and the policies "are not ported". "No RETURNING on the CTE insert under RLS (it would apply the audit_entries SELECT policy)" is therefore advice for a design that does not exist, and integrity check (d) asserts FORCE RLS on a table the real design leaves without it. Direction of bias is small and pessimistic for `on`/`batched` (policy evaluation per insert), partly offset by the missing RLS on heads/vault (declared). | Qualify §5.2(iv) / D-TASK018-04 as prototype-specific (RETURNING is simply unneeded), and add one line to the "simplifications" list: audit_entries RLS present in the prototype, absent in the design. |
| R1-m3 | MINOR | SPK-04.md §1 "Round trips ... measured, identical in every run" | The counts come from the harness's own `probe.rt()` calls (a hand-placed counter), not from the wire or `pg_stat_statements`. They match the formula (e.g. create `on` = 3 + 1 + 3x2 + 1 + 1 + 1 + 2 = 15) but are by construction, not independent. | Say "counted by harness instrumentation (matches the statement list)". For TASK-280, take the count from `pg_stat_statements` or the driver. |
| R1-m4 | MINOR | `runner.ts:701`, `:702-703` | The integrity step is `.catch(error => ({ error }))`: if it throws, the run still exits 0, the verdict is unaffected and `markdown()` prints the error string as if it were a status. Fail-open for evidence that the PR body leads with ("223 118 entries recomputed, 0 faults"). Moot if the runner is dropped (M1); if kept it is a lane-B seed and must fail closed. | Let the integrity failure set a non-zero exit and an `INTEGRITY_FAILED` verdict. |
| R1-n1 | NIT | `eslint.config.mjs:472-477` | The block is minimal and correct (files scope, globals and `import-x/core-modules` only, no rule changes). `open` and `console` are declared but unused by the only script; `core-modules` lists exact names, so T-QA-06 will need to extend it for `k6/metrics`, `k6/data` etc. Neither weakens anything. | Optional: add a comment that the list is exact-name. |
| R1-n2 | NIT | `canonical.ts:1-8` | "Exact RFC 8785" slightly overclaims: lone surrogates are accepted (I-JSON forbids them; the reference package throws). Irrelevant to the benchmark (hex/ASCII payloads); TASK-030 must use `canonicalize`, which the doc already says. | Reword to "RFC 8785 for well-formed strings". |
| R1-n3 | NIT | SPK-04.md header "32 GB RAM (about 7 GB free)" | `host-spec.json` records `ramFreeGiBAtStart` 6.2 (300 rps) and **3.7** (150 rps). Low free memory is itself a contention indicator. | Quote both values. |
| R1-n4 | NIT | `summary.json` (150 rps) `"dirty": true` | The run sha is `c037470` with a dirty tree; the 300 rps run is `dirty:false`. Most likely the untracked first-run evidence directory, and the harness diff since is two comment lines, but the doc does not say so. | One sentence in §7: "dirty = the first run's untracked evidence directory". |
| R1-n5 | NIT | PR body / D-TASK018-02 item 6 | The precedent argument ("SPK-03/SPK-08 shipped test-only harnesses") compares unlike things; see section 3. | Amend item 6 after the ruling. |

## 3. Ruling requested: keep or drop the harness

**Recommendation: drop the DB-coupled files from the merge** (`server.ts`, `runner.ts`, `fixtures/20-spk04-audit-write.sql`, `fixtures/30-spk04-business.sql`; about 1 430 lines of TypeScript). Keep the k6 script, the eslint block, the spike doc, the evidence, DECISIONS, and the three pure modules with their 27 tests.

Reasons:
1. **The precedent does not transfer.** SPK-03 and SPK-08 shipped `*.int.test.ts` suites: assertions that run in lane B on every integration run, so they cannot rot unnoticed and each had a named porting task (SPK-08 §8.1 even lists the files each PR must delete). `runner.ts` / `server.ts` are a benchmark driver. Nothing in CI executes them, they need Docker, k6 and a quiet host for about 16 min, and their only automated coverage is the type-check.
2. **It is deterministically broken by the sibling PR in the same batch** (R1-M1). Keeping it means PR #24 must also delete or rewrite it, a cross-PR burden neither sheet mentions. Dropping it costs nothing: the findings and the evidence do not depend on it (the PR body says so).
3. **The sheet already scopes this.** Files/modules list the k6 script and SQL fixtures; the DoD says "throwaway code is not merged" and "k6/Lighthouse scripts committed; host spec and results as machine-generated evidence". D-TASK018-05 itself says the lane-B re-run will produce schema-conformant `runs/` evidence, so the evidence writer and arm loop will be rebuilt for T-QA-06 anyway.
4. **Reproducibility is kept without the files on main.** Tag the harness commit (`c037470`, the sha every `summary.json` names) with an annotated tag such as `spike/spk-04-harness` (a tag is not a history rewrite), and point SPK-04 §0/§7/§8 at it. If the orchestrator would rather not tag, say "branch `feat/TASK-018-...` at `c037470`" and do not delete the branch.
5. **Keep the pure modules.** `canonical.ts`, `chain.ts`, `verdict.ts` and their tests are small, self-contained, run in `test:unit`, and carry two cross-task inputs: the pinned entry-hash vector that TASK-030 must reproduce (SPK-04 §8) and the validity/verdict rules T-QA-06 needs. Give each an owner and a deletion point in §8: `canonical.ts` + `chain.ts` deleted by the TASK-030 PR after the vector is pinned in a `packages/audit` unit test; `verdict.ts` absorbed by TASK-280.

If the ruling is to keep the harness, the minimum conditions are: (a) rebase on PR #24 and repoint `runner.ts` to the real `prisma/bootstrap` files (apply 01 to 10, then 90) and delete fixture 20 (the real file owns those tables) in the same PR that lands second; (b) a cheap tripwire so rot is loud, for example a unit test that asserts every file path `runner.ts` reads exists (`setupDatabase` file list, K6 script, fixtures); (c) fix §8 so the deadline is the TASK-021 PR, not TASK-030, with named owners; (d) R1-m4; (e) the PR #24 sheet/lifecycle text gains the spk04 deletions. That is materially more work than dropping the files, for no change in the findings.

## 4. Good

- The runtime path is real: `createDatabaseRuntime` / `withTenantTx` as `platform_app`, the audit-off switch is confined to the harness and the `-bench` image caveat (PR3-SEC-11) is kept open rather than papered over.
- The validity rule is implemented as code (`verdict.ts`, boundary-tested at 15/40 ms, 1 % and 10 %), applied to every arm, and the run says INCONCLUSIVE in its own `summary.md`. The developer did not launder the verdict.
- Integrity is recomputed for **every** entry (140 905 + 82 213), including DB round-trip fidelity of jsonb, inet, microsecond timestamps and bytea, with a pinned independent vector, privilege and trigger layers separately probed, and the event triggers and FORCE RLS read back.
- The data-model SQL defects were found by running the real statements and recorded with the SQLSTATE, and all four reproduce.
- k6 pinned by digest only with the reason recorded; loopback binding; evidence kept out of the schema-checked `runs/` tree with the rule cited.
- The eslint change is the smallest possible and has no suppression comments.

## 5. Security flags (for security-analyst)

- `eslint.config.mjs` is security-owned: a record `docs/05-quality/security/PR-0027-*.md` naming the final head is required (lane A `scans` is red until then). The change itself is globals plus `import-x/core-modules` for one glob; I found no rule weakening.
- If any part of `server.ts` is kept: unauthenticated `POST /__reset` and `GET /op/*` run SQL as any seeded tenant; loopback by default but `SPK04_BIND` can widen it, and `SPK04_DATABASE_URL` is passed through the child environment. Test-only against a Testcontainers database, so low; moot if dropped.
- `runner.ts` mounts `tests/load/spikes` into the k6 container with `-v ...:ro`. Fine for a local tool; the workflow-policy tripwires (`--mount`, `$PWD`) apply to `.github/workflows` only, but do not let this pattern migrate into CI.
- Fixture 20 holds audit DDL without the rule-12 `@audit-ddl security-approved` marker. It is outside the bootstrap lane that rule governs, which is another reason it must not stay if the real lane changes.

## 6. Merge conditions

1. R1-M1 resolved per the ruling (recommended: delete the four DB-coupled files, tag or reference `c037470`, rewrite SPK-04 §0/§7/§8 and D-TASK018-02 item 6).
2. R1-M2 resolved by the text edits listed (no re-run needed).
3. R1-m1, m2, m3 in the same doc pass (preferred), or routed with an owner (TASK-280 / T-QA-06 / principal-architect). R1-m4 applies only if the runner stays.
4. Security record `PR-0027-*.md` on the final head; lane A green on that exact head (`scans`, `ci-gate`).
5. Squash merge. Round 2 is a delta review of the fix commit(s).
6. Orchestrator / architect: the ADR-0007 amendment request is justified as "levers to evaluate", but item (b) (hot-tenant sub-streams) changes chain semantics, so it should not be pre-selected on this evidence. Whichever of PR #24 and PR #27 merges second must not leave `spk08/*` or `spk04/*` references dangling (check with a grep for `spk08Dir` / `spk08/` on the merge tree).
7. Routed (not blocking): the clean 300 rps `audit-ab` re-run (quiet or Linux host, randomised arm order, >= 5 repetitions, hold-time measurement, `pg_stat_statements` round trips, batched token-SELECT EXPLAIN) -> TASK-280; NFR-AUDIT-005 method wording -> principal-architect / product-manager; data-model §5.4 step 3 text (`decode(...)`) -> principal-architect + TASK-021/030.


---

## Round 2 (head a5cfd4b)

| Field | Value |
|---|---|
| Head reviewed | `a5cfd4ba91faf451d4c494f6406da51f3983be15` (code `ce58e8d`; docs `b13a6d6`; evidence `a5cfd4b`; merges `a425bab`, `935550d`) |
| Reviewer | code-reviewer (read-only; probes on a scratch `git archive` extract with a node_modules junction, removed afterwards; worktree untouched) |
| Date | 2026-11-13 |

VERDICT: **APPROVED_WITH_NITS**

SUMMARY:
- Both r1 MAJORs are resolved. The harness now applies the real `prisma/bootstrap` lane through `runBootstrap`, fixture 20 and every `spk08` reference are gone from the PR tree, and the tripwire is meaningful (every realistic mutation fails the unit test; one prefix-match weakness is a nit). The integrity step fails closed end to end, and the product-state assertions are right against `10-audit.sql` / `90-audit-ddl-guard.sql`.
- The R1-M2 rewording is accurate against the artefacts. I re-checked the corrected CPU attribution against both `k6-audit-ab.summary.json` files and every per-arm `docker stats` value matches. One residual misattribution of the same kind remains (Postgres "1.3 to 1.9 cores in the `on` arms"); it is a MINOR text fix, not a blocker.
- Merge is blocked only by process items already known to the orchestrator: the merge-only security record for the new head (lane A `scans`/`ci-gate` red on that one step) and lane A green on the final head.

### R2.1 What I verified myself, and what I did not

| Check | Result |
|---|---|
| Head, PR state | `headRefOid` = `a5cfd4b`. `fast-lane` SUCCESS. `scans` FAILURE, its only failed step is "Security-owned paths need a review record (PR5-SEC-04, PR10-SEC-04)". `ci-gate` FAILURE at "Aggregate lane A" (follows from `scans`). Matches the dispatch. |
| Unit tests on an extract of `a5cfd4b` (`jest prisma/tests/spikes/spk04 --selectProjects unit`) | 4 suites, 45 passed (matches the PR body "45 SPK-04 tests in 4 suites"). |
| Heavy-lane evidence `20261113T1042Z_b13a6d6` | `git_sha` = `b13a6d6`, `git_dirty` false, verdict PASS (unit 2 843, integration 219, api 81, catalog 67). Only `SPK-04.md` and `DECISIONS.md` differ between `ce58e8d` and `b13a6d6`, so the run covers the final code. The unit JUnit contains the tripwire (14 cases) and the fail-closed cases (4). |
| Tripwire mutations (extract, one at a time, `paths.test.ts`) | Delete `bootstrap/90-audit-ddl-guard.sql`: 2 fail. Delete `tests/load/spikes/spk04-audit.js`: 1 fails. Delete one `migrations/*/migration.sql`: 1 fails. Delete `apps/api/src/platform/db/runtime.ts`: 1 fails. Add `apps/api/src/zz/a.ts` importing `spikes/spk04/chain.js`: the import-scan test fails. Add `packages/shared/src/zz.ts` mentioning `SPK04_AUDIT`: fails. Rename the CREATE TABLE of `audit_pii_vault` to `audit_vault_renamed`: fails. All restored; baseline 14/14. One weak match, see R2-n2. |
| Every runner read path goes through `paths.ts` | `runner.ts` uses `paths.bootstrapDir`, `migrationsDir`, `businessFixture`, `serverEntry`, `k6ScriptDir`; the remaining `join(...)` calls are the temp work dir and the output dir. `server.ts` reads only the seed file named by env. No `spk08Dir`, `spikeDir` or `20-spk04` reference is left in the PR tree. `runBootstrap` is called through `PlatformPostgres.bootstrap(DB, dir)` (`harness/postgres.ts:107-108`), which passes the whole `prisma/bootstrap` directory. |
| Fixture 20 | Deleted. `fixtures/30-spk04-business.sql` creates only `spk04_orders`; the test asserts it holds no `audit_*` / `data_subjects` DDL. |
| No product import of the harness | The tripwire scan (apps + packages, regex `spikes/spk04\|spk04-audit\|SPK04_AUDIT`) passes at head and fails on both injected offenders. `jest.config.ts` `collectCoverageFrom` covers only `{apps,packages}/*/{src,app}` and `prisma/seed`, so the harness counts toward no coverage. |
| Product-state assertions against the real SQL | `10-audit.sql:273-301`: every audit trigger is `ENABLE ALWAYS`; `90-audit-ddl-guard.sql:174-178`: exactly two event triggers, both `ENABLE ALWAYS`, matching `eventTriggers.length === 2` and `'A'`. No `ROW LEVEL SECURITY` statement in `10-audit.sql`, matching "no RLS on `audit_entries`". Vault key-id CHECKs at `10-audit.sql:195,228,230` are `^[a-z][a-z0-9-]*-v[0-9]+$`; `server.ts` now uses `spk04-<replica>-v1`, which matches. `spk04_orders` ENABLE + FORCE comes from fixture 30. |
| Fail closed | `verdict.ts`: `integrityFailures` flags an `error` entry, a missing check, and `ok !== true` (so `'yes'` fails); `finalVerdict` overrides all four verdicts with `INTEGRITY_FAILED`. `INTEGRITY_CHECKS` (`chain, immutability, triggers, rls, partitions`) equals the keys `integrity()` returns (renamed `forceRls` to `rls` consistently). `runner.ts` writes the evidence first and then sets `process.exitCode = 1` (cleanup in `finally` still runs). `immutabilityOk` requires `entries > 0` and `Number(vault) > 0` (`NaN > 0` is false, so an undefined count also fails). Empty vault or entries therefore fail closed. Four unit tests cover pass, throw, not-ok/missing and INCONCLUSIVE preserved. |
| Lifecycle table and headers | SPK-04 §8 lists every remaining file with a deleting task (TASK-030: `canonical*`, `chain*`; TASK-280: `server`, `runner`, `verdict*`, `paths*`, fixture 30, k6 script). The header of each file carries the same task and the "nothing under apps/** or packages/** may import" rule. D-TASK018-02 item 6 and D-TASK018-06 agree with the table. |
| `eslint.config.mjs` | `git diff 7be7375 HEAD` = the same +6 lines as r1 (the k6 block: `files`, `globals`, `import-x/core-modules`; no rule change). The only delta against `aa1cfb1` is main's removal of the SPK-08 exemption (-3, PR #24). |
| Merges `a425bab`, `935550d` | Re-merge (`git merge-tree`) differs from each merge only in `docs/sdlc/DECISIONS.md`, a both-sides append. `git diff d53fbc7 HEAD -- DECISIONS.md` is +67 / -0: main's text is untouched, only D-TASK018-01..06 are added. No other file differs. |
| `main` moved to `a789a40` after the last merge | The two newer main commits touch only `docs/sdlc/STATUS.md` and agent-memory files. No overlap with this PR's files, so no further merge of main is needed. |
| Commit headers | `ce58e8d` and `6f62db4` are 101 characters. Squash merge makes this moot; the PR title (`test(perf): spk-04 audit write throughput spike (TASK-018)`, 58 chars) passes commitlint locally and in CI (`ci.yml` lints the title because merges are squash with an explicit subject). |

Not re-run (per the dispatch: no Docker, memory-limited): the benchmark, the harness smoke (relied on SPK-04 §7 and D-TASK018-06; I cross-checked the two things the smoke is said to have established statically, the key-id CHECK and the `'A'` / no-RLS state, against the SQL), full `test:unit`, build, lint, format, typecheck, coverage (relied on CI `fast-lane` SUCCESS and the heavy-lane run on the identical code). A local prettier run crashed in this environment and gave no result; format is covered by `fast-lane`.

### R2.2 R1 follow-up closure

| r1 ID | Status | Evidence |
|---|---|---|
| R1-M1 harness vs PR #24 | **Resolved** | Real bootstrap lane via `runBootstrap`; fixture 20 deleted; tripwire (mutation-proven above); lifecycle with named deleting PR per file; PR #24's `spk08` deletions are consistent with the tree. The cross-PR burden I described is gone: nothing here reads `spk08/*`. |
| R1-M2 over-claims | **Resolved** | See R2.3. |
| R1-m1 statistics | Resolved | §2.2 caveat states the budget is also not demonstrated at 150 rps (rep 1 fails both); §6 asks for at least 5 repetitions, ABBA / Latin square, median and range, per-repetition pass; no mean-of-2 recommendation; `verdict.ts` header warns not to copy the pooling. |
| R1-m2 prototype RLS | Resolved | Intro paragraph, §3 rows (c)/(d), §5.2(iv), D-TASK018-04 simplifications; the runner now asserts the product state. |
| R1-m3 round trips | Resolved | "counted by the harness's own instrumentation" in §1, `server.ts` header, D-TASK018-04; `pg_stat_statements` moved to TASK-280. |
| R1-m4 fail-open integrity | Resolved | See the fail-closed row above. |
| R1-n1 | Accepted as not done | The block is in a security-owned file; a comment edit would void the record for no gain. |
| R1-n2, n3, n4, n5 | Resolved | `canonical.ts` header ("exact for well-formed strings"); both RAM values quoted; `dirty` explained in §7; D-TASK018-02 item 6 amended. |

### R2.3 R1-M2 rewording against the artefacts

I re-extracted `dockerStats.CPUPerc` from both `k6-audit-ab.summary.json` files.

- 300 rps: rep 1 off 53.88 %, on 144.05 %, batched 195.14 %; rep 2 off 43.10 %, on 134.39 %, batched 105.68 %. SPK-04 §2.1 states 54 / 144 / 195 / 43 / 134 / 106. Match.
- 150 rps: `on` 95.15 % / 61.59 %, `batched` 66.97 % / 114.43 %. §2.2 states 95 and 62 for `on`, 67 and 114 for `batched`. Match.
- The invented "0.26 cores each / 0.5 cores (54 %)" sentence is gone; the doc now says there is no per-process series for the replicas and the app-tier headroom is not established. Correct.
- Pooled figures in §2.1 (+1 513 / +2 008 on, +951 / +1 327 batched) equal the means of the per-repetition deltas and `summary.md`. Invalidity count (10 reasons: 4 dropped, 6 CPU) equals the recorded verdict string.
- Hot-lock figures, per-arm tables and the 150 rps validity column are unchanged from r1 and still match `summary.json`.
- Vocabulary: SPK-04 header, §4, §6, D-TASK018-01 and the PR body all say "exit NOT DEMONSTRATED: INCONCLUSIVE", "R-ARCH-04 not retired", no GO / FALLBACK / FALLBACK-INSUFFICIENT claimed. Remaining occurrences of "FALLBACK" are the sheet vocabulary note and the `batched` specification heading (§5.2), and "confirmed" appears only as "not confirmed". No "exit not met" or "R-ARCH-04 confirmed" text is left in the PR's docs.
- The round-trips x RTT model, the 7.5 ms vs about 15 ms discrepancy, the 3-round-trip budget as a hypothesis, "batched cannot be ranked" and the EXPLAIN precondition are all present in SPK-04 §4/§5 and D-TASK018-01/-04, and the TASK-280 scope (hold time, WAL share, `pg_stat_statements`, randomised order) is in §6.

### R2.4 New findings

| ID | Severity | Where | Problem | Fix |
|---|---|---|---|---|
| R2-m1 | MINOR | SPK-04.md §2.1, sentence after the CPU list ("Postgres at 1.3 to 1.9 cores in the `on` arms") | Same class as r1 M2(a), much smaller. The `on` arms recorded 144 % and 134 % (1.3 to 1.4 cores); 195 % (1.9 cores) is rep 1 `batched`. The range is stretched by an arm the sentence is not about. The conclusion ("cannot be ruled out as a contributor") is unaffected. | Edit text: "about 1.3 to 1.4 cores in the `on` arms (1.9 in rep 1 `batched`)". Can be done in the same commit as the security record or in the squash body; not a re-run. |
| R2-n1 | NIT | SPK-04.md §2.2, "(§5.3, F-4)" | Stale cross-reference: the plan check is §5.4 (§5.3 is pool coupling); "F-4" has no referent in the doc. | Replace with "(§5.4)". |
| R2-n2 | NIT | `paths.test.ts:59-63` | `toContain('CREATE TABLE public.audit_pii_vault')` is a prefix match: a table renamed `audit_pii_vaultX` still passes (I confirmed). A real rename to an unrelated name fails, so the tripwire still works for the realistic case. | `expect(audit).toMatch(new RegExp(\`CREATE TABLE public\\\\.\${table}\\\\s*\\\\(\`))`. Optional; TASK-280 deletes the file. |
| R2-n3 | NIT | `runner.ts` `integrity()` chain block | `chain.ok` is true with zero streams / entries (nothing to fail). The empty case is caught only through `immutabilityOk`, so the reported reason would be "immutability: not ok", which misleads. Still fail-closed. | Optional: `ok: failures.length === 0 && entries > 0 && recomputed === entries && uniq...`. |

No BLOCKER or MAJOR. R2-m1 is a text-only MINOR.

### R2.5 Good

- The developer smoke-ran the harness against the real lane despite having no CI to catch it, and that smoke found a genuine constraint break (vault key ids) which the new fail-closed integrity step itself reported as `INTEGRITY_FAILED`. This is the evidence that the fail-closed design works, and it is recorded honestly (first smoke failed, second passed).
- The tripwire is the cheap form I asked for and it rots loudly: path existence, a content assertion on the real DDL, and a product-import scan, all in the unit lane.
- The product-state assertions (`'A'`, no RLS on `audit_entries`, ENABLE + FORCE on the tenant table) are asserted as product facts and the recorded values are labelled as the prototype's; the recorded evidence was not edited.
- The evidence stays unchanged and the harness commit `c037470` is named as the producer, so the numbers remain reproducible by reference.
- The PR body, SPK-04 and D-TASK018-01..06 use one vocabulary.

### R2.6 Security flags (for security-analyst; merge-only round)

- `eslint.config.mjs`: PR delta vs main is the same +6 lines as the reviewed record (`PR-0027-TASK-018-security-review.md` names `aa1cfb1`). The merge changed the file's base (PR #24 removed one exemption). A record naming `a5cfd4b` (or its record-bearing successor) is required for `scans` to go green. No rule weakening found.
- Harness-only items carried in SPK-04 §8 to TASK-280 (unauthenticated loopback `POST /__reset`, `SPK04_BIND` override, whole-environment pass-through, container flags for k6) are unchanged and still disclosed; `server.ts` still passes the environment to the replicas. Not product code; no new exposure in this cycle.
- Fixture 20 (audit DDL without the rule-12 marker) is deleted, which closes that flag.

### R2.7 Merge conditions

1. Security-analyst appends the merge-only record for the final head to `docs/05-quality/security/PR-0027-TASK-018-security-review.md`; `scans` and `ci-gate` green on that exact head. (Docs-only commits after `b13a6d6` keep the heavy-lane evidence valid, as at `a5cfd4b`.)
2. R2-m1: correct the "1.3 to 1.9 cores in the `on` arms" sentence (and ideally R2-n1) in the same record-bearing commit. If the orchestrator prefers not to add another commit, route it to the squash body and to TASK-280's reading list; it does not change any verdict or number.
3. Squash merge with the linted PR title as the subject (`gh pr merge 27 --squash --match-head-commit <sha> --subject "<linted subject>"`).
4. After merge: the lifecycle rows of SPK-04 §8 become tracked deletions (TASK-030: `canonical*`, `chain*`; TASK-280: the rest). TASK-280's sheet should list them so the deletion is a DoD line, not a memory.
5. Routed, unchanged from r1 §6 item 7: the clean 300 rps `audit-ab` re-run and measurement scope to TASK-280; NFR-AUDIT-005 method wording and data-model §5.4 step 3 (`decode(...)`) to principal-architect.
