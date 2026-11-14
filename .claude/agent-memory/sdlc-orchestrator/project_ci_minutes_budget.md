---
name: project-ci-minutes-budget
description: GitHub Actions free minutes (2,000/month, $0 spend limit) are the binding CI constraint; push/union/docs-push discipline the orchestrator must follow
metadata:
  type: project
---

Hosted CI runs on the free 2,000 Actions minutes/month with a $0 spend limit (CLOUD_BUDGET_MONTHLY_USD = 0). Exhausting them stops lane A and blocks every merge. On 2026-11-14 billed use was 771 (38.6 %) with a November forecast ≈ 80 %; the cause was run count (2.1× plan: docs-only pushes re-proving trees, main unions, security-integration on every push), not per-run cost.

**Why:** D-ORCH-077/078 and D-ARCH-126..129 (ADR-0023 am. L, rulings/wave-0-ci-minutes.md). Paid minutes or making the repo public are the user's choice, not the run's.

**How to apply:**
- P1: merge `main` into a PR branch only when GitHub says not mergeable or main moved under lockfile/prisma/tools/ci/tools/quality/.github/.npmrc/.semgrep/.gitleaks.toml; otherwise squash directly and run a post-merge gate (D-ORCH-042).
- P2: one docs push per review round (record + evidence together); never push docs while the PR's full run is in progress.
- P3: Dependabot PRs — merge or `@dependabot ignore`, don't close (closed groups get recreated).
- P4: run `ci:minutes --forecast` every Monday and at wave exits; record in STATUS.
- Lane C `wave-end` at most once a month while forecast > 60 %; nightly only with it.
- Related: [[project-host-resource-limits]], [[project-run-scope-and-publishing]].
