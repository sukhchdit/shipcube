---
name: lane-a-merge-pitfalls
description: Lane A reds that a merge-main or rule-adding PR hits regardless of its code (gitleaks on merge diffs, base-ref fixture exact match, PR title length) and how to pre-check them locally
metadata:
  type: feedback
---

Before the single push of a merge-main/reconciliation cycle, pre-check these three lane A traps locally. PR #11 fix cycle 2 (2026-11-13, run 43303599938) hit two of them after a fully green local gate.

1. **Gitleaks scans the MERGE commit's first-parent diff.** Everything main brought in counts as the PR's own content. Main's D-ORCH-017 text and a senior-developer memory note quoted PR #13's synthetic `PASSWORD` literal, so PR #11's merge commit got 2 `generic-api-key` findings. Main's own push runs are `skipped`, so main never flags it itself.
   - **How to apply:** before merging main, run gitleaks over `origin/main`'s new commits (scratch `fix2/PR-11/gitleaks.sh`: mount the common `.git`, `--diff-merges=first-parent <base>..<head>`, `--redact --verbose`). If main carries a finding, report it before merging; once a merge commit is pushed, its range stays tainted.
   - **Never quote a secret-shaped test literal in docs or memory.** Describe it ("a synthetic password literal") instead.

2. **The base-ref negative-fixture step (PR2-SEC-08) fails any PR that ADDS lint rules.** The base suite's `expectOnly` is an exact match, and its "every local platform/* rule has a negative fixture" check runs against the head's rule registry. New head rules therefore add findings to base fixtures and make that check fail. It is strengthening, not weakening, but the step is still red.
   - **How to apply:** for a rule-adding PR, run the step locally first: check out the base suite, fixtures and harness, then jest with the step's `--testNamePattern`. Raise the expected red with the orchestrator up front (exception or TASK-015 redesign: subset semantics via an env flag the harness honours).

3. **commitlint checks the PR TITLE on pull_request events** (`header-max-length` 100). Check it with `gh pr view N --json title -q .title | npm exec --no -- commitlint`. Editing the title does not trigger a run (`edited` is not in the trigger types).

Also: a unit suite that imports the generated client under `PRISMA_TREE_LOCK` needs a long `beforeAll` timeout. The deps rebuild suites hold that lock in parallel, so the default 5 s timeout flakes.

Related: [[merge-main-pass]], [[p5-dispatch]]
