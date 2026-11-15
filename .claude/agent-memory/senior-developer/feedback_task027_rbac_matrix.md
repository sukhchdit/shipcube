---
name: task027-rbac-matrix
description: TASK-027 (2026-11-14/15) - RBAC matrix generator; classifier refusals on tools/quality edits, npm ci during a live run, loopback suites under host load, contract-layer fixtures, heavy prerender timeout
metadata:
  type: feedback
---

TASK-027: pure generator in packages/authz/src/generator plus a loopback suite in tests/generated/rbac. Done solo; 100 % branches came on the second pass.

**Why:** these traps cost several runs each, and TASK-033/278 (the next generated suites) will hit them again.

**How to apply:**
- **The classifier refused a `sed` edit of `tools/quality/suite-runners.json` from a task PR.** Propose new runner entries in the PR body and leave them to the activation PR (qa-lead/devops). A PowerShell memory query chained with `docker stats` was refused too; use separate, plain commands.
- **Never run `npm ci` in a worktree while a test run there is live.** A locked RLS run died silently, with no Tests line. Do installs only between runs, or do them in the evidence worktree.
- **Loopback suites need explicit timeouts.** Follow the `LOOPBACK_TEST_TIMEOUT_MS` rationale in `apps/api/src/platform/routing/tests/loopback.ts`.
  - Under another agent's xargs -P4 stress run, a 31-request row went over 5 s and about 4,300 requests went over 120 s; the whole suite took 500 s instead of 24 s.
  - Set `jest.setTimeout` and a per-test bound, and record why.
  - Run the 20-run flake loop only when the host is quiet. Otherwise it measures the host, not the suite.
- **Contract-layer fixtures:** all 133 openapi operations build through `defineRoute` once two contract quirks are normalised: `x-audit` NONE with an entity, and a justification on a catalogued permission. This gives a meaningful matrix before any module routes exist (the registry has only health).
- **ECONNRESET on loopback:** raise `server.keepAliveTimeout` (120 s) and call `closeAllConnections()` on close.
- **tests/generated/rbac cannot import `tools/db`.** The ESLint allowance covers only rls. Export a helper from tests/generated/rls instead of editing the security-owned eslint config.
- **heavy's own `npm run build` prerender timed out under load,** so the verdict was INVALID with no suites run. The run directory stays untracked; a fresh evidence worktree is needed.
- **The scratchpad was wiped again, wave0 included.** Lock scripts must `mkdir -p` wave0 before `mkdir docker.lock`.
- **Commit-message traps:** a commitlint subject starting with an acronym ("RBAC ...") fails subject-case; start with a verb. Heredocs drop `\n` escapes inside JS strings, so use the Write and Edit tools.

Related: [[task024-rls-generator]], [[lane-b-evidence-run]], [[pr43-fc1]], [[p5-dispatch]]
