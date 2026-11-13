# PR-0019 / TASK-023: supersede and delta round (seed framework, superseding PR #13)

| Field | Value |
|---|---|
| PR | #19 `feat(seed): idempotent reference and demo seed framework, superseding #13 (TASK-023)`, https://github.com/sukhchdit/shipcube/pull/19, branch `feat/TASK-023-seed-framework`. Eight linear commits on `origin/main` @ `80ff2c2` (after PR #18 / TASK-016): `eb96b77` (PR #13's net change), then `4ac5af2`, `5e08fb3`, `c6e08fc`, `6c148eb`, `daf8155`, `dda57eb`, `699f33d`. No merge commit. 46 files |
| Supersedes | PR #13, to be closed unmerged (D-ORCH-017, D-SEC-PR13-02). **The content review is `docs/05-quality/security/PR-0013-TASK-023-security-review.md`, rounds 1–2:** R1 `e92cd6f`, and R2 `e42e368`, which approved the content as PASS_WITH_FOLLOW-UPS. This record holds the supersede evidence for the six D-SEC-PR13-02 / PR-0013 §R2.5 conditions and the security review of the seven additions |
| Head | 699f33d16bfd8deb9b8bf8e536020d810cb3e395 |
| Lane A evidence | Run [43336239827](https://github.com/sukhchdit/shipcube/actions/runs/43336239827) on `699f33d` (`pull_request`). **fast-lane `success`**, all 27 steps green, including "Released migrations are immutable", "Lint", "Unit tests" (which run `lint-migrations.test.ts` NT-DATA-004-b on the repository's migrations, the grants-manifest pin and the TenantDb surface pin) and "Lint negative fixtures from the base ref against the head configs". **scans:** "Gitleaks (PR commit range)" `success` (8 commits scanned, no leaks) and Semgrep `success`. Only "Security-owned paths need a review record" failed, because no `PR-0019-*` record existed; this record is that record. ci-gate failed as a consequence |
| Owned paths changed | 12, per main's checker: `eslint.config.mjs`, `package.json`, `package-lock.json`, the two `20261112030000_reference_dataset_versions` migration files, `prisma/tsconfig.json`, `tools/tsconfig.json`, `tools/lint/negative-fixtures.test.ts`, and the four `tests/fixtures/lint/layering/prisma-tests-imports/**` files |
| Reviewer / date | security-analyst, 2026-11-13. Read-only. Every git command ran in the main checkout against commit SHAs; **no command ran in the PR worktree** (`Shipqube-TASK-023-v2`). No install, build, Docker, gitleaks or suite run. One lint probe ran in scratch, with the head's and main's `eslint.config.mjs` taken from `git archive` and a scratch junction to the **main checkout's** `node_modules` (§3.3). The record was validated in a scratch `git clone --shared` (§6). Both were removed afterwards |

## 1. Summary

PR #19 re-applies PR #13's reviewed net change (`git diff d68168e e42e368`) as one fresh commit, `eb96b77`, on main. It then adds the D-ORCH-015 reconciliation with TASK-016 (PR #18), the D-ARCH-075 ruling on PR13-SEC-04, code review R2-m1/R2-n1, and the optional PR13-SEC-10. No PR #13 commit is in its history, so the synthetic literal that gitleaks flagged in `e6ccf60` is not in lane A's range.

**All six supersede conditions hold (§2).** A three-way tree comparison shows that `eb96b77` equals PR #13's reviewed tree plus main exactly. The two files that both sides changed are clean unions. Every other difference at the head belongs to one of the seven listed additions.

**The additions are sound (§3):**
- `platform_app` holds `SELECT` only on `reference_dataset_versions`. This is guaranteed by construction (owner = `platform_migrator`, one `GRANT SELECT`, no default table ACLs). It is pinned in three places: the manifest line, the exact C5 equality and the 42501 probes.
- The SYSTEM class is right for this table.
- The `prisma-seed` boundary opens exactly one edge, `prisma/tests` → `prisma/seed/**`. A probe compared the head and main configs and proved this.
- The two TASK-016 pins each gained exactly one entry and stay exact.

**Findings.** One new INFO (PR19-SEC-01, routed to later tasks). This PR closes PR13-SEC-04 and PR13-SEC-10. PR13-SEC-11 is confirmed closed on main.

## 2. Supersede evidence (D-SEC-PR13-02 (2) / PR-0013 §R2.5)

| # | Condition | Method | Result |
|---|---|---|---|
| 1a | No PR #13 ancestry | `git merge-base --is-ancestor <c> 699f33d` for `e6ccf60`, `5fcf177`, `e92cd6f`, `e42e368` by name, and for each of the 17 commits of `git rev-list 80ff2c2..e42e368` | **None is an ancestor** (all exit 1). `63accea` and `2e29004` are ancestors, as expected, because they are on main |
| 1b | No merges | `git rev-list --merges 80ff2c2..699f33d`; parent count per commit | **0 merges**; all 8 commits have one parent. `git merge-base 80ff2c2 699f33d` = `80ff2c2` |
| 2a | Same tree as the reviewed content | A three-way `ls-tree -r -z` comparison over base `d68168e` (PR #13's last merge base), old head `e42e368`, main `80ff2c2`, and each new commit. The expected entry is the old head's if PR #13 changed the path, and main's otherwise. Mode, type and object id are compared | **`eb96b77`: 1,337 of 1,337 non-overlap paths match, 0 mismatches.** The two overlaps are `prisma/README.md` and `tools/tsconfig.json`. **`699f33d`:** 1,321 match. The 19 mismatches plus the 2 overlaps are exactly the files of the seven additions, attributed commit by commit with `git log --name-only eb96b77..699f33d` (§3). **Positive control:** treating main as the new head gives 34 mismatches |
| 2b | Overlaps are clean unions | Line carry for `prisma/README.md`: every line main added since `d68168e` is checked against the head, and the same for every line PR #13 added. For `tools/tsconfig.json`, both sides' diffs were read | **README:** 0 of main's lines are missing (TASK-016's RLS and Rule-5 sections are carried verbatim). The 2 PR #13 lines that are missing are the drift-restore sentence that `5e08fb3` and `daf8155` reworded on purpose; `4ac5af2` removes the duplicate tests bullet. **tsconfig:** main's 14 `files` entries plus PR #13's `include` of `../prisma/seed/**/*.ts` and its comment; nothing else |
| 2c | Dependencies | Blob ids of `package-lock.json`; `git diff --text 80ff2c2 699f33d` | **The lock blob is identical to `e42e368`'s** (`511b179`). The delta against main is the R1/R2 one: `+@platform/authz` and `+@platform/config` under the `prisma` workspace only |
| 3a | Gitleaks configuration unchanged | Blob ids at `80ff2c2` and `699f33d`; `git diff --stat 80ff2c2 699f33d -- .gitleaks.toml .gitleaksignore .github` | **Identical** (`.gitleaks.toml` `e8e4782`). `.gitleaksignore` exists at neither. `.github/` is unchanged |
| 3b | Scrubbed literal absent | `git grep -nE "pw-[0-9]{10}"` at `699f33d` and `80ff2c2`; `git log -G` over `80ff2c2..699f33d`; a search of the main working tree | **0 hits everywhere.** The value is described, not quoted (PR13-SEC-11) |
| 3c | No inline allow markers | Added lines of `80ff2c2..699f33d`: `gitleaks:allow`, `nosemgrep`, `eslint-disable`, `stylelint-disable`, `@ts-ignore`, `@ts-expect-error`, `prettier-ignore`, `istanbul ignore`, `c8 ignore` | **0** |
| 4 | Lane A green except the record | `gh run view 43336239827`, per step | **Met** (header row). The record step is the last step of `scans`, so nothing was skipped behind it |
| 5 | The record names the new head | §6 | **Met:** `Head` row = `699f33d…`; simulated checker `pass` |
| 6 | PR13-SEC-11 fixed on main | `2e29004` on main; `git grep` (3b) | **Met.** `git log -G` over `63accea^..80ff2c2` shows only `63accea` (+2 lines) and `7f8ec4f` (+1) adding it and `2e29004` (−3) removing all three; main has 0 hits since |
| — | Workflow levers (D-ORCH-021) | `git diff 80ff2c2 699f33d -- .github`; `tools/ci/`, `tools/deps/`, `jest.config*`, `.swcrc`, `CODEOWNERS`, `.npmrc` in the changed-path list; added lines for `RANGE_BASE`, `BASH_ENV`, `BASH_FUNC_`, `GITHUB_ENV`, `GITHUB_PATH`, `defaults.run`, `LINT_FIXTURE_MODE`, `NODE_OPTIONS`, `pull_request_target` | **No workflow, CI-tooling or lever change**; 0 tokens. The only owned lint configuration change is `eslint.config.mjs` (§3.3) |

## 3. Review of the additions

### 3.1 `daf8155`: `platform_app` gets `SELECT` only (D-ARCH-075, PR13-SEC-04)

- **The grant at the head is SELECT only, by construction.** The migration (unreleased, so the in-place edit does not trip the immutability step) creates the table as `platform_migrator`, the owner. Its only grant is `GRANT SELECT ON TABLE "public"."reference_dataset_versions" TO platform_app`. The bootstrap lane sets no default table privileges: `01-schemas.sql` only revokes `EXECUTE` on functions, and C5 asserts that `pg_default_acl` has no `r`/`S`/`T`/`n` rows. So `platform_app` cannot hold `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` or `MAINTAIN` on it. No RLS policy is needed to keep a runtime write out.
- **It is pinned three ways:**
  - `grants.manifest` has one line;
  - catalog C5 compares the live `aclexplode` set for `platform_app` / `platform_definer` / `platform_erasure` / `PUBLIC` with the manifest by **exact equality** across every privilege type, so a wider grant (`TRIGGER` and `MAINTAIN` included) or a missing one fails;
  - the seed suite's probe now expects `42501` for `INSERT` (a full, otherwise valid row, so the refusal can only be the privilege), `UPDATE`, `DELETE` and `TRUNCATE` as `platform_app`, then re-reads the version rows as the migrator and expects them unchanged.

  This meets D-ARCH-075 item (1).
- **The documentation matches the ruling.** The migration header, `contracts.ts`, `validate.ts`, `version-store.ts` and the README all say "single writer = the seed as `platform_migrator`; the reconciler reads; `authz_matrix` reserved". `RESERVED_DATASET_NAMES` is unchanged.
- **Residual (unchanged from R1, accepted by D-ARCH-075):** the owner credential can still write the row. That is the DDL credential, which is out of scope for a runtime-compromise threat.
- **Evidence limits.** C5 and the seed suite are integration suites, which lane A does not run. The PR body reports the developer's local `test:integration` at tree `699f33d`: 17 suites, 175 passed, including catalog C1/C2/C5, the deletion step and the 42501 probes. I did not re-run it (no Docker). The static argument above is enough for the security verdict. An independent integration run on this head is code review PR-0019 condition 3.

### 3.2 `6c148eb`: `reference_dataset_versions` registered as SYSTEM

- **Acceptable.** The table has no `org_id` and holds no personal data, only dataset names, labels, SHA-256 digests, row counts and the SYSTEM actor id. Data-model §1.5 SYSTEM ("no RLS") and §3.5 / D-ARCH-075 item (6) ("RLS on this SYSTEM table rejected") both apply. With SELECT-only, RLS would protect nothing: every tenant may read the same non-sensitive rows, and no runtime role can write them.
- **The manifest entry is the right mechanism.** Linter rule 9 and catalog C1/C2 derive the non-RLS allow-list from the table-class manifests (`tools/db/table-classes.ts`), so the exemption is declared once, in a CODEOWNED file.
- **`hardDelete` is not set,** so `validateGrants` would refuse any future `platform_app DELETE` line.
- **The `$comment` is now accurate.** It no longer says SYSTEM tables get no grant, and it names the one SELECT line.
- **Lane A evidence:** `lint-migrations.test.ts` NT-DATA-004-b ("prisma/migrations and prisma/bootstrap of this repository have no findings") runs in "Unit tests" and is green.

### 3.3 `c6e08fc`: the `prisma-seed` boundary

- **Mechanism.** eslint-plugin-boundaries 7.4.1 file descriptors **accumulate** categories: every matching pattern adds one, and the config sets no `singleMatch`/`stopMatching`. So `prisma/seed/**` files are now `prisma-seed` **and still `prisma`**.
- **The from-side is unchanged.** The SQL-driver and Prisma allow-lists (`SQL_DRIVER_CODE`, `DATABASE_CODE`) still match `prisma`.
- **The to-side gains one edge.** Every existing `to: 'prisma'` prohibition still applies, including pricing's no-I/O rule and the prisma-tests "rest of `prisma/`" prohibition. The only policy that names `prisma-seed` is the prisma-tests allow, which comes later, so the last matching policy wins for `prisma/seed/**` targets only.
- **Probe (scratch, head config vs main config, same mini-repo, single process).** Results:
  - **prisma/tests → `prisma/seed/framework/runner.ts`**, and → a `prisma/seed` file that imports `pg`: **allowed at head**, refused on main. This is the intended change.
  - **prisma/tests → `prisma/other/value.ts`** and **→ `packages/shared/src`**: refused on both.
  - **prisma/tests → `prisma/generated`**: allowed on both.
  - The same results hold from a **non-test file under `prisma/tests/helpers/`**.
  - **A `prisma/seed` file importing `pg` and `@prisma/client`**: no finding on both, so the seed keeps its category rights.
  - **`packages/pricing` → `prisma/seed`**: refused on both (the `prisma` category is retained).
  - **Positive controls:** `pg` from `packages/shared` and from a module repository are refused on both.
- **The committed fixtures cover the same ground.** `ok-imports.int.test.ts` gains a seed-framework import that must stay clean. The new `TENANT_DB` case `bad-prisma-import.int.test.ts` (→ `prisma/scripts/value.ts`) must fire `boundaries` with "prisma/tests may import only".
- **The negative-fixtures change does not weaken anything.** It adds one case and renames one allowed-case title; no case is removed or relaxed. The base-ref no-weakening run is green.
- **`import-x/no-relative-packages`.** `prisma/tests` → `prisma/seed` is within the `prisma` package, so the ignore list did not need to grow.

### 3.4 `699f33d`: TASK-016 pinned tests

- **`tools/db/grants-manifest.test.ts`.** The exact `toEqual` tuple list gains exactly `platform_app SELECT public.reference_dataset_versions *`. `validateGrants(…, loadTableClasses())` must still be `[]`. The refusal and cross-check tests are untouched. **Not weakened.**
- **`prisma/tests/rls/tenant-db.real-client.test.ts`.** The exposed-surface list gains exactly `referenceDatasetVersion`, which `modelDelegateNames` derives from the Prisma runtime data model now that the `ReferenceDatasetVersion` model exists. It is still asserted by exact equality on `ownKeys` and on the spread. The `REFUSED`, symbol and non-tagged assertions are unchanged. **Not weakened.**
- A tenant transaction can now call `db.referenceDatasetVersion.findMany()`. Write operations reach the database and fail with 42501 (§3.1). This matches the existing GLOBAL catalogue delegates; see PR19-SEC-01 for the general point.

### 3.5 `5e08fb3`, `dda57eb`, `4ac5af2`

- **`5e08fb3` (R2-m1)** widens drift detection: with the label and hash unchanged, a re-inserted row (deleted by hand) is now a drift restore. It is logged as `warn seed.drift_restored` with counts only (dataset, rows, reinserted, edited: no values or PII) and reported as a `drift-restored` change for audited datasets. This **strengthens** PR13-SEC-06 tamper evidence. Unit tests cover re-insert, mixed, and insert-only. The integration test deletes one audited row and expects it restored, one change reported, and the version row unchanged.
- **`dda57eb` closes PR13-SEC-10.** The read-back is `WHERE name OPERATOR(pg_catalog.=) ANY ($1::pg_catalog.text[])`, valid `subquery_Op` syntax, and the unit test asserts the text.
- **`4ac5af2`** is documentation only.

## 4. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner | Status |
|---|---|---|---|---|---|---|---|
| PR19-SEC-01 | `TenantDb` exposes every Prisma model delegate, SYSTEM-class models included; the data-model §1.5 rule "SYSTEM tables: only the owning module's repositories" has no mechanical control | INFO | CWE-1220 (insufficient granularity of access control) | A01 | `apps/api/src/platform/db/tenant-db.ts` `modelDelegateNames` / `createTenantDb` (main); first instance `prisma/tests/rls/tenant-db.real-client.test.ts:186-188` @ `699f33d` | principal-architect, with TASK-043 (outbox) / the first SYSTEM model that `platform_app` may write or that holds sensitive data (`idempotency_keys`, `login_attempt_counters`) | Open |

**PR19-SEC-01 (INFO).**
- **Description.** The surface of a tenant transaction is "one delegate per Prisma model". This PR adds the first SYSTEM-class model (`referenceDatasetVersion`), and any repository holding a `TenantDb` can now address it. Data-model §1.5 restricts SYSTEM tables to the owning module's repositories, but nothing enforces that:
  - the boundaries plugin sees imports, not property access;
  - grants are per role, not per module.
- **Impact here: none.** The table is non-sensitive and `platform_app` can only read it.
- **Why record it now.** Later SYSTEM models (`outbox_events`, `idempotency_keys` with its allow-listed `PER` column, `login_attempt_counters`) carry `platform_app` write grants, and some carry hard-delete grants. For those, "only the owning module" is a real control.
- **Remediation (design choice for the architect, before the first such model):** one of
  - a `platform/*` lint rule mapping SYSTEM model names to allow-listed files (`db.<model>` member access);
  - excluding SYSTEM models from `TenantDb` and handing them out through narrow platform ports (outbox writer, idempotency store);
  - a per-call-site `TenantDb` view built with an explicit model allow-list.
- **Verification.** A negative fixture: a module repository that touches `db.outboxEvent` outside the allow-list fails lint, or the delegate is absent from its `TenantDb`.

**Carried over from PR-0013:**

| ID | Status at `699f33d` |
|---|---|
| PR13-SEC-04 (LOW) | **Closed.** D-ARCH-075 ruled SELECT-only, implemented and pinned (§3.1) |
| PR13-SEC-10 (INFO) | **Closed** (`dda57eb`) |
| PR13-SEC-11 (INFO) | **Closed** on main (`2e29004`; §2 row 6) |
| PR13-SEC-05 (INFO) | Open → TASK-026 (target-table allow-list, two-part names) |
| PR13-SEC-08 (INFO) | Open → TASK-014 / TASK-089 / TASK-025. Its TASK-221 re-baseline item is resolved by D-ARCH-075 (2): no digest row exists to drop |
| PR13-SEC-09 (LOW) | Open → TASK-014 (shared TLS helper, `checkToolingEnv` caller) |

## 5. Merge conditions and follow-ups

**Merge conditions:**
- This record is committed on top of `699f33d` as a **docs-only** commit, and lane A is green on that commit.
- The orchestrator's pre-merge workflow-lever diff (D-ORCH-021) is re-run against the final head.

**Follow-ups and notes:**
- **Overlap with PR #4.** PR #4 (`d2e867b`) also changes `eslint.config.mjs` and `tools/lint/negative-fixtures.test.ts`. Whichever PR merges second must resolve the overlap, which voids that PR's record under checker rule (d). That PR then needs a delta round. If #19 merges first, PR #4's resolution must keep the new `TENANT_DB` case (37 cases at `699f33d`) and the `prisma-seed` category and allow. If #4 merges first, #19's main-merge must keep PR #4's additions, and this record must be re-issued for the new head.
- **Code review R19-n1 is a migration-header comment nit.** Editing `migration.sql` changes an owned path after `699f33d` and voids this record, so it needs a delta round. After merge the migration is immutable (PR8-SEC-01), so the nit can then only be corrected in data-model §3.5. Leaving the header is security-neutral: `RESERVED_DATASET_NAMES` refuses `authz_matrix`.
- **Close PR #13 unmerged with a link.** The triage key for later full-history scans stays as written in PR-0013 §R2.5 item 5.

## 6. Record check (simulated)

**Setup.**
1. `git clone --shared --no-checkout <main checkout>` into scratch.
2. `checkout --detach 699f33d`.
3. Copy this file in and commit it as a docs-only commit on top.
4. Run main's `tools/ci/check-security-owned-paths.mjs --root <clone> --base 80ff2c2 --pr 19` (head = the record commit).

The clone was removed afterwards. **Observed: `pass`** (exit 0), satisfied by this record at `699f33d`, with the same 12 owned paths lane A listed. **Controls:**
- without the record commit (head `699f33d`): `missing` (exit 1, "no record named …PR-0019-*.md");
- `--pr 13`: `missing` (PR-0013's head rows name `e92cd6f` and `e42e368`, which are not commits of this range);
- `--pr 18`: `missing` (PR-0018 names `0f9ff27`);
- rule (d): a further commit that touches `migration.sql` after the record gives `missing` ("names 699f33d, but …/migration.sql changed after it").

ASVS 4.0.3 delta against PR-0013 R2:
- **V1.4.x / V4.1.3 (least privilege):** now **met** for `reference_dataset_versions`. Runtime role has read only; single owner writer.
- **V14.2.x (configuration integrity):** unchanged. The lint boundary change is minimal and proven.
- **Everything else:** as in PR-0013 R2.

| Field | Value |
|---|---|
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding is open at head `699f33d`, so the merge rule (D-ORCH-004) is met for the security dimension. All six D-SEC-PR13-02 conditions hold (§2): no PR #13 ancestry and no merges; the tree is PR #13's reviewed content plus main plus the seven listed additions only; gitleaks configuration and literal clean; lane A green except this record; this record names the head; PR13-SEC-11 fixed on main. The additions are sound (§3): SELECT-only by construction and pinned by C5 and the 42501 probes; SYSTEM class acceptable; the `prisma-seed` boundary opens only `prisma/tests` → `prisma/seed/**` (probe-proven); TASK-016 pins extended by one exact entry each, not weakened; no workflow-lever change. PR13-SEC-04 and -10 closed. New: PR19-SEC-01 (INFO, architect, before the first writable or sensitive SYSTEM model). **This round authorises `699f33d` for merge** once this record is committed on top of it as a docs-only commit and lane A is green on that commit |
