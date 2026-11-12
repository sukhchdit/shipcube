---
name: project-p5-pr11-rls-review
description: PR #11 (TASK-016 RLS foundations) R1 557aada + R2 a3e8edd PASS_WITH_FOLLOW-UPS; PR11-SEC-01..15; Prisma $parent / requestTransaction / Sql-splice escapes; open architecture items 1/2b/5/6/8 for the reconciliation pass; R3 + TASK-020/021/024/037 checks
metadata:
  type: project
---

The PR #11 review (TASK-016) is in `docs/05-quality/security/PR-0011-TASK-016-security-review.md`. IDs are PR11-SEC-01..15.
- **R1** (head `557aada`, 2026-11-12): PASS_WITH_FOLLOW-UPS. 7 LOW (01–07), 4 INFO (08–11). §4 holds the full closure table (PR7/PR8/PR5/PR2/PR9 items, F-01..F-13, am. 10 items 1–16, linter rules, C1–C14).
- **R2** (head `a3e8edd`, 2026-11-13): PASS_WITH_FOLLOW-UPS, explicitly *not* a merge authorisation for that head.
  - **Closed:** 01, 02, 03 (PR scope), 04, 05 (items 1–3), 06, 07, 08.
  - **New:** 12 LOW (`requestTransaction`), 13 LOW (`Sql`-value splice), 14 LOW (`U&` / keyword-split / computed `EXECUTE` evasions), 15 INFO (residuals list a–i).
  - **Rulings "Required in PR #11" still open at a3e8edd:**
    - 1: `RESET lock_timeout` when the value is > 3s;
    - 2 (b): `ALTER … OWNER TO platform_definer` ban;
    - 5: qualified helper bodies;
    - 6: `lc_messages = 'C'` in `02-role-backstops.sql`;
    - 8: D-ORCH-014 (a)–(f) + PR11-SEC-09 wiring.
  - All of these go to the reconciliation (merge-main) pass, which needs an **R3 delta review**.

**Facts verified (`@prisma/client` 7.10.1; re-verify after upgrades):**
- **`$parent` escape (R1).** Every client and delegate has a `$parent` layer. An itx `$parent` is an unguarded client of the same transaction; its `_originalClient` is the root. Closed in R2 by a deny-by-default deep Proxy.
- **`PrismaPromise.requestTransaction(t)` (R2).** `ji()` in `runtime/client.js` re-runs the query callback with `t`. `null`, or `{kind:'batch'}`, gives **no itx**, so the query runs on the root pool, and this still works **after commit**. It is not on the public `PrismaPromise<T>` type, so it needs a cast.
- **`Sql` values are flattened into the text** by `sql-template-tag` inside a tagged `$queryRaw`. `new Prisma.Sql([s],[])`, a non-tagged `Prisma.sql([s])`, `Prisma.join(v, sep, prefix, suffix)` and `raw` all splice. Repositories may import `@prisma/client/runtime/client` (`Sql`, `sqltag`, `join`, `raw`, `makeTypedQueryFactory`).
- **`$queryRawTyped`** throws while the typedSql preview is off (no `previewFeatures` in `prisma/schema/_base.prisma`).
- **Non-atomic `migrate deploy`** (R1 rule-5 probe; adopted by D-ARCH-071).
- **Lexical scanners** (`tools/db/tenant-key-forms.ts` is shared by rule 16 and the C-series) miss:
  - `U&"\0061pp"` identifiers and `U&'…'` strings;
  - `'SET' || ' LOCAL ' || 'app.' || 'org_id'`;
  - `format('%s %s', 'SET LOCAL', split)`;
  - `EXECUTE r` / `chr()`.

  Rules 8, 9 b and 15 do not read DO bodies. `set_config('role', …)` is invisible to rule 15. There is no check on schema ACLs (`GRANT CREATE ON SCHEMA`) or on `CREATE RULE`.

**Why:** TASK-016 is the O3 control. Its residuals land in later tasks and close only if those reviews check them.

**How to apply.**
- **R3 (reconciliation head).**
  - Check items 1, 2 (b), 5, 6 and 8:
    - helper bodies = data-model §4.2;
    - C13 has five `platform_app` rows;
    - the PR11-SEC-09 list: one composition function, `deps.env` omitted, the probe awaited, sinks with a latch, `statement_timeout=30s`, and a `DbError` body without message, reason, `sqlState` or `prismaCode`.
  - Check whichever of 12, 13, 14 (a) and 15 c/f were taken.
  - Re-run the probes (P-A2 `tenantdb-escape-r2.mjs`, P-B2 `rule16-r2.mjs`, P-C2 `policy-grant-role-r2.mjs`, P-D2 `eslint-probe-r2.mjs`). Scratch is session-scoped, so re-create them if gone.
  - Validate the record with main's checker (`record-parse-check.mjs`; controls: the old record → missing, a wrong PR → missing).
- **TASK-020.** 12/13 if not taken in PR #11; 15 g (TS quoted GUC names, destructuring / template-key lint); T-83 rule; PR11-SEC-09 at the `tx` slot.
- **TASK-024.**
  - 14 (b) dynamic-SQL allow-list (today only `ensure_audit_partitions`);
  - 15 b, d, e, h, i;
  - C3 derived set; DR-A14 templates; rule 9 a / rule 17; C1 scope; `runtimeReadOnly`.
- **TASK-021.** 14 (c) rule-10 computed `EXECUTE`; 15 a (DO bodies for rules 8 / 9 b / 15); C6/C7/C14; trigger event names; `lc_messages` fallback file.
- **TASK-037 / TASK-049.** Security sign-off on the rendered DR-A14 policies (merge condition); C11 expects the `app_actor_id` → `platform_definer` grant.
- **TASK-015.** C-1 with `SPK03_BENCH=1`; the spike file and its exemption are deleted together.
- **TASK-025 / TASK-043.** SYSTEM writers take `TenantDb` only.
- **TASK-034.** `readSecret` open-once (PR11-SEC-11 d).
- **qa-lead.** Activate `migration-lint` and `catalog-c1-c14` at merge.

Related: [[project-p5-wave0-rls-spike]], [[project-p5-pr8-authz-review]], [[project-p5-wave0-db-baseline]], [[project-security-review-conventions]], [[project-p3-security-conditions]], [[project-p5-pr10-ci-lane]]
