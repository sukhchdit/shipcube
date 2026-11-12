---
name: review-watchlist
description: Open deferred items from the PR #1 (TASK-001), PR #2 (TASK-002), PR #4 (TASK-004) and PR #5 (TASK-003) reviews, by owner task, to re-check when later PRs touch the same files
metadata:
  type: project
---

PR #1 (TASK-001) was APPROVED in round 2 at 4ec1bc4 (2026-11-12). Still open, by owner:
- TASK-015 (coverage gates): `tools/repo/coverage-scope.test.ts` drops glob-form tsconfig `include` entries (R2-m1). The `jest-util` exact pin is not tied to Jest's own copy (R2-n2).
- TASK-007: the `check-lockfile` wording in DECISIONS.md L918 says link entries have no `resolved`, but npm v3 link entries do (R2-n4).
- TASK-014: stale `dist/` output and compiled tests; require a clean context and stripping (m9, D-ARCH-038).
- ADR-0003: file-or-folder layer wording, and the `tests` folder-only rule (m5).

PR #2 (TASK-002) was APPROVED_WITH_NITS in round 2 at 6ba7649 (2026-11-12). The PR #1 items that were routed to TASK-002 are all closed, including the engines floor and lock drift. Routed from PR #2:
- TASK-015: `any-justification` must require `TASK-\d+` and cover the `no-non-null-assertion` / `ban-ts-comment` suppressions (m7).
- TASK-006: fixtures for the worker's package-specifier import form (m8). Routes may import another module's `index.ts` and so reach its service; add `module-entry` to the routes disallow (R2-n7).
- Carriers adapter task: forbid ioredis/iovalkey/bullmq in packages/carriers (m9b).
- TASK-076: `money-arith` needs a type-aware `Minor` brand check (m10).
- TASK-016: narrow the audit-writer allow-list (n5).
- TASK-007:
  - `.gitignore` ignores dist/build/coverage at ANY depth, so source folders named like that are silently untracked (R2-m1).
  - Stylelint ignores are not symmetric with the ESLint ones (R2-n8).
  - Semgrep backstop for aliased `createRequire`.
- TASK-004: add `**/playwright-report/**` and `**/test-results/**` to the ESLint and Stylelint ignores (R2-n9).
- TASK-025 and TASK-043 must use the exact Prisma paths `packages/audit/src/store/prisma-store.ts` and `apps/api/src/platform/outbox/writer.ts`.
- Web/admin may import only `@platform/shared` and `@platform/ui`. PR #3 r2 ruled that `apps/*/vite.config.ts` → `@platform/config/web` is blocked today. It needs an ADR-0003 carve-out: a `web-build-config` category, the exact subpath only, plus a devDependency (review §R2.4).
- Architect: ADR-0002 §6 stylelint script wording (n4).

PR #4 (TASK-004) r1 at 519bb89 went CHANGES_REQUESTED (2026-11-12). The only MAJOR is the open Playwright AC. Routed:
- TASK-022:
  - Nginx `gzip on` and pre-compressed `*.gz`.
  - `VITE_PUBLIC_ORIGIN` as a required build arg.
  - `/.well-known/` is blocked by the dotfile rule.
- TASK-038: theme.css does not reset `--text-*`/`--shadow-*`; the dark palette is duplicated.
- TASK-042: SPA-fallback locale hydration must be hydration-safe.
- Lazy-route task: the size-limit globs sum all chunks; the per-chunk 150 kB check and the cross-app check are missing (NFR-WEB-004).

PR #4 r2 at 9f5ea5e (non-harness delta) is still CHANGES_REQUESTED, with M1 only. Round 3 = harness commit + merge-main, checklist in review §R2.4. Check:
- R2-m1: drop the `as UserConfig` cast in `apps/*/vite.config.test.ts`.
- R2-m2: root `lint` must run `npm run typegen` first. Without `.react-router/`, the type-aware rules fail on `Route.*` params; verify with that dir deleted.
- m2: an `/es/no-such-page` hydration error must not be allow-listed in the console guard.
Routed:
- TASK-022/TASK-111: `gzip_proxied`/`gzip_http_version` behind the edge or CloudFront.
- TASK-014: IPv6 `listen` with `default_server`.

PR #5 (TASK-003) r2 at 4574a14 was APPROVED_WITH_NITS (2026-11-12). The PR #1 TASK-003 items (m6, R2-n5) are closed. Routed:
- TASK-016 (owns `tools/db/lint-migrations.ts` rules 3–9/11/14):
  - R2-m1, rule 13: `FIXED_PATH` matches anywhere, so a second `SET search_path = public` wins in PostgreSQL (last value kept); require exactly one SET.
  - R2-m2, rule 10: blind to UPDATE/DELETE inside `DO` bodies.
  - R2-n1: `U&"…"` identifiers evade rule 12 in both lanes.
- TASK-006: runtime pool `statement_timeout` (m7).
- TASK-014: reset portless URL with `PGPORT` set (R2-n3); silent deploy-timeout exit (R2-n4).
- Architect:
  - data-model §8.3 rule 13 still says "header up to AS".
  - D-ARCH-049's rule-12 "precision" sentence is superseded by deny-by-default.
  - ADR-0018 register lacks the `BOOTSTRAP_*_PASSWORD_FILE` exception.

PR #3 (TASK-005) r2 at 875409d was APPROVED_WITH_NITS (2026-11-12). PR #2 was not in the branch, so type-aware lint must pass on the merge-main commit. Routed:
- In-PR or TASK-022: R2-m1, Joi/Zod BRAND_* parity diverges outside the curated vectors; needs shared predicates.
- TASK-014 / migrate-job owner:
  - R2-m2: tooling keys get no placeholder or verify-full check in the tools themselves.
  - The inspector guard only detects; a Checkov or task-def NODE_OPTIONS lint is needed.
- TASK-006/014: file provider `O_NOFOLLOW` and TOCTOU; m4 `loadRuntimeConfigOrExit`; m5 holder enforcement.
- Crypto tasks: m6 local key derivation.
- Nits:
  - R2-n1: import-graph regex misses dynamic `import()`.
  - R2-n3: permanent `SecretFileError` failures are retried.
  - R2-n4: tight timing bounds in tests.

**Why:** these were deferred as tracked conditions, so they can slip silently into later PRs.

**How to apply:**
- When a PR touches any of these, grep for the matching item: jest.config.ts, the tsconfigs, .npmrc, the lockfile checks, prisma, Dockerfiles, infra/nginx, theme.css, .size-limit.json, i18n, eslint.config.mjs, .gitignore.
- Drop an entry once it is verified fixed.
- Fix cycles that list the mutation or fixture proving each guard worked well (PR #1 r2, PR #2 r2). Ask for that again.
