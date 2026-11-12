# PR-0008 / TASK-013: change-scoped security review

| Field | Value |
|---|---|
| PR | #8 `feat(authz): typed permission catalogue, seeded roles via versioned migration, role-permission matrix and escalation guard (TASK-013, US-065, US-066)`, https://github.com/sukhchdit/shipcube/pull/8 |
| Branch / head | `feat/TASK-013-typed-permission-catalogue-seeded-roles` @ `efe23df`; merge-base `main` @ `84ac551`; 2 commits (`2db6586` catalogue + guard, `efe23df` migrations + generator); 31 files, +2,570 / −4 |
| Scope | `packages/authz/src/**` (catalogue, roles, guard, `authorise`, route check, matrix and seed renderers); `tools/authz/generate.ts`; migrations `20261112010000_authz_catalogue_tables`, `20261112010100_authz_seed_v1`; `prisma/schema/authz.prisma`; `prisma/tests/authz/authz-seed.int.test.ts`; generated `docs/03-architecture/generated/role-permission-matrix.md` |
| Security requirements in scope | REQ-RBAC-001/002/003/004/013/014, DR-A07, ADR-0008 §1–§3 + amendment, ADR-0005 (GLOBAL class), data-model §1.5/§3.3/§8.3 rules 10/12/13/14; threat model T-107, T-108, T-32/AC-05, AC-04; SEC-TC-52 (Viewer download denial, decision half); D-051; **D-058** (committed on `main` as `2e8e1f4` *after* this head) |
| Reviewer / date | security-analyst, 2026-11-12. Read-only. No install, build, Docker or test-suite run (host memory constraint, D-ORCH-010). The PR head was extracted with `git archive` into scratch. The authz sources and the linter were type-stripped with Node 24.22.3 and probed in-process |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding is open. 5 LOW, 7 INFO, each routed below. The merge rule "no Critical/High open" is met. The PR still needs its D-058 fix cycle (PR8-SEC-04) before merge, for requirement conformance; that is not a security block. |

## 1. Summary

The catalogue, the 17-role seed and the escalation guard do what REQ-RBAC-004 and DR-A07 require for the shipped catalogue.
- **Guard catches the intended escalations.** An operator-only permission on any customer or partner role fails. So does a reserved seam on anyone but Super Admin, a webhook permission on any role, a non-read grant on Viewer or the Compliance Auditor, a Viewer exfiltration grant, and an incomplete Super Admin. I confirmed each with independent positive controls (§9, probe C1–C7), on top of the PR's own tests.
- **The database seed equals the code.** I re-parsed the committed seed SQL, mapped every UUID back to its natural key and ran the guard over the database-shaped grant set. Result: 40 / 17 / 182 rows, zero violations, no customer/partner → `operator_only` link, no webhook link, and `down.sql` deletes exactly the inserted link IDs (probe E1–E8). This matters because the runtime resolves permissions from these tables (data-model §3.3), not from `ROLES`.
- **Runtime role is read-only.** `platform_app` gets `SELECT` only, and no default ACL widens it (bootstrap `01-schemas.sql` holds function REVOKEs only). The integration test proves `42501` on INSERT, UPDATE, DELETE and TRUNCATE.
- **Fail-closed decisions.** `authorise` denies by default, including an unknown permission or a route marker. `effectivePermissions` throws on an unknown role key, including `__proto__`, `constructor` and the empty string.
- **Least privilege.** Every grant is equal to or stricter than the committed requirements.

The LOW findings are all about the guard's robustness under **future** edits, not about the v1 data:
- **01:** the released seed migration can be regenerated in place. `migrate deploy` only warns and never re-applies, so existing databases would silently keep the old grants.
- **02:** the operator-only classifier is positional and trusts the declared role scope.
- **03:** linter rule 10 does not treat an upsert as data-changing.
- **04:** D-058's self-service carve-out needs guard invariants when it is applied.
- **05:** the route-level pairings that D-058, DR-A07 and the signature-only flag rely on are not enforceable yet (TASK-020).

## 2. Method

- **Diff review.** `gh pr view 8`, `gh pr diff 8`, and `git diff main...efe23df` for every file. Sinks reviewed: SQL rendering (literal escaping, identifier constants, UUID validation), generator file writes (constant paths), and the error messages of `UnknownRoleError` and `UnknownRoutePermissionError` (role and permission keys only, no data).
- **Independent probes** (scratch `…/scratchpad/review/PR-8-sec/scripts/`; Node 24 `stripTypeScriptTypes` in transform mode, because `authorise.ts` and `routes.ts` use parameter properties):
  - `probe-guard.mjs`: baseline, 7 positive controls, 4 gap probes, a scope swap, a signature-flag probe, and the runtime helpers.
  - `probe-seed.mjs`: byte equality of the 3 artefacts with the generator; parse of the committed SQL; ID back-mapping; the guard over the database-shaped set; `down.sql` coverage; the per-role matrix.
  - `probe-lint.mjs` and `probe-lint-real.mjs`: the PR-head `lint-migrations.ts` on 2 controls, 3 upsert/insert fixtures and the two real migrations.
- **Documents read.** ADR-0008 (+ amendment), ADR-0005 (classes, amendments 2, 3, 5, 7–9), data-model §1.5/§1.6/§3.2 (`memberships`, `membership_roles`)/§3.3/§4.6 C1–C5/§8.3, threat model T-32/T-34–T-37/T-107/T-108/T-109 and AC-04/AC-05, `security-test-cases.md`, WAVE-00 TASK-013/016/020/023/027/028, WAVE-08 TASK-221, US-073, REQUIREMENTS REQ-RBAC-004/013/014, REQ-ORG-004/010, REQ-ACCT-014/015 and the scope note, D-TASK013-01, and D-058 (main `2e8e1f4`).
- **External fact.** Prisma Migrate stores a checksum per applied migration. `migrate deploy` reports an edited applied migration as an advisory warning and does not re-apply it ([Prisma: migration histories](https://www.prisma.io/docs/orm/v7/prisma-migrate/understanding-prisma-migrate/migration-histories); [Prisma: development and production](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production)).
- **Secrets.** I grepped the whole added diff for password/secret/token/key/PEM/AKIA/`sk_`/connection-URL patterns: 0 hits. gitleaks (Docker) was not run because of the memory constraint. The diff contains only UUIDs, keys and descriptions.
- **Supply chain.** No new dependencies. `package-lock.json` is untouched. The root `package.json` only gains the `authz:generate` script (`tsx`, already a devDependency).

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Owner |
|---|---|---|---|---|---|
| PR8-SEC-01 | Released seed migration is regenerable in place; existing databases keep the old grants | LOW (MEDIUM at M5) | CWE-284 | A04 | senior-developer (this PR, fix cycle) + TASK-016/TASK-007 (generic rule) |
| PR8-SEC-02 | Operator-only classifier is positional; guard trusts declared scope; `signatureOnly` unconstrained | LOW | CWE-269 | A01 | senior-developer (this PR, fix cycle) |
| PR8-SEC-03 | Linter rule 10 misses `INSERT … ON CONFLICT … DO UPDATE` | LOW | CWE-693 | A04 | this PR or TASK-016; data-model text → principal-architect |
| PR8-SEC-04 | Head predates D-058; the self-service carve-out needs guard invariants when applied | LOW | CWE-613 | A07 | senior-developer (this PR, fix cycle) |
| PR8-SEC-05 | Route ↔ permission bindings (self-service, `:any_org`, signature-only, mock webhook) not yet enforceable | LOW | CWE-285 | A01 | TASK-020 (condition), TASK-027 |
| PR8-SEC-06 | Role assignment needs an explicit rank: after D-058, Owner and Admin hold identical sets | INFO | CWE-269 | A01 | TASK-231 / TASK-235 |
| PR8-SEC-07 | `effectivePermissions` unions roles without an org-type/scope check | INFO | CWE-269 | A01 | TASK-060, TASK-037 |
| PR8-SEC-08 | Database-level backstops for the authz tables | INFO | CWE-1188 | A05 | data-architect / TASK-016 (optional) |
| PR8-SEC-09 | REQ-RBAC-013 `CONFIG_CHANGE` deferral accepted, with conditions | INFO | CWE-778 | A09 | TASK-221; principal-architect (mechanism) |
| PR8-SEC-10 | GLOBAL registration routed to TASK-016/TASK-028 accepted (fail-closed) | INFO | — | — | TASK-016, TASK-028 |
| PR8-SEC-11 | Super Admin holds the reserved cross-tenant seams; `featureflag:manage` has two holders | INFO | CWE-250 | A01 | CODEOWNERS (TASK-007), TASK-219 |
| PR8-SEC-12 | D-058 follow-up: `privacy:export` in the personal organisation must not reach other organisations | INFO | CWE-639 | A01 | principal-architect; REQ-ACCT-016 task |

### PR8-SEC-01: the released seed migration is regenerable in place (LOW now, MEDIUM at M5)

**Where.** `tools/authz/generate.ts:29` (`SEED_MIGRATIONS = { 1: '…_authz_seed_v1' }`), `:56-68` (`artefacts()` always renders the *current* version into its directory), `:80-93` (`main`). Also `prisma/migrations/20261112010100_authz_seed_v1/migration.sql:9` ("Applied migrations are immutable").

**Description.**
- Change a grant in `roles.ts` without bumping `CATALOGUE_VERSION`, and `--check` fails. The developer then runs `npm run authz:generate`, which overwrites the v1 `migration.sql`/`down.sql`, and `--check` passes again.
- Nothing pins a released seed migration. No CI rule makes files under `prisma/migrations/<dir>` immutable once they are on `main`; only the bootstrap lane has `bootstrap_migrations.sha`.
- `migrate deploy` never re-applies an applied migration. On a checksum mismatch it only prints an advisory warning.

**Exploitability and impact.**
- **Fresh databases** (CI, new environments) get the new grant set, so the catalogue ⇔ database drift test passes, because it runs on a fresh database.
- **Every existing database** keeps the old set. For a **revocation** this is a silent privilege retention at runtime: data-model §3.3 resolves permissions from `role_permissions`.
- **Preconditions.** A developer edits grants without a version bump, the reviewers miss it, and a long-lived database exists.
- **Severity.**
  - Before M5, only local and ephemeral databases exist: impact M × likelihood L = **LOW**.
  - With a persistent staging or production database it is H × L = **MEDIUM**.
- This is the T-107 class, and CODEOWNERS on `packages/authz` and `prisma/migrations` is still missing (PR5-SEC-04, TASK-007).

**Remediation (code level, in the D-058 fix cycle, once v1 is regenerated for the last time).**

```ts
// tools/authz/generate.ts
interface SeedRelease { readonly dir: string; readonly sha256?: { readonly up: string; readonly down: string } }
/** A version with a pin is released: its files are immutable; a grant change bumps CATALOGUE_VERSION. */
export const SEED_MIGRATIONS: Readonly<Record<number, SeedRelease>> = {
  1: { dir: 'prisma/migrations/20261112010100_authz_seed_v1', sha256: { up: '<sha256 at merge>', down: '<sha256 at merge>' } },
};
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
export function pinnedDrift(root: string = REPO_ROOT): string[] {
  return Object.entries(SEED_MIGRATIONS).flatMap(([version, { dir, sha256: pin }]) =>
    pin === undefined ? [] : (['up', 'down'] as const)
      .filter((k) => { const f = join(root, dir, k === 'up' ? 'migration.sql' : 'down.sql'); return !existsSync(f) || sha256(f) !== pin[k]; })
      .map((k) => `${dir} (${k}) belongs to released catalogue v${version}; bump CATALOGUE_VERSION and add a new seed directory instead`));
}
// main(): with --check, report drifted() + pinnedDrift(); without --check, refuse to write into a pinned directory (exit 1).
```

- **Generic backstop (TASK-016 linter or a TASK-007 lane-A check).** For every `prisma/migrations/<dir>/` that exists on the merge base, the PR must leave `migration.sql` and `down.sql` byte-identical. One way: `git diff --name-status <base>...HEAD -- prisma/migrations` lists only `A` entries.

**Verification test.** In `tools/authz/generate.test.ts`:
1. Copy the repo artefacts to a temp root.
2. Mutate `ROLES`, by injecting roles into `renderSeedMigration` via a parameterised `artefacts(roles)`, and write the result.
3. Assert that `main(['--check'], root)` returns 1 with the "released catalogue v1" message, and that `main([], root)` refuses to overwrite.
4. Positive control: the untouched copy returns 0.

### PR8-SEC-02: the operator-only classifier is positional, and the guard trusts the declared scope (LOW)

**Where.** `packages/authz/src/permissions/index.ts:96-99` (`isOperatorOnlyKey`), `:105-109` (`permissionVerb`), `guard.ts:275-300` (`checkCatalogue`), `:302-317` (`checkRoleSet`).

**Description.** The probe results (G0–G3, §9):
- **Classifier.** `isOperatorOnlyKey` looks for `any_org` only in the third segment, and for `audit` only as the exact resource.
  - `shipment:any_org:read`, `org:any_org` and `audit_trail:read` (category `audit`) all pass `checkCatalogue` with `operatorOnly: false`.
  - With those keys, `checkRoleInvariants` reports **zero** violations when Viewer holds `shipment:any_org:read` and `audit_trail:read`, and when Shipper holds `org:any_org`. `permissionVerb('shipment:any_org:read')` is `read`, so the Viewer read-only rule also passes.
  - The AT-US-066-04 property draws from `OPERATOR_ONLY_PERMISSIONS`, which inherits the misclassification, so it would not catch these.
- **Declared scope.** Swap the `scope` of `CUSTOMER_SHIPPER` and `OPERATOR_SALES` and the per-scope counts stay 8/5/4. The renamed "Shipper", now OPERATOR, then holds `audit:read` with no violation.
- **`signatureOnly`.** `signatureOnly: true` on `payment:create` passes `checkCatalogue`. The flag is not tied to the `webhook` category. If the route layer (TASK-020) treats signature-only permissions as "authenticate by signature, skip session authz", a mis-flagged user permission would change that route's authentication model.

**Exploitability and impact.**
- **Preconditions.** A catalogue addition with a non-standard key shape, or a scope edit, that review does not catch.
- **What limits the damage.** Cross-tenant reach still needs `app.actor_scope = 'OPERATOR'`. The server sets that only for `operator-cross-tenant` routes and active OPERATOR-org members, and `t_operator` is `FOR SELECT` with `app_is_operator()` (ADR-0005 am. 2, R-08). The scope swap is also blocked at assignment by the REQ-ORG-004 trigger (TASK-037).
- **What the gap costs.** The build-time guard is the T-107/AC-04 control, and it can be steered around by naming.
- **Severity.** M × L = **LOW**.

**Remediation (code level).**

```ts
// permissions/index.ts
export function isOperatorOnlyKey(key: string): boolean {
  const segments = key.split(':');
  return segments.includes('any_org') || segments[0] === 'audit' || key === 'featureflag:manage' || key === 'carrier:status:read';
}
// guard.ts, inside the checkCatalogue loop
const segments = key.split(':');
if (segments.slice(0, 2).some((s) => SCOPE_QUALIFIERS.has(s)))
  violations.push(violation('PERMISSION_FORMAT', `"${key}" uses a scope qualifier outside the third segment`, undefined, key));
if ((category === 'audit') !== key.startsWith('audit:'))
  violations.push(violation('PERMISSION_CATEGORY_MISMATCH', `"${key}": category audit <=> resource audit`, undefined, key));
if ((signatureOnly === true) !== (category === 'webhook' && key.startsWith('webhook:')))
  violations.push(violation('SIGNATURE_FLAG_MISMATCH', `"${key}": signature-only <=> webhook:*`, undefined, key));
// guard.ts, checkRoleSet
for (const role of roles)
  if (!role.key.startsWith(`${role.scope}_`)) violations.push(violation('ROLE_SCOPE_MISMATCH', `role ${role.key} declares scope ${role.scope}`, role.key));
```

Add the three new codes to `ViolationCode`. `checkCatalogue` also has to destructure `signatureOnly`.

**Verification tests.** Add the probe inputs as unit fixtures. Each must yield the named violation:
- `shipment:any_org:read`, `org:any_org`, `audit_trail:read` (category `audit`), and `signatureOnly` on `payment:create`;
- the Shipper/Sales scope swap.

Positive control: the shipped catalogue and roles stay `[]`.

### PR8-SEC-03: linter rule 10 misses upserts (LOW)

**Where.** `tools/db/lint-migrations.ts:125-132` (`DATA_CHANGING`; the code is TASK-003's, the pattern is this PR's). data-model §8.3 rule 10.

**Description.** With `data-changing: no`, the PR-head linter reports nothing (`rules=[]`) for either of these upserts:
- `INSERT INTO "public"."permissions" (…) VALUES (…) ON CONFLICT ("key") DO UPDATE SET "operator_only" = EXCLUDED."operator_only";`
- the same form rewriting `roles.scope`.

Its controls are flagged correctly: `UPDATE` → `["10"]` and `INSERT … SELECT` → `["10"]`. The rule's patterns require `SELECT`, or a leading `UPDATE`/`DELETE`/`MERGE`/`WITH`.

**Exploitability and impact.**
- D-T013-08 makes "seed by versioned migration" the pattern for every later catalogue version. An upsert is the natural way to change a description, a flag or a scope in place.
- Such a migration rewrites existing rows, so it is data-changing. Yet it would skip the §8.6 backup and restore guardrail (CLAUDE.md §5).
- Its row rewrites would also not stand out as data changes in review.
- **Severity.** Impact M (a guardrail is bypassed) × likelihood L = **LOW**.

**Remediation.**
- Add the pattern `/^insert\s+into\b.*\bon\s+conflict\b.*\bdo\s+update\b/` to `DATA_CHANGING`.
- Add a negative fixture: `tools/db/fixtures/lint/migrations/upsert/<ts>_upsert/{migration.sql,down.sql}` with `data-changing: no`.
- data-model §8.3 rule 10 should read "`UPDATE`/`DELETE`/`INSERT … SELECT`/`INSERT … ON CONFLICT … DO UPDATE`/`MERGE`". That text is for principal-architect/data-architect.

**Verification test.** The linter test asserts that the fixture yields rule `10`. `ON CONFLICT DO NOTHING` (this PR's seed) stays clean.

### PR8-SEC-04: the head predates D-058, and the self-service carve-out needs guard invariants (LOW)

**Where.**
- `roles.ts:121-126` (Compliance Auditor) and `:165-181` (Viewer);
- `guard.ts:340-350` (the Auditor and Viewer checks), `:260` (`VIEWER_FORBIDDEN`);
- `permissions/types.ts:30-41` (no `selfService` flag).

**Description.**
- D-058 (main `2e8e1f4`, landed after `efe23df`) makes REQ-RBAC-004 v1.5 and US-066 require the self-service set `session:manage`, `notification_pref:manage` and `notification:read` on **all 17 roles**.
- At this head, the Viewer lacks `session:manage` and `notification_pref:manage`, and the Compliance Auditor lacks both too.
- While such a membership is active, its holder cannot list or revoke their own sessions: REQ-AUTH-021/022 Must, ASVS 4.0.3 V3.3.4.
- The other D-058 deltas (Finance + `order:read`, + `notification_pref:manage`; Admin + `privacy:delete`) are functional.

From the security side, I **accept** D-058's carve-out. It widens nothing beyond the caller's own rows, provided the conditions below and PR8-SEC-05 (a) hold. This answers D-058's request that security-analyst re-check the Viewer and Compliance Auditor rows.

**Severity.** M × L = **LOW**. The current grants are *stricter*. The gap is availability of a security control, and every user can work around it through their personal organisation.

**Security conditions for the fix cycle (verified in R2).**
1. **The flag is set by a constant.** Add `selfService?: boolean` to `PermissionDefinition` and `export const SELF_SERVICE_PERMISSIONS = ['session:manage', 'notification_pref:manage', 'notification:read'] as const`.
   - `checkCatalogue` rejects a catalogue whose flagged set differs from that constant.
   - It also rejects a `selfService` entry that is `operatorOnly`, `reserved` or `signatureOnly`, or whose category is not `session`/`notification`.
   - Without this, flagging any org-data permission `selfService` would silently carve it out of the Viewer and Auditor invariants.
2. **Carve-out by flag only.** The Viewer and Auditor checks skip a permission only when `definition.selfService === true`. The verb rule stays literal (D-058 (c)).
3. **Explicit Viewer exclusion.** `VIEWER_FORBIDDEN` gains `privacy:delete`, matching the explicit naming in D-058 and A-074. Today it is caught only indirectly, as `VIEWER_NOT_READ_ONLY`.
4. **Positive invariant.** Every role holds every `SELF_SERVICE_PERMISSIONS` entry, else `SELF_SERVICE_MISSING`, naming the role and the permission. This covers the D-058 scenario outline.
5. **Regenerate before pinning.** Regenerate v1 (still unmerged, so editing it is allowed), then pin it (PR8-SEC-01).

**Verification tests.** The US-066 D-058 scenario outline, plus mutation tests:
- `selfService: true` on `document:download` gives a catalogue violation, **not** a Viewer pass;
- removing `session:manage` from the Viewer gives `SELF_SERVICE_MISSING`.

### PR8-SEC-05: route ↔ permission bindings are not yet enforceable (LOW; condition on TASK-020)

**Where.** `packages/authz/src/routes.ts:44-69`. `DeclaredRoute` is `{ method, path, permission }`. TASK-020 calls `assertRoutePermissions`.

**Description.** Four security arguments in the catalogue are only true at the route layer, and nothing yet asserts them:
- (a) D-058 says self-service permissions are safe because they guard **only** `user`-tenancy routes. A `session:manage` route with `org` tenancy would hand Viewer write access to org-scoped rows.
- (b) DR-A07 and ADR-0005: operator cross-tenant reach must pair `tenancy: 'operator-cross-tenant'` with an operator-only permission, and an `:any_org` permission with that tenancy.
- (c) Signature-only permissions must be satisfied by a signature-authenticated route (raw-body verifier), never by `public` or a session.
- (d) `webhook:mock_gateway:receive` must not be mounted when `APP_ENV=production` (T-67 class: a known mock secret would confirm payments).

**Severity.** No route exists yet, so likelihood is L. Impact M–H. Overall **LOW**, made binding as a TASK-020 merge condition.

**Remediation (in TASK-020, implemented in `packages/authz` so it stays pure and covered).**

```ts
export interface DeclaredRoute {
  readonly method: string; readonly path: string; readonly permission: string;
  readonly tenancy: 'org' | 'user' | 'operator-cross-tenant' | 'none';
  readonly auth: 'session' | 'signature' | 'anonymous';
}
export function findRouteBindingViolations(routes: readonly DeclaredRoute[], env: { production: boolean }): string[] {
  // selfService permission      => tenancy === 'user'
  // tenancy operator-cross-tenant => operatorOnly permission;  :any_org permission => tenancy operator-cross-tenant
  // signatureOnly permission    <=> auth === 'signature' (and permission is never a route marker)
  // env.production              => no route with permission 'webhook:mock_gateway:receive'
}
```

**Verification.** TASK-020's route-registry test runs this over the mounted routes, with one negative fixture per rule. TASK-027's matrix asserts 404 on a foreign session ID for every role (the D-058 scenario).

### PR8-SEC-06 to PR8-SEC-12 (INFO)

**PR8-SEC-06: role assignment needs an explicit rank (TASK-231/TASK-235; AC-05, REQ-ORG-010, REQ-ACCT-015).**
- After D-058, `CUSTOMER_OWNER` and `CUSTOMER_ADMIN` hold **identical** sets: 30 = 30.
- So the classic "grant only roles whose permissions ⊆ the actor's own" rule cannot stop an Admin from assigning Owner. REQ-ORG-010 ("Owner only by an Owner") and threat-model AC-05 ("org Admin: assign Owner; change own role; modify an Owner → 403/422") both require that stop.
- Before D-058 the subset rule failed in the opposite direction: Shipper held `privacy:delete`, which Admin lacked.
- **Recommendation.** Add a pure, tested table in `packages/authz`, for example `ASSIGNABLE_BY: Record<RoleKey, readonly RoleKey[]>` with `CUSTOMER_OWNER: ['CUSTOMER_OWNER']` and `CUSTOMER_ADMIN | SHIPPER | FINANCE | VIEWER: ['CUSTOMER_OWNER', 'CUSTOMER_ADMIN']`.
  - Use the same table for "may modify or remove a member holding role R".
  - Self role change and last-Owner protection stay as REQ-ACCT-015 and REQ-ORG-013.
  - Partner and operator roles get empty lists in this run.

**PR8-SEC-07: `effectivePermissions` mixes scopes (TASK-060, TASK-037).**
- `effectivePermissions(['CUSTOMER_VIEWER', 'OPERATOR_COMPLIANCE_AUDITOR'])` returns `audit:read` and `carrier:status:read` (probe R1).
- The function is documented as a pure union. The runtime path (data-model §3.3, ADR-0008 §4) is a database query.
- **Requirements on that query:** join `organisations.type` and keep only roles whose `scope` matches the type mapping, an `ACTIVE` membership in the token's org, and `revoked_at IS NULL`. This is in addition to the REQ-ORG-004 trigger `trg_membership_roles__scope_matches_org` (TASK-037).
- **If code keeps using the helper:** add an `expectedScope` parameter that throws `RoleScopeMismatchError`.

**PR8-SEC-08: database-level backstops (optional now; needed before the M2 role editor adds runtime writes).**
- (a) `operator_only BOOLEAN NOT NULL DEFAULT false` is fail-open for a hand-written insert. Add `ck_permissions__operator_only_rule CHECK (operator_only = (key ~ '(^|:)any_org(:|$)' OR key LIKE 'audit:%' OR key IN ('featureflag:manage','carrier:status:read')))`.
- (b) `ON CONFLICT DO NOTHING` has no target. It also swallows a `ux_*__key` collision with a foreign ID: a pre-existing tampered row would be kept silently. Today the role-permission insert would still fail closed on its FK.
  - Render `ON CONFLICT ("id") DO NOTHING` instead, so a key collision raises.
  - AT-US-066-01's re-run stays a no-op, because the IDs are deterministic.
- (c) A database-side assertion, in the integration test now and a C-series catalog test later: no `roles.scope <> 'OPERATOR'` row links to an `operator_only` permission, and no row links to a `webhook:*` permission. It is evaluated on the database, independent of the code-equality test.
- (d) `ck_permissions__key_format` admits `public`/`authenticated`. That mirrors data-model §3.3 and is harmless while route markers are handled before `authorise` (fail closed, R3).

**PR8-SEC-09: the REQ-RBAC-013 `CONFIG_CHANGE` deferral to TASK-221 (US-073, Wave 8, Should, cuttable) is accepted. The audit store does not exist in Wave 0. Conditions:**
1. TASK-221 writes the v1 baseline, and any version applied before it, as the first `CONFIG_CHANGE` (old set ∅ → v1). Otherwise the initial grant set has no audit record.
2. The mechanism cannot be a migration `INSERT` into `audit_entries`: that would break the hash chain and violate the rule-12 lane and ownership model. It should be a post-migrate reconciler run as `SYSTEM_JOB` that compares a digest of the three tables with the last audited digest. That also gives AT-US-073-04 (no-op re-run writes nothing) by construction. principal-architect to fix the mechanism.
3. If TASK-221 is cut, T-107's residual controls are this guard and CODEOWNERS. CODEOWNERS is still unowned (PR5-SEC-04, TASK-007). Record it in the G3 residual-risk list.

**PR8-SEC-10: GLOBAL-table registration routed to TASK-016/TASK-028 is accepted. All three checks are fail-closed:**
- **C1** fails for any non-allow-listed `public` table without forced RLS.
- **C5 (amended)** requires `platform_app` privileges to equal the grant manifest, with no default table ACL. The `SELECT`-only grant therefore has to be in `prisma/sql/grants.manifest`.
- **TASK-028's** completeness check over `prisma/schema` covers the new columns.

Classes: I agree with the PR's suggestion. Every column is INT, except `permissions.description`/`category` and `roles.name_key`/`description`, which are PUB. Add these three tables to the TASK-016 and TASK-028 inputs explicitly, so that C1 is satisfied by the GLOBAL allow-list entry, not by enabling RLS without policies.

**PR8-SEC-11: Super Admin and the reserved seams.**
- Super Admin holds `shipment:read:any_org`, `org:read:any_org`, `shipment:create:on_behalf`, `refund:approve` and `audit:export` now. This is consistent with ADR-0008 §3 and REQ-RBAC-004.
- The reach is still gated by the route tenancy and `app_is_operator()` (ADR-0005 am. 2).
- Activating a seam (removing `reserved`) is a security-relevant change. Route it through CODEOWNERS (TASK-007).
- D-T013-04 (confirmed by D-058) makes `OPERATOR_ADMIN` a second holder of `featureflag:manage`. T-109's mitigation ("no flag gates a security control" registry rule) must ship with the feature-flag routes (TASK-219).

**PR8-SEC-12: D-058 follow-up, endorsed.**
- If a Viewer of organisation B switches to their personal organisation (Owner, `privacy:export`), the export must contain no rows of B. Otherwise the D-051 Viewer exclusion is bypassed through the org switch.
- **Test (REQ-ACCT-016 task):** a user who is Viewer in B and Owner of a personal org P exports in P, and the export contains zero shipment, quote or address rows with `org_id = B`.
- principal-architect to confirm in the export design that RLS scopes the export to the active org and that it uses no definer path.

## 4. Reviewer-focus items: rulings

| Focus item | Ruling |
|---|---|
| Privilege-escalation guard | **Sound for the shipped catalogue.** Every REQ-RBAC-004 and DR-A07 invariant is checked, names the role and the permission, and is exercised by the PR's tests: AT-US-066-03/04/05 tables plus two fast-check properties. My positive controls C1–C7 and the database-shaped re-check E4/E6/E7 agree. Robustness gaps under future edits are PR8-SEC-02. |
| "Grant only held permissions" | Not in this PR's scope: there is no assignment-time API yet. The static matrix makes a pure subset rule unworkable for AC-05, so the design input is PR8-SEC-06 (TASK-231/235). |
| Operator vs customer vs partner separation | Enforced statically by the `operatorOnly` flag, which the catalogue guard forces to equal the DR-A07 rule, by `RESERVED_HELD`, and by the per-scope role counts. Partner roles hold `org:*` plus own-account only. `ASSIGNABLE_CUSTOMER_ROLES` excludes partner roles (AT-US-066-07). At runtime, separation comes from the REQ-ORG-004 trigger (TASK-037) and active-org resolution (PR8-SEC-07). |
| Super Admin | 38 permissions = every role-assignable permission, including the reserved seams. The "role-assignable" reading (D-T013-02) is now the requirement text (REQ-RBAC-004 v1.5, D-058). The ADR-0008 §2/§3 wording is still owed by principal-architect. |
| Signature-only webhook permissions held by no role | **Sound.** No role holds them (database view E7), so no session can satisfy them through `authorise`. The webhook route must authenticate by signature (PR8-SEC-05 (c)). The flag must be bound to the `webhook` category (PR8-SEC-02). The mock route must be absent in production (PR8-SEC-05 (d)). |
| Reserved `*:any_org` seams | Operator-only by rule and flag, and reserved, so held by Super Admin only. A customer or partner holding one trips both `OPERATOR_ONLY_ESCALATION` and `RESERVED_HELD` (C2). Tests: AT-US-066-04 rows for `shipment:read:any_org` and `org:read:any_org`, plus the property over every customer/partner role × every operator-only permission. Enforced by guard **and** test: **yes.** Only a non-standard key placement escapes (PR8-SEC-02). |
| Least privilege of each role | §5. Every grant is equal to or narrower than the committed requirements. D-058's widening (self-service on all roles, Finance `order:read`, Admin `privacy:delete`) is accepted from the security side under the PR8-SEC-04 and -05 conditions. |
| Seed migration `data-changing: no` | **ACCEPTED.** Rule 10 targets `UPDATE`/`DELETE`/`INSERT … SELECT` on existing tables. This file is plain `INSERT … VALUES` into three tables created, empty, by the immediately preceding migration of the same release. The PR-head linter reports no finding (`probe-lint-real`). The guardrail's purpose is to protect existing data from loss. Here no existing row is read, changed or deleted, `down.sql` removes exactly the inserted IDs (E8), and the up→down→up test covers it. **Limits of this ruling:** a later seed that revokes grants (`DELETE`) or rewrites rows (upsert, see PR8-SEC-03) is `data-changing: yes` and takes the backup and restore guardrail. A plain additive `INSERT … VALUES` into the now-populated tables stays `no`. |
| Migration privileges (rules 12/14) | Runs as `platform_migrator` through the pinned CLI. The tables are migrator-owned, which is allowed: "the migrator owns every non-audit table". There is no audit DDL (rule 12 clean). There is no `CREATE SCHEMA`/`EXTENSION`/`ALTER DATABASE`/role DDL, `SECURITY DEFINER`, `search_path`, `OWNER TO` or `SET ROLE` (grep: 0). The only grant is `SELECT` → `platform_app`; nothing goes to `PUBLIC`, `platform_definer` or `platform_erasure`. Rule 11 does not apply: no existing table is altered. |
| GLOBAL tables: RLS class, grants, classification | GLOBAL per data-model §1.5 ("Everyone (SELECT); writes only where listed in §4.4"; none listed for authz). `relrowsecurity = false` and SELECT-only are asserted by the integration test. Routing the registry and manifest entries to TASK-016/TASK-028 is **acceptable**, because both checks fail closed (PR8-SEC-10). |
| `authorise` deny-by-default; unknown permission | **Deny-by-default confirmed:** an empty set, an unknown permission and a route marker each give `AUTHZ_DENIED` (R3). An unknown role key throws, prototype keys included (R2). The route check rejects case variants, prototype names and trailing spaces (R4). |
| REQ-RBAC-013 `CONFIG_CHANGE` deferral | **Accepted**, with the PR8-SEC-09 conditions (baseline back-fill, reconciler mechanism, G3 note if cut). |

## 5. Role-by-role least-privilege check (head `efe23df`, database view; D-058 delta)

| Role | Count | Notes | D-058 change (fix cycle) | Security view |
|---|---|---|---|---|
| OPERATOR_SUPER_ADMIN | 38 | Every role-assignable permission, including the reserved seams | none | Per REQ-RBAC-004. Seams inert until routes exist (PR8-SEC-11) |
| OPERATOR_ADMIN | 6 | own-account, `org:read`, `featureflag:manage`, `carrier:status:read` | none (confirmed) | OK. T-109 rule owed by TASK-219 |
| OPERATOR_OPERATIONS / SUPPORT | 4 | own-account, `carrier:status:read` | none | OK (ADR-0008 am.) |
| OPERATOR_FINANCE / SALES / CONTENT_MANAGER | 3 | own-account only | none | OK (minimal) |
| OPERATOR_COMPLIANCE_AUDITOR | 3 | `audit:read`, `carrier:status:read`, `notification:read` | + `session:manage`, `notification_pref:manage` | Read-only plus own rows. Accepted (PR8-SEC-04) |
| CUSTOMER_OWNER | 30 | every customer-grantable permission | none | OK |
| CUSTOMER_ADMIN | 29 | Owner − `privacy:delete` | + `privacy:delete` (= Owner) | Own-account right. Creates the rank need (PR8-SEC-06) |
| CUSTOMER_SHIPPER | 25 | no `org:update`/`invite`/`manage`, `payment_method:manage`, `payment:read` | none (confirmed) | Narrower than the scope note. OK |
| CUSTOMER_FINANCE | 6 | `payment:read`, `shipment:read`, `document:read`, `document:download`, `session:manage`, `notification:read` | + `order:read`, `notification_pref:manage` | OK. `document:download` covers SENSITIVE invoices with a DOWNLOAD audit (REQ-DOC-007) |
| CUSTOMER_VIEWER | 9 | 8 reads + `notification:read`; no `payment:read`, download, e-mail, export or delete | + `session:manage`, `notification_pref:manage` | Accepted, with the flag-bound carve-out and user-tenancy routes only (PR8-SEC-04/05) |
| PARTNER_OWNER | 7 | `org:*` + own-account | none | Data only; never assignable |
| PARTNER_DEVELOPER / OPERATIONS / FINANCE | 4 | `org:read` + own-account | none | Data only |

## 6. Threat and SEC-TC coverage: claimed vs verified

| Item | Claimed | Verified |
|---|---|---|
| AC-04 / T-107: a seed edit grants `audit:read` to a customer role | AT-US-066-04 | Yes: table row (Admin) + property (Viewer included); probe C1. CODEOWNERS half still open (PR5-SEC-04 → TASK-007) |
| T-108: a migration grants beyond SELECT to `platform_app` | integration test | Yes: `42501` on INSERT/UPDATE/DELETE/TRUNCATE. C5 manifest pending (TASK-016) |
| SEC-TC-52 (decision half): Viewer denied `document:download` | AT-US-066-06 | Yes, unit `authorise`. HTTP 403 + `PERMISSION_DENIED` → TASK-027/033 |
| AT-US-065-05: no `/permissions` or `/roles` API | contract scan | Yes (contract). Registry 404 → TASK-020 |
| AC-05 / T-32: role-change escalation | — | Out of scope. Design input PR8-SEC-06 |
| Catalogue ⇔ database drift | integration test | Yes, on fresh databases. In-place edits on existing databases are not covered (PR8-SEC-01) |

## 7. Follow-ups routed to named tasks

| Item | Owner | Due |
|---|---|---|
| PR8-SEC-01 pin of released seed versions + `--check` refusal; PR8-SEC-02 classifier, scope-prefix and signature-flag invariants; PR8-SEC-04 conditions 1–5 | senior-developer (PR #8 fix cycle, together with D-058) | before merge (recommended); otherwise before the first catalogue change |
| PR8-SEC-03 rule-10 upsert pattern + fixture | PR #8 fix cycle or TASK-016 | TASK-016 merge |
| PR8-SEC-01 generic migration-immutability check | TASK-016 (linter) or TASK-007 (lane A) | before M5; recommended in Wave 0 |
| PR8-SEC-05 route-binding check (a)–(d) | TASK-020 (**merge condition**), TASK-027 | TASK-020 merge |
| PR8-SEC-06 `ASSIGNABLE_BY` rank table | TASK-231 / TASK-235 | with AC-05 tests |
| PR8-SEC-07 scope-filtered effective-permission query | TASK-060; trigger in TASK-037 | TASK-060 merge |
| PR8-SEC-08 database backstops | data-architect / TASK-016 | before the M2 role editor (optional now) |
| PR8-SEC-09 baseline `CONFIG_CHANGE` back-fill + reconciler mechanism | principal-architect; TASK-221 | TASK-221; G3 note if cut |
| PR8-SEC-10 three GLOBAL tables in the C1 allow-list, the grant manifest and the classification registry | TASK-016, TASK-028 | their merge |
| PR8-SEC-11 seam activation under CODEOWNERS; T-109 registry rule | TASK-007; TASK-219 | — |
| PR8-SEC-12 export scoped to the active org | principal-architect; REQ-ACCT-016 task | that task's merge |
| D-T013-02 wording in ADR-0008 §2/§3 (Super Admin "role-assignable"); data-model §3.3/§9.2 seeding by migration (D-T013-08); §8.3 rule 10 upsert text | principal-architect / data-architect | next ADR/data-model revision |

## 8. Proposed decision text (for the orchestrator to log; security-analyst does not edit ADRs)

- **D-SEC-PR8-01 (seed migrations and the backup guardrail).** A generated authz seed migration that only runs `INSERT … VALUES … ON CONFLICT ("id") DO NOTHING` of new rows is `data-changing: no`, whether or not the target tables already hold rows. A seed that deletes or rewrites rows (`DELETE`, `UPDATE`, `INSERT … ON CONFLICT DO UPDATE`, `MERGE`) is `data-changing: yes` and takes the §8.6 backup and restore guardrail. Reversibility: high.
- **D-SEC-PR8-02 (released seed versions are immutable).** Once a `CATALOGUE_VERSION` is merged, its seed directory is pinned by SHA-256 in `tools/authz/generate.ts`. A grant change bumps the version and adds a new directory, and the generator refuses to rewrite a pinned directory. Reason: `prisma migrate deploy` never re-applies an edited migration (advisory warning only), so editing a released file diverges every existing database from the code. Reversibility: high.

## 9. Evidence (PR head `efe23df`, 2026-11-12)

| Command / probe | Result |
|---|---|
| `gh pr view 8 --json …`; `git fetch origin feat/TASK-013-…`; `git merge-base efe23df main` | head `efe23df`, base `84ac551`, 31 files, +2,570/−4, state OPEN |
| `git log 84ac551..main` | `main` gained `2e8e1f4` (D-058, REQUIREMENTS 1.5) after the head, so the PR needs a merge-main and regeneration in the fix cycle |
| `probe-guard.mjs` P0 | `checkCatalogue` = `[]`, `checkRoleInvariants` = `[]`; 40 permissions / 17 roles / 182 links |
| `probe-guard.mjs` C1–C7 (positive controls) | Viewer+`audit:read` → `OPERATOR_ONLY_ESCALATION`; Owner+`shipment:read:any_org` → `RESERVED_HELD` + `OPERATOR_ONLY_ESCALATION`; PartnerDev+`featureflag:manage` → `OPERATOR_ONLY_ESCALATION`; SuperAdmin+webhook → `SIGNATURE_PERMISSION_HELD`; Auditor+`featureflag:manage` → `AUDITOR_NOT_READ_ONLY`; Support+`refund:approve` → `RESERVED_HELD`; `org:read:any_org` flag false → `PERMISSION_OPERATOR_ONLY_MISMATCH` |
| `probe-guard.mjs` G0–G3 (gaps) | catalogue with `shipment:any_org:read`, `org:any_org`, `audit_trail:read`, `payment:read:on_behalf` → `[]`; Viewer/Shipper holding them → `[]`; Shipper↔Sales scope swap + `audit:read` → `[]`; `signatureOnly` on `payment:create` → `[]` |
| `probe-guard.mjs` R1–R4 | union Viewer+Auditor contains `audit:read`, `carrier:status:read`; `__proto__`/`constructor`/`toString`/`""` → `UnknownRoleError`; unknown permission, marker and empty set → `AUTHZ_DENIED`; route check flags `PUBLIC`, `toString`, `"shipment:read "` |
| `probe-seed.mjs` E1–E8 | matrix doc, `migration.sql`, `down.sql` byte-EQUAL to the generator; parsed 40/17/182; every ID = `seedId(key)`; guard over the database-shaped catalogue and grants `[]`; 0 dangling links; 0 non-operator → `operator_only` links; 0 webhook links; down link IDs = up link IDs |
| `probe-lint.mjs` (PR-head linter) | controls `UPDATE` → `["10"]`, `INSERT … SELECT` → `["10"]`; `INSERT … DO NOTHING` → `[]`; upsert `operator_only` → `[]`; upsert `scope` → `[]` |
| `probe-lint-real.mjs` | both PR migrations → `[]` |
| grep of both migrations for definer/search_path/schema/extension/database/owner/role/audit/bypassrls | 0; the only `GRANT` is SELECT → `platform_app` |
| grep of `prisma/bootstrap/0[01]-*.sql` for default privileges | function `REVOKE … FROM PUBLIC` rows only; no default table grants |
| Secret-pattern grep over the added diff | 0 hits |
| Not run (host constraint) | `npm ci`, build, unit/integration suites, gitleaks. Evidence for those is the PR body (senior-developer, D-ORCH-004): unit 346/346, targeted integration 7/7, lint/typecheck/format/build/audit green. The full `test:integration` and `test:coverage` are still to re-run (lane B) |

## Round 2 (head 498e3a5)

| Field | Value |
|---|---|
| Head | `498e3a5`. It is a merge of `origin/main` @ `151add9` into `6e70275`, the fix commit. `5891c0a` is an earlier merge of `main`, bringing in D-058 |
| Code delta | `6e70275`: 27 files, +991 / −235 (`packages/authz/src/**`, `tools/authz/generate{,.test}.ts`, `tools/db/lint-migrations{,.test}.ts`, 2 linter fixtures, seed v1 `migration.sql`/`down.sql`, `prisma/tests/authz/authz-seed.int.test.ts`, matrix doc) |
| Merge integrity | `git diff 6e70275 498e3a5` on code paths is empty. `package-lock.json` is byte-equal to `main`. Root `package.json` differs from `main` only by the R1 `authz:generate` script. No new dependency |
| Main drift | `origin/main` is now `cb69b04`. `b0741da`, `e1c3d42` and `cb69b04` are docs only (D-059, fix-cycle decisions). D-059 changes no authz grant; its item 6 confirms that DR-A07 is unchanged. No security need to re-merge |
| Inputs | Fix comment (issuecomment-6829047310); DECISIONS D-058, D-SEC-PR8-01, D-ARCH-059/060, D-ORCH-011, D-TASK013-02 |
| Method | Read-only. Nothing was run in the TASK-013 worktree. No install, build, Docker or suite run. Steps: `git archive 498e3a5` into scratch; type-strip with Node 24.22.3; probe in-process. R1's probes were re-run against the new head: the 7 escalation edits C1–C7 and the 3 gap cases G1–G3 (G0–G3 in R1's numbering). New probes: self-service (S), canAssignRole (A), pin bypass (P) and linter variants (L). Scripts are in `…/scratchpad/review/PR-8-sec-r2/scripts/` |
| Reviewer / date | security-analyst, 2026-11-12 |
| **Verdict** | **PASS_WITH_FOLLOW-UPS. No Critical or High is open, so merge is allowed on security grounds.** Closed: PR8-SEC-01 (the in-PR part), -02, -03, -04, -06 (the table; consumer conditions go to TASK-231/235), -08 (b) and (c). New: PR8-SEC-13 (LOW) and PR8-SEC-14 (INFO). Still routed: 05, 07, 08 (a), 09–12 |

### R2.1 Closure of round-1 findings

| ID | R2 status | Evidence (head `498e3a5`) |
|---|---|---|
| PR8-SEC-01 | **CLOSED (in-PR part).** The generic backstop is now PR8-SEC-13 | `SEED_MIGRATIONS[1].sha256` = `dbe3e807…290a` / `096b273a…2764`. I checked the pins against the **git blob bytes**: they match, and the blobs contain no CR, so `* text=auto eol=lf` makes them platform-stable. `checkMessages(archive) = []`. An in-place edit that revokes a grant or widens one: `--check` = 1, write = 1, nothing written, message "catalogue changed … Bump CATALOGUE_VERSION" (P1). `artefacts()` throws for version > 1. The pin is a tripwire against regeneration, not a lock: see PR8-SEC-13 |
| PR8-SEC-02 | **CLOSED** | Gap case G0/G1 (shipment:any_org:read, org:any_org): `PERMISSION_FORMAT` + `PERMISSION_OPERATOR_ONLY_MISMATCH`. `audit_trail:read` (category audit): `PERMISSION_CATEGORY_MISMATCH`. With the flag set to the rule, Viewer/Shipper holding the any_org keys give `OPERATOR_ONLY_ESCALATION` (G1b). The scope swap (G2) gives `ROLE_SCOPE_MISMATCH` ×2. signatureOnly on `payment:create` (G3) gives `SIGNATURE_FLAG_MISMATCH`, and so do the flag dropped from `webhook:stripe:receive` (G3b) and a `webhook:*` key filed under payment (G3c). `isOperatorOnlyKey` is true for `any_org` in segments 1, 2 and 3 (O1). The cross-tenant synonym `shipment:read:all_orgs` is rejected by the n5 verb/qualifier rule (O2) |
| PR8-SEC-03 | **CLOSED** | The `DATA_CHANGING` list has the pattern `^insert into … on conflict … do update`. Its scope: 11 upsert forms give `["10"]` (L): R1's two cases, multi-line lower-case, `ON CONSTRAINT`, alias + `WHERE`, block comment, line comment, CTE and `DEFAULT VALUES`, plus the controls `UPDATE` and `INSERT … SELECT`. Clean (`[]`): with `data-changing: yes`; for `DO NOTHING` with or without a target; for the phrase inside a string literal or a trailing comment. The PR's fixtures give `["10"]` / `[]`, and both real migrations give `[]` |
| PR8-SEC-04 | **CLOSED** (conditions 1–5) | See R2.2 |
| PR8-SEC-05 | OPEN, routed | TASK-020 merge condition (D-ORCH-011). Not in the TASK-020 task file yet, see R2.5 |
| PR8-SEC-06 | **CLOSED (rank table).** Consumer conditions are in R2.3 | `ASSIGNABLE_BY` and `canAssignRole` are in `packages/authz/src/assign.ts`. Single-role matrix (A1): Owner → {Owner, Admin, Shipper, Finance, Viewer}; Admin → {Admin, Shipper, Finance, Viewer}; nobody else assigns anything. Admin → Owner is false, also for Admin+Viewer (A2). Super Admin → nothing (fail closed). Prototype, empty, whitespace and lower-case keys are false on both sides (A4) |
| PR8-SEC-07 | OPEN, routed | TASK-060 (D-ORCH-011). `effectivePermissions` now requires `roles`; omitting them throws (R1) |
| PR8-SEC-08 | **(b), (c) CLOSED.** (a) and (d) are unchanged and optional | (b): all 3 statements render `ON CONFLICT ("id") DO NOTHING`. `id` is the primary key, and `ux_permissions__key`, `ux_roles__key` and `ux_role_permissions__role_permission` are separate unique indexes. A natural-key collision under a foreign ID therefore raises `23505` instead of being kept. (c): the integration test asserts that no `scope <> 'OPERATOR'` role links an `operator_only` permission and that no role links `webhook:%`. For hardening, see PR8-SEC-14 |
| PR8-SEC-09 | OPEN, routed | TASK-221 (WAVE-08.md:112 carries it) |
| PR8-SEC-10 | OPEN, routed | TASK-016/028 |
| PR8-SEC-11 | OPEN, routed | TASK-007 (CODEOWNERS), TASK-219. CODEOWNERS is still in no task's acceptance list (PR5-SEC-04), see R2.5 |
| PR8-SEC-12 | OPEN, routed | D-ARCH-059 item 3 confirms the design: the export is RLS-bound to the active org and `app_actor_id()`. The test is owed by the REQ-ACCT-016 task |

### R2.2 PR8-SEC-04 conditions (D-058 carve-out)

| # | Condition | Result |
|---|---|---|
| 1 | The flag is bound to the constant | **Met.** `SELF_SERVICE_PERMISSIONS` = `['session:manage', 'notification_pref:manage', 'notification:read']`, `as const satisfies readonly Permission[]`, and the test pins it literally. `selfService?: true` sits on exactly those 3 entries (S0): categories session/notification, none operator-only, reserved or signature-only. `checkCatalogue` gives `SELF_SERVICE_FLAG_MISMATCH` in both directions (S1c, S1d) and when the key is missing from the catalogue. It gives `SELF_SERVICE_INVALID` for operator-only, reserved or signature-only entries and for a category outside `{session, notification}` (S1e–S1h). `checkRoleInvariants` now runs `checkCatalogue`, so a role check can no longer trust a forged flag |
| 2 | The carve-out is by flag only | **Met.** `readOnlyViolations` exempts only `definition.selfService === true`. A truthy non-`true` flag gives no exemption: `selfService: 1` on `address_book:manage` + Viewer → `VIEWER_NOT_READ_ONLY`, and `"true"` on `privacy:export` + Auditor → `AUDITOR_NOT_READ_ONLY` (S2, S2b). The verb rule stays literal. `VIEWER_EXFILTRATION` is never exempt: `selfService` on `document:download` gives all three codes, FLAG_MISMATCH, INVALID and EXFILTRATION (S1) |
| 3 | `VIEWER_FORBIDDEN` includes `privacy:delete` | **Met.** It is `[document:download, document:email, privacy:export, privacy:delete]`, typed `readonly Permission[]`. Each entry on the Viewer gives `VIEWER_EXFILTRATION` + `VIEWER_NOT_READ_ONLY` (S3c). Test row `[AT-US-066-05-4]` covers it |
| 4 | Positive invariant on every role | **Met.** Removing each permission of the set from each role, 17 × 3 = 51 cases, gives `SELF_SERVICE_MISSING`; every message names both the role and the permission (S4). The seeded roles all hold the set (S4b) |
| 5 | Regenerate before pinning | **Met.** The pinned v1 is the post-D-058 render (E9 below) |

**Re-check of the D-058 Viewer and Compliance Auditor rows (as D-058 asked).** I diffed the database view of the committed seed SQL against R1 (E9). It adds **exactly 7 links and removes 0**:
- Viewer: + `session:manage`, + `notification_pref:manage` (11).
- Compliance Auditor: + `session:manage`, + `notification_pref:manage` (5).
- Finance: + `order:read`, + `notification_pref:manage` (8).
- Admin: + `privacy:delete` (30, equal to Owner).

No permission row changed. Four role rows changed, in `description` only. The new set has 182 + 7 = 189 links, and every other cell is unchanged.

The Viewer holds 8 reads plus the self-service set, with no `payment:read`, download, e-mail, export or delete. The Compliance Auditor holds `audit:read`, `carrier:status:read` and the self-service set.

**Accepted from the security side.** The one remaining precondition is PR8-SEC-05 (a): self-service permissions may guard only `user`-tenancy routes. That is a TASK-020 merge condition.

Note: Viewer + `payment:read` passes the guard (S6b). That is by design: it is a product decision gated on telemetry (A-104), not a REQ-RBAC-004 invariant. The seed test asserts its absence, and the pin blocks an in-place grant.

### R2.3 Focus-item rulings

| Focus item | Ruling |
|---|---|
| selfService bound to exactly 3 permissions | **Yes**: constant + flag equality + category, flag and literal-set tests (R2.2 #1) |
| Viewer/Auditor carve-out by flag only | **Yes**: strict `=== true` and no exemption from `VIEWER_EXFILTRATION` (R2.2 #2) |
| `VIEWER_FORBIDDEN` includes `privacy:delete` | **Yes** (R2.2 #3) |
| Every role holds the self-service set | **Yes**: guarded by `SELF_SERVICE_MISSING`, all 51 removals caught, plus a fast-check property in the PR (R2.2 #4) |
| Operator-only detection on any key segment | **Yes.** `isOperatorOnlyKey` = `any_org` in any segment, or `audit:*` by resource segment (`isAuditPermission`), or the 2 named keys. A scope qualifier outside segment 3 is `PERMISSION_FORMAT`. `category` is never an authorisation input: `PERMISSION_CATEGORY_MISMATCH` forces category = resource, with only the two exceptions `payment_method → payment` and `notification_pref → notification`. **Residual, by design:** a brand-new resource name, such as `shipment_all:read` with a new category, is not operator-only by rule. The route layer closes it: the PR8-SEC-05 (b) TASK-020 binding requires an operator-only permission on every `operator-cross-tenant` route. Likewise, a hypothetical non-reserved `payment:read:on_behalf` held by the Viewer passes (R1 gap key, still `[]`). `on_behalf` is the M3 partner seam and is not operator-only under DR-A07, and no on-behalf route tenancy exists in this run. Optional hardening: a catalogue rule "`on_behalf` ⇒ `reserved`" until M3. Today's only such key, `shipment:create:on_behalf`, is already reserved |
| Role scope swap and signatureOnly mismatch | **Both caught** (G2, G3, G3b, G3c). A swap that also **renames** the keys so that the prefixes agree passes the pure guard (G2b `[]`). Accepted: it needs a `ROLE_KEYS`/`RoleKey` edit, an `ASSIGNABLE_BY` edit (a Record over `RoleKey`, so it fails type-check otherwise) and a seed change, which the pin blocks. It produces new role rows, not a re-scope of existing memberships |
| Seed pinning; bypass by editing the pin and the seed together | **The bypass works.** I put the hashes of a widened render (Viewer + `payment:read`) into a copy of `generate.ts`. Then: write = 0, `--check` = 0, `checkMessages` = `[]`, and the analogue of the "v1 is released" test passes. Every check the PR ships passes (P2). This is the deliberate-change path; the accidental path is closed. → **PR8-SEC-13** |
| Linter rule 10 upsert | **Closed** (PR8-SEC-03 row) |
| `ON CONFLICT ("id")` | **Correct** (PR8-SEC-08 (b) row). Re-run idempotency is unchanged, because the IDs are deterministic |
| canAssignRole correctness | **Correct for REQ-ORG-010/012 and AC-05** ("Owner only by an Owner"; "Admin cannot modify an Owner"). Fail closed on unknown keys. `ASSIGNABLE_BY` keys = `ROLE_KEYS` (A6). **Binding conditions on the consumer (TASK-231/235):**<br>(i) A modify, suspend or remove must pass `canAssignRole` for **every** role the target member currently holds **and** every role in the requested set. Otherwise an Admin could act on an Owner+Viewer member through the Viewer role.<br>(ii) `assignerRoleKeys` come from the actor's `ACTIVE` membership **in the target organisation**, loaded from the database.<br>(iii) It is a rank check in addition to `org:member:invite`/`org:member:manage` and the 12 h step-up, never instead of them.<br>(iv) Self role change (REQ-ACCT-015) and `LAST_OWNER` (REQ-ORG-013) stay separate checks.<br>`ASSIGNABLE_BY` is not frozen at runtime (A5). That is acceptable, because `Readonly` types forbid mutation under strict TypeScript |
| Database-side escalation backstop | **Present and correct as specified in R1.** Hardening is PR8-SEC-14 |

### R2.4 New findings

| ID | Title | Severity | CWE | OWASP 2021 | Owner |
|---|---|---|---|---|---|
| PR8-SEC-13 | The seed pin can be bypassed by editing the pin constant together with the seed; the generic migration-immutability check is in no task | LOW (MEDIUM once a persistent database exists, M5) | CWE-693 | A08 | orchestrator → TASK-007 (preferred) or TASK-016 |
| PR8-SEC-14 | The database backstop test keys on the `operator_only` column and has no planted-row control | INFO | CWE-693 | A04 | TASK-016 (C-series port) or optional in this PR |

**PR8-SEC-13. Where:** `tools/authz/generate.ts:42-50` (`SEED_MIGRATIONS`), `generate.test.ts` ("catalogue v1 is released", which compares the committed file with the in-code pin).

**Description.** All three checks, the pin, the rendered output and the committed file, read their reference from one editable constant. A PR that changes `roles.ts`, regenerates, and puts the new SHA-256 values into `SEED_MIGRATIONS[1]` passes `--check`, the write mode and every unit test (P2). `prisma migrate deploy` then never applies the edited v1 to an existing database (R1 fact). Fresh databases get the new grants; existing ones keep the old grants. That is a silent privilege retention for a revocation.

R1 routed the generic backstop ("a migration directory present on the merge base stays byte-identical") to TASK-016/TASK-007. As of `origin/main` `cb69b04` it is in neither task file, nor in D-ORCH-011. CODEOWNERS (PR5-SEC-04) is also still absent from TASK-007's acceptance list.

**Exploitability and impact.**
- **Preconditions.** A deliberate edit of a hash constant together with an `M` (not `A`) entry under `prisma/migrations/` in the same diff, and a review that misses it.
- **Severity.** Before M5 only ephemeral databases exist: M × L = **LOW**. With a persistent database it is H × L = **MEDIUM**.

**Remediation.** Add a lane A check that runs from the base ref, like the SEC-TC-64 tooling, for example `tools/ci/check-migration-immutability.mjs`:

```js
// fails on any M/D/R/C/T entry for a file that exists under prisma/migrations/ on the merge base
const out = execFileSync('git', ['diff', '--name-status', '--no-renames', `${base}...HEAD`, '--', 'prisma/migrations'], { encoding: 'utf8' });
const bad = out.split('\n').filter(Boolean).filter((line) => !line.startsWith('A\t'));
if (bad.length) { console.error(`applied migrations are immutable (D-SEC-PR8-01):\n${bad.join('\n')}`); process.exit(1); }
```

`migration_lock.toml` may need an allow-list entry.

**Verification.** A negative fixture branch that modifies an existing `migration.sql` fails lane A, and one that only adds a directory passes. For this PR, the check reports only `A` entries (P3).

**PR8-SEC-14.** The query `(r.scope <> 'OPERATOR' AND p.operator_only) OR p.key LIKE 'webhook:%'` relies on the `operator_only` column. That column is correct today (E4b: the column equals the key rule on all 40 rows), but the backstop is not independent of it. The test also asserts `[]` with no control that proves the query can return a row.

**Fix:**
1. Use the key rule instead of the flag: `p.key ~ '(^|:)any_org(:|$)' OR p.key LIKE 'audit:%' OR p.key IN ('featureflag:manage', 'carrier:status:read')`.
2. Add a control. Inside `BEGIN … ROLLBACK` as the migrator, insert the link `CUSTOMER_VIEWER|audit:read` and expect 1 row.

### R2.5 Follow-ups (updated)

| Item | Owner | Due |
|---|---|---|
| PR8-SEC-13 base-ref migration-immutability check, plus CODEOWNERS for `packages/authz`, `tools/authz` and `prisma/migrations` (PR5-SEC-04) | orchestrator to add to TASK-007's acceptance (in flight), otherwise TASK-016 | before the first catalogue v2 change, and in any case before M5 |
| PR8-SEC-06 consumer conditions (i)–(iv) | TASK-231 / TASK-235 | their merge |
| PR8-SEC-05 (a)–(d) route-binding check | TASK-020 (**merge condition**). It is recorded only in D-ORCH-011; the orchestrator should copy it into the TASK-020 acceptance list | TASK-020 merge |
| PR8-SEC-07, -10, -08 (a) | TASK-060; TASK-016/028; data-architect. These are also only in D-ORCH-011 or the R1 report, not in the task files | their merge |
| PR8-SEC-14 | TASK-016 when it ports the backstop to the C-series, or this PR (optional) | TASK-016 merge |
| When the delta renderer arrives (first `CATALOGUE_VERSION` bump) | security-analyst re-review. A revocation renders as `DELETE` with `data-changing: yes` (D-SEC-PR8-01), and `down.sql` reverts only the delta | that PR |

### R2.6 Evidence (head `498e3a5`, 2026-11-12)

| Probe | Result |
|---|---|
| `git diff --stat 6e70275 498e3a5 -- packages/authz tools/authz tools/db prisma package.json` | empty |
| `git diff --stat origin/main 498e3a5 -- package-lock.json package.json` | `package.json` +1 (the `authz:generate` script) only |
| Secret-pattern grep over the added lines of `6e70275` | 0 hits |
| `probe-guard.mjs` P0 | catalogue `[]`, roles `[]`; 40 / 17 / 189; per-role 38/6/4/3/4/3/5/3 · 30/30/25/8/11 · 7/4/4/4 |
| C1–C7 (R1 escalation edits) | unchanged from R1, all caught (same codes) |
| G0–G3 (R1 gaps) | now caught: `PERMISSION_FORMAT`, `PERMISSION_OPERATOR_ONLY_MISMATCH`, `PERMISSION_CATEGORY_MISMATCH`, `ROLE_SCOPE_MISMATCH`×2, `SIGNATURE_FLAG_MISMATCH`; G1b `OPERATOR_ONLY_ESCALATION` on Viewer and Shipper; G2b rename+swap `[]` (accepted, R2.3) |
| O1–O3 | any-segment `any_org` → operator-only; `shipment:read:all_orgs` → `PERMISSION_FORMAT`; `shipment_all:read` (category shipment) → `PERMISSION_CATEGORY_MISMATCH` |
| S0–S6 | R2.2; 51/51 `SELF_SERVICE_MISSING`; Viewer 11, Auditor 5 as listed |
| A1–A6 | R2.3 canAssignRole row |
| R1–R4 | `effectivePermissions` without `roles` throws; prototype keys → `UnknownRoleError`; `authorise` denies unknown, marker and empty; route check flags `PUBLIC`, `toString`, `"shipment:read "` |
| `probe-seed.mjs` E0 | pin up/down = SHA-256 of the git blobs (MATCH); no CR bytes; `checkMessages` = `[]` |
| E1–E8 | matrix doc, `migration.sql`, `down.sql` EQUAL to the generator; 3 INSERTs with `ON CONFLICT ("id") DO NOTHING`; header `data-changing: no`; 40/17/189; IDs = `seedId`; guard over the database-shaped catalogue and grants `[]`; `operator_only` = key rule on all rows; 0 dangling links; 0 non-operator → operator-only links (key rule); 0 webhook links; prefix = scope; `down.sql` IDs and keys = up |
| E9 (vs `efe23df`) | +7 links (listed in R2.2), −0; permission rows unchanged; 4 role rows changed in `description` only |
| `probe-pin.mjs` P0–P3 | control `[]`; in-place revoke/widen → `--check` 1, write 1; bypass by editing the pin constant → write 0, `--check` 0, `[]`; `git diff --name-status origin/main...498e3a5 -- prisma/migrations` → 4 × `A` |
| `probe-lint.mjs` L | R2.1 PR8-SEC-03 row |
| Not run (constraint) | install, build, Docker suites, gitleaks. The PR comment reports, on `6e70275`: lint, format, typecheck, build, `authz:generate --check` and `npm audit --audit-level=high` all exit 0; unit 859/859; **full** `test:integration` 33/33; **full** `test:coverage` 892/892 with `packages/authz` at 100 % lines and 100 % branches; porcelain empty. On `498e3a5`, lint, format and unit were re-run green |
