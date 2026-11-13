---
name: project-p5-pr23-lane-b
description: PR #23 (TASK-011 lane B, check-evidence) R1 @f61e55d PASS_WITH_CONDITIONS; PR23-SEC-01..10; tools/quality not in CODEOWNERS; activation semantics (S5/S5b); Ajv from --root; checks owed at first activation, TASK-015, G3
metadata:
  type: project
---

PR #23 review: `docs/05-quality/security/PR-0023-TASK-011-security-review.md`.
- **R1** (head `f61e55d`, 2026-11-13): PASS_WITH_CONDITIONS. 2 MEDIUM, 4 LOW, 4 INFO. The simulated record check (main `360f419`) passed, and controls B/C/D/E gave `missing`.

**Conditions and what to check:**
- **PR23-SEC-01 (MEDIUM).** `.github/CODEOWNERS` has no `/tools/quality/` line, so the verifier, schema, manifest and `suite-runners.json` are unowned. TEST-STRATEGY §9.3 requires security review for every manifest change.
  - Due before the first `planned → active` flip or the next `tools/quality` change.
  - If the fix lands in PR #23, review a new round.
- **PR23-SEC-02 (MEDIUM).** Nothing is enforced: 63 suites `planned`, 2 `opt-in`, 0 active.
  - Activation must go through manifest-only PRs (SHEET-FOLD-2 (b) ruling).
  - Then check the active-needs-runner test.
  - At G3, quality-gatekeeper must run `check-evidence --profile gate`, and SEC-P3-07 items 5–6 (TASK-015) must be live.
- **LOW 03/04/05.** Due before the first activation. Check:
  - 03: a standalone Ajv validator, or the realpath + base-lockfile version check;
  - 04: lockfile/manifest/stamp/coverage cross-checks, plus base-run immutability (no modifying or deleting gate runs);
  - 05: heavy runs `npm ci` + `deps:rebuild`; untracked files listed via `git ls-files --others --exclude-per-directory=.gitignore`; a `.env` ruling.
- **LOW 06 → TASK-015.** Add the Lane B step to `CI_REQUIRED_GATES`. Remove the bootstrap `else`. Make the no-base branch exit 1 on `pull_request`.
- **INFO 07/08/10 → TASK-015 or the ZAP/Trivy runners.**
  - 07: LF/CR in a path injects `::` commands and summary lines; `cell()` misses CR.
  - 08: `sanitizeNative` covers Gitleaks only; Jest `name`/`classname` are not scrubbed.
  - 10: heavy `changedPaths` lacks `--no-renames`.

**Facts, probe-confirmed 2026-11-13:**
- **Activation semantics.** The verifier reads the BASE manifest.
  - The first activation PR passes, because the required set is empty.
  - Every later activation whose run also carries the newly activated suite is rejected as a whole (rule 4 soft reason), so the PR FAILs.
  - D-TASK011-01 (1) overstated the first case.
- **Ajv.** `check-evidence` imports Ajv from `<root>/node_modules`, which is head-lockfile-controlled; a fake `ajv/dist/2020.js` with `process.exit(0)` turned a FAIL into exit 0.
  - `check-lockfile` accepts non-`@platform` `link:true` entries to workspace dirs, while all real links are `@platform/*`.
- **Accepted evidence.** Fabricated evidence with a wrong `lockfile_sha256`, stamp `9999…` and a 2001 `generated_at` is accepted.
- **Clean-tree blind spots.** `.env*` can never fire (it is gitignored), and `.git/info/exclude` hides untracked overrides.
- **Overlap with main.** `package.json` overlaps with main (PR #21 `openapi:*`, Dependabot #22).
  - A main merge voids the R1 record. The merge-only round checklist is in record §7; the merge-tree at main `360f419` gives `package.json` blob `0145163`.

**Why:** These conditions hold until the first activation, TASK-015 or G3. The orchestrator tracks them as PASS_WITH_CONDITIONS items.

**How to apply:**
- Review the next `tools/quality`, CODEOWNERS or manifest PR against these items.
- When TASK-015 lands, check 06/07/10 together with PR10-SEC-17 and PR17-SEC-05/07/08.
- At G3, require the gate-profile transcript.

Related: [[project-p5-pr10-ci-lane]], [[project-p5-pr17-fixture-subset]], [[project-security-review-conventions]], [[project-p3-security-conditions]]
