---
name: task024-rls-generator
description: TASK-024 (2026-11-14) - generated RLS suite wiring in tests/generated, eslint --fix import rewrite trap, released-migration immutability vs new down.sql rules, split linter/DB specialists
metadata:
  type: feedback
---

TASK-024 was a 20+ item card (generator, DR-A14, std guard, C3/C15, 8 linter items, up-down-up prefix). Split: lead did manifests/renderer/generator/catalog (~150 calls); one opus database-engineer did all 8 linter items (92 tool uses, finished and reported); a second did up-down-up prefix + guard share after the first ended (one specialist at a time).

**Why:** these traps cost several calls each and will recur for TASK-027/033/278 (other generated suites).

**How to apply:**
- **tests/generated is composite**: importing tools/db or prisma/tests/harness gives TS6307; list every transitive file in `tests/generated/tsconfig.json` `files` (+ `allowJs` for tools/deps/npm-cli.mjs). ESLint `import-x/no-relative-packages` flags them too: add an anchored ignore for exactly those targets in `eslint.config.mjs` (security-owned).
- **Never run `eslint --fix` on files with relative cross-package imports**: it rewrote them to `@platform/root/tools/...` / `@platform/prisma/tests/...`, which do not resolve. Revert with sed.
- **Avoid tenant-context lint exemptions** in tests: import `CONTEXT_STATEMENT_SQL` from with-tenant-tx.ts and bind raw values (it also proves the production path). Test titles and SQL strings naming `app.actor_scope` / `set_config(` trip `platform/tenant-context-sql`; regex LITERALS do not.
- **Released migration dirs are immutable** (check-migration-immutability): a new down.sql rule (rule 17) must grandfather them by an exact frozen list with a test that each still needs it.
- jest `--selectProjects generated` works for `tests/generated/**/*.int.test.ts`; the suite is `planned`, so do not put its JUnit in lane-B evidence; report runs in the PR body.
- Node one-liners with `\\b` in JS strings produce a literal backspace; write scripts with the Write tool (again). Scratchpad subdirs got wiped mid-run (t024/); recreate before writing.
- Generated suite design that passed first try: seed as superuser with `SET LOCAL session_replication_role = replica`, probe as platform_app per case in BEGIN/ROLLBACK (SAVEPOINT when the caller holds a txn), pin 42501 for missing privileges instead of skipping.

Related: [[lane-b-evidence-run]], [[p5-dispatch]], [[task020b-lessons]]
