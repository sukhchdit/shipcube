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
