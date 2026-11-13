---
name: project-p5-pr13-seed-framework
description: PR #13 (TASK-023 seed framework) R1 @e92cd6f + R2 @e42e368 PASS_WITH_FOLLOW-UPS; PR13-SEC-01..11; supersede round per D-ORCH-017 (conditions); TLS-value parity gap (09) for TASK-014; gitleaks literal back on main (11)
metadata:
  type: project
---

The PR #13 review (TASK-023) is in `docs/05-quality/security/PR-0013-TASK-023-security-review.md`. IDs are PR13-SEC-01..11.

- **R1** (head `e92cd6f`): PASS_WITH_FOLLOW-UPS with 4 LOW (01..04) and 4 INFO (05..08).
- **R2** (head `e42e368`, 2026-11-13): PASS_WITH_FOLLOW-UPS.
  - Closed: 01 (`_FILE` refused), 02 (ECS second signal; the TASK-089 gate test now exists), 03 (session half: allow-list = main's `RUNTIME_DATABASE_URL_PARAMS` plus the `pg_settings` read-back), 06 (in PR scope), 07.
  - Open: 04 (principal-architect, before TASK-221) and 05 (remainder, TASK-026).
  - New in R2:
    - **09 (LOW):** the seed reuses only the TLS parameter *names*, not the runtime's `tlsConfig` value rules. `no-verify` is accepted, `PGSSLMODE` is used as the fallback, `sslrootcert` is read raw by pg-connection-string, and `NODE_TLS_REJECT_UNAUTHORIZED` is not checked. Owner: TASK-014.
    - **10 (INFO):** the read-back uses an unqualified `=`.
    - **11 (INFO):** `63accea` quotes the gitleaks-flagged literal verbatim in `DECISIONS.md` and in a senior-developer memory file.
- **PR #13 is never merged itself (D-ORCH-017).** A superseding branch from main carries the reviewed tree.
- **Supersede done as PR #19** (`699f33d`, PASS_W_F-U, 2026-11-13; see [[project-p5-pr19-supersede]]). It closed PR13-SEC-04 (SELECT-only), -10 and -11. Still open: 05 (TASK-026), 08 (TASK-014/089/025), 09 (TASK-014).

**Why:** the seed CLI holds the DB-owner credential in every environment. Item 02 becomes the T-23 path once TASK-089 wires a writing provisioner. Item 11 is a gate problem: any branch created before `63accea` that merges main re-adds those lines in its first-parent merge diff, and lane A gitleaks then goes red. PR #11 and PR #4 are in that position.

**How to apply.**
- **Supersede round, against the new head:**
  - `git merge-base --is-ancestor e6ccf60 <new>` and the same for `5fcf177` both exit 1.
  - For the 36 PR paths, the diff from `e42e368` is only the D-ORCH-015 reconciliation (table-class `$comment`, `grants.manifest`) and optionally item 10.
  - `.gitleaks.toml` and `.gitleaksignore` are unchanged against main.
  - Lane A is green.
  - The record on the branch names the new head.
  - Check that item 11 was fixed on main.
- **Never quote a gitleaks-flagged value in a record or memory.** Describe it instead, and search for it with a regex that does not itself match (`pw-[0-9]{10}`).
- **TASK-014:** move `tlsConfig`, `readRootCertificate` and `withoutQuery` into `@platform/config`. The seed passes an explicit `ssl` setting and is a `checkToolingEnv` caller (`verify-full` in hardened environments). Ordering is snapshot → migrate → seed.
- **TASK-089:** set-password tokens never appear in error messages (`planSecrets` covers seeded passwords only).
- **TASK-221:** apply the 04 decision and handle the re-baseline after `down.sql`.
- **TASK-025:** the sink receives the migrator connection.

**Probe kit** (session-scoped, so rebuild it):
- `git archive <sha> prisma/seed packages/{config,authz,shared}/src`, then `build.mjs`.
- Strip in transform mode, rename `.ts` → `.js`, and rewrite `@platform/*` to relative paths.
- Add a junction `build/node_modules` → the worktree's `node_modules`. Remove it with `fs.unlinkSync`.
- `main(argv, env, output)` takes injected env and output.
- The URL differential: wrap `withMigratorConnection` with a factory that builds a real `pg.Client` and reads `connectionParameters` and `client.ssl` without connecting. Fuzz with `fc.sample`.

Related: [[project-p5-pr11-rls-review]], [[project-p5-wave0-db-baseline]], [[project-p5-wave0-config-review]], [[project-p5-pr9-runtime-skeleton]], [[project-security-review-conventions]], [[project-p5-pr10-ci-lane]]
