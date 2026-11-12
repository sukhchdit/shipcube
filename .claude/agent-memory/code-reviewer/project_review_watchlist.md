---
name: review-watchlist
description: Open items from PR #1 (TASK-001) review rounds 1-2 to re-check when later PRs touch the same files (TASK-002/003/004/007/014/015)
metadata:
  type: project
---

PR #1 (TASK-001) went CHANGES_REQUESTED in round 1 and APPROVED in round 2 at 4ec1bc4 (2026-11-12). M1, M2, m1, m2, m3, n4 and n6 were verified fixed, and the ADR text drift was ratified in D-ARCH-035..039. Still open, by owner:
- TASK-015 (coverage gates): `tools/repo/coverage-scope.test.ts` drops glob-form tsconfig `include` entries, so a workspace whose include is only globs escapes the drift check (R2-m1). The `jest-util` exact pin is not tied to Jest's own copy (R2-n2). The barrel exclusion `!packages/*/src/index.ts` needs a lint rule or must be removed (m4, also TASK-002).
- TASK-003: verify that `prisma migrate` works under ignore-scripts with no unverified engine download (m6 / PR1-SEC-02). The real-run deps:rebuild unit test will start running `prisma generate` (R2-n5).
- TASK-004: give jsdom tests their own `customExportConditions` (m8).
- TASK-007: the `check-lockfile` wording in DECISIONS.md L918 says link entries have no `resolved`, but npm v3 link entries do (R2-n4).
- TASK-014: stale `dist/` output and compiled tests; require a clean context and stripping (m9, D-ARCH-038).
- TASK-002: NITs n1, n2, n3, n5; `engines.node` floor of 24.2 (R2-n1).
- ADR-0003 file-or-folder layer wording and the `tests` folder-only rule (m5).

**Why:** these were deferred as tracked conditions, so they can slip silently into later PRs.
**How to apply:** when a PR touches jest.config.ts, the tsconfigs, .npmrc, the lockfile checks, prisma or Dockerfiles, grep for the matching item. Drop an entry once it is verified fixed. Fix cycles that list the mutation proving each guard worked well; ask for that again.
