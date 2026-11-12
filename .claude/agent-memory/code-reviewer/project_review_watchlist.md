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
- Round 2: verify these in the delta. When TASK-135/139/140 PRs land, check that m3 and m4 are implemented (HttpClient strips the query from logs, inline labels only).

PR #7 (TASK-008, SPK-03) r1 at 985a552 went CHANGES_REQUESTED (2026-11-12). The only MAJOR is M1: the (d) wall-clock benchmark asserts in the permanent integration suite; required fix is opt-in `SPK03_BENCH=1`. In round 2, check:
- M1 is gated, and SPK-03 §0 and C-1 use the flag.
- m1: P2010 `meta.driverAdapterError.cause.code` and P2028 are pinned with `toMatchObject`.
- m2: `statement_timeout`/`correlation_id` are in `setContext`, with the reset asserted.
- m6: maxWait raised in the 50-parallel test.
Routed to TASK-016 if not fixed in-PR:
- m3: ALS runtime guard against the root client inside `withTenantTx`. The W-2 "existing lint rule" does not exist.
- m4: ban session-level `SET`/`set_config(…,false)`/`RESET`. adapter-pg releases without a reset.
- m5: 55P03 claim-loser test.
- m7: C-1 owned by TASK-016 before G3; port, then delete the spike file.

PR #8 (TASK-013 authz catalogue) r1 at efe23df was CHANGES_REQUESTED (2026-11-12). For round 2, check:
- M1: the Compliance Auditor rule in `guard.ts` used free-text `category === 'audit'`. It must use the key's resource, and `checkCatalogue` must tie category to resource.
- M2: the seed migration needs a sha256 pin per version. `--check` must refuse an in-place rewrite of v1, and versions above 1 need a delta down.
- M3: `session:manage` and `notification_pref:manage` were withheld from Viewer and Auditor (REQ-AUTH-021 Must, ASVS V3.3.4). Closure is a fix or a logged PM + architect ruling.
- m1–m6 are in the review file.
Routed:
- TASK-023 must not seed `permissions`, `roles` or `role_permissions`.
- TASK-016's R3-n1 allow-list gains the `prisma/tests → tools/authz` edge.
- Invitation tasks (US-083/085) need `canAssignRole`: subset of the assigner's permissions, and Owner only by an Owner.
