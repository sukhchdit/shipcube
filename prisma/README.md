# prisma/

Prisma 7 + PostgreSQL 18 baseline (TASK-003; data-model.md §4.4, §7, §8; ADR-0005, ADR-0007, ADR-0023 am. J).

| Path | What |
|---|---|
| `schema/*.prisma` | Multi-file schema (one file per module); `_base.prisma` holds the `prisma-client` generator (output `generated/prisma`, git-ignored) and the datasource. The URL lives in `../prisma.config.ts`. |
| `bootstrap/NN-name.sql` | Bootstrap lane: roles, schemas, extensions, default privileges (and, from TASK-021, audit DDL). Cluster-admin credential, `npm run db:bootstrap` (`tools/db/bootstrap.ts`), ledger `public.bootstrap_migrations`. Files are immutable once applied; a change is a new file. |
| `migrations/<ts>_<name>/` | Prisma Migrate lane, run as `platform_migrator`. Each migration has the linter header and a hand-written `down.sql`. |
| `tests/harness/` | PostgreSQL 18 Testcontainers harness (digest-pinned image, random passwords, template cloning, runtime role). |
| `tests/{bootstrap,migrations}/` | Integration suites: bootstrap lane and catalog assertions; up -> down -> up. |

Every Prisma CLI call goes through `node tools/deps/prisma-cli.mjs` (pinned schema engine, ADR-0023 am. J item 2):
`npm run db:migrate` (`migrate dev`), `npm run db:migrate:deploy`, `npm run db:reset -- --yes` (local only: recreates the
database, reruns the bootstrap lane, deploys), `npm run db:lint-migrations` (linter + `prisma validate`).

## Findings for SPK-03/SPK-08

Recorded by TASK-003 on 2026-11-12 against the locked `prisma` / `@prisma/client` / `@prisma/adapter-pg` 7.10.1
(engines `d1b3f377ca835d73fd50954a5e22128b9ebdd6b8`) and `postgres:18` (18.6,
`sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42`).

1. **`partialIndexes` is still a preview feature at 7.10.1.** Verified with `node tools/deps/prisma-cli.mjs validate --schema <file>`
   on a model with `@@index([savedAt], where: raw("saved_at IS NOT NULL"))`: without `previewFeatures = ["partialIndexes"]`
   it fails with P1012 "Partial indexes are a preview feature. Add "partialIndexes" to previewFeatures in your generator
   block"; with the flag the schema is valid. `_base.prisma` does not enable it yet; the first module that needs a partial
   index adds the flag (data-model §7.2). Whether `migrate dev` keeps raw-SQL partial indexes is still SPK-03's to verify.
2. **The shadow-database init hook exists.** `@prisma/config` 7.10.1 declares `migrations.initShadowDb?: string`
   ("a SQL script that will be used to setup external tables and enums during migration diffing", `dist/index.d.ts`,
   `MigrationsConfigShape`), next to `experimental.externalTables` and `tables.external`, which `prisma.config.ts` already
   uses for `public.bootstrap_migrations`. Verified by reading the type declarations and loading `prisma.config.ts` in
   every CLI run; the hook was not exercised with the rendered bootstrap SQL or with audit partitions (SPK-03).
3. **`migrate deploy` needs neither database ownership nor `CREATE` on the database** (SPK-08, SEC-P3-34 item 5).
   With the database owned by the bootstrap role and `platform_migrator` holding only `CONNECT` plus `USAGE, CREATE` on
   `public`, `prisma migrate deploy`, `migrate status` and `db execute` succeed on PostgreSQL 18 (integration suites
   `prisma/tests/migrations`, `prisma/tests/harness`); `migrate deploy` did not attempt a `CREATE SCHEMA`, which would
   have failed by privilege. `migrate dev` against a shadow database was not exercised (SPK-03).
4. **`migrate resolve --rolled-back` refuses a migration that finished successfully** (P3012, "cannot be rolled back
   because it is not in a failed state"). The up -> down -> up driver therefore sets `rolled_back_at` in
   `_prisma_migrations` itself (as the migrator, which owns it) after `db execute --file down.sql`; `migrate deploy` then
   re-applies the migration. data-model §8.4 step 2 describes the `resolve` command and needs this correction.
5. **Per-schema `ALTER DEFAULT PRIVILEGES … IN SCHEMA platform REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` is a no-op.**
   PostgreSQL adds per-schema default privileges to the global ones and cannot revoke a global default per schema: the
   statement creates no `pg_default_acl` row, and a function the role then creates is still executable by `PUBLIC`.
   `bootstrap/01-schemas.sql` uses the global form (`… FOR ROLE <role> REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`), which
   the catalog test checks both in `pg_default_acl` and behaviourally.

## Row-level security (TASK-016)

| Path | What |
|---|---|
| `sql/policy-templates/*.sql` | The data-model §4.3 blocks (`enable-force`, `tenant`, `operator`, `guest`, `user-owned`, `definer-read`, `definer-purge`, `guest-capable-guard-trigger`, and the once-only `guest-capable-guard-function`). `tools/db/render-rls.ts` renders a table's block from its class in `tools/db/table-classes/<module>.json` (`tsx tools/db/render-rls.ts <module>`) and refuses any template whose policy predicate leaves the ADR-0005 am. 10 item 7 allow-list. |
| `sql/function-templates/app-is-operator.sql` | `platform.app_is_operator()` under `SET ROLE platform_definer` — shipped by TASK-037 with `memberships`/`organisations` (its body needs them; `check_function_bodies` stays on). |
| `sql/grants.manifest` | Every table/column privilege of `platform_app`, `platform_definer`, `platform_erasure`, one line per grant (parser `tools/db/grants-manifest.ts`); catalog test C5 compares it with the live ACLs. A migration that grants adds its line. |
| `tests/catalog/` | Suite `catalog-c1-c14` (C1–C14, prosrc scan, PR8-SEC-14 backstop); `policies.snapshot.json` is the C3 snapshot — a migration that adds policies updates it. |
| `bootstrap/02-role-backstops.sql` | `platform_app` role-level `statement_timeout = 30s` backstop (ADR-0005 am. 10 item 12). |

## Rule 5: `CREATE INDEX CONCURRENTLY` through `migrate deploy`

Recorded by TASK-016 on 2026-11-12, Prisma 7.10.1 / PostgreSQL 18.6, as `platform_migrator`
(`tests/migrations/concurrent-index.int.test.ts`, fixtures `tests/fixtures/concurrent-index*`):

1. A migration whose only statement is `CREATE INDEX CONCURRENTLY` on a table created by an earlier migration is
   applied: exit 0, `_prisma_migrations.finished_at` set, the index `indisvalid`. Prisma does not wrap the file in a
   transaction.
2. **The same statement after `SET lock_timeout = '3s';` in the same file is applied as well.** PostgreSQL rejects
   `CREATE INDEX CONCURRENTLY` in a multi-statement simple-query string (implicit transaction, `25001`), so
   `migrate deploy` does not submit the file as one string either: it runs the statements one by one.
3. **A migration file is not atomic.** A file whose second statement fails (`SELECT 1/0`) exits non-zero with
   `22012`, the migration stays unfinished (`finished_at` NULL), and **the first statement's table remains**. A failed
   migration therefore leaves partial state: fix forward, or apply the hand-written `down.sql` for what was created
   before `migrate resolve`. Session-level `SET`s (such as `SET lock_timeout`) persist on the deploy connection for the
   rest of the file.

Consequence for linter rule 5: "one statement per file" is not needed to avoid a deploy error, but it keeps a
concurrent build (which can leave an `INVALID` index when it fails) isolated in its own migration, so a failure is
retried or reverted on its own — the rule stays as written, justified by atomicity rather than by `25001`.

Consequences for rules 9, 11 and 15 (PR11-SEC-07): every prefix of a file must leave the schema safe, and each
statement runs outside a transaction block, where `SET LOCAL` has no effect.

- Rule 11 accepts only `SET [SESSION] lock_timeout` as the first statement; `SET LOCAL lock_timeout` fails.
- Rule 15 accepts a `SECURITY DEFINER` function only inside `SET ROLE platform_definer; … RESET ROLE;` (`SET LOCAL
  ROLE` does not count; "grants before `OWNER TO`" is no longer accepted), and a file must not end with a role still
  set.
- Rule 9 requires a `GRANT … TO platform_app` on an RLS-class table to follow that table's `ENABLE` and `FORCE ROW
  LEVEL SECURITY` (in the same file or an earlier one), and every `CREATE POLICY` to equal, statement for statement,
  the `tools/db/render-rls.ts` output for the table's manifest entry (PR11-SEC-03).
