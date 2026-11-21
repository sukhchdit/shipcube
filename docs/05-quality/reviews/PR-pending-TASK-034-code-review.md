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

---

# Round 2 (pre-push, after fix cycles 1 and 2)

| Field | Value |
|---|---|
| Head reviewed | `3ee36f01` (`6feac2e8` + fix cycle 1 `9c40d31e` + fix cycle 2 `3ee36f01`; base still `530629f4`) |
| Delta reviewed | `git diff 6feac2e8..3ee36f01`: 30 files, +1785 / -320, no lockfile change |
| Lane-B evidence | `20261121T1443Z_3ee36f0` (uncommitted in the worktree), verdict PASS |
| Round | 2 |
| Date | 2026-11-21 |
| Verdict | **APPROVED_WITH_NITS** (0 BLOCKER, 0 MAJOR, 1 MINOR, 3 NIT) |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: Both round-1 MAJORs are closed. --migration now deploys the migration on the restored data before the status
  check (M1), and the rule-10 fallback is a comment-aware tolerant reader with a lexed-path differential test (M2).
  m1-m3 and n1-n8 are fixed, m4 is routed (D-SD-012), and the C4 harness-only proof (D-ORCH-160) is delivered and green
  in lane B. One new MINOR: the rehearsal record hashes migration.sql as it is at write time, not as deployed.
```

## R2.1 What I verified myself

Under the dispatch constraints I ran no npm, Node or Docker command. I used git, grep and file reads only.

- **Delta.** I read every changed production file in full: `verify-restore.ts`, `prisma-outcome.ts` (new), `sql-text.ts` (`tolerantRead`, `decodeLineBreaks`), the rule-10 part of `lint-migrations.ts` (`bodyDataChanging`, `doBlockChangesData`, `writingRoutineCall`, `lintRehearsals`), `rehearsal-record.ts`, `pg-archive.ts`, `bootstrap.ts` (`readSecretFile`), `zero-downtime-probe.ts`, `check-migration-immutability.mjs`, the fixture `prisma/tests/fixtures/rehearsal/prisma.config.ts`, the harness change, `.dockerignore` and the runbook. I read the new and changed tests in `verify-restore.test.ts`, `prisma-outcome.test.ts`, `pg-archive.test.ts`, `lint-migrations.test.ts`, `sql-text.test.ts`, `check-migration-immutability.test.ts`, `backup-restore.int.test.ts` and `zero-downtime.int.test.ts`.
- **Lane B `20261121T1443Z_3ee36f0`.** `git_sha` is `3ee36f01…`, `git_dirty` false, `build_clean` true, and the Postgres image digest equals `compose.yaml:24`. Results: unit 8403 passed with 2 skipped (both are `packages/config/src/file-secret-provider.test.ts` platform skips, pre-existing and outside TASK-034), integration 430/0/0/0, catalog-c1-c14 113/0, rls-cross-tenant 157/0, api 179/0. Merged coverage is 99.48 % lines and 97.3 % branches. `integration.junit.xml` holds all 11 TASK-034 cases: 6 in `backup-restore.int` (including the R1-M1 case), 5 in the C4 describe, and 3 in `zero-downtime.int`. The `bootstrapConnection` consumers ran green with them (C2).
- **Tolerant reader by hand.** It is linear: each dollar opener's `indexOf` region is consumed, the tag scan runs over disjoint identifier runs, and unterminated pieces jump to the end. The continuation state survives white space and `--` comments but not `/* */` (scan.l `quotecontinue`). The E-prefix test is bounded by `codeStart`, as the lexer's is.
  - **Escape decoding.** An escape the linter does not decode (`\x27`, `\'`) cannot hide DML, because every string body is also re-read as SQL down to `MAX_DYNAMIC_DEPTH`.
  - **Normalisation.** Dropping the outer `normalise` before `tokenize` is also more faithful: dollar tags are case-sensitive in PostgreSQL, and `E'…'` plus a newline is a continuation only while the newline exists.
- **Union exposure.** I diffed `530629f4..main` against `530629f4..3ee36f01`. The only shared file is `package.json` (scripts against devDependency bumps, separate hunks). Main added 4 migrations, all `data-changing: no`, so rule R adds no finding on the union. I read their routine bodies, and none holds a rule-10 form under the new reading. Lane B on the merge result stays the orchestrator's condition.

## R2.2 Round-1 findings

| ID | Status | Evidence |
|---|---|---|
| M1 | **Closed** | `verifyRestoredDatabase` (`verify-restore.ts:108-133`) compares and runs the anti-joins first, then runs `migrate deploy` (root config, `prismaMigrate('deploy')`, `:317-326`, 30 min), then `migrate status`. The verdict needs both. `writeRehearsalRecord` refuses a report without `migrateDeploy.ok` (`:283-285`). Rule R requires `verification.deployed === true` (`rehearsal-record.ts:80`). Tests: the unit test uses the real `databaseIsBehind` text and exit 1 (`verify-restore.test.ts:55-59`, `:237-275`); a failed deploy fails even with an up-to-date status (`:277`); the int case copies `prisma/migrations`, adds a data-changing M and runs the real Prisma 7.10 through the fixture config. It shows status alone behind (`pending = [M]`), then deploy, status up to date, 3 rows present and the record accepted by `lintRehearsals`. The fix-cycle-2 parser (`prisma-outcome.ts`) reads both streams, which closes the D-ORCH-154 failure. D-TASK034-09 and -14 are accepted. |
| M2 | **Closed** | `tolerantRead` (`sql-text.ts:218-326`) blanks `--` (LF or CR) and nested `/* */` comments, passes strings, names and dollar bodies through, keeps an E-string's escapes live across a continuation, and returns every literal body. The lexed path now blanks comments too, and an E-string body has its line-break escapes decoded (`decodeLineBreaks`) before it is read as SQL. Tests: shapes C, D and E, a nested comment holding `;` and `'`, a lone CR, and WITH, each a rule-10 hit through `lintTexts` (`lint-migrations.test.ts:1405-1441`); comment-only DML controls stay clean; `\n` and `\012` dynamic SQL is caught; linearity covers comment-heavy text (300 KB against 1.2 MB). The differential test asserts `tolerantRead` equals the token reading on every `LEXER_CASES` and `ATOMIC_BODY_CASES` text (`sql-text.test.ts:394-457`), a strong pin. D-TASK034-13 is accepted. The fuzz is security's (C3). |
| m1 | **Closed** | `checkMigrationChanges` refuses a new directory that sorts before the last base directory (`migrations/added-out-of-order`, once per directory, rename named). `ls-tree -d` lists directories only, so `migration_lock.toml` cannot be "last". The test is `check-migration-immutability.test.ts:90-104`. Runbook `:69` was updated. D-TASK034-10 is accepted. Residual: R2-n2. |
| m2 | **Closed** | `verify-restore.ts:15-18` and runbook step 5 now say that status proves the config loads and the history matches, and that it does not prove partition coverage. |
| m3 | **Closed** | (1) The runner settles only after the sink's `'close'` (`pg-archive.ts:160-166`). A late `ENOSPC` gives `code: null` and the error line. Tests: slow sink, final-flush ENOSPC, and a real file of 70 000 bytes (`pg-archive.test.ts:169-215`). (2) C4: see R2.3. |
| m4 | **Closed (routed)** | The titles and describes say "(partial)". D-SD-012 item 6 routes the image-level probe and the marker stream or `/health/ready` to TASK-119, the documents to TASK-147 and the chain to TASK-116 (`WAVE-03.md:685`, `:771`; `WAVE-05.md:92`). The marker mismatch goes to qa-lead's activation PR. The STATUS partial marks are the orchestrator's. Stale text: R2-n1. |
| n1 | Closed | `rehearsal-manifest.ts:56-61`: the text now names the 310 s client timeout. |
| n2 | Closed | `.dockerignore` adds `reports`, pinned in `check-dockerignore.test.ts`. |
| n3 | Closed | `rehearsalTarget` runs before any database work (`verify-restore.ts:360`). Test `:571`. |
| n4 | Closed | `migrationNames` (directories with `migration.sql`) is shared by rule R and the writer. Test `:360`. |
| n5 | Closed | `pool.on('error')` counts `idleErrors`, which fail the run. Test `zero-downtime-probe.test.ts:203`. |
| n6 | Closed | Warm-up saturation gives `invalid-workload`. Test `:169`. |
| n7 | Closed | In-container `timeout -k 10 <s>`, with the host grace 30 s longer, and exit 124 mapped. The same image as Compose ran it in lane B. |
| n8 | Closed | `--project` goes through `ArchiveTarget` to `docker compose -p`, validated by `PROJECT_NAME`. Runbook prerequisite added. |
| Security flag 3 | Fixed (security rules) | `readSecretFile` re-resolves after the open, requires the result under the root and requires the same `dev`/`ino` (bigint) as the descriptor. Both swap orders are tested (`bootstrap.test.ts:178-245`). D-TASK034-12 is for security-analyst. |

## R2.3 C4: the harness-only proof (D-ORCH-160)

**Delivered as D-ORCH-160 specifies.** `backup-restore.int.test.ts:353-559` (describe at `:363`) runs `main` of `db:backup` and `db:verify-restore` with `BACKUP_DEPENDENCIES` and `VERIFY_RESTORE_DEPENDENCIES`: real argument parsing, the URL rules, `connectPrivileged`, `00-roles.sql`, `composeArchiveTool` with the real `runProcess`, and the real `prismaMigrate('status')` with the root config. There is one substitution: the runner rewrites the asserted prefix `compose -p harness_c4 exec -T postgres` to `docker exec -i <container>`.

What it proves:

- The custom-format archive streams binary (the `PGDMP` magic and NUL bytes) to a host file over the docker CLI's stdout on the Windows lane-B host.
- `pg_restore` reads a non-seekable stdin from the host, with exit 0.
- The report totals equal the manifest, and the scratch database is dropped.
- The `wx` refusal leaves the archive unchanged.
- A truncated archive gives exit 1 with one masked line and no report.
- The `tsx` entry points set exit code 1 with no secret on stderr.

Not proven, as the commit states and D-ORCH-160 accepts: Compose's own project and service lookup. No manual Compose run is owed.

## R2.4 New findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R2-m1 | MINOR | `tools/db/verify-restore.ts:280-299` (with `:277`), `:360`, `:392-395` | See [R2-m1](#r2-m1-the-record-hashes-migrationsql-as-it-is-at-write-time-not-as-deployed). | See [R2-m1](#r2-m1-the-record-hashes-migrationsql-as-it-is-at-write-time-not-as-deployed). |
| R2-n1 | NIT | `docs/07-ops/runbooks/backup-restore.md:101`, `:104-110`; `tools/db/zero-downtime-probe.ts:19-21`; `prisma/tests/migrations/zero-downtime.int.test.ts:108`; `tools/db/verify-restore.ts:24-25` | The texts say the image-level NT-AVAIL-003-b job has "no owner task yet" and list the D-TASK034-04 items without owners. D-SD-012 has since routed them to TASK-119, TASK-147 and TASK-116. | Name TASK-119, TASK-147 and TASK-116, or drop the "no owner" clause. A text-only change. |
| R2-n2 | NIT | `tools/ci/check-migration-immutability.mjs:53`, `:72-78`; `.github/workflows/ci.yml:157-163` | See [R2-n2](#r2-n2-the-out-of-order-rule-has-a-stale-ci-residual). | One sentence in the runbook or the D-TASK034-10 text naming the stale-run residual and its detector. |
| R2-n3 | NIT | `tools/db/prisma-outcome.ts:29-30`, `:55` | `listedUnder` stops at the first line that is not a bare migration name. If a future Prisma prints indented names, `trim()` handles them, but a bulleted form (`- name`) would give an empty `pending` list. Fail-closed (the verdict still needs exit 0 and "up to date"), so this affects reporting only. | None now. Re-pin `BEHIND` on the next Prisma bump. |

### R2-m1: the record hashes `migration.sql` as it is at write time, not as deployed

**Issue.** `writeRehearsalRecord` calls `rehearsalTarget` again after the run (`:281`). That re-reads `migration.sql` and binds the record to the bytes it finds **then**. The JSDoc `:277` says so ("the files may have changed during the run").

The deployed bytes are the ones Prisma read during `migrate deploy`, which can be 30 minutes or more after the fail-fast read at `:360`. If the author edits `migration.sql` during the rehearsal (a fix noticed while waiting, or an editor save), the record carries the SHA of unrehearsed bytes. Rule R accepts it, because the record SHA equals the committed file. That is exactly the case rule R exists to refuse.

`main` also prints `PASS` (`:392`) before the write, which can still throw (exit 1 after a PASS line). That is a smaller version of the R1-n3 concern.

**Why it matters.** The record is the only artefact behind the CLAUDE.md §5 guardrail until M5. It should bind the bytes that were rehearsed.

**Fix.** Do one of these:

- **Preferred:** after the deploy, read `checksum` of M from `_prisma_migrations` on the scratch database. Prisma stores the SHA-256 hex of the applied file. Carry it in the report, and have `writeRehearsalRecord` require that `sha256(current bytes)` equals it, else refuse ("migration.sql changed during the rehearsal").
- **Or:** keep the bytes read at `:360`, pass them through, and refuse at write time when the current bytes differ.

Write the record before printing `PASS`, or print a FAIL line when the write throws.

Tests:

- a unit case that changes `migration.sql` between the deploy fake and the write, which must be refused;
- the int R1-M1 case asserting that the report's checksum equals the record's `migrationSha256`.

Not a merge blocker: no `data-changing: yes` migration exists yet, so the first real use comes after the merge. The fix fits the activation PR or a follow-up.

### R2-n2: the out-of-order rule has a stale-CI residual

**Issue.**

- The new `migrations/added-out-of-order` rule compares against the **merge base**.
- Lane A runs the gate tools from the tested base, so this rule protects the PRs after this one.
- A PR whose CI ran before a later-timestamped migration merged can still merge on that stale run.
- A released data-changing record then goes stale on main. The `lintRepository(repoRoot)` pins in lane A turn red on the next run, which fails closed but lands on an unrelated PR.

**Fix.** Name this residual and its detector in the runbook or in D-TASK034-10. Requiring branches to be up to date before merging closes it.

## R2.5 Rulings on D-TASK034-09..14

| ID | Ruling |
|---|---|
| D-TASK034-09 (deploy then status; record needs `deployed`) | **Accepted.** It also rehearses the migration on restored data (§8.6). The rejected alternative (accept exactly `[M]` pending) would not have done that. Residual: R2-m1. |
| D-TASK034-10 (out-of-order directory refused) | **Accepted.** The rule also protects Prisma's deploy order on existing databases. Residual: R2-n2. |
| D-TASK034-11 (partial NT IDs, premise corrected, routings) | **Accepted.** The owners now exist (D-SD-012). Text: R2-n1. |
| D-TASK034-12 (`readSecretFile` re-resolve plus dev/ino) | **Accepted in design.** The ruling belongs to security. |
| D-TASK034-13 (rule 10 reads bodies as written; `tolerantRead`) | **Accepted.** The differential test against the token reading is the right pin. |
| D-TASK034-14 (`prisma-outcome.ts`, report v1 fields added) | **Accepted.** Adding fields keeps `v1` readable. Masking covers quoted values and `=(…)` key values. |

## R2.6 Merge conditions

- **C1.** Met: M1, M2 and m1–m3 are fixed, and m4 is routed. R2-m1 is MINOR. Fix it before the first `data-changing: yes` migration is rehearsed (the activation PR or a follow-up card) or before this merge, as the orchestrator decides. R2-n1 to R2-n3 are optional.
- **C2.** Met on `3ee36f01` (lane B `20261121T1443Z_3ee36f0`). The evidence must be committed, and lane B must run on the merge result with main.
- **C3.** Open: security round 1 on `3ee36f01`, which re-fuzzes `tolerantRead` and rules on D-TASK034-12.
- **C4.** Met by the harness-only proof (D-ORCH-160).
- **C5.** D-TASK034-01..14 accepted by reference in DECISIONS.md (none are there yet), and the record renamed once the PR exists.

## R2.7 Good

- `prisma-outcome.ts` turns a stream-ordering flake into structured `pending` and `failed` lists, and its tests cover all three stream layouts.
- The `tolerantRead` differential test against the token reading over the shared case corpora.
- The C4 proof asserts the exact Compose prefix and the in-container argv, then swaps only the transport.
- `verified before deploy` is asserted in both the unit test (step order) and the int test (`differences = []` after the deploy).

# Round 3 (pre-push, fix cycle 3, D-ARCH-238 F1 to F15)

| Field | Value |
|---|---|
| Head reviewed | `1bac00b1` on `feat/TASK-034-backup-restore-rehearsal-zero-downtime` (pushed; local and origin equal) |
| Chain since round 2 | `447e23fd` lane-B evidence of `3ee36f01`; `1a0cdeaf` merge of origin/main `88fd7360` (#80 to #84); `e17f1d6d` merge of local main `3b807c24` (docs only, D-TASK034-15); `1bac00b1` fix cycle 3 |
| Fix delta | `git diff e17f1d6d..1bac00b1`: 45 files, +2064 / -178 (20 new fixture files, no fixture changed, no lockfile change) |
| Lane-B evidence | run-live78 on `1bac00b1` (the orchestrator's; not committed yet, not read by me) |
| Round | 3 |
| Date | 2026-11-21 |
| Verdict | **APPROVED_WITH_NITS** (0 BLOCKER, 0 MAJOR, 1 MINOR, 5 NIT) |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: Both merges are byte-identical to git's own clean merge, and package.json is the only path changed on both
  sides. F1 to F15 of D-ARCH-238 are implemented as specified, each with a test that a reverting mutant fails. R2-m1,
  R2-n1 and R2-n2 are closed, and no earlier lint fixture or expectation changed. One new MINOR: the rule-14 range regex
  misses a quoted name that holds ";" (C17 (b) and the gate still catch it).
```

## R3.1 What I verified myself

Under the dispatch constraints I ran no npm, Node, Jest or Docker command. I used git, grep and file reads only. Test outcomes rest on lane B run-live78.

- **Merge purity.**
  - `1a0cdeaf` has parents `447e23fd` and `88fd7360`, merge base `530629f4`. `e17f1d6d` has parents `1a0cdeaf` and `3b807c24`, merge base `88fd7360`. For each parent pair, `git merge-tree --write-tree` prints exactly the commit's tree (`ae7b792b`, `473c956f`), so neither merge holds a hand resolution.
  - Files changed on both sides:
    - `1a0cdeaf`: `package.json` only. The branch side adds three `db:*` scripts and the main side bumps devDependencies, in separate hunks. `git diff 88fd7360 1a0cdeaf -- package.json` is exactly the branch's three script lines.
    - `e17f1d6d`: none.
  - Raw-diff equality, with `package.json` excluded:
    - `diff --raw 88fd7360 1a0cdeaf` equals `diff --raw 530629f4 447e23fd`.
    - `diff --raw 447e23fd 1a0cdeaf` equals `diff --raw 530629f4 88fd7360`.
    - For the docs merge, `diff --raw 3b807c24 e17f1d6d` equals `diff --raw 88fd7360 1a0cdeaf`, so the branch delta is carried unchanged.
    - `88fd7360..3b807c24` touches `docs/**` and `.claude/agent-memory/**` only.
- **The fix.** I read in full:
  - every changed production file: the new `load-time-code.ts` and `private-files.ts`; rules 10, 14 and 21 and the down.sql pass of `lint-migrations.ts`; `verify-restore.ts`, `backup.ts`, `rehearsal-manifest.ts`, `pg-archive.ts`, `prisma-outcome.ts`, `rehearsal-cli.ts` and `zero-downtime-probe.ts`;
  - every new or changed test, the 10 new fixtures and the runbook diff;
  - `tokenize` and `sqlText` in `sql-text.ts`. Token texts concatenate back to the statement, which the offset-preserving `blankedCode` relies on.
- **Spec.** D-ARCH-235 to D-ARCH-238 on main. In data-model (in the worktree through `e17f1d6d`): §4.6 C17, the §8.3 rule-14 amendment and rule 21, the §8.6 second amendment and the C17 fence.
- **The 81 earlier fixture outcomes.**
  - No fixture file was modified. `diff --name-status` over `tools/db/fixtures` shows 20 `A` and nothing else.
  - `lint-migrations.test.ts` has no removed line. The one addition to an existing expectation table is the row for the new `create_range_type` fixture.
  - A static scan of every pre-existing fixture and every pre-existing inline test SQL finds a load-time clause in 6 fixtures. The four `CHECK (…platform.app_org_id())` hits are policy `WITH CHECK` clauses, which `LOAD_TIME_STATEMENT` excludes. The rest call no routine.
  - In `prisma/migrations/**` the load-time clauses call only `char_length`, `octet_length`, `lower` and `IN` lists. The 5 `platform.app_*_id()` hits are policies.
  - So rule 21 adds no finding to an existing outcome or to `lintRepository`. Lane B confirms this by execution.

## R3.2 F1 to F15

Each row names the mutant I checked by reading (the change reverted, or the stated wrong variant) and the assertion that fails on it.

| Item | Status | Evidence and killing test |
|---|---|---|
| F1 (R2-m1) | **Closed** | **Change.** After a successful deploy, `verifyRestoredDatabase` reads `_prisma_migrations.checksum` (base table, `APPLIED_CHECKSUM_SQL`) into `report.rehearsed`. `writeRehearsalRecord` refuses a missing, null or other-migration checksum, and refuses when the SHA-256 of the `migration.sql` bytes differs from it (`verify-restore.ts:363-370`). `main` writes the record before the PASS line, and a refusal becomes one FAIL line and exit 1.<br>**Mutants.** No checksum comparison: the unit case that edits `migration.sql` after the deploy fake gets through the write, and `toThrow(/changed during the rehearsal/)` fails. PASS printed first: `sink.lines` is not `[]` in the CLI case. Checksum read after a failed deploy: `rehearsed` is not null.<br>**Int.** The R1-M1 case runs real Prisma, asserts that `report.rehearsed.checksum` is the SHA-256 of the file bytes, and the record binds that value. |
| F2 (SEC-02) | Done | **Change.** `private-files.ts` creates folders with recursive `mkdir` `0o700` (plus `chmod` on POSIX), writes new files `wx` `0o600`, replaces the report with `w` plus `chmod`, and opens the sink `wx` `0o600`. `backup.ts`, `pg-archive.ts` (sink) and `verify-restore.ts` (report) use it.<br>**Mutants.** Drop the chmod or change a mode: the recording-fs `toEqual` call lists fail on every platform. The POSIX real-mode cases are skipped on the Windows host. |
| F3 (SEC-03) | Done | **Change.**<br>- `maskValues` masks escaped quotes and nested groups, innermost first. It cuts at 2 000 characters, and an open quote or parenthesis ends the line.<br>- `allowedFacts` keeps the Prisma codes, the SQLSTATE and the first `ERROR:` line, masked (none for class P0).<br>- `errorSummary` drops the server message after `ERROR:`, `FATAL:` or `PANIC:`.<br>- `failureOf` masks, and withholds P0 messages.<br>**Mutants.** The old free-text tail: every sentinel case (a `randomBytes` value) fails `not.toContain(value)`. P0 not withheld: the exact P0001 detail fails. The old `errorSummary`: `'refusing row s3cr3t'` survives and the `toBe` fails. |
| F4 (SEC-04) | Done | **Change.** `(t.*)::pg_catalog.text`.<br>**Mutant** `t::text`: the unit `toContain` fails, and so does the int case (a column named `t`; changing `secret` must change the checksum). |
| F5 (SEC-06) | Done | **Change.** For rule 10 (DO blocks and the routine call-site half), `bodyText` replaces `ESCAPE_STRING_MARK` with a space. Rule 16 still reads the marked text.<br>**Mutant** without the replacement: X4 through `lintTexts` gives rule 16 only, and `toEqual([[…'10'], […'16']])` fails. The control without the escape keeps rule 16 only. D-TASK034-16 wording accepted. |
| F6 (SEC-08) | Done | **Change.** The `prismaChildEnvironment` allow-list, used by `db:verify-restore` and the probe.<br>**Mutant** `{ ...env }`: the exact `toEqual` of the child environment fails. The bootstrap URL, the passwords, `NODE_OPTIONS` and `PRISMA_*` are excluded. |
| F7 (D-ARCH-237) | Done, with R3-m1 | **Change.** `REFUSED_OBJECTS` gains the range regex. The message, the header and the stated limits name it. Fixture `20261114000900_create_range_type` fails rule 14.<br>**Mutant** without the regex: the `refused-objects` table and the new message case fail.<br>**Gap:** R3-m1. |
| F8 (rule 21) | Done, with R3-n3 | **Change.**<br>- A statement gate, then a keyword scan on code with literals, quoted identifiers and comments blanked.<br>- Each clause is delimited by parenthesis depth, and the scan resumes after it (linear).<br>- (a) `RoutineRegistry.definedRoutine`, writing routines or not. (b) A qualified non-`pg_catalog` call, or `OPERATOR(schema.…)`. (c) The five query-string built-ins, quoted or not. (d) Fail closed.<br>- It runs on migration.sql and down.sql; down.sql counts the migrations' routines and its own.<br>- The 7 failing and 2 clean fixtures of §8.3, and a linearity case with nested parentheses.<br>**Mutants.**<br>- (a) through `calledWriter` (writing routines only): the fixture messages expect "a routine of this or an earlier migration" for the non-writing `fixture_check`, so they fail.<br>- (a) removed: fixture `0100` (unqualified call) gives no rule 21.<br>- (b) removed: `0600` fails.<br>- Operator arm removed: the `OPERATOR(public.===)` case fails.<br>- (c) removed: `0500` fails, because `pg_catalog.` passes (b).<br>- Literals not blanked: the control `DEFAULT 'check (public.fixture_check(1))'` reports.<br>- No lowercasing: no keyword matches.<br>**Weak spot:** R3-n3. |
| F9 | Done | **Change.** `LOAD_TIME_CODE_SQL`, the empty `ReadonlyMap`, `loadTimeCodeFindings` (fail closed on an unknown reason) and `unusedReviewedBuiltins`.<br>**Mutants.** SQL drift: the comparison with the data-model §8.6 fence fails. Excusing any reason: the `'something new'` and `'not built in'` rows fail. |
| F10 (C17) | Done, with R3-n2 | Committed schema: 0 findings, 0 unused entries, more than 50 sites. Planted as the migrator and rolled back: all 10 shapes of (ii), each with kind, object, reference and reason. The controls of (iii), plus a row comparison. (iv) VIRTUAL. |
| F11 (gate) | Done | **Change.**<br>- `captureManifest` runs C17 and the cluster query on the snapshot session.<br>- `parseManifest` requires both fields.<br>- `compareManifests` reports restored load-time code and ignores the cluster.<br>- `db:backup` prints one line and returns 1, with the three files written.<br>- `runVerifyRestore` throws before the admin session.<br>**Mutants.** Gate removed, or moved after `withSession(admin)`: `run.admin` is not `[]`. Backup returning 0: the `toBe(1)` case fails. |
| F12 (cluster) | Done, with R3-n1 | **Change.** The identifier is read on the admin session before `CREATE DATABASE`. Both refusals say what to do. `--same-cluster` and `target.sameCluster` exist.<br>**Mutants.** Read after `CREATE DATABASE`: the admin statement list `toEqual([CLUSTER_IDENTIFIER_SQL, …])` fails. Either refusal removed: its case fails. |
| F13 (tests) | Done | **Unit:** every case D-ARCH-238 lists.<br>**Int:**<br>- The existing cases pass `sameCluster`.<br>- One refused case creates no database.<br>- The gate case: the migrator adds the CHECK `NOT VALID`, then validates it. The backup exits 1 with exactly that constraint. Verify exits 1 in both forms. No scratch database exists, the side table holds only the migrator's row, and `rolsuper` is false.<br>- The optional second-cluster CLI case (D-TASK034-18). |
| F14 (docs) | Done | **Runbook:** §1 the gate line and what to do; §2 the two forms, the residuals and the privileged sessions; steps 0 and 1; the record before PASS; the R2-n1 owners; the R2-n2 residual.<br>**Header:** step 1 of `verify-restore.ts` is restated. |
| F15 | Done | D-TASK034-15..23 are in the `1bac00b1` body. Rulings in R3.4. |
| R2-n1 / R2-n2 | **Closed** | **R2-n1:** the owners (TASK-119, TASK-147, TASK-116) are named in the runbook, `verify-restore.ts`, `zero-downtime-probe.ts` and the int test.<br>**R2-n2:** the stale-CI residual and its detector are in the runbook.<br>**R2-n3** stays as written: re-pin on the next Prisma bump. |

## R3.3 New findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R3-m1 | MINOR | `tools/db/lint-migrations.ts:584` | `/^create type\b[^;]*\bas range\b/` runs on `masked` text, which keeps quoted identifiers. `CREATE TYPE public."a;b" AS RANGE (subtype = integer)` lexes as one statement, but `[^;]*` cannot cross the `;` inside the name, so rule 14 stays silent. This is the regex D-ARCH-237 adopted "as proposed". C17 (b) and the load-time gate still report the type, so only the early warning is affected. | Use `/^create type\b.*\bas range\b/` (a split statement holds no code `;`), or anchor the name with `CALL_IDENT`. Add a `lintTexts` case with a quoted name that holds `;`. Due with the next rule-14 or rule-21 change, at the latest at the post-merge §8.3 refresh of D-ARCH-238. |
| R3-n1 | NIT | `tools/db/verify-restore.ts:255`, `:273` | The identity check reads the cluster of `DATABASE_BOOTSTRAP_URL`, but `pg_restore` runs in the Compose service that `--project`/`--service` select, and nothing ties the two. If they differ, the restore fails closed in practice, because the scratch database exists only on the checked cluster. The exception is another cluster that already holds a database of that exact name. The int second-cluster case cannot see this, because its runner pins the container to the URL's cluster. | Route to the TASK-119 job, or to a follow-up on `db-tools-backup`. Read `system_identifier` through the archive tool's own `exec` (for example `psql -Atc` in the same service) and require it to equal the admin session's. Or state the residual in the runbook next to "with `--project <its compose project>`". |
| R3-n2 | NIT | `prisma/tests/catalog/c17-load-time-code.int.test.ts:189` | F10 (iv) asks to pin the outcome lane B shows, but the case accepts either `0A000` or a report. | After run-live78, keep only the observed outcome (expected: `0A000`) and turn the other into a comment. |
| R3-n3 | NIT | `tools/db/lint-migrations.test.ts:1532-1539` | The two delimiting cases (parentheses inside literals; a comment and a quoted identifier) assert only the rule number. Suppose a mutant stops blanking quoted identifiers or comments. `closingParenthesis` then finds no close, (d) still yields rule 21, and the mutant survives. The effect is over-reporting only (fail closed). | Assert the message of those two cases (`… calls public.fixture_w, a routine outside pg_catalog`). |
| R3-n4 | NIT | `tools/db/lint-migrations.ts:81-91` | Rule 21 reads top-level `CREATE`/`ALTER TABLE` and `CREATE`/`ALTER DOMAIN` statements only. It does not read DDL inside a `DO` block or an `EXECUTE` string, and the header's limits do not say so. C17 and the gate are the boundary. | Add "a load-time clause in dynamic SQL (`DO`, `EXECUTE`)" to the rule-21 limits. The architect mirrors it in §8.3 at the post-merge refresh. |
| R3-n5 | NIT (spec, principal-architect) | `tools/db/lint-migrations.ts:1063`; data-model §8.3 rule 21 (c) | List (c) names the query-string built-ins. `table_to_xml`, `cursor_to_xml`, `schema_to_xml` and `database_to_xml`, with their `xmlschema` variants, read a named relation. That relation can be a view whose query calls a routine as the caller. These built-ins are not IMMUTABLE, so C17 and the gate already report them. | Principal-architect decides whether (c) grows at the §8.3 refresh. No code change in this PR. |

## R3.4 Rulings on D-TASK034-15..23

| ID | Ruling |
|---|---|
| D-TASK034-15 (two merges) | **Accepted.** R3.1 proves it by tree equality with `git merge-tree` and by raw-diff equality. |
| D-TASK034-16 (rule 16 controls every escape string; rule 10 decodes line breaks only) | **Accepted.** `\x3b`, `\x27` and `\x2a\x2f` stay rule-16 refusals. The X4 control shows that only the line-break escape opens a rule-10 hit. |
| D-TASK034-17 (VIRTUAL: two accepted outcomes) | **Accepted for this head.** Narrow it to the observed outcome (R3-n2). |
| D-TASK034-18 (second cluster without a harness change) | **Accepted.** It is the preferred form of F13 and the shape of the TASK-119 job. Compose's own lookup stays unproven (D-ORCH-160). R3-n1 is the binding it does not cover. |
| D-TASK034-19 (`errorSummary` drops the server message) | **Accepted.** It goes further than F3 asks, and the non-P0 `RAISE` residual is stated. |
| D-TASK034-20 (injectable file system) | **Accepted.** On Windows the files inherit the profile ACL. The POSIX real-mode cases run where the modes mean something. |
| D-TASK034-21 (child environment) | **Accepted.** `NODE_OPTIONS`, `NODE_AUTH_TOKEN` and `PRISMA_*` are out, as F6 requires. |
| D-TASK034-22 (rule 21 limits) | **Accepted.**<br>- One finding per clause; the scan stops at the first undelimited clause.<br>- An operator of another schema is seen only as `OPERATOR(schema.op)`.<br>- Quoted schemas are lowercased. A migration cannot create a schema (rule 14), so the lowercasing cannot hide one.<br>Add R3-n4 to the limits. |
| D-TASK034-23 (restored load-time code; cluster not compared; 5 shown) | **Accepted.** |

## R3.5 Merge conditions

- **C1 (code review).** Met: no BLOCKER or MAJOR is open, and no new finding blocks the merge. MAX_FIX_CYCLES is reached, so the open items are routed:
  - R3-m1, R3-n3 and R3-n4: a follow-up card, or the next holder of `tools/db`.
  - R3-n1: the TASK-119 card.
  - R3-n2: the lane-B follow-up.
  - R3-n5: principal-architect.
- **C2 (lane B).** run-live78 on `1bac00b1`: unit, integration, `catalog-c1-c14` and `migrations`, each with 0 failures and 0 errors, and the evidence committed on the branch.
  - `catalog-c1-c14` must include the C17 file: 1 committed case, 10 planted, 1 control and 1 VIRTUAL case.
  - The run proves what I could only read: the fence against PostgreSQL 18 field names, the gate case, the second-cluster case, the equality of the real Prisma checksum, and the unchanged fixture outcomes.
- **C3 (security).** The delta round of D-SECPR034-01 on `1bac00b1`. It closes C1 through the five checks of D-ARCH-238, and C2 (R2-m1, closed here).
- **C4 (records).**
  - D-TASK034-01..23 accepted by reference in DECISIONS.md.
  - The record renamed once the PR exists.
  - Hosted CI green.
  - Squash merge.

## R3.6 Good

- One query and one finding rule serve the catalog case, `db:backup` and `db:verify-restore`, and a text test pins the query to the data-model fence.
- Both refusals sit in `runVerifyRestore` before the admin session, so the harness callers are covered too. The unit tests assert the exact list of admin statements.
- The allow-list detail tests plant a random sentinel in every channel that can carry row data: `DETAIL`, `RAISE`, escaped quotes, nested groups and `Key (…)=(…)`.
- The gate int case proves the threat end to end: the routine ran once, as the migrator at `VALIDATE`, and never as the bootstrap role.
