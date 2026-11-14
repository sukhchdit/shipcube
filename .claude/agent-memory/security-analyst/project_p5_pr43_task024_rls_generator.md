---
name: project-p5-pr43-task024-rls-generator
description: PR #43 (TASK-024 generated RLS suite, DR-A14 sets, std_columns_guard, linter 11c/17/18/19) R1 @8ac271d 2026-11-14 PASS_WITH_CONDITIONS; C1 splitStatements `begin` regression (in-PR, R2 needed), C2 API_CASES registration-only; PG RLS/escape facts; union and R2 checklists
metadata:
  type: project
---

Record: `docs/05-quality/security/PR-0043-TASK-024-security-review.md`, written into worktree `Shipqube-TASK-024` (uncommitted, LF, 390 lines). R1 head `8ac271d23aaa44388008ff9306a389b447eb0781`, merge base `201d8d9`, 103 owned paths (checker). Verdict PASS_WITH_CONDITIONS: 2 MEDIUM, 4 LOW, 4 INFO.
- **C1 = PR43-SEC-03 (MEDIUM, regression, merge condition):** `sql-text.ts:205-207` raises block depth for any unquoted `begin`/`case` once a statement starts `create [or replace] function|procedure`. BEGIN is unreserved, so `CREATE FUNCTION public.begin()` or a param `begin` merges the rest of the file into 1 statement (base 7) and silences rules 2, 7, 8, 9, 11, 11c, 17 (also down.sql rule 17). psql's own heuristic guards with paren_depth 0 and CASE only inside a block. Fix: open only on `begin atomic` at paren depth 0, `case` only at depth >= 1, fail closed on unbalanced depth, fixtures.
- **C2 = PR43-SEC-01 (MEDIUM):** `API_CASES` is a `ReadonlySet<string>` that only silences `routeCaseFindings`; nothing runs a request per registered route. `tenantResourceRoutes` drops `guest` tenancy, and the unit test pins `getQuote` excluded, although `getQuote` is dual-mode (`x-permission-authenticated: quote:read`). Due before the first tenant/user/guest resource route merges.
- LOW 02 write probes (WHERE id / SET k=k make PG apply SELECT policies, so a write-only leak is invisible; need blind `UPDATE t SET c=$1` / `DELETE FROM t` probes + write mutation control, re-parent, guest writes). LOW 04 `tests/generated/rls/**` + `tests/generated/api-mounts.ts` unowned (sim S6 proves). LOW 05 `ENABLE REPLICA|ALWAYS TRIGGER` lints clean (rule 7 matches only `disable trigger`, `lint-migrations.ts:909`) and C15 (a) committed asserts table names only (`c15:154-155`). LOW 06 `standard_conforming_strings=off` makes plain strings decode `\x61` (both lanes, incl. bootstrap rule 12), `query_to_xml`/`ts_stat` run query strings without EXECUTE, nesting cap 4 fails open, allow-lists keyed by name. INFO 07-10.
- Sign-offs given in the record: DR-A14 mechanism (data-model A19 merge condition of TASK-037/049); PR24-SEC-06 closed as superseded (bootstrap immutability in `check-migration-immutability.mjs`); PR32-SEC-07 (c) re-routed to principal-architect + system-model-owner/db-raw-sql edit (020-C or 020-D).

**Facts (PG 18, verified from docs or probe):** RLS footnote (a): SELECT policies filter UPDATE/DELETE only when the statement reads columns. `has_table_privilege` ignores column-level grants (quotes' column UPDATE grants will false-fail `update-foreign-id` at TASK-051). `standard_conforming_strings` is still USERSET in 18. FK and unique checks bypass RLS (existence oracle; data model has no general composite-FK rule). `pg_temp` is never searched for operators/functions.

**Why:** C1 needs a delta round before merge, and the other items land in TASK-037/051/027 and the activation PR.

**How to apply:**
- **R2 (C1):**
  - re-run the five `begin` rows: 7 statements, all tail findings;
  - new fixtures present; prefix-reversibility pins unchanged;
  - append the `## Round 2` Head row + final Verdict row;
  - check whether 04 (CODEOWNERS) rode along.
- **Union:** #42 adds a `packages/audit/src/store/prisma-store.ts` `setter` exemption next to this PR's `render-rls-dr-a14.test.ts` `keys` entry; no textual overlap. 020-C (`680e458`) hunks 303/385/893 don't overlap either. The second merger needs a merge-only round (both edit the owned `eslint.config.mjs`); re-lint `tests/generated/rls/**` after the union.
- **TASK-037:** DR-A14 real tables listed with policySet+definerRead; `trg_organisations__type_immutable` + `ux_organisations__single_operator`; 05/06 fixed; SEC-TC-74 gaps (07); INVITED ruling (09 a).
- **Activation PR:** the generated JUnit is in the evidence; 02 and 04 are merged.
- **Record-sim gotcha:** with `MSYS_NO_PATHCONV=1`, `git -C /c/...` fails ("cannot change to"), so `sparse-checkout set` silently did not apply. Use `cygpath -m` for `-C` in that call. Script shape: `scratchpad/pr43/sim/record-sim.sh` (session-scoped; S0-S8).
- **Shared memory dir:** another security-analyst instance (the PR #42 review) edits MEMORY.md concurrently. Read it right before editing, and add one line.

Related: [[project-p5-pr11-rls-review]], [[project-p5-pr26-standard-columns]], [[project-p5-pr24-audit-store]], [[project-p5-pr32-route-pipeline]], [[project-p5-wave0-rls-spike]], [[project-security-review-conventions]]
