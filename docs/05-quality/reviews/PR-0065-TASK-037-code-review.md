# Code review: PR #65 / TASK-037, round 1

Organisations, memberships and users with DR-A14 RLS and the standard-columns guard.

| Field | Value |
|---|---|
| Reviewer | code-reviewer |
| Date | 2026-11-18 |
| Reviewed range | `git diff origin/main...bf53c46`, with main at `36bc841` (main is now `dbbb815`, which changes docs/04-plan and docs/sdlc only, so nothing overlaps) |
| Head | `bf53c46` (local, not pushed) = PR head `d3c2c16` + 3 merges of main + fix cycle 1 (`fdfbbd8`, `1a8ca17`, `f3d3b3a`) |
| Scope | 38 files, +2151 / -39 |

## Verdict

**VERDICT: CHANGES_REQUESTED** (1 BLOCKER, 2 MAJOR, 4 MINOR, 7 NIT)

**SUMMARY**
- **The migration does not apply on PostgreSQL.** `platform.role_scope_matches_org()` puts a bare `CASE … THEN … END` inside a PL/pgSQL `IF … THEN`. PL/pgSQL stops reading the condition at the first `THEN`, so `CREATE FUNCTION` fails with 42601 and `migrate deploy` stops with P3018.
  - I reproduced this on PGlite 17.5.
  - The lane-B run in progress on `bf53c46` fails the same way (`.orch/laneb-queue/Shipqube-TASK-037.log:178-197`, every integration suite).
  - So no database test in this PR has ever run.
- **Two more tests fail once B1 is fixed.** Each was proven with a probe that patches B1 and applies all the migrations:
  - The C11 helper expectation was never adapted, although the card requires it (M1).
  - The AT-US-061-03 database test trips a CHECK before the trigger it means to prove (M2).
- **The design follows the card and the rulings.**
  - The reserved OPERATOR row is placed correctly and the rewritten AT-US-061-02 test proves the right thing.
  - The templates are copied verbatim, the RLS blocks are rendered, and the linter is clean.
  - The merges are pure.
  - The MINOR findings are tenant-integrity backstops worth closing while the migration is still mutable.

## 1. What I verified myself

Host rule: no npm, Jest, typecheck, build or Docker. I used static reading plus single-process Node probes on a `git archive` extract of `bf53c46`, with a `node_modules` junction to the worktree. I did not modify the worktree.

| Check | Result |
|---|---|
| Merge purity | `git diff origin/main bf53c46` equals `git diff origin/main...bf53c46` (same md5). All 3 merges (`664adec`, `694c8f7`, `bf53c46`) are byte-identical to `git merge-tree --write-tree` of their parents: no conflicts and no hand edits. |
| TASK-290 union (`tools/db/lint-migrations.ts`) | The PR's delta is one line (`COVERING_INDEX_TOLERANCE` gains `ix_memberships__user_status`). TASK-290's splitter is intact. `tsx tools/db/lint-migrations.ts` on the extract gives "no findings", and the Prisma schema validates. |
| Templates verbatim | `app-is-operator.sql` and `std-columns-guard.sql` are contained byte-for-byte in the migration (CR-normalised). |
| Prettier | `prettier --check` on every changed ts/json/md file: clean. |
| Migration on PGlite 17.5 (bootstrap 00-02 + every migration as `platform_migrator`, `uuidv7()` replaced by `gen_random_uuid()`) | The head **fails** at `role_scope_matches_org()` (42601). With only that `CASE` parenthesised, the whole file applies. |
| Probes on the patched migration | See the table below. |
| Lane A | The PR head `d3c2c16` shows fast-lane and ci-gate FAILURE. `bf53c46` has never been pushed, so no lane A has run on it. |
| Lane B | A run on `bf53c46` is in progress. Its log shows P3018 / 42601 "syntax error at end of input" (position 710) and every integration suite FAILING at template migrate. |
| Open-PR overlap (P1) | #58 (lock and package.json), #50, #49 and #16 share no file with this PR. 287-B is not a PR yet. |

| Probe (patched migration, platform_app with the production context keys) | Observed |
|---|---|
| AT-US-061-02: OPERATOR insert in the context of a fresh org id | `23505 ux_organisations__single_operator` (as the test expects) |
| AT-US-061-03 as tested: BUSINESS_CUSTOMER → INDIVIDUAL | `23514 ck_organisations__personal_owner`, **not** P0001 (M2) |
| AT-US-061-03: BUSINESS_CUSTOMER → PARTNER | `P0001 ORG_TYPE_IMMUTABLE` |
| AT-US-062-02 / 062-03 / SEC-TC-74 forged creator, forged version, re-parent | P0001 ROLE_NOT_ALLOWED / ok; 23505; P0001 created_by; P0001 version; 42501 RLS (all as the tests expect) |
| C11 helpers query on the committed state | `app_actor_id()` EXECUTE = [platform_app, **platform_definer**, platform_migrator]. A **4th** row `app_is_operator()` matches `LIKE 'app\_%'` (M1). |
| membership_roles row in A pointing at B's membership | `ok`: not refused (m1) |
| Multi-org actor (ACTIVE in A and B), A context, insert `org_id = B` | `42501 new row violates row-level security policy`: the trigger passes and WITH CHECK decides (m2) |
| Single-org actor, same insert | `P0001 ROLE_NOT_ALLOWED_FOR_ORG_TYPE` (the D-TASK037-14 expectation holds) |
| Personal org: re-point `personal_owner_user_id` to a visible DEACTIVATED user and set `deleted_at` in one UPDATE | `ok`: the row is deleted while its real owner is ACTIVE (m3) |
| A context: insert an ACTIVE membership for an arbitrary existing user id | `ok` (security flag S1) |

**Not re-run:** lint, typecheck, unit, build, coverage, integration and generated suites (host rule). For those, the evidence is the lane-B run once B1, M1 and M2 are fixed. No database test of this PR has ever executed, so treat the next lane-B run as the first evidence, not a confirmation.

Probe scripts are in the session scratchpad: `pr65/probe/probe0.mts` (minimal 42601 reproduction), `probe1.mts`, `probe2.mts`, `probe3.mts` and `probe4.mts`.

## 2. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| **R1-B1** | **BLOCKER** | `prisma/migrations/20261117000000_organisations_identity/migration.sql:349-350` | `IF v_type IS NULL OR … IS DISTINCT FROM CASE v_type WHEN 'OPERATOR' THEN … END THEN`. PL/pgSQL reads an `IF` condition up to the first `THEN` at parenthesis depth 0 and does not track `CASE`. The condition becomes `… CASE v_type WHEN 'OPERATOR'`, so `CREATE FUNCTION` fails with 42601 (check_function_bodies is on) and `migrate deploy` fails with P3018. Every migrated template, every integration, catalog, generated and API suite, `compose up` and the up-down-up check all fail. The linter cannot see this: it is not a PL/pgSQL parser. Proven by `probe0.mts` (bare CASE: 42601; parenthesised: created) and by lane B on `bf53c46`. | Parenthesise the CASE: `IS DISTINCT FROM (CASE … END) THEN`. Alternatively, assign the expected scope to a variable first. After the edit, run at least the `migrations` and `catalog-c1-c14` suites before hand-over: the PR went to review without its migration ever being applied. |
| **R1-M1** | **MAJOR** | `prisma/tests/catalog/c01-c12.int.test.ts:934-941` | The card's catalog adaptation of C11 is missing. The card says "C11 expects `platform.app_actor_id()` EXECUTE for platform_app, platform_migrator AND platform_definer, and `app_is_operator()` owned by platform_definer, SECURITY DEFINER, fixed search_path, EXECUTE for platform_app only". The helper assertion still expects 3 rows with `execute: [platform_app, platform_migrator]`. On the committed schema, the migration's `GRANT EXECUTE ON FUNCTION platform.app_actor_id() TO platform_definer` adds `platform_definer`. The query's `LIKE 'app\_%'` also returns `platform.app_is_operator()` (owner platform_definer, prosecdef, proconfig set). So `C11 [SEC-TC-05]` fails as soon as R1-B1 is fixed (probe4). | Update the helper expectation: `app_actor_id()` gets execute `[platform_app, platform_definer, platform_migrator]`, and `app_is_operator()` is either excluded from the helper list (it is asserted by the definer allow-list) or asserted with its own definer shape. Keep the other two helpers exactly as they are. |
| **R1-M2** | **MAJOR** | `prisma/tests/organisations/organisations.int.test.ts:291-301` | The database half of `[AT-US-061-03]` changes `BUSINESS_CUSTOMER → INDIVIDUAL` on an organisation with no personal owner. `ck_organisations__personal_owner` runs in `ExecConstraints` before any AFTER trigger, so the statement fails with 23514, not with the `P0001 ORG_TYPE_IMMUTABLE` the test expects. As written, the test fails and does not prove the trigger (probe3: INDIVIDUAL gives 23514, PARTNER gives P0001). | Prove the trigger with a change that satisfies every CHECK (BUSINESS_CUSTOMER → PARTNER, plus OPERATOR → BUSINESS_CUSTOMER on the reserved row). If you keep INDIVIDUAL, keep it as a separate case expecting 23514. Add a mutant check by hand: dropping `trg_organisations__type_immutable` must turn the PARTNER case into `ok`. |
| R1-m1 | MINOR | `apps/api/src/modules/organisations/service/organisation-service.ts:91-95`; `repository/organisation-repository.ts:125-126`; `migration.sql:129,137-139` | **Ids that point into another tenant are not bound to the row's tenant.** (a) `assignRole` takes `membershipId` and `orgId` from the caller and checks neither against the transaction's organisation. The port JSDoc says "A role of a membership of the context organisation", but nothing enforces it. `organisationType(orgId)` reads any *visible* organisation (`member_read`), while the row is stamped with the context organisation. (b) In the database, `membership_roles(org_id = A, membership_id = <B's membership>)` is accepted (probe1 #1), because RI checks bypass RLS. The forged row is invisible to B, but any later query that counts roles by `org_id` and joins memberships without `m.org_id = mr.org_id` (LAST_OWNER, AP-ORG-04 owner cap) sees it. ADR-0005: "a crafted foreign ID is invisible under RLS, so the API answers 404". | In this PR: `assignRole` takes the organisation from the transaction context (or asserts equality) and resolves the membership with an explicit `orgId` filter (`findFirst({ where: { id, orgId } })`; `p_memberships__own_read` shows the actor's memberships in other orgs), then refuses a miss as not found. Add a unit case. Architect, before this migration becomes immutable: data-model P12 composite FKs, i.e. `UNIQUE (org_id, id)` on memberships plus `(org_id, membership_id) → memberships(org_id, id)`, and the same for `memberships.invitation_id` → invitations. |
| R1-m2 | MINOR | `tests/generated/rls/generator.ts:213-216`, `fixtures.ts:219-222` | **D-TASK037-14 is accepted, but WITH CHECK on `membership_roles` and `invitations` is now proven by no executing test.** Their `insert-foreign-key` and `reparent-own-row` cases expect the role-scope trigger's P0001, which fires before WITH CHECK. For an actor who is a member of B, the trigger passes and WITH CHECK is the only control (probe1 #2: 42501 RLS). The policy text is pinned statically (rule 9 renderer equality, C3 derived set), but not its effect. | Add one case per guarded table to `organisations.int.test.ts` using `world()`'s `userA`, who is already ACTIVE in A and B. From A's context, insert with `org_id = B` and re-parent an A row to B; each must give 42501 with the RLS marker. The suggested alternative (suppressing triggers) is not needed. |
| R1-m3 | MINOR | `migration.sql:325-327` | `organisations_personal_delete_guard()` checks the owner in `NEW.personal_owner_user_id`. One UPDATE that re-points the owner to a visible DEACTIVATED (or deleted) user and sets `deleted_at` passes, and deletes the personal organisation of an ACTIVE user (probe2). This needs raw platform_app SQL (a service bug), so it weakens a backstop and is not an exploit. | Check `OLD.personal_owner_user_id`, or refuse every change of `personal_owner_user_id` (immutable, like `type`). Add the probe as a negative case. |
| R1-m4 | MINOR (routed) | `tools/quality/required-suites.json:51` | `SEC-TC-74` is still in `required_cases_pending.catalog-c1-c14`. The card calls the SEC-TC-74 matrix a merge condition of this PR. D-SEC-PR47-01 (1)/(2) and D-ORCH-092 moved it to `required_cases` "before TASK-037 takes evidence". Until then, deleting every `[SEC-TC-74]` test still passes the evidence verifier. | Orchestrator / qa-lead: land the manifest-only move before this PR's credited lane-B run, or record why not. This is not a developer fix (code-owned tooling input). |
| R1-n1 | NIT | `migration.sql:358-359` | `trg_invitations__role_scope` reuses the type → scope mapping, so an OPERATOR-scope invitation in the OPERATOR organisation passes. data-model §3.2 says invitations hold "customer roles only". | Architect: either reword the data-model or decide on a stricter trigger with TASK-227. |
| R1-n2 | NIT | `policies/organisation-rules.ts:106-109`, `service/organisation-service.ts:74` | `.slice(0, 120)` counts UTF-16 units and can split a surrogate pair. pg then stores U+FFFD. There is no re-trim after the slice. The business create path trims but does not NFC-normalise, unlike the personal path. | Slice by code points (`Array.from`) and use the same normalisation on both paths. |
| R1-n3 | NIT | `service/organisation-service.ts:32` | A role key that is valid in `ROLES` but missing from the `roles` table (seed drift) becomes 422 `ROLE_NOT_ALLOWED_FOR_ORG_TYPE`. It is a server fault. | Throw an internal error (500). |
| R1-n4 | NIT | `organisations.int.test.ts:383-389` | The forced-OPERATOR C12 case uses a random actor with no membership. The card says "a customer". | Use a customer who is ACTIVE in A only (not `userA`, who is also in B). |
| R1-n5 | NIT | `apps/api/src/platform/db/extensions/standard-columns.ts:47-50` | `TENANT_KEY_MODELS` is a hand list keyed by Prisma model name. A future model keyed on `id` silently gets a fresh UUIDv7. RLS then refuses the row, so it fails closed. | Add a parity test against the manifests (isolation key `id` / USER_OWNED). |
| R1-n6 | NIT | developer report (D-TASK037-16) | The report says "87 columns". The registry adds 85: users 25, organisations 15, memberships 14, membership_roles 12, invitations 19. | Correct the wording. C10 is the real check. |
| R1-n7 | NIT | `packages/shared/src/logging/string-redaction.ts:134` | `'timezone'` is a substring part, so any log key containing it (for example `timezoneOffset`) is redacted. That fails closed and is accepted. | None. Noted for the logging owner. |

## 3. Rulings on the developer decisions

| Decision | Ruling |
|---|---|
| D-TASK037-06 (`app_is_operator()` before the RLS blocks) | **Accepted.** `CREATE POLICY` resolves the function when it is created, so the template's "after the blocks" order cannot run. The function runs as platform_definer through the definer-read policies granted later in the same file. No prefix exposes anything (the tables have no runtime grant until the end). |
| 08 (`MEMBERSHIP_STATUS_NOT_WRITABLE` internal-only, mapped to INTERNAL_ERROR; refusal codes `satisfies readonly ErrorCode[]`) | **Accepted.** The unit test pins the catalogue status (422), the INTERNAL_ERROR mapping and the README §11 row. This closes the PR #63 R1-m2 cross-PR item for this module. |
| 09 (reserved id repeated as a literal in prisma/tests) | **Accepted.** Precedent: `prisma/tests/rls/standard-columns.int.test.ts:26`. The unit test ties the migration row to `OPERATOR_ORG_ID`, and the integration test ties the migrated row to the literal. |
| 10 (`ROW_OVERRIDES.organisations.type = BUSINESS_CUSTOMER`) | **Accepted.** It is required by the occupied single-operator index and also satisfies `ck_organisations__personal_owner`. |
| 11 (TenantDb surface gains the 5 models) | **Accepted.** |
| 12 (branch `task-037-fc1`, fast-forwarded) | **Accepted.** `bf53c46` contains `fdfbbd8`, `1a8ca17` and `f3d3b3a` on its first-parent line, and the merges are pure. |
| 13 (lowercase synthetic text) | **Accepted.** The tags stay distinct and a unit test pins it. |
| 14 (`roleScopeGuard` trait) | **Accepted, with R1-m2.** The expectation is correct for a single-org actor (probe1 #3). The trigger list is pinned against the migrations and against live triggers. Add the direct WITH CHECK cases. |
| 15 (CUSTOMER_VIEWER literal pinned against the authz seed) | **Accepted.** |
| 16 (C10 classifications; `timezone` in PII_KEY_PARTS) | **Accepted.** The classes match data-model §3.1/§3.2 (`time_zone` PER, `token_hash` SEC). See R1-n6 and R1-n7. |

The other review targets in the dispatch:
- **Reserved OPERATOR row.** It is placed directly after the reserved users, after `ux_organisations__single_operator` and before the first `ENABLE ROW LEVEL SECURITY`. The statement is identical to rulings §2.3, and a unit test pins its order and values.
- **Rewritten AT-US-061-02.** It matches ruling 2.4 item 4. The probe confirms 23505 for platform_app in the context of a fresh org id. The superuser path under `replica` is still refused by the unique index.
- **AT-US-061-01.** It asserts exactly one row, the reserved id, the SYSTEM actor, version 1, no member, and an unchanged xmin and count after two reference-seed runs.
- **Fixtures.** No fixture plants an OPERATOR organisation (`plantProbe` committed branch and the SEC-TC-06 control both use `OPERATOR_ORG_ID`).
- **TASK-290 prerequisite.** No BEGIN ATOMIC routine and no bootstrap file are added (header line 19, verified).
- **PR #43 R1-m3 (probe.ts 42P07).** Closed on main: `PROBE_ENTRIES` drops committed DR-A14 tables.
- **PR #26 m2 (relation-form connect on update).** Closed by PR #26's deny-by-default refusal of relation fields. The new `@relation(fields: [orgId])` fields cannot be written through the extension.
- **Indexes.** They follow AP-ORG-02..13, and every tenant index leads with `org_id`. There is no N+1: each service operation makes 3-4 single-row statements.

## 4. Security flags (for the security analyst)

- **S1.** In the context of org A, platform_app can insert an ACTIVE membership for any existing user id (the FK bypasses RLS). `p_users__org_member_read` then exposes that user's profile row (email, display_name) to org A. This is the D-ARCH-123 concern, which was raised for INVITED; with ACTIVE it is equally reachable at the database level, and only the service layer (registration, invitation acceptance) prevents it. Decide whether a database binding is wanted, for example a trigger that requires `user_id = app_actor_id()` or an accepted invitation, or record the residual.
- **S2.** R1-m1 (cross-tenant references by id) and R1-m3 (personal-org guard reads NEW).
- **S3.** The merge condition PR11-SEC-10 and PR26-SEC-03 sign-off on the rendered DR-A14 policies and the guard still stands. No sign-off is possible on evidence until R1-B1 is fixed, because the policies have never existed in a database.

## 5. Good

- The rulings were applied exactly: the reserved row, `OPERATOR_ORG_ID` next to the actor ids, and a pin from the constant to the migration text.
- Fail-closed choices are documented where they are made: the personal-delete guard treats an invisible owner as active, and the role-scope trigger refuses when it cannot see the org or the role.
- `ROLE_SCOPE_GUARDS` is checked both ways: against the migrations text (with a count of all `EXECUTE FUNCTION` uses) and against the live triggers.
- The refusal codes are typed against `ErrorCode`, and a test pins the internal-only code to the README row.
- All three merges are clean, and the PR's own delta on the shared linter is one line.

## 6. Merge conditions

1. Fix R1-B1, R1-M1 and R1-M2 in-branch. R1-m1(a), R1-m2 and R1-m3 are cheap and should go in the same cycle. R1-m1(b) needs an architect decision before merge, because the migration is immutable afterwards.
2. A full lane-B PASS on the final head. It is the first execution of this PR's database tests, so expect more failures. Every integration, catalog-c1-c14, generated rls-cross-tenant and migrations (up-down-up) suite must pass.
3. A full lane-A run on the pushed head, with lint, format, typecheck, unit and build actually executed (not skipped).
4. R1-m4: SEC-TC-74 moved into `catalog-c1-c14.required_cases` before the credited lane-B run.
5. The security-analyst sign-off on the DR-A14 policies and the standard-columns guard (card MERGE CONDITION), on that evidence.
6. Squash merge.

Round 2: delta review of the fix commits, re-running probe0 to probe4 against the new head.

---

# Round 2: fix cycle 2 at `29be7be`

| Field | Value |
|---|---|
| Date | 2026-11-19 |
| Reviewed range | `git diff bf53c46 29be7be` (13 files, +968 / -320) |
| Head | `29be7be` (local, not pushed). It holds two commits on `bf53c46`: `bcb3082` (the r1 findings) and `29be7be` (D-ARCH-154..157, section 5 of `docs/03-architecture/rulings/wave-1-pr65-r1-rulings.md`). |
| Main | `05de264`. It is ahead of the branch's last merge (`36bc841`) by 287-B (#68: `.github/workflows/ci.yml`, `tools/ci/*`) and docs commits. No file is shared with the PR, and `git merge-tree origin/main 29be7be` is clean. |

## R2 verdict

**VERDICT: APPROVED_WITH_NITS** (0 BLOCKER, 0 MAJOR, 0 MINOR, 5 NIT). The approval is **conditional on lane B passing on `29be7be`**. That run is queued and has not started, and it is the first time PostgreSQL 18 will execute this PR's database tests. If any database suite fails there, this review reopens.

**SUMMARY**
- All 14 r1 findings are closed or accepted.
- The migration applies on PGlite 17.5, and so does up, down, down, up.
- I replayed all 18 database cases of the PR's own `prisma/tests/organisations/cases.ts` on PGlite through a pg-like adapter. Every result matches the assertions in `organisations.int.test.ts`.
- I ran 7 single-line mutants of the new SQL; all 7 are killed by those cases.
- The architect's section 5 SQL is in the migration verbatim.

## R2.1 What I verified myself

Same host rule as round 1: a `git archive` extract of `29be7be` with a `node_modules` junction to the worktree. I did not modify the worktree. The scripts are in the session scratchpad under `pr65/probe/`: `r2-cases.mts`, `r2-c11.mts` and `r2-updown.mts`.

| Check | Result |
|---|---|
| Migration on PGlite 17.5 (bootstrap 00-02 + all 6 migrations as `platform_migrator`) | Applies. R1-B1 is gone: the expected scope is now assigned to `v_expected` before the `IF`. |
| Up, down, down, up (as the migrator, with `RESET ROLE` mapped to the migrator as on a migrator login) | All ok. `down.sql` drops both new functions. |
| Replay of `cases.ts`, all 18 cases, each in a rolled-back transaction | Every result equals the test's expectation. Examples: T1 `23503 fk_membership_roles__membership_id` for both the foreign and the unknown id, and ok for its own membership. T2 23503, ok, ok. T3 P0001, P0001, ok, ok. T4/T5: the foreign member is refused, gets 0 profile rows, and their own membership is ok with 1 row. T6 to T8: the 4 lifecycle refusals, `ok,ok,ok`, 42501 for platform_app, and P0001 `org_id cannot change` as the superuser. Also: AT-US-061-03 (PARTNER and the reserved row give P0001; INDIVIDUAL gives 23514; without the trigger, ok), R1-m2 (four WITH CHECK refusals), R1-m3 (P0001 for re-point plus delete, and P0001 `PERSONAL_OWNER_IMMUTABLE`), R1-m1 lookup `{1, 0, 1}`, and C12 with forced OPERATOR equal to TENANT scope. |
| Mutants of the migration, replayed through the same cases | **7 of 7 killed.** No lifecycle trigger: T4, T6 and T8 change. Single-column role FK: T1 foreign becomes ok. Single-column invitation FK: T2 foreign becomes ok. No BUSINESS_CUSTOMER check: T3 becomes ok, ok. No owner-immutability trigger: `repoint` becomes ok. Delete guard reading NEW: `repointAndDelete` gives the other message. No type trigger: the case throws. |
| C11 helper query on the committed schema | Exactly the new expectation at `c01-c12.int.test.ts:936-954`, including `app_is_operator()` with `parallel: 'u'` and execute `[platform_app, platform_definer]`. This closes R1-M1. |
| Triggers | Each BEFORE trigger sorts before `trg_<t>__std_columns` (C15 (b)). The three new or changed assertion triggers are AFTER triggers. |
| Rulings section 5 | The added SQL blocks of 5.1 and 5.2 are contained verbatim (whitespace-normalised), and the two deleted single-column keys are absent. |
| `tools/db/lint-migrations.ts` | No findings. The Prisma schema validates (composite relations included). |
| Prettier on the changed files | Clean. |
| Lane B | Queued for `29be7be` and not started. The latest `Shipqube-TASK-037.log` is still the `bf53c46` run that failed on R1-B1. |

**Not re-run (host rule):** lint, typecheck, unit (including the new `organisations.test.ts` cases and the `TENANT_KEY_MODELS` parity test), build, and the integration, catalog and generated suites on PostgreSQL 18. PGlite is PostgreSQL 17.5, and the replay uses PGlite's driver, not `pg`. The developer's fix for multi-statement parameterised queries (round 1's `world()` would have failed on `pg`'s prepared statements) can only be confirmed by lane B.

## R2.2 Closure of round 1

| r1 ID | Status | Evidence |
|---|---|---|
| R1-B1 | Closed | `migration.sql` role-scope function uses `v_expected`, and the migration applies (D-TASK037-17). |
| R1-M1 | Closed | The C11 expectation equals the probed catalog rows (D-TASK037-20). |
| R1-M2 | Closed | PARTNER plus the reserved row prove the trigger; INDIVIDUAL is kept as a 23514 case; the case also includes a no-trigger control. |
| R1-m1 | Closed | (a) `assignRole` takes the context organisation and refuses a foreign membership with `MembershipNotFoundError`, with unit cases for the service and the repository filter (D-TASK037-19). (b) Composite tenant-bound keys (D-ARCH-154); T1 and T2 kill the single-column mutants. |
| R1-m2 | Closed | `withCheckGuardedTables`: four 42501 RLS refusals for the multi-org actor, plus a positive control. |
| R1-m3 | Closed | The guard reads OLD, and `trg_organisations__personal_owner_immutable` is added (D-TASK037-18). |
| R1-m4 | Closed in the PR | SEC-TC-74 moved to `catalog-c1-c14.required_cases` (D-TASK037-22). See R2-n4. |
| R1-n1 | Closed | D-ARCH-155: invitations exist only in BUSINESS_CUSTOMER organisations (T3). |
| R1-n2, R1-n4, R1-n5 | Closed | `organisationDisplayName` cuts by code points on both paths. C12 uses a real B-only customer. `TENANT_KEY_MODELS` is checked for parity against the manifests and the schema. |
| R1-n3 | Open (routed, D-TASK037-23) | A role missing from the seed still maps to 422. Carried as R2-n3. |
| R1-n6, R1-n7 | Accepted | Wording; the over-redaction fails closed. |
| S1 | Closed at the table | D-ARCH-156 lifecycle guard; T4 and its mutant. |

## R2.3 Rulings on D-TASK037-17..27

| Decision | Ruling |
|---|---|
| 17 (a variable instead of parentheses) | **Accepted.** It is equivalent, and a `CASE` in an assignment is outside the PL/pgSQL `IF` reader. |
| 18 (`personal_owner_user_id` immutable) | **Accepted**, with R2-n1 (data-model wording). |
| 19 (context organisation in `assignRole`; `MembershipNotFoundError` is a 404) | **Accepted.** The route mapping lands with TASK-231. |
| 20 (`app_is_operator()` in C11 with its definer shape) | **Accepted.** Verified against the catalog. |
| 21 (the statements of `organisations.int` moved to `cases.ts`) | **Accepted, and recommended as a pattern.** It made this replay possible without Jest. |
| 22 (SEC-TC-74 moved to required) | **Accepted**, with R2-n4. |
| 23 (n1, n3 and n7 left routed) | **Accepted.** n1 is in fact closed by D-ARCH-155. |
| 24 (the architect's patched migration taken verbatim) | **Accepted.** Containment check done. |
| 25 (T8 uses the REMOVED membership) | **Accepted.** A live membership re-parented as the superuser would hit `ux_memberships__org_user_live` (userA is live in B) before the AFTER trigger runs. |
| 26 (the rulings in a separate commit) | **Accepted.** |
| 27 (rulings 5.5 not done) | **Accepted as routed** (R2-n2). |

## R2.4 Findings

| ID | Severity | File:line | Issue | Fix or route |
|---|---|---|---|---|
| R2-n1 | NIT | `migration.sql` (`trg_organisations__personal_owner_immutable`) vs data-model §3.2 | data-model §3.2 and ADR-0005 amendment 13 do not mention that `personal_owner_user_id` is immutable. | Architect, at the next fold: one line in the `organisations` table notes. |
| R2-n2 | NIT | `service/organisation-service.ts` `createPersonalOrganisation` / `createOrganisation` | Both still take the member's user id from the caller (rulings 5.5). The lifecycle guard now refuses a mismatch with P0001, so a caller bug surfaces as a 500 and not as a typed error. TenantDb has `contextOrgId` but no actor accessor. | Route to TASK-049, the first caller, or to a platform task that adds `contextActorId` as a latch member. This is not a merge condition, per the rulings. |
| R2-n3 | NIT | `service/organisation-service.ts:38` | Carry-over of R1-n3: a role key that is missing from the `roles` table (seed drift) becomes a 422. | Next change to the module. |
| R2-n4 | NIT (process) | `tools/quality/required-suites.json:71` | The PR edits a code-owned tooling input (content owner: qa-lead). When it merges, the lane-B evidence of every open PR that needs evidence becomes stale. | qa-lead acknowledges the move. The orchestrator sequences the merge. |
| R2-n5 | NIT (process) | the branch | The branch has not merged main since `36bc841`. Main now carries 287-B's lane-A tooling (`tools/ci/*`, `ci.yml`). There is no shared file and the merge-tree is clean. | The orchestrator applies P1 (tooling-path voiding) when it decides whether lane B must run on a merge commit. |

## R2.5 Merge conditions

1. Lane-B PASS on the final head: every integration, catalog-c1-c14 (now with SEC-TC-74 required), rls-cross-tenant and migrations suite. The architect's section 2.5 says that no generated-suite observation should change. If one does, report it and do not adapt it without a ruling.
2. A full lane-A run on the pushed head, with lint, format, typecheck, unit and build actually executed.
3. The security-analyst sign-off on the DR-A14 policies, the standard-columns guard and the D-ARCH-154..156 controls.
4. The mutant checks of rulings 5.4 are reported in the PR body. This review supplies them: 7 of 7 killed (R2.1).
5. Squash merge.

---

# Round 3: fix cycle 3 at `d4de55d` (delta from `29be7be`)

| Field | Value |
|---|---|
| Date | 2026-11-19 |
| Head | `d4de55d` (local, not pushed) = `29be7be` + `b700a79` (merge of main `1d31ea8`: #68, #69 and records) + `d4de55d` (9 files, +114 / -11) |
| Trigger | The first PostgreSQL 18 lane-B run of `29be7be` (`failed-runs-orphan/TASK-037-29be7be.log`) failed 4 tests. The integration run was 383/386; `organisations.int.test.ts` passed in full. |
| Main | `370a66b`, ahead of `1d31ea8` by one review record only. `git merge-tree origin/main d4de55d` is clean. |

## R3 verdict

**VERDICT: APPROVED_WITH_NITS** (0 BLOCKER, 0 MAJOR, 0 MINOR, 3 new NIT). This is still **conditional on lane B passing on `d4de55d`** (re-queued). The R2 merge conditions stand.

**SUMMARY**
- Each of the four lane-B failures has the root cause the developer names. I confirmed each one against the log, the code, or a negative control on PGlite.
- Each fix is the narrowest one that keeps the test's intent. The shadow-init change restores fidelity to the real database, and F-03 is still pinned exactly.
- The PR65-SEC-01 index change is pinned by a new case that kills the old-index mutant.

## R3.1 Root causes of the four PostgreSQL 18 failures

| # | Failing test (log line) | Root cause | Verified by me | Fix (decision) |
|---|---|---|---|---|
| 1 | C9 `enum-like CHECK equals its TypeScript list` (`c01-c12.int.test.ts:887`; log :175-266) | The C9 query reads every enum-like CHECK in the schema. The migration adds 12 IN-list CHECKs that are not in `ENUM_CHECKS`. | The 12 entries added at `c01-c12.int.test.ts:304-320` are exactly the 12 "Received +" blocks of the log, value for value. They agree with data-model §3.1/§3.2. The new unit pin's regex returns `[BUSINESS_CUSTOMER, INDIVIDUAL, OPERATOR, PARTNER]` and `[ACTIVE, INVITED, REMOVED, SUSPENDED]` from the migration text (`r3-c9.mjs`). | D-TASK037-30 |
| 2 | C15 (a) probe (`c15-std-columns-guard.int.test.ts:233`; log :268-300) | The probe test counted every in-scope table. Since this PR, the committed schema has 5 guarded STD tables, so the probe saw `c15_probe` plus 5. | Log. The committed-state test above it already asserts those 5 tables exactly: scope equals the manifest set, there is one trigger per table with full shape, and nothing sorts after the guard. | D-TASK037-28 |
| 3 | SPK-08 F-02 `two consecutive migrate diff runs` (`shadow-init.int.test.ts:105`; log :303-326) | `shadow-init` stripped every GRANT, including `GRANT USAGE, CREATE ON SCHEMA platform TO platform_definer` (01-schemas.sql:16). The migration's `SET ROLE platform_definer; CREATE FUNCTION platform.app_is_operator()` then fails with 42501 in the shadow. | The developer's `fc3-shadow.mts` (shadow owned by the migrator, `RESET ROLE` returns to the migrator, two rounds). **Negative control** `29be7be`: `42501 permission denied for schema platform` on `CREATE FUNCTION platform.app_is_operator()`. **Head** `d4de55d`: 59 init statements (52 before, so 7 schema grants are kept), the migration applies, and both rounds pass. | D-TASK037-29 |
| 4 | DR-A14 own_read (`cross-tenant.int.test.ts:437`; log :631-660) | The committed layer now seeds `memberships` with `user_id = tenant.actor` (`tests/generated/rls/database.ts:179`), so `(TENANT_B.org, TENANT_B.actor)` already holds a live row. Planting the same pair hits `ux_memberships__org_user_live`, which a `replica` session still enforces. | Code read (`database.ts:179`, `cross-tenant.int.test.ts:402`). | D-TASK037-31 |

## R3.2 Do the fixes keep the intent of each test?

- **C9 (D-TASK037-30): accepted.**
  - The 12 lists are pinned from the data model, as the audit lists already are.
  - The TypeScript tie that C9 names is kept wherever a TS list exists. A new unit test compares `ORG_TYPES` and `WRITABLE_MEMBERSHIP_STATUSES` (+ INVITED) with the migration CHECK text, because prisma/tests may not import the module.
  - The users enums have no TS list yet; the identity module arrives with TASK-049.
  - The drift negative (`ck_roles__scope`) is unchanged.
- **C15 (a) probe (D-TASK037-28): accepted, with no loss of coverage.**
  - The probe still asserts the planted guard's exact shape, the named `c15_unguarded`, and the doubled trigger.
  - Filtering `unguarded` to the planted tables is required: `guarded` is filtered too, so without it the committed guarded tables would be reported as unguarded.
  - An unguarded committed table is still caught by the committed-state test, which compares scope with the manifest set and triggers with scope.
- **Shadow-init (D-TASK037-29): accepted. F-03's purpose is kept, and fidelity improves.**
  - F-03 exists so that the shadow initialisation holds only what the migrator can execute and nothing the differ would see.
  - In the shadow, the migrator owns `platform` (re-created without AUTHORIZATION) and `public` (Prisma's reset), so it can execute these grants. Prisma does not diff privileges.
  - The bootstrap lane's grants make the shadow *match* production. Stripping them made the shadow stricter than a real database, which is exactly what failed here.
  - `SCHEMA_GRANT` is anchored and accepts only `USAGE`/`CREATE` on schemas. `WITH GRANT OPTION`, `GRANTED BY`, `GRANT ALL` and every `REVOKE` still fall to the strip list (new rows in `shadow-init.test.ts:79-81`).
  - The F-03 test now requires the definer grant to be kept and **no other** GRANT (`shadow-init.test.ts:357-358`), so a widened keep list fails.
  - Residual (R3-n2): whether the migrator owns `public` in the real PostgreSQL 18 shadow is proven only by lane B's `shadow-init.int.test.ts`.
- **own_read (D-TASK037-31): accepted, and slightly stronger.**
  - The planted foreign member is another user of B.
  - The count `WHERE org_id = B` must still be 0, and it now also covers the seeded `(B, TENANT_B.actor)` row.
  - The positive half (the actor's own membership in B gives 1) is unchanged.
- **PR65-SEC-01 (D-TASK037-32): accepted.**
  - `ux_membership_roles__membership_role_live` now leads with `org_id`, which also satisfies REQ-RLS-001.
  - A role row of A that names B's membership while B holds that grant now fails the tenant-bound key (23503) instead of the live-grant index (23505). The 23505 was an existence oracle.
  - Within A, a duplicate live grant still gives 23505.
  - AP-ORG-09 lookups always run under RLS (`org_id = app_org_id()`), so the leading column costs nothing.
  - The **old-index mutant** gives `foreignWithLiveGrant = 23505` and is killed by the new `liveGrantIndexScope` case.

## R3.3 What I verified myself

Host rule: a `git archive` extract of `d4de55d` with a `node_modules` junction to the worktree; the worktree was not modified. Scripts are in the scratchpad under `pr65/probe/`: `r3-cases.mts`, `r3-c9.mjs` and `fc3-shadow.mts`.

| Check | Result |
|---|---|
| Merge `b700a79` | `git merge-tree --write-tree` of its parents equals the commit: no conflicts, no hand edits. `git diff 1d31ea8 d4de55d` equals `git diff 1d31ea8...d4de55d` (md5). The PR's README §11 row and main's TASK-292 rewrite of §11/§18 are disjoint hunks. |
| TASK-292's new domain-error scan (`tests/generated/error-catalogue.test.ts`) | Every literal `new OrganisationRuleError('<CODE>')` in the module is either catalogued (ORG_TYPE_NOT_ALLOWED, ROLE_NOT_ALLOWED_FOR_ORG_TYPE) or listed under "Codes that are not HTTP problem codes" (MEMBERSHIP_STATUS_NOT_WRITABLE, README line 394). The not-found errors carry lower-case messages, which the SCREAMING_SNAKE regex does not match. |
| Replay of all 19 `cases.ts` cases on PGlite 17.5 (the 18 from round 2 + `liveGrantIndexScope`) | Every result equals the test's assertion. |
| Mutant: restore the old `(membership_id, role_id)` index | Killed (`foreignWithLiveGrant` becomes 23505). |
| Shadow replay (`fc3-shadow.mts`) | `29be7be` fails 42501; `d4de55d` passes 2 rounds. |
| `tools/db/lint-migrations.ts` | No findings. |
| Prettier on the changed non-SQL files | Clean. |

**Not re-run (host rule):** Jest. That covers the unit tests (`shadow-init.test.ts`, the C9 unit pin) and all PostgreSQL 18 suites. Lane B on `d4de55d` is the evidence.

## R3.4 Rulings on D-TASK037-28..32

| Decision | Ruling |
|---|---|
| 28 (C15 (a) probe limited to the tables it plants) | **Accepted** (R3.2). |
| 29 (shadow-init keeps the schema-scoped USAGE/CREATE grants) | **Accepted** (R3.2). Root cause reproduced with a negative control. |
| 30 (C9 lists pinned from the data model, plus a TS pin) | **Accepted.** |
| 31 (own_read plant uses another member of B) | **Accepted.** |
| 32 (PR65-SEC-01: the index leads with org_id, plus a 23503 test) | **Accepted.** Mutant killed. |

## R3.5 New findings

| ID | Severity | File:line | Issue | Fix or route |
|---|---|---|---|---|
| R3-n1 | NIT | data-model §3.2 AP-ORG-09 | The data model still gives `ux_membership_roles__membership_role_live ON (membership_id, role_id)`. The migration now has `(org_id, membership_id, role_id)` (PR65-SEC-01). | Architect, at the next fold, together with R2-n1. |
| R3-n2 | NIT (residual) | `tools/db/shadow-init.ts:127-138` | The kept grants assume the migrator owns `public` and `platform` in the real shadow. This was proven on PGlite with the ownership set explicitly, not on PostgreSQL 18. | Lane B `shadow-init.int.test.ts` (F-02) on `d4de55d` is the proof. If it fails, the fix is in the shadow creation, not in stripping the grants again. |
| R3-n3 | NIT (process) | `tools/db/shadow-init.ts` | This PR now edits a `tools/db` file, and TASK-293 (the TASK-290-F tokenizer work) holds the `tools/db` lock and is due before the next migration PR. | Orchestrator: sequence TASK-293 after this merge, or rebase it onto this merge. The hunks are disjoint from `sql-text.ts`. |

R2-n1 to R2-n5 are carried unchanged. R2-n5 (merge main) is closed by `b700a79`.

## R3.6 Merge conditions

1. Lane-B PASS on `d4de55d` (or the final head): the four suites above plus everything else in the evidence run.
2. A full lane-A run on the pushed head, with lint, format, typecheck, unit and build actually executed.
3. Security sign-off. D-SEC-PR65-01 is PASS_WITH_CONDITIONS at `29be7be`; the security analyst confirms PR65-SEC-01 at the new head.
4. The mutant reports in the PR body: 7/7 (round 2) plus the old-index mutant (round 3).
5. Squash merge.
