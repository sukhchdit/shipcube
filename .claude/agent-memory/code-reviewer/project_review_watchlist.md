---
name: review-watchlist
description: Open deferred items from PR #1 (TASK-001) and PR #4 (TASK-004) reviews, by owner task, to re-check when later PRs touch the same files
metadata:
  type: project
---

PR #1 (TASK-001) went CHANGES_REQUESTED in round 1 and APPROVED in round 2 at 4ec1bc4 (2026-11-12). Still open, by owner:
- TASK-015 (coverage gates): `tools/repo/coverage-scope.test.ts` drops glob-form tsconfig `include` entries (R2-m1). The `jest-util` exact pin is not tied to Jest's own copy (R2-n2). The barrel exclusion `!packages/*/src/index.ts` needs a lint rule or must be removed (m4, also TASK-002).
- TASK-003: verify `prisma migrate` under ignore-scripts with no unverified engine download (m6 / PR1-SEC-02). The real-run deps:rebuild test will start running `prisma generate` (R2-n5).
- TASK-007: the `check-lockfile` wording in DECISIONS.md L918 says link entries have no `resolved`, but npm v3 link entries do (R2-n4).
- TASK-014: stale `dist/` output and compiled tests; require a clean context and stripping (m9, D-ARCH-038).
- TASK-002: NITs n1, n2, n3, n5; `engines.node` floor of 24.2 (R2-n1).
- ADR-0003 file-or-folder layer wording and the `tests` folder-only rule (m5).
- (m8, jsdom customExportConditions: RESOLVED in PR #4 r1, unit-dom project.)

PR #4 (TASK-004) r1 at 519bb89 went CHANGES_REQUESTED (2026-11-12). The only MAJOR is the open Playwright AC; the harness lands after the cooldown. Routed elsewhere:
- TASK-022: Nginx `gzip on` (also asked of PR #4) and pre-compressed `*.gz`; `VITE_PUBLIC_ORIGIN` as a required build arg (it defaults to localhost:8080); `/.well-known/` blocked by the dotfile rule.
- TASK-038: theme.css does not reset `--text-*`/`--shadow-*`; the dark palette is duplicated.
- TASK-042: SPA-fallback hydration of locale (lang/text from the URL vs the `/`-built index.html) must be hydration-safe.
- Lazy-route task: the size-limit globs sum all chunks; the 150 kB per-chunk check and the cross-app check are missing (NFR-WEB-004).
- TASK-002 config: `i18next/no-literal-string` hits test files; consider excluding TEST_FILES.

**Why:** these were deferred as tracked conditions, so they can slip silently into later PRs.
**How to apply:** when a PR touches jest.config.ts, the tsconfigs, .npmrc, the lockfile checks, prisma, Dockerfiles, infra/nginx, theme.css, .size-limit.json or the i18n setup, grep for the matching item. Drop an entry once it is verified fixed. Fix cycles that list the mutation proving each guard worked well; ask for that again.
