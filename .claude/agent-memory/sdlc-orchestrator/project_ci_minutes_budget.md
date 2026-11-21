---
name: project-ci-minutes-budget
description: GitHub Actions free minutes (2,000/month, $0 spend limit) are the binding CI constraint; push/union/docs-push discipline the orchestrator must follow
metadata:
  type: project
---

Hosted CI runs on the free 2,000 Actions minutes/month with a $0 spend limit (CLOUD_BUDGET_MONTHLY_USD = 0). Exhausting them stops lane A and blocks every merge. On 2026-11-14 billed use was 771 (38.6 %) with a November forecast ≈ 80 %; the cause was run count (2.1× plan: docs-only pushes re-proving trees, main unions, security-integration on every push), not per-run cost.

**Why:** D-ORCH-077/078 and D-ARCH-126..129 (ADR-0023 am. L, rulings/wave-0-ci-minutes.md). Paid minutes or making the repo public are the user's choice, not the run's.

**How to apply:**
- P1 (refined D-ORCH-102): merge `main` into a PR branch only when GitHub says not mergeable, main changed a file the PR also changes, or main changed the evidence manifest/verifier so the PR's credited run would be rejected; a tooling-path move with no overlap does not need a union — squash and run a post-merge gate (D-ORCH-042). EXCEPTION (D-ORCH-103): if main changed lane A's own bootstrap (`.github/workflows/**`, the `tools/ci/**` files the workflow loads) since the PR's merge base, lane A cannot start (it loads tooling from the merge base) — union is required until TASK-286's `TOOLS_REF=HEAD^1` lands.
- Records ride the next code push when one is coming (commit locally, don't push docs alone); the first live light run (PR #46, 2026-11-15) proved docs pushes inherit the code proof.
- P2: one docs push per review round (record + evidence together); never push docs while the PR's full run is in progress.
- P3: Dependabot PRs — merge or `@dependabot ignore`, don't close (closed groups get recreated).
- P4: run `ci:minutes --forecast` every Monday and at wave exits; record in STATUS.
- Lane C `wave-end` at most once a month while forecast > 60 %; nightly only with it.
- Related: [[project-host-resource-limits]], [[project-run-scope-and-publishing]].

**2026-11-21: exhausted.** From about 03:12Z GitHub stopped starting jobs: "recent account payments have failed or your spending limit needs to be increased" (D-ORCH-146). A job that fails with no steps means billing; check `gh api repos/<o>/<r>/check-runs/<job>/annotations`. Merges wait for the monthly reset or a user account change. Do not try to work around it. Keep building and preparing PRs up to "ready".
- Merge-ref check: fetch with `+refs/pull/<n>/merge:…`. GitHub force-updates the ref, so a fetch without `+` is rejected silently and leaves a stale copy.
