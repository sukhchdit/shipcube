---
name: review-watchlist
description: Recurring issues raised in round 1 of PR #1 (TASK-001) to re-check in later rounds and in later PRs
metadata:
  type: project
---

Round 1 of PR #1 (TASK-001, 2026-11-12) returned CHANGES_REQUESTED. Re-check these in later rounds and PRs:
- Coverage scope: `collectCoverageFrom` must include `apps/{web,admin}/app/**` (React Router framework mode) and `prisma/**`, not only `*/src/**` (M1). Applies to any PR touching jest.config.ts, especially TASK-004 and TASK-015.
- New workspaces must be listed in the root `tsconfig.json` references. A guard test was requested (M2).
- `tools/deps/rebuild.mjs` entry guard silently no-ops through a symlink or junction path (m1). The `deps:rebuild` real run was untested (m2).
- `prisma migrate` under `ignore-scripts` is unverified because the `@prisma/engines` postinstall is skipped (m6). Check it in TASK-003.
- `tsc -b` leaves stale dist output and compiles tests into dist. Check the .dockerignore and clean build in TASK-014.
- ADR text still says `tsc -b --noEmit`, npm 10 and `npx`. TS6310 makes `--noEmit` impossible (the reviewer verified it). Make sure the principal-architect amendment lands.

**Why:** these were deferred or conditional, so they can slip silently into later PRs.
**How to apply:** grep for each item when reviewing any PR that touches the same files. Drop an entry once it is verified fixed.
