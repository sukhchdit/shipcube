# PR-0065: TASK-037 organisations, memberships and users with DR-A14 RLS and the standard-columns guard, security review

| Field | Value |
|---|---|
| PR | #65, https://github.com/sukhchdit/shipcube/pull/65, branch `feat/TASK-037-organisation-types-single-operator-organisation`. When this round was written the origin head was still `d3c2c16`. The reviewed code head `29be7be` is local: it is `d3c2c16` plus three pure merges of `main` (`664adec`, `694c8f7`, `bf53c46`), fix cycle 1 (`fdfbbd8`, `1a8ca17`, `f3d3b3a`) and fix cycle 2 (`bcb3082`, `29be7be`). It will be pushed as `29be7be` plus one evidence-only commit. Merge base with `main`: `36bc841`. `main` was at `fcec9a9` when this round was written. Since the merge base it changed `.github/workflows/ci.yml` and `tools/ci/*` (287-B, #68), plus `tests/generated/error-catalogue.test.ts` and `docs/03-architecture/api/README.md` (TASK-292, #69), plus docs. The README is the only path shared with this PR; it is unowned and a different hunk. #69's new domain-error-class scan reads this PR's `OrganisationRuleError` codes, which is why D-ORCH-136 re-runs the unit lane on the second merger's merged head. `git merge-tree origin/main 29be7be` is clean |
| Head | 29be7be76a894c7cb899eb18449f0d1b685253d6 |
| Owned paths changed | 26 (the checker's own list, record simulation §9): the migration and its `down.sql`; `prisma/schema/{authz,identity,organisations}.prisma`; `prisma/sql/grants.manifest`; `prisma/tests/catalog/{c01-c12,c15-std-columns-guard}.int.test.ts`; `prisma/tests/organisations/{cases.ts,organisations.int.test.ts}`; `prisma/tests/rls/tenant-db.real-client.test.ts`; `tests/generated/rls/{cross-tenant.int.test.ts,database.ts,fixtures.ts,generator.ts,generator.test.ts}`; `tools/db/{lint-migrations.ts,lint-migrations.test.ts,grants-manifest.test.ts}`; `tools/db/table-classes/{identity,organisations}.json`; `apps/api/src/platform/db/extensions/standard-columns{,.test}.ts`; `packages/shared/src/ids/uuidv7{,.test}.ts`; `tools/quality/required-suites.json` |
| Unowned paths changed | 14, all read: `apps/api/src/modules/organisations/**` (rules, repository, service, unit tests), `packages/shared/src/classification/registry.ts`, `packages/shared/src/logging/string-redaction.ts`, `packages/shared/src/index.ts`, the EPIC-03 story notes and `docs/03-architecture/api/README.md` |
| Binding items checked | D-ORCH-COORD-03 merge condition (PR11-SEC-10, PR26-SEC-03); PR #43 record §6 (DR-A14 mechanism conditions for TASK-037); PR43-SEC-07 remainder (D-SEC-PR47-01 (3)); PR43-SEC-09 (a); PR26-SEC-04; D-ARCH-151..157 and `docs/03-architecture/rulings/wave-1-pr65-r1-rulings.md`; D-TASK037-08, -14, -16, -27; the TASK-037 card (WAVE-01); code review r1 (security flags S1 to S3) and r2 (`7cd23db`, APPROVED_WITH_NITS, conditional on lane B) |
| Reviewer / date | security-analyst, 2026-11-19, round 1. **Static review plus single-process Node/PGlite probes** under the host rule (a lane-B run may be using the machine): no npm, Jest, type-check, build or Docker. Nothing ran in the PR worktree and nothing was written there; git objects were read from the main checkout. Probes ran in the session scratchpad (`pr65sec/probes/`) on a `git archive` extract of `29be7be`: bootstrap 00 to 02 plus all six migrations applied on PGlite 17.5 as `platform_migrator` (`uuidv7()` mapped to `gen_random_uuid()`, `RESET ROLE` mapped to the migrator as on a migrator login), then each case as `platform_app` with the production context keys, in rolled-back transactions. PGlite is PostgreSQL 17.5, not 18: condition C1 covers that gap. Line numbers come from single-file reads at `29be7be` |

## 1. Summary

**The DR-A14 policies and the standard-columns guard are signed off (D-ORCH-COORD-03), subject to condition C1 (the lane-B run on PostgreSQL 18).**
- All ten RLS and guard blocks are byte-identical to what `tools/db/render-rls.ts` renders from the head's manifests, and both function templates are contained verbatim. Two mutation controls (an edited migration, an edited rendering) are detected.
- All five tables have ENABLE and FORCE. `platform_app` holds SELECT, INSERT and UPDATE, never DELETE. `platform_definer` holds SELECT on the four `definerRead` tables only. No column grant exists, and PUBLIC holds no EXECUTE on any `platform` function.
- `app_is_operator()` is owned by `platform_definer`, SECURITY DEFINER, with a fixed `search_path`, and executable by `platform_app` and `platform_definer` only. Its early placement (D-TASK037-06) exposes nothing: the tables have no runtime grant until the end of the file.
- The D-ARCH-154..156 controls work as ruled. Composite keys refuse a foreign parent with the same `23503` as an absent one. Invitations exist only in `BUSINESS_CUSTOMER` organisations. A membership is created only by its member, as ACTIVE, never changes user or organisation, and never leaves REMOVED. Each has a killed mutant (§5).
- The standard-columns guard behaves on the real tables as on the probe table, including the PR43-SEC-07 remainder that the suite still lacks (§5.4).

**Findings: 0 Critical, 0 High, 0 Medium, 2 LOW, 3 INFO.**
- **PR65-SEC-01 (LOW).** `ux_membership_roles__membership_role_live` is keyed `(membership_id, role_id)` without `org_id`. The unique check runs before the new composite key, so a session of A still learns whether another organisation's membership holds a role (`23505` against `23503`). D-ARCH-154 said this channel closes; it does not. The fix adds `org_id` to the index, and is validated.
- **PR65-SEC-02 (LOW, latent).** The database cannot tell staff provisioning from self-enrolment. Any transaction whose context names the reserved `OPERATOR_ORG_ID` can insert its own ACTIVE membership and an `OPERATOR_SUPER_ADMIN` link. With scope OPERATOR it then reads every tenant (probed: 1 organisation visible before, 4 after). The bound is context integrity alone. No route in this PR can reach it.
- **PR65-SEC-03 (INFO).** An inventory of existence oracles; none is reachable through the PR's service.
- **PR65-SEC-04 (INFO).** Gaps in the lifecycle backstops: INVITED is reachable by UPDATE; PARTNER organisations are creatable below the service; the subject can write the security columns of its own `users` row; `granted_by` is caller-supplied.
- **PR65-SEC-05 (INFO).** Evidence binding: the new controls carry no SEC-TC id and their suite has no required case; the catalog `min_tests` ratchet is missing; the PR43-SEC-07 remainder cases are missing.

**Verdict: PASS_WITH_CONDITIONS.** C1 is an evidence check by the orchestrator at merge, with no new security round unless a listed observation differs (§8).

## 2. Method

| Step | What |
|---|---|
| Diff | `git diff 36bc841 29be7be` (40 files, +2802 / -42); the full migration read line by line; service, repository, rules, extension, classification, redaction and manifest diffs |
| Rendering | `probes/render.mts`: `renderRls` and `renderStdColumnsGuard` for the five manifest entries, containment in the CR-normalised migration, the two function templates, two mutation controls |
| Database | `probes/sec1.mts` P1 to P9 on the head, plus three mutants of the migration (`idx`: the PR65-SEC-01 fix; `wc`: `p_membership_roles__tenant WITH CHECK (true)`; `noguard`: no `trg_memberships__lifecycle_guard`) |
| Redaction | `probes/tz.mts`: `isSensitiveKey`/`isPiiKey` on 10 keys, head against `main` |
| Record | `probes/sim.mjs`: main's real `check-security-owned-paths.mjs` on plumbing scenarios in a shared clone (§9); Gitleaks emulation over the record commit |
| Not run | Lint, type-check, unit, build, and the integration, catalog, generated and migrations suites on PostgreSQL 18 (host rule). Lane B on `29be7be` has not started; the code review r2 replayed the PR's 18 database cases on PGlite and killed 7 of 7 mutants, which I did not repeat |

## 3. Findings

| ID | Title | Severity | CWE | OWASP | Location | Owner / due |
|---|---|---|---|---|---|---|
| PR65-SEC-01 | Role-holding oracle and lock coupling through a unique index without `org_id` | LOW | CWE-203 | A01 | `migration.sql:195` | This PR if it gets another code cycle; otherwise an expand migration with TASK-293 (C16), before TASK-231 merges |
| PR65-SEC-02 | Operator-organisation membership can be self-minted from an operator-organisation context | LOW (latent) | CWE-269 | A01 | `migration.sql:404-426`, `:226-229`, `:294-304` | principal-architect (database option) before TASK-089 staff provisioning; route conditions on TASK-049, TASK-224, TASK-227 |
| PR65-SEC-03 | Cross-tenant existence oracles (inventory) | INFO | CWE-204 | A01 | `migration.sql:100, 124, 181, 190, 199` | Accepted residual; TASK-049 condition |
| PR65-SEC-04 | Lifecycle backstop gaps: INVITED by UPDATE, PARTNER below the service, self-writable `users` security columns, caller-supplied `granted_by` | INFO | CWE-841 | A04 | `migration.sql:20-22, 411-418, 530-533`; `organisation-service.ts:91, 108` | principal-architect (a, b); TASK-049/057 (c); TASK-231 (d) |
| PR65-SEC-05 | Evidence binding of the new controls | INFO | CWE-1068 | A04 | `organisations.int.test.ts:193-256`; `required-suites.json:71` | qa-lead + TASK-293, before TASK-049 merges |

## 4. Finding details

### PR65-SEC-01 (LOW): role-holding oracle through `ux_membership_roles__membership_role_live`

- **What.** `CREATE UNIQUE INDEX "ux_membership_roles__membership_role_live" ON "public"."membership_roles"("membership_id", "role_id") WHERE "revoked_at" IS NULL` (`migration.sql:195`). PostgreSQL checks a unique index while it inserts the index tuple, inside the statement. It runs the foreign-key check as an AFTER trigger at the end of the statement. So for a row `(org_id = A, membership_id = M_B, role_id = R)` written from A's context:
  - if B's membership `M_B` holds R live, the insert fails with `23505` on the index;
  - otherwise it fails with `23503` on the new composite `fk_membership_roles__membership_id`;
  - an id that is no membership also gives `23503`.
- **Probe P1 (head):** `{foreignHeldRole: 23505 ux_membership_roles__membership_role_live, foreignOtherRole: 23503, unknownId: 23503, ownControl: ok}`.
- **Fix validated (mutant `idx`, the same index with `org_id` first):** all three foreign shapes give `23503` and the own control stays ok. Nothing else in P1 to P9 changes.
- **Write side.** Between the index insertion and the statement-end FK check, the uncommitted index entry also makes B's own grant of R to `M_B` wait for A's transaction. Via the API that is milliseconds: the tenant wrapper rolls back at once. At SQL level it lasts until A ends the aborted transaction, bounded by the idle-in-transaction timeout.
- **Exploitability.** Low. It needs the UUIDv7 of another organisation's membership, which no cross-tenant read exposes (`p_memberships__own_read` shows only the actor's own memberships). It also needs a write that reaches the table with that id. `assignRole` now refuses a foreign membership with `MembershipNotFoundError` before any write (R1-m1 (a)). So the oracle is reachable by raw platform_app SQL or by a future service that skips that check.
- **Impact.** Disclosure of another tenant's role assignments, and a short cross-tenant lock wait.
- **Why it matters here.** D-ARCH-154 §2.1 names this exact channel ("the same index answers 'does B's membership hold role R' to A") and §2.2 rates option A as closing it. The composite key closes the FK half and the write half (the forged row can no longer commit). The index half stays open because the index runs first.
- **Remediation.**
  ```sql
  CREATE UNIQUE INDEX "ux_membership_roles__membership_role_live"
    ON "public"."membership_roles"("org_id", "membership_id", "role_id") WHERE "revoked_at" IS NULL;
  ```
  - While the file is mutable this is a one-line edit; the Prisma schema needs the matching `@@unique`, or the index stays raw SQL if it already is. Afterwards it is an expand migration: `CREATE UNIQUE INDEX CONCURRENTLY` of the new index in its own file, then drop the old one.
  - Generalise it in C16 (TASK-293): every unique index on a TENANT table contains `org_id`, unless it is the primary key or a globally unique secret digest such as `ux_invitations__token_hash`.
  - The migration's own comment at `:184` already states "every tenant index leads with org_id"; this index is the one exception.
- **Verification.** One integration case: B's membership holds CUSTOMER_VIEWER; from A, insert the same `(membership_id, role_id)` with `org_id = A`, and also a role it does not hold. Both must give `23503` on `fk_membership_roles__membership_id`. Plus a C16 planted-index control.

### PR65-SEC-02 (LOW, latent): self-minted operator membership

- **What.** `trg_memberships__lifecycle_guard` requires `user_id = platform.app_actor_id()` on insert (`:412`), and `p_memberships__tenant` requires `org_id = platform.app_org_id()` (`:476-479`). The reserved operator organisation has a well-known id (`:226-229`, `OPERATOR_ORG_ID`) and no member until staff are provisioned (D-ARCH-153). `app_is_operator()` grants cross-tenant SELECT to any actor with an ACTIVE membership of an OPERATOR organisation and scope OPERATOR (`:294-304`). The role-scope trigger admits `OPERATOR_SUPER_ADMIN` there.
- **Probe P3 (head):**
  - from a customer organisation's context, inserting a membership of the operator organisation gives `42501` (WITH CHECK);
  - **from a context whose `app.org_id` is `OPERATOR_ORG_ID`, actor X with no membership: own ACTIVE membership ok, `OPERATOR_SUPER_ADMIN` link ok;**
  - back in organisation A with scope OPERATOR, X sees 4 organisations instead of 1;
  - an invitation into the operator organisation gives `P0001` (D-ARCH-155 holds).
- **Why the database cannot tell.** D-ARCH-156 makes every membership insert a self-insert, so staff provisioning (TASK-089, `ops:staff-bootstrap`) and an attacker who has reached an operator-organisation context write the same row. T-35 lists the operator membership as the second factor behind `app.actor_scope`. That factor can now be minted by whoever holds the first: an operator-organisation context.
- **Exploitability.** Requires two defects on the application side:
  1. a context whose organisation is `OPERATOR_ORG_ID` for a non-member, for example an organisation switch or login default that trusts a client value or `users.last_active_org_id` (which the subject may point at any organisation, P5);
  2. a path that inserts a membership of the actor into the context organisation.

  In this PR both create paths insert the organisation row first, which fails for an existing id, so neither defect exists yet. SQL injection reaches the same result directly (T-35, accepted as MEDIUM there).
- **Impact.** Read access to every tenant: critical.
- **Rating.** LOW, latent: no route, and it needs a separate context defect that is itself a full-tenant breach.
- **Remediation.**
  - **(a) Route conditions (binding):**
    - TASK-049 (login default) and TASK-224 (organisation switch) set `app.org_id` only for an organisation where the actor holds an ACTIVE membership, re-checked at that moment. Never from a client value, a token claim or `users.last_active_org_id` alone. Abuse case: a customer names `OPERATOR_ORG_ID` as the active organisation and gets 403 or 404, and no transaction opens with that context.
    - TASK-227 (acceptance) inserts a membership only for a PENDING, unexpired invitation of the context organisation addressed to the user's verified email, and grants exactly the invitation's role (the database does not bind the role to `invitations.role_id`).
  - **(b) Database option (architect decision, before TASK-089 designs staff provisioning):** extend `platform.memberships_lifecycle_guard()` so that an INSERT into an organisation of type OPERATOR is refused unless a provisioning fact exists that a non-operator cannot write, for example:
    - a `staff_grants` row created by an actor for whom `platform.app_is_operator()` is true, with the migrator-run `ops:staff-bootstrap` as the only path for the first one; or
    - a dedicated provisioning role that alone holds a narrow INSERT policy.

    Any form must keep "member = actor".
- **Verification.** (a) is the abuse case above, plus the TASK-227 cases. (b) is P3 inverted: the self-join gives `P0001`, and a provisioned join is ok.

### PR65-SEC-03 (INFO): existence oracles (inventory)

| Channel | Answers | Needs | Probe |
|---|---|---|---|
| `fk_memberships__user_id` runs before the AFTER lifecycle guard | does user id U exist (`23503` vs `P0001`) | U's UUIDv7 | P2 |
| `ux_organisations__personal_owner` + `fk_organisations__personal_owner_user_id` (no database binding of the owner to the actor) | does U exist; does U have a live personal organisation | U's id | P2 (`23505`; a user without one: ok, a personal organisation named after someone else, with no membership possible) |
| `users.last_active_org_id`, `users.personal_org_id` | does organisation id O exist | O | architect §8 item 2, accepted |
| primary keys of the five tables | does a row with id X exist | X; the extension stamps every id, so no service path supplies one | by reading |
| `ux_invitations__token_hash` (global) | does an invitation with digest H exist | H, a SHA-256 of a random token | by reading |
| `ux_users__email` | is an e-mail registered | the e-mail | registration path |

- None is reachable through this PR's service. Every id is server-stamped, and `assignRole` filters by the context organisation.
- **Condition for TASK-049:** registration maps `ux_users__email` `23505` to the uniform response, so the anti-enumeration rule holds. The reserved SYSTEM and ANONYMOUS users (`ck_users__is_system`, PR26-SEC-04, verified in P5) never get a credential or session row, and every auth flow refuses `is_system` users.

### PR65-SEC-04 (INFO): lifecycle backstop gaps

- **(a) INVITED by UPDATE.** The guard refuses a non-ACTIVE insert, but on update it checks only user, organisation and REMOVED (`:415-417`). P4 gives `ACTIVE → INVITED: ok` and `INVITED → ACTIVE: ok`.
  - The header (`:20-22`) says the trigger makes "no INVITED row is written" a property of the database. That holds for INSERT only.
  - No exposure follows: INVITED is outside both read lists.
  - Fix in the next migration that replaces the function: `WHEN NEW.status = 'INVITED' AND OLD.status IS DISTINCT FROM 'INVITED' THEN 'INVITED is reserved'`. Until then, correct the comment.
- **(b) PARTNER below the service.** P8: a fresh context creates a PARTNER organisation, its own ACTIVE membership and a `PARTNER_DEVELOPER` link (all ok). Only `CUSTOMER_OWNER` is refused (`P0001`).
  - D-ARCH-152 cites the owner-link refusal, which holds only for the service path.
  - No partner route or permission exists in M1. Record it for the M3 partner design (a type-creation backstop like the single-operator index, or a trigger refusing PARTNER inserts outside a provisioning path).
- **(c) The subject's own `users` row.** `p_users__own` is `FOR ALL` (DR-A14 users set, `:530-533`). P5: a SUSPENDED user's own session sets `status = 'ACTIVE'`, clears `status_reason`, sets `email_verified_at`, and points `last_active_org_id` at the operator organisation (all ok). `is_system` is refused (`23514`).
  - These are security states (suspension, MFA overdue, verification).
  - Condition for TASK-049/057: `status`, `status_reason`, `email_verified_at`, `first_signed_in_at`, `deletion_requested_at`, `is_system` and `personal_org_id` are server-controlled on every self-service route (closed Joi schemas, the T-33 fuzz cases).
  - The architect decides whether a users transition guard (self may only do PENDING_VERIFICATION → ACTIVE with verification, and ACTIVE → DEACTIVATED) joins TASK-057.
- **(d) Attribution columns.** `assignRole` passes the caller's `grantedBy` to `membership_roles.granted_by` (`organisation-service.ts:91, 108`). The database binds `created_by`/`updated_by` to the actor but not `granted_by`, `revoked_by`, `removed_by` or `accepted_by_user_id`, so a caller defect misattributes a grant. The audit entry still records the real actor.
  - TASK-231 derives these from the transaction's actor, through the `contextActorId` accessor of code review R2-n2 (rulings §5.5), and has a unit case.
  - D-TASK037-27 (§5.5 not done) is accepted on that routing.

### PR65-SEC-05 (INFO): evidence binding

- **(a) SEC-TC ids (D-ARCH-156 §5.4 asks).**
  - **Ruling: T1 (with T2 and the R1-m2 WITH CHECK cases), T3 and T4 (with T5 to T8) are security controls and carry ids:**
    - **SEC-TC-76**: tenant-bound references and WITH CHECK on trigger-guarded tables (D-ARCH-154; later C16);
    - **SEC-TC-77**: invitation scope, `BUSINESS_CUSTOMER` only (D-ARCH-155);
    - **SEC-TC-78**: membership lifecycle guard (D-ARCH-156).
  - They live in the `integration` suite, whose `required_cases` list is empty and which is neither `security` nor `zero_skip`. So deleting or skipping them today fails no gate.
  - Adoption: TASK-293 (which adds C16 next to them) tags the titles, and in the same commit qa-lead adds the three ids to `integration.required_cases` and security adds the rows to the threat-model SEC-TC table. Due before TASK-049 merges.
  - Not in this PR: a title edit after `29be7be` would void this record and the lane-B evidence.
- **(b) The catalog `min_tests` ratchet.** It is still 14 (`required-suites.json:71`), although the suite runs about 100 cases and D-SEC-PR47-01 (2) asked for the ratchet together with the SEC-TC-74 move. Do it in the same qa-lead commit as (a).
- **(c) Base-ref manifest.** CI reads `required-suites.json` from the base ref (`check-evidence.mjs:760`), so the PR's own SEC-TC-74 move binds only later PRs. For this PR, condition C1 checks the cases by hand.
- **(d) PR43-SEC-07 remainder (D-SEC-PR47-01 (3)).** The suite has none of these cases: reset to 1, back-dated `updated_at`, the "wrong stamps plus foreign organisation" order case, and the MERGE forms. I probed them on the real tables instead (§5.4), which discharges the proof for this merge. The regression cases go into the SEC-TC-76..78 tagging commit, as `[SEC-TC-74]` cases of `organisations.int`.

## 5. Verification of the controls

### 5.1 DR-A14 policies (PR11-SEC-10 sign-off)

| Check | Result |
|---|---|
| Rendered verbatim | 10 of 10 blocks (5 RLS, 5 guard triggers) are contained; both function templates are contained. Controls: an edited migration and an edited rendering are both detected. The templates themselves are unchanged by this PR (no diff under `prisma/sql/policy-templates`) |
| Positive status lists, exact EXISTS shapes, no context value under `coalesce`/`NOT`/`IS DISTINCT FROM` | `p_users__org_member_read` and `p_organisations__member_read` use `m.status IN ('ACTIVE','SUSPENDED')` with `=` comparisons only (`:506-511`, `:534-539`) |
| Recursion invariant | No `memberships` policy contains a subquery. `app_is_operator()` reads through the definer's own `USING (true)` policies |
| Operator branch | `FOR SELECT` only on all five tables, gated by scope and `app_is_operator()` (ACTIVE membership of an OPERATOR organisation). The reserved organisation has no member, so no operator exists until provisioning (see PR65-SEC-02) |
| FORCE, grants, order | P7: `relrowsecurity` and `relforcerowsecurity` true on all five. Grants exactly as in `grants.manifest` (no DELETE, no column grants, no PUBLIC). Runtime grants come after every ENABLE + FORCE (rule 9 b); each definer GRANT follows its policies |
| `p_users__org_member_read` rests on who can create a membership (D-ARCH-156 asks) | **Signed off, citing the lifecycle guard.** A user's row becomes visible to organisation O only through an ACTIVE or SUSPENDED membership in O. That row is inserted only by the user, from O's context; its user and organisation never change; REMOVED is final. P2 shows a foreign-user insert refused (and, with the `noguard` mutant, accepted). Stated boundary: the migrator, a superuser and `session_replication_role = replica` (RR-18), and context integrity (PR65-SEC-02, T-35) |
| PR #43 record §6 conditions | Met: the real `users`, `memberships` and `organisations` are listed with `policySet` and `definerRead`; `trg_organisations__type_immutable` and `ux_organisations__single_operator` ship with `app_is_operator()`; PR43-SEC-09 (a) is resolved by D-ARCH-123 plus D-ARCH-156 |

### 5.2 Rulings verified on the database

| Control | Probe result |
|---|---|
| D-ARCH-151 reserved operator row, the control against a first OPERATOR organisation | Confirmed. Row at `:226-229`, before ENABLE + FORCE. A runtime OPERATOR insert gives `23505` (code review r1/r2, AT-US-061-02 as platform_app and as the superuser). The index has no `deleted_at` predicate, so a soft-deleted row still occupies it, and `type` is immutable. **The "first organisation" path is closed; the "join the existing one" path is PR65-SEC-02** |
| D-ARCH-154 composite keys | A foreign membership or invitation id gives `23503`, the same as an unknown id. The write channel is closed. The index read channel stays open (PR65-SEC-01) |
| D-ARCH-155 invitations | OPERATOR organisation: `P0001`. Code review r2: INDIVIDUAL `P0001`, BUSINESS_CUSTOMER ok, operator link unaffected |
| D-ARCH-156 lifecycle guard | P2: foreign member `P0001` (mutant: ok). P4: MERGE with a foreign user `P0001`; `ON CONFLICT DO UPDATE SET user_id` `P0001`; no actor at all: refused first by the standard-columns guard. The `UPDATE OF user_id, org_id, status` column list cannot be bypassed: no BEFORE trigger on `memberships` assigns a column |
| D-TASK037-14 (role-scope trigger before WITH CHECK) | P6: two-organisation actor `42501` (WITH CHECK); single-organisation actor `P0001 ROLE_NOT_ALLOWED_FOR_ORG_TYPE`. Mutant `wc` (`WITH CHECK (true)`): the single-organisation observation does not change, so the generated suite alone is blind to it. The two-organisation observation changes, so the R1-m2 cases catch it. C3 pins the deparsed `with_check` of every live policy (`c01-c12.int.test.ts:538-557`), and the generated expectation matches the marker, not just the SQLSTATE (`generator.ts:180-220`). **Ruling: the combination is sufficient.** Only the evidence binding of the R1-m2 cases is weak (PR65-SEC-05 (a)) |

### 5.3 Application code

| Item | Result |
|---|---|
| `assignRole` | Context organisation only, and the membership is looked up with an explicit `orgId` filter. A foreign membership gives `MembershipNotFoundError` (404 class, REQ-RLS-007) before any write |
| Create paths | The organisation row is inserted first. The id is the transaction's organisation (`TENANT_KEY_MODELS`, D-TASK037-05), so an existing id fails before any membership insert. The id is never caller-supplied in the module |
| D-TASK037-08 `MEMBERSHIP_STATUS_NOT_WRITABLE` | **Accepted.** `organisationRuleProblemCode` maps it to INTERNAL_ERROR (generic 500; the rule code goes to the log only). Refusal messages are fixed strings with no values (PR63-SEC-01 class not triggered) |
| D-TASK037-16 `timezone` in `PII_KEY_PARTS` (`string-redaction.ts:134`) | **Accepted.** On the head, `time_zone`, `timeZone`, `TIME-ZONE`, `timezone` and `timezoneOffset` are PII keys; on `main` none was (control: `email` is PII on both). The over-redaction of `timezoneOffset` fails closed (code review R1-n7). The audit trail is unaffected: it tokenises `users.time_zone` through the PER classification |
| C10 classifications | **Accepted.** `invitations.token_hash` SECRET (redacted before hashing in the audit trail; a credential verifier). `users.email`/`display_name`/`time_zone`, `organisations.display_name`/`legal_name`/`contact_email`/`contact_phone_e164` and `invitations.email` PERSONAL. Ids, statuses and timestamps INTERNAL. Classing a business organisation's `display_name` as PER is conservative (a personal organisation carries the user's name) |
| D-TASK037-27 (rulings §5.5 not done) | **Accepted as routed** (code review R2-n2 to TASK-049). Today the guard turns a wrong caller into `P0001`, which maps to 500 and fails closed. See PR65-SEC-04 (d) |

### 5.4 Standard-columns guard on the real tables (PR26-SEC-03; PR43-SEC-07 remainder)

| Case (P9 and the PR's cases) | Result |
|---|---|
| Forged `created_by` on INSERT; forged `version` on UPDATE (PR's `[SEC-TC-74]` case) | `P0001 STD_COLUMNS_VIOLATION` naming column and table |
| Version reset to 1 from version 2 | `P0001 … version on public.organisations (UPDATE)` |
| Back-dated `updated_at` on UPDATE; back-dated `created_at`/`updated_at` on INSERT | ok: timestamps are unconstrained (RR-18, accepted) |
| Wrong stamps plus a foreign organisation | `P0001 STD_COLUMNS_VIOLATION`: the BEFORE guard answers before WITH CHECK |
| Right stamps plus a foreign organisation | `42501` RLS |
| `MERGE … WHEN MATCHED THEN UPDATE` with a forged `created_by` | `P0001 … created_by on public.organisations (UPDATE)` |
| `MERGE … WHEN NOT MATCHED THEN INSERT` with `version = 7` | `P0001 … version on public.memberships (INSERT)` |
| Function shape (P7) | Owner `platform_migrator`, INVOKER, `search_path=pg_catalog, pg_temp`, EXECUTE for the owner only. Every domain trigger function is migrator-owned, INVOKER, with a fixed path. BEFORE triggers sort before `trg_<t>__std_columns` (C15 (b)) |

## 6. Earlier items

| Item | Status |
|---|---|
| PR11-SEC-10 (DR-A14 sign-off, TASK-037 half) | **Closed** subject to C1 (§5.1) |
| PR26-SEC-03 (first application of the guard) | **Closed** subject to C1 (§5.4) |
| PR26-SEC-04 (reserved users) | Closed: `ck_users__is_system` pins the two ids (P5: `23514`); `[PR26-SEC-04]` case present. The credentials half goes to TASK-049 (PR65-SEC-03) |
| PR43-SEC-09 (a) | Closed (D-ARCH-123, D-ARCH-156) |
| PR43-SEC-07 remainder | Proven here (§5.4); regression cases routed (PR65-SEC-05 (d)) |
| D-SEC-PR47-01 (2) | SEC-TC-74 moved (D-TASK037-22). The `min_tests` ratchet is open (PR65-SEC-05 (b)) |
| D-SEC-PR26-01 `on_behalf_of_org_id` first instance | Not applicable here (D-TASK037-02: no such column); stays with the first table that has it |
| Code review S1, S2, S3 | S1 closed at the table (D-ARCH-156). S2: R1-m1 closed, with PR65-SEC-01 as the index residual; R1-m3 closed. S3: this record |

## 7. Probes (session scratchpad `pr65sec/probes/`, may be wiped)

`sec1.mts` (P1 to P9; mutants `idx`, `wc`, `noguard`), `render.mts`, `tz.mts`, `sim.mjs`. Every probe has a positive control:
- P1 `ownControl`;
- P2/P4 the `noguard` mutant;
- P6 the `wc` mutant;
- render: two edits;
- tz: `main`;
- sim: C1 to C6.

## 8. Conditions and routing

Logged as D-SEC-PR65-01 in `docs/sdlc/DECISIONS.md`.

**C1 (merge condition; the orchestrator checks it on the credited lane-B run of the code tree `29be7be`, PostgreSQL 18).** No security round is needed if all of the following hold and no owned path changes after `29be7be`:
- **migrations:** up, down, up passes;
- **catalog-c1-c14:** passes, including C3, the C11 helper rows and the `[SEC-TC-74]` C15 cases (8 titles; 16 cases with the 9-row `it.each` matrix);
- **integration:** `organisations.int.test.ts` passes, with none skipped: all 19 of its `it` blocks, including `[R1-m2]`, `[D-ARCH-154] T1/T2`, `[D-ARCH-155] T3`, `[D-ARCH-156] T4..T8`, `[SEC-TC-74] [PR26-SEC-03]`, `[AT-US-061-01]` and `[AT-US-061-02]`;
- **rls-cross-tenant:** the committed layer covers the five tables, with the observations unchanged as the architect predicted (§2.5 of the rulings).

If any listed observation differs (for example a generated `roleScopeGuard` expectation), the PR returns for a security delta round. The expectation must not be adapted without a ruling.

| Item | Owner | Due |
|---|---|---|
| PR65-SEC-01 | This PR's next code cycle if one happens; else TASK-293 (expand migration + C16 rule) | before TASK-231 merges |
| PR65-SEC-02 (a) | TASK-049, TASK-224, TASK-227 (card lines) | with each task |
| PR65-SEC-02 (b) | principal-architect | before TASK-089 dispatch |
| PR65-SEC-03 | TASK-049 (uniform registration answer; no credentials or auth for `is_system`) | TASK-049 |
| PR65-SEC-04 (a), (b) | principal-architect (comment fix now; guard clause at the next function replacement; PARTNER at M3) | next fold |
| PR65-SEC-04 (c) | TASK-049 / TASK-057; architect on a users transition guard | TASK-057 |
| PR65-SEC-04 (d) | TASK-231 (with R2-n2) | TASK-231 |
| PR65-SEC-05 (a), (b), (d) | TASK-293 + qa-lead (manifest) + security-analyst (threat-model SEC-TC rows) | before TASK-049 merges |

## 9. Record validation

- **Simulation.** Main's `tools/ci/check-security-owned-paths.mjs` ran in a shared clone with plumbing commits:
  - the record committed on `main` (`9ede98e` + record; S5 on `fcec9a9` + record);
  - the PR tip = `29be7be` + an evidence-only commit;
  - the merge ref built with `git merge-tree`, as ci-gate checks out `refs/remotes/pull/65/merge`.
- **Results.** Every scenario behaved as expected. The record has exactly one `Head` row and one `Verdict` row.

| Scenario | Expected | Observed |
|---|---|---|
| S1 evidence tip, base = merge base `36bc841`, record on `main` | pass | exit 0, 26 owned paths, bound to `29be7be` |
| S2 the same with base = `main` tip | pass | exit 0, bound to `29be7be` |
| S3 the code head itself as the PR tip | pass | exit 0 |
| S4 `main` moves again (docs) after the record | pass | exit 0 |
| S5 the branch merges `main` `fcec9a9` (TASK-292) after the evidence commit, record on that `main` | pass | exit 0, bound to `29be7be`: the merge brings only paths the PR does not change |
| C1 no record | fail | exit 1, "no record named …PR-0065-*.md" |
| C2 a later `Verdict` row FAIL | fail | exit 1 |
| C3 the migration changed after `29be7be` | fail | exit 1, names `migration.sql` |
| C4 `Head` row names a `main` commit | fail | exit 1 |
| C5 the same record named for PR #64 | fail | exit 1 |
| C6 `Head` row names the pre-fix-cycle-2 head `bf53c46` | fail | exit 1, names the owned paths changed since |

- **Gitleaks.** A Gitleaks emulation (the pinned default ruleset, 221 of 221 rules compiled) scanned a commit with this record on `main`: **0 findings**. Control: the same commit plus runtime-built GitHub-PAT and AWS-id lines gives 4 findings (`github-pat`, `aws-access-token`, `generic-api-key` twice).
- **Host fragments.** A count-only scan for the OS user name, its 8.3 stem, home, temp directory, host name and the git identity found 0 of each. Control: a string containing the temp directory gives 1.

## 10. Verdict

| Field | Value |
|---|---|
| Verdict | **PASS_WITH_CONDITIONS.** No Critical, High or Medium finding is open for the change. The DR-A14 policies, the standard-columns guard and the D-ARCH-154..156 controls are signed off at `29be7be`, subject to C1 (lane-B evidence on PostgreSQL 18, checked by the orchestrator). PR65-SEC-01 and -02 (LOW) and PR65-SEC-03..05 (INFO) are routed in §8 |
