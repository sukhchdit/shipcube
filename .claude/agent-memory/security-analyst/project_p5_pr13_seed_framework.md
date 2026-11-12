---
name: project-p5-pr13-seed-framework
description: PR #13 (TASK-023 reference/demo seed framework) R1 2026-11-13 PASS_WITH_FOLLOW-UPS @e92cd6f; PR13-SEC-01..08; seed CLI facts (pg URL overrides, ECS signal gap, _FILE not admitted); R2 reconciliation and TASK-089/221/014/025 checks
metadata:
  type: project
---

The PR #13 review (TASK-023) is in `docs/05-quality/security/PR-0013-TASK-023-security-review.md`. IDs are PR13-SEC-01..08.
- **R1** (head `e92cd6f`, 2026-11-13): PASS_WITH_FOLLOW-UPS, 4 LOW and 4 INFO.
  - 01: the copied `readSecret`, plus `DATABASE_MIGRATOR_URL_FILE`, which ADR-0018 am. 6 does not admit.
  - 02: no ECS second signal. `APP_ENV=local` on ECS still seeds `local-only-*` passwords.
  - 03: URL `?options=` / `?statement_timeout=` / `?host=` override the seed's pinned session; no `SHOW search_path`; no TLS.
  - 04: `platform_app` INSERT/UPDATE on `reference_dataset_versions` enables CONFIG_CHANGE suppression (the hash is computable from the repo) and a seed DoS via int4 `version` overflow.
  - 01, 02 and 03 are recommended in the PR's own fix cycle.
- **Verified clean:** the SQL identifier guard (fast-check, 50k runs); values bound as one jsonb parameter; the parity step is read-only; one-client transaction with an xact lock; the migration is `data-changing: no`; fixtures are synthetic.

**Why:** the seed CLI holds the DB-owner credential in every environment. 02 becomes the T-23 path (seeded Super Admin with a default password) once TASK-089 wires a writing provisioner.

**How to apply.** In these reviews, check:
- **R2 of PR #13 (after the D-ORCH-015 rebase onto PR #11):**
  - the table-class registration (fix the `$comment`);
  - the grants.manifest lines match the PR13-SEC-04 decision;
  - the unclassified-table lint is green;
  - whether 01, 02 and 03 were taken. If 01 was taken, `_FILE` is refused with exit 1 and no read.
- **TASK-089:** it may not replace `DEFERRED_PROVISIONER` until the ECS-signal test exists. Also check that set-password tokens are never logged, are single-use with a TTL and stored hashed, that the staging mail sink is access-controlled, and that provisioner errors are value-free.
- **TASK-221:** the PR13-SEC-04 grant decision (SELECT-only, or an RLS row restriction to `authz_matrix`, or a definer function), and the re-baseline after `down.sql`.
- **TASK-014:** the seed is a `checkToolingEnv` caller with `verify-full` in hardened environments; ordering is snapshot → migrate → seed; the seed one-shot runs `tsx` from source.
- **TASK-025:** the `ConfigChangeSink` receives the migrator connection, but `audit_entries` INSERT belongs to `platform_app`.
- **TASK-026:** the dataset target allow-list (GLOBAL class only), PR13-SEC-05.

**Probe kit** (session-scoped, so rebuild it):
- `git archive <sha> prisma packages/{config,authz,shared}/src`, then `build.mjs`. It strips types in transform mode, renames `.ts` → `.js` (so the `./x.js` imports resolve unchanged) and rewrites `@platform/*` to relative paths.
- Add a `build/node_modules` junction to the worktree's `node_modules`. Load `fast-check` via `createRequire` from the build dir. Remove the junction with `fs.unlinkSync`.
- `main(argv, env, output)` takes injected env and output, so CLI probes need no spawn.
- To reproduce the seed's pg client options, read `client.connectionParameters` without connecting.

Related: [[project-p5-pr11-rls-review]], [[project-p5-wave0-db-baseline]], [[project-p5-wave0-config-review]], [[project-p5-pr8-authz-review]], [[project-security-review-conventions]], [[project-p5-pr10-ci-lane]]
