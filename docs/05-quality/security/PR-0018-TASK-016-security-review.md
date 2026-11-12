# PR-0018 / TASK-016: supersede round (row-level security foundations, superseding PR #11)

| Field | Value |
|---|---|
| PR | #18 `feat(db): row-level security foundations, superseding #11 (TASK-016, US-074, US-075)`, https://github.com/sukhchdit/shipcube/pull/18, branch `feat/TASK-016-rls-foundations`. Two commits on `origin/main` @ `27b6f86` (after PR #17): `eac026a` carries PR #11's net change except `tools/lint/negative-fixtures.test.ts`, which it leaves at main's version; `0f9ff27` merges that file under PR #17's mode split. There is no merge commit. 377 files, +10,086 / −227. **No dependency change** (`package.json` and `package-lock.json` are untouched) |
| Supersedes | PR #11, closed unmerged (D-ORCH-018 item 1). **The content review is `docs/05-quality/security/PR-0011-TASK-016-security-review.md`, rounds 1–3:** R1 `557aada`, R2 `a3e8edd`, and R3 `37a2109`, which authorised the content as PASS_WITH_FOLLOW-UPS. This record holds only the supersede evidence that PR-0011 §R3.7 and the orchestrator's brief require, plus the review of the one resolved file |
| Head | 0f9ff276989127128cfe67922d050de095ad0d69 |
| Lane A evidence | Run [43325215960](https://github.com/sukhchdit/shipcube/actions/runs/43325215960) on `0f9ff27` (`pull_request`). **fast-lane `success`**, every step green, including "Unit tests" (the head suite in exact mode) and "Lint negative fixtures from the base ref against the head configs (PR2-SEC-08)" (main's suite in no-weakening mode against this PR's lint configs). **scans:** "Gitleaks (PR commit range)" and Semgrep `success`. Only "Security-owned paths need a review record" failed, because no `PR-0018-*` record existed; this record is that record. ci-gate failed as a consequence |
| Owned paths changed | 74, per main's checker. `eslint.config.mjs`; `prisma/bootstrap/02-role-backstops.sql`; the two `20261112020000_platform_rls_helpers` migration files; `tools/db/lint-migrations.ts`; 7 `tools/eslint-rules/*`; `tools/lint/{lint-fixtures.mjs, negative-fixtures.test.ts, tenant-context-forms-drift.test.ts}`; `tools/tsconfig.json`; 58 `tests/fixtures/lint/**` files. All except `negative-fixtures.test.ts` are byte-identical to `37a2109` (§2) |
| Reviewer / date | security-analyst, 2026-11-13. Read-only. Every git command ran in the main checkout against commit SHAs; **no command ran in the PR worktree** (`Shipqube-TASK-016-v2`). No install, build, Docker, gitleaks or suite run; gitleaks and the suites are covered by the lane A evidence. The record was validated in a scratch `git clone --shared` (§5), which was removed afterwards |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding is open, so the merge rule (D-ORCH-004) is met for the security dimension. **Every supersede check passes (§2).** (1) None of the 21 commits of `63accea..37a2109` is an ancestor of the head, including `d68898a` and `557aada`, and `27b6f86..0f9ff27` has no merge commit. (2) Except for `tools/lint/negative-fixtures.test.ts`, every path of the head tree equals PR #11's reviewed content or main. A three-way tree comparison checked 1,302 of 1,302 paths, file modes included. (3) The one overlap, resolved in `0f9ff27`, keeps every exact-mode expectation of `37a2109` and weakens no security-relevant expectation in no-weakening mode (§3). (4) No gitleaks configuration change, no scrubbed literal, no inline allow marker, and no workflow-lever change (D-ORCH-021). **No new finding.** The open follow-ups are carried over unchanged from PR-0011 (§4). **This round authorises `0f9ff27` for merge**, once this record is committed on top of it as a docs-only commit and lane A is green on that commit |

## 1. Summary

PR #18 is the D-ORCH-018 superseding branch for PR #11. It re-applies PR #11's reviewed net change (`git diff 63accea 37a2109`) as fresh commits on clean main. It does not carry the old merge commit `d68898a`, which held main's since-scrubbed literal.

D-ORCH-020 merged PR #17 (the base-ref fixture harness fix) first. After that, main and PR #11 overlapped in one file, `tools/lint/negative-fixtures.test.ts`. PR #11 had added the TASK-016 lint cases to that file, and PR #17 had split its assertions into exact and no-weakening halves. `0f9ff27` merges the two. The resolution:
- gives every TASK-016 case the exact-mode assertion that `37a2109` had;
- runs each "weakening" half (a rule that must still fire, or a rule that must stay on) in both modes;
- moves only "positive" halves (rules switched `off` for an exempt path, completeness checks) to exact-only, as PR #17 did for the pre-existing cases.

Everything else in the head tree is byte-identical to what rounds 1–3 reviewed, or to main.

## 2. Supersede evidence

| # | Check | Method | Result |
|---|---|---|---|
| 1a | No old ancestry | `git merge-base --is-ancestor <c> 0f9ff27` for each of the 21 commits in `git rev-list 63accea..37a2109`, plus `d68898a`, `557aada`, `a3e8edd` and `37a2109` by name | **None is an ancestor.** `63accea` is an ancestor (it is on main), as expected |
| 1b | No merge commit | `git rev-list --merges 27b6f86..0f9ff27`; `git log --format='%H %P'` | **0 merges.** `eac026a` has parent `27b6f86`, and `0f9ff27` has parent `eac026a`. `git merge-base 27b6f86 0f9ff27` = `27b6f86` |
| 2a | Non-docs delta from the reviewed head | `git diff --name-status 37a2109 0f9ff27 -- . ':!docs' ':!.claude'` | **15 paths**, exactly the 15 paths of PR #17 (`git diff --name-status eb35d5f b622edc`), which are also exactly main's non-docs change since `63accea`. The blob of each path at the head equals `origin/main` @ `27b6f86`: `.github/CODEOWNERS`, `.github/workflows/ci.yml`, `jest.config.ts`, `tests/fixtures/lint/README.md`, `tools/ci/check-workflow-policy.mjs`, `tools/ci/check-workflow-policy.test.ts`, `tools/ci/ci-policy.test.ts`, the two `tools/ci/fixtures/workflow-policy/*-fixture-mode-*.yml`, `tools/ci/jest-transform.test.ts`, `tools/lint/fixture-expectations.mjs`, `tools/lint/fixture-expectations.test.ts`, `tools/lint/jest.base-fixtures.config.json`. `.swcrc` is absent on both. **The one exception is `tools/lint/negative-fixtures.test.ts`** (head `cd65605`, main `b1e8231`), reviewed in §3 |
| 2b | Whole-tree equivalence | A three-way `ls-tree -r` comparison of base `63accea`, old head `37a2109`, main `27b6f86` and new head `0f9ff27`, including docs and `.claude`. The expected value is the old head's entry if PR #11 changed the path, and main's entry otherwise. The comparison covers mode, type and object id | **1,302 of 1,302 non-overlap paths match**, with 0 mismatches. The only path that both sides changed is `tools/lint/negative-fixtures.test.ts`. **Positive control:** treating main as the new head gives 376 mismatches |
| 2c | Same file set and size | `git diff --name-only` of `63accea..37a2109` vs `27b6f86..0f9ff27`; `--numstat` excluding the overlap | **Same 377 paths**, and neither diff touches `docs/` or `.claude/`. The per-file numstat is identical for 376 paths. The net-stat difference, +10,086 / −227 vs +10,071 / −226, is the overlap file alone: 308/4 became 323/5 |
| 3a | Gitleaks configuration | Blob ids of `.gitleaks.toml` at `63accea`, `37a2109`, `27b6f86` and `0f9ff27` | **Identical** (`e8e4782`). `.gitleaksignore` exists at none of them |
| 3b | Scrubbed literal | `git grep -nE "pw-[0-9]{10}"` at the head; `git log -G` over `27b6f86..0f9ff27` | **0 hits** at the head and 0 commits in the range. **Controls:** `37a2109` and `d68898a` give 2 hits each, in main-side files that PR #11 never changed (`docs/sdlc/DECISIONS.md` and a `.claude/agent-memory` file), and `27b6f86` gives 0. The value is not quoted here (PR13-SEC-11) |
| 3c | Inline allow markers | Added lines of `27b6f86..0f9ff27` for `gitleaks:allow`, `nosemgrep`, `eslint-disable`, `stylelint-disable`, `@ts-ignore`, `@ts-expect-error`, `prettier-ignore`, `istanbul ignore`, `c8 ignore` | **0** (also 0 on the old net diff) |
| 4 | Workflow levers (D-ORCH-021) | `git diff 27b6f86 0f9ff27 -- .github`; added lines (all paths) for `RANGE_BASE`, `BASH_ENV`, `BASH_FUNC`, `GITHUB_ENV`, `GITHUB_PATH`, `LINT_FIXTURE_MODE`, `GITHUB_STEP_SUMMARY` | **`.github/` is identical to main**, so `RANGE_BASE`, `BASH_ENV`, `PATH`, `BASH_FUNC_*`, `defaults.run`, folded `run: >` and `$GITHUB_ENV` / `$GITHUB_PATH` writes are all unchanged. The added lines hold 0 of these tokens. The only environment token in the added lines is `PGOPTIONS`: the PR refuses it (reviewed in PR-0011 R3, P-E3) |
| 5 | PR #17 content on main | `git diff 8dd1d24 b622edc -- <PR #17 paths>` | **Empty.** The 15 PR #17 paths on main are the head that PR-0017 round 2 reviewed (PASS_WITH_FOLLOW-UPS), so no unreviewed owned content reached this branch through main |

**Deviation from PR-0011 §R3.7 item 2.** §R3.7 expected `git diff 37a2109 <new-head> -- . ':!docs' ':!.claude'` to be empty and the stat to equal `63accea..37a2109`. It assumed that main would change only `docs/` and `.claude/`. D-ORCH-020 then merged PR #17 first, so the expected delta is PR #17's 15 paths plus the one resolved file. Checks 2a–2c and 5 prove that this is the whole delta.

## 3. Resolution of `tools/lint/negative-fixtures.test.ts` (`0f9ff27`)

**Method.**
- I read `git diff 63accea 37a2109`, `git diff 63accea 27b6f86` and `git diff 27b6f86 0f9ff27` for the file.
- A line-carry script listed the lines that each side added but that are absent from the head.
  - **Old-PR lines missing: 6.** All six are restructured assertions; each is mapped in the table below.
  - **Main lines missing: 1.** The `formatExtras` known-rule set now also includes the `WARNINGS` rule ids. This only changes the "known / new to the base" label in the extras listing (`fixture-expectations.mjs` `formatExtras`), not pass or fail.
  - **Positive control:** with the base file treated as the head, 199 old-PR lines are missing.
- `main → 0f9ff27` adds the TASK-016 tables and tests. It modifies only these existing lines:
  - the `ESLINT_VIOLATIONS` spread, which now adds `TENANT_DB`;
  - the three set lines (clean sweep, case table, rule coverage), which now include `WARNINGS`, as `37a2109` did;
  - the `formatExtras` known set.
- No main test is removed or relaxed. The bcrypt, ignore-decision, lint-script and resolver tests are byte-identical to main.

| TASK-016 case group (`37a2109`) | Exact mode at `0f9ff27` (head run in `test:unit`) | No-weakening mode at `0f9ff27` (base-ref run, once this is the base) | Ruling |
|---|---|---|---|
| `TENANT_DB`: 36 negative cases (`bad-*` files and exemption probes): 8 `tenant-context-sql`, 20 `db-raw-sql`, 2 `prisma-client-construction`, 2 `no-alter-role-sql`, and 4 `boundaries` cases (sql-driver, root-client, prisma-tests) | Same table and entries, spread into `ESLINT_VIOLATIONS`. `expectFindings` → `expectOnly(…, 'error')`: same rule set, `error` severity and message fragment as the old `expectOnly` | `noWeakening`: each expected rule must still fire at `error` with the fragment, and a finding without a rule id fails | **Equivalent and not weakened** |
| `WARNINGS`: `platform/expect-affected` `bad-unchecked.ts` | Old: `[[ruleId, severity]]` equals `[[ruleId, 'warning']]`. New: `expectOnly(…, ruleId, '', 'warning')`, the same exact rule set at `warning` severity; the empty fragment matches any message, as before | The rule must fire at `warning` or higher; an `off` rule fails | **Equivalent and not weakened.** Accepting `error` is strengthening (PR #17 m3) |
| "Every other fixture lints clean", case-table completeness, rule coverage | `WARNINGS` files and rule ids are included as in `37a2109`. Completeness and coverage are `exactOnly` on main | Clean sweep: ruleless findings fail. Completeness and coverage are skipped, as main already does | **Equivalent.** These are positive halves |
| 12 "allowed (TASK-016)" clean fixtures | `expectClean` gives `findings == []`, the same as the old `toEqual([])` | Ruleless findings fail; findings that carry a rule id are listed | **Equivalent** |
| Audit-writer allow-list (TASK-002 n5): 2 `error` and 2 `off` paths | Split into an always-run `error` test and an `exactOnly` `off` test; together they make the old 4 assertions | The `error` half runs | **Not weakened.** An `off` that flips to `error` lints more |
| Tenant-database wiring: repository rules; `prisma/tests`; services, `platform/http` and planned audit store | Repository: `tenant-context-sql`, `prisma-client-construction` and `db-raw-sql` equal `error`; `expect-affected` must be in `['warn']`, the same as the old `toMatchObject` `'warn'`. `prisma/tests`: `tenant-context-sql` and `import-x/no-relative-packages` equal `error` (always); `prisma-client-construction` and `db-raw-sql` equal `off` (`exactOnly`). The `db-raw-sql` = `error` loop over services, `platform/http` and the audit store is unchanged | Every `error` assertion runs. `expect-affected` must be `warn` or `error`, so `off` fails. Only the two `prisma/tests` `off` exemptions are skipped | **Not weakened.** The skipped half is the test-folder exemption; flipping it would only lint more |

**The specific expectations the brief named:**
- **`tenant-context-sql`:** 8 negative cases, the repository and `prisma/tests` wiring at `error`, and 3 clean controls. All of them run in both modes.
- **`db-raw-sql`:** 20 negative cases, plus `error` wiring for repositories, services, `platform/http` and `packages/audit/src/store/prisma-store.ts`. All of them run in both modes.
- **`prisma-client-construction`:** 2 negative cases and repository wiring at `error` run in both modes. Only the `prisma/tests` `off` is exact-only.
- **bcrypt:** byte-for-byte main's PR #17 split, which PR-0017 reviewed. "Rules on everywhere; other modules keep the bcrypt pattern" always runs; the hasher's own exemption is exact-only. PR #11 never changed these lines.

Lane A ran the head suite in exact mode ("Unit tests") and main's suite against this PR's lint configs ("Lint negative fixtures from the base ref …"). **Both were green.** The second step is the no-weakening proof for this PR's owned `eslint.config.mjs` and `tools/eslint-rules/*` changes.

## 4. Findings and carried follow-ups

**New in this round: none.**

Carried over unchanged from PR-0011, with the routing in its §6, §R2.6 and §R3.6. None blocks this merge.

| ID | Severity | Status | Owner |
|---|---|---|---|
| PR11-SEC-14 (b) dynamic-SQL allow-list; (c) rule-10 DO bodies | LOW | Open | TASK-024; TASK-021 |
| PR11-SEC-16 `E'…'` escape strings in `EXECUTE` operands | LOW | Open | TASK-024; principal-architect (§8.3 "Limits") |
| PR11-SEC-11 c (trigger event names), d (`readSecret` open-once), e (C1 scope), f (`expect-affected` → `error`), g (`runtimeReadOnly`) | INFO | Routed | c TASK-021 / TASK-051; d TASK-034; e TASK-037 / TASK-024; f TASK-051; g TASK-020 / TASK-024 |
| PR11-SEC-15 a, b, d, e, h, i | INFO | Routed | TASK-021; TASK-024 |
| PR11-SEC-17 a, b (`Sql` forge, lint binding flow); c (rule-11 tracking) | INFO | Open | TASK-020; TASK-024 / TASK-021 |
| PR11-SEC-09 items 3–4 activation at the `tx` slot; T-83 | (verification) | Routed | TASK-020 |
| DR-A14 sign-off (PR11-SEC-10) | (merge condition of TASK-037/049) | Routed | TASK-037 / TASK-049 |

The main-side PR #17 residuals are tracked in PR-0017 and D-ORCH-021, not here: PR17-SEC-02, -07, -08 and -10 go to TASK-015, and -09 is due before the first Wave-1 feature merge.

## 5. Record validation (main's checker)

**Setup.**
- Scratch `git clone --shared` of the main checkout, detached at `0f9ff27`.
- This record committed on top of it in the scratch clone only (docs-only commit).
- Checker: main's `tools/ci/check-security-owned-paths.mjs` @ `27b6f86`, which is identical at the head because the PR does not touch `tools/ci/`.
- Base: `27b6f86`.

| Run | Arguments | Expected | Result |
|---|---|---|---|
| A (control) | `0f9ff27` without this record, `--pr 18` | `missing` | `missing`, exit 1, 74 owned paths: "no record named …/PR-0018-*.md for PR #18". This reproduces the lane A failure |
| B | Record commit, `--pr 18` | `pass` | `pass`, exit 0, satisfied by `PR-0018-TASK-016-security-review.md` @ `0f9ff27`. The record commit changes no owned path |
| C (control) | Record commit, `--pr 11` | `missing` | `missing`, exit 1. The PR-0011 record's head rows name no commit of this range (`557aada`, `a3e8edd`, `37a2109`) |
| D (control) | Record commit, `--pr 12` | `missing` | `missing`, exit 1. The PR-0012 record does not name a commit of this PR |

**Merge conditions.**
- Lane A must be green on the record commit.
- If the record commit is not the merged head, every later commit must be docs-only.
- A later change to any of the 74 owned paths of this PR voids this record (checker rule (d)) and needs a delta round. This includes re-resolving `negative-fixtures.test.ts` against a later main.

**Merge-order note (D-ORCH-020).** PR #4 merges after this PR, and it also changes `tools/lint/negative-fixtures.test.ts` and `jest.config.ts`. Its delta round must confirm two things:
- its resolution keeps the `TENANT_DB` / `WARNINGS` cases;
- it keeps the §3 split: the weakening halves run in both modes, and only the `off` halves are exact-only.
