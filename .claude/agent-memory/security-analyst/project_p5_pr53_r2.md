---
name: project-p5-pr53-r2
description: PR #53 (W0-FLAKE) security delta round 2 @378af72 (code 60a1659) PASS_W_F-U; C1 closed by recordAbortTimeouts pins; new INFO 05 (./testing lint gap incl. unpruned @platform/config/testing) and 06 (image-exports/SKIPPED_EXPORTS fidelity); merge prerequisites
metadata:
  type: project
---

Record section "Delta round 2" appended (uncommitted, LF, 495 lines) in `Shipqube-FLAKE`; the code twin r3 (APPROVED_WITH_NITS, `7652ee2` on main) found the same items as R3-n1/n2/n3. D-SEC-PR53-02 proposed.

- **C1 closed:** S3 deadline magnitude pinned by `recordAbortTimeouts` (3x800 + 2x400, caller case exactly `[120_000]`, trickle one 800). Killed on head: x10, x2, x10 per arm, +1 s, get/head deadline swap, controller refactor.
- **PR53-SEC-05 INFO** (= R3-n3): api production code may import `@platform/api/testing` / `../routing/tests/*.js` lint-clean (backstop: preflight fails docker build, target under pruned `tests/`). `@platform/config/testing` is lint-clean from api AND worker production and ships unpruned (`dist/testing/`); it holds only run-time-random secrets.
- **PR53-SEC-06 INFO** (= R3-n1/n2): `SKIPPED_EXPORTS` not value-pinned; `image-exports.test.ts` follows only `default`, skips `prisma/`, does not pin `./testing` targets as pruned. Mutants E4-E8 survive.
- Owner for both: TASK-W0-FLAKE-2 or the first post-#54 PR touching `eslint.config.mjs` / `tools/docker/`.
- PR53-SEC-01 closed with the self-blocking residual as a standing rule (no CPU-bound/ReDoS/scaling use of `timeOperation`); 02 closed; 03 closed with residual.

**Merge prerequisites:** `security-integration` is due only once `record_ok` (lane-scope.mjs:44), so it runs on the record commit and must be green before `ci-gate` passes. Do not merge main again before the squash (agent-memory after the evidence). Any push to the 19 owned paths (or `tools/docker/preflight.mjs`) voids the record.

**Probe facts:** a Jest mutant that leaves a long un-cleared `setTimeout` keeps Jest alive until the spawn timeout (Sctl took 400 s): `unref()` timers in mutants. The checker binds Head rows of every round; the older one only adds a note (sim S1 with two Head rows passed). Kit (session-scoped): `scratchpad/review/PR-53-sec-r2/{mut,lintprobe,sim,gl-emul,ev,mknm}.mjs`.

Related: [[project-p5-pr52-pr53]], [[project-p5-pr30-s3-adapter]], [[project-p5-pr39-task014-images]], [[project-security-review-conventions]]
