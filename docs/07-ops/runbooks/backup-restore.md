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
- Artefacts go to `reports/rehearsal/<UTC stamp>-backup/`, which git ignores. **Never commit an archive: it holds every row.**

## 1. Back up

```
npm run db:backup                     # or: npm run db:backup -- --out <empty folder> --service postgres --project <compose project>
```

This writes three files to the folder:
- `platform.dump`: the `pg_dump --format=custom` archive.
- `manifest.json`: per-table row counts and row checksums, sequences, the `_prisma_migrations` head and the schema digest.
- `schema.sql`: the normalised schema.

The archive and the manifest come from one exported snapshot, so a running stack gives a consistent pair. The last line prints the manifest's SHA-256 and its migration head. Exit 0 also means the archive file was flushed completely: a write error at the end (a full disk) fails the backup.

For a data-changing migration, take the backup **at the state the migration changes**. Apply every earlier migration, but not this one. The migration head that the tool prints must be the migration just before the new one.

## 2. Restore and verify

```
npm run db:verify-restore -- --backup reports/rehearsal/<stamp>-backup [--migration <migration folder name>] [--scratch <name>] [--project <compose project>] [--keep]
```

The tool runs these steps:
0. With `--migration <name>`, it first checks the migration: the folder holds a `migration.sql` declared `data-changing: yes`, and the backup's migration head is the migration just before it. A failed check stops the tool before any database is created.
1. It creates an empty scratch database (`rehearsal_<stamp>` unless `--scratch` is given) from `template0`. It refuses a name that already exists.
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

Exit 0 means PASS. With `--migration <name>`, a pass (the deploy included) also writes `prisma/migrations/<name>/rehearsal.json`. Commit that file with the migration.

The record is stale, and rule R refuses it, when:
- `migration.sql` changed after the rehearsal (its SHA-256 differs);
- the backup's migration head is not the migration just before this one (for example, another migration merged in between);
- the verification did not pass, did not deploy the migration, or ran against another manifest.

While the migration is unmerged, fix a stale record by repeating sections 1 and 2.

A later merge cannot make a released record stale. A merged migration folder is immutable (`tools/ci/check-migration-immutability.mjs`), and the same check refuses a new migration folder that sorts before a released one (D-TASK034-10). If your branch adds a migration whose timestamp is older than the newest migration on `main`, rename its folder with a later timestamp. If it is data-changing, re-run the rehearsal, because "the migration before it" has changed.

### If verification fails

- `table …: N rows expected, M restored` or `row checksum differs`: the archive and the database disagree. Check that the backup step finished, and that nothing wrote to the scratch database (`--keep` leaves it in place for inspection).
- `orphan(s) for <constraint>`: the restored data breaks a foreign key. Restored constraints are not re-validated by PostgreSQL. Investigate the source before you run the migration.
- `schema: the normalised schema dump differs`: `restore-report.json` lists up to 20 differing statements on each side. A role or grant missing from `00-roles.sql` shows up here.
- `migrate deploy: exit 1: failed <name> | …`: the migration failed on the restored data. That is the failure the rehearsal exists to catch. Fix the migration.
- `migrate status: exit 1: pending <name> | …`: the restored history is behind the migrations folder. Without `--migration`, back up at the newest migration. With it, check that no other migration follows yours.

In `restore-report.json`, `migrateDeploy` and `migrateStatus` list the migration names Prisma reported as `pending` and `failed`. The tool reads both of Prisma's output streams. The `detail` text masks quoted values, because a database error can quote row data.

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

NT-AVAIL-003-b asks for the previous api image (the last release tag or, before the first tag, the previous `main` image) under a 20 rps k6 probe. That job is not built yet, and no task owns it. Until it is, this database-level probe is partial evidence (D-TASK034-05, premise corrected by D-TASK034-11).

## Not covered yet

These items are recorded as D-TASK034-04:
- the RustFS bucket copy and the document SHA-256 check (no `documents` table yet);
- audit chain and anchor verification (TASK-116's verifier);
- the marker stream (an informational data-loss window);
- the `/health/ready` smoke container.

Each one joins `verify-restore.ts` when its feature lands.
