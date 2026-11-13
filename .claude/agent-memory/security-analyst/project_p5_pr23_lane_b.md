---
name: project-p5-pr23-lane-b
description: PR #23 (TASK-011 lane B, check-evidence) R1 @f61e55d + R2 @c0b1b31 PASS_WITH_CONDITIONS; 01 closed; COND-PR23-2 vs D-ARCH-082 (W0-ACT-1 runner gap, api); 03/04/05 moved to before Wave-0-exit activation; activation semantics; checks owed at W0-ACT-1, Wave-0 exit, TASK-015, G3
metadata:
  type: project
---

PR #23 review: `docs/05-quality/security/PR-0023-TASK-011-security-review.md`.
- **R1** (head `f61e55d`, 2026-11-13): PASS_WITH_CONDITIONS. 2 MEDIUM, 4 LOW, 4 INFO.
- **R2** (head `c0b1b31`, 2026-11-13, after fix cycle 1 D-ORCH-028): PASS_WITH_CONDITIONS, no new finding.
  - **01 closed:** a CODEOWNERS `/tools/quality/` line, an entry in `REQUIRED_CODEOWNED_PATHS`, and 4 mutation tests.
  - **`--event "$GITHUB_EVENT_NAME"` adds no lever.** GitHub ignores `env:` assignments to `GITHUB_*` defaults (docs confirmed). A skip needs an owned `ci.yml` edit, and an unknown event exits 2.
  - Simulated record check: A/A1/A2/F pass; B/C/D/E missing. D (a later `tools/quality`-only commit) proves the directory is now owned.
  - Proposed decision text for the orchestrator: D-SEC-PR23-02.

**Rulings to hold future rounds to:**
- **03/04/05 (LOW) due point moved** from "before the first activation" to "merged before the Wave-0-exit activation PR". W0-ACT-1 does not wait for them.
  - Reason: blocking activation on LOW fixes prolongs the MEDIUM 02 gap.
  - **Interim controls:**
    - every lockfile PR record states the `node_modules/ajv` tuple and that there is no non-`@platform` `link:true`;
    - no wave or gate run is committed;
    - evidence-commit gate tables state that `npm ci` + `deps:rebuild` ran before heavy, and that `info/exclude` is empty.
  - The Wave-0-exit activation record must be FAIL while any of 03/04/05 is open.
- **COND-PR23-2 against D-ARCH-082:**
  - **W0-ACT-1** (right after merge) is manifest-only and needs a record, because `tools/quality` is owned.
    - It needs an active-needs-runner test, plus runner entries for every suite it activates.
    - Only 5 runners exist: unit, integration, api, catalog-c1-c14, migrations.
    - 9 of the 13 listed suites lack one. `e2e-chromium` is selected by every `apps/web` change, so every web PR would FAIL.
  - **`api`** is missing from D-ARCH-082's lists. It is due at Wave-0 exit at the latest.
  - **Later activations:** a manifest-only change selects exactly `unit` (probe), so run `quality:heavy --profile pr`. A wave or gate run carries the new suites, and rule 4 rejects it.
  - **G3:** a `skipped` (push) transcript is no evidence.
- **06 amended (TASK-015):**
  - the pin includes `--event "$GITHUB_EVENT_NAME"`;
  - refuse a literal event or a `GITHUB_EVENT_NAME` env key or assignment;
  - refuse `--report-only` once the base has the verifier (= code review R2-n3);
  - refuse push combined with wave or gate.
- **08** add: `malformed()` messages are not scrubbed, and V8 `JSON.parse` errors quote about 10 characters of the input.

**Facts (probe-confirmed 2026-11-13):**
- **Activation.** The verifier reads the BASE manifest.
  - The first activation passes, because nothing is required.
  - A later activation whose run carries the newly activated suite is rejected as a whole.
  - heavy selects from the WORKING-TREE manifest with pr profile = changed paths. A manifest-only PR therefore runs only `unit` and passes.
- **Ajv.** `check-evidence` imports Ajv from the head-installed `node_modules`. A fake module turned FAIL into exit 0.
- **Fabricated evidence** (wrong lockfile hash, year-9999 stamp) is accepted.
- **Ignored paths.** `.env*` and `info/exclude` paths are invisible to the clean-tree check.
- **Selection.** `selectSuites` needs a manifest loaded with `loadManifest`; the raw JSON crashes on `exclude`.

**Why:** These conditions hold until W0-ACT-1, Wave-0 exit, TASK-015 and G3. The orchestrator tracks them.

**How to apply:**
- **W0-ACT-1 record:** check the runner test, the runner entries, and that no evidence is in the PR.
- **Wave-0-exit activation record:** 03/04/05 must be merged, the change must be manifest-only, and the evidence must be a pr-profile unit run.
- **Lockfile PRs from W0-ACT-1 on:** state the ajv tuple.
- **TASK-015:** 06/07/10, together with PR10-SEC-17/21 and PR17-SEC-05/07/08.
- **G3:** require the gate-profile transcript.

Related: [[project-p5-pr28-w0act1]] (W0-ACT-1 done), [[project-p5-pr10-ci-lane]], [[project-p5-pr17-fixture-subset]], [[project-security-review-conventions]], [[project-p3-security-conditions]]
