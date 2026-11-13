---
name: suite-activation-required-cases
description: Before flipping a lane B suite to active, check its required_cases SEC-TC IDs have passing tests on main and it has a suite-runners.json entry; park missing IDs in required_cases_pending
metadata:
  type: project
---

At W0-ACT-1 (2026-11-13) the manifest's `required_cases` for unit/integration/api named SEC-TC IDs (14, 55, 22, 29) owned by later tasks (TASK-049/057/172/020). Activating with them would have FAILed every lane-B PR from the next PR on, since `unit` is always selected. D-QA-014 parked them in `required_cases_pending` (owner + latest checkpoint).

**Why:** the verifier reads the base manifest; an active suite with a missing runner or an unimplemented required case fails closed on every PR that selects it.

**How to apply:** at each activation checkpoint (Wave-0 exit, v0.1.0-m0, G3): `git grep` each required SEC-TC ID in test names; move IDs back from `required_cases_pending` once their owning task merged; confirm runner entries exist (tools/quality/activation.test.ts enforces it); verify with a restricted `quality:heavy --suites ...` run (writes to a temp dir, never evidence) before committing the `--profile pr` evidence run. Heavy runs wait on the shared docker.lock directory. Related: [[p4-concurrency-and-positional-ids]]
