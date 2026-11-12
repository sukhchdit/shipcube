---
description: Fast-track a defect fix through reproduce → fix → review → security → test → release
argument-hint: <bug description or issue link/ID>
---
Hotfix: $ARGUMENTS

1. senior-developer: reproduce with a failing test, find the root cause, implement a minimal fix on `fix/<slug>`, and grep for the same pattern elsewhere.
2. In parallel: code-reviewer and security-analyst (change-scoped).
3. qa-lead → test-runner: full regression.
4. quality-gatekeeper: G3 and G4 scoped to the hotfix. Then release-manager releases a patch version through the pipeline.
