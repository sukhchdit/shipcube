# Code review: TASK-034 backup/restore rehearsal, linter rule R and zero-downtime probe (round 1, pre-push)

| Field | Value |
|---|---|
| Task | TASK-034 (Wave 0, batch 0.10), card in `docs/04-plan/tasks/WAVE-00.md`, brief `docs/04-plan/briefs/TASK-034.md` |
| Branch | `feat/TASK-034-backup-restore-rehearsal-zero-downtime` |
| Head reviewed | `6feac2e8` (one commit on base `530629f4`) |
| PR | none yet (pre-push; the orchestrator renames this record when the PR exists) |
| Round | 1 |
| Reviewer | code-reviewer |
| Date | 2026-11-21 |
| Verdict | **CHANGES_REQUESTED** (2 MAJOR, 4 MINOR, 8 NIT) |

```
VERDICT: CHANGES_REQUESTED
SUMMARY: The drivers, the manifest, the harness change, PR5-SEC-14, PR11-SEC-11 d, rule 14 and PR293-SEC-04 (b) are
  sound and well tested (343 unit tests green, 97.5 % line / 94.4 % branch on the new files). Two defects block:
  the documented --migration path can never write a record, because `prisma migrate status` exits 1 when the
  data-changing migration is pending, which is the state rule R requires (M1). And the PR293-SEC-04 (a) fallback
  still differs from the lexed path: a comment before a DML statement hides it when the body does not lex, and a
  PG-valid E-string continuation is enough to make it not lex (M2; proved on PGlite and the linter, base and head).
```

## 1. What I verified myself

I ran nothing in the PR worktree. Instead I used a `git archive 6feac2e8` extract (and a `530629f4` extract of `tools/` for base-versus-head probes) in the session scratchpad, with `node_modules` linked by junction to the main checkout. Every command ran in the foreground with a timeout of 8 minutes or less. No Docker.

- **Diff and context.** I read every changed file in full, plus the neighbours it depends on:
  - `tools/db/{sql-text,up-down-up,bootstrap,reset}.ts`
  - `packages/config/src/db-tls.ts`
  - `prisma.config.ts`
  - `compose.yaml` (`postgres` service)
  - `tools/ci/check-migration-immutability.mjs`
  - `tools/quality/required-suites.json`
  - the `nfr-traceability.md` rows
  - data-model §8.6/§8.7
  - DECISIONS D-SECPR293-02, D-ORCH-139 and D-ARCH-172

  I also grepped every caller of `bootstrapConnection` (the harness, `bootstrap.int`, `session-safety.int`, `audit-actions-v2.int` and both new suites) and of `lintRepository`/`lintRehearsals`.
- **Unit tests.** I ran 11 suites with `--selectProjects unit --maxWorkers=2 --testPathPatterns tools/db/(backup|pg-archive|rehearsal-|verify-restore|zero-downtime|reset|bootstrap|lint-migrations)`: **343 passed**. The repository-lane pin `lintRepository(repoRoot)` reports no findings.
- **Coverage of the new files** (same run, `--coverage`): 97.53 % statements / 94.35 % branches. Per file:

  | File | Branch coverage |
  |---|---|
  | `backup.ts` | 85.2 % |
  | `verify-restore.ts` | 83.3 % |
  | `pg-archive.ts` | 93.2 % |
  | `rehearsal-manifest.ts` | 99 % |
  | `rehearsal-record.ts` | 97.3 % |
  | `zero-downtime-probe.ts` | 98.1 % |
  | `reset.ts` | 90.7 % |

  The card asks for at least 85 % line and 75 % branch: met.
- **Type-check.** I ran `tsc -p tools/tsconfig.json` with the tsbuildinfo redirected to the scratchpad. There are 0 errors in `tools/db/**`, `prisma/tests/harness/**`, `prisma/tests/migrations/**` and the `bootstrapConnection` call sites. All remaining errors are TS6305/TS2345 cascades from the unbuilt `prisma/client` reference in an archive extract (environment, not the PR).
- **Format and lint.** Prettier `--check` on the 26 non-SQL changed files passes. ESLint on the changed `.ts` files gives 2 `import-x/no-extraneous-dependencies` hits on `@platform/config`. Both are extract artefacts: the import in `bootstrap.ts` is unchanged from base line 37, and the extract resolves the package through the junction, outside the copy.
- **Probes** (tsx and PGlite, scratchpad):
  - Prisma 7.10 `migrate status` source (`node_modules/prisma/build/cli.js`): the `databaseIsBehind` branch prints "Following migration have not yet been applied" and calls `process.exit(1)`. The command calls `diagnoseMigrationHistory({ optInToShadowDatabase: false })`, which does no schema diff. Basis of M1.
  - Rule 10 fallback, base versus head (`probe-fallback.mts`, 7 shapes) and PGlite execution of the DO bodies. Basis of M2.
  - `pg` merge semantics: `parse('postgresql://u:p@localhost:5433/db')` yields only `user, password, host, port, database`. `new ConnectionParameters({ connectionString, options })` keeps `options`. The harness's `superuser()` therefore still pins `search_path`. `databaseConnectionSettings` with no `sslmode` gives `ssl: false`, the same TCP behaviour as the old `{ host, port, … }` object.
  - Linearity of the PR293-SEC-04 (a) fallback, with the exact helper of the unit test repeated 8 times: the ratio time(4n)/time(n) was 3.67–4.43 against a bound of 8 (about 7 ms versus 27 ms). On 320k repeats: 171 ms, and 338 ms for a `with … (select ';')` shape. Linear.
  - Prisma's handling of a migration file: `prisma/tests/migrations/concurrent-index.int.test.ts` (TASK-016) proves that Prisma 7.10 `migrate deploy` does **not** submit a file as one implicit transaction. The new zero-downtime suite's statement-by-statement application therefore matches deploy. I checked this before raising it, and there is no finding.
- **Not re-run (no Docker, host rule):**
  - `prisma/tests/migrations/backup-restore.int.test.ts` and `zero-downtime.int.test.ts`;
  - every lane-B suite that consumes the changed `bootstrapConnection`;
  - the Compose CLI path (`docker compose exec -T`);
  - full `npm run lint`, `typecheck`, `build`.

  For these I rely on lane B (merge condition C2) and on the evidence asked for in m3.

## 2. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| M1 | **MAJOR** | `tools/db/verify-restore.ts:97-102`, `:264-274`, `:216-234`; runbook `docs/07-ops/runbooks/backup-restore.md:36`, `:53`, `:56` | See [M1](#m1-the-documented---migration-path-can-never-pass). | See [M1](#m1-the-documented---migration-path-can-never-pass). |
| M2 | **MAJOR** | `tools/db/lint-migrations.ts:769`, `:799-816` (`quoteAwareSegments`) | See [M2](#m2-the-pr293-sec-04-a-fallback-still-differs-from-the-lexed-path). | See [M2](#m2-the-pr293-sec-04-a-fallback-still-differs-from-the-lexed-path). |
| m1 | MINOR | `tools/db/lint-migrations.ts:1737-1766`; runbook `:58-63` | See [m1](#m1-rule-r-re-judges-released-migrations-for-ever). | See [m1](#m1-rule-r-re-judges-released-migrations-for-ever). |
| m2 | MINOR | `verify-restore.ts:12-14`; runbook `:53`, `:70` | See [m2](#m2-migrate-status-does-not-prove-the-tablesexternal-window). | See [m2](#m2-migrate-status-does-not-prove-the-tablesexternal-window). |
| m3 | MINOR | `tools/db/pg-archive.ts:108-147` | See [m3](#m3-the-compose-cli-path-is-untested-and-the-archive-write-can-fail-unseen). | See [m3](#m3-the-compose-cli-path-is-untested-and-the-archive-write-can-fail-unseen). |
| m4 | MINOR | `prisma/tests/migrations/zero-downtime.int.test.ts:108`, `:130`, `:141`; `backup-restore.int.test.ts` titles; commit body D-TASK034-04/05 | See [m4](#m4-the-nt-ids-in-the-test-titles-overclaim). | See [m4](#m4-the-nt-ids-in-the-test-titles-overclaim). |
| n1 | NIT | `tools/db/rehearsal-manifest.ts:56-60` | The JSDoc says "the statement timeout bounds one table scan (30 min)". The session comes from `connectPrivileged`, whose client `query_timeout` is `QUERY_TIMEOUT_MS` = 310 s (`bootstrap.ts:58`). A fingerprint or anti-join slower than 5 min 10 s therefore fails client-side with a pg read timeout, not the 30-min server bound. | Fix the text, or open the rehearsal sessions with a larger client `query_timeout`. |
| n2 | NIT | `.dockerignore` | `reports/` (where `platform.dump` with every row is written) is git-ignored but not docker-ignored, so every `docker compose build` sends the dump in the build context. No image copies it (explicit COPY paths). | Add `reports` next to `coverage` (PR27-SEC-01 hygiene). Security-owned file: coordinate. |
| n3 | NIT | `verify-restore.ts:293-336` | `--migration` is validated (name, data-changing header, head equals previous) only after the full restore and a printed PASS. | Run `writeRehearsalRecord`'s pre-checks before `CREATE DATABASE`, so the tool fails fast with nothing printed as PASS. |
| n4 | NIT | `lint-migrations.ts:1739-1741`, `verify-restore.ts:218-220` | "previous" is the previous *directory*, which may have no `migration.sql`. Prisma refuses such a folder anyway. | Use `listMigrations` semantics (directories with `migration.sql`) in both places, or say why not. |
| n5 | NIT | `zero-downtime-probe.ts:329` | The probe's `pg.Pool` has no `'error'` listener. An idle-client error (a backend terminated during a migration) crashes the CLI with a stack instead of a verdict. This is the PR #13 class. | `pool.on('error', …)` counting a failure. |
| n6 | NIT | `zero-downtime-probe.ts:170`, `:209-216` | A request saturated during warm-up yields `fail`, but the doc says any warm-up problem makes the run INVALID. | Count warm-up saturation into `invalid-workload`, or document it. |
| n7 | NIT | `pg-archive.ts:100-103` | On timeout, SIGKILL reaches the `docker` client only. `docker compose exec` does not stop the exec'd `pg_dump`/`pg_restore` in the container. | One line in the runbook, or `docker compose exec` with a `timeout` wrapper in the container. |
| n8 | NIT | runbook `:15` | `docker compose exec` resolves the Compose project from the working directory, so a worktree (`../Shipqube-TASK-xxx`) talks to its own project. The mismatch fails closed (unknown snapshot, missing scratch database) but the message is opaque. | One sentence, or a `--project` flag mapped to `composeArgs`. |

### M1: the documented `--migration` path can never pass

**Issue.** The rehearsal record for a data-changing migration M needs a backup whose `_prisma_migrations` head is the migration *before* M. Rule R, `writeRehearsalRecord` and runbook §1 ("apply every earlier migration, but not this one") all require that state. They also need `prisma/migrations/M/migration.sql` to exist in the same run, because the record hashes it.

`verifyRestoredDatabase` then requires `prisma migrate status` (root config, `migrations.path = prisma/migrations`, the same folder) to exit 0 with "Database schema is up to date". On a restore that is exactly one migration behind, Prisma takes the `databaseIsBehind` branch: it lists M and calls `process.exit(1)` (`node_modules/prisma/build/cli.js`). The verdict is therefore always `fail`, and no record is ever written. The first data-changing migration is blocked, unless someone hand-writes a record, which the runbook forbids (`:72`). The failure is closed, but the guardrail's only legitimate path is dead.

**Why the tests miss it.** The int test `[NT-DATA-004-c] the passed rehearsal becomes the record …` runs status against the repository folder, where the backup head *is* the last migration. It then writes the record into a temp root holding a synthetic `29991231000000_rehearsal_probe`. The unit test `with --migration writes the rehearsal record after a pass` fakes the status.

**Required fix.** Choose one of these and record it (D-TASK034-09):

- **Preferred:** after the manifest comparison and the orphan check, run `prisma migrate deploy` with the root config against the scratch database, then require status "up to date". This also rehearses M on the restored data, which is the point of §8.6. The card already says "status/deploy".
- **Alternative:** with `--migration M`, accept `databaseIsBehind` only when the unapplied list is exactly `[M]`.

Tests:

- a unit case in which the fake status returns the real `databaseIsBehind` text and exit 1;
- an int case whose migrations root is a copy of `prisma/migrations` plus a data-changing M, with status and deploy pointed at that root. A `prisma.config` fixture like `prisma/tests/fixtures/updown/prisma.config.ts` works.

### M2: the PR293-SEC-04 (a) fallback still differs from the lexed path

**Issue.** The card asks for "the same code-`;` split as the lexed path". The lexed path never sees comments: `sqlText` turns them into a space. In the fallback (a body that does not lex), comments stay in the text, and `quoteAwareSegments` tracks only `"` and `'`. So any `--` or `/* */` comment between a `;` and a DML statement leaves the segment starting with the comment, and no rule-10 start matches. A quote inside a comment (`-- don't`) also desynchronises the quote state.

A PG-valid way to make a body not lex is the E-string continuation (`E'x'` newline `'y'`, the PR293-SEC-02 shape that `tokenize` refuses with `EscapeContinuationError`).

**Proof** (`data-changing: no` migration, rule 10 only):

| Shape | Base `530629f4` | Head `6feac2e8` |
|---|---|---|
| (A) plain UPDATE, body lexes | RULE10 | RULE10 |
| (B) plain UPDATE, body does not lex | RULE10 | RULE10 |
| (C) `-- tidy up` line before the UPDATE, does not lex | **clean** | **clean** |
| (D) `PERFORM 1; -- don't` before the UPDATE | **clean** | **clean** |
| (E) `/* x */ DELETE FROM …` | **clean** | **clean** |
| (G) control C, body lexes | RULE10 | RULE10 |

PGlite runs (C), so the UPDATE applies (`note` = 1), and runs (D) with a DELETE, so the table is emptied. The gap is pre-existing, but this PR is the designated fix for this fallback. Because rule R keys on the header, the consequence is a data-changing migration without a rehearsal (CWE-184).

**Required fix.** Make the fallback reader comment-aware with linear cost. Skip a `--` comment up to `\n` or `\r` (scan.l), skip a nested `/* */` comment, and pass dollar-quote tags through. Emit segments with comments replaced by one space. Do this in `quoteAwareSegments`, or better in a tolerant tokenizer mode reused by both paths.

Tests:

- shapes C, D and E as rule-10 hits;
- a comment holding `;` and `'`;
- the existing linearity bound extended to comment-heavy text.

A security delta round re-runs its fuzz.

### m1: rule R re-judges released migrations for ever

**Issue.** `lintRehearsals` judges *every* data-changing migration on every run, and "previous" is whatever directory sorts before it today. Suppose a migration that sorts *before* a released data-changing migration merges later (two parallel PRs with migration timestamps in the opposite order to their merge order). The released record then goes stale.

The record cannot be refreshed: `check-migration-immutability.mjs` refuses any added or modified file in a released directory. The finding lands on a file the second PR did not touch, and main stays red if the second PR merged on a stale CI run. Runbook `:63` "repeat steps 1 and 2" is impossible for a released migration.

**Required fix.** Record a decision and implement one of these:

- (a) a linter or immutability rule that a new migration directory must sort after every directory on the base, with a message naming the rename;
- (b) rule R judges freshness only for migrations added relative to the base, and keeps a format check for released records.

Update the runbook either way.

### m2: `migrate status` does not prove the `tables.external` window

**Issue.** The code and the runbook say that `migrate status` with the root config "proves that the generated `tables.external` audit-partition window holds on a restored database". Prisma 7.10 `migrate status` runs `diagnoseMigrationHistory({ optInToShadowDatabase: false })`: it compares history only and computes no schema diff, so the external-tables filter is never exercised beyond config load.

**Required fix.** Reword to what is proven: the root config loads, and the history is up to date or deployable. If the window must be proven, add a `migrate diff` (from the database to the migrations) with the root config and require an empty result. Merge this with M1's rewrite.

### m3: the Compose CLI path is untested, and the archive write can fail unseen

**Issue.**

1. `runProcess` resolves on the child's `'close'` without waiting for the `stdoutFile` write stream to finish. A late sink error (ENOSPC on the final flush) calls `fail()` after the promise settled, so it is lost: `db:backup` exits 0 with a truncated `platform.dump`. Verify catches it later, but the backup exit code lies.
2. No test exercises the real CLI composition. The int tests use container-local `--file` paths, and the unit tests use fake runners. The untested composition is:
   - `docker compose exec -T` binary streaming of a custom-format archive to a host file on Windows;
   - `pg_restore` of a non-seekable stdin, which needs archive order and cannot use `--jobs`.

**Required fix.**

1. Resolve only after the sink's `'finish'` (or `'close'`), and check `sink.errored`.
2. One recorded run of `npm run db:backup` and `npm run db:verify-restore -- --backup …` on the Compose stack (exit codes and report totals) in the round-2 hand-off, or a `tests/compose` case.

### m4: the NT IDs in the test titles overclaim

**Issue.** Tests are titled `[NT-AVAIL-003-b]`, but that row specifies the previous api image (the last release tag, **or the previous `main` image before the first tag**) under a 20 rps k6 probe. The premise of D-TASK034-05 ("needs a release image") is therefore not what the NT row says, and no task in `task-map.csv` owns the image-level probe.

`[NT-REC-003-a]` likewise lists bucket copy, catalog C1–C14, chain and anchors, document SHA-256 and `/health/ready`. These are deferred by D-TASK034-04 or replaced by the schema digest.

The lane-B trigger in `required-suites.json:168` and `nfr-traceability.md` is the marker `-- @data-changing`, but the header rule R keys on is `-- data-changing: yes`, so the conditional suite selection never fires.

**Required fix.**

- Keep the IDs, but have the trace or `STATUS.md` mark both as partial.
- The orchestrator names an owner task for the image-level probe and for each D-TASK034-04 item.
- Route the marker mismatch to qa-lead. Activation is qa-lead's, so no change is needed in this PR.

## 3. Rulings on D-TASK034-01..08

| ID | Ruling |
|---|---|
| D-TASK034-01 (rule R) | **Accepted in design, blocked by M1.** "Fresh without a clock" (the SHA-256 of `migration.sql` plus the backup head equal to the previous migration) is sound. Running it in `lintRepository` (the CLI, plus lane A through the `lintRepository(repoRoot)` pins in `lint-migrations.test.ts:1464` and `rehearsal-record.test.ts:162`) keeps the fixture outcomes unchanged. Bypass analysis: (i) a hand-written record is a procedural residual, stated in the header and runbook and covered by CODEOWNERS `/prisma/migrations/`; it is acceptable because §8.6 puts the real control in the M5 CD pipeline; (ii) a record copied between migrations is refused (name plus SHA); (iii) a dishonest `data-changing: no` header is rule 10's job, so its blind spots (stated limits plus **M2**) are rule R's blind spots; (iv) a record proves the procedure ran on *some* database at the right head (an empty dev database passes), not on production-like data, which matches the design. See m1 for permanence. |
| D-TASK034-02 | (a) **Not met**: see M2. Linearity is proven and fine. (b) **Accepted.** It fails closed, is pinned with a prose control, a variable-path control and a declared-`yes` control, and the reasoning (narrowing to EXECUTE misses `format()`, variables and `query_to_xml`) is right. |
| D-TASK034-03 (manifest) | **Accepted.** An accidental miss needs a 60-bit collision per changed row (about 2^-60). The sum is `numeric`, so it has no wrap. The row count is compared separately. The `ONLY` scan per leaf partition plus the excluded partitioned parents are right. The superuser bypasses RLS (OI-16). The pinned GUCs cover every text-output-sensitive type in use (timestamptz, date, interval, float, bytea, money). The `null` and `""` fields of a composite are distinct. The scheme is not tamper-resistant (k-sum forgery is feasible), but restore fidelity, not tampering, is the threat. Residuals: n1 (effective 310 s per statement), and `oid`/`reg*` columns (none today). Same snapshot: the exported RR snapshot is shared by both `pg_dump` calls and the manifest, and the int test proves it under concurrent inserts. Sequences read first and "ahead allowed" is correct. |
| D-TASK034-04 | **Accepted** (no tables or features yet). Owners: see m4. |
| D-TASK034-05 | **Accepted as an interim** database-level probe (open loop, warm-up validity, saturation counted as failure, the old-code column list taken before the migration, and a RENAME negative control). The premise needs correcting and an owner is needed: m4. |
| D-TASK034-06 | **Accepted.** Verified: every `pg_dump`/`pg_restore` argv is an array without a shell. No password appears in any argv: the image's `local all all trust` socket is used, and `infra/local/env/postgres.env` sets no auth override. Database names, snapshot ids, service names and roles are regex-checked before they reach a flag. `errorSummary` masks quoted fragments. All three CLIs refuse a non-loopback URL through `effectiveEndpoint` (host and hostaddr query refused, as `pg` resolves it). A Compose project or Docker context that differs from the URL's server fails closed: the exported snapshot id is unknown there, and the scratch database is missing there. |
| D-TASK034-07 | **Accepted.** PR5-SEC-14 is enforced in the type (`PrivilegedUrlConnection`) and at run time (before any client), with the `main` test "URL unset: returns 1, connectPrivileged never called". The harness's `{ connectionString }` is verified safe (see §1 probes; the base64url password needs no encoding beyond what is applied). Every lane-B suite depends on it, so condition C2. PR11-SEC-11 d: one open with `O_RDONLY | O_NONBLOCK | O_NOFOLLOW`, `fstat` on the descriptor, a bounded read of max+1, `EISDIR` mapped for Windows. The residual swap of an intermediate directory between `realpath` and `open` goes to security. |
| D-TASK034-08 | **Accepted.** Statistics statements change with ANALYZE, not with the schema. |

Card items:

| Item | Status |
|---|---|
| PR5-SEC-14 | met |
| SPK-08 F-01 (root config) | met, with the semantics fixed by M1/m2 |
| PR11-SEC-11 d | met |
| Rule 14 CREATE CAST and CREATE AGGREGATE | met (two fixtures, rows 4-5 pins removed, row 3 pin kept) |
| PR293-SEC-04 (b) | met |
| PR293-SEC-04 (a) | **open** (M2) |
| No new dependency, no lock change | met |

## 4. Merge conditions

- **C1.** Fix M1 and M2 (with the tests named above) and m1–m3. Round-2 code review on the fix head. m4 may be routed by the orchestrator instead of fixed.
- **C2.** Lane B on the final head, 0 failures and 0 skips:
  - `migrations`: `backup-restore.int.test.ts` (5 cases plus the concurrent-writes case) and `zero-downtime.int.test.ts` (3 cases);
  - every suite that consumes the changed `bootstrapConnection` or `connectPrivileged`: `bootstrap.int`, `session-safety.int`, `audit-actions-v2.int`, and through the harness the whole `integration`, `catalog-c1-c14` and `rls-cross-tenant` projects.

  Quote the totals in the hand-off.
- **C3.** Security delta round on the `tools/db` linter change (security-owned). It re-fuzzes the fallback after M2 and rules on the intermediate-directory residual of `readSecretFile`. Run the hosted `security-integration` job when CI billing allows (D-ORCH-146).
- **C4.** The Compose CLI evidence of m3 (2).

## 5. Good

- I/O-agnostic drivers with injected ports, and `main` dependencies injectable and asserted to be the real ones in tests.
- Messages carry counts and table names only. The `errorSummary` masking is good.
- The exported-snapshot design is proven under concurrent writes.
- "Ahead, never behind" sequence semantics.
- The generated anti-joins use the constraint's own `conpfeqop` with operator-name validation.
- The scratch database is never reused and is dropped in `finally`.
- `wx` writes: a backup is never written over another.
- Rule R is pinned on the real repository in two suites.
- The record checks are given precise reasons.
- PR5-SEC-14 is enforced in both the type and the run-time check.

## 6. Security flags (for security-analyst)

1. M2: a rule-10 bypass in the unlexable fallback (comment before DML plus a PG-valid E-string continuation). Pre-existing on main, and it feeds rule R (CWE-184).
2. Rule R records are unsigned claims. The bypass by hand-written record is procedural (CODEOWNERS). Confirm that this is acceptable until the M5 pipeline.
3. `readSecretFile`: `O_NOFOLLOW` covers only the final component. An intermediate-directory swap between `realpathSync` and `openSync` is a residual.
4. n2: the dump is in the Docker build context (`.dockerignore`).
5. Other implicit-call shapes next to rule 14 that are worth a look in the delta round:
   - `CREATE TYPE … AS RANGE (subtype_diff = w)`, called by GiST builds;
   - a `CREATE DOMAIN … CHECK (w(VALUE))` call site, where rule 10 sees the name, so it fails closed.
