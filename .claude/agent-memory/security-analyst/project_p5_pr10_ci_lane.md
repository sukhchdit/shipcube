---
name: project-p5-pr10-ci-lane
description: PR #10 (TASK-007 lane A) R1 28442b6 + R2 26fc08d PASS_WITH_FOLLOW-UPS; PR10-SEC-01..20; gitleaks/.gitattributes/Semgrepignore-v2/setup-node facts (probe-confirmed); record-check contract + validation recipe; checks owed in TASK-015/after merge
metadata:
  type: project
---

PR #10 review: `docs/05-quality/security/PR-0010-TASK-007-security-review.md`.
- **R1** (head `28442b6`, 2026-11-12): 1 MEDIUM, 7 LOW, 7 INFO.
- **R2** (head `26fc08d`, 2026-11-13): PASS_WITH_FOLLOW-UPS.
  - **Closed:** 01 (the MEDIUM), 02, 04, 07, 11.
  - **Partly closed:** 03, 12.
  - **New:** 16 (LOW, nested Semgrep scope files), 17 (LOW, the policy rules are pattern-narrow), 18–20 (INFO: setup-node auto-cache, parser residuals, ownership residuals).

**Facts verified 2026-11-13 (re-verify before relying on them):**
- **Repo platform.** Still PRIVATE.
  - Protection and rulesets return 403.
  - `allowed_actions: all`, `sha_pinning_required: false`.
  - All merge methods are enabled.
  - The settings change was denied in the agent session (D-ORCH-012); D-ORCH-013 makes the control procedural.
- **gitleaks v8.30.1:**
  - The hardened form mounts `.git` only, with `--ignore-gitleaks-allow`, `--diff-merges=first-parent` and `--network none`. My probe reports all of control, `allow.md`, `.gitleaksignore` and the evil merge.
  - `git log -p` takes attributes from the WORK TREE only, so a PR-committed `.gitattributes` `-diff`/`binary` cannot hide files when only `.git` is mounted (probe cases d/e).
  - The default global allowlist (`useDefault=true`) skips `package-lock.json`, other lockfiles and `node_modules/`.
  - The image WorkingDir is `/`; `--gitleaks-ignore-path` defaults to `.`.
- **Semgrep 1.183 uses Semgrepignore v2** (default since 1.117.0). It honours `.semgrepignore` AND `.gitignore` files in ANY folder of a git project. Overlaying only the root files (`--ignore-from`) is not enough.
- **actions/setup-node v7.1.0** (`949feb2`): `package-manager-cache` defaults to true. It auto-enables npm caching, which runs `npm config get cache` in the workspace, when package.json has `packageManager` or `devEngines.packageManager`.
- **Record-check contract once #10 merges** (`check-security-owned-paths.mjs`):
  - the file must be named `PR-<nnnn>-*.md` for that PR number;
  - the LAST table row whose first cell is `Verdict` wins, and only PASS, PASS_WITH_FOLLOW-UPS or PASS_WITH_CONDITIONS pass;
  - SHAs are read only from `| Branch / head |` or `| Head… |` rows;
  - HTML comments are NOT skipped (PR10-SEC-19);
  - **my own records:** append a `## Round N (head <sha>)` table with `| Head | <full sha> |` and the `| **Verdict** |` row, and put no later row whose first cell is Verdict.
  - **A merge of `main` can void a record** (proven with PR #9, 2026-11-13). Clause (d) is `git diff <named> <head>` ∩ the PR's owned net change. When `main` and the PR both changed an owned path, the merge brings in main's side and voids every pre-merge SHA. The orchestrator's belief that "merge-only commits are fine" holds only when no owned path overlaps.
    - **Before hand-off,** compute the overlap: `comm -12` of `diff mb..origin/main` and `diff mb..<head>`, filtered by CODEOWNERS.
    - **If they overlap,** a merge-only round must name the merge commit. Verify it like this:
      - the paths in `diff <main parent> <merge>` equal the PR's net-change paths;
      - every blob equals the reviewed head's, except the overlap paths;
      - each overlap path equals `git merge-tree --write-tree` (or the expected conflict resolution).
  - **PR10-SEC-21 (LOW, TASK-015).** `recordHeadShas` takes SHAs from every round, while the verdict is file-level. Older heads, even a FAIL round's, stay bindable, and a revert of the owned paths to the FAIL head's content passes. The fix: take head rows only from the table that holds the last Verdict.
  - The tool reports the FIRST qualifying SHA in token order, which is often an older round's.
- **Head workflow decides.** Under `pull_request` the head `ci.yml` runs. `required-gates` pins the gate commands but not their input-sourcing steps (PR10-SEC-17), so an owned-path record is the only catch for deliberate `ci.yml` edits.

**Why:** These residuals close only if each of these is checked: TASK-015 (which touches workflows), the orchestrator procedure, principal-architect's ADR-0023 wording, and the post-merge items.

**How to apply:**
- **Validating a record before hand-off.**
  1. `git archive <head> tools/ci .github docs/05-quality/security` into scratch.
  2. Import `recordVerdict`, `recordHeadShas` and `checkSecurityOwnedPaths`.
  3. Run against a scratch root (CODEOWNERS plus the updated record), with `process.env.GIT_DIR=<main>/.git`, base `origin/main`, the head SHA and `--pr`.
  4. Add controls: the old record (expect missing) and the wrong PR number (expect missing).

  Script: `scratchpad/review/PR-10-sec-r2/scripts/record-parse-check.mjs`. Scratch is session-scoped, so re-create it if it is gone.

  **Alternative, used for PR-0009 R3** (`scratchpad/review/PR-9-sec-r3/scripts/record-sim.sh` + `parse-check.mjs`):
  - Work in a scratch `git clone --shared --no-checkout <main>`, which writes nothing to main's `.git`.
  - Extract main's `tools/ci` with `git archive` and run its CLI with `--root <clone> --json`.
  - Import the module from a separate script: importing it with the module path as `argv[1]` runs its `main()`.
  - Remove the clone afterwards.
- **TASK-015 review:**
  - PR10-SEC-21: bind head SHAs to the round that holds the last Verdict row. Test: round 1 FAIL names Y, round 2 PASS names X, head = X + a revert of the owned paths to Y → `missing`.
  - PR10-SEC-16: scan a clean export or fail on nested scope files.
  - PR10-SEC-17:
    - `scans-isolation` as an allow-list (`node "$GATE_*"` only);
    - `gitleaks-hardening` parses `--mount` and the exit path;
    - `required-gates` pins the extraction steps and `GITLEAKS_IMAGE`;
    - `SAFE_EXPRESSION` without `env.*`, outputs or `matrix.*`;
    - `issues` added to the forbidden triggers.
  - PR10-SEC-18: `package-manager-cache: false` in `scans`.
  - PR10-SEC-13: container-digest freshness.
  - PR4-SEC-08: Playwright confinement.
- **TASK-014:** PR10-SEC-06 (licence and closure from the installed manifests); consider Dockerfiles under CODEOWNERS.
- **After merge:**
  - check the first Dependabot run for `private_source_not_reachable`;
  - run the dependency-auditor baseline plus a one-off full-history gitleaks scan with the R2 flags;
  - PR10-SEC-09 (`.npmrc` key allow-list) also carries D-TASK006-02 item 5 (`script-shell`).

Related: [[project-p5-wave0-supply-chain]], [[project-p5-pr2-lint-controls]], [[project-p5-pr8-authz-review]], [[project-security-review-conventions]]
