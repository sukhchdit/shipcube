# Code review: PR #11, TASK-016 row-level security foundations (round 1)

- **PR:** #11 `feat/TASK-016-row-level-security-foundations-table`, head `557aada` (merge of `origin/main` @ `de04877`)
- **Reviewer:** code-reviewer · P5 Wave 0 · 2026-11-12
- **Inputs:** WAVE-00.md TASK-016, ADR-0005 am. 9 and am. 10 items 1–16, data-model §4.1–§4.6 and §8.3, SPK-03, D-ARCH-058/063–066, D-TASK016-01, the PR #7 reviews, the PR #9 head `374166d`

```
VERDICT: CHANGES_REQUESTED
SUMMARY: A careful, well-tested foundation. The context statement, leak-before-fn, mapDbError, renderer allow-list,
         C-series, rules 3–9/11/14–16 and readSecret parity all hold, and every gate I re-ran is green.
         One MAJOR: the TenantDb Proxy is shallow. The public Prisma property `$parent` reaches an unguarded tx client,
         and `$parent._originalClient` reaches the ROOT client (probed on Prisma 7.10.1).
         Six MINORs: rule-16/C-series evasions, C5 blind to PUBLIC grants, the PR #9 integration list is incomplete,
         C6–C10 have no deferral, the Prisma.raw path is open, and PR #5 R2-m2 is not closed.
FINDINGS: M1 (MAJOR); m1–m6 (MINOR); n1–n5 (NIT). See §3.
GOOD: see §5
SECURITY-FLAGS: M1, m1, m2, m5 (see §6)
```

## 1. Verification performed

The host is memory-constrained (D-ORCH-010). I ran no `npm ci`, build, Docker or full suite. Everything below ran against a `git archive 557aada` scratch copy, with `node_modules` junctioned to the TASK-016 worktree and `prisma/generated` copied in. The copy was removed afterwards. The worktree is unchanged: `git status` shows 0 lines and node_modules has 740 entries. No stray link exists at `C:\`.

| Check | Result |
|---|---|
| Unit: `platform/db/{with-tenant-tx,tenant-db,map-db-error,expect-affected}.test.ts` | 4 suites, **58 passed** |
| Unit: `tools/db/{lint-migrations,render-rls,grants-manifest,table-classes,bootstrap}.test.ts` | 5 suites, **173 passed**, including the repository run "no findings" |
| `prettier --check` on every added or modified non-fixture file | clean |
| Probe: `TenantDb` over a **real** Prisma 7.10.1 interactive-transaction client (`root._createItxClient(...)`, no database needed) | **M1 confirmed** |
| Probe: `scanFunctionBodies` and `lintMigrationDir` rule 16 with 9 adversarial bodies | **m1 confirmed** (4 evasions) |
| ESLint probe (repository config, fixture root): a PR #9-style `platform/runtime/index.ts` and `platform/health/*.int.test.ts` importing `../db/client.js` | both report `boundaries/dependencies` "root database client … is private" (**m3**) |
| `git merge-tree` of PR #9 `374166d` with `557aada` | textual conflicts in `.env.example`, `packages/config/src/index.ts`, `packages/config/src/schema.ts` (**m3**) |
| `git merge-tree` of PR #10 `28442b6` with `557aada` | no conflict |
| Linter probe: DO-body UPDATE, `U&"…"` audit identifier, `GRANT … TO PUBLIC`, `ALTER DEFAULT PRIVILEGES … TO platform_app` | none flagged (m2, m6, n4) |

**Not re-run:** lint (full, type-aware), typecheck, the other unit files, integration (Docker), coverage, build, audit. For those I rely on the developer's gate evidence on `557aada`: lint 0, fmt 0, tc 0, unit 1078, integration 95 + 1 skipped, coverage 99.17 % lines / 98.24 % branches, build 0, audit 0, clean tree, `db:lint-migrations` clean. `gh pr view 11 --json statusCheckRollup` is **empty**: no CI ran on the head (lane A is not on main, D-ORCH-004).

## 2. Reviewer-focus answers

| Focus | Finding |
|---|---|
| Context statement equals `CONTEXT_STATEMENT_SQL`; leak check before `fn` | **Holds.** The unit test renders the tagged template to `$1..$8` and compares the strings exactly. `hasLeakedContext` runs before `createTenantDb`/`fn` (`with-tenant-tx.ts:312-313`). The integration control asserts `fnRan === false`. `is_local` is the literal `true`, and all eight binds are validated strings. |
| TenantDb Proxy closes every path to the root client | **Does not hold: M1.** |
| `mapDbError` leaks no PostgreSQL text and attaches no `cause` | **Holds.** Only `originalCode` and the 42501 message *prefix* are read. `DbError` copies the mapping fields only. `toJSON` is the safe mapping. NIT n2 covers the locale dependency. |
| `expectAffected` usage | **Correct.** 0 → 404 `NOT_FOUND`; any other mismatch → 409 `CONFLICT`. Integer guards are present. The ESLint rule follows `await`, `as`, `!` and `const` references. |
| Renderer and predicate allow-list | **Correct.** Deny-by-default atoms, at least one keyed atom, the operator pair both-or-neither and read-only, fixed `platform_definer` predicates, a statement-shape allow-list, and an identifier length check. The DR-A14 special policies are refused; routing that to the architect (decision 5) is right. |
| C-series determinism and probe cleanup | **Deterministic and clean.** Every probe runs in `BEGIN … ROLLBACK` (or a savepoint). Ids are random but results are sorted. The `ALTER ROLE … RESET lock_timeout` test restores the row in `finally` and re-asserts it. The leak control runs `RESET app.org_id` in `finally`. The gaps are m1 (scan regexes), m2 (C5 query) and m4 (C6–C10 missing). |
| Linter rules 15/16 and interpretations | Rule 15 is correct, including the four fixtures. Rule 16 is bypassable (m1). Interpretations: "existing table = not created in this file" is stricter and acceptable. "ALTER POLICY always fails" is acceptable: DROP + CREATE fails closed even though files are not atomic (decision 4), because FORCE with no policy means 0 rows. "Rule 9 checks public only" and "rule 11 first statement" are acceptable. |
| ESLint exemptions | `with-tenant-tx.ts`, both RLS integration files, the spike, the renderer, the linter and `up-down-up.test.ts` (pg_dump's `set_config('search_path','',false)`: `tokens` only, and the session-form regex correctly skips a non-`app.` literal key) are each justified and exact. **`prisma/tests/catalog/**` is a glob, not an exact file (n1).** The `no-relative-packages` `ignore` regex is narrow (one level under `tools/{db,test-support,authz}` or `apps/*/src/platform/db`) and backed by the `prisma-tests` boundaries policy plus a negative fixture. The `tools/authz` target is justified by `prisma/tests/authz/authz-seed.int.test.ts → tools/authz/generate.js`. |
| Adjusted lint fixtures keep one concern | **Yes.** The tests now assert exact `[migration, rule]` lists (`byMigration`), so adding `SET lock_timeout` and the `SET ROLE` wrappers cannot hide a second finding. The `service-imports-prisma` rewrite keeps the single layering concern. |
| Acceptance → test mapping vs the sheet | AT-US-074-01..05 and AT-US-075-01..04 are titled. SEC-TC-33 and NT-AVAIL-003-a are present per statement class. C5/C11/C13 (amended), PR8-SEC-10/14, R3-n1, readSecret parity and items 1–16 are covered. **Gaps:** C6–C10 (m4); C-1 (deferred, recorded in D-TASK016-01, acceptable); the item-12 "readiness probe reports drift" assertion and the expected-set extension (structurally blocked on PR #9; merge condition, §7). |
| Overlap with PR #9 | The PR's list (a)–(c) is necessary but **not sufficient** (m3). The full list is in §7. |

## 3. Findings

| ID | Sev | File:line | Problem | Why it matters | Required fix |
|---|---|---|---|---|---|
| M1 | MAJOR | `apps/api/src/platform/db/tenant-db.ts:22-42, 62-73` | The Proxy guards only the **top-level** keys of the transaction client, through a deny-list. Probed on a real Prisma 7.10.1 itx client: **`db.$parent`** (Prisma's public extension-context property, not `_`-prefixed and not in `BLOCKED`) returns the *unproxied* tx client, where `$queryRawUnsafe`, `$executeRawUnsafe` and `$transaction` are all functions. **`db.$parent._originalClient`** is the **root** `PrismaClient` (its `_createPrismaPromise` is the root's, not tx-bound). The same holds through every model delegate (`db.role.$parent…`) and through Prisma's private-symbol key (`db[Symbol()]`, listed by `Reflect.ownKeys(db)`), which also exposes `$transaction` and `$queryRawUnsafe`. A `$parent` reference taken inside `fn` survives `revoke()`. The unit tests use a `FakeTx` without these members. The integration test checks only 4 top-level names. | ADR-0005 am. 10 items 1–2 make the Proxy the *run-time* guard ("not lint-only"), and the PR's own reviewer focus is "closes every path to the root client". The root client inside `fn` is exactly the W-2 hazard: another pooled connection without context (0 rows silently, writes outside the business transaction, self-deadlock / P2028 on a pool of one). The `NESTED_TENANT_TX` guard does not cover it, because it guards `withTenantTx`, not `$transaction`. `db-raw-sql` covers neither `$parent` nor `_originalClient`, and it does not run in services, which also hold a `TenantDb`. `$parent` is the documented route in Prisma client extensions, so reaching for it is plausible. | Make the guard **deny-by-default and deep**. (1) Top level: allow only the model delegate names (from `Prisma.ModelName` / `_runtimeDataModel.models`, lower-camel), `$queryRaw`, `$executeRaw`, `$queryRawTyped`, and the well-known symbols a runtime needs (`Symbol.toStringTag`, `util.inspect.custom`). `then` must keep returning `undefined`. Everything else throws `TenantDbAccessError`. (2) Wrap each model delegate in a child Proxy that blocks `$parent`, `_*` and non-well-known symbols, with methods bound to the raw delegate, so that a query extension's internal `getExtensionContext(this).$parent` keeps working (item 5). (3) Tests: a unit test on the real itx shape (`new PrismaClient({adapter: new PrismaPg({connectionString: 'postgresql://x@127.0.0.1:1/x'})})._createItxClient({id:'t'},0,{})` needs no database) asserting that `$parent`, `$parent._originalClient`, `<model>.$parent`, every symbol key and `constructor` are refused; extend the `with-tenant-tx.int.test.ts` item-1 case with the same keys. |
| m1 | MINOR | `prisma/tests/catalog/scans.ts:75-81`; `tools/db/lint-migrations.ts:251-257` | The rule-16 scans have **four evasions** (probe, both lanes unless noted). (a) `set_config('' \|\| 'app.org_id', $1, false)`: the exemption "first argument is a literal outside `app.`" matches the empty literal `''`. (b) `set_config('ap' \|\| 'p.org_id', …)`. (c) `current_setting('app.' \|\| 'org_id', true)`: the read regex accepts the literal `'app.'`. (d) `SET "app"."org_id" = …` (quoted-identifier form). The linter also misses the dynamic read `current_setting(k, true)`; C-series catches that one. The PR body states "a `set_config` with a computed key fails". | Item 1's database-side scan is "by form". (a) is a **session-scoped** write of the org context hidden behind a two-character prefix. The runtime item-16 detector would catch a leak afterwards, but the scans exist to stop it before deploy. The ESLint twin already does this correctly with `'…'\s*,`. | Exempt only a **complete single literal followed by a comma**: `set_config\s*\(\s*(?!'(?:[^']\|'')*'\s*,)` plus the `app.` check on that literal, and the same for `current_setting`. Match `"?app"?\s*\.\s*"?` in the `SET`/`RESET` forms. In the linter, treat any non-literal `current_setting(` argument as a read (as C-series does). Add fixtures (a)–(d) to the linter and to the C-series `it.each`. |
| m2 | MINOR | `prisma/tests/catalog/c01-c12.int.test.ts:166,171`; `tools/db/lint-migrations.ts` rule 8 | C5 builds the live grant list from `aclexplode(relacl)` **excluding `grantee = 0` (PUBLIC)**, so it does not compare `platform_app`'s *effective* privileges with the manifest. `GRANT INSERT, UPDATE ON public.role_permissions TO PUBLIC` passes C5 and linter rule 8 (probe). | `platform_app` inherits every PUBLIC grant. On the GLOBAL authz catalogue that is a write path to `role_permissions`, a privilege-escalation vector (PR8-SEC-10 relies on "SELECT-only, C5 equality"). The data-model C5 sketch names `has_table_privilege` for this reason. | Assert no PUBLIC table or column grant in `public`/`platform` (map `0 → 'public'` and expect none), or compute effective privileges with `has_table_privilege('platform_app', oid, p)` for every relation and privilege. Add a planted-grant control (`GRANT INSERT … TO PUBLIC` inside the rolled-back probe). Rule 8: flag table grants `TO PUBLIC`. |
| m3 | MINOR | PR body "Decisions 1"; `apps/api/src/platform/db/index.ts:5`; `eslint.config.mjs:101,247-255` | The PR #9 integration list (a)–(c) is incomplete, and "no textual merge conflict" is wrong. (d) The new `db-root-client` boundary rejects PR #9's composition root (`platform/runtime/index.ts`, `runtime/services.ts`) and `platform/health/health.int.test.ts`, all of which import `../db/client.js` (ESLint probe). That also contradicts this PR's own `index.ts` comment, "only the composition root builds the client". (e) `platform/tenant-context-sql` fails PR #9's `session-integrity.int.test.ts:66` (`ALTER ROLE platform_app SET app.org_id …` → `session-set`) and `errors/problem-handler.api.test.ts:204` (`'SELECT set_config(...)'` → `tokens`). The exemption lists `session-integrity.test.ts` but not `.int.test.ts`. (f) `merge-tree` shows content conflicts in `.env.example`, `packages/config/src/index.ts` and `schema.ts`. | Whichever PR merges second must change files the first PR owns. Without the list, the second merge either fails lint after the fact or gets a hasty `ignore`. (d) is an architectural choice, not a mechanical fix. | Record the full list (§7) in D-TASK016-01 and in the PR body. Decide (d) now. Recommended: the composition root's DB wiring lives in `apps/api/src/platform/db/runtime.ts` (db-platform-core), which builds the pool, client, runner and session-integrity guard and exports only the runner and health checks; `platform/runtime` imports that. Alternative: a narrow `db-root-client` allow from `apps/*/src/platform/runtime/**`, with ADR-0005 am. 10 item 2 wording updated. Fix the `index.ts` comment to match. |
| m4 | MINOR | `prisma/tests/catalog/c01-c12.int.test.ts` | The suite `catalog-c1-c14` implements C1–C5, C11, C12 (probe), C13 and C14 (partial). **C6–C10 are absent**, and neither the PR nor D-TASK016-01 records a deferral. The sheet asks for "Catalog tests C1-C12 green". C8 (no `timestamp` without time zone; `uuid` ids with `uuidv7()` default; `*_minor` bigint plus currency CHECK) and C9 (enum CHECKs equal `packages/shared`) already apply to the committed authz tables. | Each later module migration is bound only by the checks that exist when it lands. Silent omissions read as "C1–C14 done" in traceability. | Implement C8 and C9 now (cheap, committed-state queries), or record a deferral with owners: C6/C7/C14 remainder → TASK-021; C10 → the classification-registry task; C12-per-table → `rls-cross-tenant` / TASK-276. Name the deferral in the suite header. |
| m5 | MINOR | `tools/eslint-rules/db-raw-sql.mjs:12-42`; `tenant-db.ts` | F-04's interpolation surface is closed for `*Unsafe` only. `db.$queryRaw(Prisma.raw(str))` and `db.$executeRaw(Prisma.raw(str))` (the non-tagged `Sql` overload) interpolate just the same, and neither the Proxy nor `db-raw-sql` reports them. | Item 4 says "only validated strings are bound — never … a `Prisma.Sql` fragment", and item 1 omits the unsafe members because "string interpolation is an injection surface". | In `db-raw-sql`, report `Prisma.raw(`/`raw(` (from the generated client) with a non-literal argument, and non-tagged `$queryRaw(`/`$executeRaw(` calls, in `platform/db` and repositories. Add a fixture. |
| m6 | MINOR | `tools/db/lint-migrations.ts` rule 10 (watchlist PR #5 R2-m2, routed to TASK-016) | Still open. `DO $$ BEGIN UPDATE public.roles …; END $$;` in a `data-changing: no` migration is not flagged (probe). | Rule 10 gates the §5 Database guardrail (backup + restore before any data-changing migration). A DO body skips it. | Scan DO bodies (`sqlText(…, false)` already expands them for rule 16), or record the carry-over owner explicitly. |
| n1 | NIT | `eslint.config.mjs:109` | `prisma/tests/catalog/**` grants `tokens` and `session-set` to any future file there, but the comment says "exact files". | Exemptions should be minimal. | List `c01-c12.int.test.ts` and `scans.ts` (`OPERATOR_SCOPE_DEPARSED` needs `tokens`). |
| n2 | NIT | `map-db-error.ts:53,176-180` | The RLS-vs-privilege split relies on the English message prefix. With a non-English server `lc_messages`, an RLS rejection becomes 500 `db_privilege_denied` (fail-safe). `lc_messages` is superuser-only, so `platform_app` cannot change it. | Hidden operational dependency. | Document it in the JSDoc and `prisma/README.md`; optionally add a C13 assertion. |
| n3 | NIT | `with-tenant-tx.ts:82-83, 327-331` | `probeFreshConnection` runs through the pool, so it only sees a "fresh" connection if it is the pool's first query (the PR #9 M1 lesson). | Wiring (c) could call it after other traffic and then mean less than its name says. | State in the JSDoc that the composition root runs it before any other query (or on a dedicated `pg.Client`), and make wiring (c) do so. |
| n4 | NIT | `lint-migrations.ts` rules 8/14 | `ALTER DEFAULT PRIVILEGES … GRANT DELETE ON TABLES TO platform_app` is not flagged. C5's `pg_default_acl` assertion catches it later. | Earlier feedback. | Add `^alter default privileges\b` to `BOOTSTRAP_ONLY` (rule 14). |
| n5 | NIT | watchlist PR #5 R2-n1 | A `U&"audit\005fentries_x"` identifier still evades rule 12 (only rule 9 fires). | Carry-over. | Decode `U&` identifiers before the audit-object match, or keep it routed. |

## 4. Deviation rulings

| PR decision | Ruling |
|---|---|
| 1. TASK-006 overlap | Accepted in principle; incomplete (m3). Full list in §7. |
| 2. C-1 not run; spike file kept | **Accepted.** No hosted `security-integration` job exists (D-ORCH-004), it is recorded in D-TASK016-01 with TASK-015 as owner, and it is due before G3. The permanent suite asserts the server-side p95 ≤ 1 ms without a flag (≈ 9× headroom on the measured 0.11 ms), which is the deterministic half. PR #7 R2-m2 stays open until TASK-015 runs `SPK03_BENCH=1`. |
| 3. `app_is_operator()` as a template only | **Accepted.** `check_function_bodies` stays on. The extra `GRANT EXECUTE ON platform.app_actor_id() TO platform_definer` is needed and correctly placed before `SET ROLE`; the data-model §4.4 grant matrix must add it (architect). |
| 4. Rule-5 probe: files not atomic | Accepted. Rule 5 stays a text rule. The architect must amend data-model §8.3/§8.4 (a non-atomic file changes the down/rollback reasoning). |
| 5. DR-A14 policies outside the allow-list | Accepted. The renderer and C3 correctly refuse them. TASK-037 is blocked on the architect's choice. |
| 6. Linter interpretations | Accepted (see §2). |
| 7. Generic `TenantDb<TTx>`; no `cause`; P2034 → 503 | Accepted. Note for TASK-010: the original error is unrecoverable after `withTenantTx` maps it. If AT-US-007-03 "full error in logs" needs more than `sqlState`/`prismaCode`, add an injected redacting `onDbError` hook, never `cause`. |
| 8. `required-suites.json` unchanged | Accepted (qa-lead's registry change when US-074 closes). |

## 5. Good (keep)

- Detecting the leak and setting the context in one round trip (`MATERIALIZED` CTE), with an exact-text test, plus a real negative control that asserts the pid at every step and `fnRan === false`.
- `mapDbError` is pure, keyed on `originalCode`, and never copies text. `DbError` has a reason-only message and a safe `toJSON`.
- The renderer is a deny-by-default predicate grammar plus a statement-shape allow-list. Its output is deterministic and identifier lengths are checked.
- Every catalog probe runs inside a rolled-back transaction or savepoint. The planted controls prove each scan can fail (C3 with 8 planted policies, rule 16 with 3 bodies, the PR8-SEC-14 planted row).
- `readSecret` parity: lexical plus realpath confinement, size bound before and after the read, and errors that name only the variable (tested against value and path leakage).
- Linter tests switched to exact `[migration, rule]` lists, so fixture noise is visible.
- Watchlist closures verified: PR #2 n5 (audit-writer allow-list narrowed, tested); PR #5 R3-n1 plus PR #8's `tools/authz` edge (the tree-wide `off` is removed, a narrow `ignore` plus a boundaries policy plus a negative fixture replace it); PR #5 R2-m1 / PR5-SEC-11 (rule 13 counts every `SET search_path`, five fixtures); PR #7 items (ALS guard, `originalCode`, token ban, the ported F-04 leak control), except the Proxy depth (M1).

## 6. Security flags (for security-analyst)

- **M1:** run-time `TenantDb` bypass to the unguarded tx client and to the root client through `$parent`, `$parent._originalClient` and the Prisma private symbol. CWE-693 (protection mechanism failure); OWASP A04:2021. Exploitability needs code inside a callback (developer mistake or malicious contributor). Impact: queries outside the tenant context or the business transaction, savepoints, the `*Unsafe` interpolation surface.
- **m1:** rule-16 / C-series evasions, including a session-scoped `set_config` hidden behind `'' ||`. CWE-185 (incorrect regular expression).
- **m2:** C5 is blind to PUBLIC grants. A PUBLIC write grant on `role_permissions` would be invisible privilege escalation. CWE-269.
- **m5:** `Prisma.raw` / non-tagged `$queryRaw` interpolation path. CWE-89 (potential).

## 7. Merge conditions

1. M1 fixed with real-itx-shape tests. m1, m2 and m5 fixed in this PR (cheap and security-relevant); otherwise each needs a recorded owner and a due gate.
2. m3: the full second-merger list below is recorded in D-TASK016-01, and decision (d) is made.
3. m4 and m6: implemented, or a deferral recorded with owners.
4. The orchestrator re-runs the gates on the final head, including integration (Docker), because M1 and m1 touch the security-integration surface. Confirm a CI check rollup exists on the head, or record the D-ORCH-004 exception.

**What the second-merging PR (PR #9 or PR #11) must do:**

- (a) `EXPECTED_ROLE_SETTINGS` gains `statement_timeout=30s`. PR #9's pin test must parse **every** `prisma/bootstrap/*.sql`, not only `00-roles.sql` (PR #9 review n4). Otherwise its readiness probe reports `db_role_setting_drift` on every start.
- (b) The lock_timeout-RESET integration test also asserts that the readiness probe reports drift (sheet item 12).
- (c) The composition root wires `createWithTenantTx`: the security-event sink, the `db_session_context_leak` counter, a `markNotReady` latch that stays not-ready until restart (PR #9 n8), and `probeFreshConnection` as the first query (n3).
- (d) Resolve the `db-root-client` boundary for `platform/runtime/{index,services}.ts` and `platform/health/health.int.test.ts` (m3).
- (e) Extend `TENANT_CONTEXT_EXEMPTIONS` with `session-integrity.int.test.ts` (`tokens`, `session-set`), or rephrase it. Remove the `set_config(` text from `problem-handler.api.test.ts:204`, or add an exact exemption.
- (f) Union-merge `.env.example`, `packages/config/src/index.ts` and `schema.ts`, then re-run the `.env.example`/`compose.env` parity tests.

## 8. Watchlist / follow-up routing

| Item | Owner |
|---|---|
| C-1 with `SPK03_BENCH=1`; delete the spike file | TASK-015 (due G3) |
| data-model §4.4 `app_actor_id` → `platform_definer` grant; §8.3/§8.4 non-atomic files; DR-A14 policy forms | principal-architect |
| `onDbError` redacting hook for AT-US-007-03 | TASK-010 |
| PR #5 R2-n1 (`U&` identifiers) if not fixed here | TASK-016 follow-up / TASK-021 |


---

## Round 2 (head a3e8edd)

- **Delta:** `557aada..a3e8edd`, 5 commits (`5ed304a`, `a15e3d7`, `af518f2`, `7037db8`, `a3e8edd`), 92 files. Fix comment: PR #11 issuecomment-6833014750.
- **Reviewer:** code-reviewer · P5 Wave 0 · 2026-11-13
- **Inputs:** the round-1 review (above); `rulings/wave-0-task-016-rulings.md` "Required code changes in PR #11 before merge" items 1–8; D-ARCH-071..074; D-ORCH-014.
- **Scope:** fix cycle 1 only. m3 / D-ORCH-014 (a)–(f), PR11-SEC-09 items 1–6 and architect items 5, 6 and 8 belong to the later merge-main reconciliation pass (D-ORCH-014). They are listed in R2 §6, not graded here.

```
VERDICT: CHANGES_REQUESTED
SUMMARY: A strong fix cycle. The guard is now deny-by-default and deep: $parent, _originalClient, Prisma's private
         symbol, constructor and delegate.$parent are all refused on the real 7.10.1 runtime, and kept references
         throw TENANT_TX_CLOSED. m1, m2, m4, m6, n1 and n4 are closed and re-probed.
         One MAJOR remains (R2-M1, the M1 residual): any PrismaPromise the guard returns still has Prisma's internal
         requestTransaction(), and requestTransaction(null) runs the statement on the ROOT client, outside the
         transaction. Probed with a recording adapter: findMany, deleteMany and tagged $queryRaw all ran on ROOT.
         Three MINORs: the Prisma.raw lint has alias gaps; the ESLint tenant-context twin misses quoted/spaced SET;
         architect items 1 and 2 are only partly done.
FINDINGS: R2-M1 (MAJOR); R2-m1..m3 (MINOR); R2-n1..n4 (NIT). See R2 §3.
GOOD: R2 §5
SECURITY-FLAGS: R2-M1, R2-m1, R2-m2 (R2 §6)
```

### R2 §1. Verification performed

Constraints held: no `npm ci`, build, Docker or full suites. No command ran in `Shipqube-TASK-016`.

Method:
- `git archive a3e8edd` into the scratch directory, with `node_modules` junctioned to the TASK-016 worktree and `prisma/generated` copied in.
- Afterwards: the junction was removed (`rmdir`) before the copy was deleted. The worktree `node_modules` still has 740 entries. The only junction at `C:\` is the system `Documents and Settings`.

| Check | Result |
|---|---|
| Unit `tenant-db` (`apps/api/.../tenant-db.test.ts` + `prisma/tests/rls/tenant-db.real-client.test.ts`) | 2 suites, **27 passed** |
| Unit `tools/db/lint-migrations.test.ts` | **84 passed** (includes the rendered TENANT/GUEST_CAPABLE/USER_OWNED blocks linting clean, item 4) |
| Unit `tools/db/tenant-key-forms.test.ts` | **61 passed** |
| Unit `platform/db/with-tenant-tx.test.ts` | **38 passed** |
| Unit `tools/lint/negative-fixtures.test.ts` | 123 passed, 3 failed. All 3 are the known copy-only false failures: `@platform/*` resolves into the worktree, not the copy (the two ADR-0003 workspace-probe cases and the `@platform/source` wiring case). None of them touches a PR #11 fixture. |
| **Probe A:** real Prisma 7.10.1 runtime with the PR's recording driver adapter, inside `withTenantTx` (a Jest file next to the real-client test) | **R2-M1**: `requestTransaction(null)` on `db.permission.findMany()`, `db.role.deleteMany()` and ``db.$queryRaw`…` `` logged on **`ROOT`**. A `{kind:'batch'}` argument also ran on `ROOT`. **R2-m1**: ``db.$queryRaw`… ${Prisma.raw("INJECTED' OR 1=1 --")}` `` spliced the text into the TX1 SQL. A forged frozen array passed the tagged check (R2-n3). `$queryRawTyped({sql, values})` throws today because the `typedSql` preview is off (R2-n4). `fields` exposes only FieldRef data. A PrismaPromise awaited after commit failed closed with Prisma P2028. |
| **Probe B:** the 9 round-1 bodies plus 11 new ones, through `scanFunctionBodies` (C-series) and `lintMigrationDir` rule 16 | All 7 round-1 evasions are now **flagged in both lanes**, and both controls stay clean (m1 closed). New: comment-split forms are caught by the linter, but C-series flags only the read form (R2-n1). Missed by both lanes: `U&"\0061pp"`, a fully `format()`-built setter, and a `pg_show_all_settings()` read (R2-n2). |
| **Probe C:** linter rules 11 and 15 (architect items 1 and 2) | `SET LOCAL lock_timeout` → 11 ✓. `SET ROLE platform_definer` with no reset → 15 ✓. `ALTER FUNCTION … SECURITY DEFINER` → 13 ✓. Block-form control clean ✓. **A bare `ALTER FUNCTION platform.f() OWNER TO platform_definer` is clean** and **`SET lock_timeout = '10s'` with no `RESET` is clean** (R2-m3). The role can also be left set through `set_config('role', …)` or a DO body (R2-n2). |
| **Probe D:** ESLint `db-raw-sql` and `tenant-context-sql` through the `Linter` API | `Prisma.raw` is flagged. **Clean (missed):** `import { Prisma as P }` + `P.raw`, `const { raw } = Prisma`, `const r = Prisma.raw`, `.requestTransaction(null)`. For `tenant-context-sql`, **clean (missed):** ``SET "app"."org_id" = '…'`` and ``SET app . org_id = …``. Flagged: ``SET "app.org_id"`` (`keys`) and `SET LOCAL "app"…` (`db-raw-sql`). |
| `git merge-tree --write-tree origin/main a3e8edd` (main at `66cb34b`) | clean, no conflicts |
| `gh pr view 11 --json statusCheckRollup` | **empty**. Lane A is live on main since `8e62763`, but the branch has not merged main yet. |

**Not re-run:** full lint (type-aware), typecheck, the other unit files, integration (Docker), coverage, build and audit. For these I rely on the developer's gate evidence on `a3e8edd`:
- fmt, lint and tc all 0;
- unit 1184;
- integration 112 + 1 skipped;
- coverage 99.2 % lines / 98.13 % branches;
- `db:lint-migrations` clean;
- build 0, audit 0;
- clean tree.

### R2 §2. Round-1 closure

| R1 item | Status | Evidence |
|---|---|---|
| **M1** TenantDb Proxy shallow | **Closed for every route named in round 1; residual R2-M1.** | Top level and delegates are deny-by-default (null-prototype targets; `ownKeys`, `has` and descriptors report only exposed keys). On the real runtime, `$parent`, `$parent._originalClient`, `_originalClient`, `constructor`, `__proto__`, `$transaction`, `*Unsafe`, `$extends`, `$connect`, `$on`, `_createPrismaPromise`, `<model>.$parent`, `<model>.$parent._originalClient`, `<model>.constructor` and `findRaw` are all refused. Every Prisma symbol reads `undefined`. Delegate and method references kept past the transaction throw `TENANT_TX_CLOSED`. The guarded log is all `TX2`, with 0 statements on `ROOT`, for the exposed calls the test makes. The same keys are covered in `with-tenant-tx.int.test.ts` against PostgreSQL. **Not closed:** values *returned* by exposed methods (R2-M1). |
| **m1** rule-16 / C-series evasions | **Closed** | A shared form list (`tools/db/tenant-key-forms.ts`) feeds both lanes. The exemption needs one complete plain literal followed by `,`. Quoted, spaced and case-folded namespaces are handled. Probe B: all 7 round-1 forms are flagged in both lanes, and the two controls are clean. New gaps are NITs (R2-n1, R2-n2). |
| **m2** C5 blind to PUBLIC | **Closed** | `TABLE_ACL_SQL` maps `grantee = 0` to `PUBLIC` and expects no PUBLIC rows. Planted TRUNCATE, INSERT and column-UPDATE controls exist. Rule 8 flags `TO PUBLIC` on tables and sequences, and TRUNCATE/TRIGGER/REFERENCES (including through `ALL`) to `platform_app`. |
| **m3** PR #9 second-merger list | **Open, by design** (D-ORCH-014 reconciliation pass) | See R2 §6. |
| **m4** C6–C10 absent | **Closed** | C8 and C9 are implemented with planted controls. The suite header names the deferrals: C6/C7/C14 remainder → TASK-021, C10 → TASK-028, per-table C12 → TASK-024. This matches D-ARCH-074. |
| **m5** `Prisma.raw` / non-tagged | **Partly closed; residual R2-m1** | The Proxy refuses a non-template first argument (`Prisma.raw`, `Prisma.sql`, strings). The lint reports `Prisma.raw(`, a named `raw` import, non-tagged calls and `$parent` across `apps/*/src`. The `pg` driver is now confined to the db-platform core. Aliased `raw` and a nested raw value are not covered. |
| **m6** DO bodies (rule 10) | **Closed** | Rule 10 matches statement starts and string-literal starts inside DO bodies. The fixtures cover a static UPDATE, `EXECUTE 'DELETE…'`, a function-body control and a `FOR UPDATE` control. Fully computed `EXECUTE v_sql` is a documented limit. |
| **n1** catalog glob exemption | **Closed** | Exact files only; `tokens` is split into `setter` and `keys`; a negative fixture proves a new `prisma/tests/catalog/helper.ts` fails. |
| **n2** `lc_messages` dependency | Open → architect item 6 (reconciliation pass) | |
| **n3** `probeFreshConnection` ordering | Open → D-ORCH-014 (c) | |
| **n4** `ALTER DEFAULT PRIVILEGES` | **Closed** | `BOOTSTRAP_ONLY` includes it (rule 14); fixture present. |
| **n5** `U&` identifiers | Open → TASK-021 (D-ARCH-074). It now also applies to rule 16 / C-series (R2-n2). | |

### R2 §3. Findings

| ID | Sev | File:line | Problem | Why it matters | Required fix |
|---|---|---|---|---|---|
| **R2-M1** | **MAJOR** | `apps/api/src/platform/db/tenant-db.ts:167-175` (`bindMember` returns Prisma's result as is) | Every exposed operation returns Prisma's own `PrismaPromise`. Its keys are `spec`, `then`, `catch`, `finally` and **`requestTransaction`**. In 7.10.1 (`runtime/client.js`, the `createPrismaPromiseFactory` body), `requestTransaction(s)` calls the operation's callback with `s` as the transaction. With `null` (or a batch descriptor), the query runs **without the interactive-transaction id, on the root client**. Probe A inside `withTenantTx`: `db.permission.findMany().requestTransaction(null)`, `db.role.deleteMany(...).requestTransaction(null)` and ``db.$queryRaw`SELECT 1`.requestTransaction(null)`` were all logged on `ROOT` while TX1 was open. Neither lint rule sees it (Probe D). | This is the M1 property itself. The PR's acceptance (and its test's "0 statements on ROOT") is "no route back to an unguarded or root client". The effects are as in round 1: another pooled connection without the tenant context, writes outside the business transaction (SYSTEM tables such as outbox or audit once they have write grants), and self-deadlock on a pool of one. The runtime guard exists precisely for code that casts around the `TenantDb` type (the type already omits `$transaction`). `requestTransaction` is hidden by the public `PrismaPromise` type, so reaching it needs a cast: the same threat model as `$parent`. The fix is small. | In `bindMember`, wrap a thenable result in a guarded, lazy thenable. It is a null-prototype object exposing only `then`, `catch`, `finally` and `Symbol.toStringTag`, each delegating to the PrismaPromise and each checking `state.closed` first, so a late `await` also gets `TENANT_TX_CLOSED` instead of P2028. Do not use `Promise.resolve(result)`: it would execute eagerly. Add `requestTransaction` and `_originalClient` to the `db-raw-sql` member list. Extend `tenant-db.real-client.test.ts`: `requestTransaction` is `undefined`/refused on the results of a model operation and of `$queryRaw`; the ROOT log stays empty; a late await throws `TENANT_TX_CLOSED`. |
| R2-m1 | MINOR | `tools/eslint-rules/db-raw-sql.mjs:76-93` | The runtime guard checks only the *first* argument, so a raw fragment passed as a *value* of a genuine tagged template is spliced into the SQL. Probe A: `INJECTED' OR 1=1 --` appeared verbatim in the TX1 statement. That makes the lint the only control, and it matches only `Prisma.raw(…)` with the literal identifier `Prisma` and a named `raw` import. `import { Prisma as P }` + `P.raw(s)`, `const { raw } = Prisma` and `const r = Prisma.raw` are all clean (Probe D). The fix comment's "Prisma.raw(...) … refused" holds only for the first argument. | ADR-0005 am. 10 item 4: only validated strings are bound. This is the F-04 injection surface (CWE-89, potential). | Use scope analysis. Resolve every import from `PRISMA_SOURCES` (any local name, namespace imports included) and report **any read** of a `raw` member on it, and any destructuring of `raw` from it, call or not. Add fixtures for the three alias forms. Correct the JSDoc in `tenant-db.ts:192-194` and the fix-comment wording: a nested raw value is lint-only. |
| R2-m2 | MINOR | `tools/eslint-rules/tenant-context-sql.mjs:18-21` | The TypeScript-side twin does not use the shared form list. Its `session-set` pattern knows only `set [session] app.` and `reset app.`. `keys` matches only `app.<key>`. So ``SET "app"."org_id" = '<uuid>'`` and ``SET app . org_id = …`` in any `apps/*/src` file are clean (Probe D). | A session-level `SET` inside the transaction re-scopes the **rest of that transaction** to another org (cross-tenant reads and writes through the helpers). The item-16 leak check only notices at the next checkout. PR11-SEC-02's "one form list" goal stops at the SQL lanes. Exploiting it needs a hard-coded org id (a `SET` cannot take a bind), so it is deliberate-only. | Align `session-set` with `CONTEXT_WRITE_FORMS[1]`: `(?:"app"\s*\.\|app\s*\.\|"app\.)`, with `set\s+(?:(?:session\|local)\s+)?`. Align `keys` with the quoted/spaced read form. Add negative fixtures. Ideally generate both from `tenant-key-forms.ts` (for example a `.mjs` export of the pattern sources) so the twin cannot drift. |
| R2-m3 | MINOR | `tools/db/lint-migrations.ts:255-260, 480-485, 695-716` | Architect "required before merge" items 1 and 2 are only partly done (Probe C). (1) The `RESET lock_timeout` at end of file when the value exceeds the `3s` role default is **not** checked: `SET lock_timeout = '10s'` + `ALTER TABLE` lints clean. (2) A bare `ALTER FUNCTION … OWNER TO platform_definer` is **not** flagged. Only a GRANT/REVOKE *after* it is flagged. | Item 1: the session value persists into later files on the deploy connection (D-ARCH-071). Item 2: an `OWNER TO platform_definer` outside the block form recreates the durable non-atomic window ADR-0005 am. 10 item 9 (amended) withdrew. Both are listed by the architect as required before merge. | (1) Parse the `SET [SESSION] lock_timeout` value (ms/s/min units). If it exceeds 3 s, require a final `RESET lock_timeout` (or `SET lock_timeout = <≤3s>`); add a fixture. (2) Flag any `ALTER (FUNCTION\|PROCEDURE\|ROUTINE) … OWNER TO platform_definer` in `prisma/migrations/**` unconditionally; add a fixture. Either now or in the reconciliation pass (R2 §6); merge condition either way. |
| R2-n1 | NIT | `prisma/tests/catalog/scans.ts:90-97` | The C-series scans raw `prosrc`, comments included. `SET app/**/.org_id = 'x'` is **clean** in C-series. `set_config/**/('app.org_id', …)` and `SET/**/app.org_id` are caught only by the read-key form, and the four helpers are exempt from that form. The linter strips comments first and catches all of them. | The bootstrap lane is not rule-16 linted, so the C-series is its only by-form check. | Scan the comment-stripped text: reuse `tokenize` from `tools/db/sql-text.ts`, as `sqlText(…, true)` does. Add the three comment fixtures to the C-series `it.each`. |
| R2-n2 | NIT | `tools/db/tenant-key-forms.ts`; `lint-migrations.ts` rule 15 | Limits of the by-form approach, in both lanes (Probes B and C): `SET U&"\0061pp".org_id` (extends the open PR #5 R2-n1); a setter whose name and key are both built in `format()`; a read via `pg_show_all_settings()`. Rule 15 (c) cannot see the role left set through `set_config('role','platform_definer',false)` or `DO $$ … EXECUTE 'SET ROLE …' $$`. | Text rules cannot be complete over dynamic SQL. The C11 converse (definer owns only allow-listed objects) and the item-16 leak check are the outcome controls. | Record these as stated limits in the linter header and data-model §8.3 "Limits". Optionally flag `pg_show_all_settings`, the `set_config('role'` literal, and any `EXECUTE` of a non-literal in DO and function bodies as review-required. Route the `U&` decode to TASK-021 with n5. |
| R2-n3 | NIT | `tenant-db.ts:106-111` | `isTemplateStringsArray` accepts a forged `Object.freeze(Object.assign([sql], {raw: [...]}))`, which Prisma then interpolates (Probe A). | Deliberate only: no mistake produces this shape. | Document it as a limit in the JSDoc. Optionally also require `Object.isFrozen(value.raw)`. That is cheap, but it does not stop a deliberate forge. |
| R2-n4 | NIT | `tenant-db.ts:38` (`$queryRawTyped` exposed unchecked) | Today it throws (the `typedSql` preview is off). Once enabled, Prisma's `$queryRawTyped` passes `arg.sql`/`arg.values` from any plain object straight to the query. It is an `$queryRawUnsafe` equivalent behind the guard's allow-list. Not linted (Probe D). | A latent F-04 surface that switches on with a one-line schema change. | Drop `$queryRawTyped` from `TENANT_DB_RAW_MEMBERS` until the preview is enabled (recommended). Or accept only Prisma's `TypedSql` instances (the `$$PrismaTypedSql` brand) and lint non-generated arguments. |

### R2 §4. Architect "Required in PR #11" items: status at a3e8edd

| # | Item | Status |
|---|---|---|
| 1 | Rule 11 session form only; `SET LOCAL` fails; `RESET` when > 3 s | **Partly.** `LOCK_TIMEOUT = /^set (?:session )?lock_timeout\b/` and the `set-local-lock-timeout` fixture are present ✓. The **`RESET` requirement is missing** (R2-m3). |
| 2 | Rule 15: `handedOver` removed; DEFINER outside the block fails; `OWNER TO platform_definer` fails; end-of-file role fails | **Partly.** `handedOver` is removed, CREATE … SECURITY DEFINER outside the block fails, and an end-of-file `SET ROLE` fails ✓. Fixtures `definer-grants-before-owner-to` (now failing) and `definer-role-not-reset` are present ✓. **A bare `ALTER … OWNER TO platform_definer` is not flagged** (R2-m3). |
| 3 | Rule 9 b: grant after ENABLE + FORCE | **Present** ✓ (`enabledSoFar`/`forcedSoFar`, earlier-file `history.rlsProtected`, fixture `grant-before-force`). |
| 4 | Rule 16 b: operator atom exempt only inside `CREATE POLICY` | **Present** ✓. The exact atom is removed only when the statement starts `create policy`. Rule 9 then requires renderer equality (`canonicalPolicy` keeps literals). The rendered blocks lint clean (unit). |
| 5 | Qualified helper bodies in `20261112020000_platform_rls_helpers` | **Missing** (out of scope this round). The bodies still use unqualified `current_setting`, `~*`, `decode` and `::uuid`. |
| 6 | `lc_messages = 'C'` in `02-role-backstops.sql`, C13 five rows, `EXPECTED_ROLE_SETTINGS` | **Missing** (out of scope this round). No `lc_messages` anywhere in the tree. |
| 7 | C13 case folding plus `proconfig ILIKE 'app.%'` | **Present** ✓. `lower(c) LIKE 'app.%'` on `setconfig` and `parname`; `proconfig ILIKE 'app.%'`. |
| 8 | Sheet lines D-ORCH-014 (a)–(f) and PR11-SEC-09 items 1–6 | **Missing** (reconciliation pass). |

### R2 §5. Good (keep)

- The guard design: a deny-by-default allow-list derived from the client's own `_runtimeDataModel` (fails closed to no models); null-prototype extensible targets, so the Proxy invariants allow accurate `ownKeys`; one shared `closed` state for the top level and every child; method wrappers that re-check `closed` at call time.
- The real-runtime test with a **recording driver adapter**. It is the right harness: it proves the positive control (the escape routes exist on a raw tx) and asserts per-connection statement logs. R2-M1's fix needs only two more lines in it.
- One shared form list for rule 16 and the C-series, with 61 unit cases. The C-series fixtures are **executed on PostgreSQL** to prove each form is accepted by the server.
- C5 now compares effective PUBLIC grants with planted controls. C8 and C9 have planted controls. The deferrals are named in the suite header with owners.
- Exact-file exemptions plus the `setter`/`keys` split, each with a negative fixture. The `pg`/`pg-pool` boundary is narrowed to the db-platform core.

### R2 §6. Security flags; merge conditions; reconciliation list

**Security flags (for security-analyst):**
- **R2-M1:** root-client execution through `PrismaPromise.requestTransaction(null)` on any guarded result. CWE-693; OWASP A04:2021. Needs a cast inside a callback. Same impact class as PR11-SEC-01.
- **R2-m1:** aliased or nested `Prisma.raw` reaches the SQL text (CWE-89, potential).
- **R2-m2:** a TypeScript-side quoted/spaced session `SET` of `app.org_id` is not linted, so the transaction can be re-scoped to another org (CWE-185 / CWE-639).

**Merge conditions:**
1. R2-M1 fixed, with the real-client test extended (ROOT log empty; `requestTransaction` refused; late await → `TENANT_TX_CLOSED`).
2. R2-m1 and R2-m2 fixed in this PR (cheap and security-relevant), or each given a recorded owner and a due gate.
3. R2-m3 (architect items 1 and 2 residue) done before merge, here or in the reconciliation pass.
4. After merging main: a **non-empty CI check rollup** on the final head (lane A is live on main since `8e62763`, so the D-ORCH-004 exception no longer applies). The orchestrator also re-runs the full gates including integration (Docker).

**What the reconciliation pass (D-ORCH-014, after PR #9 lands) must still do:**
- **(a)–(f)** from round-1 §7, unchanged. That covers (a) `EXPECTED_ROLE_SETTINGS` plus the all-files pin; (b) the readiness-drift assertion; (c) composition-root wiring including `probeFreshConnection` first and the not-ready latch (n3); (d) `platform/db/runtime.ts`; (e) the exemption list; (f) the union-merge of `.env.example` and config.
  - Note for (e): exemptions now use `setter`/`keys`, not `tokens`. `session-integrity.int.test.ts` needs `keys` plus `session-set`. `problem-handler.api.test.ts:204` needs `setter` or a text change.
- **PR11-SEC-09** items 1–6.
- **Architect item 5:** qualified helper bodies. If `prisma/sql/policy-templates/operator.sql` is ever qualified too, change `OPERATOR_SCOPE_ATOM` (lint) and `OPERATOR_SCOPE_DEPARSED` (`scans.ts`) in the same commit.
- **Architect item 6:** `lc_messages = 'C'`, five C13 rows, the `EXPECTED_ROLE_SETTINGS` row. This also closes n2.
- **Architect item 8:** the sheet lines.
- **R2-m3**, if it is not fixed in the next fix cycle.

**Routing (unchanged unless noted):**
- n5 + R2-n2 `U&` → TASK-021.
- C-1 → TASK-015.
- R2-n2 limits text → principal-architect (data-model §8.3 "Limits").


---

## Round 3 (head 37a2109)

- **Delta:** `a3e8edd..37a2109`, pushed once. Fix comment: PR #11 issuecomment-6835514581. Lane A comment: issuecomment-6835649182. Reviewed in three parts:
  - (1) fix delta `a3e8edd..80bcda1` (`b00cd6e`, `91c90bf`, `41afe58`, `80bcda1`);
  - (2) merge `d68898a` (parents `80bcda1` + `63accea`);
  - (3) reconciliation `d68898a..37a2109` (`ddf27d6`, `a7df29f`, `198328a`, `9482f38`, `37a2109`).
- **Reviewer:** code-reviewer · P5 Wave 0 · 2026-11-13
- **Inputs:** rounds 1–2 above; `rulings/wave-0-task-016-rulings.md` items 1–8; D-ORCH-014, D-ORCH-018, D-TASK006-02/03, D-ARCH-073/074; security review PR11-SEC-09 items 1–6; WAVE-00 TASK-016 sheet lines (D-ORCH-014 reconciliation block).
- **Supersede (D-ORCH-018):** this review grades the CONTENT, which is `git diff 63accea 37a2109` (377 files, none under `docs/` or `.claude/`). The superseding branch must carry exactly that tree delta; see R3 §6.

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: R2-M1 is closed. Every guarded operation result is a lazy, frozen, null-prototype thenable with only
         then/catch/finally; requestTransaction, spec and _callback read undefined; the ROOT log stays empty; a late
         await gives TENANT_TX_CLOSED with no statement sent. Re-probed on the real 7.10.1 runtime, and 4 mutations
         were killed. R2-m1..m3, R2-n1..n4 and architect items 1, 2b, 5 and 6 are closed. The merge is a pure union.
         D-ORCH-014 (a)–(f) and PR11-SEC-09 items 1–6 are met. Item 4's metric and the TASK-010 sink are deferred
         without a recorded owner (R3-m1). PGOPTIONS exits 1, not 78 (R3-m2). Six NITs.
FINDINGS: R3-m1, R3-m2 (MINOR); R3-n1..n6 (NIT). No BLOCKER/MAJOR. See R3 §3.
GOOD: R3 §5
SECURITY-FLAGS: none new above NIT; R3-n1/n2 are lint-twin residues behind run-time controls (R3 §6)
```

### R3 §1. Verification performed

Constraints held: no `npm ci`, build, Docker or full suite, and no command in `Shipqube-TASK-016`.

Method:
- `git archive 37a2109` into `scratchpad/review/PR-11-cr-r3/copy`, with `node_modules` junctioned to the TASK-016 worktree (Prisma 7.10.1; the lock equals main's) and the git-ignored `prisma/generated` copied in.
- Afterwards: the junction was removed with `rmdir` before `rm -rf`. The worktree still has 740 `node_modules` entries and `git status` shows 0 lines. The only junction at `C:\` is the system `Documents and Settings`.

| Check | Result |
|---|---|
| Unit, 9 suites in one `--runInBand` run: `platform/db/{runtime,session-integrity,tenant-db,with-tenant-tx}.test`, `errors/classify.test`, `runtime/services.test`, `tools/lint/tenant-context-forms-drift.test`, `tools/db/{lint-migrations,tenant-key-forms}.test` | **332 passed** |
| Unit/API: `packages/shared/src/errors/catalogue.test` + `platform/errors/problem-handler.api.test` | **58 passed** |
| Unit: `prisma/tests/rls/tenant-db.real-client.test.ts` (real 7.10.1 runtime, recording adapter) | 3 passed |
| Unit: `tools/lint/negative-fixtures.test.ts` | 154 passed, 3 failed. All 3 are the known copy-only false failures (`@platform/*` resolves into the worktree): the two ADR-0003 workspace probes and the `@platform/source` wiring case. Same set as round 2. |
| **Probe A (R2-M1 re-run):** a Jest file next to the real-client test, inside `withTenantTx`, on results of `count`, `aggregate`, `groupBy`, `createMany`, `findFirst` and `upsert` | Own keys are exactly `then`, `catch`, `finally` and `Symbol(Symbol.toStringTag)`. `requestTransaction`, `spec`, `_callback`, `constructor` and `__proto__` read `undefined`, and `'requestTransaction' in r` is false. `then` is a plain arrow function (keys `length`, `name`), so there is no closure path to the PrismaPromise. `defineProperty` throws (frozen). `fields` gives FieldRef data only (`modelName`, `name`, `typeName`, `isList`, `isEnum`; no `$parent`). A result created inside and awaited after commit rejects `Database error: TENANT_TX_CLOSED`. **ROOT log `[]`; connections `['TX1']`.** |
| **Mutations on `tenant-db.ts`** (restored and diffed after each) | (1) Return `fn.apply(raw, args)` unwrapped: real-client test **fails**. (2) Drop the `state.closed` check in `settle`: **2 fail**. (3) Drop the Sql-fragment value check: **2 fail**. (4) Drop `Object.isFrozen(raw)`: **3 fail**. 4/4 killed. |
| **Probe D (R2-m1/m2 lint re-run):** `Linter` API with `@typescript-eslint/parser` on 24 `db-raw-sql` and 15 `tenant-context-sql` snippets | `db-raw-sql`: flagged, the three round-2 alias forms (`Prisma as P` + `P.raw`, `const { raw } = Prisma`, `const r = Prisma.raw`), plus a namespace import of the generated client, a named `raw` import, `await import()`, `require`, `.requestTransaction(null)`, destructured `requestTransaction` and optional-call non-tagged. Clean controls: tagged `Prisma.sql`, `Prisma.join(ids[, ', '])`, type-only import. **Not flagged (R3-n1):** the container passed as a function argument, put in an object or array, copied by spread or `Object.assign`, chosen by ternary or `||`, or read through `import().then(m => …)`; `Reflect.get(db, '$parent')`; a concatenated key; `$queryRaw.call`. `tenant-context-sql`: the quoted, spaced, quoted-whole, `LOCAL` quoted, `SESSION … TO` and `RESET "app".x` forms, newline-split, template-split and the setter forms are all flagged. **Not flagged (R3-n2):** `SET U&"\0061pp".org_id` and `SET app/**/.org_id`. |
| **Probe C (rules 11/15):** `lintMigrations` on 10 hand-written migrations | Flagged: rule 15 on `ALTER TABLE … OWNER TO platform_definer` and on `OWNER /* c */ TO platform_definer`; rule 16 on `U&'…'`. Clean (correct): `SET lock_timeout = '1s'`; `'2min'` followed by `RESET`; `'10s'` followed by `TO DEFAULT`; `u &'x'` (the operator). **Clean (R3-n3):** `SELECT set_config('lock_timeout', '0', false)`. Also clean: a DO-body `EXECUTE 'SET lock_timeout = 0'` (stated limit) and `REASSIGN OWNED BY platform_migrator TO platform_definer` (rule 15 reads `ALTER` only; the engine probably refuses this for an `INHERIT FALSE` member, not verified). |
| Helper bodies vs data-model §4.2 | The whitespace-normalised bodies of the three functions in `20261112020000_platform_rls_helpers` (header comments and the GRANT/REVOKE lines dropped) are **byte-identical** to data-model.md:2430-2441. `prisma/sql/policy-templates/operator.sql` and `render-rls.ts` are unchanged from `a3e8edd`. `OPERATOR_SCOPE_ATOM` (lint) and `OPERATOR_SCOPE_DEPARSED` (scans.ts) are unchanged. |
| Bootstrap role settings vs the pin | Every `ALTER ROLE platform_app SET` line in `prisma/bootstrap/*.sql` (5 in total: 3 in `00-roles.sql`, 2 in `02-role-backstops.sql`) equals `EXPECTED_ROLE_SETTINGS`. The migrator's `lock_timeout = '3s'` (00-roles.sql:58) is the rule-11 bound. |
| Merge `d68898a` | See R3 §2.2. |
| `client.ts` importers at `37a2109` | Inside `platform/db`: `runtime.ts` and `dedicated-connection.ts` (type plus `toPoolConfig`). Elsewhere only `prisma/tests/**` (allowed by the `prisma-tests` policy) and two lint fixtures. `platform/runtime/**`, `platform/health/**` and both `main.ts` files do not import it. |
| Lane A run 43303599938 on `37a2109` (`gh run view`) | Passed: commitlint (PR title), lint, format, actionlint, type-check, unit, licences, audit, install flags, migration immutability, lockfile. **Failed:** the base-ref negative fixtures (D-ORCH-018 (2)) and Gitleaks (merge commit `d68898a`, D-ORCH-018 (1)). Skipped: build, porcelain, semgrep. |
| `git merge-tree --write-tree origin/main 37a2109` (origin/main `9687533`) | Clean. `63accea..origin/main` touches only `docs/` and `.claude/`. |

**Not re-run:** full lint (type-aware), typecheck, the other unit files, integration (Docker), coverage, build and audit. For these I rely on:
- hosted lane A on `37a2109`: lint, format, type-check and unit are green;
- the developer's local gates on `9482f38`: unit 2057 + 2 skipped, api 49, integration 154 + 1 skipped, coverage 97.54 % lines / 97.08 % branches, `db:lint-migrations` 0, build 0, audit 0, porcelain clean. `37a2109` is test-only; its file (21) was re-run by the developer and by me.

I did not read `.env.example` (permissions; brief). For it I relied on numstat (R3 §2.2) and the developer's parity suites (523 passed).

### R3 §2. Closure

#### 2.1 Fix delta `a3e8edd..80bcda1`

| Item | Status | Evidence |
|---|---|---|
| **R2-M1** `requestTransaction` on guarded results (MAJOR) | **Closed** | `guardResult` (tenant-db.ts) wraps every thenable result in a frozen null-prototype object with only `then`, `catch`, `finally` and `Symbol.toStringTag`. Each one checks `closed` before calling Prisma's `then`, once, lazily (`started ??=`). Probe A and the real-client test both show: no `requestTransaction`, `spec` or `_callback`; ROOT log empty; late await gives `TENANT_TX_CLOSED` with 0 new statements. Mutation (1) kills the test. The `db-raw-sql` lint half reports `requestTransaction` and `_originalClient`, including destructuring and literal computed keys. |
| R2-m1 aliased or nested `Prisma.raw` | **Closed** | Run time: `taggedOnly` refuses any `Sql` fragment as a VALUE (duck-typed `strings`/`values` arrays, or the `Sql`/`_Sql` constructor), for all 5 fragment builders × 2 raw members. The real-client test asserts no statement contains the injected text. Lint: binding-aware tracking resolves all three round-2 alias forms (Probe D). Remaining laundering forms are R3-n1 (NIT), behind the run-time refusal. |
| R2-m2 ESLint twin misses quoted/spaced `SET` | **Closed** | `session-set` and `keys` are now the exact `.source` of `CONTEXT_WRITE_FORMS[1]` and `CONTEXT_READ_FORMS[0]`. `tenant-context-forms-drift.test.ts` (26 cases) pins the sources and runs one corpus through both. Probe D flags all 6 quoted/spaced variants. U& and comment forms are R3-n2 (NIT). |
| R2-m3 (1) rule 11 `RESET lock_timeout` above 3 s (architect item 1) | **Closed** | `lockTimeoutMs`: units from `guc.c`; `DEFAULT` → role default; `0`, negative or unparsed → ∞ (fail closed). A file-end check applies. Fixture `lock-timeout-raised` has 3 failing and 3 passing migrations, plus 10 parser cases. Probe C is consistent. Residue R3-n3. |
| R2-m3 (2) rule 15 bare `OWNER TO platform_definer` (architect item 2b) | **Closed** | Any `^alter … owner to "?platform_definer"?` fails, so tables and views are covered as well as functions (Probe C). Fixture `definer-owner-to` covers the function form and the quoted `ROUTINE` form. |
| R2-n1 C-series scans raw `prosrc` | **Closed** | `sqlText` moved to `tools/db/sql-text.ts`. `scans.ts` `bodyText` uses the same function (comments → one space, strings kept, nested bodies expanded, fail closed on a lexing error). The three comment fixtures are executed on PG 18. |
| R2-n2 by-form limits | **Closed (text)** | Stated limits with owners are in the linter header and the form-list header (TASK-024 dynamic-SQL allow-list, TASK-021 DO bodies). `U&` is now refused outright in both SQL lanes (PR11-SEC-14 a). The data-model §8.3 "Limits" text is still owed by the architect. |
| R2-n3 forged strings array | **Closed** | `Object.isFrozen(raw)` is required. JSDoc states the deliberate-forge limit. Mutation (4) killed. |
| R2-n4 `$queryRawTyped` | **Closed** | In `TENANT_DB_OMITTED` (type and run time). Refused and `in`-false on the real client. Lint reports `makeTypedQueryFactory`/`TypedSql`. |
| Architect item 5: qualified helper bodies | **Closed** | Byte-identical to data-model §4.2 (R3 §1). New C-series test: a planted `public.current_setting` under `search_path = public, pg_catalog` does not change `platform.app_org_id()`, and the plan keeps the inlined `Index Cond` (50 of 5 000 rows). The migration is not on main (`check-migration-immutability` PASS on lane A). |
| Architect item 6: `lc_messages = 'C'` | **Closed** | `02-role-backstops.sql:33`; C13 (d) expects five rows, `SHOW lc_messages` = `C`, and `SET lc_messages` as `platform_app` gives `42501` (SUSET, the role cannot undo it). The RDS question is recorded for SPK-08/M5. Closes round-1 n2. |
| PR #5 R2-n1 (`U&` identifiers, rule 12) | **Closed for `prisma/migrations`** (rule 16 refuses any `U&` statement-wide) | Still open for the reviewed `prisma/bootstrap` lane → TASK-021 (unchanged routing). |

#### 2.2 Merge `d68898a` (pure-union proof)

- `git merge-tree --write-tree 80bcda1 63accea` → tree `d3ae340`, with content conflicts in `.env.example`, `packages/config/src/index.ts` and `packages/config/src/schema.ts`. Every other file auto-merged (`compose.env`, `eslint.config.mjs`, `load-config.test.ts`, `lint-fixtures.mjs`, `negative-fixtures.test.ts`).
- `git diff --stat d3ae340 d68898a` excluding `.env.example` lists **only** `index.ts` and `schema.ts`. Every other path is byte-identical to a clean re-merge.
- **`index.ts`:** the resolution keeps both export sets: main's `DB_STATEMENT_TIMEOUT_MS_DEFAULT` / `_LIMIT` and the branch's four `DB_TX_*`. Only the markers are removed.
- **`schema.ts`:** both blocks are kept verbatim: main's pool `statement_timeout` backstop constants and the `DB_STATEMENT_TIMEOUT_MS` schema key, plus the branch's `DB_TX_*` bounds, `txTimeout` and the three `DB_TX_*` keys. Only ordering and markers changed.
- **`.env.example`** (not read): `--numstat` gives `63accea → d68898a` = 5 added / 0 deleted, `80bcda1 → d68898a` = 4 / 1, and `63accea → 37a2109` = 5 / 0. So the final file is main's file plus 5 appended lines, and nothing from main was dropped. That matches the developer's "main's file plus the three `DB_TX_*` keys appended" and the parity suites (523 passed).
- `package-lock.json` equals main's (`git diff --quiet 63accea 37a2109 -- package-lock.json`).
- **Semantic interaction checked:** main's pool-level `statement_timeout` (25 s startup parameter) sits under the branch's 30 s role backstop (sessions outside the pool only) and the 5 s per-transaction value. The schema comment states the layering. No conflict.

#### 2.3 Reconciliation `d68898a..37a2109`: D-ORCH-014 (a)–(f) and PR11-SEC-09 items 1–6

| Item | Status | Evidence |
|---|---|---|
| (a) / SEC-09 5: five role settings; pin parses every bootstrap file | **Met** | `EXPECTED_ROLE_SETTINGS` has 5 rows. The pin test uses `readdirSync(…).filter(.sql)` with a case-insensitive regex that tolerates a quoted role, `IN DATABASE` and `=`/`TO`. It asserts both new rows. R3 §1 cross-check: 5/5. |
| (b) / SEC-09 5: lock_timeout-RESET asserts readiness drift | **Met** | `with-tenant-tx.int.test.ts` item-12 test: the composed `createDatabaseRuntime` readiness check (`integrityIntervalMs: 0`) is ready, rejects with `db_role_setting_drift` after `RESET`, and gives exactly one `security.db_role_setting_drift` event. |
| (c)+(d) / SEC-09 1: one composition function in `platform/db` | **Met** | `platform/db/runtime.ts` builds the pool, the session-integrity guard, the gated `database` check and, when `Client` is given, the client over the shared pool and the runner. It returns the runner, readiness check, startup, resources and leak count; the pool and client never leave it. `services.ts`, `runtime/index.ts` and `health.int.test.ts` import it. There is no `db-root-client` carve-out; the `index.ts` comment was updated. The worker reaches it through `createRuntimeServices`. **Dormant until TASK-020:** `Client` is optional because `apps/*` cannot import the generated client yet (data-model §7.2). Production builds no runner today, so the probe and latch are proven by `session-scope-leak.int.test.ts` with the real generated client. Routing in R3 §6. |
| SEC-09 2: `deps.env` omitted; PGOPTIONS refused via the composition | **Met** (exit-code residue R3-m2) | `assertNoSessionOptions(process.env)` runs before the pool exists, and `createWithTenantTx` receives no `env`. `runtime.test.ts` "refuses PGOPTIONS from process.env…". |
| SEC-09 3: `probeFreshConnection` first; not ready until it passes | **Met** | `startup()` awaits `freshProbe()` before the dedicated integrity check and the monitor. Both `main.ts` files await `startup()` before listen or processors. Until it passes, readiness re-runs it single-flight. The probe accepts NULL or `''`, so a re-run on a used pooled connection cannot false-positive (round-1 n3 / the PR #9 M1 lesson). The integration composition test asserts the event order. |
| SEC-09 4: sinks, counter, latch | **Partly met (R3-m1)** | Security events → runtime log `security.<event>` with `{component, correlationId?, sqlState?}` only (the integration test asserts no org id in the log). The latch keeps the first reason, logs once and is never cleared: 3 later polls are not ready; the `[R2-n2]` unit test shows the probe and inner check are never re-run. A tampered default also latches. **Not met:** the counter is an in-process accessor nothing reads ("becomes a metric"), and the sink is the runtime log, not the TASK-010 security logger. Neither deferral has a recorded owner. |
| SEC-09 6: `DbError` problem+json | **Met** | The `classify.ts` `db` branch carries only `code` and an optional `retryAfterSeconds`. Its own-data reads mean getters are never invoked. A code or status that does not match the catalogue fails safe to `INTERNAL_ERROR`. `Retry-After` is sent only when retryable, as an integer in 1..3600. The problem body is built from the catalogue entry with no `detail` override, so message, reason, sqlState, prismaCode and securityEvent cannot reach the body (`codeOf` and `buildProblem` read nothing else). Every `DbProblemCode` (403/404/409/500/503) is in the platform catalogue. Tested: 18 classify cases, including throwing getters and forged fields, and 6 problem-handler cases. |
| (e) exemptions | **Met** | Exact files only. `session-integrity.int.test.ts` gets `setter`, `keys` and `session-set` (plants what the guard detects; no `session-set-config`). `session-integrity.test.ts` keeps `keys` (a title was reworded). `problem-handler.api.test.ts` has no exemption (the text was changed). The PR #12 spike `spk08-audit-owner.int.test.ts` gets `keys` only, for one probe policy reading a key at :609, with a "remove in the TASK-021 porting commit" note (D-TASK012-02 (1)). Minimal and justified. Stale-entry tripwire: R3-n5. |
| (f) union merge plus parity | **Met** | R3 §2.2. |
| Catalogue `AUTHZ_DENIED` / `CONFLICT` | **Accepted** | Both are in `platform.ts`, which TASK-036 owns. The titles match openapi (`Permission denied`; `Conflict`). A later module redeclaring them fails loudly at load (`mergeCatalogues`) and in `catalogue.test`; it is not silent. Routing in R3-n6. |

### R3 §3. Findings

| ID | Sev | File:line | Problem | Why it matters | Required fix |
|---|---|---|---|---|---|
| R3-m1 | MINOR | `apps/api/src/platform/db/runtime.ts:194-207` (sinks); WAVE-00 TASK-016 reconciliation line (4) | PR11-SEC-09 item 4 is a sheet merge condition. Two of its parts are deferred in the PR comment only. (i) "the leak counter becomes a metric": `sessionContextLeaks()` exists but nothing reads or exports it. (ii) "`onSecurityEvent` goes to the TASK-010 security logger": it goes to the runtime log. In the same vein, the runner itself is dormant until TASK-020 passes `Client`. Neither TASK-010's sheet nor any metrics task names these hand-overs. | The detection is otherwise complete (log event plus latched readiness), so there is no exposure today. But "verified at TASK-020's `tx` slot" (D-ARCH-074) only covers the runner. The metric export and the security-logger sink have no owner and would silently stay "done" in traceability. Same failure mode as the round-1 C6–C10 omission. | Record the deferral with owners. In DECISIONS (or a D-TASK016 entry) plus the TASK-010 sheet: the `security.*` events move to the TASK-010 security logger. The metrics/observability task exports `db_session_context_leak_total` from `sessionContextLeaks()`. TASK-020 passes the generated `Client` in both the API and the worker and asserts `tenantTx !== undefined` at boot. Docs-only, so the orchestrator can do it. |
| R3-m2 | MINOR | `runtime.ts:174` + `apps/{api,worker}/src/main.ts` (top-level `createRuntimeServices`) | With `PGOPTIONS` set, `assertNoSessionOptions` throws `TenantTxConfigError` out of `createRuntimeServices`. That is an unhandled top-level rejection: **exit 1 plus a raw stack** on stderr. `main.ts`'s own contract (and PR3-SEC-05) is "exit 78 on a rejected configuration". This is new behaviour: main did not refuse PGOPTIONS at all. | The refusal is correct and fails closed, and the message names only the variable. But orchestrators and runbooks key on 78 versus 1, and the output is not a structured log line. Same class as PR #9 R3-m1, which was routed to TASK-014. | Either check `PGOPTIONS` in `loadRuntimeConfigOrExit` (exit 78, structured), or catch `TenantTxConfigError` around `createRuntimeServices` in both entry points and exit 78. Add a `main`-level or config-loader test. Fix in the superseding branch (2 lines) or route to TASK-014 together with PR #9 R3-m1. |
| R3-n1 | NIT | `tools/eslint-rules/db-raw-sql.mjs:12-14, 281-317` | Container tracking follows declarators, assignments and member reads only. The Prisma namespace passed as a function argument, held in an object or array, copied by spread or `Object.assign`, chosen by `?:` or `\|\|`, or reached via `import().then(m => …)` is untracked (Probe D). `Reflect.get(db, '$parent')` and concatenated keys are not seen. The JSDoc "every binding derived from one" overclaims. | Deliberate-only. The run-time guard now refuses every `Sql` value, every non-template first argument and every escape key, so a lint miss becomes a `TenantDbAccessError`, not interpolation. The lint is the early control. | Reword the JSDoc ("declarations, assignments and member reads; other flows are refused at run time"). Optionally report any other value use of a tracked container (`helperValue`-style) and `Reflect.get`/`Reflect.apply` on a literal escape key. |
| R3-n2 | NIT | `tools/eslint-rules/tenant-context-sql.mjs:25-34`; `tenant-context-forms-drift.test.ts` | The TypeScript twin lacks two things both SQL lanes now have: the `U&` write form (`SET U&"\0061pp".org_id` is clean) and comment stripping (`SET app/**/.org_id` is clean) (Probe D). The drift test pins only `WRITE[1]` and `READ[0]`. | A session `SET` inside the transaction re-scopes the rest of it (round-2 R2-m2 impact). It is deliberate obfuscation only and needs a hard-coded org id. | Add `/\bu&["']/i` as a `session-set` (or new) form. Strip `/*…*/` and `--…` from the text before matching. Add both to the drift corpus, and pin `WRITE[5]` as well. |
| R3-n3 | NIT | `tools/db/lint-migrations.ts:566-568` | Rule 11's tracker sees only `SET [SESSION] lock_timeout` and `RESET`. `SELECT set_config('lock_timeout', '0', false)` raises the session value with no finding, because rule 16 exempts non-`app.` literal keys (Probe C). | It is the same persistence hazard D-ARCH-071 targets, and it is a plausible copy-paste from application code. | Treat `set_config('lock_timeout', <v>, false)` as a SET in the tracker (or flag it under rule 11 outright). Add a fixture, or list it in the stated limits. |
| R3-n4 | NIT | `tenant-db.ts:216-236` (`guardResult`) | The guarded result drops Prisma's fluent relation accessors. That is documented in the JSDoc, but the `TenantDb` type still declares them (`Prisma__XClient`), so `db.user.findUnique(…).posts()` type-checks and then fails at run time with a bare `TypeError`. | Developer experience: a type-correct call fails with an unhelpful error, normally caught by the first test. | Either map delegate return types to `PromiseLike<…>` in `TenantDb`, or make the result a Proxy that throws `TenantDbAccessError("fluent accessors are not exposed; use include/select")` for any other key (keeping `then` reads cheap). |
| R3-n5 | NIT | `eslint.config.mjs:99-131` (`TENANT_CONTEXT_EXEMPTIONS`) | No test asserts that each exempted file exists. The spk03 and spk08 entries rely on a comment ("remove in the deleting commit"). If they are left behind, a future file created at that exact path inherits `ALL_CONTEXT_FORMS` (spk03) or `keys` (spk08). | Exemptions are only safe while minimal; stale entries are invisible. | Export the list (or parse it) and add a unit tripwire: every `files` entry exists in the tree. |
| R3-n6 | NIT | `packages/shared/src/errors/catalogue/platform.ts:13,19`; `map-db-error.ts:11` | (i) `AUTHZ_DENIED` and `CONFLICT` now live in the platform catalogue. TASK-020 (authz denials) and TASK-036 (owner of `platform.ts`) must not redeclare them in a module file; that would fail loudly, not silently. (ii) `DbProblemCode` is a free string union, not tied to `ErrorCode`, so removing a catalogue entry is caught only at run time (fail-safe 500) and by the classify tests. | Coupling hygiene. | Note on the TASK-020/TASK-036 sheets. Define `DbProblemCode = Extract<ErrorCode, 'AUTHZ_DENIED' \| …>` (or a `satisfies` check) so a catalogue change is a compile error. |

### R3 §4. Architect "Required in PR #11" items: status at 37a2109

| # | Item | Status |
|---|---|---|
| 1 | Rule 11 session form only; `SET LOCAL` fails; `RESET` when > 3 s | **Done** (R3 §2.1; residue R3-n3) |
| 2 | Rule 15: `handedOver` removed; DEFINER outside the block fails; `OWNER TO platform_definer` fails; end-of-file role fails | **Done** |
| 3 | Rule 9 b | Done (round 2) |
| 4 | Rule 16 b operator atom | Done (round 2; atoms unchanged in round 3) |
| 5 | Qualified helper bodies | **Done**, byte-identical to §4.2 |
| 6 | `lc_messages = 'C'`, C13 five rows, `EXPECTED_ROLE_SETTINGS` | **Done** |
| 7 | C13 case folding + `proconfig` | Done (round 2) |
| 8 | Sheet lines D-ORCH-014 (a)–(f) and PR11-SEC-09 1–6 | **Done** except SEC-09 item 4 metric/sink deferral owners (R3-m1) |

### R3 §5. Good (keep)

- The lazy guarded-result design: a null-prototype frozen object, one shared `started` native promise, and a `closed` check before Prisma's `then` is ever called. It removes `requestTransaction` without eager execution, and late awaits fail with the domain error instead of P2028. The test asserts laziness (only BEGIN and the context statement before any await) as well as shape.
- Refusing every `Sql` fragment as a value at run time ("one template per statement shape; bind lists as arrays"). The lint is no longer the only control against nested raw.
- The drift test pins the ESLint twin's regex **sources** to the shared list, so drift is a test failure, not a review finding.
- `runtime.ts` as the single composition point: the pool and root client never escape, `startup()` orders the probes, the readiness gate is single-flight, and the latch is never cleared. The integration composition test checks event order, that no org id is logged, a counter of 1, a single latch log and 3 non-ready polls.
- The `classify.ts` `db` branch reads own-data only, checks code and status against the catalogue, and bounds `Retry-After`. Fail-safe tests cover forged, accessor and out-of-range fields.
- The C-series qualification test: a planted `public.current_setting` plus a hostile `search_path`, with an EXPLAIN that proves inlining survives.
- The merge resolution is a clean union with a short, honest description, and the developer flagged the lane A failures with root causes instead of pushing a workaround.

### R3 §6. Security flags; merge conditions; routing

**Security flags (for security-analyst):** nothing new above NIT. R3-n1/R3-n2 are lint-twin residues behind run-time controls (CWE-185, deliberate-only). Please confirm R2-M1 / PR11-SEC-12 closure and SEC-09 item 6 on the head named in your supersede round.

**Merge conditions (on the superseding branch, D-ORCH-018):**
1. The superseding branch's tree delta equals `git diff 63accea 37a2109`, plus any in-branch fixes for R3-m2 or the NITs. It contains no merge commit carrying `d68898a`'s first-parent content. A reviewer re-check is limited to "tree == 37a2109's tree rebased on main plus the listed fixes".
2. The D-ORCH-018 (2) lane A base-ref subset-semantics fix is merged on main first; lane A (fast-lane, scans, ci-gate) is green on the superseding head; the security record names that head.
3. R3-m1: the deferral owners are recorded (docs-only, orchestrator).
4. R3-m2: fixed in-branch, or routed to TASK-014 with PR #9 R3-m1 by orchestrator ruling.
5. The orchestrator (or lane B) re-runs integration (Docker) on the superseding head, because the run-time guard and the composition changed. Developer local evidence: 154 passed + 1 skipped on `9482f38`.

**Routing:**
- TASK-020: pass the generated `Client` into `databaseRuntimeFromConfig` (API and worker); the `tx` slot uses `tenantTx`; SEC-09 verification there; do not redeclare `AUTHZ_DENIED` (R3-n6).
- TASK-010: the security-logger sink for `security.*` events (R3-m1).
- Metrics/observability task: export the leak counter (R3-m1).
- TASK-014: R3-m2, if not fixed in-branch.
- TASK-021: delete the spk08 spike and its exemption in one commit; `U&` in the bootstrap lane (PR #5 R2-n1 remainder).
- TASK-015: delete the spk03 spike and its exemption with C-1 (unchanged).
- principal-architect: data-model §8.3 "Limits" text (R2-n2), still owed.
- PR #13 superseding branch: the `prisma-seed` boundaries category is still owed once PR #11 lands (PR #13 m6).
