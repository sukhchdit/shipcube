# Code review: PR #43, TASK-024 (generated cross-tenant isolation suite, RLS generator), round 1

- **PR:** https://github.com/sukhchdit/shipcube/pull/43, branch `feat/TASK-024-generated-cross-tenant-isolation-test`
- **Head reviewed:** `8ac271d` (evidence commit). The code head is `4513512`. Merge base with main is `201d8d9`.
- **Reviewer:** code-reviewer (round 1), 2026-11-14
- **Inputs:**
  - the TASK-024 card (WAVE-00.md:956)
  - US-077
  - D-ARCH-071/072/077/078/091/093/099
  - data-model §4.3, §4.6 C3/C15, §7.6, §8.3/§8.4
  - the PR body, including D-TASK024-01..11
  - evidence run `20261114T0257Z_4513512`
  - lane A run 43550500753

```
VERDICT: CHANGES_REQUESTED
SUMMARY: Strong generator, DR-A14, C15 and linter work. 43 of 43 mutants were killed and every planted control is real.
  Two MAJORs:
  (M1) The new BEGIN-depth tracking in splitStatements lets one word (`begin` as a parameter, column or function name)
  swallow the rest of a migration. That silences rules 2/8/9/11/11c/14/17, a regression of a security gate.
  (M2) The API-level enumeration leaves out `guest` routes (getQuote) and accepts a bare operationId as a "case".
FINDINGS: 2 MAJOR, 6 MINOR, 6 NIT (table in §3)
```

## 1. What I verified myself

Constraints: read-only, no Docker, light commands only. Every Node command ran on Node 24, using the fnm prefix.

| Check | Result |
|---|---|
| Lane A on the exact head (run 43550500753, headSha `8ac271d`) | `fast-lane` success. Every step executed: lint, format, type-check, unit, build, negative fixtures from the base ref. `scans` is red at one step only, "Security-owned paths need a review record" (expected). `ci-gate` is red only because it aggregates `scans`. |
| Targeted unit suites on the head: `render-rls-dr-a14`, `generator`, `lint-migrations`, `sql-text`, `tenant-key-forms`, `up-down-up`, `grants-manifest`, `render-rls`, `table-classes` | 351 passed, 0 failed |
| Jest project membership (`--listTests` per project) | `generator.test.ts` and `render-rls-dr-a14.test.ts` are in `unit`. `cross-tenant.int.test.ts` is in `generated` only. `c15` and `up-down-up.int` are in `integration`. No file is in two projects. |
| **Mutation testing** in an archive copy of `4513512` with a node_modules junction (37 + 6 mutants, one line each) | **43 of 43 killed** (1 skipped: anchor not unique). Covered: generator g1-g10; linter l1-l16 (11c, rule 17 including the ALTER half, the `RULE_17_RELEASED` extra entry, the set_config role and lock_timeout halves, BOOLEAN_TRUE, the quoted name, rules 18/19, the allow-list, MAINTAIN, schema scope, the bootstrap E-string); sql-text s1-s5; grants m1; render r1/r2/r4; table-classes t1/t2; up-down-up u1-u6. |
| DR-A14 against the doc | The unit test reads the data-model §4.3 fence. The 9 policies are equal after whitespace normalisation (`render-rls-dr-a14.test.ts:69`). |
| `std-columns-guard.sql` against data-model §7.6 | Identical code. They differ only in the inline `--` comments of the design copy (normalised diff). |
| C15 cost figures | Arithmetic checks: (137.2 - 37.6) / 10 000 = 9.96 µs/row and (244.2 - 60.5) / 10 000 = 18.4 µs/row. The JUnit time of the cost test (2.18 s and 2.43 s) fits 4 × 10k-row statements × 3 rounds. The numbers come from a dev run: `reports/*.json` is git-ignored and is not in the evidence (see m6). |
| Guard share | (2.554 - 2.418) / 2.554 = 5.3 %. The arithmetic is consistent. Five migrations, so Prisma CLI start-up dominates the measurement (stated in the PR). |
| Prefix pins | Read against the files. `authz_catalogue_tables` creates permissions, roles, role_permissions in that order, and down.sql drops role_permissions first, so prefixes 1 and 2 give 42P01. `platform_rls_helpers` creates org, actor, guest_hash, and down drops guest_hash first, so prefixes 1 and 2 give 42883. Exactly 4. The list is tied to `RULE_17_RELEASED` in the test. |
| `RULE_17_RELEASED` exactness | Main has 5 migrations. Only the 3 listed have a bare `DROP` in down.sql (baseline and authz_seed_v1 have none). The renamed-copy test proves each still needs the exemption. Mutant l6 (a 4th entry) is killed. |
| `policies.snapshot.json` deletion | On main the file was `[]`. Nothing that was pinned is lost. The derived C3 is strictly stronger (a policy on an unlisted table, an edit or an addition breaks equality; planted controls). |
| ESLint `tests/generated/rls/**` ignore (D-TASK024-03) | Lint probe in the copy. `tools/db/../../packages/...` is refused. `prisma/tests/catalog` is refused. `prisma/tests/harness` and `tools/db` are allowed. The same imports from another `tests/generated/` folder are all refused. Narrow and anchored, but unpinned (n3). |
| Linter probes (tsx against the worktree, no writes) | P1 swallow → R1-M1. Rule 11 CTE/VALUES → m1. `EXECUTE function;` → m2. Escape-string nesting depth → n1. The set_config role flag composes with rule 16: computed keys (`'ro'\|\|'le'`, `$k$role$k$`) trip the rule 16 setter form, literal keys trip rule 15, so the flag is correct. |
| Unions | `git merge-tree` of the head with each of #39, #40, #42 and main is clean. The #42 eslint hunks (TENANT_CONTEXT_EXEMPTIONS +prisma-store, boundaries `package-audit` / `prisma-tests-audit`) do not touch #43's. The #39 migrate image COPYs `tools/db/sql-text.ts`, and #43 adds no import to it. No open PR adds a migration or bootstrap SQL, so the new rules have no semantic hits. |

**Not re-run:** the `generated` suite (92 tests) and the integration/catalog suites. They need Docker. For catalog-c1-c14 (96), integration (285/1 skip) and api (123) I relied on the committed lane-B evidence. For the generated suite, the developer's single green run is unevidenced (m5).

## 2. Assessment against the focus list

1. **Probe coverage.**
   - 11 table probes, plus 7 guest probes for GUEST_CAPABLE tables. They cover every RLS class plus the three DR-A14 sets, including C12 (i)-(iv) and the PR7-SEC-04 de-claim.
   - Fail-closed behaviour:
     - an unlisted public table is named (`enumerationFindings`);
     - a listed table that is missing is named;
     - a GUEST_CAPABLE table without its trigger is named;
     - a leaking policy fails 6 probes (mutation control);
     - the committed layer is **not vacuous**: it enumerates every public table (authz and platform tables included), so a table added without a manifest line is a finding;
     - lint rule 9 also catches it in lane A.
   - The operator scope (SEC-TC-06) is covered by forced-operator plus the SELECT-only policy shape. A genuine-operator positive control is missing (n5).
   - Gaps: schemas other than public (m4), and the probe DDL collision at TASK-037 (m3).
2. **API-level enumeration.**
   - The first `tenant`/`user` route with a path parameter fails (unit mutant g4, plus the int test on `moduleRegistry`).
   - **But** `guest` routes are excluded, and registering a route means adding a string → **R1-M2**.
3. **DR-A14.** Equal to the doc. Atoms are admitted only in their own template. Every forbidden token stays refused inside EXISTS (9 mutation rows). The loader and the renderer both check name and class. Sound.
4. **std_columns_guard + SEC-TC-74.** Verbatim. The render-time property checks are tested (4 of 5 mutants; the SECURITY DEFINER anchor was not unique). The C15 forgery matrix (9) and the positive controls are in the evidence JUnit. The cost numbers check (§1).
5. **Linter.**
   - E-string refusal is token-level and correct for every lookalike in the fixtures. Fail-open at nesting depth 5 (n1). Non-ASCII false positive (n2).
   - The set_config role flag is correct (probe).
   - The dynamic-SQL allow-list is empty, so not broad. Its detector has a bypass (m2).
   - `RULE_17_RELEASED` is exact.
   - 11c is correct per statement, **but the splitter change that 11c relies on is R1-M1**.
6. **C3 derived.** Sound. Deleting the snapshot weakens nothing.
7. **`runtimeReadOnly` on SYSTEM.** Sound. It is enforced through `validateGrants`, and C5 compares the live ACLs with the manifest, so a dodge flag cannot be set without losing the write grant.
8. **Prefix check.** The four pins are exact and tied to `RULE_17_RELEASED`. Six driver mutants are killed.
9. **eslint.config.mjs.** Narrow and correctly anchored (probe). Unpinned (n3).
10. **Test quality.** Excellent: 43 of 43 mutants killed. The int suites assert positive controls next to every negative.

## 3. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| **R1-M1** | **MAJOR** | `tools/db/sql-text.ts:170-209` (splitStatements) | **One word swallows the rest of a migration.**<br>• Mechanism: inside any `CREATE FUNCTION/PROCEDURE` statement, every `begin` or `case` word after the first word opens a block, at any parenthesis depth and with no `ATOMIC` required. A routine whose head contains the unreserved keyword `begin` never closes the block: a parameter (`f(begin integer)`), a `RETURNS TABLE (begin timestamptz)` column, or a function named `public.begin()`. Every later `;` is then swallowed.<br>• Probe on the head, after `CREATE FUNCTION public.f(begin integer) … AS $$ SELECT 1 $$;`: `ALTER TABLE public.roles DROP COLUMN name`, `GRANT TRUNCATE … TO platform_app`, `CREATE SCHEMA evil`, `CREATE RULE`, `CREATE TABLE public.unlisted_widgets (…org_id…)`, `SET lock_timeout='10s'; BEGIN; RESET lock_timeout; ROLLBACK;` all lint **clean**. The control (parameter renamed `b`) gives rule 2, 8, 9, 11 and 14 findings. down.sql is swallowed too (rule 17 and 11c).<br>• An EOF-depth check is not enough: a later `END;` (accepted by PostgreSQL as a no-op COMMIT) resyncs the depth, so `…; GRANT TRUNCATE …; END; CREATE SCHEMA s` splits into 2 statements and the GRANT is hidden inside the first.<br>• On main, splitStatements split on every `;`, so this is a regression introduced by the PR in a security gate. The JSDoc claims psql parity and that "a stray word elsewhere can never swallow the rest of a file". psqlscan.l counts only at `paren_depth == 0` and counts CASE only inside a BEGIN block.<br>• Outcome controls cover only part of this: C5 grants, C1 for public, C11. Rules 2-7 (destructive DDL in expand migrations), rule 11 (lock_timeout persisting into later files), 11c, 14 (schemas) and 17 have no catalog backstop. | 1. Open a block only on `BEGIN` immediately followed by `ATOMIC`, at parenthesis depth 0, in a routine statement. Inside an open block, count `BEGIN`/`CASE` up and `END` down, as psql does.<br>2. Fail closed: a file that ends with depth > 0 throws `SqlLexError`, which the linter reports.<br>3. Add fixtures, each showing that the trailing hostile statements are still split and flagged: a parameter named `begin`, `RETURNS TABLE (begin …)`, a function named `begin`, the `END;` resync case, `CASE` in a `RETURN CASE … END` body, and a real `BEGIN ATOMIC … CASE … END; … END`.<br>4. Correct the JSDoc.<br>5. Re-run the repository lint test and `up-down-up.test`. `shadow-init.ts` and the prefix driver share the splitter. |
| **R1-M2** | **MAJOR** | `tests/generated/rls/generator.ts:246`, `fixtures.ts:13`, `cross-tenant.int.test.ts:331` (D-TASK024-08) | **The AT-US-077-02 mechanism is not fail-closed for what it promises.**<br>(a) `tenantResourceRoutes` keeps only `tenant` and `user` tenancies, and the unit test pins `guest` as excluded. The contract has 3 `guest` routes; `GET /quotes/{quoteId}` and `/quotes/{quoteId}/stream` address GUEST_CAPABLE rows by id. A guest with hash H1, or user A, reading B's quote is exactly the cross-tenant/cross-guest case PR7-SEC-07 targets, and the rbac-matrix design covers "cross-tenant 404 on tenant routes" only (nfr-traceability NT-TENANT-002-a). When the quote task mounts getQuote, nothing fails.<br>(b) `API_CASES` is a `Set<string>`. "Registering a case" means adding an operationId, and nothing is generated or executed for it, so the first tenant route goes green without any 404 probe. The only executed API case is the fixture route. TASK-027 and the module tasks inherit an honour system. | (a) Include `guest`, keep `operator-cross-tenant` excluded with a stated reason, and update the unit test.<br>(b) Make `API_CASES` a `ReadonlyMap<operationId, ApiCrossTenantCase>`, for example `{ table, params: { <pathParam>: 'id' \| <column> }, credential: 'session' \| 'quote-token' }`. The suite then generates and executes each one: mount `moduleRegistry` via createApp on the real runtime, fill the path from B's seeded plan of `table`, expect 404 `NOT_FOUND` with no B data, plus A's positive control. A registered entry whose table has no plan fails.<br>Acceptable alternative (orchestrator ruling): bind registration to an executed cross-tenant row of the rbac-matrix, checked by reading the generated case list, with the TASK-027 AC naming it. Either way, a bare string must not satisfy the gate. |
| R1-m1 | MINOR | `tools/db/lint-migrations.ts:345` | The rule-11 setter-key half misses literal-key forms. The `^select` anchor means `WITH s AS MATERIALIZED (SELECT set_config('lock_timeout','0',false)) SELECT * FROM s;` and `VALUES (set_config('lock_timeout','0',false));` lint clean (probe). The plain `SELECT` form, `is_local => false` and `NOT true` are flagged. Rule 16 exempts non-app literal keys, so nothing else sees these forms. | Drop the `^select` anchor: apply `TOP_SET_CONFIG` to every top-level statement that is not a routine definition (bodies are already blanked). Add WITH and VALUES fixtures. |
| R1-m2 | MINOR | `tools/db/lint-migrations.ts:582` | The rule 16 dynamic-SQL detector can be bypassed with `DECLARE function text; … EXECUTE function;` (also `procedure`; both are unreserved). The lookahead meant for `EXECUTE FUNCTION` exempts it (probe: clean; `EXECUTE v;` is flagged). The catalog `\mexecute\M` scan backstops stored plpgsql, so only the lint half is open. | Test only the routine's dollar body (`literalBody`) with a bare `\bexecute\b`, mirroring the catalog regex. `EXECUTE FUNCTION` and `GRANT EXECUTE` cannot occur as body code outside strings. Add a fixture. |
| R1-m3 | MINOR | `tests/generated/rls/probe.ts:41-53,75`; `prisma/tests/catalog/c01-c12.int.test.ts:507` | **Breaks at TASK-037.** `DR_A14_DDL` is all-or-nothing: it creates and grants organisations, memberships and users whenever any DR-A14 probe remains. TASK-037 lands organisations and memberships (not users), so `PROBE_ENTRIES` still holds `users`, the DDL re-creates the real tables, beforeAll fails with 42P07 and all 92 tests fail. The suite runs in no lane (m5), so TASK-037 will not see it, and its card ("Catalog adaptation") does not mention `tests/generated/rls/probe.ts`. The C3 DR-A14 test's `CREATE TABLE public.users` has the same problem at TASK-049. This contradicts D-TASK024-01 ("never collides with the real ones"). | Key the DDL and grants per planted table (a map by entry name) and plant only what `PROBE_ENTRIES` holds. Add a unit assertion that the DDL names exactly the planted tables. Guard the C3 `users` table the same way. Orchestrator: add a line to the TASK-037/049 cards. |
| R1-m4 | MINOR | `tests/generated/rls/database.ts:80`; `prisma/tests/catalog/c01-c12.int.test.ts:121-134` | Card AC: "C1 and rule 9 cover every non-system schema or assert that `platform` holds no table". Only the lint half shipped (rule 9 schema scope). C1, C2, C3 and the generator's `readLiveTables` remain `public`-only. A table in `platform` or another schema is invisible to all four. Ways to create one include DDL inside DO/EXECUTE, the R1-M1 swallow, or the bootstrap lane. | Add a catalog assertion: no relation of relkind r, p, f, v or m in `USER_NAMESPACES` outside `public` (plus a planted, rolled-back `platform.t` control). Make `readLiveTables` read every user namespace and report non-public tables as findings. |
| R1-m5 | MINOR | PR body "Activation"; `tools/quality/suite-runners.json`; DoD | The deliverable suite runs in **no CI lane**. It has one green dev run and no JUnit, and DoD "flake < 1 % over 20 runs" is not measured (D-TASK024-10). Even so, US-077 is marked "completes", and AT-US-077-03 says "CI fails if it is skipped". The PR text is also wrong: `generated` **is** in heavy.mjs `JEST_PROJECTS` (:86, since PR #34). The real gap is a `suite-runners.json` entry plus `status: active`. | Orchestrator ruling. Either this PR adds the `rls-cross-tenant` runner entry plus `active`, with `min_tests` 92 and a fresh lane-B run (qa-lead co-sign), or the qa-lead activation PR merges **before TASK-037**. Record at least 3 consecutive `-i` runs as interim flake evidence, and correct the PR text. |
| R1-m6 | MINOR | `c15-std-columns-guard.int.test.ts:392`; `up-down-up.int.test.ts:250` | The "recorded, not asserted" numbers (C15 per-row cost, D-ARCH-093 guard share) go to git-ignored `reports/*.json`, which no gate, summary or evidence reads. The D-ARCH-093 trigger ("> 25 % or > 60 s in CI → open the ceremony") and the D-ARCH-091 25 µs reopen threshold therefore have no observer after this PR. | Have heavy.mjs attach both JSON files to the lane-B run (`summary.json` attachment), or print one structured line that the summary captures. Route to qa-lead (015-B/C) if not done here. |
| R1-n1 | NIT | `tools/db/sql-text.ts:229-247` | `containsEscapeString` returns clean below `MAX_NESTED_SQL_DEPTH` (probe: an E-string nested 5 levels deep gives `false`). Fail-open, the same class as PR #24 n1. Rule 16's setter form still catches E-string keys inside `set_config`. | At the cap, return `true` when a string or dollar token is still present (fail closed). |
| R1-n2 | NIT | `tools/db/sql-text.ts:21,82` | E-prefix detection uses ASCII `IDENT_CHAR`. `éE'\'; SELECT 2; --'` is marked as an E-string, and its backslash escape desyncs the tokenizer for the rest of the text. Today this fails closed (flagged), but it is a lexing bug. | Include `\u0080-￿` in the identifier class used for the prefix check, as `CODE_PIECE` already does. |
| R1-n3 | NIT | `eslint.config.mjs:705-717` | The new anchored ignore is correct (probe) but no negative-fixture row pins it. | Add rows like PR21-SEC-09: the traversal after `tools/db/` fails, `prisma/tests/catalog` fails, the harness and `tools/db` pass, another `tests/generated/` folder fails. |
| R1-n4 | NIT | `tests/generated/rls/generator.ts:146` | `insert-foreign-key` expects 42501 whether or not the INSERT privilege is held. When it is held, the title promises a WITH CHECK refusal, but a privilege refusal would pass as well. | When `INSERT` is held, also assert the "row-level security" message marker. |
| R1-n5 | NIT | `tests/generated/rls/probe.ts` / `cross-tenant.int.test.ts` | There is no genuine-operator positive control. Forced-operator proves only the non-operator side, and `operator-policies-select-only` is a shape check. | On the probe layer, plant an OPERATOR org with an ACTIVE membership: SELECT of B returns 1 and UPDATE of B affects 0 (T-36 behaviourally). |
| R1-n6 | NIT | `generator.ts` JSDoc; `lint-migrations.ts` rule 17 | (a) The route enumeration is path-parameter only. Body and query references (IDOR) belong to the `abuse` suite (SEC-TC-15); say so. (b) Rule 17 does not see `ALTER TYPE … DROP ATTRIBUTE` / `ALTER DOMAIN … DROP CONSTRAINT`, which have IF EXISTS forms. This is outside the AC wording; mention it in the header. | Documentation only. |

## 4. Rulings on the PR's decisions

| Decision | Ruling |
|---|---|
| D-TASK024-01 (two layers) | Sound, conditional on R1-m3: the "never collides" claim is false at TASK-037 until the DDL is per table. |
| D-TASK024-02 (production `CONTEXT_STATEMENT_SQL`, no new exemption for the suite) | Sound. Good practice: the suite exercises the runtime statement. |
| D-TASK024-03 (tsconfig listed files, anchored eslint extension) | Sound and narrow (probe). Pin it (n3). |
| D-TASK024-04 (`runtimeReadOnly` on SYSTEM too) | Sound. `reference_dataset_versions` is SELECT-only (D-ARCH-075). Enforcement goes through `validateGrants`, plus C5 live ACL equality. The card says GLOBAL; this is a strict superset. Accepted. |
| D-TASK024-05 (`stdColumns` manifest flag, C15 equality) | Sound. |
| D-TASK024-06 (frozen `RULE_17_RELEASED`) | Sound and exact (§1). |
| D-TASK024-07 (missing privilege pinned as 42501) | Sound. See n4 for tightening the INSERT probe. |
| D-TASK024-08 (API_CASES plus routeCaseFindings) | **Not accepted as-is.** See R1-M2. |
| D-TASK024-09 (C3 drops every policy) | Sound. The deleted snapshot was `[]`. |
| D-TASK024-10 (deferrals) | PR24-SEC-06 optional: accepted. PR32-SEC-07 (c) to principal-architect: accepted. Flake measurement: see R1-m5. |
| D-TASK024-11 (row counts in the prefix snapshot; 4 pins) | Sound. |
| Activation proposal (SEC-TC-07 → `required_cases_pending`, owner TASK-051; SEC-TC-73/74 via pending) | Reasonable. qa-lead decides. The text about JEST_PROJECTS must be corrected (R1-m5). |

## 5. Follow-up closure (routed items now delivered)

The following are closed, verified by code, fixtures and mutants:
- PR11-SEC-03 items 2-3 (derived C3, keyed atoms, DR-A14 invariants)
- PR11-SEC-07 (rule 17 and the prefix check)
- PR11-SEC-10 req. 1-5
- PR11-SEC-11 e (lint half only; see R1-m4) and g
- PR11-SEC-14 b (lint and catalog; see R1-m2 for the lint gap)
- PR11-SEC-15 b/d/e (lint and catalog)
- PR11-SEC-16 (E-strings, both lanes)
- PR11-SEC-17 c (setter keys; see R1-m1)
- PR #11 R3-n3 (`set_config` of lock_timeout)
- PR24-SEC-02 (class fix: operators)
- PR24-SEC-05
- PR24-SEC-11 (11c)
- PR26-SEC-03 (C15 mechanism)
- SPK-08 F-04/F-11 (rules 18/19)
- PR #12 R2-m1 (rule 19 requires the WHERE)
- PR #24 R2-n2 (guard share recorded; see R1-m6)

## 6. Merge conditions

1. R1-M1 and R1-M2 are fixed, with the fixtures named above. Round 2 is a delta review: re-run the swallow probe, the CTE/VALUES probe and the `EXECUTE function` probe, and the mutants on the new splitter and the API case runner.
2. R1-m1..m4 are fixed in the PR (preferred), or routed with owner lines that the orchestrator records. R1-m3 must be fixed before TASK-037 starts.
3. R1-m5 has an orchestrator ruling, and the PR text is corrected.
4. A security-analyst record names the final head. This PR touches `eslint.config.mjs`, `prisma/**`, `tools/db/**` and a tsconfig.
5. Fresh lane-B evidence exists on the final code head, and lane A is green on the exact head. **Squash merge.**

**Union notes for whoever merges second:**
- #42 (TASK-025): eslint hunks are disjoint (merge-tree clean). It has no SQL files, so the new linter rules have nothing to flag.
- #39 (TASK-014): the image COPYs `sql-text.ts`, and its imports are unchanged.
- #40: no overlap.
- 020-C: if it adds tenant routes, it needs R1-M2's executable cases.


---

# Round 2 (head 585f163)

- **Head reviewed:** `585f163` (evidence commit). The code head is `9d679f0`. Merge base with main is `c998fae`; main is now at `4a60ca6` (#45).
- **Reviewer:** code-reviewer (round 2, delta after fix cycle 1), 2026-11-14
- **Inputs:**
  - the fix-cycle comment (issuecomment-6874036152)
  - the PR body D-TASK024-12..18
  - evidence `20261114T0725Z_9d679f0`
  - lane A run 43572039629
  - the round-1 probe kit (`review/PR-43-cr/probe1-3.mts`), plus new probes and mutants in `review/PR-43-cr2/`

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: Both round-1 MAJORs are fixed and pinned. The splitter opens blocks only on BEGIN ATOMIC and fails closed (rule L).
  All 55 tracked non-fixture SQL files split identically on main, r1 and head. API_CASES is an executable map, and the runner behaves correctly against a fake server.
  One MINOR residual: a reserved-word label (`AS case`, `t.case`) plus a top-level END resync can still hide statements. Deliberate only; fix cheaply here or route.
FINDINGS: 0 BLOCKER, 0 MAJOR, 1 MINOR (R2-m1), 3 NIT (§R2.3)
```

## R2.1 What I verified myself

Constraints: read-only, no Docker, light commands only. Every Node command ran on Node 24 with the fnm prefix, and test paths were passed before `--selectProjects`.

| Check | Result |
|---|---|
| Lane A, run 43572039629 on `585f163` | `fast-lane` success. `scans` is red at one step only, "Security-owned paths need a review record", because the r1 security record names `8ac271d`. `ci-gate` is red as its aggregate. PR mergeable (UNSTABLE only for that reason). |
| Targeted unit suites on the head (worktree): `tools/db/` (all), `generator.test`, `check-workflow-policy.test`, `scans-dynamic-sql.test` | 17 suites, **655 passed**, 0 failed |
| Round-1 probes re-run on the new splitter (`probe1-3.mts`) | P1 `begin` parameter: 1 → **4** statements, findings 8/14/14, identical to the control. `RETURNS TABLE (begin …)`: 2 statements, 14. Function named `begin`: 2 statements, findings equal the control. `down.sql`: 17 + 11c. `END;` resync: **4** statements (`… GRANT TRUNCATE …` and `END` are separate). P1c: two 11c. CTE and VALUES `set_config('lock_timeout', …, false)`: rule 11. `EXECUTE function;`: rule 16. E-string at nesting 5 and 6: `true` (n1). `éE'\'; SELECT 2; --'`: identifier `éE`, plain string `'\'`, then `; SELECT 2;` (n2). |
| Rule L fails closed (new probe `probe4.mts`) | Each of these gives exactly one `L` finding, with no crash and no silent pass: an unbalanced atomic block in migration.sql, the same in `down.sql`, and an unterminated string. Fixtures cover a bootstrap file too (`bootstrap/unbalanced-atomic`). The down.sql pass still runs when migration.sql is L. |
| **Splitter equality over the repository** (`probe5.mts`: main `c998fae`, r1 `8ac271d` and the head `splitStatements` over every tracked `.sql`) | All **55** non-fixture SQL files split the same way under all three versions: **209 statements**. This is a superset of the developer's 30 files / 170 statements, because it also includes the `prisma/tests/fixtures` and spike SQL. The only differences are the 11 lint fixtures, and each one differs as intended: three throw (`unbalanced_atomic` ×2, bootstrap), the `begin` fixtures go back to main's count, and the atomic CASE control and the query_to_xml atomic fixture stay whole. |
| API case runner driven without Docker (`probe6.mts`: `runApiCase` against a fake HTTP server, session route and dual-mode `[session, quote-token]` route) | Correct route: `[]`. B's name in `detail`: leak named (session, and guest-h2 → G). 403 FORBIDDEN: "expected 404" plus the code is named. Positive control 404: named per credential. A guest route that returns G to H2: 4 problems. `application/json` 404: "not a problem+json". Signature-only route: "no credential kind". `fillPath` with a missing param throws. `distinctiveValues(B)` = id, org_id, name (the shared constants are excluded). Header leaks are not checked (R2-n2). |
| **Mutation testing**: archive copy of `9d679f0` with a node_modules junction, one-anchor replacements with function replacers, baseline green (188) | **35 mutants, 32 killed, 3 survived.**<br>Splitter, 7 of 10 killed: ATOMIC not required; CASE counted outside a block; CASE never counted; EOF throw dropped; nextWord stops at comments; escape cap fail-open; non-ASCII identifier dropped.<br>Survivors: **s2, the paren-depth gate dropped** (R2-n1), and s7 / s10 (the routine-head restriction; parens not reset at `;`). s7 and s10 are equivalent in practice: only SQL that PostgreSQL rejects distinguishes them.<br>Linter, 11 of 11 killed: rule L silent in migration, down and bootstrap; rule 11 back to `^select`; rule 16 function-variable exemption back; string body not read; query_to_xml off; allow-list ignores the digest; rule 7 `ALWAYS` dropped; rule 20 off in both lanes.<br>Generator API enumeration and probe expectations, 10 of 10 killed: guest tenancy dropped; stale case; params mismatch; unpresentable credential accepted; non-RLS case table; quote-token on a non-guest table; non-public relations ignored; re-parent always WITH CHECK; insert as plain 42501 (n4); blind update expects 0.<br>Batch b, 4 of 4 killed: users template re-admits INVITED (suite load refuses it); users atom re-admits INVITED (same); **consistent template + atom pair** (killed by the data-model §4.3 fence test, 3 failing); probe DDL plants every table (R1-m3); `tests/generated/rls/` dropped from `REQUIRED_CODEOWNED_PATHS`. |
| `runApiCase` mutants | Not run: the module has no unit test, and the int suite needs Docker. By reading: the leaky-route mutation control pins all four negative-branch checks (`toEqual` of the exact 4 problems), and the fixture cases pin the positive status on the happy path. A mutant that drops the positive-control check would survive (R2-n2 c). |
| Flake / activation evidence | Committed run `20261114T0725Z_9d679f0` PASS: api 123, catalog 102, integration 291/1, unit 4570/2. Its unit JUnit holds **`coverage merge: generated coverage run` passed**, so the whole `generated` project, including the 126 RLS tests, already ran in lane B as a coverage-only run, and that case fails on any failing test. The 20 × 126 flake runs and the active run `20261114T0643Z_f12c7ba` are uncommitted (developer's evidence). The suite code is unchanged between `253d832` and `9d679f0`: diff over `tests/ prisma/ tools/db/ apps/ packages/` shows only `grants-manifest.test.ts`. |

**Not re-run:** the `generated` suite (126), catalog c01-c12/c15 and the integration suites. They need Docker. For these I relied on the committed lane-B run above and the developer's flake table.

## R2.2 Assessment against the brief

**(a) R1-M1: fixed.**
- The splitter now opens a block only on the two words `BEGIN ATOMIC`, at paren depth 0, in a routine statement. Inside a block it counts only `BEGIN ATOMIC`, `CASE` and `END`. Depth > 0 at the end of the text throws `SqlLexError`, which the linter reports as rule L in all three file kinds.
- The JSDoc is honest that this is a heuristic narrower than psql.
- Every fixture I asked for exists: parameter, RETURNS TABLE, function name (including down.sql), the END resync, `RETURN CASE`, the balanced atomic CASE control and the unbalanced block. 19 of 21 new assertions fail on the old code (developer claim, consistent with my s1/s4/s5 kills).
- The repository splits identically (§R2.1).
- `shadow-init.ts` and `up-down-up.ts` call the splitter directly. A lex error there throws and fails the tool or test, which is fail closed.
- Residual: **R2-m1**.

**(b) R1-M2: fixed.**
- `API_CASES` is a `ReadonlyMap<operationId, ApiCrossTenantCase>`, and the suite's executed list is derived from it by `it.each`. A bare operationId cannot be registered: the type requires `table` and `params`.
- `TENANT_RESOURCE_TENANCIES` = tenant, user and guest. `operator-cross-tenant` is excluded, with the reason stated (cross-tenant by design; SEC-TC-06 and the RBAC matrix cover it).
- `routeCaseFindings` names each of these: a missing case, a stale case, a parameter mismatch, a non-RLS table, quote-token on a non-GUEST_CAPABLE table, and a credential the runner cannot present (`signature`, `refresh-cookie`, `anonymous`). All six are mutant-killed.
- The runner composes `createApp` over the real runtime and swaps only the authenticate slot. A holds every catalogued permission, so a 403 can never pass for isolation.
- The mutation control (a leaking route) fails with exactly 4 named problems.
- No production code changed: `git diff c998fae HEAD -- apps packages` is empty, and nothing outside `tests/` references the probe header or slot.

**(c) Round-1 minors and nits, and the security LOWs that touch code quality.**
- m1 (any non-routine statement), m2 (bare `execute` over the body code), m3 (per-table DDL, unit-pinned, mutant-killed; the C3 tables are created only when `to_regclass` is NULL) and m4 (the generator reads every user namespace; the catalog asserts no r/p/f/v/m relation outside `public`) are fixed.
- m5: the runner entry ships here. The deviation is ruled below.
- **m6 routing: accepted.** It is an observability gap, not a correctness defect, and `heavy.mjs` is owned by qa/devops and changed in #40. The numbers for this run are in the PR body. Condition: the orchestrator records D-TASK024-17 with an owner (qa-lead/devops, 015-B/C) and a due point before G3.
- n1-n6 are fixed (n1/n2 by mutant, n3 by lint probes in negative-fixtures, n4 by mutant g9, n5 as a probe-layer test, n6 as JSDoc).
- Security LOWs, code quality only:
  - PR43-SEC-02 blind/re-parent probes: expectations are mutant-pinned, and the write mutation control is in the int suite.
  - SEC-04 CODEOWNERS: pinned.
  - SEC-05 (a) rule 7: pinned.
  - SEC-06: rule 20, query functions and the name + SHA-256 allow-list are all pinned. One design note: the `routineCode` `catch {}` falls back to scanning the raw text, which is fail closed and acceptable.

**(d) Union with main: pure.**
- `50670f4` (PR #40): `git merge-tree` of its parents differs from the merge only by the conflict markers in `REQUIRED_CODEOWNED_PATHS`. The hand resolution keeps both PR43-SEC-04 and PR40-SEC-01, and CODEOWNERS holds both pairs.
- `64959f2` (docs only): byte-identical to a clean re-merge.
- The head against `origin/main` (`4a60ca6`, #45) merges cleanly. Main's delta since the base is docs, `.gitleaks.toml`, a baseline and one test, with no overlap.
- `tools/quality/required-suites.json` is unchanged against the base, as D-TASK024-16 requires.

**(e) DR-A14 users fence: correct.**
- The template, the `DR_A14_ATOMS['dr-a14-users']` atom, the doc fence (data-model §4.3 line 2560) and the int test (`INVITED` → 0) all read `('ACTIVE','SUSPENDED')`.
- The test reads the doc fence, so a consistent template + atom pair that re-admits INVITED is still killed (e3).
- The organisations list is unchanged.

**(f) No regressions.**
- 655 targeted unit tests pass.
- Mutation results are in §R2.1, with no regression in the round-1 areas.
- Lane A fast-lane is green on the exact head.

**Deviation from D-ORCH-063 (activation is not in this PR): sound.**
- `check-evidence.mjs:23,352` (rule 4) rejects the JUnit of a suite still `planned` in the base manifest, so an activating PR cannot credit its own run. Lane A run 43569499402 shows exactly this. In-PR activation would need a change to check-evidence semantics, which is out of scope and qa-owned.
- The gap is narrower than it looks. The `generated` project already runs in lane B through the merged-coverage step, and a failing test fails `coverage merge: generated coverage run`. What is missing until activation is the credit: `min_tests` 126, the SEC-TC-06 case binding, and suite-level reporting.
- Conditions:
  1. The manifest-only qa-lead PR carries exactly the D-TASK024-16 diff.
  2. It merges **before TASK-037** (R1-m3's consumer) and before the first tenant-resource route merges.
  3. The orchestrator records the D-ORCH-063 amendment.

## R2.3 Findings (round 2)

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| **R2-m1** | MINOR (security-relevant; flag to security-analyst) | `tools/db/sql-text.ts:239-242` (splitStatements block counting) | **A reserved word used as a label still resyncs the depth.**<br>• Grammar: in PostgreSQL a column label after `AS` (`ColLabel`) and an attribute after `.` (`attr_name`) accept *reserved* keywords, so `SELECT 1 AS case` and `SELECT t.case FROM t` are valid inside a `BEGIN ATOMIC` body.<br>• Mechanism: that `case` raises the depth to 2, and the routine's real `END` lowers it only to 1. Everything that follows is swallowed until a later top-level `END;` (a no-op COMMIT) brings it back to 0.<br>• Probe (`probe4.mts`): `CREATE FUNCTION public.f() … BEGIN ATOMIC SELECT 1 AS case; END; GRANT TRUNCATE ON public.roles TO platform_app; CREATE SCHEMA evil; ALTER TABLE public.roles DROP COLUMN name; END;` gives **1 statement and lints clean**. The control without the label gives 8, 14, 2 and 11. The `t.case` form behaves the same, with `COMMIT;` swallowed too.<br>• Without the trailing `END`, rule L fails closed. `AS end` / `t.end` over-split instead, which gives a spurious 11c on a stray `END` statement and is fail closed.<br>• Severity: MINOR, not MAJOR. Innocent code no longer silences the gate. The bypass needs a deliberate reserved-word label plus a visible top-level `END;`, the same "deliberate evasion" class as the stated dynamic-SQL limits. The construct is also the psql heuristic I prescribed in round 1, so this is my recipe's gap.<br>• Backstops: C5 (grants) and the new non-public-relation check. Rules 2-7, 11, 14 and 17 have none. | Inside a block, do not count `case` / `end` when the previous significant piece is `as` or `.`. Track the last non-whitespace, non-comment piece, as `nextWord` already does forwards.<br>Add fixtures:<br>• `atomic_case_label_resync` (`AS case` + trailing `END;` → hostile statements flagged);<br>• `atomic_attr_case_resync` (`t.case`);<br>• `atomic_end_label` (`AS end` → no spurious split; the routine stays one statement).<br>Name the limit in the JSDoc. **Preferred in this PR** (about 5 lines). Otherwise, security-analyst rates it and the orchestrator routes it with an owner due before the first migration that defines a `BEGIN ATOMIC` routine (none exists today: §R2.1, 0 of 55 repository files). |
| R2-n1 | NIT | `tools/db/sql-text.ts:239` | The paren-depth gate (`parens !== 0`) is unpinned: mutant s2 survives. It also narrows R2-m1. A `case` label inside parentheses (`xmlattributes(1 AS case)`, `f(t.case)`) is ignored only because of it. | Add a fixture with a parenthesised `AS case` or `t.end` inside an atomic body, followed by a hostile statement. It must stay split. |
| R2-n2 | NIT | `tests/generated/rls/api-cases.ts:54-65, 95-133` | (a) `callsFor` covers A→B (session) and H2→G (quote-token), but not the cross-direction pairs of a dual-mode route: session A → guest row G, and guest H → B's org row. The DB probes cover both directions (`guest-org-without-hash`, `guest-context-tenant-rows`); the API level does not.<br>(b) The leak check reads the body only, not headers such as `ETag` or `Location`, and drops `instance`.<br>(c) `runApiCase`, `callsFor`, `fillPath` and `distinctiveValues` have no unit test. They are pinned only by the Docker suite, and dropping the positive-control check would survive. A fake-server unit test like `probe6.mts` costs about 1 s and needs no Docker. | Add the two cross-direction calls when the route accepts both kinds (expect 404). Optionally scan response headers. Add a unit test of the runner over a node `http` fake server. |
| R2-n3 | NIT | `tools/db/render-rls-dr-a14.test.ts:68` | The describe title still says "as amended 2026-11-13". The fence is now the 2026-11-14 amendment (D-ARCH-123). | Update the title. |

Closed from round 1: R1-M1 (residual tracked as R2-m1), R1-M2, R1-m1..m4, R1-n1..n6. R1-m5 is closed by the activation ruling above. R1-m6 is routed (accepted, conditional on the owner line).

## R2.4 Rulings on the fix-cycle decisions

| Decision | Ruling |
|---|---|
| D-TASK024-12 (executable cases; test-only authenticate slot; unpresentable credentials are findings) | Sound. Changing only the authenticate slot keeps the production authorise/execute path. See R2-n2 for the cross-direction pairs. |
| D-TASK024-13 (narrower than psql; rule L; rule 20) | Sound, with R2-m1. The data-model §8.3 follow-up (data-architect) should also state the label limit until it is fixed. |
| D-TASK024-14 (allow-lists keyed by name and SHA-256) | Sound. Mutant l8 is killed. Both lists are empty or pinned today. |
| D-TASK024-15 (blind write probes; re-parent follows the first guard) | Sound. Mutants g8/g10 are killed, and the write mutation control is in the int suite. |
| D-TASK024-16 (activation is a manifest-only follow-up) | **Accepted** (§R2.2), with the three conditions. |
| D-TASK024-17 (R1-m6 routed) | Accepted, with an owner and a due point before G3. |
| D-TASK024-18 (routes to TASK-037/051) | Accepted. The orchestrator should add the lines to the cards. |

## R2.5 Merge conditions

1. A security-analyst round-2 record names the final head. Lane A then goes green on that exact head, since `scans` is red only for the record step. **Squash merge.**
2. R2-m1 is fixed in this PR (preferred), or routed with an owner line recorded by the orchestrator, after security-analyst rates it. If it is fixed here, it needs fresh lane-B evidence on the new code head (unit only is enough under the path rules if just `tools/db` changes), and a delta check by me covering the three fixtures and the s2 pin.
3. The orchestrator records the D-ORCH-063 amendment (activation is manifest-only, before TASK-037) and the D-TASK024-17 owner line.

**Union notes for whoever merges second:**
- **#39 (TASK-014): textual conflict** in `tools/ci/check-workflow-policy.mjs`, at adjacent `REQUIRED_CODEOWNED_PATHS` additions, and in `check-workflow-policy.test.ts`, where two adjacent CODEOWNERS describe blocks were added. Git interleaves the hunks of the two describe blocks (`it.each(added)` titles and bodies). Resolve by keeping **both** describe blocks whole: PR43-SEC-04, then PR39-SEC-05, with `added` local to each. Check with `--listTests` that both titles run.
- **#44 (020-C):** `merge-tree` is clean, and the overlap is eslint and lint-fixtures, which are disjoint hunks. Whoever merges second switches the `serve()` value `DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: 15_000` in `cross-tenant.int.test.ts:549` to `TEST_LANE_TX_IDLE_TIMEOUT_MS` (D-ORCH sequencing). If 020-C changes `createApp` / `defaultPipelineSlots`, `serve()` and `probePrincipalSlot` must follow.
- **#42 (TASK-025):** `merge-tree` is clean, and the overlap is disjoint eslint and negative-fixtures hunks.
- **#41 and #16 (dependabot):** clean.
