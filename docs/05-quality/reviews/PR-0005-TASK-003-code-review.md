# Code review: PR #5, TASK-003 (Prisma 7 + PostgreSQL 18 baseline), round 1

| Field | Value |
|---|---|
| PR | https://github.com/sukhchdit/shipcube/pull/5 |
| Branch / head | `feat/TASK-003-prisma-7-postgresql-18-baseline` @ `d8ba197` (2 commits over `main` @ `363b87f`: `2e70cec` docs-only, `d8ba197` implementation; 91 files, +3,813/−44) |
| Reviewer | code-reviewer (independent), 2026-11-12 |
| Inputs | WAVE-00.md TASK-003; data-model.md §4.4, §7.1–7.3, §8.1–8.6; ADR-0005 am. 8, ADR-0018 §3, ADR-0023 am. F/I/J; D-ARCH-041, D-ORCH-004; P3 security review SEC-P3-34, SEC-P3-37; SPK-01; PR-0001 review (m6, R2-n5); PR #3 (TASK-005) diff for config keys |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: A careful, well-tested baseline. The bootstrap runner, the pinned schema engine (D-ARCH-041) and the harness
         are correct, and every deviation the developer flagged holds up on the merits. Zero BLOCKER, zero MAJOR.
         Nine MINORs are open. Three are linter bypasses I reproduced (rules 12, 13 and 10/2), and one is the
         db:reset loopback guard (bypassed by ?host=). The rest: a password-in-server-log exposure, missing DB timeouts,
         TASK-005 config reconciliation and data-model amendments. Merge is conditional on the items in §6.
```

## 1. Verification performed by the reviewer

**Constraint.** The orchestrator restricted this review because host memory is low and the branch's integration suite was already running in Docker. I did not run: `npm ci`, the build, `tsc -b`, ESLint, Docker, the integration lane or the full unit lane. Those results come from the PR body (database-engineer, head `d8ba197`) and from the orchestrator's integration run.

Node v24.22.3 under the fnm PATH prefix. The worktree stayed clean throughout (`git status --porcelain` was empty after every step).

| Check | Result |
|---|---|
| Prettier `--check` on every added or modified `.ts/.mjs/.json/.md` file of the diff | clean |
| `jest --selectProjects unit --testPathPatterns tools/db/lint-migrations` (the one allowed file) | 15/15 passed |
| Docs commit `2e70cec`: `gen.mjs .` (validate), then `gen.mjs . --write` on a `git archive` copy, diffed against the committed `task-map.csv` and `WAVE-*.md` | 0 errors, 0 warnings; the regenerated output is **byte-identical** to the commit |
| CLI entry points under `tsx` (`import.meta.main`): `lint-migrations.ts --no-validate`, `bootstrap.ts` without a URL, `reset.ts` without `--yes` | each runs `main()`: exit 0 clean, exit 1 "DATABASE_BOOTSTRAP_URL is not set", exit 1 "pass --yes". None is a silent no-op |
| **Linter probes** (scratch fixtures, `lintBootstrap`/`lintMigrations` imported read-only) | 0 findings for 4 audit-owner statements in a new bootstrap file (m1); 0 for `SECURITY DEFINER` after the body (m2); 0 for `WITH … UPDATE` and `ALTER TABLE … DROP IF EXISTS c` (m3). See the findings |
| **Reset-guard probe** | `resetTarget('postgresql://admin@127.0.0.1:5432/platform?host=db.prod.example.com', ['--yes'])` is accepted (m4). `pg-connection-string` 2.14.1 `index.js` gives the `host` query parameter precedence over the URL hostname |
| Code reading | every changed file in full, plus `pg-connection-string` and the data-model sections cited |

## 2. Findings

No BLOCKER and no MAJOR findings.

| ID | Sev | File:line | Issue | Required fix |
|---|---|---|---|---|
| m1 | MINOR | `tools/db/lint-migrations.ts:62-66, 73-75` | **Rule 12 in the bootstrap lane is narrower than data-model §8.3** ("statements that mention `platform_audit_owner` … count too"), and it is easy to bypass. A new bootstrap file containing the four statements below produced **0 findings** with an empty reviewer list. They are the RR-04/C13 paths the marker exists for. Today the backstop is the exact `pg_auth_members`/`pg_default_acl`/`rolcanlogin` assertions in `bootstrap.int.test.ts`, which run the real lane; C13 proper arrives in TASK-016. | Require the marker for **any** bootstrap statement that mentions `platform_audit_owner`. Exempt only `00-roles.sql` and `01-schemas.sql`, pinned by name **and** SHA-256: they are immutable through the ledger, so the exemption cannot drift. Add negative fixtures for all four forms. |
| m2 | MINOR | `tools/db/lint-migrations.ts:130-135` | **Rule 13 misses `SECURITY DEFINER` placed after the body.** `CREATE FUNCTION platform.f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql SECURITY DEFINER;` is valid PostgreSQL, and the probe gave 0 findings; the same function with the option before `AS` is caught. This matches data-model's wording ("header = text up to the body's opening AS"), but that wording has the hole. The boundary is C11/C14 (`proconfig`, TASK-016). | Test the statement with `dollar` and `string` tokens removed (the lexer already yields them) instead of the prefix before `AS`, for both `SECURITY DEFINER` and the `SET search_path` clause. Add a fixture. principal-architect amends the §8.3 rule 13 text (see §3). |
| m3 | MINOR | `tools/db/lint-migrations.ts:81-87` | **Rule 10 misses CTE-form data changes, and rule 2 misses `DROP` without the `COLUMN` keyword.** `WITH x AS (…) UPDATE t …` and `ALTER TABLE t DROP IF EXISTS c` both passed in an `expand` migration with `data-changing: no`. Rule 10 is what triggers the CLAUDE.md §5 backup/restore guardrail. Rule 10 is beyond the sheet's acceptance, but a silent pass is worse than no rule. | Add `^with\b.*\b(update\|delete\|insert\|merge)\b` to `DATA_CHANGING` and `drop\s+(column\s+)?if\s+exists` to `DESTRUCTIVE`, with fixtures. |
| m4 | MINOR | `tools/db/reset.ts:175-176, 200-207` | **The `db:reset` loopback guard checks only the URL hostname.** `pg` (via `pg-connection-string`) lets `?host=` override it, so `postgresql://admin@127.0.0.1/platform?host=db.prod.example.com` passes the guard, and `DROP DATABASE … WITH (FORCE)` would run against the remote host. Separately, the final `migrate deploy` uses `DATABASE_MIGRATOR_URL` unchecked, so it can migrate a different host or database than the one just recreated. | Parse with `pg-connection-string` (what `pg` uses) and check the **effective** `host`: loopback, or a Unix socket path. Reject `hostaddr`. Require `DATABASE_MIGRATOR_URL` to resolve to the same host, port and database. Add unit cases for `?host=` and for a mismatched migrator URL. |
| m5 | MINOR (security-analyst to grade) | `tools/db/bootstrap.ts:156-159`; `prisma/bootstrap/00-roles.sql:29-32` | **Passwords in the server log.** The role passwords are sent in plaintext inside one multi-statement simple query. On *any* error in `00-roles.sql`, PostgreSQL logs the entire statement text (`log_min_error_statement = error` is the default), and `log_statement = ddl` would log it on every run. Container or RDS logs would then hold `platform_app`/`platform_migrator` passwords, against the guardrail "secrets in logs = 0". This follows the data-model design (psql variables have the same exposure), so it is not a deviation, but the fix is cheap. | Substitute a client-side **SCRAM-SHA-256 verifier** (`node:crypto` PBKDF2-SHA-256, 4096 iterations, random salt → `SCRAM-SHA-256$4096:<salt>$<StoredKey>:<ServerKey>`) as the `PASSWORD` literal. PostgreSQL stores it as is, and the plaintext never reaches the server. Test that the substituted SQL contains no input value. |
| m6 | MINOR | `tools/db/bootstrap.ts:79-84, 122`; `tools/db/reset.ts:193-196` | **No timeouts on the bootstrap and reset sessions:** no connection timeout and no lock or statement timeout. `pg_advisory_lock` waits indefinitely when another runner, or a stuck session, holds the key, so a one-shot Compose or CI bootstrap job hangs instead of failing (CLAUDE.md §9). | Set `connectionTimeoutMillis` (e.g. 10 s). Run `SET lock_timeout` before the advisory lock (lock_timeout applies to advisory-lock waits), or use `pg_try_advisory_lock` with a deadline. Bound each file with `SET LOCAL statement_timeout`. |
| m7 | MINOR (route to TASK-005/006) | `apps/api/src/platform/db/client.ts:65-71` | **No statement timeout on the runtime pool.** The runtime role has `lock_timeout` and `idle_in_transaction_session_timeout` but no `statement_timeout`, and the pool sets no `statement_timeout`/`query_timeout`. A runaway query holds a pool slot, and the request, indefinitely (CLAUDE.md §9). | Add `statementTimeoutMs` → `statement_timeout` (pg `PoolConfig`), mapped from `DB_STATEMENT_TIMEOUT_MS` when the config schemas are reconciled. Alternatively, principal-architect records a role-level value. Acceptable as a tracked follow-up. |
| m8 | MINOR (merge-order item) | `client.ts:18-29`; `bootstrap.ts:201-208`; `reset.ts:189-192`; `prisma.config.ts:136-137` | **Config keys diverge from TASK-005 (PR #3) and ADR-0018.** See §4 for the full list. In short: two runtime timeout keys are missing from PR #3's schema; the `DB_POOL_MAX` bounds differ; the bootstrap passwords use a `_FILE` convention where ADR-0018 §3 prescribes `*_REF`; and the tooling-only keys are documented nowhere a developer would look. | Reconcile as described in §4 when the second of the two PRs rebases. |
| m9 | MINOR (owner principal-architect; merge condition) | `docs/03-architecture/data-model.md` :2573-2575, 2581-2582, 2593, 2619-2621, 2671-2675, 3803, 3826; §8.3 rule 13 :3792 | **data-model.md now contradicts the merged code.** The affected sections:<ul><li>§4.4: database owner, `CONNECT` grantees, `IN SCHEMA` default privileges, and the "Evaluation against Prisma 7" rows for `migrate deploy`, trusted extensions and bootstrap ordering</li><li>§8.4 step 2: `migrate resolve --rolled-back`</li><li>§8.6 step 4: "`ALTER DATABASE … OWNER`"</li><li>§8.3 rule 13: the header definition</li></ul>No Accepted ADR is contradicted (ADR-0005 am. 8 is silent on database ownership), so a data-model amendment is enough; no superseding ADR is needed. | principal-architect amends per the rulings in §3, and the orchestrator logs the decisions in DECISIONS.md before or at merge. |
| n1 | NIT | `docs/04-plan/generator/plan-data.mjs` (TASK-003 entry) → `WAVE-00.md:137` | The sheet still names `prisma/bootstrap/0001_roles_schemas.sql`. `2e70cec` regenerated the sheets but left this. Separately, `2e70cec` is labelled `(TASK-003)` but carries TASK-007/014/049/214 plan items. That is acceptable under D-ORCH-004, but a separate `docs(plan)` PR keeps task scope clean. | Change the entry to `prisma/bootstrap/00-roles.sql, 01-schemas.sql` and regenerate. |
| n2 | NIT | `tools/db/lint-migrations.ts:224, 240` | The approval date is compared with the wall clock, not the commit date as §8.3 says, and it is not checked to be a real date (`2026-02-31` passes). | Validate the date with `Date.parse` plus a round-trip. Compare with `git log -1 --format=%cs` when available. |
| n3 | NIT | `tools/db/*.ts`, `prisma/tests/**` | These import `pg` from the root context, but the root `package.json` does not declare `pg`/`@types/pg`; resolution relies on hoisting from the `prisma` and `apps/api` workspaces. | Declare them in root `devDependencies` (same versions), or note the hoisting reliance in the TASK report. |
| n4 | NIT | `bootstrap.ts:230`, `reset.ts:215`, `lint-migrations.ts:263` | The TypeScript entry scripts lack the `typeof import.meta.main !== 'boolean'` guard that the `.mjs` entries carry. On a runtime without `import.meta.main`, the CLI exits 0 having done nothing. Low risk with `engines.node >=24`. | Add the same guard. |
| n5 | NIT | `tools/deps/prisma-engines.mjs:216-221, 315-318` | `removePartialFiles` deletes *another* concurrent run's partial file. That run's `catch` then deletes every `schema-engine*`, including the verified engine, so two concurrent `deps:rebuild`/`prisma-cli` runs fail spuriously; this is fail-closed, not unsafe. Also, `Promise.all` leaves the sibling download running after a fatal error. | Delete only partial files whose pid is dead (the name already carries the pid), or take a lock. Abort the sibling request on failure. |
| n6 | NIT | `tools/test-support/fs-lock.ts:43-51` | Stale-lock takeover can race: two waiters both see a dead owner, A re-acquires, and B's `rmSync` removes A's lock. A lock directory left without an owner file (a crash between `mkdir` and `writeFile`) blocks waiters for the full 10 min. Test-only code. | Take over through an atomic `rename` of the stale directory. Treat an owner-less directory older than a few seconds as stale. |
| n7 | NIT | `client.ts:16` vs `00-roles.sql:32` | `APP_ROLE_CONNECTION_LIMIT = 200` duplicates the SQL literal. | Add a unit assertion that reads `00-roles.sql` and checks the two values match. |
| n8 | NIT | `prisma/tests/harness/postgres.ts:126-139` | The direct `_prisma_migrations` write is correctly confined to test code. Nothing stops a later tool from copying it. | Optional: TASK-007's policy script rejects `_prisma_migrations` writes outside `prisma/tests/**`. |
| n9 | NIT | `tools/deps/prisma-engines.int.test.ts:29-31` | The test deletes the worktree's real engine. Offline, it leaves the tree without an engine, and every later Prisma call fails until `npm run deps:rebuild`. The integration lane now also needs network access to `binaries.prisma.sh`. | State both points in the test header and in `prisma/README.md`. |

**m1 reproduction.** A new bootstrap file (no marker, reviewer list empty) with these statements produced 0 findings:
```sql
GRANT platform_definer, platform_audit_owner TO platform_migrator;
ALTER ROLE platform_audit_owner LOGIN PASSWORD 'x';
ALTER DEFAULT PRIVILEGES FOR ROLE platform_audit_owner GRANT ALL ON TABLES TO platform_app;
ALTER GROUP platform_audit_owner ADD USER platform_migrator;
```

**GOOD (keep these patterns):**
- **Engine pin.** The manifest is the trust anchor, and the transport hash is only a transport check. The forbidden-variable refusal happens before any file or network access and is case-insensitive. Other strengths: an atomic `wx` write followed by a re-hash; delete-on-any-failure; re-verification after every child; and a seam that exists only as a function parameter.
- **SEC-TC-64.** (i)–(v) are each a separate test, with a positive control proving that the poisoned cache sits exactly where `@prisma/fetch-engine` looks.
- **Bootstrap runner.** Integrity rules (changed, vanished, out-of-order files); fail-fast variable checks before anything is applied; one transaction per file together with its ledger row; `db_name` reserved; values never in messages. The lexer handles strings, dollar bodies, nested comments and psql variables, as psql does.
- **Catalog assertions.** They are exact (`toEqual` on `pg_auth_members`, `pg_default_acl`, `pg_db_role_setting`) and behavioural (42501 probes, a PUBLIC-EXECUTE probe). This is why m1 has a backstop today.
- **Reversibility test.** The up→down→up driver compares S0/S_down **and** S1/S2 as multisets of pg_dump statements. It has a negative control and handles PG 18 `\restrict`.
- **Runtime factory.** It fails fast with messages that never echo the URL, and rejects an `options` override. The test seam for the generated client avoids coupling to its location.

## 3. Deviation rulings (recommendation to the orchestrator and principal-architect)

| # | Deviation | Ruling | Architect amendment? |
|---|---|---|---|
| 1 | `00-roles.sql`/`01-schemas.sql` (data-model) instead of `0001_roles_schemas.sql` (sheet) | **Accept the PR.** The split is load-bearing: §8.6 step 4 runs only `00-roles.sql` before `pg_restore`, and `10-audit.sql`/`90-audit-ddl-guard.sql` slot in by number. The sheet is wrong. | No. Fix the sheet (n1). |
| 2 | Migrator does not own the database (SEC-P3-34 item 5) | **Accept.** The security review recommends it, D-ORCH-005/DECISIONS L867 "prefer", and it is proven by 42501 tests plus a passing `migrate deploy`/`status`/`db execute`. Consequences the amendment must record:<ol type="a"><li>New extensions need a new bootstrap file.</li><li>The shadow-DB init cannot `CREATE EXTENSION` (SPK-03).</li><li>The §4.4 claim "`CREATE SCHEMA IF NOT EXISTS "public"` … is a no-op: the database owner passes the CREATE-on-database check" is now **false**: PostgreSQL checks `CREATE` on the database before the `IF NOT EXISTS` test, so such a line in a `migrate dev`-generated migration fails with 42501 at deploy. That fails closed, but authors need the rule: strip it, or add a linter rule.</li><li>`migrate reset` stays unusable; `db:reset` replaces it.</li></ol>SEC-P3-34 named SPK-08 (TASK-012) as the evaluation venue; that evaluation is now implicitly done for `deploy`, but not for `migrate dev`. | **Yes**: data-model §4.4 SQL block, ownership table row, "Evaluation against Prisma 7" rows; §8.6 step 4 text. |
| 3 | Global `ALTER DEFAULT PRIVILEGES FOR ROLE … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` | **Accept; the claim is correct.** Per the PostgreSQL documentation, per-schema default privileges are *added* to the global ones, and a per-schema `REVOKE` only reverses a per-schema `GRANT`. The `IN SCHEMA` form is therefore a no-op, and the catalog test proves the global rows exist and work. Two notes for the amendment:<ul><li>The data-model's `IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC` lines (:2581, :2619) are no-ops for the same reason; tables have no PUBLIC default. The PR silently dropped them, which is correct; strike them.</li><li>The global form is broader than the spec (it also covers migrator functions in `public`). Any migrator-owned function that `platform_app` evaluates (column defaults, CHECK expressions, policies) needs an explicit `EXECUTE` grant in the C5 grant manifest; trigger functions do not. TASK-016 should know this.</li></ul> | **Yes**: §4.4 :2581-2582, :2619-2621; catalog checks C5/C11 expectations. |
| 4 | Up-down-up driver writes `_prisma_migrations.rolled_back_at` | **Accept. It is safe and confined.** The driver takes `markRolledBack` as a callback and has no CLI. The only implementation is the test harness, which connects as the migrator (the table's owner) and updates exactly one row matching `finished_at IS NOT NULL AND rolled_back_at IS NULL`. It asserts `rowCount === 1`. Prisma treats rolled-back rows as absent, and `migrate status` reports "up to date" afterwards (asserted). | **Yes**: §8.4 step 2. Optional guard n8. |
| 5 | Linter scope: header, rule 12, contract-reversible | **Meets the sheet's acceptance.** Extras implemented: rules 2, 10 and 13. Fix m1–m3. Rules 3–9 and 11 are not implemented and **need an owner** before the first module migration that alters an existing table. Recommend a tracked follow-up due before TASK-013/TASK-016 merge. Do not let the SEC-TC-33/NT-AVAIL-003-a IDs into test titles until then (correctly withheld today). | §8.3 rule 13 wording only (m2). |
| 6 | `db:reset` requires `--yes` and a loopback host | **Accept the design; fix the guard (m4).** | No. |
| 7 | SEC-TC-64 seam = function parameters only | **Confirmed.** No production caller passes `transport`, `install`, `target` or `manifestPath`. `run()` from the script entry passes no seams. Nothing is read from the environment or config. | No. |
| 8 | `prisma/tests/**` type-checked via `tools/tsconfig.json` | **Accept** (TS6307 is real for composite projects). Two consequences, both already within the documented order (`deps:rebuild` before `typecheck`):<ul><li>`client.ts` is checked in two projects.</li><li>`prisma/generated/**` is checked under the tools settings, so `typecheck` needs the generated client.</li></ul> | No. |
| 9 | `--passWithNoTests` removed from `test:integration` | **Accept** (SPK-01 §2 item 9). The lane now needs Docker **and** network (n9). | No. |
| 10 | Engine fetch/verify quality, error paths, timeouts | **Good.**<ul><li>Total-deadline timeout of 60 s per attempt; 3 retries with exponential backoff and jitter.</li><li>4xx responses and off-origin or non-HTTPS redirects are fatal and not retried; the redirect cap is 5.</li><li>Body caps: 128 MiB for the `.gz`, 1 KiB for the `.sha256`.</li><li>Transport check, then manifest check, then an atomic write.</li><li>Every path deletes `schema-engine*` on failure, and each one is tested.</li></ul>Only n5 remains. | No. |
| 11 | `client.ts` pool sizing and config keys | Sizing matches data-model §7.1 (defaults 10 s idle, 5 s connect; `poolMax` ≤ the role limit). Reconcile per §4; add a statement timeout (m7). | No. |
| 12 | Docs commit `2e70cec` | **Correct and reproducible.** The regeneration is byte-identical, and the SPK-01 correction matches D-ARCH-041 (1). n1 is open. | No. |

## 4. Config reconciliation with TASK-005 (PR #3), for m8

PR #3 head `be468bc` defines `DATABASE_URL` (required), `DATABASE_MIGRATOR_URL` and `SHADOW_DATABASE_URL` (optional), and `DB_POOL_MAX` (`int(1,100)`, default 10). Its `.env.example` parity test enforces "0 unknown keys". Whichever PR merges second does the following:

1. **Runtime keys go into the `packages/config` schema:**
   - `DB_IDLE_TIMEOUT_MS`: default 10000, range 1..3600000.
   - `DB_CONNECTION_TIMEOUT_MS`: default 5000, range 1..120000.
   - `DB_STATEMENT_TIMEOUT_MS`, if m7 is taken.

   The ranges and defaults must equal `client.ts`. `DB_POOL_MAX` is bounded at 1..100 in config and 1..200 in the factory. Keep the stricter config bound and document it; a unit test should assert that the config default equals the factory default.
2. **TASK-006's composition root maps the config onto `DatabaseClientOptions`.** The mapping is `{ connectionString: DATABASE_URL.reveal(), poolMax, applicationName: serviceName, … }`. `client.ts` stays config-agnostic, as designed.
3. **Tooling-only keys stay out of the runtime schema.** These are `DATABASE_BOOTSTRAP_URL` and the two bootstrap passwords. api/worker must never see the cluster-admin URL, which PR #3's key register already marks as "bootstrap only, outside this schema". Their secret form must follow ADR-0018 §3: rename `BOOTSTRAP_{MIGRATOR,APP}_PASSWORD[_FILE]` to `BOOTSTRAP_{MIGRATOR,APP}_PASSWORD_REF`, resolved with PR #3's `parseSecretRef` (`env:` / `file:/run/secrets/…`), instead of a second, ad-hoc `_FILE` convention. If principal-architect prefers Docker's `_FILE` idiom for one-shot tooling, record that exception in the ADR-0018 key register (holder `bootstrap`).
4. **Document the tooling keys.** Either a tooling section admitted by the parity check, or `prisma/README.md`. Today a developer has no documented way to run `db:bootstrap` or `db:reset`.
5. **The Compose passwords must match.** PR #3's `compose.env` `DATABASE_URL`/`DATABASE_MIGRATOR_URL` passwords must equal what the bootstrap job feeds into `00-roles.sql`. TASK-014 wires this through one Compose secret per role.

## 5. Follow-up closure check

| Item | Origin | Status after this PR |
|---|---|---|
| m6 / PR1-SEC-02: `prisma` under ignore-scripts with no unverified engine download | PR-0001 r1 → TASK-003 | **Closed** (code). Covered by the pin, the wrapper, no bare `prisma` in scripts, and the empty-directory integration acceptance. The manifest hashes and the two-environment recording still need security-analyst sign-off (CODEOWNERS). |
| R2-n5: the real-run `deps:rebuild` unit test now runs `prisma generate` | PR-0001 r2 → TASK-003 | **Closed.** Duration asserted < 36 s (a tenth of the L1 unit-job budget); the network-dependent run is in the integration lane. |
| SEC-P3-37 item 1 (default-privilege ordering and form) | P3 review | **Closed** in code; the data-model correction is pending (§3 #3). |
| SEC-P3-37 item 4 (two paths for the role script) | P3 review | **Open**, for principal-architect: strike `infra/compose/postgres/initdb/00-roles.sql` from data-model §4.4. |
| SEC-P3-34 items 1, 2, 5 | P3 review | **Implemented and tested**:<ul><li>Item 1: the role-in-database row.</li><li>Item 2: `options` on the runner, harness and reset sessions, with `SHOW search_path` checked.</li><li>Item 5: adopted.</li></ul> |
| SEC-P3-34 item 3 | P3 review | **Partial.** The assertion that no database-wide row exists, plus the bootstrap row, is tested here. The C13 extension is in TASK-016. |
| SEC-P3-34 item 4; SEC-TC-65 | P3 review | Item 4 is on the G4-production checklist. SEC-TC-65 is not claimed (correct). |
| SEC-TC-64 (i)–(v) / (vi) | D-ARCH-041 | (i)–(v) are covered. (vi) goes to TASK-014. |
| Other PR #1 watchlist items (TASK-002/004/007/014/015) | PR-0001 | Not touched by this PR; still open with their owners. |

## 6. Merge notes and conditions

1. **security-analyst:** no Critical/High open. In particular, they review:
   - `tools/deps/prisma-engines.json` (hashes, recording) and the forbidden-variable list;
   - the rule-12 interpretation (m1 is the code-level answer);
   - m5 (password exposure in the server log).
2. **D-ORCH-004 evidence on `d8ba197`:** `test:integration`, `build`, `npm audit --audit-level=high` and post-build `git status --porcelain`, re-run by senior-developer or by the orchestrator's in-flight run, posted on the PR. The PR body shows these only from the database-engineer run.
3. **DECISIONS.md entries** for the PR's decisions 1–9, with the §3 rulings. principal-architect amends data-model §4.4, §8.3 rule 13, §8.4 step 2 and §8.6 step 4 (m9). This can be logged at merge; it does not need a fix cycle.
4. **MINORs m1–m4 and m6:** fixing them in this PR is recommended. Each is under ~30 lines with a fixture, and m1–m3 have reproductions above. If they are deferred, track them as conditions with owners:
   - m1–m3 → TASK-016, before its first migration;
   - m4, m6 → TASK-014, the bootstrap one-shot.
5. **Other routing:**
   - m7 and m8 go to the TASK-005/TASK-006 reconciliation.
   - Rules 3–9 and 11 need a named owner before TASK-013/016.
   - The NITs are optional.
6. **Lock `prisma-core`:** no conflict expected with PR #3 (`packages/config`) beyond the §4 key alignment. PR #3 does not touch `package.json` scripts or `tools/tsconfig.json`; it does touch `package-lock.json`, so the second PR to merge rebases its lockfile.
