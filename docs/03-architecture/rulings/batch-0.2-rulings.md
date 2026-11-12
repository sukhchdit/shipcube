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

---

# Part 2 — rulings after fix cycle 1 (2026-11-12)

| Field | Value |
|---|---|
| Trigger | Three design questions left open by the batch-0.2 implementers and reviewers (PR #5 code review §4 item 3 and m9; PR #3 code review m8/§4; PR #4 code review m5 and PR4-SEC-01; PR #2 code review m2/m3/m9/n4 and D-TASK002-02) that the remaining PRs and later tasks must share one answer to |
| Evidence | `main` @ `2720891` (`package.json`, `eslint.config.mjs`, `stylelint.config.mjs`, `.stylelintignore`, `tools/lint/negative-fixtures.test.ts`); PR #5 @ `4574a14` (`tools/db/bootstrap.ts`, `tools/db/lint-migrations.ts`, `prisma/bootstrap/00-roles.sql`, `package.json`); PR #3 @ `875409d` (`packages/config/package.json`, `src/tooling-keys.ts`, `src/secret-refs.ts`, `src/file-secret-provider.ts`, `src/schema.ts`, `src/web/*`, `.env.example`); PR #4 @ `9f5ea5e` (`apps/web/vite.config.ts`, `apps/web/app/seo/public-origin.ts`, `apps/web/package.json`); `node_modules/eslint-plugin-boundaries` 7.4.1 (`dependency` matcher accepts `kind: 'type' \| 'value'` besides `nodeKind`) |
| Decisions | D-ARCH-052 … D-ARCH-056 |
| Documents amended | ADR-0018 am. 6 and am. 7 · ADR-0003 "Amendment (2026-11-12, batch 0.2 part 2)" items 1–3 · ADR-0026 am. 14 · ADR-0002 batch-0.2 amendment item 2 · `data-model.md` §8.3 (rule 12 bootstrap lane, rule 13 code-only text) · `docs/04-plan/generator/plan-data.mjs` (`rls` = TASK-016, `spk06` = TASK-022, `slice` = TASK-026; regenerated, 0 errors) |

Same verdict vocabulary as Part 1.

## Item 9 (brief item 1) — `BOOTSTRAP_{MIGRATOR,APP}_PASSWORD[_FILE]` vs ADR-0018 §3 `*_REF`

**Ruling: ACCEPTED WITH CONDITIONS — the `_FILE` idiom stands for the tooling set as a register exception (holder `bootstrap`); `*_REF` is not adopted for the bootstrap lane; `readSecret` must reach the `file` provider's hardening bar (TASK-016).** D-ARCH-052.

- **What the two PRs do.** PR #5 `tools/db/bootstrap.ts#readSecret(env, name)` reads `NAME`, else the file named by `NAME_FILE`, never logs either, and the CLI header documents both forms. PR #3 (fix cycle 1, D-TASK005-02) already moved the five tooling keys into `packages/config/src/tooling-keys.ts` with sensitivity `secret` / `secret-ref`, holders `migrate` / `bootstrap`, "names exactly TASK-003's, including Docker's `<NAME>_FILE` idiom", documented them in `.env.example` ("set a password or its `_FILE` path, not both") and made api/worker refuse them in hardened environments. The two PRs therefore already agree; the mismatch is between the code and one sentence of ADR-0018 §3.
- **Why `_FILE`, not `*_REF`, here.** (1) ADR-0018 §3's "code holds references" was always the rule for **external credentials** (`STRIPE_*_REF`, `CARRIER_*_SECRET_REF`, `STORAGE_*_KEY_REF`, `MAIL_SMTP_PASSWORD_REF`, schema sensitivity `secret-ref`); platform-held material — the `<key_id>:<base64>` key rows of amendment 1, `DATABASE_URL`, `REDIS_URL`, `SEED_*` — is a **direct value** in the environment (sensitivity `secret`), injected by Compose locally and by the ECS task definition's `secrets:` from Secrets Manager at M5. The bootstrap passwords are platform-held material of exactly the `DATABASE_URL` class (they *are* the passwords embedded in `DATABASE_URL`/`DATABASE_MIGRATOR_URL`), so the direct form is the consistent one; the `_FILE` variant is only Compose's way of delivering a direct value as a file. (2) The bootstrap tool holds the cluster-admin credential and is the most privileged code path in the system; keeping its import closure to `pg` + `node:*` (no `@platform/config` graph, no Joi/Zod, no AWS SDK adapter) is the same isolation argument that keeps the ORM out of it (SEC-P3-34 theme). `*_REF` would buy `aws-secrets-manager:` resolution that a one-shot pipeline job never needs — at M5 the job receives the value as an injected environment variable. (3) The PostgreSQL image itself uses `POSTGRES_PASSWORD_FILE`; an operator sees one idiom across the two one-shots that share a Compose secret. (4) Zero code change to PR #5 and PR #3.
- **Condition — hardening parity (binding, TASK-016, before TASK-014 mounts Compose secrets).** `readSecret` today reads any path and follows symlinks; PR3-SEC-07 set the bar for the `file` provider and the same bar applies here: the `_FILE` path is lexically under `/run/secrets` (the `FILE_PATH` rule of `secret-refs.ts`; root injectable for tests), `realpath` confinement, regular file, ≤ 64 KiB, one trailing newline stripped, empty = unset, **exactly one** of `NAME` / `NAME_FILE` set (both → error — the `.env.example` sentence becomes enforced), and every error names the variable, never the path or the value. Owner TASK-016 (holds `prisma-core`, batch 0.5, same batch as TASK-014); TASK-014 wires one Compose `secrets:` entry per role and references only `/run/secrets/<name>` paths, which already satisfies the lexical rule; security-analyst checks the parity list in the TASK-014 review.
- **Spec changes.** ADR-0018 amendment 6 (two delivery forms; tooling-set exception; parity list; register row `DB_URL, DB_MIGRATOR_URL, bootstrap credential` Storage wording). `plan-data.mjs` `rls` (TASK-016): `tools/db/bootstrap.ts` (readSecret hardening) in files, one acceptance line.
- **Code follow-ups for PR #5 / PR #3:** none required. D-ORCH-006 item 5's "DB config-key reconciliation by the later-merging PR" is **done** at PR #3 @875409d (tooling-keys.ts); nothing further.

## Item 10 (brief item 2) — data-model §8.3 wording for rules 12 and 13

**Ruling: AMENDED to the stricter code.** D-ARCH-053.

- **Rule 12, bootstrap lane (PR5-SEC-02, CR m1).** Part 1 item 5 described the lane as "marker required for `SET ROLE`, `OWNER TO` and membership grants; the role's own attributes, schema grants and default-privilege row need none" — an allow-by-default reading that the fix cycle replaced. The code is **deny-by-default**: any statement that mentions `platform_audit_owner` needs the marker unless it is one of three tightening forms matched against the whole whitespace-normalised statement — `ALTER ROLE platform_audit_owner` with negative attributes only (`NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`), `GRANT USAGE|CREATE ON SCHEMA <names> TO platform_audit_owner` (no other grantee, no `WITH GRANT OPTION`), `ALTER DEFAULT PRIVILEGES FOR ROLE platform_audit_owner [IN SCHEMA <names>] REVOKE …` — or it is the role-creation `DO` block of `00-roles.sql`, recognised by the SHA-256 of its whitespace-collapsed text pinned in the linter (`AUDIT_OWNER_CREATION_BLOCK`). The pin is sound because applied bootstrap files are immutable through the ledger (`bootstrap_migrations.sha256`): the exemption cannot drift, and any other body that names the role (dynamic SQL) needs the marker. Denied without marker (fixtures `tools/db/fixtures/lint/bootstrap/audit-owner-*`): membership grants in any position (`GRANT a, platform_audit_owner TO x`, `ALTER GROUP`), `SET [LOCAL|SESSION] ROLE`, `OWNER TO`, `REASSIGN OWNED BY`, `DROP OWNED BY`, `ALTER ROLE … LOGIN|PASSWORD|BYPASSRLS|RENAME|SET|VALID UNTIL`, `DROP ROLE`, `ALTER DEFAULT PRIVILEGES … GRANT`, schema grants `WITH GRANT OPTION`, and bodies that name the role. Consequence stated in the amendment: a future bootstrap file that creates or alters roles carries the marker unless it uses only the three tightening forms — intended.
- **Rule 13, code-only text (CR m2).** "whose header (the text up to the body's opening `AS`)" had a hole: PostgreSQL accepts `… AS $$ … $$ LANGUAGE sql SECURITY DEFINER;`. The code evaluates the statement's **code-only text** (string literals, dollar-quoted bodies and comments blanked by the tokenizer): for `CREATE [OR REPLACE] FUNCTION|PROCEDURE`, `SECURITY DEFINER` anywhere in the code-only text requires `SET search_path = pg_catalog, pg_temp` (`TO` accepted) in the code-only text — a `search_path` set only inside the body does not satisfy it, and `SECURITY DEFINER` only inside a string or body does not trigger it; for `ALTER FUNCTION|PROCEDURE`, `SECURITY DEFINER`, `RESET search_path`, `RESET ALL` and any `SET search_path` other than the fixed value fail. Fixtures `definer-after-body/*` (three cases) and `definer-path`.
- **Spec changes.** data-model §8.3: the Part 1 "Rule 12, which `platform_audit_owner` statements count" paragraph is marked superseded in place; a new dated amendment carries both rules as above. The security review's PR5-SEC-02 "Remediation" wording matches the amendment (security-analyst confirms in round 2).
- **Code follow-ups for PR #5:** none.

## Item 11 (brief item 3) — `@platform/config/web` vs the web/admin import allow-list

**Ruling: KEEP the web subset in `packages/config`; ALLOW the `@platform/config/web` subpath only — as a value import from the apps' build configuration files, as a type-only import from application code. Owner of the wiring, `VITE_PUBLIC_ORIGIN` registration and the lint change: TASK-022.** D-ARCH-054.

- **The conflict.** PR #2 (main) encodes ADR-0003 "web and admin import `@platform/shared` and `@platform/ui`" as a boundaries policy over every file under `apps/{web,admin}/**` (category `app`), so `apps/web/vite.config.ts` importing `@platform/config/web` is reported today (external-specifier arm and resolved-file arm, D-TASK002-02 item 4). ADR-0018 §1 placed the Zod web subset in `packages/config` "consumed by Vite's `define`" — a build-time consumer, which ADR-0003 never considered.
- **Why not move it to `packages/shared`.** `packages/config` is the single owner of every variable: the `.env.example` parity test, the "no key of the web schema is a secret in the backend schema" test and the shared `brand-rules.ts` (Joi and Zod built from one rule set with a parity test, D-ORCH-006 item 4) all live there. Moving the subset would also put `zod` into `packages/shared`'s dependencies and therefore into the api/worker closure (Zod is not in the backend stack). Brief §4.1 names `/config` for "typed, validated environment configuration".
- **Consumption model (ADR-0018 am. 7).** `@platform/config/web` is a **build-time** module (its entry re-exports only and is free of Node-only modules, as PR #3 wrote it). Value importers: `apps/{web,admin}/vite.config.ts` (and `react-router.config.ts` if the prerender list needs config), which call `loadWebBuildConfig(loadEnv(mode, <repo root>, ''))` and set `define: webBuildDefine(config)`. Application code (`apps/*/app/**`) reads `import.meta.env.<KEY>` and imports **types only** (`import type { WebBuildConfig } from '@platform/config/web'`) for the `ImportMetaEnv` augmentation in `app/env.d.ts`. Once `define` is wired, `envPrefix` is a prefix no variable carries (the schema is the only path into a bundle), `loadWebBuildConfig` rejects any `VITE_*` key outside `WEB_CONFIG_KEYS` (fail fast on a misnamed variable; PR #3 code review m8), `VITE_PUBLIC_ORIGIN` joins `webConfigSchema` as a **required** absolute http(s) origin (no `localhost` fail-open — PR #4 code review m5; `.env.example` carries `http://localhost:8080`; TASK-014 passes it as a build arg), `publicOrigin()` becomes a static `import.meta.env.VITE_PUBLIC_ORIGIN` read, and the prerender integration test builds with canaries (`VITE_CANARY`, `VITE_PUBLIC_CANARY`) that must be absent from every emitted asset while a defined key is present, plus the no-source-map assertion (PR4-SEC-01 test list). Until then PR #4's `envPrefix: 'VITE_PUBLIC_'` is the accepted interim control.
- **Lint change (precise; `lint` lock; the orchestrator routes it — implemented inside TASK-022 unless routed elsewhere).** See "Lint-rule change specification" below (L1–L5). Semantics are binding; matcher syntax follows TASK-002's conventions.
- **Owner.** TASK-022 (SPK-06, batch 0.7, `frontend-developer`, opus): it is the first task that works on the web build after TASK-004, TASK-005 and TASK-014 have merged, and CSP hashes come out of the same build. Its sheet gains the dependency `config` (TASK-005), the files `apps/{web,admin}/vite.config.ts`, `apps/{web,admin}/app/env.d.ts`, `packages/config/src/web/web-schema.ts` (+ `.env.example`, `compose.env`), `eslint.config.mjs` + fixtures, `apps/web/tests/prerender.int.test.ts`, two acceptance lines, and the locks `web-core`, `admin-core`, `pkg-config`, `lint` (free in batch 0.7). TASK-026 (walking skeleton, batch 0.8) then reads `import.meta.env.VITE_API_BASE_URL` with no wiring of its own.
- **Code follow-ups for PR #4:** none for this item (the interim `envPrefix` is accepted; do **not** wire `@platform/config/web` in PR #4). **PR #3:** none.

## Item 12 (brief item 4) — ADR-0002 §6 Stylelint script wording (TASK-002 n4)

**Ruling: AMENDED to the implemented script; verified on main.** D-ARCH-055.

- **Verified on `main` @2720891.** `package.json` line 20: `"lint": "eslint . --max-warnings 0 && stylelint \"**/*.css\" --max-warnings 0 --allow-empty-input"`. `.stylelintignore` is anchored to the root and workspace output folders (`/dist/`, `/build/`, `/coverage/`, `/apps/*/{build,dist,coverage}/`, `/packages/*/{dist,coverage}/`, `/apps/*/.react-router/`, `/prisma/generated/`, `/docs/`, `/.claude/`, `/tests/fixtures/lint/`). `stylelint.config.mjs` sets `reportNeedlessDisables`, `reportInvalidScopeDisables`, `reportDescriptionlessDisables`. `tools/lint/negative-fixtures.test.ts` "lint wiring" asserts both tools run with `--max-warnings 0` (`/^stylelint .*--max-warnings 0/`), so removing `--allow-empty-input` later keeps the test green.
- **Spec change.** ADR-0002 batch-0.2 amendment item 2 carries the proposed text (as given in the brief) with the ignore list spelled out; the §6 line `stylelint "apps/**/*.css" "packages/ui/**/*.css"` is withdrawn.
- **Code follow-up for PR #4 (at its rebase onto main; already a TASK-004 obligation from PR2-SEC-03 item 3):** drop `--allow-empty-input` from the root `lint` script — PR #4 adds the first CSS (`apps/{web,admin}/app/app.css`, `packages/ui/src/theme.css`), so the flag's only effect would be to hide a future "linted nothing". PR #4 @9f5ea5e still carries the pre-rebase `lint` script (`eslint . --max-warnings 0`); the rebase takes main's line, minus the flag.

## Item 13 (brief item 5) — ADR-0003 Prisma-importer wording; where the Axios client lives

**Ruling: ADR-0003 amended to the exact-path list; the Axios client lives in `packages/ui/src/api/**`, `packages/shared` holds no HTTP library; no lint change for the client.** D-ARCH-056.

- **Prisma / driver importers (precision).** Repositories (`apps/api/src/modules/*/repository/**`), the database platform (`apps/*/src/platform/db/**`), two named stores that are repositories by function but live outside a module — `packages/audit/src/store/prisma-store.ts` (audit writer store, ADR-0007; TASK-025) and `apps/api/src/platform/outbox/writer.ts` (outbox writer/relay, ADR-0004; TASK-043) — and the tooling categories `prisma/**`, `tools/db/**`, tests. The two paths are exact (`PLANNED_PRISMA_FILES`, D-TASK002-02 item 3); TASK-025/TASK-043 create exactly them; any further importer is a `lint`-locked config edit **and** an ADR-0003 amendment (conformance verdict NEEDS-ADR otherwise). The rule message "only repositories import Prisma" stays as the rule of thumb.
- **Axios client.** ADR-0026 §4 says "`packages/shared/api` generated types + a thin typed client over Axios" without a location; PR #2 m2 asked. Decision: `packages/shared` is consumed by api and worker, so an `axios` dependency there would enter the server runtime closure — an installed second HTTP library beside the one egress path ADR-0016 §13 mandates, and dead weight in the images — and `packages/shared/src/api/**` stays under `platform/outbound-http-via-client`. `packages/ui` is the **browser-shared** package (design system plus browser platform code: TASK-065's `src/session/**` interceptor already lives there), excluded from the rule (`BROWSER_PACKAGES`) and never in a server image; the client goes to **`packages/ui/src/api/**`** (`client.ts`: Axios instance, base URL from `import.meta.env.VITE_API_BASE_URL`, problem+json mapping seam, typed by `@platform/shared` api types). `packages/shared` declares no `axios`/`undici`/`node-fetch`/`got`/`ky` (toolchain structure test, added with the client), and `apps/{api,worker}` never import `@platform/ui` (policy L5 below). Creating task: **TASK-026** (walking skeleton — the first API consumer), lock `ui-api` added. Brief §4.1's package list is unchanged (no new package).
- **Spec changes.** ADR-0003 part-2 amendment items 1 and 3; ADR-0026 am. 14; `plan-data.mjs` `slice` (TASK-026) files + lock.
- **Code follow-ups for PR #2 / #3 / #4 / #5:** none.

## Lint-rule change specification (routed by the orchestrator; `lint` lock; TASK-002 conventions: one `lintText` probe or fixture per arm, positive control, message cites the ADR)

| # | Change to `eslint.config.mjs` | Must report | Must stay clean |
|---|---|---|---|
| L1 | `BOUNDARIES_FILES`: add `{ pattern: 'apps/*/{vite,react-router}.config.ts', category: 'app-build-config', capture: ['app'] }` and `{ pattern: 'packages/config/src/web/**', category: 'config-web' }` (files keep their other categories) | — | — |
| L2 | After the web/admin disallow+allow pair: `{ from: { file: { categories: { anyOf: ['app-build-config'], noneOf: ['test'] }, captured: { app: '{web,admin}' } } }, allow: { to: [toPackage('@platform/config/web'), { file: { categories: 'config-web' } }] } }` (both arms, as D-TASK002-02 item 4) | `apps/web/vite.config.ts` importing `@platform/config` (root) or `@platform/config/testing` | `apps/web/vite.config.ts` and `apps/admin/vite.config.ts` importing `@platform/config/web` |
| L3 | `{ from: IMPORTER_APP('{web,admin}'), allow: { to: [toPackage('@platform/config/web'), { file: { categories: 'config-web' } }], dependency: { kind: 'type' } } }` — the `dependency` matcher the config already uses with `nodeKind: 'export'`; boundaries 7.4.1 accepts `kind: 'type' \| 'value'` | `apps/web/app/x.ts` value import, `import('@platform/config/web')`, `export * from '@platform/config/web'` | `apps/web/app/env.d.ts` `import type { WebBuildConfig } from '@platform/config/web'`; `export type { … } from` |
| L4 | Message of the web/admin disallow extended: "…; build configuration files (vite.config.ts, react-router.config.ts) may import @platform/config/web, application code only its types (ADR-0003 am. part 2, ADR-0018 am. 7)" | — | — |
| L5 | `{ from: IMPORTER_APP('{api,worker}'), disallow: { to: [toPackage('@platform/ui'), { file: { categories: 'package', captured: { pkg: 'ui' } } }] }, message: 'apps/api and apps/worker never import @platform/ui: it is the browser-shared package and carries axios (ADR-0003 am. part 2).' }` | `apps/api/src/x.ts` importing `@platform/ui` | `apps/web/app/x.tsx` importing `@platform/ui` |

No change to `platform/outbound-http-via-client` scope (`SERVER_SOURCES` minus `BROWSER_PACKAGES`) or to `PLANNED_PRISMA_FILES`.

## Summary of required code changes per PR (Part 2)

| PR | Required before merge | Follow-up (owner) |
|---|---|---|
| #5 (TASK-003 @4574a14) | **None.** `_FILE` idiom accepted; rule 12/13 code is the spec | `readSecret` hardening parity (TASK-016, before TASK-014 mounts Compose secrets) |
| #3 (TASK-005 @875409d) | **None.** Tooling set with `_FILE` confirmed; `config/web` location confirmed | `VITE_PUBLIC_ORIGIN` into `webConfigSchema`; unknown-`VITE_*` rejection (TASK-022) |
| #4 (TASK-004 @9f5ea5e) | **At rebase onto main:** remove `--allow-empty-input` from the root `lint` script (one token; PR2-SEC-03 item 3 already names TASK-004). Keep `envPrefix: 'VITE_PUBLIC_'`; do not wire `@platform/config/web` here | `define` wiring, `env.d.ts` type import, canary test (TASK-022); Part 1 item 6 structure-test follow-up unchanged |
| #2 (TASK-002, merged) | — | Lint changes L1–L5 (routed by the orchestrator; default owner TASK-022) |

## Open items handed on (Part 2)

- **Orchestrator:** route L1–L5 (default: inside TASK-022, which now holds the `lint` lock in batch 0.7); regenerate the plan once after PR #5 merges (Part 1 item 4 note still applies — my `rls`/`spk06`/`slice` hunks do not overlap PR #5's TASK-007/014/049/214 hunks); confirm D-ORCH-006 item 5 reconciliation closed at PR #3.
- **security-analyst:** PR #5 round 2 — confirm the rule-12 deny-by-default wording (PR5-SEC-02 remediation) matches the data-model amendment; PR #3 round 2 — the `_FILE` exception replaces the PR #5 §4 item 3 rename request; TASK-014 review — check the `readSecret` parity list; PR3-SEC-08 / PR4-SEC-01 owner is TASK-022.
- **senior-developer (TASK-022 brief):** ADR-0018 am. 7 consumption model, L1–L5, `VITE_PUBLIC_ORIGIN` required, canary + no-source-map assertions, `packages/config/src/web/**` must stay free of `node:*`, `joi` and the backend schema (assert it if TASK-005 did not).
- **senior-developer (TASK-016 brief):** `readSecret` parity list (ADR-0018 am. 6). **(TASK-026 brief):** `packages/ui/src/api/client.ts` per ADR-0026 am. 14; `packages/shared` HTTP-library guard.
