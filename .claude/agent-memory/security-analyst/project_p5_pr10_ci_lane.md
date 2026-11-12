---
name: project-p5-pr10-ci-lane
description: PR #10 (TASK-007 lane A, CI security boundary) R1 2026-11-12 PASS_WITH_FOLLOW-UPS; PR10-SEC-01..15; gitleaks v8.30.1 bypass facts (probe-confirmed), repo platform limits (no branch protection), record-check parser quirk; checks owed in R2/TASK-014/015
metadata:
  type: project
---

PR #10 review: `docs/05-quality/security/PR-0010-TASK-007-security-review.md`. R1 head `28442b6`. 1 MEDIUM (PR10-SEC-01 gitleaks), 7 LOW, 7 INFO. 33 of 36 routed items closed.

**Facts verified 2026-11-12 (re-verify before relying on them):**
- **Repo platform.** `sukhchdit/shipcube` is PRIVATE and on a plan where `branches/main/protection` and `rulesets` return 403.
  - No required checks, so `ci-gate` is advisory; merge discipline is the only enforcement.
  - Actions policy: `allowed_actions: all`, `sha_pinning_required: false`.
  - All 3 merge methods are enabled.
  - There are no repo variables, so `CI_MAIN_FAST_LANE` is unset and the push-to-main lane never runs.
- **gitleaks v8.30.1** (source plus a scratch probe with the CI flags):
  - auto-loads `<source>/.gitleaksignore` from the scanned working tree;
  - honours `gitleaks:allow` unless `--ignore-gitleaks-allow` is passed;
  - `--log-opts` gives `git log -p -U0 <opts>`, so merge commits are never diffed. Use `--diff-merges=first-parent`, and mount only `.git`.
- **Lane A ordering.** The base-ref gates (gitleaks, Semgrep, record check, licence, signatures, audit) run in the same job AFTER head code (`deps:rebuild`, lint, tests). Only workflow-policy, install-flags, migration-immutability, lockfile and dep-age run before it.
- **Semgrep scope.** The rules come from the base ref, but `.semgrepignore` and the `.gitignore` it includes come from the head.
- **Record-check parser.** `check-security-owned-paths.mjs` takes the LAST `Verdict` + `:`/`|` + UPPERCASE token anywhere in the record. In my own records, keep exactly one verdict row, never quote an example verdict string, and name the reviewed head SHA. Validate with `recordVerdict` / `candidateShas` imported from the worktree before handing off.
- **Agent control plane.** `.claude/settings.json` is tracked (hooks and 78 permission rules) and is not code-owned. Lane A treats `.claude/` as docs-only.

**Why:** these residuals close only if the TASK-007 fix cycle, TASK-014, TASK-015, the orchestrator settings change and principal-architect's ADR-0023 wording are each checked.

**How to apply:**
- **R2 of PR #10:**
  - re-run the gitleaks probe (the synthetic repo with a control, `gitleaks:allow` in `.md`, a `.gitleaksignore` and an evil merge). Expect 5 findings after the fix;
  - the record must name the new head;
  - check the policy fixtures for the gitleaks flags.
- **TASK-015:**
  - an isolated `scans` job with no npm and no head scripts;
  - the `untrusted-expression`, privileged-trigger and `required-gates` policy rules;
  - a container-tool digest freshness check;
  - Playwright browser confinement (PR4-SEC-08).
- **TASK-014:** licence and closure taken from the installed manifests (PR10-SEC-06) before the images; consider putting Dockerfiles under CODEOWNERS.
- **Orchestrator:** `sha_pinning_required` set, selected actions only, squash-only merges, merging with `gh pr merge --squash --match-head-commit`.
- **After merge:** check the first Dependabot run for `private_source_not_reachable`; run the dependency-auditor baseline plus a one-off full-history gitleaks scan with `--ignore-gitleaks-allow`.

Related: [[project-p5-wave0-supply-chain]], [[project-p5-pr2-lint-controls]], [[project-p5-pr8-authz-review]], [[project-security-review-conventions]]
