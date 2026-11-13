---
name: project-p5-pr21-openapi-pipeline
description: PR #21 (TASK-017 OpenAPI pipeline + Swagger UI) R1 @b0ede35 PASS_WITH_FOLLOW-UPS; PR21-SEC-01 LOW (docs ETag cost) + 02..07 INFO; PR10-SEC-08 contract side closed, allowlist removal owed by devops; Swagger/Express/gitleaks facts; later-task checks
metadata:
  type: project
---

The PR #21 review is `docs/05-quality/security/PR-0021-TASK-017-security-review.md`.
- **R1:** head `b0ede35`, 2026-11-13, PASS_WITH_FOLLOW-UPS.
- **Simulated record check** (main's checker, base `da5821a`): pass. Controls B–E gave missing, including D: a merge of `main` after the record voids it.
- **Open findings:**
  - 01 LOW: per-request Express ETag over 0.8–1.6 MB docs bodies;
  - 02–07 INFO: Swagger defaults and same origin; DOCS_ENABLED text vs config; `!**/*.gen.ts` suffix-wide coverage glob; `types.gen.ts` types-only test; drift scope and OPTIONS placement; `$ref` http and redaction list.

**Facts, probe-confirmed 2026-11-13:**
- **swagger-ui-dist 5.34.1:**
  - `queryConfigEnabled` defaults to false, so `?url=` / `?configUrl=` are ignored.
  - `validatorUrl` defaults to validator.swagger.io. The `OnlineValidatorBadge` in StandaloneLayout requests it for non-localhost spec URLs; the docs CSP blocks it.
  - `supportedSubmitMethods` defaults to every method.
- **Express 5.3.0 `res.send`:**
  - Generates the ETag (SHA-1) on every response unless an `ETag` header is already set. That costs about 1.2 ms per 1.6 MB.
  - It converts string bodies of 1,000+ characters to a Buffer each time.
  - A nested Router still answers OPTIONS with an automatic 200 text/plain `Allow`.
- **`DOCS_ENABLED`** defaults to `localOnly`: on in local and test only. REQ-API-003 says "on in staging" (PR21-SEC-03).
- **gitleaks v8.30.1 default config:**
  - The `generic-api-key` stopwords include `example`, so `EXAMPLE_…` markers never need an allowlist.
  - Emulated, the head `openapi.yaml` gives 0 hits without any repo allowlist; the base gave 15.
- **openapi-typescript 7.13** escapes `*/` in JSDoc. `types.gen.ts` is types-only.

**Why:** the follow-ups land in other tasks and only close if those reviews check them. Main overlaps the PR on owned paths `eslint.config.mjs` and `package.json` (PR #19 merged as `51178d4`).

**How to apply:**
- **Before merge:**
  - The record must be committed on top of `b0ede35` with no merge of `main`. Otherwise a merge-only delta round is needed: ls-remote, then blob compare, then merge-tree.
  - PR #4 overlaps on `eslint.config.mjs`, `jest.config.ts` and `package.json`; whichever merges second needs a delta.
  - PR #20 overlaps on `app.ts`, `main.ts` and `request-context.ts` (not owned). Re-check the order: docs mount after the body parser and before `routes`, and `optionsResponder` first in `routes`.
- **devops:** remove the PR1-SEC-11 OpenAPI `[[allowlists]]` block from `.gitleaks.toml` (option A). Add a sec-static case asserting that no allowlist path matches `openapi.yaml`. Confirm with the real gitleaks image. This closes PR10-SEC-08.
- **TASK-020:**
  - api/README §15 assertion 2 (`x-permission === route.permission`);
  - walk the composed `app.router.stack` with an explicit `/api/docs` exclusion;
  - the step-0 limiter runs before the docs mount and before `optionsResponder`;
  - PR21-SEC-01 precomputed ETag, if not fixed in this PR.
- **TASK-048/111:** Helmet goes before the docs mount and doesn't clobber the docs CSP; the CORS preflight runs before `optionsResponder`.
- **TASK-015:** an exact-path coverage exclusion instead of `**/*.gen.ts` / `**/*.generated.ts`.
- **TASK-010:** reuse its redaction key list in `tests/api/helpers/contract-validator.ts`.
- **G4-production:** if docs are ever enabled in production, serve them from a cookieless origin with try-it-out off.

Related: [[project-p5-pr10-ci-lane]], [[project-p5-pr9-runtime-skeleton]], [[project-p5-pr17-fixture-subset]], [[project-security-review-conventions]]
