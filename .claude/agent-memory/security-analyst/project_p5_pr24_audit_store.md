---
name: project-p5-pr24-audit-store
description: PR #24 (TASK-021 audit store SQL, guard, readiness, shadow init) R1 @6f498c4 PASS_W_COND; R2 @7662672 2026-11-13 PASS_WITH_FOLLOW-UPS (C1 met, rule-12 approval 90 blob 9aab9aa); PR24-SEC-01..11; PG18 probe facts (multirange, SET SCHEMA, operator hijack, CIC leftover, constructor routines); merge-round triggers; Docker lane-probe recipe
metadata:
  type: project
---

The PR #24 review is `docs/05-quality/security/PR-0024-TASK-021-security-review.md`. Rounds are appended, uncommitted, to the copy in the main checkout.

**R1** (head `6f498c4`): PASS_WITH_CONDITIONS.
- C1: post-loop guard invariant (PR24-SEC-01).
- C2: round-2 record.
- Also: 02 readiness bare `=`, 03 rule-11 DO-body RESET regression, 04 CODEOWNERS gaps, INFO 05–09.

**R2** (head `7662672`, 2026-11-13): PASS_WITH_FOLLOW-UPS.
- **Closed:** 01, 02 and 03 all fixed in-PR.
- **Rule-12 approval:** `90-audit-ddl-guard.sql` blob `9aab9aaab73fcb53e3f8a5e835d7d451af606be3` granted; `10-audit.sql` blob `c3d4db9` stays approved. Any other blob needs a new record.
- **New PR24-SEC-10 (LOW).** `CREATE INDEX CONCURRENTLY` under an audit name is refused, but leaves an INVALID index (`indisready t`, `indisvalid f`).
  - The invariant then blocks all non-audit-owner DDL.
  - `sql_drop` `c_idx` refuses dropping it, even for the superuser.
  - One leftover can be renamed away by its owner; two self-lock, and break-glass is `SET event_triggers = off`.
  - Routed to principal-architect (§5.2 stated limit), TASK-090 (runbook) and TASK-033 (test).
  - Rules 12 and 16 refuse the name in migrations, so only the raw migrator credential can do it.
- **New PR24-SEC-11 (INFO).** Rule 11 trusts a top-level RESET inside `BEGIN … ROLLBACK`; this predates the PR → TASK-024.
- **Correction:** R1's 08 (a) claim that "only a superuser can plant after the invariant" is wrong because of CIC.
- **Code review R2** (`f56b12f`) is APPROVED_WITH_NITS. Its R2-n1 (table, view, matview, index and function squats are undroppable) and R2-n3 (self-exception is NULL after a guard rename) agree with mine.

**Facts probed on PG 18.6** (re-verify after upgrades):
- **Multirange side effect.** `ddl_command_end` reports only the range type for `CREATE TYPE … AS RANGE`; the multirange with an explicit name is never reported.
- **Constructor routines.** Range and multirange constructor functions are created owned by the BOOTSTRAP SUPERUSER, not the type's creator.
  - A multirange named `ensure_audit_partitions` plants zero-arg and other constructor routines under that name.
  - `ensure_audit_partitions` has `DEFAULT 3`, so a zero-arg plant makes `ensure()` ambiguous.
- **`SET SCHEMA` moves.** `ALTER TABLE|VIEW|MATERIALIZED VIEW … SET SCHEMA` reports only the relation; its indexes and owned sequences move silently.
- **CIC leftover.** A `ddl_command_end` raise after `CREATE INDEX CONCURRENTLY` cannot roll back the committed CIC phases. `REINDEX CONCURRENTLY` of an index named `audit` is unaffected.
- **Planting test squats.** As the superuser, `SET event_triggers = off; SET ROLE platform_migrator; …` plants a squat without the guard.
- **Migrator has no schema of its own.** No `CREATE`/`TEMP` on the DB; its only writable schemas are `public` and `platform`, both protected.
- **Better-match operator hijack.** `pg_catalog` first in `search_path` stops same-signature plants but not better-match ones (`oid = integer`, `oid = regnamespace`).
- **Replica mode.** The superuser's UPDATE/DELETE/TRUNCATE/MERGE all raise `AUDIT_IMMUTABLE`.
- **DateStyle.** `ensure` bounds are stable under `DateStyle`/`IntervalStyle` changes.

**Docker lane-probe recipe.** Scripts are in session scratch `review/PR-24-sec-r2/probe/` (`run.sh` plus SQL files).
1. Acquire the lock with `mkdir docker.lock` plus an owner file.
2. Run `postgres:18@sha256:e3d24f69…` with `-d --network none --rm -e POSTGRES_HOST_AUTH_METHOD=trust`, the probe dir mounted `:ro`, then `docker exec … bash -c "tr -d '\r' < /probe/run.sh > /tmp/run.sh && bash /tmp/run.sh"`.
3. Apply the lane with psql `-1 -v ON_ERROR_STOP=1 -v db_name=X -v migrator_password= -v app_password=`.
4. For a mutation control, apply the old guard blob to a second DB in the same cluster: `00-roles` is role-idempotent.
5. Readiness SQL is extracted verbatim from the TS template literal (`scripts/extract-sql.mjs`).

**Why:** These items land in other tasks, and future merges of main can void the R2 record.

**How to apply:**
- **Merge-only round needed** if PR #20 (`eslint.config.mjs`, `tools/tsconfig.json`), PR #26 (`tools/tsconfig.json`) or PR #27 (`eslint.config.mjs`) merges first. Name the merge commit and redo blob plus `merge-tree` checks.
- **These keep R2 valid** (sim cases L/M): an evidence-only `docs/**` commit, or a merge of main with no owned overlap.
  - PR #28 merged as `ab42cc6`, so D-ORCH-034 lane-B evidence is due after the D-ORCH-035 scrub PR.
- **PR #20 union** (second merger): both events in `RUNTIME_SECURITY_EVENTS` at `error`; allow-lists `partition_name, kind, reason, sql_state` and `sql_state`; `security.emit` replacing `log.error`, with `component` dropped.
- **TASK-015:** 04 CODEOWNERS plus bootstrap immutability.
- **TASK-024:** 02 class fix (pg_operator assertion, `CREATE OPERATOR` lint), 05, 11.
- **TASK-090:** 07, the 10 runbook, and multi-squat recovery ("all in one command or break-glass").
- **TASK-033:** the 10 CIC case, plus PR12-SEC-01/06.
- **TASK-116:** assert `evtfoid` = `platform.audit_ddl_guard()` by name.

Related: [[project-p5-pr12-spk08-audit]], [[project-p5-pr10-ci-lane]], [[project-p5-wave0-db-baseline]], [[project-p5-pr21-openapi-pipeline]], [[project-security-review-conventions]]
