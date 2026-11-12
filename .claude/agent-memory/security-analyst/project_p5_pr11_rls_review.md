---
name: project-p5-pr11-rls-review
description: PR #11 (TASK-016 RLS foundations) R1 557aada, R2 a3e8edd, R3 37a2109 (content merge-authorised) all PASS_WITH_FOLLOW-UPS; PR11-SEC-01..17; supersede-round checks (D-ORCH-018); Prisma/E-string/forge facts; TASK-020/021/024/010/034 checks
metadata:
  type: project
---

The PR #11 review (TASK-016) is in `docs/05-quality/security/PR-0011-TASK-016-security-review.md`. IDs are PR11-SEC-01..17.
- **R1** (head `557aada`, 2026-11-12): PASS_WITH_FOLLOW-UPS. 7 LOW (01–07), 4 INFO (08–11).
- **R2** (head `a3e8edd`, 2026-11-13): PASS_WITH_FOLLOW-UPS, not a merge authorisation. New 12/13/14 LOW, 15 INFO.
- **R3** (head `37a2109`, 2026-11-13): PASS_WITH_FOLLOW-UPS, **authorises the CONTENT** (net `git diff 63accea 37a2109`).
  - **Closed:** 09 (items 1–6), 11 a/h, 12, 13, 14 (a), 15 c/f/g. Rulings items 1, 2b, 5, 6, 8 done.
  - **New:** 16 LOW (`E'…'` escape strings in `EXECUTE` operands evade both scanners; owner TASK-024 with 14 b) and 17 INFO (a: deliberate `Sql` forge; b: lint binding-flow gaps; c: rule-11 tracking of `"lock_timeout"` / `set_config('lock_timeout')` / DO `SET`).
  - `37a2109` itself is NOT merged: merge commit `d68898a` carries main's since-scrubbed literal (gitleaks). D-ORCH-018 → a superseding branch from clean main.
- **Supersede round (next):** append "## Supersede round (head <sha>)" with a `Head` row and a last `Verdict` row. Check:
  - `d68898a` is not an ancestor;
  - `git diff 37a2109 <new> -- . ':!docs' ':!.claude'` is empty (main changed only docs/.claude after `63accea`);
  - `.gitleaks.toml` / `.gitleaksignore` are unchanged;
  - lane A is green, including the base-ref step after the D-ORCH-018 (2) harness fix. That fix is itself a security-owned change and needs its own review.
- Validate the record with main's checker (`record-parse-check.mjs`; controls: the old record → missing, `--pr 12` → missing).

**Facts verified (`@prisma/client` 7.10.1; re-verify after upgrades):**
- **`$parent` (R1) and `requestTransaction(null|batch)` (R2)** reach the root pool. Both are closed in R3: `TenantDb` results are frozen, null-prototype, lazy thenables with `then` / `catch` / `finally` only.
- **Prisma splices `Sql` values by `instanceof Sql`** (a CJS class from `@prisma/client-runtime-utils`). The guard's `isSqlFragment` is duck-typed (`Array.isArray` of `strings` / `values`, or the direct proto's `constructor.name`). An intermediate proto with its own `constructor` plus array-likes passes it and is spliced. It is lint-clean via `Object.getPrototypeOf(Prisma.sql\`…\`)`.
- **`db-raw-sql` tracks bindings** only through member reads, declarators, `=` and calls. The namespace passed as an argument, in a literal or through `?:`/`??` is not followed; the run-time guard is the backstop.
- **PostgreSQL `E'…'` strings decode `\x` / octal / `\u`**, like `U&`. The tokenizer in `tools/db/sql-text.ts` already flags the `E` prefix (`escaped`). A text regex `/\be'/i` false-positives on `'e'`, so the fix must be token-level.
- **`REASSIGN OWNED BY platform_migrator TO platform_definer`** lints clean but cannot run: it needs the privileges of both roles, and the migrator's definer membership is `INHERIT FALSE`.
- **`pg` env:** only `PGOPTIONS` injects session settings. Timeouts are read from config only (env read disabled).
- **Lexical-scanner limits** (unchanged; owners TASK-024 / TASK-021): keyword-split, `format('%s')`, `EXECUTE r`, `chr()`, hex-`decode`, `pg_show_all_settings`, DO bodies for rules 8 / 9 b / 15.

**Why:** TASK-016 is the O3 control. Its residuals close only if later reviews check them.

**How to apply.**
- **TASK-020.**
  - Runner activation: the generated client is passed via `createRuntimeServices` → `databaseRuntimeFromConfig(…, Client)`, never through a second composition. `startup()` is awaited before listen and before the worker takes work.
  - Verify PR11-SEC-09 items 3–4 at the `tx` slot.
  - Then 17 a/b, and T-83.
- **TASK-024.** 14 (b) dynamic-SQL allow-list; 16; 17 c (setter keys); 15 b/d/e/h/i; C3 derived set; DR-A14 templates; rule 9 a / 17; C1 scope; `runtimeReadOnly`.
- **TASK-021.** 14 (c); 15 a and 17 c DO bodies; C6/C7/C14; `lc_messages` fallback file; delete the spk08 spike together with its `keys` exemption.
- **TASK-010.** `security.*` runtime-log events → the security logger keeping `{event, correlationId, sqlState}`; `sessionContextLeaks()` → a metric.
- **TASK-034.** `readSecret` open-once (11 d, not taken in PR #11).
- **TASK-037 / TASK-049.** DR-A14 sign-off (merge condition).
- **TASK-015.** C-1 with `SPK03_BENCH=1`; delete the spk03 spike together with its exemption.

Related: [[project-p5-wave0-rls-spike]], [[project-p5-pr8-authz-review]], [[project-p5-wave0-db-baseline]], [[project-security-review-conventions]], [[project-p3-security-conditions]], [[project-p5-pr10-ci-lane]], [[project-p5-pr13-seed-framework]]
