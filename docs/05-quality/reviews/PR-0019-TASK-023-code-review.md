# Code review: PR #19 (TASK-023 seed framework, supersedes PR #13)

- **Reviewer:** code-reviewer
- **Date:** 2026-11-13
- **Head:** `699f33d16bfd8deb9b8bf8e536020d810cb3e395` on `origin/main` `80ff2c2` (after PR #18 / TASK-016)
- **Commits (linear, no merges):** `eb96b77` (PR #13's net change) ← `4ac5af2` (R2-n1) ← `5e08fb3` (R2-m1) ← `c6e08fc` (m6 `prisma-seed` boundary) ← `6c148eb` (SYSTEM table class) ← `daf8155` (D-ARCH-075 SELECT only) ← `dda57eb` (PR13-SEC-10) ← `699f33d` (TASK-016 pinned tests)
- **Scope (D-ORCH-017, PR-0013 R2.5):** a supersede and delta review. PR #13's content was graded in `PR-0013-TASK-023-code-review.md` round 1 (CHANGES_REQUESTED at `e92cd6f`) and round 2 (APPROVED_WITH_NITS at `e42e368`) and is not re-reviewed. This round proves tree identity and ancestry, then reviews the seven additions on their merits.

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The 34 PR #13-only files are byte-identical to e42e368; the 2 overlap files equal a clean git merge-file of
         (main, d68168e, e42e368); nothing outside PR #13's 36 files + the 10 addition-only files changed; none of the
         17 PR #13 commits is an ancestor and there is no merge. All seven additions are correct; R2-m1, R2-n1 and m6 are
         closed with tests that kill my mutations. Lane A fast-lane is green; only the security record is red.
FINDINGS: R19-n1 (NIT). No BLOCKER/MAJOR/MINOR.
GOOD: pure supersede with SHA proofs in the PR body; exact-equality pins extended, not loosened; negative fixture added
      for the narrowed boundary; 42501 probes assert state unchanged afterwards.
SECURITY-FLAGS: none new. The lane A security-owned-paths record must name 699f33d (12 owned paths).
```

## 1. Verification performed

Read-only by SHA in the main checkout after `git fetch -q origin`; no commands in the worktree, no installs, builds or Docker.

| Check | Command (summary) | Result |
|---|---|---|
| Old merge base | `git merge-base origin/main e42e368` | `d68168e` |
| PR #13 file set | `git diff --name-only d68168e e42e368` | 36 files, none under `docs/` or `.claude/` |
| Overlap with main | `comm -12` against `git diff --name-only d68168e origin/main` (438) | Exactly 2: `prisma/README.md`, `tools/tsconfig.json` |
| 34 PR #13-only files vs `eb96b77` | `git diff --name-only e42e368 eb96b77 -- <34>` | **empty** (includes `package.json`, `package-lock.json`) |
| Same 34 minus the additions' files vs head | `git diff --name-only e42e368 699f33d -- <files>` | **empty** |
| Overlap files | `git merge-file -p main base(d68168e) old(e42e368)`, `cmp` with `eb96b77` | rc 0 (no conflict), **byte-identical** for both; `tools/tsconfig.json` untouched after `eb96b77` |
| Head delta ⊆ PR #13 ∪ additions | `git diff --name-only origin/main 699f33d` (46) minus (36 ∪ 20 addition files) | **empty**; so every other main file is unchanged |
| Additions only touch listed files | `git diff --name-only eb96b77 699f33d` | 20 files, exactly the PR body's addition table |
| `eb96b77` parent | `git rev-parse eb96b77^` | `80ff2c2` = `origin/main` |
| Ancestry | `git merge-base --is-ancestor <c> 699f33d` over `git rev-list d68168e..e42e368` (17, incl. the gitleaks-hit commit) | **0 ancestors** |
| Merges | `git rev-list --merges origin/main..699f33d` | 0 |
| Gitleaks config | `git diff --stat origin/main 699f33d -- .gitleaks.toml .gitleaksignore` | unchanged |
| Secret-shaped literal family from D-ORCH-017 | `git grep -c` of the pattern at `699f33d` | 0 files (literal not quoted here) |
| Lane A | `gh run view 43336239827` | headSha `699f33d`. `fast-lane` success: lint, format, typecheck, unit (83 suites / 2283 tests, incl. `runner.test`, `migrator-connection.test`, `grants-manifest.test`, `tenant-db.real-client.test`, `negative-fixtures.test`, and `lint-migrations.test` "prisma/migrations and prisma/bootstrap: no findings"), base-ref fixtures "0 extra finding(s)", build, no tree mutation. `scans`: gitleaks and Semgrep success; fails only at "Security-owned paths need a review record" (no `PR-0019-*` record). `ci-gate` fails as the aggregate. |
| Unit tests in a `git archive 699f33d` scratch copy (node_modules junctioned, removed afterwards; no link at `C:\`; main `git status` unchanged) | Jest `--selectProjects unit` on `runner.test`, `migrator-connection.test`, `grants-manifest.test` | 3 suites, 59 passed |
| Mutations, R2-m1 (`runner.ts`) | M1 condition back to `updated > 0`; M2 `restoredRows: updated`; M3 warn `rows: updated` | **killed**: 2, 3 and 1 failures respectively; every new test kills at least one |
| Mutations, m6 boundary (`eslint.config.mjs`), `negative-fixtures.test -t 'prisma/tests'` (6 cases green at baseline) | A: add `'prisma'` to the prisma-tests allow; B: drop `'prisma-seed'` from it; C: widen the category pattern to `prisma/**` | **killed**: 1 failure each (A and C by `bad-prisma-import`, B by `ok-imports`) |

**Not re-run (constraint):** full `test:unit`, lint, typecheck, build, coverage and `test:integration`. I relied on lane A run 43336239827 for the first four, and on the developer's local gate table in the PR body for integration (17 suites, 175 passed, incl. catalog C1/C2/C5, the seed deletion step and the 42501 probes) and coverage (98.06 % / 97.02 %). Integration on this head is merge condition 3.

## 2. Review of the additions

| # | Commit | Ruling |
|---|---|---|
| 1 | `4ac5af2` R2-n1 | The duplicate "- Tests:" bullet after the limits table is deleted; the one at the top of the section stays. **Closed.** |
| 2 | `5e08fb3` R2-m1 | `else if (inserted > 0 \|\| updated > 0)`. The invariant holds: with `existing.version` and `contentSha256` unchanged, the seeded row set is unchanged, so any row the upsert or insert-only path writes was edited or deleted by hand. Insert-only datasets count `written.rows.length` as `inserted`, so a deleted published row is now a drift restore too. `restoredRows = inserted + updated`; the warn carries `rows`, `reinserted`, `edited` (dataset name and counts only, no row data). `status` already counted inserts. The version-changed branch keeps precedence. Tests: three unit cases (audited re-insert, mixed 1 + 1, insert-only re-insert) and an integration step (DELETE `P00004` → `inserted: 1`, a third change of kind `drift-restored` with `restoredRows: 1`, version rows equal `versionsBefore`, row restored to `Probe 4`). JSDoc, `ConfigChange` doc and README updated. **Closed.** |
| 3 | `c6e08fc` m6 | `prisma/seed/**` → `prisma-seed`, listed before `prisma/**`. Categories are cumulative in this config (the existing `DB_PLATFORM` → `db-platform` + `db-platform-core` pair relies on it), so seed files keep `prisma` and still match `DATABASE_CODE` / `SQL_DRIVER_CODE` (lane A lint green with `migrator-connection.ts` importing `pg`), and the prisma-tests `disallow … 'prisma'` still catches them until the later, last-match-wins allow adds `prisma-seed`. Only `prisma-tests` gains the edge; no `from: prisma-seed` policy exists, so nothing is relaxed for the seed itself. The new `bad-prisma-import` fixture (a `prisma/scripts` file) proves the rest of `prisma/` stays out; message and comment updated. No exemption was added for `prisma/seed/**` raw SQL (the D-ORCH-015 "align" item): lint is clean under PR #18's rules. **Closed** (PR #13 m6). |
| 4 | `6c148eb` SYSTEM entry | `{ "name": "reference_dataset_versions", "class": "SYSTEM" }`, so rule 9 and C1/C2 derive it from the manifest. The `$comment` no longer says SYSTEM tables get no grants; its claims match the manifest (no lines for `_prisma_migrations` / `bootstrap_migrations`, one SELECT line here). **Correct.** |
| 5 | `daf8155` D-ARCH-075 | Migration `GRANT SELECT` only (the migration is not on main, so the in-place edit does not trip the immutability check; lane A step green). One manifest line, so C5 compares both directions. The integration probe refuses INSERT, UPDATE, DELETE and TRUNCATE as `platform_app` with `42501` and then asserts the version rows are unchanged. I checked that the INSERT probe cannot fail earlier for another reason: every column exists, `pg_catalog.sha256(''::bytea)` is 32-byte `bytea`, and the privilege check runs before constraint evaluation. This matches D-ARCH-075 (1) and data-model §3.5/§4.4 as amended. The docs in `contracts.ts`, `validate.ts`, `version-store.ts` and the README drop the "TASK-221 writes a digest row" wording; `authz_matrix` stays in `RESERVED_DATASET_NAMES`. See R19-n1 for one stale example. **Correct.** |
| 6 | `dda57eb` PR13-SEC-10 | `WHERE name OPERATOR(pg_catalog.=) ANY ($1::pg_catalog.text[])` is valid PostgreSQL (the `subquery_Op` form pg_dump emits). It is the only statement before the pin check; the cast was already qualified. The unit test asserts the text. **Correct.** |
| 7 | `699f33d` pinned tests | `grants-manifest.test.ts` keeps exact `toEqual` on the sorted tuples and adds one tuple, plus `validateGrants(…, loadTableClasses())` = `[]`. `tenant-db.real-client.test.ts` keeps exact sorted `ownKeys` and `spread` equality and adds the one delegate Prisma generates for the PR #13 model; `ownSymbols: 0` and `hasParent: false` are unchanged. These are deliberate list extensions; nothing was weakened. Exposing a SELECT-only SYSTEM delegate on the TenantDb is consistent with D-ARCH-075. **Legitimate.** |

## 3. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R19-n1 | NIT | `prisma/migrations/20261112030000_reference_dataset_versions/migration.sql:6`; `docs/03-architecture/data-model.md:1556` | The header still gives `authz_matrix` as an example row ("One row per seeded dataset (e.g. `countries`, `compliance_pack:IN`, `authz_matrix`)"). Under D-ARCH-075 (2) no `authz_matrix` row is ever written: the name is reserved and the reconciler reads `audit_entries`. Lines 8–10 of the same header say so, so the file now contradicts itself. Once merged, the migration is immutable (PR8-SEC-01), so the stale example becomes permanent. | Optional, in this PR (cheapest now): drop `authz_matrix` from the example list. The data-model §3.5 "e.g." goes to the architect's next fold. |

## 4. Follow-up closure (from PR-0013)

| Item | Status |
|---|---|
| R2-m1 deletion drift | **Closed** (§2 row 2; mutations killed) |
| R2-n1 README duplicate | **Closed** |
| m6 `prisma-seed` category | **Closed** (§2 row 3; mutations killed) |
| R2.5 condition 1 (tree identity) | **Met** (§1) |
| R2.5 condition 2 (reconcile: category, SYSTEM entry + `$comment`, manifest; lint, `db:lint-migrations`, typecheck on the merged head) | **Met** in lane A; C5 integration per the developer's run (condition 3 below) |
| R2.5 condition 3 (M1 docs fold) | **Met on main**: WAVE-00 TASK-023 "Stories (partial; completed by TASK-089)" with the D-061 AT list; AT-US-049-02 on TASK-014 (WAVE-00:526); AT-05/-09/-10 on TASK-089 (WAVE-02:458) (D-ARCH-079) |
| R2-n2 (third URL-predicate copy), R2-n3 (client `query_timeout`/`keepAlive`), m1 bootstrap twin | Routed to TASK-014 (D-ARCH-079 `compose` block); not re-raised |
| m4 a–d dataset contract limits | Routed to the first-consumer seed tasks (D-ARCH-079); check each later dataset PR |
| PR13-SEC-04 | Implemented as ruled (D-ARCH-075) |
| PR13-SEC-10 | Implemented |

## 5. Good

- The PR body carries its own partition proof, and every claim reproduced exactly.
- R2-m1 is fixed with a stated invariant in the JSDoc and is covered at both the unit and integration level, including insert-only datasets, which my round-2 probe had not covered.
- The boundary change is the narrowest possible: a new category and one allow edge. A negative fixture proves the rest of `prisma/` stays out.
- The 42501 probes assert state after the refusals, not just the error code.
- Pinned surface tests were extended by one entry each with a comment saying why, rather than relaxed to `toContain`/`arrayContaining`.

## 6. Security flags (for security-analyst)

None new. The record `docs/05-quality/security/PR-0019-*.md` must name `699f33d` (or a later head after which no owned path changed). The 12 owned paths include `eslint.config.mjs`, `package*.json`, the migration and `down.sql`, `prisma/tsconfig.json` and the lint fixtures. PR #13's record does not carry over.

## 7. Merge conditions

1. Security record on `699f33d` (lane A `scans` and `ci-gate` then go green).
2. **Squash merge only.** `eb96b77` alone fails rule 9, boundaries and two unit pins, and commits 1–7 fail `test:unit`. The repository still allows merge commits and rebase merges, and a rebase merge would put non-green commits on `main`.
3. `test:integration` on this head (lane B or the gatekeeper): catalog C1/C2/C5, the seed suite (deletion step, 42501 probes) and the CLI cases. The developer's local run is the only evidence so far.
4. Close PR #13 unmerged after this merges (D-ORCH-017).
5. If the head moves (R19-n1 or a merge-main), a delta-only re-check: the same partition commands, and `git diff 699f33d <new>` limited to the touched files.
