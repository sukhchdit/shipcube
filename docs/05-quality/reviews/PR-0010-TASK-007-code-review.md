# Code review: PR #10, TASK-007 (round 1)

- **PR:** #10 `feat/TASK-007-ci-lane-fast-lane-workflow`, head `28442b6` (12 commits on `7712c7c`, 2 of them merge-main)
- **Scope:** lane A workflow `.github/workflows/ci.yml` (`changes` → `fast-lane` → `ci-gate`), base-ref gate tooling `tools/ci/*` (workflow policy with the in-house YAML-subset parser, install flags, migration immutability, lockfile, dep-age, licence, audit, porcelain, security-owned paths, Semgrep runner), `.semgrep/*`, `.gitleaks.toml`, CODEOWNERS, Dependabot, git hooks, the suppression counter, `.gitignore` anchoring
- **Stories:** US-005 and US-048 (M0 Must); SPK-01 ubuntu half. This PR introduces hosted CI and merges before PR #9.
- **Reviewer:** code-reviewer · 2026-11-12 · bootstrap merge rule D-ORCH-004

```
VERDICT: CHANGES_REQUESTED
SUMMARY: A strong, well-built lane. Base-ref tooling, full-SHA and digest pins, least-privilege permissions, fail-closed CLIs (exit 0/1/2), pure cores
         with negative fixtures, and an honest run log. Lane A is green on 28442b6. Three MAJORs block approval:
         - M1: `npm ci --ignore-scripts false` and the npm install aliases defeat the install-flags and Dockerfile-order controls; lifecycle scripts run.
         - M2: the PR head can suppress Gitleaks through `.gitleaksignore` (loaded automatically, not security-owned) and `gitleaks:allow`.
         - M3: D-TASK007-08 assumes "PR title = squash header", but the repository settings do not enforce that, so commitlint can be bypassed.
FINDINGS: 3 MAJOR · 7 MINOR · 7 NIT (table in §3)
SECURITY-FLAGS: §6
```

## 1. Verification I performed myself

The dispatch forbade installs, builds, Docker and full suites (memory-constrained host, D-ORCH-010). I worked in a `git archive 28442b6` scratch copy, with `node_modules` junctioned from the TASK-007 worktree. Afterwards I removed the junction and checked that no link was left at `C:\`.

| Check | Result |
|---|---|
| `git diff origin/main...28442b6` (117 files) | read in full: workflow, every `tools/ci` checker core, `yaml-subset.mjs`, CODEOWNERS, Dependabot, hooks, `.gitleaks.toml`, `.semgrepignore`, the ignore files, `any-justification`. Tests and fixtures sampled. |
| `jest --selectProjects unit --testPathPatterns tools/ci/` (copy) | 12 suites, **240 / 240 pass** |
| `check-suppressions` and `tools/repo/gitignore` tests (copy after `git init`, which they need) | 2 suites, **105 / 105 pass** |
| Probe: npm 11.19.1 with `NPM_CONFIG_IGNORE_SCRIPTS=true`, `.npmrc ignore-scripts=true`, then `npm config get ignore-scripts --ignore-scripts false` | **`false`**: the CLI value overrides both the env and `.npmrc` (M1) |
| Probe: `segmentFindings` / `scriptFindings` on 13 command forms | `npm ci --ignore-scripts false`, `npm clean-install`, `ic`, `cit`, `it`, `sit`, `ins`, `instal`, `isnt`, `npm rebuild --ignore-scripts false`: **0 findings** in both checkers (M1) |
| gitleaks v8.30.1 source `cmd/root.go:317` (via gh api) | `<source>/.gitleaksignore` is loaded unconditionally; `--ignore-gitleaks-allow` exists, but lane A does not pass it (M2) |
| `gh api repos/sukhchdit/shipcube` | `allow_merge_commit: true`, `allow_rebase_merge: true`, `squash_merge_commit_title: COMMIT_OR_PR_TITLE` (M3). Branch protection and rulesets return **HTTP 403** on this plan (m6). |
| Probe: `parseYamlSubset` and `checkWorkflow` on `valid.yml` with a step hidden after a lone CR, NEL or U+2028 inside a comment line | the hidden step (`npx evil && npm install --ignore-scripts false` plus an env override) is invisible to both checkers: **0 findings** (m1). Prettier `check` flags the lone-CR file but passes NEL/U+2028. |
| Probe: temp repo with `/packages/authz/` owned; `git mv packages/authz/src/guard.ts packages/shared/src/` | `check-security-owned-paths`: **not-required, exit 0** (m2) |
| Action pins vs tags (`gh api …/git/ref/tags/…`) | checkout v7.0.1, setup-node v7.1.0 and cache v6.1.0 all match their SHAs |
| CI run 43268839024 log (head 28442b6) | unit **46 suites / 1205 tests**; base-ref lint suite 68 pass / 24 skipped; registry signatures 1490 verified; check-audit PASS; gitleaks 9 commits, no leaks; Semgrep self-test 5/5, scan 0 findings in 90 files; security-owned paths report-only (115 paths); ci-gate success |
| Not re-run by me | full `lint`, `format:check`, `typecheck`, `build`, `test:integration` (incl. `run-semgrep.int.test.ts`), coverage, actionlint. I relied on the CI run above and the author's local table. |

## 2. What is good (keep)

- **Base-ref execution of every checker**, with an honest summary table per tool ("base ref" or "head (bootstrap)"). The `--report-only` refusal reads the *base* tree, so a later PR cannot turn the record gate off by changing a flag.
- **Fail-closed design throughout:**
  - exit 2 on usage, registry or git errors;
  - an unrated OSV advisory counts as `high`;
  - a Semgrep scan that saw 0 files fails;
  - `isTestPass` needs both the exit code and the "All tests passed" banner;
  - missing or odd JSON fails.
- **Pure cores behind thin CLIs.** This makes the checkers testable without git or network: dep-age `--fetch` is CI-only, and the tests are offline.
- **Least privilege.** Top level is `contents: read`; `changes` gets `pull-requests: read`; `ci-gate` gets `{}`. Other points:
  - `persist-credentials: false`;
  - every `${{ }}` reaches scripts only through `env:` (no expression injection, including `PR_TITLE`);
  - Semgrep runs with `--network none`.
- **Strict YAML-subset parser.** It rejects anchors, aliases, merge keys, tags, flow mappings, multi-line scalars and duplicate keys rather than guessing. That is the right posture for a parser that must run before `npm ci`.
- **Released-migration immutability** is evaluated against the merge base, with `--no-renames` and NUL-separated output.
- **Waivers expire and fail again** (AT-US-048-07). A package with a maintenance exception cannot be waived. Lockfile overrides are capped at 30 days.

## 3. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| **M1** | **MAJOR** | `tools/ci/check-install-flags.mjs:115,133,136`; `tools/ci/check-workflow-policy.mjs:186` | **Lifecycle scripts can be re-enabled without detection.** (a) npm's flag parser consumes a following bare `true`/`false` for boolean flags. So `npm ci --ignore-scripts false` sets `ignore-scripts=false` and overrides both `NPM_CONFIG_IGNORE_SCRIPTS` and `.npmrc` (probe: `false`). Both checkers accept it: `--ignore-scripts` is "present", and the re-enable regexes only know the `=false` form and `--no-ignore-scripts`. (b) `INSTALL` misses npm's own aliases: `clean-install`, `ic`, `install-clean`, `isntall-clean`, `cit`, `clean-install-test`, `sit`, `it`, `ins`, `inst`, `insta`, `instal`, `isnt`, `isnta`, `isntal`. In a Dockerfile, `RUN npm clean-install` also skips `docker-install-order` and `docker-omit-optional`, and a Dockerfile stage has no workflow env to fall back on. This defeats the core control of the task: SEC-TC-32/45, am. J item 1 (c), D-ARCH-040. | Build `INSTALL` from npm's alias table: `ci`, `install`, `install-test`, `install-ci-test` and all their aliases from `npm/lib/utils/cmd-list.js`; pin the list in a test that compares against the installed npm's `aliases`. Treat `--ignore-scripts` followed by a bare `false`/`0`/`no`/`off` token (and `--ignore-scripts=` with an empty value) as re-enabling, in **both** checkers. Add `npm rebuild` with the same forms to the workflow and package.json scope. Add negative fixtures for each form, plus a Dockerfile `RUN npm clean-install` in a stage without `.npmrc`. |
| **M2** | **MAJOR** | `.github/workflows/ci.yml:290-298`; `.github/CODEOWNERS`; `tools/lint/check-suppressions.mjs:52-53` | **The PR head can suppress Gitleaks.** The workflow says "a PR cannot widen its own allowlist", but: (a) gitleaks loads `/repo/.gitleaksignore` from the scanned source unconditionally (`cmd/root.go:317`). A PR can add fingerprints there, and the file is **not** security-owned and not seen by the suppression counter. (b) `gitleaks:allow` is honoured because `--ignore-gitleaks-allow` is not passed. The suppression counter only scans the *head tree*, in JS/CSS/YAML/TOML/sh files, and excludes `docs/` and `.claude/`. So a secret plus `gitleaks:allow` in a `.md`, `.json` or `.env` file, or in an intermediate commit that is reverted later, passes the "Committed secret is detected" scenario (US-048). | Pass `--ignore-gitleaks-allow`. Fail the step when `.gitleaksignore` exists anywhere in the head tree or the PR range: gitleaks reads the source copy whatever `--gitleaks-ignore-path` says. Add `/.gitleaksignore` to CODEOWNERS and `REQUIRED_CODEOWNED_PATHS`. Add a test (static at least; ideally a temp-repo int test with the pinned image) where an AWS-key-shaped value with `gitleaks:allow` in `docs/x.md` fails. |
| **M3** | **MAJOR** | `.github/workflows/ci.yml:231-245`; D-TASK007-08; repository settings | **The commitlint premise is not enforced.** D-TASK007-08 lints only the PR title, on the grounds that "merges use Squash and merge" with the PR title as the header. The repository allows merge commits and rebase merges, and `squash_merge_commit_title` is `COMMIT_OR_PR_TITLE`. For a **single-commit** PR GitHub therefore uses that commit's subject, which lane A never lints, and the commit-msg hook is opt-in and bypassable. A merge-commit or rebase merge lands every PR commit unlinted. Two related gaps: there is no `edited` trigger, so a title changed after a green run lands unchecked; and the commitlint step is skipped on docs-only PRs (`if: env.CODE == 'true'`), whose titles still become main headers. CLAUDE.md §2 says "commitlint in CI". | Make the premise true and record the evidence in DECISIONS.md: `gh api -X PATCH repos/sukhchdit/shipcube -f squash_merge_commit_title=PR_TITLE -F allow_merge_commit=false -F allow_rebase_merge=false`. Then do one of: (i) also lint the single commit when the PR has exactly one; or (ii) rely on the setting and add "title unchanged since the last green run" to the gatekeeper merge checklist. Run the title lint on docs-only PRs too: it only needs the root devDeps, or a 1-step `npm ci` on the docs path; alternatively, document the gap. **This MAJOR can be closed by the settings change and the DECISIONS entry alone.** |
| m1 | MINOR | `tools/ci/yaml-subset.mjs:44-50,329` | **Line-break differential.** The parser splits only on `\r?\n`. A lone CR, NEL (U+0085), LS (U+2028) or PS (U+2029) inside a comment line hides everything after it from the parser (and from `check-install-flags`, which breaks at `#`). libyaml-family parsers treat these as line breaks: actionlint's go-yaml, and YamlDotNet, which I have not verified on GitHub's runner. Probe: a hidden step with `npx` and `--ignore-scripts false` gives 0 findings. Prettier catches the lone-CR form, but not NEL/LS/PS. A second, benign, quote differential: `x: echo "a # b"` parses as `echo "a # b"`, while YAML gives `echo "a`. | In `parseYamlSubset`, reject any `\r` not followed by `\n`, any U+0085/U+2028/U+2029, and C0 control characters other than TAB in the source (fail closed, rule `yaml-subset`). Add fixtures. Optionally, in the unit suite (post-install), add a differential over the repository workflows against the `yaml` package (already in the lock, ISC). |
| m2 | MINOR | `tools/ci/check-security-owned-paths.mjs:161,192,117` | (a) **Renames out of an owned path escape.** `git diff --name-only` reports only the post-image path of a rename, so moving `packages/authz/src/guard.ts` to `packages/shared/src/` reports `not-required` (probe). (b) **Merge-main invalidates records.** `changedSince(commit)` diffs the reviewed commit against head *including the main changes brought in by merge-main*. Every PR merges main after review, so any owned path changed on main (lockfile, CODEOWNERS, `tools/ci` after this PR) voids the record, which means needless re-reviews and rubber-stamp pressure. | Use `--no-renames` in both diffs. Compute `later` as `ownedPaths(changedSince(commit)).filter(p => owned.includes(p))`, i.e. only the owned paths this PR changes net vs the merge base. Add a temp-repo test for each case. |
| m3 | MINOR | `ci.yml:258-280`, `:304-310`, `:86`; `.semgrepignore` | **Base-ref controls still run head-controlled pieces.** (a) The base copy of `negative-fixtures.test.ts` runs the **head** harness `tools/lint/lint-fixtures.mjs` and `tools/test-support/process.ts` under the head `jest.config.ts`. (b) The `lint_controls` classifier ignores `tools/test-support/` and `jest.config.ts`, so changing them does not trigger the base-ref suite. (c) The Semgrep scan uses base rules but the **head** `.semgrepignore`, so a PR can narrow the scan scope. Only the "0 files" case fails closed. | Check out `tools/lint/lint-fixtures.mjs` and `tools/test-support/` from the base along with the suite. Add `jest.config.ts` and `tools/test-support/` to the classifier regex. Extract `.semgrepignore` from the base, bind-mount it over `/src/.semgrepignore`, and fall back to the head copy while bootstrapping. Correct the `run-semgrep.mjs:6-8` wording until then. |
| m4 | MINOR | `.github/CODEOWNERS`; `check-workflow-policy.mjs:446-458` | **Coverage gaps in the security-owned set.** These files weaken a gate and have no owner: `.gitleaksignore` (M2), `jest.config.ts` (it can drop the checker tests and the negative-fixture suite from the unit project), `tsconfig.base.json` / `tsconfig*.json` (strict mode, CLAUDE.md §2), `commitlint.config.mjs`, `.prettierignore`, `tools/test-support/`, `.node-version`. | Add them to CODEOWNERS and to `REQUIRED_CODEOWNED_PATHS`, and extend the test. |
| m5 | MINOR | `ci.yml:14-37,50-95,319-321` | **Minutes and the push lane.** (a) `changes` and `ci-gate` each bill a full minute (per-job rounding), about 2 of the 5–7 billable minutes per run. `fast-lane` already clones with `fetch-depth: 0`, so `git diff --name-only "$RANGE_BASE...$RANGE_HEAD"` gives the same list with no API call and no extra job. (b) `cancel-in-progress: true` also applies to pushes to main: a newer push cancels the older run, and the newer run's `before..after` range never gitleaks/commitlint-scans the cancelled push's commits. (c) The push `paths` filter omits root controls: `eslint.config.mjs`, `stylelint.config.mjs`, `tsconfig*.json`, `jest.config.ts`, `.semgrep/**`, `.gitleaks.toml`, `.gitignore`, `.semgrepignore`, `.node-version`, `commitlint.config.mjs`. (d) `ci-gate` uses `always()`, so a superseded, cancelled run posts a red ci-gate. | (a) Fold the classification into `fast-lane` as its first step; keep `ci-gate` only while it buys something (see m6), or record the 1-minute cost as accepted. (b) Use `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`. (c) Use `paths-ignore: [docs/**, .claude/**, '**/*.md']`, mirroring the classifier. (d) Use `!cancelled()`. Re-measure minutes after the change. |
| m6 | MINOR | PR body "ci-gate is the single required check"; D-ORCH-004 | Branch protection and rulesets return **403** on this private free-plan repository, so no check can be *required*. The workflow runs from the PR head, so a PR can edit `ci.yml` to make `ci-gate` trivially green. The only guard is the security record for `.github/`. A draft PR gets a *skipped* `ci-gate`, which GitHub reports as passing. | Record in DECISIONS.md that lane A gating is procedural. Add to the gatekeeper merge checklist: (1) a ci-gate success on the **exact** head SHA from a non-draft run; (2) any `.github/**` change carries a security record; (3) M3's title check. Correct the PR body wording. |
| m7 | MINOR | `tools/ci/check-audit.mjs:49-58`; US-048 outline row 2 | **Waivers have no maximum horizon** (`expires: 2099-…` is accepted), unlike overrides (≤ 30 days). The implementation also deliberately differs from the AC row "Critical vulnerability with no fix → **passes** and is tracked with a due date": a dated waiver is required first (D-TASK007-01 (02)). | Cap the waiver span (granted→expires, e.g. ≤ 90 days, with a `granted` field) and add a negative fixture. Ask the product-manager to align the US-048 outline row with D-TASK007-01 (02); I accept the stricter behaviour (§4). |
| n1 | NIT | `tools/eslint-rules/any-justification.mjs:9`; `check-suppressions.mjs:52` | `\bTASK-\d{3}\b` rejects four-digit IDs. | Use `\d{3,}`. |
| n2 | NIT | `tools/ci/check-install-flags.mjs:36-47` | `SKIP_DIRS` matches the folder name at any depth (`fixtures`, `generated`, `docs`, `build`, `dist`). This is the same un-anchored class that this PR fixes in `.gitignore`. | Anchor these to the known roots (`tools/ci/fixtures`, `tests/fixtures`, `prisma/generated`, …). |
| n3 | NIT | `ci.yml:55,98` | `ubuntu-latest` moves to Ubuntu 26 (run annotation), and the Prisma engine cache key uses only `runner.os`. | Pin `ubuntu-24.04`, or add `env.ImageOS` to the cache key. |
| n4 | NIT | `tools/hooks/pre-commit:13-19` | The hook checks working-tree content, not the staged blob, so partial staging can pass or fail wrongly. | Acceptable for a convenience hook; document it, or use `git stash --keep-index`. |
| n5 | NIT | `.github/CODEOWNERS:33` | `/tools/db/lint-migrations.ts` column alignment is off by two. | Cosmetic. |
| n6 | NIT | `check-workflow-policy.mjs:429`; `ci.yml:143-152` | Local `./` actions are neither walked nor policy-checked. A base checker runs with head-supplied CLI arguments, so changing a checker's CLI needs a two-step change. | Document both in a short `tools/ci/README.md` (or ADR-0023 note) before TASK-015 adds workflows or actions. |
| n7 | NIT | `ci.yml:77` | The PR files API caps at 3000 files. The list cannot be classified wrongly (an all-docs truncated list is implausible), but m5 (a) removes the cap entirely. | Covered by m5 (a). |

## 4. Deviation rulings

| Item | Ruling |
|---|---|
| D-TASK007-01 (02): a Critical/High with no fix needs a dated waiver (AC says "passes and is tracked") | **Accepted.** It is stricter and logged. The product-manager should align the outline row (m7). |
| Registers (`advisory-watchlist`, `maintenance-exceptions`, `licence-exceptions`, `dependency-overrides`) are read from the head | **Accepted by design.** Exceptions are PR data and are protected by the security-owned record (`/tools/ci/`). m2 and m4 make that guard sound. |
| In-house YAML-subset parser instead of `yaml` | **Accepted.** The policy check runs from the base *before* `npm ci`, so no `node_modules` is available. The strict-reject scope is adequate for our block-style workflows. Conditional on m1 (line-break rejection). |
| `--report-only` for the record check on this PR | **Accepted.** It is refused once the base contains the script. |
| D-TASK007-08: no `edited` trigger (minutes) | **Accepted only together with M3**: the PR_TITLE setting plus the gatekeeper title check. |
| `security-integration` job (sheet DoD line) | Not in scope: TASK-015 per WAVE-00 batch 0.5 and ADR-0023 am. G item 5. |
| AT-US-005-02/-04/-06 asserted as their lane A parts only | **Accepted.** The titles are honest; the lane C parts belong to TASK-015. |

## 5. Follow-up closure (routed items I verified)

- **PR #2, `.gitignore` anchoring (R2-m1, PR2-SEC-11):** CLOSED. `gitignore.test.ts` passes both directions (105 / 105 with check-suppressions).
- **PR #2, Stylelint/ESLint ignore symmetry (R2-n8):** CLOSED.
- **PR #2, Semgrep backstop for aliased `createRequire`:** CLOSED. The `password-hashing` self-test passes in the CI log.
- **PR #8, migration-immutability check vs origin/main (R2-n3):** CLOSED. It is merge-base based and runs from the base ref.
- **PR #1, `check-lockfile` link-entry semantics (R2-n4):** CLOSED in code. Link entries carry a workspace `resolved` and no integrity. DECISIONS L918 stays as written, since the file is append-only.
- **PR #2, TASK-015 m7 (any-justification TASK ID):** partly closed here. `any-justification` requires `TASK-\d{3}`, and the suppression counter covers `@ts-expect-error` and the coverage ignores.

## 5a. Merge conditions

1. Fix M1 and M2 in-PR, each with negative fixtures. Close M3 by the settings change plus a DECISIONS entry (code optional).
2. Round 2 re-checks M1–M3, plus whichever MINORs the author fixes in-PR. MINORs not fixed in-PR need an owner:
   - m1, m2, m3, m4 and m7: TASK-007 fix cycle preferred, else TASK-015;
   - m5 and m6: TASK-007 or the orchestrator.
3. The security-analyst record for PR-0010 must exist before merge. This PR runs the record check in report-only mode (115 owned paths).
4. Lane A must be green on the fix head. After merge, the first enforced PR is PR #9. It changes owned paths (`package*.json`), so it needs its own record before the base-ref gate goes green.

## 6. Security flags (for security-analyst)

- **M1:** supply-chain install hardening bypass. CWE-829 / CWE-1357; OWASP A08:2021 (Software and Data Integrity Failures).
- **M2:** secret-scan suppression by the PR head. CWE-540 / CWE-798; A05/A07.
- **m1:** invisible-character parser differential that can hide workflow content from the policy and from human review.
- **m2:** rename-based evasion of the security-review record.
- **m3:** the head `.semgrepignore` narrows the base-rule scan.
- **m6:** no enforceable required checks on this plan; the workflow runs from the PR head.

## Round 2 (head 26fc08d)

- **Head:** `26fc08d`. Code delta `28442b6..a88aaea`: `1cff9ac` (fix), `a88aaea` (suppression-counter wording), and `cc7c598` (merge-main, docs only).
  - `26fc08d` is a docs-only merge of `origin/main` (`c29f89b`). I checked `git diff --quiet a88aaea 26fc08d -- . ':!docs' ':!.claude'`: it is empty.
- **Inputs:** fix comment #6832420637; D-TASK007-02, D-ORCH-012/013.
- **Reviewer:** code-reviewer · 2026-11-13.

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: All three round-1 MAJORs are closed.
         - M1: verified against npm 11.19.1 itself.
         - M2: only .git mounted, --ignore-gitleaks-allow, first-parent merge diffs.
         - M3: closed procedurally (D-ORCH-012/013, settings change denied).
         m1, m2, m4, m5, m6 and m7 are closed; m3 is partly closed. Lane A run 43279941688 is green on 26fc08d.
         Four new MINORs, none a merge blocker:
         - R2-m1: npm reify commands are outside the install scope.
         - R2-m2: the new policy rules are regression tripwires that trivial edits defeat.
         - R2-m3: Semgrep 1.183 honours nested .semgrepignore files.
         - R2-m4: `${{ env.* }}` launders untrusted input past untrusted-expression.
FINDINGS: 0 BLOCKER · 0 MAJOR · 4 MINOR · 8 NIT (table in R2.3)
SECURITY-FLAGS: R2.6
```

### R2.1 Verification I performed myself

The dispatch forbade installs, builds, Docker and full suites, and any command in the TASK-007 worktree. I worked in a `git archive a88aaea` scratch copy (from the main repo), with `node_modules` junctioned from the worktree. Afterwards I removed the junction and the copy. The worktree still has 740 `node_modules` entries, and there is no link at `C:\`.

| Check | Result |
|---|---|
| `git diff 28442b6..a88aaea` (62 files) | Read in full: `ci.yml`, `npm-command.mjs`, `check-install-flags.mjs`, `check-workflow-policy.mjs`, `check-security-owned-paths.mjs`, `yaml-subset.mjs`, `check-audit.mjs`, `run-semgrep.mjs` and CODEOWNERS. Tests and fixtures sampled. |
| Unit tests, one file at a time (copy) | `npm-command` 70/70, `check-workflow-policy` 74/74, `check-install-flags` 53/53, `yaml-subset` 14/14, `check-audit` 27/27, `ci-policy` 20/20, `run-semgrep` 14/14.<br>`check-security-owned-paths`: 62/63. The one failure is the record-format tripwire, which runs `git ls-files` and has no git root in an archive copy (a known false failure). I ran its logic myself on the committed records (next row). |
| Record format over `docs/05-quality/security/PR-*.md` on main (`recordVerdict` / `recordHeadShas`) | PR-0001..0008, 0010 and 0011 parse as PASS_WITH_FOLLOW-UPS with head SHAs. PR-0009 parses as **FAIL** (its current last verdict). PR-0010 names only `28442b6`, so it is stale for this head (merge condition 2). |
| **M1 probe:** the 13 round-1 forms through `segmentFindings`, `checkDockerfile` and `scriptFindings` | All 13 are now reported. Plain `npm clean-install`, `ic`, `cit`, `it`, `sit`, `ins`, `instal`, `isnt`, `install-clean`, `isntall-clean` and `clean-install-test` fail `install-flags` and `docker-install-order`; the workflow policy correctly relies on the workflow env for these. `npm rebuild --ignore-scripts false` gives `install-flags` + `docker-npm-rebuild`. |
| **M1 probe:** 13 override forms | All are reported by **both** checkers: `--ignore-scripts false`, `=false`, `=`, `--no-ignore-scripts`, `npm --ignore-scripts false ci`, a later occurrence winning, `-ig false`, `--ig false`, `--no-ignore`, a TAB before `false`, quoted words, the `NPM_CONFIG_IGNORE_SCRIPTS=false` prefix, and `env npm_config_ignore_scripts=false`. |
| npm 11.19.1 ground truth: `NPM_CONFIG_IGNORE_SCRIPTS=true npm config get ignore-scripts <form>` | `false` for `--ignore-scripts false`, `-ig false`, `--ig false`, `--ignore-script=false`, and `=true … --ignore-scripts false`.<br>`true` for `--ignore-scripts FALSE`/`=0`/`=`/`=no`/`=False`, `--no-ignore-scripts false`, and `--ignore_scripts=false` (unknown key).<br>So every form npm honours as false is caught. The extra forms the module reports (the `true` cases above) are fail-closed false positives, which is acceptable. |
| Drift test vs npm's `cmd-list.js` (npm next to node, 11.19.1) | It passes. npm 11.19.1 also adds `install-scripts`, `approve-scripts` and `deny-scripts`. None of them installs, and `--ignore-scripts` still overrides `allow-scripts` and `--dangerously-allow-all-scripts` (definitions.js). |
| **m1 probe:** NEL, and a lone CR plus a hidden step, inside a comment line of the real `ci.yml` | Both give a `yaml-subset` finding. |
| **M2:** gitleaks v8.30.1 `sources/git.go` (gh api) | `git -C <src> log -p -U0 <log-opts>`, with no `--text` and no `--no-textconv`. |
| **M2, new vector checked:** a `.gitattributes` with `docs/** -diff` and an AWS-key-shaped value in `docs/x.md` (local git 2.52) | With the full worktree (round-1 mount), `git log -p` prints `Binary files … differ` and **the secret is hidden**. With only `.git` (round-2 mount), the secret line is printed. So the `.git`-only mount also closes an attribute-based evasion that round 1 did not list. The `gitleaks-hardening` mount rule is what locks this in (but see R2-m2). |
| Mutation probe on the real `ci.yml` (`checkWorkflow(…, {requiredGates:true})`) | **0 findings** for each of:<br>• `… \|\| true` on the workflow-policy step and on the record step;<br>• `mode=(--event push)` on the record step;<br>• gate tooling redirected to the head tree;<br>• `node tools/ci/evil.mjs` or `bash ./x.sh` in `scans`;<br>• `GATES_DIR=$GITHUB_WORKSPACE`;<br>• gitleaks with `--mount …src=$GITHUB_WORKSPACE` or `-v "$PWD:/repo"`;<br>• gitleaks `--exit-code 0`.<br>This is R2-m2. |
| Probe: `untrusted-expression` | `${{ github.event.pull_request.title }}` in `run:` is reported. `env: PR_TITLE: ${{ …title }}` followed by `run: echo "${{ env.PR_TITLE }}"`: **0 findings**. `${{ steps.x.outputs.title }}`: 0 findings. This is R2-m4. |
| Semgrep 1.183.0 CHANGELOG (gh api, tag v1.183.0) | 1.117.0: "Target file selection now uses Semgrepignore v2 by default … There can now be multiple `.semgrepignore` files in the project." This is R2-m3. |
| `patternToRegExp('**/tsconfig*.json')` | It matches `apps/api/tsconfig.json`. It does **not** match root `tsconfig.json` or `tsconfig.lint.json`; GitHub's CODEOWNERS does (R2-n2). |
| CI run 43279941688 (head `26fc08d`, pull_request) | fast-lane success (3m02s), scans success (34s), ci-gate success. Unit **48 suites / 1393 tests**; base-ref lint negative fixtures 68 pass / 24 skipped; gitleaks **15 commits scanned**, no leaks; Semgrep 0 findings in **91 files**, scope from base; record check report-only (143 owned paths, bootstrap). `gh pr view 10` shows the same three checks green on `26fc08d`. |
| `gh variable list` | Empty: `CI_MAIN_FAST_LANE` is not set, so the push lane does not run today. |
| Not re-run by me | Full `lint`, `format:check`, `typecheck`, `build`, `test:integration` (including `run-semgrep.int.test.ts`), actionlint, the Docker gitleaks probe and coverage. I relied on the CI run above and the author's local table. |

### R2.2 Closure of round-1 findings

| ID | Status | Evidence |
|---|---|---|
| **M1** | **CLOSED** | `npm-command.mjs` is shared by both checkers. The word table equals npm 11.19.1's deref set and is pinned by a drift test. All 26 probe forms are reported (R2.1), and npm's own parser agrees on every form that sets the flag to false. Dockerfile `docker-install-order` now fires for every install alias. Residuals: R2-m1 (reify commands) and R2-n1. |
| **M2** | **CLOSED** | Gitleaks runs in the isolated `scans` job with only `.git` mounted, `--ignore-gitleaks-allow`, `--diff-merges=first-parent` and `--network none`. The policy rejects a committed `.gitleaksignore` anywhere, and the file is CODEOWNED. The author's run of my round-1 probe gives 5 of 5 findings. The CI log shows merges scanned (15 commits). The `.git`-only mount also neutralises `.gitattributes -diff` (R2.1). Residual: the static mount rule is bypassable (R2-m2). |
| **M3** | **CLOSED (procedural)** | The settings change was denied (D-ORCH-012). The substitute control is recorded in D-ORCH-012/013 and the ci.yml header: only the orchestrator merges, always `--squash --match-head-commit <sha> --subject "<linted subject>"`, after ci-gate `success` on that SHA. That makes every main header linted, whatever the title or commit count. commitlint now also runs on docs-only PRs. The settings change stays with the repository owner (run summary). |
| m1 | CLOSED | `FORBIDDEN_CHAR` rejects lone CR, NEL, LS, PS, C0 (other than TAB) and a non-leading BOM. 14 tests; my probe on the real ci.yml agrees. Residual: R2-n4 (compose files). |
| m2 | CLOSED | `--no-renames` on every diff; `later` is intersected with the PR's net owned set; the `--pr` binding; the last-Verdict allow-list; SHAs from head rows only. 63 temp-repo tests (62 run green here, plus the git-root false failure). |
| m3 | **PARTLY CLOSED** | (a) the harness and `tools/test-support` come from the base. (b) The classifier counts `jest.config.ts` and `tools/test-support/`. (c) The base root `.semgrepignore` and `.gitignore` are bind-mounted. But nested `.semgrepignore` files from the head still narrow the scan (R2-m3). |
| m4 | CLOSED | The CODEOWNERS additions and `REQUIRED_CODEOWNED_PATHS` match the request, plus the agent control plane. Residuals: R2-n2 (record-check `**/` at the root) and R2-n3 (`.gitattributes`). |
| m5 | CLOSED | (a) The `changes` job is folded into fast-lane (git diff, no API, no file cap; closes n7). (b) Concurrency is per PR, and per SHA on push. (c) Push uses `paths-ignore`. (d) ci-gate runs on `!cancelled()` and fails on a skipped lane. About 6 billable job-minutes (was about 7). Residual: R2-n5. |
| m6 | CLOSED (procedural) | The ci.yml header and the PR body wording are corrected. D-ORCH-013 adds the exact-SHA / record checks to the merge procedure. Draft PRs get a red ci-gate. |
| m7 | CLOSED | A waiver needs a `granted` date that is not in the future, at most 90 days to `expires`, and a `^D-[A-Z0-9]+-\d+$` decision. Violations exit 2. Fixtures at 90 days (pass) and 91 days (exit 2). The US-048 outline-row wording stays with the product-manager. |
| n1 | Open, routed | TASK-015 (four-digit TASK IDs). |
| n2 | CLOSED | `SKIP_ROOTED` anchored, with a temp-tree test. |
| n3 | CLOSED | `ubuntu-24.04` pinned on all three jobs. |
| n4 | Open, accepted | Convenience hook; opportunistic. |
| n5 | CLOSED | CODEOWNERS realigned. |
| n6 | CLOSED | The two-step CLI change is documented in the ci.yml header. Local `./` actions are still not walked; TASK-015 must revisit this when it adds actions. |
| n7 | CLOSED | By m5 (a). |

### R2.3 New findings (round 2)

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R2-m1 | MINOR | `tools/ci/npm-command.mjs:22-74`; `check-install-flags.mjs:226-248` | **npm reify commands are outside the install scope.** `update`/`up`/`u`/`upgrade`/`udpate`, `dedupe`/`ddp`, `uninstall`/`un`/`rm`/`r`/`remove`/`unlink`, `link`/`ln` and `audit fix` all call Arborist `reify()`. That builds added nodes, so it runs their install scripts unless ignore-scripts is set. Probe: all of them give **0 findings** in a Dockerfile stage without `.npmrc`, where no workflow env applies. A related gap: `npm ci --ignore-scripts $NO` (or `"${X}"`) is accepted, although npm consumes an expanded `false`. M1 is closed as specified; this is the next class. | Add a `REIFY_COMMANDS` set (`update`, `dedupe`, `uninstall`, `link`, plus `audit` when followed by `fix`) to the drift test and require canonical `--ignore-scripts` on them, as for installs. Alternatively, forbid them in Dockerfiles. Treat a word after a bare `--ignore-scripts` that contains `$` or a backtick as an override. Add negative fixtures. In-PR, or route to TASK-015 before lane C builds images. |
| R2-m2 | MINOR | `tools/ci/check-workflow-policy.mjs:115-136` (`CI_REQUIRED_GATES`), `:337-353` (`gitleaksFindings`), `:578-592` (`scansStepViolations`) | **The new policy rules are regression tripwires, not controls.** Each passes with 0 findings after a one-token edit (R2.1):<br>• `required-gates`: patterns are unanchored, so `… \|\| true`, `--event push` on the record step, or redirecting `GATE_*` to the head all pass;<br>• `gitleaks-hardening`: only `-v`/`--volume` sources containing `GITHUB_WORKSPACE` are examined, so `--mount …src=$GITHUB_WORKSPACE`, `-v "$PWD:/repo"` and `--exit-code 0` pass. That matters for TASK-015's lane C workflows too: a `$PWD` mount re-opens M2;<br>• `scans-isolation`: only `$GITHUB_WORKSPACE/<x>.(js\|ts\|sh)` counts, so `node tools/ci/x.mjs` and `bash ./x.sh` from the head pass.<br>Deliberate edits are still caught procedurally, because every `.github/**` change needs a security record (m6, D-ORCH-013). D-TASK007-02 (11) and the fix comment describe these rules as "enforced", which overstates them. | Harden the cheap cases:<br>• required-gate `run:` must be exactly the gate line (anchored), with no `\|\|`, `;`, `set +e`, `--report-only` or `--event`;<br>• the `GATE_*` assignment step is itself a required gate;<br>• gitleaks requires `--exit-code 1` and rejects any mount (`-v`, `--volume`, `--mount`) whose source is not `…/.git` (including `$PWD`, `.` and `${{ github.workspace }}`);<br>• `scans` allows `node` only on `"$GATE_*"` and forbids `bash\|sh <path>` and `./`.<br>Reword D-TASK007-02 (11) / the ci.yml header to say "regression tripwire; adversarial edits are covered by the `.github/` record". In-PR or TASK-015. |
| R2-m3 | MINOR | `ci.yml:369-370`; `tools/ci/run-semgrep.mjs:97-117` | **m3 (c) residual: nested `.semgrepignore`.** Semgrep 1.183.0 uses Semgrepignore v2 (since 1.117.0), which honours `.semgrepignore` files in subdirectories. The base root file is bind-mounted, but a head `apps/api/.semgrepignore` containing `*` still removes that subtree. The scan stays green unless the total reaches 0 files. The fix comment's "a PR cannot narrow it" is therefore not true yet. | Fail closed on any `.semgrepignore` other than the root one. This can be a repository-mode policy rule, like `gitleaksignore`, and a run-semgrep pre-check that lists them from the scanned tree. Alternatively, pass `--x-semgrepignore-filename` with a name the base controls. Extend `run-semgrep.int.test.ts` with a nested-file negative control. In-PR or TASK-015. |
| R2-m4 | MINOR | `tools/ci/check-workflow-policy.mjs:108-109` (`SAFE_EXPRESSION`) | **`untrusted-expression` can be laundered through `env.*`** (also `steps.*.outputs` and `needs.*.outputs`). Writing `env: { T: ${{ github.event.pull_request.title }} }` and then `run: echo "${{ env.T }}"` is script injection: the expression is expanded into the script text before the shell runs. Probe: 0 findings. GitHub's hardening guide says to use `"$T"`, never `${{ env.T }}`. ci.yml has no instance today; the rule is new in this PR (PR10-SEC-07). | Remove `env.*` from `SAFE_EXPRESSION`; there is no reason to interpolate env in `run:`. Keep `steps`/`needs` outputs allowed only for an explicit allow-list of output names, or require them through `env:` too. Add the laundering fixture. |
| R2-n1 | NIT | `tools/ci/npm-command.test.ts:45-53` | The drift test asserts **equality** with the npm that runs the suite. Safety only needs `INSTALL_WORDS ⊇ npm's set`, because extra words are harmless false positives. With `engines.npm >=11.10`, a contributor on an older npm 11.x with a different alias table gets a red unit suite. | Assert the superset, and log extra words as informational. Alternatively, pin the npm version in the test name and skip with a clear message on a different minor. |
| R2-n2 | NIT | `tools/ci/check-security-owned-paths.mjs:68-78` | `patternToRegExp('**/tsconfig*.json')` requires a `/` before the file name, so a new **root** `tsconfig.*.json` is owned by GitHub's CODEOWNERS but not by the record check. Today's root files are listed explicitly. | Map a leading `**/` to `(?:.*/)?`, and add a test. |
| R2-n3 | NIT | `.github/CODEOWNERS` | `.gitattributes` is not owned. Today its `-diff`/`binary` effects on gitleaks are neutralised by the `.git`-only mount (R2.1). It can still mark paths `linguist-generated`, which collapses their diffs in the PR review UI, and affect any future `git diff -p`-based check. | Add `/.gitattributes` to CODEOWNERS and `REQUIRED_CODEOWNED_PATHS`. |
| R2-n4 | NIT | `tools/ci/check-install-flags.mjs:93-124, 181-191` | The m1 line-break rejection applies only to workflows (yaml-subset). Compose files, which check-install-flags reads as plain text split on `\r?\n`, and Dockerfiles can still hide a command behind NEL/LS/PS or a lone CR inside a comment. | Run the same `FORBIDDEN_CHAR` test (export it from `yaml-subset.mjs`) on every file check-install-flags reads. |
| R2-n5 | NIT | `ci.yml:24-30, 361` | Push `paths-ignore` (m5 (c)) means a docs-only push to main is never secret-scanned. The orchestrator pushes `docs/` and `.claude/` straight to main. The `-1 $RANGE_HEAD` fallback scans one commit only. This is moot while `CI_MAIN_FAST_LANE` is unset. | Before enabling the push lane, either drop `paths-ignore` for `scans` (job-level `if` on the classifier instead), or add a scheduled or dispatch-only full-history gitleaks run in TASK-015. |
| R2-n6 | NIT | `ci.yml:250-271` | The base-ref negative-fixture step takes `tools/test-support/` from the base but `jest.config.ts` from the head. A PR whose head jest config references a new test-support file fails this step, a false failure that needs a two-step change. | Document it next to the n6 note in the header, or take `jest.config.ts` from the base as well when `LINT_CONTROLS` is set. |
| R2-n7 | NIT | `tools/ci/ci-policy.test.ts`; `check-workflow-policy.test.ts` | The M2 behaviour (allow marker, `.gitleaksignore`, merge-only secret) is proven only by the author's manual Docker probe. The suites assert the invocation text. | TASK-015: a lane C integration test that runs the pinned gitleaks image over a temp repo with those three cases (round 1 asked for this "ideally"). |
| R2-n8 | NIT | `ci.yml:21-23, 336-340` | Bootstrap and `RECORD_MODE=report-only` are keyed on "the base lacks the script", which is also true of any PR that **targets** a branch forked before this merges. `pull_request` has no `branches:` filter, so such a PR runs head tooling and a report-only record check. | Add `branches: [main]` under `pull_request`. Alternatively, enforce when `github.base_ref != 'main'`. |

### R2.4 Deviation rulings (round 2)

| Item | Ruling |
|---|---|
| M3 closed procedurally instead of through repository settings (D-ORCH-012/013) | **Accepted.** The explicit, pre-linted `--subject` makes the main header independent of the PR title and commit count, which is stronger than PR_TITLE alone. The settings change stays recommended to the owner. |
| Gate scripts bootstrapped from **head git objects** while the base lacks them | **Accepted as safe for this PR only.** On a fresh runner, nothing has run before the extraction, so the git objects and the working tree are equally head-controlled. Bootstrap trusts the head by definition. The run summary labels it, the record check is report-only, and the security record plus the D-ORCH-013 merge procedure cover it. After merge, every one of the five paths and both scripts exist on main, so the base branch is taken. R2-n8 covers non-main bases. |
| `scans` on its own runner (≈ +1 billable minute), offset by dropping `changes` | **Accepted.** Net about 6 job-minutes per run, measured. |
| commitlint on docs-only PRs costs an `npm ci` | **Accepted** (round-1 M3 ask). |
| Last-Verdict-row contract, head-row SHA binding, `PR-<nnnn>` naming | **Accepted.** All committed records parse (R2.1). Format note for later security rounds: a round-2 FAIL written as prose or in a blockquote is ignored, and the earlier table verdict wins. Security-analyst must always append a new header table. I am recording this in the review conventions; the mechanism needs no change. |

### R2.5 Merge conditions

1. No BLOCKER/MAJOR is open. Fix R2-m1..m4 in this PR, or route them to **TASK-015** before lane C (images, more workflows) lands. R2-m2 and R2-m3 are prerequisites for any new workflow or Semgrep scope change.
2. **Security record:** `docs/05-quality/security/PR-0010-*.md` must append a round-2 header table with a `| Head |` row naming `26fc08d` (or the final head) and a last `| **Verdict** |` of PASS / PASS_WITH_FOLLOW-UPS / PASS_WITH_CONDITIONS. The current record names only `28442b6`, after which owned paths changed.
3. **Merge procedure (D-ORCH-013):** run `gh pr merge 10 --squash --match-head-commit <sha> --subject "<subject linted with commitlint>"` only after ci-gate `success` on that exact SHA. A docs-only commit for the security record moves the head and needs its own green run.
4. **After merge:** PR #9 is the first PR under the enforced record gate. Its record's last Verdict currently parses as **FAIL** (PR-0009), so lane A will fail it until a passing round-2 header table names its head. That is expected, and is not a defect of this PR.
5. Routed items: R2-n1 and R2-n2 (in-PR or TASK-015); R2-n3 (TASK-015); R2-n4 (TASK-015); R2-n5 (before `CI_MAIN_FAST_LANE=true`); R2-n6 (documentation); R2-n7 (TASK-015); R2-n8 (in-PR, one line).

### R2.6 Security flags (for security-analyst)

- **R2-m1:** reify-class npm commands run dependency lifecycle scripts unflagged in Dockerfiles. CWE-829; A08:2021.
- **R2-m2:** policy rules for gate presence, gitleaks mounts and scans isolation are bypassable by one-token edits. Only the `.github/` record catches this; confirm PR10-SEC-07's rating stands with that dependency.
- **R2-m3:** nested `.semgrepignore` narrows the base-rule Semgrep scope (follow-up to PR10-SEC-03).
- **R2-m4:** `${{ env.* }}` in `run:` launders untrusted context. CWE-78 / CWE-94; GitHub Actions script injection.
- **Positive:** the `.git`-only gitleaks mount also defeats `.gitattributes -diff` hiding (verified with git 2.52). Keep the mount rule, and harden it per R2-m2.
