# Code review: PR #8, TASK-013 (round 1)

- **PR:** #8 `feat/TASK-013-typed-permission-catalogue-seeded-roles`, head `efe23df` (2 commits on `84ac551`)
- **Scope:** typed permission catalogue (40), 17 seeded roles through two generated expand-only migrations, the generated role-permission matrix document, the privilege-escalation guard, `authorise`/`effectivePermissions`, `assertRoutePermissions`, and `tools/authz/generate.ts` with `--check`
- **Stories:** US-065, US-066 (M0 Must, demo-critical). This is a security-critical path (authz).
- **Reviewer:** code-reviewer · 2026-11-12 · bootstrap merge rule D-ORCH-004

```
VERDICT: CHANGES_REQUESTED
SUMMARY: A careful, well-tested catalogue and seed. The typed union, the guard with named violations, deterministic UUIDv7 seed IDs and the
         byte-exact drift check are the right shape. Three MAJORs block approval:
         - M1: the Compliance Auditor invariant can be bypassed through the free-text `category`.
         - M2: nothing enforces the "new version, new migration" rule; the generator rewrites the applied v1 seed in place.
         - M3: Viewer and Compliance Auditor cannot list or revoke their own sessions (REQ-AUTH-021 Must, ASVS V3.3.4).
FINDINGS: 3 MAJOR · 6 MINOR · 7 NIT (table in §3)
SECURITY-FLAGS: §6
```

## 1. Verification I performed myself

The dispatch forbade installs, builds, Docker and full suites (memory-constrained host, D-ORCH-010). This is what I ran.

| Check | Result |
|---|---|
| `git diff main...efe23df`, full read of all 31 changed files | done |
| Requirements and design inputs | Read US-065/066/073 Gherkin, REQ-RBAC-001..014, DR-A07, the REQ-ACCT scope note, ADR-0008 and its amendment, data-model §1.5/§1.6/§3.3/§9.1/§9.2, the TASK-013 sheet, gherkin-test-map, TEST-STRATEGY §6 and D-TASK013-01 |
| Prettier `--check` on the changed `.ts`/`.json` files | clean |
| ESLint on `packages/authz/src/**`, `tools/authz/*`, `prisma/tests/authz/*`, using the PR's own `eslint.config.mjs` with `disableTypeChecked` | 23 files, 0 messages. Type-aware rules were not re-run |
| `jest --selectProjects unit --testPathPatterns packages/authz/src/roles.test` (scratch `git archive efe23df` copy, junctioned `node_modules`) | 23/23 passed |
| `tools/authz/generate.ts --check` (tsx, `@platform/source`) | Clean tree: exit 0. Appending one byte to the matrix doc: exit 1, file named. Editing `down.sql`: exit 1, both files named. I also confirmed that `import.meta.main` is `true` under tsx for ESM entry files, so `--check` cannot silently skip `main()` |
| Guard probes (tsx script importing the PR sources) | P1/P1b → M1. P2: scope swap passes (n3). P5: an unknown or prototype role key throws. P6: `' shipment:read'`, `'PUBLIC'` and `''` are all rejected by `findUnknownRoutePermissions`. P9: a v2 render emits a whole-catalogue `down.sql` (M2) |
| `gh pr view 8 --json statusCheckRollup` | `[]`: no CI checks on this head (bootstrap) |
| Cleanup | Scratch copy and junction removed. Worktree `node_modules` still has 740 entries and `git status` is clean |

What I did **not** re-run, and whose evidence I relied on:
- `npm run typecheck`, `build`, full `lint` (type-aware), full `test:unit` (346/346 claimed), `test:coverage` (100% on `packages/authz/src` claimed) and `npm audit`. I relied on senior-developer's PR evidence for these.
- `test:integration`. senior-developer's full run was reaped. Their targeted run of `prisma/tests/authz` + `prisma/tests/migrations` passed 7/7. The orchestrator re-runs it.

## 2. What is good (keep)

- **Exact typing.** `as const satisfies readonly PermissionDefinition[]` per module and `Permission = (typeof PERMISSIONS)[number]['key']` give an exact union.
  - `ROLES` is typed `RoleDefinition<Permission, RoleKey>`, so a typo in a grant fails `tsc`.
  - AT-US-065-03 uses `@ts-expect-error` inside a file that `tsc -b` includes. That is the correct way to make "it does not compile" a regression test.
- **The guard is pure and data-driven.** It returns typed `Violation`s that name the role and the permission, and every invariant has a mutated-seed test. The AT-US-066-04 fast-check property covers every customer/partner role × every operator-only permission.
- **Single source.** The seed SQL and the matrix doc are both rendered from the catalogue.
  - The drift check is byte-exact, and I proved it with mutations.
  - IDs are deterministic UUIDv7 and validated before being spliced into SQL (an injection-shaped ID is rejected; tested).
- **Migration hygiene.** Expand-only DDL with linter headers and `down.sql`. `GRANT SELECT` only to `platform_app`, with a 42501 test covering INSERT, UPDATE, DELETE and TRUNCATE. FKs are `RESTRICT`. The CHECK constraint mirrors the TS regex.
- **Integration drift test.** It compares the database after migration with the catalogue, so code and database cannot diverge on fresh databases.
- **Decision logging.** D-T013-01..12 are explicit and flag the judgement calls for the right owners.

## 3. Findings

| ID | Sev | Location | Problem | Why it matters | Required fix |
|---|---|---|---|---|---|
| M1 | **MAJOR** | `packages/authz/src/guard.ts:126` | The Compliance Auditor invariant treats "audit permission" as `definition.category === 'audit'`. `category` is free text from the same file being guarded, and no rule ties it to the key. Meanwhile `isOperatorOnlyKey` (permissions/index.ts) uses the resource segment `audit`, so the module has two different definitions of "audit permission". **Proved:** P1 adds `{ key: 'retention:purge', category: 'audit' }` and grants it to Super Admin and the Auditor: **0 violations**. P1b changes `featureflag:manage` to `category: 'audit'` and grants it to the Auditor: **0 violations**. | REQ-RBAC-004 and ADR-0008 §3 say Compliance Auditor ⊆ `*:read ∪ audit:*`. A two-line seed edit gives the Auditor a write or manage permission without failing CI. That is exactly what US-066 says "can never silently" happen. | 1. Key the rule on the key: `isReadPermission(key) \|\| key.split(':')[0] === 'audit'`, the same predicate `isOperatorOnlyKey` uses (export one `isAuditPermission`). 2. In `checkCatalogue`, enforce that `category` is derived from the resource: `category === resource`, except an explicit map (`payment_method→payment`, `notification_pref→notification`). 3. Add P1/P1b as mutated-seed tests. Also align the AT-US-066-03 assertion in roles.test.ts:71, which already uses `startsWith('audit:')`. |
| M2 | **MAJOR** | `tools/authz/generate.ts:138,165-176,195-200`; `packages/authz/src/matrix-doc.test.ts:149`; `packages/authz/src/seed-sql.ts:100-107` | Nothing enforces "a grant change bumps `CATALOGUE_VERSION` and ships as a new migration". Problems: (a) edit one grant and the drift tests fail; (b) their message tells the developer to run `npm run authz:generate`; (c) that **rewrites `20261112010100_authz_seed_v1/migration.sql` in place**, because the path is keyed by the unchanged version. Prisma `migrate deploy` applies only pending migrations, so databases that already applied v1 keep the old grants while fresh ones (CI) get the new ones. The integration drift test runs only on fresh databases, so it never sees the divergence. In addition, `renderSeedMigration` always renders the **whole** catalogue. A v2 `down.sql` would delete every v1 row (probe P9), and a narrowed grant cannot be expressed at all. | Authz grants would diverge silently across environments: the integrity property REQ-RBAC-002/013 exist to protect. The first post-merge grant change (likely the M3 ruling) walks straight into it. | 1. Pin each released seed migration, e.g. `SEED_MIGRATIONS = { 1: { dir, sha256 } }`. When the rendered content for a pinned version differs, `--check` and the unit test fail with "catalogue changed: bump CATALOGUE_VERSION and add a seed migration", and the write mode refuses to overwrite a pinned directory. Fix the drift-test message accordingly. 2. Until a delta renderer exists, make `artefacts()` throw for `CATALOGUE_VERSION > 1` with a pointer to the needed delta design: v(n) up inserts the additions and deletes the removed links; v(n) down reverts only that delta. Alternatively, implement the delta now. Add a test for each. |
| M3 | **MAJOR** | `packages/authz/src/roles.ts:121-126,165-181` | Customer Viewer and Compliance Auditor do not hold `session:manage`, and the Auditor also lacks `notification_pref:manage`. `/me/sessions` GET and DELETE both declare `x-permission: session:manage`. REQ-AUTH-021 is **Must**, retagged by D-047 for ASVS V3.3.4: "list the current user's active sessions… how a user discovers a hijacked device". REQ-ADMIN-007 gives staff a "My sessions" page. The PR flags this (D-T013-05) as a conflict with REQ-RBAC-004's "no … manage permission". | Two roles could never see or kill a hijacked session. One of them is the Auditor, which reads the whole audit trail. The seed becomes immutable on merge, so the cheapest moment to resolve this is now. | Get the architect + PM ruling before merge and apply it in this PR. **Recommended:** own-account self-service permissions are user-scoped, not organisation-resource permissions. Add a catalogue flag (e.g. `selfScoped: true` on `session:manage` and `notification_pref:manage`). The Viewer and Auditor read-only invariants exempt self-scoped keys, while `VIEWER_FORBIDDEN` and the operator-only rules still apply. Grant `OWN_ACCOUNT` to Viewer, Auditor and Finance (m5). PM amends the REQ-RBAC-004 wording to match. **Alternative closure:** a logged ruling (PM + architect, security-analyst concurring) that defers this to a v2 seed migration owned by the REQ-AUTH-021 task. That requires M2 to be fixed first. |
| m1 | MINOR | `packages/authz/src/roles.test.ts:125-145` | The AT-US-066-07 "partner roles unused" scan uses a hard-coded list of 12 sub-directories. A new package (e.g. `packages/notifications`) and `prisma/seed/**` are silently out of scope. `prisma/seed/**` is where the TASK-023 demo seed creates memberships, and the scenario says "no … membership references a partner role". | Coverage decays as packages are added. | Enumerate `apps/*` and `packages/*` (excluding `packages/authz`) from the file system, add `prisma/seed`, and assert the list is non-empty. |
| m2 | MINOR | `packages/authz/src/authorise.test.ts:18` | The title is `[AT-US-066-06 (authz decision; …)]`. The bracket does not contain the bare ID that TEST-STRATEGY §6 rule 1 requires. The test also covers only the pure decision, while the map places AT-US-066-06 in `audit-generator` B+A* (403 + `PERMISSION_DENIED` entry). | `quality:trace` either misses the ID (bad form) or, once the extractor is lenient, counts a partial unit test as the scenario. That is false-green AC coverage. | Drop the AT ID from this title (e.g. "authz decision behind AT-US-066-06"). Record in the handoff that TASK-027/TASK-033 own `[AT-US-066-06]`. |
| m3 | MINOR | `packages/authz/src/roles.ts:213-214` | `ASSIGNABLE_CUSTOMER_ROLES` is documented as "Roles an organisation Owner **or Admin** may assign" and includes `CUSTOMER_OWNER`. REQ-ORG-010 says Owner is assignable only by an Owner. Customer Admin lacks `privacy:delete`, so an Admin who assigns Owner grants a permission they do not hold. | This is the classic escalation path. The exported constant invites the wrong check in the invitation and member-management tasks. | Fix the comment ("roles a customer organisation can hold"). Add, or route to the US-083/US-085 task, a pure `canAssignRole(assignerRoles, targetRole)`: the target's grants must be a subset of the assigner's, and Owner requires Owner. Include a test. |
| m4 | MINOR | `packages/authz/src/guard.ts:46,49` | `VIEWER_FORBIDDEN: readonly string[]` and `IMPLIED_GRANTS: [string, string][]` are stringly typed. | If `document:download` or `tracking:read` is renamed, the check silently becomes vacuous; the focus asks for no stringly-typed checks. | Type them as `readonly Permission[]` and `readonly (readonly [Permission, Permission])[]`. |
| m5 | MINOR | `packages/authz/src/roles.ts:147,154-156,163` | Literal readings of the REQ-ACCT scope note produce inversions: Customer Admin lacks `privacy:delete` while the lower Shipper holds it, and Finance gets `session:manage` but not `notification_pref:manage`, unlike every other role's own-account baseline. | Data-subject self-service (REQ-ACCT-017) and notification opt-out would depend on role in ways nobody intended. | Ask PM to confirm in the M3 ruling. Give Finance the same `OWN_ACCOUNT` baseline. |
| m6 | MINOR | `prisma/tests/authz/authz-seed.int.test.ts:44-46,61-67` | The catalogue-vs-database snapshot compares key, category, `operator_only`, scope, `name_key` and links. It does not compare `description` or `is_system`. All inserts are `ON CONFLICT DO NOTHING` without a conflict target, so a pre-existing row with the same key but different attributes is silently kept. | This is the last line of defence for M2-style divergence. | Include every seeded column in the snapshot. |
| n1 | NIT | `guard.ts:33,140` | `TRACKING_READ_MISSING` is the code emitted for the generic `IMPLIED_GRANTS` list. | — | Rename it to `IMPLIED_GRANT_MISSING`. |
| n2 | NIT | `authorise.ts:26` | `effectivePermissions(roleKeys, roles = ROLES)` defaults to the in-code seed. REQ-RBAC-008 resolves permissions from the database per request. | The default makes it easy for the US-068 middleware to skip the database. | Make `roles` required, or document that the API passes database-loaded roles. |
| n3 | NIT | `roles.ts:76`, `guard.ts:88-103` | Neither the guard nor the type relates a role key's prefix to its scope. Probe P2: swapping `CUSTOMER_ADMIN` and `OPERATOR_SALES` scopes and granting `audit:read` passes. The insert-only seed and the `membership_roles` scope trigger mitigate this. `ROLES` is also not checked for exhaustiveness against `ROLE_KEYS` at type level. | — | Derive the scope from the key prefix or assert they agree, and type `ROLES` via `Record<RoleKey, …>`. |
| n4 | NIT | `prisma/migrations/20261112010000_authz_catalogue_tables/migration.sql:68` | `ix_role_permissions__role_id INCLUDE (permission_id)` is redundant with `ux_role_permissions__role_permission (role_id, permission_id)`, which already serves index-only scans. It is also the D-T013-09 Prisma drift source. | — | Data-architect: drop AP-AUTHZ-02's separate index in favour of the unique index (needs a data-model edit). |
| n5 | NIT | `packages/authz/src/permissions/index.ts` | `permissionVerb('document:download:read')` returns `read`, because any non-scope qualifier is taken as the verb. | No such key exists today. | Optionally reject three-segment keys whose qualifier is a verb that differs from a read action. |
| n6 | NIT | `roles.ts` `nameKey` | The `roles.<scope>.<name>` i18n keys are not in any locale file yet. | — | Route to the first UI task that renders role names (en/es/fr). |
| n7 | NIT | `packages/authz/tsconfig.json` (`include: ["src"]`) | Test files and `src/tests/repo.ts` (node:fs) compile into `dist/`. | Existing pattern; watchlist item for TASK-014. | No action in this PR. |

## 4. Rulings on the PR's decisions (D-T013-xx)

| Decision | Ruling |
|---|---|
| D-T013-01 module granularity | Accepted. The sheet's `permissions/<module>.ts` pattern holds. |
| D-T013-02 webhooks `signatureOnly`; Super Admin = every role-assignable permission | Accepted as code. Architect to confirm the ADR-0008 wording. |
| D-T013-03 reserved `:any_org` seams | Accepted. They give DR-A07 concrete subjects, and Super Admin is the only holder. |
| D-T013-04 dead-permission rule beyond Super Admin → operator Admin holds `featureflag:manage` | Accepted. The grant is defensible on its own merits (ADR-0027 admin API). Note that a test rule should not be the reason for a grant. |
| D-T013-05 least privilege where silent | **Not accepted as is** for `session:manage` and `notification_pref:manage` (M3, m5). The other choices are accepted, including Viewer without `payment:read`. |
| D-T013-06 verb rule | Accepted, with n5. |
| D-T013-07 deterministic UUIDv7 | Accepted. Verified version and variant bits, uniqueness, and that the ID is UUID-validated before SQL. |
| D-T013-08 seeding by versioned migration rather than the §9.2 reference seed | Accepted, conditional on M2. Data-architect aligns §3.3/§9.2, and TASK-023's reference seed must **not** also write these tables. |
| D-T013-09 Prisma `INCLUDE` drift | See n4. |
| D-T013-10 integration test reads the catalogue via `tools/authz/generate.ts` | Accepted. It adds a new `prisma/tests → tools/authz` edge; TASK-016's R3-n1 boundaries allow-list must include it. |
| D-T013-11 `RoleScope` in authz | Accepted until the `packages/shared` enum module lands. |
| D-T013-12 sheet file names over ADR-0008's | Accepted. Architect to note this in ADR-0008. |
| Seed migration `data-changing: no` | I concur. It is a plain `INSERT … VALUES` into tables created empty by the previous migration; rule 10 permits it, and no existing data changes. A future v2 that deletes links (M2) **is** data-changing and must say so. |

## 5. AT ID mapping (13 IDs)

| ID | Status |
|---|---|
| 065-01..04 | OK |
| 065-05 | Map lane is `unit`. The contract-absence test is acceptable; the HTTP 404 is TASK-020's. |
| 066-01 | int-test re-run, idempotent |
| 066-02 | unit + generator, mutation-proved |
| 066-03 | OK, but see M1 |
| 066-04 | OK, with the fast-check property |
| 066-05-1/-2/-3 | OK |
| 066-06 | See m2 |
| 066-07 | See m1 |
| 066-08 | OK at decision level, per the map's `unit` lane |

## 6. Security flags (for security-analyst)

1. M1: guard bypass through a mis-categorised permission (CWE-269, improper privilege management).
2. M2: silent environment divergence of the authz seed when an applied migration is regenerated in place.
3. M3: ASVS V3.3.4 (own-session list and revoke) unavailable to Viewer and Compliance Auditor.
4. m3: Owner assignable by Admin (escalation by grant), for the invitation and member tasks.
5. `ON CONFLICT DO NOTHING` without a conflict target can mask attribute conflicts (m6).
6. `data-changing: no` on the seed: reviewed and concurred (§4).

## 7. Routed (not blocking this PR)

| Owner | Item |
|---|---|
| TASK-016 | `tools/db/table-classes` registration of the three GLOBAL tables; prisma/tests allow-list gains `tools/authz` (R3-n1) |
| TASK-028 | Classification registry: STD = INT; `description`, `category` and `name_key` = PUB |
| TASK-020 | 404 on `/api/v1/permissions`, `/roles` and `/role-permissions` (AT-US-065-05 runtime half) |
| TASK-027/033 | `[AT-US-066-06]` HTTP 403 + `PERMISSION_DENIED` |
| US-073 owner | `CONFIG_CHANGE` for migration-driven role changes |
| TASK-023 | Must not seed the authz tables |
| Data-architect | §3.3/§9.2 alignment and n4 |
| Architect | ADR-0008 file names and the webhook wording |
| UI task | n6 |
| TASK-015 | 95% coverage threshold on `packages/authz` |

## 8. Merge conditions

1. M1, M2 and M3 closed. For M3 the alternative closure applies only through a logged ruling.
2. m1–m6 fixed in this PR, or explicitly routed in the fix report.
3. Re-run on the fix head: lint (type-aware), typecheck, the full `test:unit`, `authz:generate -- --check`, the targeted `prisma/tests/authz` + `prisma/tests/migrations` run, and `test:coverage` for `packages/authz` (95/95). Also, since no CI checks exist on this head, the orchestrator's full `test:integration` re-run.
4. security-analyst: no Critical/High open.
