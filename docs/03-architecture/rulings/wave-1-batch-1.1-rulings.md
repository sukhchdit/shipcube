# Wave-1 batch 1.1 — rulings on PR #65 / TASK-037 (2026-11-18)

Owner principal-architect. Decisions D-ARCH-151, D-ARCH-152 and D-ARCH-153.

**Inputs.** DECISIONS D-ORCH-COORD-03 (items 1 to 3), D-ORCH-131 and D-TASK037-01..07. PR #65 at head `d3c2c16`, read from the worktree `../Shipqube-TASK-037`: the migration `20261117000000_organisations_identity`, the organisations service, rules and repository, and the integration and unit tests. US-061, US-062, US-082 (EPIC-03) and US-049, US-050 (EPIC-17). REQ-ORG-001, REQ-ORG-009, REQ-AUDIT-010, REQ-DATA-001..003. data-model §1.6, §3.2, §4.3, §8.3, §9. ADR-0005, ADR-0006 amendment 14. `api/openapi.yaml` (`createOrganisation`, `OrganisationCreateRequest`, `OrganisationPatch`) and `api/README.md` §11, §15, §18.

**Edited (main checkout, docs and plan only).** ADR-0005 (amendment 12, items 23 to 26). data-model §1.6, §3.2, §4.3, §8.3 rule 10, §9.1, §9.2, §9.3 and amendment row A30. risks.md (R-ARCH-33). `docs/04-plan/generator/plan-data.mjs` (cards TASK-037, TASK-089, TASK-224, TASK-231), with `task-map.csv` and the WAVE files regenerated.

**Deliberately not edited.** `api/openapi.yaml`, `api/README.md`, the story files and `gherkin-test-map.md`. They are tooling inputs (`tools/quality/required-suites.json`), so a change on `main` makes the lane-B evidence of every open PR stale (`check-evidence`), and a schema change also needs `packages/shared/src/api/types.gen.ts` regenerated in the same commit (`types-drift.test.ts`), which is product code. The contract change of ruling 2 therefore lands with the route (section 3.4).

**Not run here.** No test, type check, container or `openapi:lint` run (host rule of D-ORCH-130/131). The SQL and YAML below are written from the branch and the contract as read. Statements about what PostgreSQL refuses come from the policy text and the migration, not from an execution in this session.

## 1. Decisions

| # | Question | Ruling | Where |
|---|---|---|---|
| (1) | How is the operator organisation created in production? (D-TASK037-04, COORD-03 item 1) | **A reserved row in the migration that creates `organisations`, before `ENABLE` + `FORCE` (D-ARCH-151).** Same place and form as the reserved users. It exists in every migrated database, so no seed, job or operator step creates it, and no runtime role can create one afterwards. AT-US-061-01 goes back to TASK-037; the re-route to TASK-089 is withdrawn. | ADR-0005 am. 12 items 23 to 25; data-model §1.6, §3.2, §8.3 rule 10, §9; TASK-037 and TASK-089 cards |
| (2) | The first staff user in production | **Separate from the organisation, and M5 (D-ARCH-153).** A one-shot audited command creates one Super Admin without credentials in the reserved organisation. It is a precondition of G4 for a production release, not Run 1 work. | ADR-0005 am. 12 item 26; R-ARCH-33; TASK-089 card (shared provisioning function) |
| (3) | `OrganisationCreateRequest` has no `type`: 400 `UNKNOWN_FIELD` instead of 422 `ORG_TYPE_NOT_ALLOWED` (COORD-03 item 2) | **The contract adds an optional `type`; the acceptance criteria stand (D-ARCH-152).** The contract already lists `ORG_TYPE_NOT_ALLOWED` on `createOrganisation` and nowhere else; the schema is the part that is wrong. The edit lands in the TASK-224 PR with the route. PR #65 needs no contract change. | Section 3; TASK-224 card |

## 2. Ruling 1: the operator organisation (D-ARCH-151)

### 2.1 What the branch and the documents say

- After `FORCE ROW LEVEL SECURITY`, `platform_migrator` has no policy on `organisations` (ADR-0005 amendment 6), so the reference seed, which runs as the migrator, cannot insert the row. PR #65 already met this for the reserved users and inserts them in the migration before `FORCE` (D-TASK037-03).
- The documents disagreed before this ruling. REQ-ORG-001 and AT-US-061-01 speak of "the seed" and "the reference seed". data-model §9.3 listed the operator organisation under the **demo** seed, which never runs with `APP_ENV=production` (REQ-DATA-001/002). Read together, production had no operator organisation at all.
- `p_organisations__active` is `FOR ALL … WITH CHECK (id = platform.app_org_id())`. It does not look at `type`, and the creating service chooses `app.org_id` itself (data-model §4.3). On a database whose `ux_organisations__single_operator` index is empty, the service rule `assertCreatableOrgType` is the only thing that stops a `platform_app` session from inserting the first OPERATOR organisation and a membership in it, after which `app_is_operator()` is true for that actor.

### 2.2 Options

| Option | One OPERATOR organisation in every environment without an operational step | No new privileged write path | No runtime role can create an OPERATOR organisation | Fits the accepted ADRs |
|---|---|---|---|---|
| **A. Reserved row in the creating migration, before `FORCE`** | yes | yes | yes: the unique index is occupied from the first deploy | yes: the form of D-TASK037-03 and of the authz seed migrations (D-ARCH-060) |
| B. Privileged job after `migrate` (cluster admin, a write-capable definer function, or a policy for the migrator) | only if the job runs | no: break-glass credential for routine work, or a definer write, or a migrator policy | yes, once run | no: ADR-0005 amendment 6, ADR-0007 amendment 7 |
| C. Demo seed or an admin flow as `platform_app` through the service (TASK-089) | no: the demo seed is refused in production | yes | no: the slot stays open until the flow runs, and the service must keep one path that creates OPERATOR | partly |
| D. A production command that creates the organisation together with the first staff user | no | yes | no, until it has run | partly |

**A is chosen.** B buys nothing that A lacks and costs a privilege the role model was built to avoid. C and D leave the control to service code in exactly the environment that matters, and both need the capability REQ-ORG-001 says no API has.

### 2.3 The row

Placed in `20261117000000_organisations_identity/migration.sql` directly after the reserved users, which is after `ux_organisations__single_operator` and before the first `ENABLE ROW LEVEL SECURITY`:

```sql
-- Reserved operator organisation (data-model §1.6, §3.2; DR-A06; ADR-0005 amendment 12; D-ARCH-151). The one OPERATOR
-- organisation exists from this migration in every environment, so ux_organisations__single_operator is occupied and no
-- runtime role can create another. Written before ENABLE + FORCE for the same reason as the reserved users.
INSERT INTO "public"."organisations" ("id", "created_by", "updated_by", "type", "display_name")
VALUES ('00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000001',
        '00000000-0000-7000-8000-000000000001', 'OPERATOR', 'Operator')
ON CONFLICT ("id") DO NOTHING;
```

- **Identifier.** `00000000-0000-7000-8000-000000000010`, exported as `OPERATOR_ORG_ID` next to `SYSTEM_ACTOR_ID` in `packages/shared/src/ids`. The low values `…03` to `…0f` stay free for reserved actors. `seedId('org:operator')` is withdrawn. Code decides "operator" by `type = 'OPERATOR'`, never by the id.
- **Name.** The literal `Operator`. Brand strings in the UI and in e-mail come from `BRAND_*`; the column is ordinary profile data that a Super Admin may change later. No seed renames it.
- **Header.** `data-changing: no` stays: the insert touches no existing row (data-model §8.3 rule 10 as clarified). The linter already treats `ON CONFLICT … DO NOTHING` this way.
- **Prefix safety.** The table has no runtime grant until the end of the file, so no prefix of the file exposes the row. `down.sql` drops the table and needs no change.
- **Audit.** A migration writes no audit entry (D-ARCH-075). The record is the migration ledger and git, as for the reserved users.
- **Later reserved rows.** After `FORCE` the migrator's insert is refused, so a later migration cannot add one. A reserved row needed later is a new ADR amendment.

### 2.4 What changes, by task

**TASK-037 (PR #65).**

1. Add the row above to the migration.
2. Export `OPERATOR_ORG_ID` from `packages/shared/src/ids`; one test compares the row with the constant.
3. `[AT-US-061-01]` stays in this task, in the integration suite on the migrated template: exactly one OPERATOR organisation, with the reserved id, the SYSTEM actor, version 1 and no membership; the real reference seed run twice (`runReferenceSeed`) leaves the `organisations` row count and the reserved row unchanged. The scenario's outcome is met as written; only the mechanism differs.
4. `[AT-US-061-02]` at the database is rewritten. The current test plants a first OPERATOR organisation and expects the second to fail; with the reserved row the plant itself fails. New form: with nothing planted, an insert of `type = 'OPERATOR'` as `platform_app` in the context of a fresh organisation id fails with `23505` on `ux_organisations__single_operator`, and so does the same insert as the superuser.
5. No fixture plants an OPERATOR organisation any more. `plantProbe` in `prisma/tests/catalog/c01-c12.int.test.ts` (committed-table branch), the `[SEC-TC-06]` positive control in `tests/generated/rls/cross-tenant.int.test.ts` and any other fixture insert the operator membership into `OPERATOR_ORG_ID`. The generated-suite file is edited after `main` with TASK-290 is merged into the branch (COORD-03 item 4).
6. The service is unchanged: it refuses every type but `BUSINESS_CUSTOMER` and gains no seed-only path.

**TASK-089.**

1. It does not create, look up by seed id, or rename the operator organisation. It uses `OPERATOR_ORG_ID`.
2. It does not own AT-US-061-01.
3. A staff user takes two tenant transactions, because a transaction has one `app.org_id`: the registration path in the context of the personal organisation, then the `ACTIVE` membership and the operator role in the context of `OPERATOR_ORG_ID`. A re-run after a failure between the two finds the user by e-mail and adds the missing membership.
4. The staff-provisioning function is exported from the service layer, because the M5 command of D-ARCH-153 reuses it.
5. US-050 scenario 1 ("the OPERATOR organisation has 8 users") is unchanged.

**First staff user in production (D-ARCH-153, R-ARCH-33; M5).** `ops:staff-bootstrap`, of the same family as `ops:staff-reactivate` (ADR-0006 amendment 14). It runs as `platform_app` through the identity and organisations services with a `SYSTEM_JOB` actor, as a pipeline task and never from a terminal. It creates one user without credentials, an `ACTIVE` membership in `OPERATOR_ORG_ID` with `OPERATOR_SUPER_ADMIN`, and a `SET_PASSWORD` link; the e-mailed enrolment code and the 24 h enrolment deadline apply. It refuses when the operator organisation already has a member, so it cannot serve as a standing back door. It creates no organisation.

## 3. Ruling 2: `type` on the create request (D-ARCH-152)

### 3.1 What the documents say

- `createOrganisation` describes "Any type other than BUSINESS_CUSTOMER cannot be created (ORG_TYPE_NOT_ALLOWED)" and lists the code in `x-error-codes`. No other operation lists it. The request schema is closed and has no `type`, so the code is unreachable: the contract contradicts itself.
- REQ-ORG-001 says "Attempts: 422 `ORG_TYPE_NOT_ALLOWED`". AT-US-061-02 expects that response. AT-US-061-05 expects an audit entry with outcome `FAILED` for the refused attempt.
- REQ-AUDIT-010 writes `FAILED` entries for 409, 422 and 5xx and **none** for a request rejected by schema validation (400). With a closed schema the attempt is a 400, so AT-US-061-05 fails as well as AT-US-061-02.
- On update the story already asks for 400 `UNKNOWN_FIELD` (AT-US-061-03, US-082 last scenario), and `OrganisationPatch` has no `type`. That part is consistent.

### 3.2 Options

| Option | Artefacts that change | Refused attempt is audited | Request surface |
|---|---|---|---|
| **(a) The contract adds an optional `type` to the create request** | one schema property and one example | yes (422, REQ-AUDIT-010) | one optional field with one accepted value |
| (b) The acceptance criteria change to 400 `UNKNOWN_FIELD` | REQ-ORG-001 note, AT-US-061-02, AT-US-061-05 (withdrawn or rewritten), the operation's description and `x-error-codes`, the catalogue row; `ORG_TYPE_NOT_ALLOWED` and the service rule become unreachable through the API | no (400 is logged only) | unchanged |

**(a) is chosen.** Three approved documents and the contract's own description agree; the schema is the outlier. An attempt to create an OPERATOR or PARTNER organisation is a privilege probe, and it belongs in the audit trail.

Ruling 1 is what makes (a) safe below the service. A client may now send `type: OPERATOR` as far as the service. If the service check were ever lost, the database still refuses: OPERATOR by the occupied unique index, INDIVIDUAL by `ck_organisations__personal_owner` (this path sets no personal owner), and PARTNER because the owner's `CUSTOMER_OWNER` role link fails `trg_membership_roles__scope_matches_org` in the same transaction.

### 3.3 The change (approved change request; applied verbatim by TASK-224)

`components.schemas.OrganisationCreateRequest`: one new property, first in `properties`. `required` and `additionalProperties: false` do not change.

```yaml
        type:
          type: string
          enum:
            - OPERATOR
            - BUSINESS_CUSTOMER
            - PARTNER
            - INDIVIDUAL
          default: BUSINESS_CUSTOMER
          description: >-
            Optional. BUSINESS_CUSTOMER is the only type this operation creates and the value used when the field is
            absent. OPERATOR, PARTNER and INDIVIDUAL pass validation and are refused with 422 ORG_TYPE_NOT_ALLOWED;
            the attempt is audited with outcome FAILED. Any other value is 400 VALIDATION_ERROR.
```

`createOrganisation` request examples: one more.

```yaml
              type_refused:
                summary: A type other than BUSINESS_CUSTOMER is refused (422 ORG_TYPE_NOT_ALLOWED)
                value:
                  type: PARTNER
                  name: Acme Exports
                  country_code: US
                  default_currency: USD
```

- The enum lists all four values on purpose. With `BUSINESS_CUSTOMER` alone, PARTNER would fail validation and be a 400 again.
- `OrganisationPatch` stays without `type`.
- `api/README.md`: one line in the amendments list; the `ORG_TYPE_NOT_ALLOWED` row of §11 reads "A `createOrganisation` request for a type other than BUSINESS_CUSTOMER" (a type change is 400 `UNKNOWN_FIELD` at the route and `ORG_TYPE_IMMUTABLE` at the database, never this code).
- Joi: `type` valid over the four values with default `BUSINESS_CUSTOMER`. The handler passes the validated value to `createOrganisation` of TASK-037.
- The web form and its Zod schema never send `type`.
- Adding an optional request property is not a breaking change for `oasdiff`.

### 3.4 Where it lands

In the TASK-224 PR, which mounts `createOrganisation` and `updateOrganisation` (api/README §18 item 1: the contract changes in the PR with the route, the Joi schema and the tests, followed by `openapi:lint` and `openapi:types`). Nothing mounts the operation before that, so no code disagrees with the contract in the meantime.

**PR #65 needs no change for this ruling.** Its service already takes `type` and refuses everything but `BUSINESS_CUSTOMER`. Its `[AT-US-061-02]` tests prove the service rule and the database backstop; the response-level proof needs the route.

Tests on TASK-224, with the IDs in the titles:

- `[AT-US-061-02]` POST with `type` PARTNER, OPERATOR and INDIVIDUAL: each 422 `ORG_TYPE_NOT_ALLOWED`, row count unchanged. A value outside the enum: 400 `VALIDATION_ERROR`. No `type`: 201, `BUSINESS_CUSTOMER`.
- `[AT-US-061-03]` PATCH with `type`: 400 `VALIDATION_ERROR`, sub-code `UNKNOWN_FIELD`.
- `[AT-US-061-04]` anonymous POST: 401 `AUTH_REQUIRED`.
- `[AT-US-061-05]` the refused PARTNER attempt leaves one audit entry with outcome `FAILED`, action `CREATE`, entity `organisation`, written outside the rolled-back transaction.

## 4. Open items for other owners

| Item | Owner | Recommended default |
|---|---|---|
| **A Must story now closes in a cuttable task.** US-061 is M0 Must and demo-critical. D-ORCH-131 deferred AT-US-061-04/05 to TASK-224, and the response-level halves of AT-US-061-02/03 can only be proven there too. TASK-224 is Wave 8, Should and cuttable, and `createOrganisation` is `x-milestone: M1`, `x-moscow: Should`. The same holds for US-062 (AT-05, AT-06) and TASK-231. If either task is cut, G3 counts unproven Must scenarios. The cards still say that TASK-037 completes both stories. | product-manager (delivery split, D-061 form), then senior-developer | Record US-061 and US-062 as partial on TASK-037 and completed by TASK-224 and TASK-231, which makes the two routes non-cuttable. Alternative: move the route-level scenarios to US-082 and US-085. Not applied here: it changes the priority of two tasks. |
| Wording: REQ-ORG-001 "(created by seed)" and the title of US-061 scenario 1 | product-manager, at the next story edit | "created by the schema migration; present before any seed runs". The Then-clause is unchanged. Not edited now: the story files are tooling inputs. |
| Backlog story for the first production staff user (D-ARCH-153) | product-manager | With EPIC-B-207 (staff users) or the M5 readiness epic; a G4 precondition for a production release. |
| Threat entry: a `platform_app` session creating the first OPERATOR organisation on an empty slot, and its control (the reserved row, with the negative test of section 2.4 item 4) | security-analyst, in the PR #65 review | Adopt the negative test as the verification of the control. |
| `gherkin-test-map.md` lists `api` as the primary suite of AT-US-061-01..03, while PR #65 carries these IDs in the integration and unit suites | qa-lead | Decide at the next regeneration of the map. |

## 5. Closure

| Input | Outcome |
|---|---|
| D-ORCH-COORD-03 item 1 | Ruled (D-ARCH-151, D-ARCH-153). |
| D-ORCH-COORD-03 item 2 | Ruled (D-ARCH-152); change request on the TASK-224 card. |
| D-ORCH-COORD-03 item 3 | Already accepted by D-ORCH-131. Folded onto the TASK-224 and TASK-231 cards so it is not lost; its effect on story completion is the first open item above. |
| D-TASK037-03 | Confirmed, and extended to the operator organisation. |
| D-TASK037-04 | Superseded: AT-US-061-01 stays on TASK-037. |
