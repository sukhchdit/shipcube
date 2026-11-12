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

PR #5 (TASK-003) r2 at 4574a14 was APPROVED_WITH_NITS (2026-11-12). r3 merge-main delta at 614eb96 was also APPROVED_WITH_NITS. The PR #1 TASK-003 items (m6, R2-n5) are closed. Routed:
- TASK-016 (owns `tools/db/lint-migrations.ts` rules 3–9/11/14):
  - R3-n1: `prisma/tests/**` has `import-x/no-relative-packages: 'off'` (eslint.config.mjs ~:417). Restrict its targets with a boundaries policy: tools-db, tools/test-support, db-platform, prisma-generated.
  - R2-m1, rule 13: `FIXED_PATH` matches anywhere, so a second `SET search_path = public` wins in PostgreSQL (last value kept); require exactly one SET.
  - R2-m2, rule 10: blind to UPDATE/DELETE inside `DO` bodies.
  - R2-n1: `U&"…"` identifiers evade rule 12 in both lanes.
- TASK-006: runtime pool `statement_timeout` (m7).
- TASK-014: reset portless URL with `PGPORT` set (R2-n3); silent deploy-timeout exit (R2-n4); `reset.ts` passes `string|undefined` bootstrapUrl, guarded only in `resetTarget` (R3-n2).
- Architect:
  - data-model §8.3 rule 13 still says "header up to AS".
  - D-ARCH-049's rule-12 "precision" sentence is superseded by deny-by-default.
  - ADR-0018 register lacks the `BOOTSTRAP_*_PASSWORD_FILE` exception.

PR #3 (TASK-005) r3 at 0e48a2a was APPROVED_WITH_NITS (2026-11-12). R2-m1 and R2-n1..n4 are closed (shared predicates, AST scan, permanent errors, slack). Gatekeeper must re-run gates on the merge-main commit with TASK-003. New NITs, optional in-PR, else TASK-022:
  - r4 merge-main delta at 3e390e0 (2026-11-12) was APPROVED_WITH_NITS. R4-n1: the compose-env SCRAM test loop does not name the failing key. gh showed no CI checks on that head; confirm CI before merge.
  - R3-n1: the web `missing` issue carries `rule: invalid_type`; the backend has none.
  - R3-n2: the differential `Verdict` lacks the rule id (mutant M8 survives the property).
  - R3-n3: the backend import graph deny-lists zod and does not follow `@platform/config/web` self-reference; switch to an allow-list.
  - R3-n4: BRAND_NAME accepts controls, bidi and lone surrogates (it reaches e-mail headers).
Still open from r2:
- TASK-014 / migrate-job owner:
  - R2-m2: tooling keys get no placeholder or verify-full check in the tools themselves.
  - The inspector guard only detects; a Checkov or task-def NODE_OPTIONS lint is needed.
- TASK-006/014: file provider `O_NOFOLLOW` and TOCTOU; m4 `loadRuntimeConfigOrExit`; m5 holder enforcement.
- Crypto tasks: m6 local key derivation.

**Why:** these were deferred as tracked conditions, so they can slip silently into later PRs.

**How to apply:**
- When a PR touches any of these, grep for the matching item: jest.config.ts, the tsconfigs, .npmrc, the lockfile checks, prisma, Dockerfiles, infra/nginx, theme.css, .size-limit.json, i18n, eslint.config.mjs, .gitignore.
- Drop an entry once it is verified fixed.
- Fix cycles that list the mutation or fixture proving each guard worked well (PR #1 r2, PR #2 r2). Ask for that again.

PR #6 (TASK-009, SPK-02 carrier docs) r1 at 4e5d05f went CHANGES_REQUESTED (2026-11-12).
- M1: the UPS GIF→PDF recommendation assumes pdfkit reads GIF. pdfkit 0.20.2 reads JPEG/PNG only (`Unknown image format.`). UPS Label Recovery lists `PDF`. REQ-DOC-002 is PDF-only.
- m1: the FedEx SDK F5 `index.js` confirms the ship, cancel (PUT) and address-resolve paths that the README marks unverified.
- Also open: m2 pin source SHAs; m3 DHL sandbox/prod share a host, so bind base URL to env and never follow carrier-returned URLs; m4 PII in query strings (DHL `requestorName`) and data minimisation.
- r2 at f0387d4 was APPROVED_WITH_NITS (2026-11-12). M1, m1–m4 and n1–n7 are closed. The UPS PDF decision is ADR-0010 am. 11 item 3: Label Recovery plus an optional `recoverLabel`. CI was empty on the head.
- R2 NITs, routed:
  - TASK-191: README heading "Personal data and secrets" vs US-137's "PII and redaction"; the UPS Docs URL row lacks a SHA.
  - TASK-140: Label Recovery `Code` has minLength 4, but "PDF" is 3 characters (`Shipping.yaml:13499`).
  - TASK-113: prefix match must respect path-segment boundaries, because the `/security/v1/oauth/token` prefix has no trailing slash.
  - TASK-135: DHL README §3.3/§8 are stale; add the `create-timeout-then-tracking-reconcile` fixture.
  - Architect: am. 11 gives npm `time.modified` dates as release dates.
- When TASK-113/135/139/140 PRs land, check that m3 and m4 are implemented: per-adapter EGRESS tests, query stripped from logs, inline labels only, DHL `requestorName` constant, token-endpoint 403 cool-down.

PR #7 (TASK-008, SPK-03) r2 at 065aa3e was APPROVED_WITH_NITS (2026-11-12). M1 and m1–m7 are closed in-PR; (d) is opt-in via `SPK03_BENCH=1`. Routed, check when TASK-016 lands:
- R2-m2 (orchestrator): the TASK-016 C-1 sheet line (WAVE-00.md ~:589) must set `SPK03_BENCH=1`, otherwise the hosted run skips (d) and the C-1 artifact is empty. The ported suite asserts server-side p95 ≤ 1 ms without the flag. Then the spike file is deleted.
- R2-m1 (architect): ADR-0005 am. 10 item 4 asks for a negative control proving that session-level `app.*` "cannot be set by platform_app". That is infeasible (USERSET placeholder); the control must prove the leak instead.
- R2-n1/n2 (architect): the "existing lint rule" claim is back in am. 10 item 2. Item 12 lists a statement_timeout role default that does not exist. data-model §4.1 still has 6 settings while item 12 adds lock/idle timeouts.
- TASK-016 PR: check the ALS `NESTED_TENANT_TX` guard, the TenantDb Proxy, `mapDbError` on `originalCode`, the token ban, and the ported F-04 negative control.

PR #8 (TASK-013 authz catalogue) r2 at 498e3a5 was APPROVED_WITH_NITS (2026-11-12). M1–M3, m1–m6 and n1–n3 are closed. Still open:
- R2-m1 (MINOR): a verb in the action segment with a `read` qualifier (`shipment:void:read`) classifies as read. Fix in-PR or route to TASK-020. When TASK-020 or the next authz PR lands, check for a `SUB_RESOURCES` middle-segment allow-list in `checkKeyShape`.
- R2-n2: `ASSIGNABLE_BY` needs a target ⊆ assigner property test (TASK-231/235).
- R2-n3: the v1 pin lives beside the generator; the TASK-016/007 migration-immutability check vs origin/main must exist.
- R2-n1: Auditor `audit:*` breadth (architect).
Routed:
- TASK-023 must not seed `permissions`, `roles` or `role_permissions`.
- TASK-016's R3-n1 allow-list gains the `prisma/tests → tools/authz` edge.
- Any CATALOGUE_VERSION bump needs the delta renderer first (`artefacts()` throws above v1).
