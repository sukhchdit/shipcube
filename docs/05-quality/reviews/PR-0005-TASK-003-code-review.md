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

## Round 2 (head 4574a14)

| Field | Value |
|---|---|
| Delta | `d8ba197..4574a14` (1 commit, `fix(db): review fix cycle 1`; 42 files, +733/−94) |
| Fix comment | https://github.com/sukhchdit/shipcube/pull/5#issuecomment-6825445288; decision D-TASK003-02 |
| Reviewer | code-reviewer (independent), 2026-11-12 |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: Every round-1 MINOR in scope (m1–m6) is closed. The SCRAM-SHA-256 verifier is correct: I reproduced the RFC 7677 §3
         ServerSignature independently, and the format matches PostgreSQL's. The db:reset guard now checks the host pg
         actually uses. Zero BLOCKER, zero MAJOR. Two new MINORs, both in classes that already existed before this fix
         (rule 13 accepts a second SET search_path; rule 10 cannot see data changes inside DO bodies), route to TASK-016.
```

### R2.1 Verification performed by the reviewer

**Constraint.** A merge-main pass was running in `Shipqube-TASK-003`, and the brief forbade commands in that worktree, `npm ci`, builds and Docker. I reviewed by SHA (`git diff`/`git show`). I did **not** re-run lint, format, typecheck, the unit, integration or coverage lanes, the build or `npm audit`. For those I rely on senior-developer's gate table on `4574a14` in the fix comment: lint/format/typecheck/build exit 0; unit 194/194; integration 28/28, including the new `session-safety.int.test.ts`; coverage 222/222; audit has 0 high and 0 critical; `git status` clean. The merge-main pass must repeat that gate on the merge commit.

| Check | Result |
|---|---|
| Read-only probe: `git archive 4574a14 tools/db prisma/bootstrap` into the scratchpad, `node_modules` junctioned to the **main** checkout, `tsx` script importing `lintBootstrap`, `lintMigrations`, `scramSha256Keys/Verifier`, `resetTarget`, `effectiveEndpoint` | 22 cases; results below |
| Independent SCRAM known-answer: HMAC(ServerKey from `scramSha256Keys('pencil', RFC salt)`, RFC 7677 AuthMessage) | `6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=`, which equals RFC 7677 `v=` |
| `pg-connection-string` 2.14.1 `index.js` read in full (the parser `pg` uses) | `?host=` takes precedence over the URL host; `?port=` takes precedence over the URL port; `?database=` is **overwritten** by the path (so it is harmless); `socket:` is refused by the protocol check |
| Lockfile at `4574a14` | `pg` 8.23.1, `pg-connection-string` 2.14.1, `@types/pg` 8.23.1. Each is a single hoisted copy, MIT, and the same version that `prisma`/`apps/api` already resolve (`^8.23.1`). No new package was resolved (n3 closed) |
| `00-roles.sql`, `01-schemas.sql`, `prisma-engines.json` | absent from the delta's name list (byte-unchanged; ledger and manifest hashes hold) |

Probe results (rules fired; `[]` = silent):

| Probe | Result | Assessment |
|---|---|---|
| bootstrap `ALTER ROLE platform_audit_owner NOLOGIN NOINHERIT` | `[]` | tightening form exempt (correct) |
| bootstrap: the `00-roles.sql` creation DO block, copied | `[]` | the SHA pin works; the block only creates missing roles `NOLOGIN`, so a copy is harmless |
| bootstrap `ALTER DEFAULT PRIVILEGES FOR ROLE platform_audit_owner IN SCHEMA audit REVOKE …` | `[]` | correct |
| bootstrap/migrations `GRANT U&"platform\005Faudit_owner" TO …` | `[]` / `[]` | **R2-n1** |
| bootstrap `DO … EXECUTE 'GRANT platform_audit' \|\| '_owner TO …'` | `[]` | R2-n1: a static analysis limit, backstopped by C13 |
| migration `… SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET search_path = public` | `[]` | **R2-m1** |
| migration `DO $$ BEGIN UPDATE public.t SET a = 1; END $$;` with `data-changing: no` | `[]` | **R2-m2** (unchanged from `d8ba197`) |
| migration `EXPLAIN ANALYZE UPDATE …` | `[]` | part of R2-m2 (exotic) |
| migration `ALTER TABLE t DROP CONSTRAINT IF EXISTS c` | `['2']` | correct |
| migration `WITH x AS (SELECT 1) INSERT INTO t VALUES (1)` / `WITH x AS (SELECT "update" …) SELECT …` | `['10']` / `['10']` | false positives that fail closed (R2-n2) |
| migration `WITH … FOR SHARE` | `[]` | correct |
| `scramSha256Verifier('a b'.repeat(10))` | `a role password must consist of printable ASCII characters only` | no echo (correct) |
| `scramSha256Verifier('a'.repeat(24))` | accepted | the floor counts length, not entropy (R2-n5) |
| `resetTarget(…?Host=/tmp)`, `…?ho%73t=evil.example` | refused | key check is case-insensitive and on decoded keys; pg's re-encode path never decodes more than WHATWG `URL` |
| `resetTarget('…@localhost/platform', …, '…@localhost/platform')` (both portless) | accepted, compared as `5432` | **R2-n3** (PGPORT) |
| `effectiveEndpoint('…@127.1/p')` → `resetTarget` | refused by `LOOPBACK_V4` (4 octets required) | conservative (correct) |

### R2.2 Focus areas

**SCRAM verifier (m5 / PR5-SEC-01): correct.**
- **Derivation.** PBKDF2-HMAC-SHA-256 = `Hi()`, with a 32-byte output. Then ClientKey = HMAC(salted, "Client Key"), StoredKey = SHA-256(ClientKey), ServerKey = HMAC(salted, "Server Key"). This is exactly RFC 5802 §3.
- **Parameters.** 4096 iterations is PostgreSQL's `scram_iterations` default and the RFC 7677 minimum; a lower value is refused. The salt is a fresh 16-byte `randomBytes` per call, which is PostgreSQL's `SCRAM_DEFAULT_SALT_LEN`.
- **Format.** `SCRAM-SHA-256$4096:<b64 salt>$<b64 StoredKey>:<b64 ServerKey>`, matching `scram_build_secret`. The two `$` are separated by `:`, so no dollar-quote tag can form inside a substituted literal, and base64 has no quote or backslash (tested).
- **Server side.** The integration test checks that `pg_authid.rolpassword` starts with `SCRAM-SHA-256$4096:` and that both roles log in with the plaintext. That proves the server parsed the literal as a verifier and did not hash the verifier text as a password.
- **SASLprep.** Restricting to `\x21-\x7e` makes SASLprep the identity, so the client-side verifier equals what the server derives at login. Excluding space is stricter than needed but harmless.
- **No plaintext anywhere.**
  - Reserved `*_password`/`db_name` caller variables are refused before connecting.
  - `ScramPasswordError` and `BootstrapError` messages carry the role key, never the value.
  - `describe()` returns only `message` and `SQLSTATE`.
  - The `log_statement=ddl` and error-path integration test asserts the absence of both passwords, with positive controls showing that the verifier DDL and the `STATEMENT:` line are present.
  - `readSecret` strips one trailing newline, so `*_FILE` secrets pass the control-character check.

**Rule 12 deny-by-default (m1 / PR5-SEC-02): closed.**
- **Allow-list.** It is anchored on the whole normalised statement (`^…$` for `ALTER ROLE` and `GRANT`). `WITH GRANT OPTION`, multi-grantee lists, `IN DATABASE … SET` and `RENAME` all fall through to "marker required"; there are 12 fixtures, and my probes agree.
- **What happens when `00-roles.sql` legitimately changes?**
  1. **After it has been applied anywhere,** it cannot change: the runner fails on a changed SHA-256, so the change must go in a new file. A new role-creation block in a new file names the audit owner, differs from the pinned hash, and therefore needs the `@audit-ddl` marker with a listed reviewer. That is the intended approval path, not a maintenance trap.
  2. **Before first apply,** any edit to the creation block fails two things at once: the linter (generic rule-12 message) and the unit test "exempts only the tightening forms of the real 00-roles.sql …". The editor then either adds the marker or updates `AUDIT_OWNER_CREATION_BLOCK` in `tools/db/lint-migrations.ts`, which is a reviewable change on a security-owned path (CODEOWNERS via PR5-SEC-04 → TASK-007).
  3. **Edits that do not touch the block** (comments outside it, other statements) do not affect the pin, because it hashes the collapsed statement, not the file.

  The only weakness is that the generic message does not name the pin (R2-n7).

**Rule 13 (m2): closed.** Code-only text (strings, dollar bodies and comments blanked) catches `SECURITY DEFINER`/`SET` after the body and ignores body text, with three fixtures. The string form `SET search_path = 'pg_catalog, pg_temp'` is now rejected; that is correct, because it would name one schema called `pg_catalog, pg_temp`. The residual is R2-m1.

**Rules 10/2 (m3): closed.**
- **Detection.** `^with\b.*(delete from|insert into|merge into|update)` catches data-modifying statements both inside and after the CTE.
- **Row locks.** The `(?<!\bfor |\bkey )` lookbehind is safe because `codeOnly` collapses whitespace and comments to one space.
- **Identifiers.** `\bupdate\b` does not match `update_count` (`_` is a word character).
- **Destructive forms.** `DROP [COLUMN] IF EXISTS` is added to rule 2, and `DROP CONSTRAINT IF EXISTS` was already covered.
- **Controls.** The false-positive control covers keywords inside strings, `FOR UPDATE`, `FOR NO KEY UPDATE OF`, and a plain CTE `SELECT`.

**Reset guard (m4 / PR5-SEC-03): closed.**
- **Effective host.** The host is the one `pg-connection-string` (and so `pg`) resolves. `host`/`hostaddr` query keys are refused case-insensitively on WHATWG-decoded keys before parsing. An empty host is refused, and only postgres schemes are accepted.
- **Loopback.** `localhost`, `::1`, `127.0.0.0/8` (four octets) or a socket path.
- **Migrator URL.** `DATABASE_MIGRATOR_URL` must resolve to the same host, port and database; there are cases for `?port=` and for unset.
- **Maintenance URL.** It is the validated URL with only its path changed. `?database=` cannot redirect it, because pg-connection-string overwrites `database` from the path.
- **Messages** never echo URLs.

**Timeouts (m6): closed.**
- **Connections.** `connectionTimeoutMillis` 10 s is the default; a caller may override it.
- **Lock wait.** `SET lock_timeout = <validated positive integer>` comes before `pg_advisory_lock`. lock_timeout applies to advisory-lock waits, and the 55P03 integration test proves it in under 20 s with no ledger created. The value persists, so DDL lock waits inside the files are bounded too.
- **Statements.** `SET LOCAL statement_timeout = '5min'` applies per file transaction; the reset admin session gets `60s`.
- **Deploy.** The `migrate deploy` spawn has a 10-minute timeout. `inFileTransaction` keeps the ledger INSERT inside the file's transaction, and ROLLBACK on failure is preserved.

**PR5-SEC-06: closed.** `gunzipSync(..., { maxOutputLength: 256 MiB })`. The seam is a function parameter only (SEC-TC-64 holds). There is a negative test and an at-the-cap positive control. The cap is twice the `.gz` cap and well above the engine's size.

### R2.3 Findings (round 2)

No BLOCKER and no MAJOR findings.

| ID | Sev | File:line (@4574a14) | Issue | Required fix |
|---|---|---|---|---|
| R2-m1 | MINOR (route TASK-016; fixing in this PR is optional) | `tools/db/lint-migrations.ts:115, 174-184` | **Rule 13 accepts a second `SET search_path` clause.** `FIXED_PATH` only needs to match *somewhere*. `CREATE FUNCTION … SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET search_path = public` lints clean (probe). PostgreSQL keeps the **last** value (`update_proconfig_value` → `GUCArrayAdd` replaces by name), so `proconfig` = `search_path=public`, the exact hijack rule 13 exists for. The same hole existed in the header form at `d8ba197`; m2 widened the scanned text to the whole statement. Backstop: C11/C14 `proconfig` equality (TASK-016). | In the code-only text, require exactly one `\bset search_path\b` occurrence, and require that it matches `FIXED_PATH`. Do this for CREATE and for ALTER FUNCTION/PROCEDURE. Add a fixture. |
| R2-m2 | MINOR (route TASK-016; not a regression) | `tools/db/lint-migrations.ts:124-132, 207-212` | **Rule 10 is blind to data changes inside `DO` bodies.** `DO $$ BEGIN UPDATE public.t SET a = 1; END $$;` in an `expand` migration with `data-changing: no` gives 0 findings, and so does `EXPLAIN ANALYZE UPDATE …`. Hand-written backfills in Prisma migrations are usually `DO` blocks, and rule 10 is what triggers the CLAUDE.md §5 backup/restore guardrail. It was equally blind at `d8ba197` (the `^update` anchor never matched `do …`). | For `DO` statements, split the dollar body with the existing lexer and apply `DATA_CHANGING` to each inner statement. Alternatively, treat any `DO`/`CALL`/`EXPLAIN ANALYZE` as data-changing unless `data-changing: yes`. Add fixtures. |
| R2-n1 | NIT (security-flag; route TASK-016) | `tools/db/lint-migrations.ts:63-64` | `U&"platform\005Faudit_owner"` (a Unicode-escape identifier) evades `AUDIT_OWNER_PATTERN` and `AUDIT_OBJECT_PATTERN` in **both** lanes (probe: `[]`, `[]`). String concatenation in dynamic SQL evades too, which is inherent to static linting. The security boundary remains C13 plus the exact `pg_auth_members`/`pg_default_acl` assertions. | Reject `u&"` and `u&'` in the code-only text of both lanes (no legitimate use in this repo). Record that dynamic-SQL construction is the accepted residual. |
| R2-n2 | NIT | `tools/db/lint-migrations.ts:131` | Rule 10 false positives (they fail closed): a quoted `"update"` identifier inside a CTE, and `WITH … INSERT INTO … VALUES`. A plain `INSERT … VALUES` is not flagged, so the CTE form is stricter than the plain one. | Accept, or align with `^insert into .* select`. Document either way in the rule comment. |
| R2-n3 | NIT | `tools/db/reset.ts:52, 72-77` | Portless URLs are compared as `5432`. However, `pg` falls back to `PGPORT` when the URL port is empty, while Prisma's engine uses 5432. With `PGPORT` set, drop/create/bootstrap and `migrate deploy` could hit different **local** clusters. Both are loopback, so the impact is low. | Require an explicit port in both URLs, or refuse when `PGPORT` is set and a URL has no port. |
| R2-n4 | NIT | `tools/db/reset.ts:98-105` | When the deploy times out, spawnSync kills the child and the tool returns 1 silently. | Write `deploy.error?.message` / `deploy.signal` to stderr. |
| R2-n5 | NIT | `tools/db/scram.ts:17, 51`; `prisma/README.md` | The 24-character floor counts length, not entropy (`'a'.repeat(24)` is accepted). It is not documented outside the code, although PR #3's `compose.env` is compliant (37/32 characters). | Document the floor and the printable-ASCII rule next to the tooling keys (round-1 m8 item 4). An entropy check is optional, since values come from the secret manager. |
| R2-n6 | NIT | `package.json` (root `pg-connection-string` 2.14.1) | The guard's correctness depends on parsing with **the same copy `pg` uses**. A later `pg` bump that needs a newer `pg-connection-string` would nest a second copy, and the guard would then silently diverge. | Add a unit assertion that `createRequire(require.resolve('pg'))('pg-connection-string')` resolves to the root copy, or resolve the parser through `pg`. |
| R2-n7 | NIT | `tools/db/lint-migrations.ts:89, 266` | When the creation block diverges from `AUDIT_OWNER_CREATION_BLOCK`, the developer sees only the generic "audit DDL needs the header" message. | Mention in the message (or the constant's comment) that both paths, marker or pin update, need security-analyst approval. |

### R2.4 Round-1 closure

| Item | Status @4574a14 | Evidence |
|---|---|---|
| m1 rule 12 bypasses | **Closed** | Deny-by-default allow-list plus the SHA-pinned creation block; the 12 `audit-owner-*` fixtures each fire with and without reviewers; the real lane lints `[]`; reviewer probes agree. Residual R2-n1 |
| m2 rule 13 after body | **Closed** | `codeOnly`; `definer-after-body` fixtures (positive, negative and body-only). Residual R2-m1 |
| m3 CTE / `DROP IF EXISTS` | **Closed** | `cte-and-drop-if-exists` (10, 10, 2, 2) and the `cte-select` control `[]`. Residual R2-m2 (pre-existing) |
| m4 reset guard | **Closed** | `effectiveEndpoint` and the migrator match; 4 + 1 refusal URLs, 5 mismatch cases, 3 accepted forms. Residual R2-n3 |
| m5 / PR5-SEC-01 password in server log | **Closed** | `scram.ts` (independently verified against RFC 7677), reserved variables, PG 18 `log_statement=ddl` integration test with controls |
| m6 timeouts | **Closed** | connect, lock, statement and spawn bounds; 55P03 integration test |
| m7 runtime `statement_timeout` | Routed → TASK-006 (fix comment) | Still open with its owner |
| m8 config keys | **Closed on the PR #5 side.** PR #3 owns the reconciliation (D-ORCH-006 item 5, D-TASK005-02) | The `_FILE` convention is retained by D-TASK005-02 instead of `_REF`. ADR-0018's key register still does not record that exception (architect NIT) |
| m9 data-model amendments | **Partly closed** | D-ARCH-045..049 recorded. Still open: data-model §8.3 rule 13 still says "header (the text up to the body's opening `AS`)" (:3823), and the rule-12 bootstrap wording in D-ARCH-049 ("own role attributes … need none") is now **superseded by the stricter code**, which allows NO* attributes only. principal-architect amends both at merge. No fix cycle needed |
| PR5-SEC-02/03/06 | **Closed** (code) | security-analyst to confirm in its R2 delta |
| n1 plan sheet | **Closed** on main (D-ARCH-048; WAVE-00.md:135) | |
| n3 root `pg` deps | **Closed** | lockfile versions match; nothing newly resolved |
| n2, n4–n9 | Open, optional | unchanged by the delta (`reset.ts`/`bootstrap.ts` still use a bare `if (import.meta.main)`: n4) |
| Rules 3–9, 11, 14 owner | **Closed**: TASK-016 (D-ARCH-049); header comment updated | |

### R2.5 GOOD

- Plaintext passwords are removed by construction rather than by redaction. The `passwords` option is typed separately from `vars`, and `*_password` variables are refused outright, so a future caller cannot reintroduce plaintext by accident.
- The SCRAM known-answer test checks **behaviour**: the RFC ServerSignature, and the client proof recovered and checked against StoredKey. It does not just check the format.
- The log-safety integration test uses a sentinel to flush the server log and asserts **positive controls** (verifier DDL present, `STATEMENT:` present) before asserting absence. Without the controls, the absence assertion could pass vacuously.
- The fixtures follow a pattern worth keeping: each fix has a minimal fixture, a false-positive control and a real-lane `[]` control.
- The reset guard uses the driver's own parser, which removes the class of parse-differential bugs instead of patching one URL form.

### R2.6 SECURITY-FLAGS (for security-analyst)

1. **The verifier is now in the DDL log.** `log_statement=ddl` (or pgaudit ROLE) now records the SCRAM verifier, which is equivalent to the contents of `pg_authid`. It enables offline guessing, and with StoredKey plus one observed exchange, client impersonation without TLS. With ≥ 24-character secret-manager passwords and TLS, the risk is INFO. Confirm that DB logs are classed as sensitive, or that production `log_statement` stays `none`.
2. R2-n1: `U&` identifier evasion of rule 12 in both lanes. Low; C13 is the boundary.
3. R2-m1: duplicate `SET search_path` passes rule 13. C11/C14 is the boundary.
4. PR5-SEC-06 cap and seam: verified as a function parameter only.

### R2.7 Merge conditions

1. **Re-run the gate on the merge commit.** The merge-main pass re-runs lint, format, typecheck, unit, integration, build, `npm audit` and `git status` on its merge commit and posts the results. I could not re-run anything this round.
2. **security-analyst R2 delta.** No Critical/High open; it covers the SCRAM path, the rule-12 allow-list and the engine gunzip cap.
3. **principal-architect, at merge.** Amend data-model §8.3 rule 13 (code-only, anywhere, exactly one SET) and the rule-12 bootstrap wording (deny-by-default; supersede D-ARCH-049's "precision" sentence). Record the `_FILE` exception in the ADR-0018 key register.
4. **Routing.**
   - R2-m1, R2-m2, R2-n1 and R2-n2 → TASK-016, due before its first migration and in the same batch as rules 3–9/11/14.
   - R2-n3 and R2-n4 → TASK-014 (bootstrap one-shot) or optional.
   - R2-n5 → the PR #3 reconciliation docs.
   - R2-n6 and R2-n7 are optional.
