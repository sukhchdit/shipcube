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
