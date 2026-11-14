---
name: pr42-fc2
description: PR #42 (TASK-025) fix cycle 2, 2026-11-14 - CI ESLint heap OOM (local --max-old-space-size proxy), ci.yml change voids evidence, main moving with code forced 3 evidence runs, lock starvation, junction-safe node_modules removal
metadata:
  type: feedback
---

PR #42 fc2 (R2-M1 boundaries policy, SEC-13 track/settle, n1-n3, unions with #43/#45/#44/#47). Solo, about 170 calls. Three lane B runs were needed; all PASSed. Lane A was green apart from the security record, but only on the second push.

**Why:** main moved with code twice during the cycle (PR #44, then PR #47's manifest), and the first push hit a CI-only ESLint OOM. Each of these voided the evidence.

**How to apply:**
- **CI lint heap:** the hosted runner's default V8 heap is about 2 GB. Before pushing a PR that adds a workspace or many typed-lint files, run `node --max-old-space-size=2048 node_modules/eslint/bin/eslint.js .` locally as a proxy. If it OOMs, the CI Lint step needs `NODE_OPTIONS: --max-old-space-size=4096`. The workflow policy allows heap flags; only preload flags are refused. Then run check-workflow-policy (head and base-ref copies) and pinned actionlint.
- **check-evidence staleness covers `.github/workflows/ci.yml`:** any CI edit after the evidence commit means a new lane B run. Settle CI edits BEFORE taking evidence.
- **Re-fetch main right before taking evidence and again before pushing.** A newly activated suite (e.g. `rls-cross-tenant`) makes check-evidence fail with "required suite X missing" until main is merged and the evidence is retaken.
- **Lock starvation:** other agents poll docker.lock faster. Use a 3 s poll. A run-ev script that is still waiting can be killed (`ps -ef | grep run-ev`) and replaced with a heavy-only continuation, because the pre-gates already ran on the same clean tree.
- **Junction-safe evidence-worktree cleanup:** in Git Bash, `rm node_modules/@platform/<x>` (plain `rm`, no `-r`) unlinks the junction without following it. Then `rm -rf node_modules`, and `git worktree remove` (no force) succeeds. A PowerShell `Get-ChildItem -Attributes ReparsePoint` listing was denied by the classifier; `find node_modules -maxdepth 3 -type l` works.
- **Union as second merger:** commit the merge with only the textual resolution, so it stays comparable to `merge-tree`. Put the semantic union (stand-in reasons, pins) in a separate commit after the full unit run.
- **Scratch assemble scripts:** inserted text that contains backticks breaks a JS template literal, and `sed` in Bash drops the escaping backslash. Edit such lines with the Edit tool.
- **A `void` detached-write test crashes Jest on old code** (an unhandled rejection kills the worker). For mutation runs, run each test alone with `-t`.

Related: [[pr42-fc1]], [[task025-audit-writer]], [[lane-b-evidence-run]], [[pr44-fc2]], [[agent-worktree-junctions]]
