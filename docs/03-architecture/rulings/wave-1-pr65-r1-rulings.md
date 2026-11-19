# Wave-1: rulings on the PR #65 / TASK-037 code review, round 1 (2026-11-19)

Owner principal-architect. Decisions D-ARCH-154, D-ARCH-155, D-ARCH-156 and D-ARCH-157.

**Inputs.** `docs/05-quality/reviews/PR-0065-TASK-037-code-review.md` (R1-m1 (b), R1-n1, security flag S1). PR #65 at `bf53c46` plus the developer's uncommitted fix-cycle edits, read from the worktree (branch `task-037-fc1`) and not modified: the migration `20261117000000_organisations_identity`, its `down.sql`, `prisma/schema/organisations.prisma`, the organisations service and repository, `prisma/tests/organisations/organisations.int.test.ts`, `prisma/tests/catalog/c15-std-columns-guard.int.test.ts` and `tests/generated/rls/{generator,database,fixtures}.ts`. REQ-ORG-003, REQ-ORG-010, REQ-ORG-011, REQ-ACCT-014, DR-A05, A-082. `packages/authz/src/roles.ts`. data-model §1.1, §3.2, §4.3, §4.6, §7.3, §7.6, §9. ADR-0005. D-ARCH-091, D-ARCH-123, D-ARCH-151, D-ARCH-153.

**Edited (main checkout, docs only).** ADR-0005 (amendment 13, items 27 to 30). data-model §1.1 (P12), §1.7, §3.2, §4.3 (one pointer sentence outside the policy fence), §4.6 (C16), new §4.7, §9.1, §9.3 and amendment row A31. risks.md (R-ARCH-34). DECISIONS.md.

**Deliberately not edited.** The worktree. `api/openapi.yaml`, `api/README.md`, the story files and `gherkin-test-map.md` (tooling inputs). `docs/04-plan/generator/plan-data.mjs`: the card lines are in section 7 for the next sheet fold.

**Run here.** Single-process Node probes only, no Jest, no container:

- The developer's in-progress migration was copied to the session scratchpad and patched there with the change list of section 5. Bootstrap files 00 to 02, the five released migrations and the patched file apply on PGlite 17.5 (`uuidv7()` replaced by `gen_random_uuid()`, as in the review).
- Every case of sections 2 to 4 was run as `platform_app` with the context keys set, and again against the unpatched file as the negative control. Results are quoted where they are used.
- `prisma validate` and `prisma migrate diff --from-empty --to-schema … --script` (no database) on a scratch copy of the schema with the edits of section 5.3. The differ emits exactly the two `CREATE UNIQUE INDEX` and two `ALTER TABLE … ADD CONSTRAINT` statements of section 5.1.
- `tools/db/lint-migrations.ts` on an extract of `bf53c46` with the patched migration, `down.sql` and schema: no findings.

**Not run here.** Lint, type check, unit, integration, catalog and generated suites. PGlite is PostgreSQL 17, not 18. Lane B on the fixed head is the evidence.

## 1. Decisions

| # | Question | Ruling | Where |
|---|---|---|---|
| (1) | R1-m1 (b): ids that point into another tenant are accepted, because referential-integrity checks bypass RLS | **Composite foreign keys through `org_id`, in this migration (D-ARCH-154).** `membership_roles (org_id, membership_id) → memberships (org_id, id)` and `memberships (org_id, invitation_id) → invitations (org_id, id)`, each replacing the single-column key. It becomes the rule for every reference between two organisation-keyed tables, checked by a new catalog assertion C16. The service check of R1-m1 (a) stays. | ADR-0005 am. 13 items 27 and 28; data-model §4.7, §4.6 C16, §3.2 |
| (2) | R1-n1: the invitations trigger admits OPERATOR-scope roles | **Stricter trigger (D-ARCH-155).** An invitation row exists only in a `BUSINESS_CUSTOMER` organisation, which makes its role a customer role. The data-model was right and now says so exactly. | ADR-0005 am. 13 item 30; data-model §3.2 `invitations` |
| (3) | S1: in the context of organisation A, `platform_app` can insert an ACTIVE membership for any user, and `p_users__org_member_read` then shows that user's profile row | **A database control in this migration (D-ARCH-156).** An `AFTER ROW` trigger on `memberships`: the member is the transaction's actor, the row is created `ACTIVE`, `user_id` and `org_id` never change, `REMOVED` is terminal. No definer write, no policy change. | ADR-0005 am. 13 item 29; data-model §3.2 `memberships`, §4.7 |
| (4) | Found while ruling (3): "`created_by` = the inviter" at invitation acceptance (D-ARCH-123, REQ-ORG-011, US-084) | **Withdrawn (D-ARCH-157).** The standard-columns guard already refuses it. `created_by` is the accepting user; the inviter is `invitations.created_by`, reached through `memberships.invitation_id`. Wording goes to product-manager. | data-model §3.2; section 6 |

## 2. Ruling 1: tenant-bound references (D-ARCH-154)

### 2.1 Facts

- PostgreSQL runs referential-integrity checks without row security. A foreign key therefore tells the writer whether an id exists in any tenant, and lets a row of organisation A point at a row of organisation B.
- In this migration two references join two organisation-keyed tables: `membership_roles.membership_id` and `memberships.invitation_id`. The other foreign keys point at `organisations` (the tenant key itself), at `users` (not tenant-owned) or at `roles` (GLOBAL).
- Probe on the unpatched file, context A: a `membership_roles` row with `org_id = A` and B's membership id is accepted, and so is a membership of A that names B's invitation.
- What the forged role row does:
  - It is invisible to B, so B's permission resolution does not read it.
  - It occupies `ux_membership_roles__membership_role_live (membership_id, role_id)`. B's own grant of that role to that member then fails with `23505` while B sees no role row for the membership (probed on the unpatched file). That is a write effect across tenants: A can block a role grant in B.
  - The same index answers "does B's membership hold role R" to A (`23505` or not), and the foreign key answers "does this membership id exist anywhere" (`23503` or not). Both are read channels across tenants.
  - Counts by `org_id` (AP-ORG-10 LAST_OWNER, the AP-ORG-04 owner cap) include a role row whose membership belongs to another organisation unless every query joins on both columns.
- The service fix of R1-m1 (a) (organisation from the transaction context, membership looked up with an explicit `orgId`) closes the route. It does not close the table, and RLS exists for the case where the service is wrong (ADR-0005, NFR-SEC-011).

### 2.2 Options

| Option | Closes the write and read channels at the table | Cost | Fits the tooling |
|---|---|---|---|
| **A. Composite foreign key through `org_id`, single-column key removed** | yes, declaratively, for every role | one unique index per referenced table; no extra index on the referencing table; one RI probe as before | Prisma expresses it (`@@unique([orgId, id])`, two-field relation); no policy, renderer or generator change |
| B. Service-layer checks only | no | none | nothing to do |
| C. A trigger that compares the parent's `org_id` | yes | a `SECURITY INVOKER` trigger cannot see B's row and a definer one adds a privileged read; hand-written per reference | more triggers ahead of `WITH CHECK` in the generated suite |
| D. Later, in an expand migration | yes, later | `NOT VALID` + `VALIDATE`, a concurrent unique index in its own file, and every table added meanwhile repeats the finding | same as A |

**A is chosen, now.** The tables are empty and the file is still mutable, so the change is two indexes and two edited constraints. Later it is a three-file expand migration per table pair.

### 2.3 The rule from here on (data-model §4.7)

- **T1.** A reference from one organisation-keyed table to another, where `org_id` is `NOT NULL` on the referencing side, is a composite foreign key `(org_id, <x>_id) → <parent> (org_id, id)`. It replaces the single-column key and keeps its name `fk_<table>__<x>_id`. The parent carries `ux_<parent>__org_id_id` on `(org_id, id)`.
- **T2.** Where `org_id` is nullable on the referencing side (GUEST_CAPABLE), the single-column key stays, because `MATCH SIMPLE` checks nothing while `org_id` is NULL, and the composite key is added beside it as `fk_<table>__org_id_<x>_id`. It binds the row from the moment `org_id` is set. Checked on a two-table probe only (guest child of a missing parent `23503`; tenant child naming another organisation's parent `23503`; the claim order parent then children ok). Binding guest rows through `guest_token_hash` is not decided here (section 8).
- **Outside the rule.** References to GLOBAL tables, to `organisations`, to `users`, and the logical actor columns of P2.
- **C16** (data-model §4.6) asserts T1 and T2 on the migrated schema with an exception map that starts empty. Default owner TASK-293.
- **Cost.** A 32-byte key: about 50 MB per million parent rows (estimate, not measured) and one more index insertion per parent insert. `memberships` and `invitations` are small and rarely written.

### 2.4 Probe results (patched file)

| Case, context A | Result |
|---|---|
| Role row of A naming B's membership | `23503` on `fk_membership_roles__membership_id` |
| Role row of A naming an id that is no membership | `23503`, the same answer, so the key no longer tells "foreign" from "absent" |
| Role row of A naming A's membership | ok |
| Own membership naming B's invitation | `23503` on `fk_memberships__invitation_id` |
| Own membership naming A's invitation, or none | ok |
| Multi-org actor, role row with `org_id = B` | `42501` RLS, as before |
| Registration shape of AT-US-062-01 (membership and Owner link in one statement, then `SET CONSTRAINTS ALL IMMEDIATE`) | ok |
| C16 sketch | no row (unpatched: both keys listed) |

### 2.5 Effect on the DR-A14 policies and on the generated RLS suite

- **Policies.** None. No policy text, template, manifest field or renderer rule changes, so rule 9, C3 and the pending security sign-off on the rendered policies are untouched.
- **Generated suite (`tests/generated/rls`).** No expectation should change:
  - Seeding runs as the superuser under `session_replication_role = replica` in its own committed transaction, so no foreign key is checked while seeding.
  - `insert-foreign-key` and `reparent-own-row` on `membership_roles` are refused by the role-scope trigger and on `memberships` by `WITH CHECK`. Both come before a foreign-key check, which runs at the end of the statement.
  - `update-blind` sets `org_id` to its own value. PostgreSQL re-checks a foreign key on update only when a key value changes or the row was inserted by the same transaction, and the seeded rows were committed earlier.
  - Probed with committed seed rows that carry dangling synthetic references, as the suite plants them: the six observations (`update-blind`, `reparent-own-row`, `insert-foreign-key` on `membership_roles` and on `memberships`) are identical on the patched and the unpatched file.
- If lane B shows a changed observation on these tables, report it. Do not adapt the expectation without a ruling.

## 3. Ruling 2: invitations only in BUSINESS_CUSTOMER organisations (D-ARCH-155)

- **Requirement.** REQ-ORG-010 invites "into a `BUSINESS_CUSTOMER` organisation" with Owner, Admin, Shipper, Finance or Viewer. REQ-ACCT-014 and A-082 say invitations are not offered for INDIVIDUAL organisations, and DR-A05 gives an INDIVIDUAL organisation exactly one member. The data-model's "customer roles only" follows from that.
- **Why the looser trigger matters.** `OPERATOR_SUPER_ADMIN` holds every role-assignable permission, `org:member:invite` included, and its active organisation is the operator organisation. Once the invitation route exists (TASK-227), the service rule is the only thing between that actor and an invitation for an operator role. Whoever accepts it becomes operator staff with cross-tenant read, outside the staff controls of M2 (EPIC-B-207) and the first-staff command of D-ARCH-153. The trigger as written admits exactly that row (probe, unpatched: ok).
- **Ruling.** `platform.role_scope_matches_org()` gains one check for `invitations`: the organisation's type is `BUSINESS_CUSTOMER`. With the existing mapping the role is then a CUSTOMER role. The function stays shared and takes no argument, so `ROLE_SCOPE_GUARDS` and its text pin do not change, and the refusal keeps the marker `ROLE_NOT_ALLOWED_FOR_ORG_TYPE`.
- **Service.** Unchanged in this PR. TASK-227 refuses first with 422 `ORG_TYPE_RESTRICTION` (non-BUSINESS_CUSTOMER organisation) or `ROLE_NOT_ALLOWED_FOR_ORG_TYPE`; the trigger is the backstop and is never the expected answer.
- **Later.** Staff or partner onboarding by invitation (M2, M3) replaces the function in a new migration under an ADR-0005 amendment.
- **Probe (patched).** OPERATOR organisation with `OPERATOR_SUPER_ADMIN`: `P0001`. INDIVIDUAL organisation with `CUSTOMER_VIEWER`: `P0001`. BUSINESS_CUSTOMER with `CUSTOMER_VIEWER`: ok. An operator role link on an operator membership and the Owner link in a personal organisation: ok, so `membership_roles` is unaffected.

## 4. Ruling 3: the membership lifecycle guard (D-ARCH-156)

### 4.1 Facts

- `p_memberships__tenant` is `FOR ALL` with `org_id = platform.app_org_id()`. Any session of organisation A may insert or update any membership row of A.
- `p_users__org_member_read` shows a user's row to every session of an organisation in which that user has an ACTIVE or SUSPENDED membership.
- Probe on the unpatched file: actor A in context A inserts an ACTIVE membership for user B, and user B's row is then readable in context A (1 row).
- D-ARCH-123 removed `INVITED` from the policy list for this reason ("a membership row is writable by any session of the organisation"). The same sentence is true of ACTIVE. The earlier ruling closed the design path and left the table open.
- DR-A05 already fixes the lifecycle: created ACTIVE (registration, organisation creation, invitation acceptance), `ACTIVE ↔ SUSPENDED`, then `REMOVED`, which is terminal. REQ-ORG-003: re-adding a removed member creates a new row.
- In all three creating paths the new member is the actor of the transaction.

### 4.2 Options

| Option | Closes S1 at the table | New privilege or policy shape | Covers update paths |
|---|---|---|---|
| **A. `AFTER ROW` assertion trigger on `memberships`** | yes | none | yes: `user_id`, `org_id`, leaving `REMOVED` |
| B. Insert only through a definer function, `INSERT` revoked from `platform_app` | yes | a write-capable definer function and a write policy for `platform_definer` (against ADR-0005 amendments 6 and 12 item 25); the function would test the same condition as A | no |
| C. A restrictive `FOR INSERT` policy `user_id = platform.app_actor_id()` | insert only | a new policy kind in the DR-A14 memberships template: renderer allow-list, rule 9, C3, the §4.3 fence and the security sign-off all move | no: a policy cannot compare OLD and NEW |
| D. Require an accepted invitation | no | none | no: invitations are tenant-writable too, and registration and organisation creation have none |
| E. Service rule only, tracked task | no | none | no |

**A is chosen, in this migration.** A trigger could ship later without touching this file. It ships now because the security sign-off on `p_users__org_member_read` rests on who can create a membership, and because every later task (TASK-049, 089, 224, 227, 231) writes fixtures against this table.

### 4.3 The rules

1. **Insert: the member is the actor.** `user_id = platform.app_actor_id()`. With no actor the insert is refused.
2. **Insert: created ACTIVE.** This makes "no `INVITED` row is written" (D-ARCH-123) a property of the database.
3. **Update: `user_id` and `org_id` never change.**
4. **Update: a `REMOVED` row keeps that status.**

There is no exemption for the SYSTEM actor or for `platform_migrator`. An exemption for SYSTEM would reopen the hole for every job context. The migrator cannot write the table after `FORCE` anyway.

**Why `AFTER ROW`.**

- RLS `WITH CHECK` runs before it, so a cross-tenant write still fails as `42501` and the generated suite keeps proving `WITH CHECK` on `memberships` (the concern of R1-m2 does not arise here).
- An `AFTER` trigger cannot change the row, so C15 (b) ("no BEFORE ROW trigger sorts after the standard-columns guard") is not in play.
- `trg_organisations__type_immutable` is the precedent in the same file.
- Default from now on: an assertion trigger on an RLS table is `AFTER ROW` unless it has a stated reason to run earlier. The two role-scope triggers stay `BEFORE` as reviewed (D-TASK037-14 with R1-m2).

### 4.4 Consequences for callers

- **Registration, organisation creation, invitation acceptance.** Already run with the member as actor. Nothing changes.
- **Demo seed and the staff-provisioning function (TASK-089), `ops:staff-bootstrap` (M5).** The transaction that inserts a membership has `app.actor_id` = that member, in the context of the target organisation. This is already true of the transaction that inserts the `users` row (`p_users__own`). "Seed actor = SYSTEM" (data-model §9.1) holds for the reference seed and for configuration changes. The audit actor type (`SYSTEM_JOB`) and the run reference are fields of the audit entry (`packages/audit`), not `app.actor_id`.
- **Fixtures.** The superuser `replica` path is unaffected. A fixture that inserts a membership as `platform_app` uses the member as actor and status ACTIVE.
- **A future path in which an organisation enrols a user without that user acting** (directory provisioning, staff management by an administrator) needs an ADR-0005 amendment and a migration that replaces the function.
- **Error mapping.** `MEMBERSHIP_LIFECYCLE_VIOLATION` is a backstop marker, not a catalogue code. A service that reaches it has a defect, and the existing mapping answers 500.

### 4.5 Probe results (patched file)

| Case | Result |
|---|---|
| Context A, actor A: ACTIVE membership for user B | `P0001 MEMBERSHIP_LIFECYCLE_VIOLATION: the member is not the actor`; user B's row stays invisible to A (0 rows; unpatched: 1) |
| Actor X: own membership, `SUSPENDED` or `INVITED` at creation | `P0001 … a membership is created ACTIVE` |
| Actor X: own ACTIVE membership | ok; member A then reads X's row (1 row), so the policy still works |
| Re-point a membership to user B | `P0001 … user_id cannot change` |
| `REMOVED → ACTIVE`, `REMOVED → SUSPENDED` | `P0001 … REMOVED is terminal` |
| `ACTIVE → SUSPENDED → ACTIVE → REMOVED`; another column of a REMOVED row | ok |
| Re-parent to organisation B as `platform_app` | `42501` RLS (`WITH CHECK` first) |
| Re-parent as the superuser in origin mode (RLS bypassed) | `P0001 … org_id cannot change` |
| Insert with `org_id = B`; blind update with `org_id` unchanged (the generated probe shapes) | `42501` RLS; ok |
| Forged `created_by` on a foreign-user insert (SEC-TC-74 shape) | `P0001 STD_COLUMNS_VIOLATION`, unchanged: the `BEFORE` guard still answers first |

## 5. Change list for PR #65 (TASK-037)

All edits are in the unmerged migration, its `down.sql`, the Prisma schema and the tests. Line numbers are not given because the file is being edited; anchors are statement text.

### 5.1 `migration.sql`: tenant-bound references (ruling 1)

1. In `CREATE TABLE "public"."membership_roles"`, **delete** the line

   ```sql
   CONSTRAINT "fk_membership_roles__membership_id" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
   ```

2. In the `ALTER TABLE` block after the tables, **delete** the statement

   ```sql
   ALTER TABLE "public"."memberships" ADD CONSTRAINT "fk_memberships__invitation_id" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
   ```

3. At the end of the Indexes section (after `ux_invitations__token_hash`), **add**

   ```sql
   -- Targets of the tenant-bound references below (data-model §4.7; ADR-0005 amendment 13 item 27; D-ARCH-154). "id" is
   -- unique already; PostgreSQL needs a unique index on exactly the referenced column list.
   CREATE UNIQUE INDEX "ux_memberships__org_id_id" ON "public"."memberships"("org_id", "id");
   CREATE UNIQUE INDEX "ux_invitations__org_id_id" ON "public"."invitations"("org_id", "id");

   -- Tenant-bound references: a TENANT row points only at a parent of its own organisation. Referential-integrity checks
   -- bypass row-level security, so a single-column key would accept another tenant's id (code review PR #65 R1-m1 (b)).
   ALTER TABLE "public"."membership_roles" ADD CONSTRAINT "fk_membership_roles__membership_id" FOREIGN KEY ("org_id", "membership_id") REFERENCES "public"."memberships"("org_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
   ALTER TABLE "public"."memberships" ADD CONSTRAINT "fk_memberships__invitation_id" FOREIGN KEY ("org_id", "invitation_id") REFERENCES "public"."invitations"("org_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
   ```

   This is the form Prisma's differ emits for the schema of 5.3 (unique index, then `ALTER TABLE`), so the drift check has nothing to tolerate. The four statements come before the reserved rows, the RLS blocks and the grants, so every prefix of the file stays safe.

### 5.2 `migration.sql`: the two triggers (rulings 2 and 3)

4. In `platform.role_scope_matches_org()` (the developer's fixed version with `v_expected`), **add** between the existing `END IF;` and `RETURN NEW;`

   ```sql
     -- REQ-ORG-010 (D-ARCH-155): an invitation exists only in a BUSINESS_CUSTOMER organisation, so by the mapping above
     -- its role is a CUSTOMER role. Staff or partner onboarding by invitation needs an ADR-0005 amendment first.
     IF TG_TABLE_NAME = 'invitations' AND v_type IS DISTINCT FROM 'BUSINESS_CUSTOMER' THEN
       RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ROLE_NOT_ALLOWED_FOR_ORG_TYPE: invitations exist only in BUSINESS_CUSTOMER organisations';
     END IF;
   ```

   Both `CREATE TRIGGER` statements stay as they are.

5. After `trg_invitations__role_scope`, and before the RLS blocks, **add**

   ```sql
   -- DR-A05 / DR-A14 database backstop (code review PR #65 S1; D-ARCH-156; ADR-0005 amendment 13 item 29). A membership
   -- row makes its user's profile row readable by the organisation (p_users__org_member_read), and every session of the
   -- organisation may write this table. So a membership is created only in a transaction whose actor is the member, as
   -- ACTIVE; it never changes its user or its organisation; and it never leaves REMOVED. AFTER ROW on purpose: RLS WITH
   -- CHECK decides first, the function only raises, and no trigger runs after the standard-columns guard (C15).
   CREATE FUNCTION platform.memberships_lifecycle_guard() RETURNS trigger
   LANGUAGE plpgsql
   SET search_path = pg_catalog, pg_temp
   AS $$
   DECLARE
     v_rule text;
   BEGIN
     IF TG_OP = 'INSERT' THEN
       v_rule := CASE WHEN NEW.user_id IS DISTINCT FROM platform.app_actor_id() THEN 'the member is not the actor'
                      WHEN NEW.status  IS DISTINCT FROM 'ACTIVE'                 THEN 'a membership is created ACTIVE' END;
     ELSE
       v_rule := CASE WHEN NEW.user_id IS DISTINCT FROM OLD.user_id THEN 'user_id cannot change'
                      WHEN NEW.org_id  IS DISTINCT FROM OLD.org_id  THEN 'org_id cannot change'
                      WHEN OLD.status = 'REMOVED' AND NEW.status IS DISTINCT FROM 'REMOVED' THEN 'REMOVED is terminal' END;
     END IF;
     IF v_rule IS NOT NULL THEN
       RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = pg_catalog.format('MEMBERSHIP_LIFECYCLE_VIOLATION: %s', v_rule);
     END IF;
     RETURN NULL;
   END $$;

   CREATE TRIGGER trg_memberships__lifecycle_guard AFTER INSERT OR UPDATE OF user_id, org_id, status ON public.memberships
     FOR EACH ROW EXECUTE FUNCTION platform.memberships_lifecycle_guard();
   ```

   The `CASE` expressions are in assignments, not in an `IF` condition, so the R1-B1 parse problem does not apply (the function is created on PGlite).

6. `down.sql`: **add** `DROP FUNCTION IF EXISTS platform.memberships_lifecycle_guard();` with the other function drops. The indexes, keys and trigger go with the tables.

7. Header comment of the migration and the "not expressible in Prisma" comment of `organisations.prisma`: name the new trigger.

### 5.3 `prisma/schema/organisations.prisma`

```prisma
model Membership {
  // …
  invitation Invitation? @relation(fields: [orgId, invitationId], references: [orgId, id], onDelete: Restrict, onUpdate: Restrict, map: "fk_memberships__invitation_id")
  // …
  @@unique([orgId, id], map: "ux_memberships__org_id_id")
}

model MembershipRole {
  // …
  membership Membership @relation(fields: [orgId, membershipId], references: [orgId, id], onDelete: Restrict, onUpdate: Restrict, map: "fk_membership_roles__membership_id")
}

model Invitation {
  // …
  @@unique([orgId, id], map: "ux_invitations__org_id_id")
}
```

`orgId` is shared with the `org` relation, and the optional `invitation` relation has one required and one optional field. `prisma validate` accepts both on 7.10.

### 5.4 Tests (each as `platform_app` with the production context statement, on the migrated template)

| # | Case | Expected |
|---|---|---|
| T1 | Role row of A naming B's membership; naming an unknown id; naming A's membership | `23503 fk_membership_roles__membership_id`; `23503`; ok |
| T2 | Own membership naming B's invitation; A's invitation; none | `23503 fk_memberships__invitation_id`; ok; ok |
| T3 | Invitation in the OPERATOR organisation with an operator role; in an INDIVIDUAL organisation with `CUSTOMER_VIEWER`; in a BUSINESS_CUSTOMER organisation with `CUSTOMER_VIEWER`; operator role link on an operator membership | `P0001 ROLE_NOT_ALLOWED_FOR_ORG_TYPE`; the same; ok; ok |
| T4 | Actor A inserts an ACTIVE membership for user B, then reads B's `users` row | `P0001 MEMBERSHIP_LIFECYCLE_VIOLATION`; 0 rows |
| T5 | A user inserts the own ACTIVE membership; a fellow member reads that user's row | ok; 1 row |
| T6 | Own membership created `SUSPENDED` or `INVITED`; `user_id` re-pointed; `REMOVED → ACTIVE` | `P0001` each |
| T7 | `ACTIVE → SUSPENDED → ACTIVE → REMOVED` | ok |
| T8 | Re-parent to B as `platform_app`; the same as the superuser in origin mode | `42501` RLS; `P0001` |

- Mutant checks by hand, reported in the PR: without `trg_memberships__lifecycle_guard`, T4 becomes ok and 1 row; with the single-column key restored, the first case of T1 becomes ok; without the new `IF`, the first two cases of T3 become ok.
- `[AT-US-062-03]`, `[SEC-TC-74]` and the `world()` fixture need no change (checked against the probe).
- The generated suite and C15 need no change (section 2.5, section 4.3). C11 is not affected: the new function is not `SECURITY DEFINER`.
- The security-analyst decides whether T1, T3 and T4 carry SEC-TC ids.

### 5.5 Service (recommended, same pattern as R1-m1 (a))

`createPersonalOrganisation` and `createOrganisation` take the member's user id from the caller. They should take it from the transaction's actor, or assert equality, so that a wrong caller fails as a typed service error before the database refuses it. One unit case. Not a merge condition.

## 6. Ruling 4: `created_by` at invitation acceptance (D-ARCH-157)

- D-ARCH-123, REQ-ORG-011 and US-084 say the membership created at acceptance has `created_by` = the inviter, while the actor of the request is the accepting user.
- `platform.std_columns_guard()` (D-ARCH-091, in this migration) refuses an insert whose `created_by` is not the transaction's actor. The two statements cannot both hold. Running the acceptance as the inviter would misstate who acted and would fail rule 1 of section 4.3.
- **Ruling.** At acceptance `created_by` = the accepting user. The inviter is `invitations.created_by`, reached through `memberships.invitation_id`, which ruling 1 binds to the same organisation.
- **Wording for product-manager** (story files are tooling inputs, so the edit is scheduled by the orchestrator and is due before TASK-227 is dispatched):
  - REQ-ORG-011 note: "the membership is created as `ACTIVE` by the accepting user with `invitation_id` set; the inviter is the creator of the invitation".
  - US-084: "created_by is the inviter" becomes "invitation_id names the invitation"; "record created_by the inviter" becomes "record created_by the accepting user, the invitation's created_by the inviter".

## 7. Card lines for the next sheet fold

| Task | Line |
|---|---|
| TASK-037 `orgs` | Section 5 of this file is part of fix cycle 1 (D-ARCH-154..156). Merge condition: T1 to T8 pass in lane B and the mutant checks are reported. |
| TASK-293 `lexfu` | Adds catalog assertion C16 (data-model §4.6, §4.7) with a planted-probe test and an empty exception map. If TASK-293 is past review when this is folded, TASK-051 carries C16. |
| TASK-049 `register` | Registration runs with the new user as actor for the membership insert as well as the user insert (already the design); fixtures follow section 4.4. |
| TASK-089 `seeddemo` | Every transaction that inserts a membership has `app.actor_id` = the member: the second staff transaction and the Acme members. The seed never inserts a membership for a user under another actor. |
| TASK-224 `orgswitch` | `createOrganisation` is called with the creator as the transaction's actor. |
| TASK-227 `invite` | Service refuses a non-BUSINESS_CUSTOMER organisation with 422 `ORG_TYPE_RESTRICTION` before the database does. Acceptance runs as the accepting user; `created_by` is that user (D-ARCH-157); `invitation_id` must be an invitation of the same organisation (composite key). |
| TASK-231 `members` | LAST_OWNER and owner-cap counts may rely on `membership_roles.org_id` (composite key). A removed member is re-added as a new row; `REMOVED` is never reversed. |
| TASK-051 quotes | Rule T2 of data-model §4.7 applies to the quote tables. The guest-side binding is pre-ruled before its migration is written (section 8). |
| Every later task that adds a reference between two organisation-keyed tables | Rule T1 or T2; C16 is the gate. |

## 8. Open, not decided here

1. **Guest rows.** A GUEST_CAPABLE child with `org_id` NULL is bound to its quote by the single-column key only, so a guest row can name a quote of another owner. It stays invisible to that owner (the guest policy keys on the hash) and the claim statement does not touch it. Residual: an existence channel for quote ids, which are not secrets (P1). Whether to bind guest rows through `(guest_token_hash, quote_id)` is ruled with database-engineer before TASK-051 writes its migration. Owner principal-architect. Recorded in R-ARCH-34.
2. **`users.last_active_org_id` and `users.personal_org_id`.** A user may point the own row at any existing organisation id, and the key answers whether the id exists. Organisation ids are not secrets, and switching organisation checks an ACTIVE membership in the service (ADR-0005). Left as is.
3. **"An INDIVIDUAL organisation has exactly one member" (DR-A05).** The invitation path is now closed by ruling 2. A direct membership insert into a personal organisation by another user acting in that context is refused by the service only. Not raised by the review; left for the TASK-231 threat pass.
