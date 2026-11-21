# Runbook: backup and restore rehearsal, and the zero-downtime probe

Owner: TASK-034. Sources: CLAUDE.md §5 Database, data-model.md §8.6 and §8.7, NFR-REC-003, NFR-DATA-004 and NFR-AVAIL-003.

## When to run it

- **Before every migration declared `data-changing: yes`.** The migration linter (`npm run db:lint-migrations`, rule R) refuses such a migration until its folder holds a fresh, passed `rehearsal.json`.
- **Weekly, and before a release candidate.** This is the `restore-rehearsal` suite (lane B `gate`, lane C). qa-lead activates it.
- **The zero-downtime probe:** run it before merging any migration that the running code must survive. In practice that is every expand migration.

The tools refuse any database that is not on a loopback host or a Unix socket. They never touch a shared environment. At M5 the CD pipeline does the same steps against an RDS snapshot that is restored to a temporary instance (§8.6).

## Prerequisites

- The Compose stack runs (`docker compose up`). The tools call `pg_dump` and `pg_restore` inside the `postgres` service with `docker compose exec -T`, so the host needs no PostgreSQL client. The service's superuser connects over the container socket, so no password goes on a command line.
- Compose takes the project from the working directory. A task worktree (`../Shipqube-TASK-xxx`) therefore talks to its own stack. To reach another stack, pass `--project <compose project>` to `db:backup` and `db:verify-restore`. A mismatch fails closed (unknown snapshot, or missing scratch database).
- Each tool runs inside the container under `timeout` (60 min, then KILL 10 s later), so a stuck `pg_dump` or `pg_restore` never keeps running after the host gives up.
- These variables are set in your shell (the same ones `db:bootstrap` and `db:reset` use, with local values only):
  - `DATABASE_BOOTSTRAP_URL`: the superuser. Only a role that bypasses RLS can dump every row (FORCE RLS applies to table owners, OI-16).
  - `DATABASE_MIGRATOR_URL`
  - `DATABASE_URL`: needed for the probe only.
  - `BOOTSTRAP_MIGRATOR_PASSWORD` and `BOOTSTRAP_APP_PASSWORD`, or their `*_FILE` forms.
- Artefacts go to `reports/rehearsal/<UTC stamp>-backup/`, which git ignores. The folder is created `0700` and the files `0600`, so on Linux or macOS only your account can read them (PR034-SEC-02); on Windows they inherit your profile's ACL. **Never commit an archive: it holds every row.**

## 1. Back up

```
npm run db:backup                     # or: npm run db:backup -- --out <empty folder> --service postgres --project <compose project>
```

This writes three files to the folder:
- `platform.dump`: the `pg_dump --format=custom` archive.
- `manifest.json`: per-table row counts and row checksums, sequences, the `_prisma_migrations` head, the schema digest, the source cluster's `system_identifier` and the load-time findings (`loadTimeCode`).
- `schema.sql`: the normalised schema.

**The load-time gate (data-model §8.6, D-ARCH-236).** A restore loads every row as the superuser, and PostgreSQL then evaluates every table CHECK, domain CHECK, generated column and partition key as that superuser. So the backup runs catalog query C17 in the same snapshot: every such expression may call IMMUTABLE `pg_catalog` routines only, and no range type may exist outside an extension. With a finding, the tool still writes the three files, prints one line and exits 1:

```
[db:backup] load-time gate: 1 load-time finding(s): table check public.t ck_t: public.f(integer) (not built in). A restore would run this code as the loading superuser, so db:verify-restore refuses this backup (…)
```

What to do: remove the object with a migration (drop or replace the constraint, the column expression or the range type), apply it, and take a new backup. **Never edit the manifest**: `db:verify-restore` reads the field, and a hand-edited manifest only moves the code past the gate. If a migration really needs a built-in that is not IMMUTABLE in such an expression, principal-architect rules on an entry of `REVIEWED_NON_IMMUTABLE_BUILTINS` (`tools/db/load-time-code.ts`) first; a routine outside `pg_catalog` never gets one. The same rule is migration-lint rule 21 and catalog test C17; the gate also catches an object created outside the migrations.

The archive and the manifest come from one exported snapshot, so a running stack gives a consistent pair. The last line prints the manifest's SHA-256 and its migration head. Exit 0 also means the archive file was flushed completely: a write error at the end (a full disk) fails the backup.

For a data-changing migration, take the backup **at the state the migration changes**. Apply every earlier migration, but not this one. The migration head that the tool prints must be the migration just before the new one.

## 2. Restore and verify

```
npm run db:verify-restore -- --backup reports/rehearsal/<stamp>-backup [--migration <migration folder name>] [--scratch <name>] [--project <compose project>] [--keep] [--same-cluster]
```

### Where the restore goes: two forms (data-model §8.6 step 4, D-ARCH-235)

- **The rule: a second, fresh stack.** Restore into a cluster other than the one you backed up. Start a second Compose stack (its own project name, its own published port and its own role passwords), and point `DATABASE_BOOTSTRAP_URL`, `DATABASE_MIGRATOR_URL` and `BOOTSTRAP_*_PASSWORD` at **that** stack, with `--project <its compose project>`. No password of the first stack is given to it: `00-roles.sql` runs there with the second stack's own values. The tool reads the target's `system_identifier` before it creates anything and refuses the cluster that was backed up (a physical copy of it too). The report says `"target": { "sameCluster": false }`. CI (the `restore-rehearsal` suite and the job of TASK-119) uses only this form and fails unless the report says `sameCluster` false and the manifest's `loadTimeCode` is empty.
- **The one stated exception: `--same-cluster`**, for your own Compose stack. It restores into a scratch database of the cluster you backed up. Use it only when all of these hold: the target is loopback (the tools accept nothing else), the data is synthetic (threat model AS-2), and the load-time gate passed. The switch is refused on a cluster other than the backed-up one, it is never passed in CI, and the report and the PASS line say `same cluster`. The accepted residuals (threat model RR-19):
  - `00-roles.sql` re-asserts the role attributes and re-sets the two LOGIN passwords of your live local cluster from your environment, as `db:reset` does; with other values your local api and worker lose their sessions until you bootstrap again;
  - the superuser session works on your live local cluster;
  - a scratch database kept with `--keep` holds every row until you drop it, under the same row security and grants as the source.

  The exception ends with the first environment that holds a non-synthetic row, or whose superuser is not your own.

What the privileged sessions do, and nothing else: they read the system catalogs and base tables, run `pg_dump`, and run `pg_restore` of a whole archive into an empty database. They never restore data only into an existing schema, never read a view or call a routine of a non-system schema, and never write to an application table. `prisma migrate deploy` and `migrate status` run as the migrator, in a child process that gets an allow-listed environment (the OS basics and the scratch database's migrator URL; no superuser URL and no role password).

### Steps

The tool runs these steps:
0. **The load-time gate.** A manifest whose `loadTimeCode` holds a finding is refused before any database work, in both forms: `the load-time gate refuses this backup: …`. See section 1 for what to do. With `--migration <name>`, it also checks the migration: the folder holds a `migration.sql` declared `data-changing: yes`, and the backup's migration head is the migration just before it. A failed check stops the tool before any database is created.
1. **The restore target.** It reads the target cluster's `system_identifier`. Without `--same-cluster` the backed-up cluster is refused (`the restore target is the cluster that was backed up …`); with it, any other cluster is refused (`--same-cluster was given, but …`). Then it creates an empty scratch database (`rehearsal_<stamp>` unless `--scratch` is given) from `template0`. It refuses a name that already exists.
2. It runs **only** `prisma/bootstrap/00-roles.sql` on it, the database-level statements, then runs `pg_restore --exit-on-error`. Everything schema-scoped comes from the archive. The audit DDL guard's event triggers are restored last, so the guard never blocks the restore.
3. It verifies the restore:
   - row count and row checksum of every table;
   - sequences not behind the source;
   - the migration head;
   - the schema digest, which covers owners, ACLs, RLS, policies, triggers and event triggers;
   - generated anti-join orphan checks for every foreign key.
4. With `--migration <name>`, it runs `prisma migrate deploy` with the **root** `prisma.config.ts` on the scratch database. This applies the migration to the restored data, which is the rehearsal itself (D-TASK034-09). The comparison in step 3 ran before, on the data as backed up.
5. It runs `prisma migrate status` with the root config, which must report the history up to date. Without `--migration`, the backup must therefore be at the newest migration. This proves that the root config loads on a restored database, the generated `tables.external` window included, and that its migrations folder matches the restored history. It does not prove that the window covers every audit partition: `migrate status` compares history only, not the schema (SPK-08 F-01).
6. It writes `restore-report.json` into the backup folder and drops the scratch database, unless you pass `--keep`.

Exit 0 means PASS. With `--migration <name>`, a pass (the deploy included) also writes `prisma/migrations/<name>/rehearsal.json`, before the PASS line. Commit that file with the migration. The record binds the bytes that were deployed: after the deploy the report carries the `checksum` that `_prisma_migrations` holds for the migration (`rehearsed`), and the tool refuses to write the record when the current `migration.sql` differs from it (`migration.sql changed during the rehearsal …`, a FAIL line and exit 1). Do not edit the file while a rehearsal runs; if you did, rehearse again.

The record is stale, and rule R refuses it, when:
- `migration.sql` changed after the rehearsal (its SHA-256 differs);
- the backup's migration head is not the migration just before this one (for example, another migration merged in between);
- the verification did not pass, did not deploy the migration, or ran against another manifest.

While the migration is unmerged, fix a stale record by repeating sections 1 and 2.

A later merge cannot make a released record stale. A merged migration folder is immutable (`tools/ci/check-migration-immutability.mjs`), and the same check refuses a new migration folder that sorts before a released one (D-TASK034-10). If your branch adds a migration whose timestamp is older than the newest migration on `main`, rename its folder with a later timestamp. If it is data-changing, re-run the rehearsal, because "the migration before it" has changed.

One residual (code review R2-n2): the out-of-order check compares against the merge base, so a PR whose CI ran before a later-timestamped migration merged can still merge on that stale run. Its detector is the repository lint (`lintRepository`, rule R) in lane A of the next run, which turns red, fail closed, on an unrelated PR. Requiring branches to be up to date before merging closes it.

### If verification fails

- `table …: N rows expected, M restored` or `row checksum differs`: the archive and the database disagree. Check that the backup step finished, and that nothing wrote to the scratch database (`--keep` leaves it in place for inspection).
- `orphan(s) for <constraint>`: the restored data breaks a foreign key. Restored constraints are not re-validated by PostgreSQL. Investigate the source before you run the migration.
- `schema: the normalised schema dump differs`: `restore-report.json` lists up to 20 differing statements on each side. A role or grant missing from `00-roles.sql` shows up here.
- `migrate deploy: exit 1: failed <name> | P3018 | SQLSTATE <code> | ERROR: …`: the migration failed on the restored data. That is the failure the rehearsal exists to catch. Fix the migration.
- `migrate status: exit 1: pending <name>`: the restored history is behind the migrations folder. Without `--migration`, back up at the newest migration. With it, check that no other migration follows yours.
- `load-time code in the restored database: …`: the restored database holds load-time code that the source manifest did not list. Treat it as a gate finding (section 1).

In `restore-report.json`, `migrateDeploy` and `migrateStatus` list the migration names Prisma reported as `pending` and `failed`. The tool reads both of Prisma's output streams. The `detail` text is an allow-list (PR034-SEC-03): the names, Prisma's error codes, the SQLSTATE and PostgreSQL's first `ERROR:` line with every quoted value and parenthesised group masked (no line at all for a PL/pgSQL `RAISE`). `DETAIL`, `CONTEXT`, `HINT` and other lines are dropped, because they can quote row data. To see the full error, re-run the deploy by hand against a kept scratch database (`--keep`) on synthetic data.

**A failed rehearsal blocks the data-changing migration (CLAUDE.md §5).** Do not commit a hand-written record.

## 3. Zero-downtime probe

```
npm run db:zero-downtime-probe -- [--rate 20] [--warmup-ms 5000] [--after-ms 60000] [--max-in-flight 16] [--workload <file>] [--report <file>]
```

How the probe works:
- `DATABASE_URL` is the probe role, normally `platform_app`. It must name the same host, port and database as `DATABASE_MIGRATOR_URL`.
- The probe reads every table the role may read, using the column list taken **before** the migration (the old code's shape). `--workload` adds writes, for example `[{ "name": "insert x", "kind": "write", "sql": "INSERT INTO … VALUES ($1, $2)", "params": ["{{uuid}}", "probe-{{seq}}"] }]`.
- While the reads and writes run, it applies `prisma migrate deploy` through the pinned wrapper.
- Every request has a 5 s statement timeout. A request that cannot start because too many are in flight counts as `saturated`.

Verdicts:
- `PASS`: 0 failures and 0 saturated requests during and after the migration.
- `FAIL`: names the first failing operation, its phase and its SQLSTATE. A dropped or renamed column is `42703`. An error of an idle pooled client (a backend terminated during the migration) also fails the run.
- `INVALID-WORKLOAD`: a request failed or was saturated before the migration started. Fix the workload, or lower `--rate`.
- `MIGRATION-FAILED`: the deploy itself failed.

NT-AVAIL-003-b asks for the previous api image (the last release tag or, before the first tag, the previous `main` image) under a 20 rps k6 probe. That job is not built yet; TASK-119 owns it (D-SD-012). Until it is, this database-level probe is partial evidence (D-TASK034-05, premise corrected by D-TASK034-11).

## Not covered yet

These items are recorded as D-TASK034-04, with the owners D-SD-012 routed them to:
- the RustFS bucket copy and the document SHA-256 check (no `documents` table yet): TASK-147;
- audit chain and anchor verification: TASK-116's verifier;
- the marker stream (an informational data-loss window): the restore-rehearsal job of TASK-119;
- the `/health/ready` smoke container: the restore-rehearsal job of TASK-119.

Each one joins `verify-restore.ts` when its feature lands.
