# Code review: TASK-295 effect override replacing the D-SECAUDIT-02 audit waiver (pre-push, round 1)

| Field | Value |
|---|---|
| Task | TASK-295 (NFR-MAINT-002; D-SECAUDIT-02 forcing plan items 1-3, EFFECT-SEC-01, EFFECT-SEC-03, D-ORCH-140, D-SD-005) |
| Head | `5edc54f5` (1 commit on main `8281055c`), branch `feat/TASK-295-prisma-bump-or-effect-override`; not pushed, no PR number yet |
| Reviewer | code-reviewer, 2026-11-20 |
| Bindings read | CLAUDE.md; card TASK-295 (`docs/04-plan/tasks/WAVE-01.md`, `task-map.csv` row 296); D-SECAUDIT-02 and D-SD-005 item 5; STATUS rows 0.x (PR #74) and 1.11 and tracked condition EFFECT-WAIVER; ADR-0002 amendment item 7 (root `overrides`); `.npmrc`; `tools/ci/check-audit.mjs` CLI and the lane A audit step in `ci.yml` |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: Route 2 is correctly chosen and correctly built: no stable Prisma after 7.10.1 exists and @prisma/config 7.10.1
         still pins effect 3.20.0 exactly, so a scoped same-major override moves the single effect tuple to 3.22.4 and
         nothing else in the lockfile. The waiver and both pins are gone, the remaining tests are not degenerate, and
         dropping the override makes lane A's audit fail again (mutant proven). 0 BLOCKER, 0 MAJOR, 2 MINOR, 3 NIT.
```

## 1. What I verified myself

Host rule of the dispatch: no install, Jest or Docker in the evidence worktree. The worktree was only read: `npm ls`, `npm explain` and `prettier --check`. Its `git status` was clean and its `node_modules` count was 748 before and after. The one test file ran in a `git archive 5edc54f5` extract in the scratchpad, with `node_modules` junctioned to the worktree's. The extract was removed afterwards.

| Check | How | Result |
|---|---|---|
| Diff scope | `git diff 8281055c 5edc54f5` | 5 files. Lockfile: only `node_modules/effect` version, resolved and integrity change. `devOptional`, licence and the `dependencies` block are unchanged. The effect 3.22.4 manifest declares the same two dependencies as 3.20.0 (`@standard-schema/spec ^1.0.0`, `fast-check ^3.23.1`). No package added or removed. EFFECT-SEC-03 holds: nothing in the production closure moves. |
| Route 1 rejected correctly | `npm view prisma versions` / `dist-tags`, `npm view @prisma/config@7.10.1 dependencies` | Stable 7.10.x: 7.10.0 and 7.10.1 only. No stable 8.x. `@prisma/config` 7.10.1 declares `"effect": "3.20.0"`. A major bump would need the ADR-0001 check the card names, so not taking it is right. Note: the registry's `latest` tag on `prisma` is `8.0.0-rc.34` and `prev` is 7.10.1 (n3). |
| Override version | `npm view effect time` | 3.22.4 was published 2026-10-22T20:49Z, which clears `min-release-age=7`. 3.22.5 (2026-11-19T21:22Z) does not yet. The exact pin matches `save-exact=true` and the exact upstream pin. 3.22.4 is above the patched floor 3.22.1. |
| Override syntax and scope (npm 11.19.1) | `npm ls effect --all` and `npm explain effect` in the worktree; `npm ls --package-lock-only` on head manifests plus the head lock | Exit 0. One tuple: `@prisma/config` gets `effect@3.22.4` (`overridden effect@"3.22.4" (was "3.20.0")`). Both `@hookform/resolvers` optional peers (`^3.10.3`) dedupe onto it. A nested-object override keyed by the parent is the correct npm 11 form, and root `package.json` is the only place npm reads `overrides` in a workspace. |
| Lockfile mutant (override kept, lock reverted to base) | head manifests plus the base lock, `npm ls --package-lock-only effect --all` | Exit 1, `ELSPROBLEMS invalid: effect@3.20.0 … "3.22.4" from node_modules/@prisma/config`. The committed pair is consistent. A reverted pair is detectable. |
| Audit gate, head | `npm audit --json --package-lock-only` on the head extract, then `node tools/ci/check-audit.mjs --root <extract> --npm-audit …` | `check-audit: PASS`, exit 0. No `effect` and no `@prisma/config`/`prisma` vulnerability nodes. Only the watched glob and minimatch moderates are reported. |
| Audit gate, mutant (head watchlist, base lock) | same, with the base lockfile | `audit/high: GHSA-7589-6fvf-x4pw effect (high, dev closure, fix available)`, `FAIL (1 finding)`, exit 1. Removing the waiver is load-bearing, and lane A is the backstop if the override or the tuple is lost. |
| Config still loads on effect 3.22.4 | scratchpad CJS probe: the worktree's `@prisma/config` `loadConfigFromFile` on its `prisma.config.ts` | `error: null` in 454 ms. Keys `datasource, experimental, loadedFromFile, migrations, schema, tables, typedSql, views`, and the schema resolves to `prisma/schema`. |
| Targeted unit test | `jest --selectProjects unit --testPathPatterns tools/ci/check-audit --maxWorkers=2` in the extract | 1 suite, 29 tests pass. That is the base count minus the deleted `it.each` row. |
| Format | `prettier --check` on the 4 changed text files | Clean |
| Commit message | `commitlint` on `git log -1 --format=%B` | Fails `body-max-line-length`: line 3 is 375 characters (n1). The 97-character header passes. |
| Merge with main | `git merge-tree --write-tree origin/main 5edc54f5` (main tip `ccb7e865`) | **Textual conflict in `docs/sdlc/DECISIONS.md`** (m1). Main's `23538dec` appended D-SECPR038-01 after the same last line (D-SECPR079-01 "Reversibility"). The other 4 files merge cleanly. The branch itself deletes nothing: its DECISIONS diff against the merge base is a pure 14-line append. |
| Not re-run | lane B (migrate, shadow, Testcontainers and the migration linter on effect 3.22.4), the full `tools/ci` set (D-TASK295-02 claims 32 suites and 1273 tests), osv-scanner, `check-lockfile`, `check-dep-age`, `licence-check`, typecheck | Lane B on the head and lane A on the pushed head are the evidence. Both are merge conditions. |

## 2. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| m1 | MINOR | `docs/sdlc/DECISIONS.md:5727-5740` | The append of D-TASK295-01..03 conflicts with main's D-SECPR038-01 (`23538dec`), which was appended after the same anchor line. The squash cannot be made until the branch is updated. A careless "take ours" resolution, or a re-append on the old base, would delete main's 44-line D-SECPR038-01. That is the stale-branch shared-log failure that cost TASK-043 r1 its M2. | Merge `origin/main` into the branch (no rebase, no force push). Resolve as a union: main's D-SECPR038-01 first, then D-TASK295-01..03. Prove it: `git diff origin/main <merge> -- docs/sdlc/DECISIONS.md` must show only `+` lines, and `git diff <merge-base> origin/main -- docs/sdlc/DECISIONS.md` must be a subset of the merged file. |
| m2 | MINOR | `package.json:107-109`; ADR-0002 amendment item 7 | (a) ADR-0002 item 7 still describes root `overrides` as the `openapi-typescript` entry alone, and calls it and `@hookform/resolvers` 5.9.2 "the only version-selection deviations". (b) The removal trigger ("when a stable `@prisma/config` allows effect >= 3.22.1") exists only in D-TASK295-01's Reversibility line. It has no owner and no tracked item. The key is unversioned (`@prisma/config`, any version). So a future Prisma bump whose `@prisma/config` pins a newer effect (for example 3.23.x) would be silently forced back to 3.22.4. npm replaces the spec and no lockfile check flags it. Lane B would probably catch an incompatibility, but nothing prompts the bumper to remove the override. | Principal-architect adds a one-line note to ADR-0002 item 7, or a D-ARCH ruling, covering three things: the second root override, its decision D-TASK295-01, and the rule that every Prisma bump re-checks `@prisma/config`'s effect spec and removes the override once it is no longer needed. When the orchestrator closes EFFECT-WAIVER, it records this residual with that owner. Not a merge blocker. |
| n1 | NIT | commit `5edc54f5` body line 3 | A 375-character body line fails commitlint `body-max-line-length` (config-conventional, 100). The commit-msg hook (`npm run hooks:install`) evidently is not active in the worktree. PR lint checks only the title. Main-push lint covers the squash range, and the squash body defaults to the commit body. Main already carries headers over 100 characters (for example #76 and #75), so main-push lint is evidently not blocking today. | When squashing, wrap the body at 100 columns or less. Keep the PR title at 100 characters or less after GitHub adds ` (#NN)`. The current header is 97 characters and becomes 103, so shorten it, for example `chore(deps): override @prisma/config effect to 3.22.4, drop the effect waiver (TASK-295)`. |
| n2 | NIT | `tools/ci/check-audit.test.ts` (no new pin) | Nothing in the unit suite pins the override or the tuple (effect >= 3.22.1). D-TASK295-01 records that `npm install --package-lock-only` did not apply the override to an existing lock. So `npm ci` evidently does not reject a lock that ignores an override. A lock-merge "take theirs" against a stale branch could restore 3.20.0 without an install error. The lane A audit catches it (mutant above), so this is acceptable. The cheap extra check is `npm ls --package-lock-only --all`, which exits 1 on the reverted pair. | Optional, devops-engineer: consider `npm ls --package-lock-only --all` as a lane A lockfile-consistency step in a later tooling task. No change is needed in this PR. |
| n3 | NIT | `docs/sdlc/DECISIONS.md` D-TASK295-01 "Route check" | "The only newer lines are 8.0.0-rc.x and 8.1.0-dev.x" is slightly off against the registry today. Prisma's `dist-tags` show `latest: 8.0.0-rc.34`, `next: 8.0.0-rc.10`, `dev: 8.0.0-rc.34-dev.189` and `prev: 7.10.1`. The conclusion stands: no stable 7.10.2+ and no stable 8.x. The fact worth recording is that `prisma@latest` is a release candidate, so any `npm install prisma@latest` picks an rc. | Add a clause to D-TASK295-01 during the m1 merge, or leave it. Informational. |

## 3. Deviation rulings

- **`npm update effect --ignore-scripts` instead of the card's `npm install --package-lock-only`** (D-TASK295-01 "Lockfile"). **Accepted.** The card names the command, but the result is what the AC binds. I re-proved the result from the committed pair with `npm ls --package-lock-only` (exit 0, single overridden tuple) and from the lockfile diff (3 lines). `--ignore-scripts` keeps ADR-0023 am. F.
- **Exact `3.22.4`, not the newest 3.22.x.** **Accepted.** The card says "newest 3.22.x at least 7 days old". That is 3.22.4 until 2026-11-26T21:22Z. Moving to 3.22.5 afterwards is optional: 3.22.4 is already patched.

## 4. Card and forcing-plan closure

| Card / plan item | Status |
|---|---|
| ROUTE 1 (bump if a stable `@prisma/config` allows effect >= 3.22.1) | Correctly not taken. Verified against the registry (§1). |
| ROUTE 2 (scoped override, newest 3.22.x at least 7 days old) | Met. `package.json` override, one lock tuple 3.20.0 → 3.22.4. |
| WAIVER REMOVED IN THE SAME PR (item 3) | Met. The GHSA-7589-6fvf-x4pw entry is gone from `advisory-watchlist.json`. Its row is gone from the register pin and from the `it.each` due-date table. The header comment is updated. Repository-wide `git grep` finds no remaining reference outside DECISIONS, plan and STATUS history. The audit passes without it (§1). |
| What remains in the test file is not degenerate | Met. The register pin is still an exact `toEqual` over the picomatch waiver, so re-adding any waiver fails it. The `it.each` keeps one real row (picomatch, D-SECAUDIT-01) that asserts both open-until-due and expired-at-due. PR67-SEC-02 still asserts both no production tuple for a waived package and at least one waived tuple (picomatch is present, so the `> 0` guard is live). |
| EFFECT-SEC-03 (runtime stages keep `--omit=dev --omit=optional`; only the effect tuple moves) | Met. No Dockerfile change; effect stays `devOptional`. |
| Security record (security-owned `package-lock.json`, `tools/ci/**`) | Owed by security-analyst. |
| Lane B (D-TASK295-03) | Owed. |

**Can EFFECT-WAIVER and the D-SECAUDIT-02 forcing plan close on merge?** Yes, once merge conditions 1-4 below hold. Items 1-3 are satisfied, and item 4 (renewal) is moot. EFFECT-SEC-01 is closed by the fix, not waived. The STATUS condition EFFECT-WAIVER moves to CLOSED, and row 1.11 TASK-295 is recorded as merged. Record the m2 residual (who removes the override) in the closure note rather than leaving it only in D-TASK295-01.

## 5. Merge conditions

1. Merge `origin/main` into the branch with DECISIONS.md resolved as a union, with the m1 proof. The squash diff against main must show zero deleted DECISIONS lines.
2. Lane B (Docker: migrate, shadow, Testcontainers, migration linter) green on the head, or on the merge commit if condition 1 changes anything beyond DECISIONS.md.
3. Security-analyst record on the head, for the security-owned paths.
4. Lane A on the pushed head (audit with osv-scanner, check-lockfile, check-dep-age, licence) and, if selected, the `security-integration` job.
5. Squash message per n1. Recommended, not a gate.

## 6. Good

- Choosing the minimal route: one override, one tuple, no Prisma major bump, and the waiver deleted in the same commit rather than left to expire.
- The decision record states why the card's command did not work and what proves the committed state instead.
- The PR67-SEC-02 production-closure test survives the removal unchanged and stays non-vacuous.

## 7. Security flags (for security-analyst)

- Confirm that the scope of the unversioned `@prisma/config` override key is acceptable (m2 (b)), and that no gate-tooling package is reached. `npm explain` shows only `@prisma/config` and the two optional `@hookform/resolvers` peers.
- Confirm that `GHSA-7589-6fvf-x4pw` is absent from osv-scanner on the head lock. I could not run it (Docker).
