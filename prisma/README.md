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

## Seeding

`npm run db:seed` (reference, every environment) and `npm run db:seed:demo` (reference, then demo users; skipped when
`APP_ENV=production`) run `prisma/seed/index.ts` as `platform_migrator` (`DATABASE_MIGRATOR_URL` or `..._FILE`, `APP_ENV`
required). Exit codes: 0 ok, 1 refusal (JSON on stderr with `code` and `subjects`, never a value), 2 unexpected error.

- `seed/framework/`: dataset runner (upsert by natural key, one statement per chunk of at most 500 rows, writes a row only
  when it is new or has drifted, so an unchanged database is not touched), canonical content hash, validation,
  `reference_dataset_versions` store. The whole reference run is one transaction behind `pg_advisory_xact_lock`.
- `seed/reference/`: `REFERENCE_DATASETS` (empty until TASK-026, TASK-066 and the other data-model §9.2 datasets add theirs)
  and `REFERENCE_STEPS`. The authz step only verifies parity with `packages/authz` (`SEED_AUTHZ_DRIFT`); the generated
  seed migration is the only writer of `permissions`, `roles` and `role_permissions` (D-ARCH-060).
- `seed/demo/`: credential planning and the demo user seed. Passwords come from `SEED_*` variables, are decided before any
  connection (`local-only-*` defaults only in `local`; none read in staging or production) and are never printed.
- Adding a dataset: a `Dataset` file under `seed/reference/` with `source` on every row, appended to `REFERENCE_DATASETS`;
  bump `version` when its content changes; `insertOnly` for published versions, `audited` for configuration.
- Tests: unit beside the code, `tests/seed/seed.int.test.ts` (PostgreSQL 18, real migrations, test-only probe tables, CLI).

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
