---
name: project-p5-wave0-web-scaffolds
description: PR-0004/TASK-004 web+admin scaffolds — R1 519bb89, R2 d2e867b, R3 e3cdb94 all PASS_WITH_FOLLOW-UPS; 10/11 closed in R3; PR4-SEC-13 INFO (typegen runs unowned code before lint); nginx/Vite/Jest/React Router facts; what TASK-014/015/022/111 reviews must check
metadata:
  type: project
---

PR #4 (TASK-004) record: `docs/05-quality/security/PR-0004-TASK-004-security-review.md`, IDs PR4-SEC-01..13.
- **R1** (`519bb89`, 2026-11-12): 3 LOW, 6 INFO.
- **R2** (`d2e867b`, 2026-11-13): PASS_WITH_FOLLOW-UPS. Closed 01, 03, 04, 05, 07; 08 partly. New 10 LOW, 11 LOW, 12 INFO.
- **R3** (`e3cdb94`, 2026-11-13): PASS_WITH_FOLLOW-UPS, written uncommitted into the main checkout for the orchestrator to commit.
  - Covers two main-merges (`8d5a4ac` with PR #17/#18, `e3cdb94` with PR #19) plus fix cycle 3.
  - **Closed:** 10 (anchored ignores; my ESLint `isPathIgnored` probe gave 17/17) and 11 (CODEOWNERS + `REQUIRED_CODEOWNED_PATHS`).
  - **New: PR4-SEC-13 INFO.** See below.
  - **Merges:** the jest.config/negative-fixtures resolutions keep every PR #17/#18/#19 control. `unit-dom` inherits `swcrc:false`, and `jest-transform.test.ts` asserts the transform for every project. The lockfile delta is equal leaf for leaf.
  - **Record sim:** pass with 17 owned paths, including `tools/test-dom/*` via the head CODEOWNERS. Controls (R2-only record, `--pr 17`, a rule-(d) `jest.config.ts` edit) all gave missing.
- **Still open:** 02 and 12 (TASK-014); 06 (TASK-022/111); 08 residuals (TASK-015); PR2-SEC-09 and the TS-only block (TASK-022).

**PR4-SEC-13 (INFO).** Root `lint` and `typecheck` start with `npm run typegen` = `npm run typegen --workspaces --if-present`. That runs unowned workspace scripts, and `react-router typegen` itself:
- calls `vite.resolveConfig`, which executes `vite.config.ts` (`@react-router/dev` 8.5.1 `cli/index.js:98-106`);
- evaluates `react-router.config.ts` and `app/routes.ts`.

All of this runs in the fast-lane before ESLint and `tsc`. It is not a new capability: `deps:rebuild` → `prisma generate` already runs the unowned `prisma.config.ts` before lint.
- I missed this angle in R2.
- Fix in TASK-015: a porcelain gate right after `Lint`; root typegen as `npm exec --no -w apps/web -w apps/admin -- react-router typegen`; consider owning `prisma.config.ts` and `apps/*/vite.config.ts`.
- **Interim:** flag workspace typegen scripts and RR/Vite/Prisma config edits that add fs writes, spawns or network access.

**Non-obvious facts. Re-verify them before relying on them.**
- **Vite 8 inlining.** A whole-object `import.meta.env` read, even through a TS cast, inlines every `config.env` key. TASK-022 owns the final ADR-0018 `config/web` design (D-ARCH-054).
- **nginx `default_server`** applies only when no `server_name` matches. The stock `default.conf` has `server_name localhost`, and nginx strips the port from `Host`. Deleting `default.conf` in TASK-014 remains the only real fix.
- **Jest `--selectProjects`** filters AFTER `normalize`. `normalize` only *resolves* every project's environment and setup paths; unselected project code never runs.
- **React Router `Meta`** keeps only the deepest route's array. "Always present" tags must sit statically in `Layout`.
- **Host endpoint protection** blocked Playwright's `firefox.exe` with EPERM (D-ORCH-019). My `Get-MpThreatDetection` query was denied; do not retry it.

**Why:** these follow-ups land in later tasks, and the gates close only if each later review checks them.

**How to apply:**
- **TASK-014:**
  - `rm conf.d/default.conf`; copy `build/client/` only;
  - `nginx -T` single-server test; `Host: localhost` and IPv6 checks;
  - `NPM_CONFIG_OFFLINE` plus the manifest checksum guard.
- **TASK-022:** PR2-SEC-09 and the TS-only block; `config/web`; the CSP hash sets; the template header-owner wording.
- **TASK-015:**
  - PR4-SEC-13 items;
  - the generic test that every path `jest.config.ts` references is owned;
  - `deps:rebuild` refuses `PLAYWRIGHT_*DOWNLOAD_HOST`;
  - `--with-deps` only in lane C;
  - COND-E2E-FF.
- **TASK-111:** test both images, including a non-matching `Host`; re-assess `gzip` before any HTML carries a token or nonce.
- **After PR #4 merges:** the interim `tools/test-dom`/deep-output-folder check retires. If PR #4 is re-merged with a main that changes its owned paths, it needs an R4.

Related: [[project-p5-wave0-supply-chain]], [[project-security-review-conventions]], [[project-p5-pr17-fixture-subset]], [[project-p5-pr2-lint-controls]], [[project-p5-pr10-ci-lane]]
