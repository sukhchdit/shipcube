---
name: pr32-fc1
description: PR #32 fix cycle 1 (2026-11-13) - both opus specialists hit the 80-turn cap unreported, boot checks in createApp ripple through test harnesses, shared predicate placement, Docker hang after disk-full, lane A with no evidence
metadata:
  type: feedback
---

PR #32 fc1 covered the PR #20 union, 1 MAJOR, 8 MINORs, C1-C3, D-ARCH-106/107 and the PR #33 union. I did it with two opus backend-developers (lint area and auth-set area) plus my own pipeline work, about 230 of my own calls. Head 11530cc was pushed. Integration, coverage and lane-B evidence were blocked by a Docker hang.

**Why:** these traps recur in any large fix cycle on the route pipeline, and on any run after host disk exhaustion.

**How to apply:**
- **Turn cap.** Both specialists stopped at the 80-turn cap with no report (118 and 135 tool uses), even with a ~110-call stop rule in the brief. An area as big as D-ARCH-106 (7) or D-ARCH-107 (7) is too large for one specialist. Plan for salvage: run tsc, then full eslint, then unit and api, and finish their last in-flight item myself. Here that was the stub server's `sendProblem` signature and a tsconfig `files` entry. Salvage took about 25 calls.
- **Boot checks inside `createApp` ripple through every test harness.** `tests/generated/api-mounts.ts` needed an unused runner. Seeded-defect suites that mount contract-shaped audited or idempotent routes needed permissive slots (`metadataFixtureSlots()`), because fail-closed stubs refuse those routes in a real app. `contract-validation.api.test.ts` needed a runner too. Run the api project as well as unit after changing `createApp`.
- **Shared predicates.** `tests/api/helpers` cannot import `apps/api` sources (`import-x/no-relative-packages`; tests/api is a workspace). A predicate used by the app and the contract helper goes in `@platform/shared`.
- **Credential presence changes the stub's answer.** Once the authn stub 401s any request carrying a credential, PR #20's logging tests (which send Authorization and cookie sentinels to anonymous fixtures) need a stand-in authenticator in the `pipeline` seam.
- **ESLint `--fix` for `no-unnecessary-type-assertion`** can remove a deliberate invalid-input cast in a negative test and break tsc. Use `const x: unknown = ...; x as T` instead.
- **PR #33 (`jest-config-owned.test.ts`)** requires every path that `jest.config.ts` hands to Jest to be in CODEOWNERS. A new globalSetup or teardown needs a CODEOWNERS line.
- **Docker hang after a full disk (D-ORCH-048/049).** The docker-desktop WSL distro returned I/O errors, `docker info` timed out, and agents may not restart Docker. With no evidence on an ancestor of the head, lane A's "Lane B evidence" step fails early and SKIPS the rest of fast-lane, so local lint, unit and build are the only proof. Report the evidence as pending.
- **Kill your own lock-waiting background scripts before handing off.** Use `ps -ef | grep gates.sh`, then `kill <bash pids>`. Otherwise they grab docker.lock after the restart, unattended.
- **Scratch wiped again mid-run** (gates4.sh and evidence.sh were gone). Keep scripts in a fresh `wave0/<pr>/` folder and rewrite them when needed.

Related: [[p5-dispatch]], [[pr20-fc3]], [[lane-b-evidence-run]], [[merge-main-pass]]
