---
name: project-p5-wave0-web-scaffolds
description: PR-0004/TASK-004 web+admin scaffolds — R1 519bb89 and R2 d2e867b both PASS_WITH_FOLLOW-UPS; PR4-SEC-10..12 new; nginx/Vite/Jest/React Router facts; PR #17 merge-order overlap; what TASK-014/015/022/111 reviews must check
metadata:
  type: project
---

PR #4 (TASK-004) record: `docs/05-quality/security/PR-0004-TASK-004-security-review.md`, IDs PR4-SEC-01..12.
- **R1** (`519bb89`, 2026-11-12): 3 LOW, 6 INFO.
- **R2** (`d2e867b`, 2026-11-13): PASS_WITH_FOLLOW-UPS; record check simulated with main's tool → pass (controls: R1-only record and `--pr 5` both missing).
  - Closed: 01 (envPrefix `VITE_PUBLIC_` + canary int test), 03 (harness lockfile = exactly 4 tuples, post-cooldown), 04 (lane A porcelain backstop), 05 (static NoIndex), 07 (static server 400s; 37-request probe clean).
  - 08 partly: `deps:rebuild` does not refuse inherited `PLAYWRIGHT_*DOWNLOAD_HOST` (its `forbiddenEnv` is Prisma-only).
  - New: 10 LOW (ESLint/Stylelint ignore `**/test-results/**`, `**/playwright-report/**` at any depth while `.gitignore` is anchored, so tracked deep source folders go unlinted); 11 LOW (`tools/test-dom/` unowned after the move out of owned `tools/test-support/`); 12 INFO (`default_server` comment overclaims).
  - PR2-SEC-09 (`TEST_FILES` anchoring) and the PR2-SEC-03 TS-only block were NOT taken by TASK-004; I re-routed them to TASK-022.

**Merge order with PR #17 (`8dd1d24`).** Both change the owned `jest.config.ts` and `tools/lint/negative-fixtures.test.ts`, and `git merge-tree` conflicts in both. Whichever merges second needs a security delta round naming its merge commit. If PR #4 merges first, PR #4 needs no further round.

**Non-obvious facts. Re-verify them before relying on them.**
- **Vite 8 inlining.** A whole-object `import.meta.env` read, even through a TS cast, inlines every `config.env` key. TASK-022 owns the final ADR-0018 `config/web` design (D-ARCH-054): `envPrefix` set to an unused prefix, `define`, and a static key read.
- **nginx `default_server`** applies only when no `server_name` matches. The stock `default.conf` has `server_name localhost`, and nginx strips the port from `Host`, so `Host: localhost:8080` still goes to the stock server. So does IPv6, because the entrypoint adds `listen [::]` only to `default.conf`. Deleting `default.conf` in TASK-014 remains the only real fix.
- **Jest `--selectProjects`** filters AFTER `normalize`. `normalize` only *resolves* every project's `testEnvironment` and `setupFilesAfterEnv` paths (`jest-resolve` `resolveTestEnvironment`); it does not load them. A missing file therefore fails config validation even for an unselected project, but unselected project code never runs.
- **React Router `Meta`** keeps only the deepest route's array. Any "always present" tag must sit statically in `Layout`.
- **`isbot` 5.2.2** in the lockfile is a normal transitive dev dependency of `@react-router/dev`.
- **Host endpoint protection** blocked `ms-playwright\firefox-1572\firefox.exe` with EPERM (D-ORCH-019). My `Get-MpThreatDetection` query was denied by the permission classifier; do not retry it. I routed the triage to the orchestrator.

**Why:** these follow-ups land in later tasks, and the gates close only if each later review checks them.

**How to apply:**
- **TASK-014:**
  - `rm conf.d/default.conf` and clean the html root;
  - copy `build/client/` only;
  - an `nginx -T` single-server test;
  - `Host: localhost` and IPv6 checks;
  - `NPM_CONFIG_OFFLINE` plus the manifest checksum guard.
- **TASK-022:**
  - PR4-SEC-10 anchoring, if this PR did not do it;
  - PR2-SEC-09 and the TS-only block;
  - `config/web`;
  - a CSP covering 4 classic + 1 module inline scripts per page, with a separate hash set for the SPA fallback;
  - fix the template wording: HSTS and Permissions-Policy belong to TASK-111.
- **TASK-015:**
  - PR4-SEC-11: add `/tools/test-dom/` to CODEOWNERS, plus a test that every `jest.config.ts` reference is owned (together with PR17-SEC-01);
  - make `deps:rebuild`'s Playwright step refuse `PLAYWRIGHT_*DOWNLOAD_HOST`;
  - `--with-deps` only in lane C;
  - COND-E2E-FF.
- **TASK-111:** test both images, including a non-matching `Host`; re-assess `gzip` before any HTML carries a token or nonce.
- **Interim, in every PR:** grep the diff for `tools/test-dom/` and for deep `test-results`/`playwright-report` folders.

Related: [[project-p5-wave0-supply-chain]], [[project-security-review-conventions]], [[project-p5-pr17-fixture-subset]], [[project-p5-pr2-lint-controls]]
