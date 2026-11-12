# Architecture rulings — P5 Wave 0, batch 0.2 (TASK-003 PR #5, TASK-004 PR #4, TASK-005 PR #3)

| Field | Value |
|---|---|
| Date | 2026-11-12 |
| Author | principal-architect |
| Trigger | CLAUDE.md §5 "Architecture changes": implementers deviated from the design docs for evidenced reasons; the spec is amended here, not drifted silently |
| Evidence | `gh pr view 5` / `gh pr diff 5` (head `d8ba197`), `gh pr view 4` / `gh pr diff 4` (head `519bb89`), `gh pr view 3` (head `be468bc`); PostgreSQL 18 reference *ALTER DEFAULT PRIVILEGES* and source `schemacmds.c` / `extension.c` (REL_18_STABLE); Prisma ORM docs *Generating down migrations* and error reference (P3012) |
| Decisions | D-ARCH-045 … D-ARCH-051 (`docs/sdlc/DECISIONS.md`) |
| Documents amended | `data-model.md` §4.4, §4.6 (C5/C11/C13), §7.3, §8.1, §8.3, §8.4, §8.6, §12 (A16) · ADR-0005 am. 9 · ADR-0002 batch-0.2 amendment · ADR-0026 am. 12 note + am. 13 · ADR-0018 am. 5 · `platform.md` §4.3 · `docs/04-plan/spikes/SPK-01.md` §2 item 5 · `docs/04-plan/generator/plan-data.mjs` (TASK-003, TASK-016; regenerated, 0 errors) |

Verdict vocabulary: **ACCEPTED** (code is right, spec amended) · **ACCEPTED WITH CONDITIONS** (code is right; a named follow-up is required) · **REJECTED** (code must change).

## Item 1 — TASK-003: the migrator does not own the database (SEC-P3-34 item 5)

**Ruling: ACCEPTED.** D-ARCH-045.

- **What the code does.** `00-roles.sql` never transfers the database; `platform_migrator` gets `CONNECT` plus `USAGE, CREATE` on `public`/`platform`; `01-schemas.sql` installs `pg_trgm`, `btree_gin`, `btree_gist` as the bootstrap role; `00-roles.sql` ends with `ALTER ROLE CURRENT_USER IN DATABASE :"db_name" SET search_path = pg_catalog, pg_temp`; the runner, harness and `db:reset` connect with `options=-c search_path=pg_catalog,pg_temp`; tests prove `42501` for the migrator on `ALTER DATABASE … SET`, `CREATE SCHEMA`, `CREATE EXTENSION`, `ALTER SCHEMA public RENAME`, and prove that `migrate deploy`/`status`/`db execute` succeed.
- **Why it is right.** The security review already recommended it (SEC-P3-34 item 5) and only deferred it for an unanswered question — does Prisma Migrate need database ownership? TASK-003 answered it (no, on 7.10.1 / PG 18). A database owner can set a database-wide `search_path` that no event trigger sees; removing that capability from the migrator credential is the whole point of SEC-P3-34. Bootstrap files are immutable once applied, so the first file is the cheapest moment.
- **Facts verified for the amendment.** PostgreSQL checks `CREATE` on the database *before* the `IF NOT EXISTS` existence check in `CreateSchemaCommand` (`schemacmds.c`), so a Prisma-generated `CREATE SCHEMA IF NOT EXISTS "public"` would now fail — the old §4.4 claim that it would be a no-op is withdrawn. `CreateExtension` (`extension.c`) checks the duplicate name and honours `IF NOT EXISTS` *before* any privilege check, so re-running `CREATE EXTENSION IF NOT EXISTS` on an installed extension is harmless, while a new extension fails by privilege for the migrator.
- **Spec changes.** data-model §4.4 SQL and role table; the SEC-P3-27 evaluation table rows for `migrate deploy`, trusted extensions, `migrate reset` and bootstrap ordering; §4.6 C13 (c)/(d); §7.3 (shadow rendering keeps `CREATE EXTENSION`); §8.6 step 4 list; §12 A16 and the SPK-08 open point; ADR-0005 am. 9; platform.md §4.3. New linter rule 14 (schema/extension/database/role DDL in `prisma/migrations/**` fails) — owned by TASK-016 (item 5).
- **Code follow-ups for PR #5:** none required. *Optional:* none.
- **For other tasks.** TASK-012 (SPK-03/SPK-08): exercise `migrations.initShadowDb` with the migrator-runnable rendering of the bootstrap lane **including** the three `CREATE EXTENSION IF NOT EXISTS` lines (the migrator owns the shadow DB). TASK-021: `10-audit.sql` runs as the bootstrap role — unchanged. TASK-034: the restore rehearsal creates the target database as the bootstrap role and never transfers it.

## Item 2 — TASK-003: `ALTER DEFAULT PRIVILEGES … IN SCHEMA … REVOKE … FROM PUBLIC` is a no-op; global `FOR ROLE …` form used

**Ruling: ACCEPTED.** D-ARCH-046.

- **PostgreSQL semantics (verified, PostgreSQL 18 reference, *ALTER DEFAULT PRIVILEGES*, Description).** "Default privileges that are specified per-schema are added to whatever the global default privileges are for the particular object type. This means you cannot revoke privileges per-schema if they are granted globally (either by default, or according to a previous `ALTER DEFAULT PRIVILEGES` command that did not specify a schema). Per-schema `REVOKE` is only useful to reverse the effects of a previous per-schema `GRANT`." The reference's own example of the correct form is `ALTER DEFAULT PRIVILEGES FOR ROLE admin REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;` ("Remove the public EXECUTE permission that is normally granted on functions"). TASK-003 confirmed empirically that the per-schema form writes no `pg_default_acl` row.
- **The `TABLES` line.** `… IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC` was equally dead: PostgreSQL grants PUBLIC nothing on tables by default (§5.8 Privileges), so there was nothing to revoke. It is dropped, not carried as dead text; C5 now asserts that no default table/sequence/type/schema privilege row exists, which makes the grant manifest provably the only source of table privileges.
- **Placement.** The three global statements stay in `01-schemas.sql`, not `00-roles.sql`: `pg_default_acl` is per-database catalog state that `pg_dump` carries, and §8.6 runs only `00-roles.sql` before `pg_restore`. (SEC-P3-37 item 1's "schema must exist first" reason no longer applies to the global form; the placement reason is now the restore rule.)
- **Scope.** The global form also covers functions those roles create in `public`. Intended: every `EXECUTE` for `platform_app`/`platform_erasure` is already an explicit grant in the grant matrix.
- **Spec changes.** data-model §4.4 (both SQL blocks and a new amendment paragraph), §4.6 C5 and C11 (`pg_default_acl` assertions matching the PR's bootstrap tests: exactly three rows `defaclobjtype = 'f'`, `defaclnamespace = 0`, `<role>=X/<role>`; probe function in `platform` and `public`), ADR-0005 am. 9.
- **Code follow-ups for PR #5:** none required. The PR's bootstrap tests already assert the three rows and the probe; TASK-016's catalog suite repeats the assertions on the migrated schema.

## Item 3 — TASK-003: `prisma migrate resolve --rolled-back` fails with P3012; the driver sets `rolled_back_at` directly

**Ruling: ACCEPTED (test/dev only).** D-ARCH-047.

- **Facts verified.** Prisma ORM docs, *Generating down migrations*: `migrate resolve` "can only be used on failed migrations". Error reference: **P3012** "Migration `{migration_name}` cannot be rolled back because it is not in a failed state." The original §8.4 step 2 copied the down-migration recipe, whose context is a failed `up`; for a successful migration there is no supported Prisma command.
- **What the code does.** `tools/db/up-down-up.ts`: `db execute --file down.sql`, then an injected `markRolledBack(name)` (the harness implements it as an `UPDATE public._prisma_migrations SET rolled_back_at = now() WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL`, as the migrator, which owns the table), then `migrate deploy`. The driver also snapshots **S0** before step 1 and requires `S_down = S0` when nothing was excluded, stopping before re-apply when leftovers exist. That is stronger than the original §8.4 (it proves each `down.sql` is complete).
- **Boundary.** The history-table write is confined to the Testcontainers suite and local `db:reset`-class flows. Production rollback stays roll-forward or restore-based (§8.2; CLAUDE.md §5). The §8.4 amendment says so explicitly.
- **Spec changes.** data-model §8.4 step 2 struck through and amended; `[NT-DATA-004-a]` empty-database half claimed by `prisma/tests/migrations/up-down-up.int.test.ts`; seeded half waits for TASK-023.
- **Code follow-ups for PR #5:** none required.

## Item 4 — TASK-003: bootstrap file names `00-roles.sql` / `01-schemas.sql` vs the plan sheet's `0001_roles_schemas.sql`

**Ruling: ACCEPTED — the data-model names win; the plan sheet is corrected.** D-ARCH-048.

- **Why.** §8.6 runs *only* the roles file before `pg_restore`; a single roles-and-schemas file would put `CREATE SCHEMA platform` before the restore and fail `--exit-on-error`. The `NN-<name>.sql` pattern (`00`, `01`, `10`, `90`) is the designed layout (§4.4 bootstrap block, §8.1).
- **Also fixed (SEC-P3-37 item 4).** data-model §4.4 named two paths for one file; `infra/compose/postgres/initdb/00-roles.sql` is withdrawn — `prisma/bootstrap/` is the only location, applied by `tools/db/bootstrap.ts` from the Compose `bootstrap` one-shot service.
- **Spec changes.** `plan-data.mjs` TASK-003 files entry → `prisma/bootstrap/{00-roles.sql, 01-schemas.sql}`; regenerated `WAVE-00.md`/`task-map.csv` (0 errors); data-model §4.4 and §8.1.
- **Code follow-ups for PR #5:** none.
- **Merge note.** PR #5's docs commit `2e70cec` also edits `plan-data.mjs` (TASK-007/014/049/214 hunks) and regenerates `WAVE-00/01/07.md` + `task-map.csv`. My hunks (TASK-003 line, TASK-016 entry) do not overlap, so the merge should be clean; after PR #5 lands, the orchestrator runs `node docs/04-plan/generator/gen.mjs . --write` once and expects an empty `git status --porcelain docs/04-plan/`.

## Item 5 — TASK-003: migration-linter rules 3–9 and 11 not implemented; ownership

**Ruling: ACCEPTED WITH CONDITIONS — TASK-003 met its sheet; the rules go to TASK-016.** D-ARCH-049.

- **TASK-003 delivered** rules 1, 2, 10, 12, 13 and the contract-reversibility check ("C"), each with negative fixtures, and correctly did **not** claim `[SEC-TC-33]` or `[NT-AVAIL-003-a]`.
- **Owner: TASK-016** (Wave 0 batch 0.5, `database-engineer` · opus). Reasons: it ships the first real migration (`platform_rls_helpers`: policies, definer functions, grants — the statements rules 7–9 police); it closes US-074, which activates the `migration-lint` required suite (`required-suites.json`, `required_cases: ["SEC-TC-33"]`); no free specialist slot in batch 0.3/0.4 exists without displacing demo-critical work. The sheet now adds `prisma-core` to TASK-016's locks (TASK-003's lock, free after merge), `NFR-AVAIL-003`/`NFR-DATA-004` to its NFRs, `tools/db/lint-migrations.ts` + fixtures to its files, two acceptance items and a DoD note.
- **Unlocks.** `[SEC-TC-33]` ← rules 7, 8, 9, 12, **14** (`DROP TRIGGER`, `DISABLE`/`NO FORCE ROW LEVEL SECURITY`, `DISABLE TRIGGER`, `BYPASSRLS`/`SUPERUSER`/ownership to `platform_app`, `DELETE` grant outside the allow-list, privilege on a partition, `DROP POLICY` without re-creation, table without RLS block, schema/extension/database/role DDL in migrations). `[NT-AVAIL-003-a]` ← rules 2, 3, 4, 5, 6, 11 (`DROP` outside contract, `RENAME`, `NOT NULL` without constant default / validated CHECK, `ALTER COLUMN … TYPE`, non-`CONCURRENTLY` index on a pre-existing table or `CONCURRENTLY` in a multi-statement file, FK/CHECK without `NOT VALID`, missing `SET lock_timeout`).
- **Rule 5 prerequisite.** TASK-016 runs a one-statement `CREATE INDEX CONCURRENTLY` migration through `migrate deploy` in the harness to record how Prisma 7.10 submits it (the §8.3 "verify in P5 spike" note), and writes the fixture from that result.
- **New rule 14** (consequence of item 1): `CREATE SCHEMA`, `CREATE EXTENSION`, `ALTER DATABASE`, `ALTER SCHEMA … OWNER TO`, `CREATE/ALTER/DROP ROLE` in `prisma/migrations/**` fail — each would fail at deploy with `42501` anyway; the linter is the PR-time early warning.
- **Rule 12 precision** (PR #5 decision 5). In the bootstrap lane the marker is required for `SET ROLE platform_audit_owner`, `OWNER TO platform_audit_owner` and **membership** grants (`GRANT platform_audit_owner TO …`); the role's own attributes, its schema privilege grants and its default-privilege row in `00`/`01` need none. This is what `AUDIT_OWNER_ACTION` in `lint-migrations.ts` implements; **security-analyst confirms in the PR #5 review** (the PR asked for it).
- **Code follow-ups for PR #5:** none required. *Optional (may be done in TASK-016 instead):* the `lint-migrations.ts` header comment "Rules 3-9 and 11 are not implemented yet (see the TASK-003 report)" could name TASK-016 and rule 14.

## Item 6 — TASK-004: `typecheck` = `npm run typegen && tsc -b`

**Ruling: ACCEPTED.** D-ARCH-050.

- **Why.** Route modules import `./+types/<route>` declarations that exist only after `react-router typegen` writes them into the git-ignored `.react-router/`; `tsc -b` alone fails on a clean checkout. Committing `.react-router/`, excluding route modules, or moving typegen into `build` only were each rejected (D-ARCH-050).
- **Guards kept.** `.react-router/` git-ignored (clean-tree checks unaffected); `typegen` is an npm script (local bin, never `npx`); the committed `entry.server.tsx` (D-ARCH-039) stops typegen's `isbot` install; workflow-level `NPM_CONFIG_IGNORE_SCRIPTS` (D-ARCH-044); `root-scripts.test.ts` asserts the `tsc -b` tail and the "every workspace is referenced" property.
- **Spec changes.** ADR-0002 batch-0.2 amendment item 1 (refines SPK-01 amendment item 2); ADR-0026 am. 12 note and new am. 13 (a workspace adding `react-router.config.ts` must add the `typegen` script; the structure test asserts it — this last assertion is a small TASK-004 or TASK-002 follow-up, see below).
- **Code follow-ups for PR #4:** none required for merge. *Follow-up (either PR #4's final Playwright commit or TASK-007's repository tests):* extend `tools/repo/react-router-entry.test.ts` so that every workspace with a `react-router.config.ts` also declares `"typegen": "react-router typegen"` (ADR-0026 am. 13).
- **CLAUDE.md §2 replacement wording** (orchestrator edits CLAUDE.md): see the Handoff Report.

## Item 7 — TASK-005: ADR-0018 key register has 25 rows; the brief said 24

**Ruling: 25 is authoritative; no plan-sheet change needed.** D-ARCH-051 (1).

- The ADR-0018 amendment-1 table has 25 rows. No `docs/04-plan` artefact says 24; the "24 entries" wording is in the P3 security review's SEC-P3-08 remediation line and the batch-0.2 dispatch brief — both predate the four §12 "register gap" keys folded into the table. `keys.ts` (PR #3) has 25 entries; `keys.test.ts` asserts the count, unique `key_id`s and two-way variable parity with the Joi schema (`[SEC-TC-49]`).
- **Spec changes.** ADR-0018 am. 5 records the count and the parity rule. The security review line is not mine to edit (docs/05-quality is security-analyst's); flagged in the Handoff Report.
- **Code follow-ups for PR #3:** none.

## Item 8 — SPK-01 §2.5: record the m4 choice

**Ruling: recorded.** D-ARCH-051 (2).

- SPK-01 §2 item 5 now states: TASK-002 (PR #2) added the local ESLint rule `barrel-reexport-only` restricting `packages/*/src/index.ts` to re-exports, with a negative fixture; the Jest `collectCoverageFrom` barrel exclusion is **kept** (hides nothing by construction; keeps never-imported entry files out of the denominator). The "remove the exclusion later" alternative is dropped. TASK-015 adds the per-path 95 % thresholds on top.
- **Code follow-ups for PR #2:** none.

## Summary of required code changes per PR

| PR | Required before merge | Optional / follow-up |
|---|---|---|
| #5 (TASK-003) | **None.** The code matches the amended data-model §4.4, §4.6, §8.3, §8.4 | Header comment in `tools/db/lint-migrations.ts` may name TASK-016 and rule 14 (or TASK-016 does it). security-analyst confirms the rule-12 interpretation (PR decision 5) |
| #4 (TASK-004) | **None.** `typecheck` script accepted | Structure test: every `react-router.config.ts` workspace declares the `typegen` script (ADR-0026 am. 13) — in PR #4's final commit or TASK-007 |
| #3 (TASK-005) | **None.** 25 rows confirmed | — |
| #2 (TASK-002) | **None.** m4 recorded in SPK-01 | — |

## Open items handed on

- **Orchestrator:** CLAUDE.md §2 wording (item 6); run `gen.mjs --write` once after PR #5 merges (item 4 merge note); STATUS.md FU-TASK001 m4 can be marked done (item 8).
- **security-analyst:** rule-12 interpretation (PR #5 decision 5); SEC-P3-08 "24 entries" line in the P3 review is stale (25); SEC-P3-34 items 1–3 can be marked implemented at TASK-003 (item 4, the runbook, stays G4-production); SEC-TC-65 (harness-path probe) is still only proposed — qa-lead to adopt into the TASK-016 catalog suite.
- **qa-lead / senior-developer (TASK-016 brief):** carry the amended sheet (rules 3–9, 11, 14; SEC-TC-33; NT-AVAIL-003-a; C5/C11/C13 amended assertions; rule-5 harness probe).
- **TASK-012 (SPK-03/SPK-08):** `initShadowDb` with the rendered bootstrap SQL including `CREATE EXTENSION`.
