---
name: project-p5-task038
description: TASK-038 design tokens/token lint/tenant override seam, r1 @b7482fb8 PASS_W_F-U (record on main 23538dec); open LOW 01 (tools/ui unowned in stylelint gate) and 03 (type confusion), INFO 02/04-06; D-TASK038-06 port conditions (i)-(vi); stylelint probe facts
metadata:
  type: project
---

TASK-038 round 1 (pre-push, head `b7482fb8`, base `f9cc7ca1`). Verdict: PASS_WITH_FOLLOW-UPS. The record `PR-pending-TASK-038-security-review.md` and D-SECPR038-01 were committed on main as `23538dec`. The record still has to be renamed at PR time (D-ORCH-136/138).

**Open items:**
- **PR038-SEC-01 LOW (twin R1-m3 (2)).** `tools/stylelint-rules/token-lint.mjs` imports unowned `tools/ui/token-lint.mjs` and `tools/ui/tokens-core.mjs`. `tools/ui/` is not in CODEOWNERS, `LINT_CONTROL_PATHS` or `PROOF_BASE_DIRS`.
  - Fix: own `tools/ui/` and add it to `lane-scope.mjs`, or move the analysis under `tools/stylelint-rules/`. Either way, add owned fixtures for `oklch()`, `rgba()`, 8-digit hex, a named colour in `border` and an `em` length in `gap`.
  - Due: before the next PR that changes `tools/ui/**`, at the latest before TASK-046 merges.
- **PR038-SEC-02 INFO.** The off-override is not pinned for repository paths.
- **PR038-SEC-03 LOW.** `buildTenantOverrideCss` checks `HEX.test(value)` by coercion, then calls `value.toLowerCase()`. A JSON array throws; a forged JS object injects CSS. Fix: a `typeof` check.
- **INFO 04.** The `<style>` seam conflicts with the hash CSP `style-src 'self'`.
- **INFO 05.** Rejection reasons echo the raw value without a bound.
- **INFO 06.** ReDoS in the `stripData` quote regex, reachable through `url(x"` + backslashes. It fails closed.

**Why it matters:** when TASK-046 (the 400 ms transition rule beside token-lint) or a brand-config task touches these paths, check whether SEC-01 and SEC-03 were folded in. Port conditions (i)-(vi) bind whichever task first loads `BRAND_PRIMARY_*` or tenant theme values at runtime: closed Joi schema plus `typeof`, opaque colours only, same-origin stylesheet, server-side contrast gate with no raw echo, tenant binding with RBAC and audit, start-up assertion. No plan task named it yet; principal-architect assigns it.

**How to apply (probe facts):**
- Stylelint 17.16 has `stylelint.resolveConfig(file, { configFile, cwd })`. Rule values come back as arrays (`[true]`), and `overrides.files` resolve relative to the config directory, not the cwd.
- Effective-config probe kit: 19 paths plus two mutation configs (a widened `files` glob, a rule set to `null`). It ran as single-process Node on `git archive` extracts with a long-path `node_modules` junction to main. A junction created through the 8.3 scratch path vanished immediately; use the long path.
- **Gate-process code check:** `process.on('exit', () => { process.exitCode = 0 })` in ANY module evaluated at lint-config load turns the Stylelint CLI exit 2 into 0, while API findings (what `lint-fixtures.mjs` reads) are unchanged. Ask "who can run code inside the gate process" for every lint-config import.
- A 1.1M-call per-code-point fuzz of a builder that flattens the token tree on each call took about 3 min: run it with `run_in_background`.
- In Git Bash, `git show "origin/main:.github/..."` is path-converted unless `MSYS_NO_PATHCONV=1` is set.

Related: [[project-security-review-conventions]], [[project-p5-wave0-web-scaffolds]] (PR4-SEC-13), [[project-p5-pr33-lane-a-hardening]]
