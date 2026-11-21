---
name: project-p5-task287c1
description: TASK-287 part 287-C1 (policy PR, pre-push) security r1 at e8b9414 PASS_W_F-U; record PR-pending on main b6274a3 (rename needed); PR62-SEC-01, PR287B-SEC-01/-02 closed; LOW 01 cache-hygiene exclusion escape (actions/cache archives directories recursively), INFO 02 lane-c/nightly commits; n7(b) ratified; real @actions/glob probe kit
metadata:
  type: project
---

Round 1, 2026-11-19, pre-push, interrupted by a network outage and then resumed. The record `docs/05-quality/security/PR-pending-TASK-287C1-security-review.md` and D-SECPR287C1-01 are on main at `b6274a3`. The code twin `370a66b` is APPROVED_WITH_NITS; its n2 lists cache-tripwire gaps, and its n7(b) asked me to ratify "record on the branch or on main" (ratified).

**PR287C1-SEC-01 (LOW): the cache exclusion does not work in `actions/cache`.**
- `@actions/cache` 6.x `resolvePaths` uses `@actions/glob` with `implicitDescendants: false`, then `tar --files-from`. tar recurses into each matched directory, so `!sub` never removes anything under a matched ancestor (`node_modules`, `node_modules/.cache`, or `node_modules/**`, which also matches `node_modules` itself).
- The last matching pattern wins, so an exclusion placed before the include does nothing.
- The only working form is a sibling-level include (`node_modules/.cache/*`) followed by `!locks`.
- `@actions/glob` does not expand braces, and refuses `.` and `..` segments.
- 13 of 29 forms are missed, including the whole-workspace `.` / `./` / `${{ github.workspace }}`.
- Due before any cache covers `node_modules` or `node_modules/.cache`; 287-C2 is the likely first.

**PR287C1-SEC-02 (INFO).** `lane-c.yml` and `nightly.yml` accept any 40-hex `uses:` commit. Fix with 015-C; until then, records for PRs that touch those files keep the upstream-tag check.

**Facts:**
- The three action tags are lightweight tags pointing at the pinned commits (`gh api repos/actions/<a>/git/ref/tags/<t>`).
- `STAGE_2_ACTION_STEP_IFS` is keyed `job:action`.
- The interim record checks end for ci.yml after this merge.

**Kit** (session scratch `s287c/`):
- `glob-run/node_modules`: real `@actions/glob` 0.6.1, `minimatch` 3 and deps (fetched with `npm pack`), plus a stub `@actions/core`.
- `probes/cache-hygiene.mjs`: run `process.chdir(dir)` before the `rmSync` of the workspace, or Windows gives EPERM.
- `new-families.mjs`: H/I/K/J, 268 mutants.
- `m1b.mjs`: 22 lookup scenarios plus `failedOnCode`.
- `sim.mjs`: env-specific SHAs edited with sed.
- `patch-record.mjs`: exact-string record edits.
- The over-approximating gitleaks scan flagged a "Token, permissions" table row (keyword followed by a comma); I rephrased it.

**How to apply:** for a PR287C1-SEC-01 fix, re-run the real-glob probe and expect 0 missed. At 287-C2, check every new cache path with that probe.

Related: [[project-p5-task287b]], [[project-p5-pr62-task287a]], [[project-p5-pr57-task288]], [[project-security-review-conventions]]
