---
name: project-p5-pr11-rls-review
description: PR #11 (TASK-016 RLS foundations) R1 2026-11-12 PASS_WITH_FOLLOW-UPS; PR11-SEC-01..11; verified Prisma $parent escape, non-atomic migrate deploy consequences, C5 PUBLIC gap; checks owed in TASK-037/015/025/043/051/024 and the composition-root wiring task
metadata:
  type: project
---

The PR #11 review (TASK-016) is in `docs/05-quality/security/PR-0011-TASK-016-security-review.md`. IDs are PR11-SEC-01..11.
- **R1** (head `557aada`, 2026-11-12): PASS_WITH_FOLLOW-UPS. 7 LOW (01–07), 4 INFO (08–11).
- 01, 02, 04 and 08 were recommended for the PR's own fix cycle.
- §4 holds the full closure table: PR7/PR8/PR5/PR2/PR9 items, F-01..F-13, am. 10 items 1–16, linter rules and C1–C14.

**Facts verified 2026-11-12 (`@prisma/client` 7.10.1, PG 18 docs). Re-verify after upgrades.**
- **`$parent` escape.** Every Prisma client and model delegate has a `$parent` layer (`runtime/client.js` `Zn`/`Yt`).
  - For an itx client, `_createItxClient` sets `_appliedParent` to another itx client of the same transaction. That client is unguarded: `$transaction` gives a savepoint, and `*Unsafe` is available.
  - Its `_originalClient` is the ROOT client. A module-private `Symbol()` (`Xn`) also unwraps to the client.
  - So a top-level-only Proxy that blocks `_`-keys is not complete. Model delegates need wrapping too.
- **Non-atomic `migrate deploy`.** Prisma 7.10.1 runs a migration file statement by statement, with no wrapping transaction (PR #11 rule-5 probe).
  - `SET LOCAL lock_timeout` in a migration has no effect.
  - The "grants before `OWNER TO`" definer form leaves a migrator-owned definer on partial failure.
  - Session `SET ROLE` persists on the deploy connection.
- **C5 PUBLIC gap.** The PR's C5 query filtered `grantee <> 0`, so PUBLIC grants (which `platform_app` inherits) were invisible. `TRUNCATE` and `REFERENCES` bypass RLS (PG §5.9).
- **Rule-16 / prosrc evasions.** Both scanners missed: `''||'app.org_id'`, `"set_config"(…)`, `format('SET LOCAL %I…', 'app.org_id')`, `SET "app".org_id`, `RESET "app".org_id` and `SET app . org_id`. The linter missed dynamic `current_setting(k)`.
- **Renderer vs rule 16.** The renderer's own operator policy fails rule 16, so TASK-037's first RLS migration will hit it.

**Why:** TASK-016 is the O3 control. Its residuals land in later tasks and close only if those reviews check them.

**How to apply.** In these reviews, check:
- **The wiring task (second of PR #9/#11; D-TASK016-01).** Use the PR11-SEC-09 list:
  - one composition function in `platform/db`;
  - `deps.env` omitted;
  - `probeFreshConnection` awaited before ready;
  - the security-event, counter and not-ready sinks, with the not-ready latch;
  - `EXPECTED_ROLE_SETTINGS` += `statement_timeout=30s`;
  - the `DbError` problem body carries no message, reason, `sqlState` or `prismaCode`.
- **TASK-037.**
  - The rule-16 operator-atom exemption and the rule-9 "policies equal renderer output" check (PR11-SEC-03).
  - The DR-A14 mechanism (PR11-SEC-10): named templates or an exact-text exemption file; a positive status list instead of `<> 'REMOVED'`.
  - The C11 converse (06); grant-after-FORCE (07); the `app_actor_id` → `platform_definer` grant reflected in C11.
- **TASK-015.** C-1 run with `SPK03_BENCH=1`. The spike file and its exact-file exemption are deleted together.
- **TASK-025/043.** The writers take `TenantDb` and use no `pg` or client of their own (PR2-SEC-05 addendum still open).
- **TASK-051/021.** Distinct trigger events; `expect-affected` raised to `error`.
- **TASK-024.** The C12 generator, including the DR-A14 policies.
- **qa-lead.** Activate `migration-lint` and `catalog-c1-c14` in `required-suites.json`.
- **Unowned at R1.** The T-83 lint and the C8/C9 catalog owners.

Related: [[project-p5-wave0-rls-spike]], [[project-p5-pr8-authz-review]], [[project-p5-wave0-db-baseline]], [[project-security-review-conventions]], [[project-p3-security-conditions]]
