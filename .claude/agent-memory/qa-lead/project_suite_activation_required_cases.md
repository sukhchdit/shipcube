---
name: suite-activation-required-cases
description: Before flipping a lane B suite to active, check its required_cases SEC-TC IDs have passing tests on main and it has a suite-runners.json entry; park missing IDs in required_cases_pending; activation PRs need two evidence runs since unit is active
metadata:
  type: project
---

At W0-ACT-1 (2026-11-13) the manifest's `required_cases` for unit/integration/api named SEC-TC IDs (14, 55, 22, 29) owned by later tasks (TASK-049/057/172/020). Activating with them would have FAILed every lane-B PR from the next PR on, since `unit` is always selected. D-QA-014 parked them in `required_cases_pending` (owner + latest checkpoint).

**Why:** the verifier reads the base manifest; an active suite with a missing runner or an unimplemented required case fails closed on every PR that selects it.

**How to apply:** at each activation checkpoint (Wave-0 exit, v0.1.0-m0, G3): `git grep` each required SEC-TC ID in test names; move IDs back from `required_cases_pending` once their owning task merged; confirm runner entries exist (tools/quality/activation.test.ts enforces it); verify with a restricted `quality:heavy --suites ...` run (writes to a temp dir, never evidence) before committing the `--profile pr` evidence run. Heavy runs wait on the shared docker.lock directory. Related: [[p4-concurrency-and-positional-ids]]

**Activation PR evidence since `unit` went active (PR #47, 2026-11-14):** a manifest-only change selects only `unit`, and any run carrying JUnit of a suite still `planned` in the base manifest is rejected (rule 4). So a single run that carries the newly activated suite leaves lane A with no accepted `unit` evidence → FAIL. Pattern that passed lane A: (1) `quality:heavy --profile pr --base <parent of the PR that added the suite's code>` so a path rule fires and the new suite runs (committed, uncredited, shows the count); (2) a default-base `--profile pr` run on the next commit (credited for unit). Check locally with `check-evidence --manifest <base copy>` before pushing.

**Pitfalls seen:** (a) a parked ID that passing tests already carry (SEC-TC-74 in catalog-c1-c14 at PR #47) is only a note at `pr` but a problem at `wave`/`gate` — move it to required_cases before the Wave-0-exit wave run. (b) The safety classifier refuses moving/deleting a FAIL run directory; leave it untracked and take the next run in a fresh detached worktree (D-ORCH-068 precedent). (c) Unit tests with 5 s timeouts fail under host load (unit wall time 3-4x normal); re-run, don't commit the FAIL run.
