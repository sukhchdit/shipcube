---
name: project-p5-pr21-openapi-pipeline
description: PR #21 (TASK-017 OpenAPI pipeline + Swagger UI) R1 @b0ede35 + R2 @b31483b (fc2 e046ea2 covered) PASS_WITH_FOLLOW-UPS; 01 LOW closed; new INFO 08 ($ref tests vacuous) and 09 (lint ignore prefix-only); Swagger/Express/ref-parser facts; later-task checks
metadata:
  type: project
---

The PR #21 review is `docs/05-quality/security/PR-0021-TASK-017-security-review.md`.
- **R1:** head `b0ede35`, 2026-11-13, PASS_WITH_FOLLOW-UPS.
- **R2:** head row `b31483b` (fix cycle 1 + merge of main `d38500a`), 2026-11-13, PASS_WITH_FOLLOW-UPS. Written uncommitted into the main checkout.
  - It also covers fix cycle 2 `e046ea2`: unowned drift walker, `app.ts` comment only. R2 authorises `e046ea2`.
  - **Closed:** 01, 02, 04, 05; the code parts of 06/07.
  - **New INFO:**
    - 08: `$ref` guard tests are vacuous; `openapi-typescript` fetches http refs.
    - 09: the `no-relative-packages` ignore `^(?:\.\./)+apps/api/src/` lets `apps/api/src/../` escape. Same item as code review R2-n1; D-ORCH-024 routes it to TASK-020.
  - **Sim:** pass, plus the controls B–G3.

**Facts, probe-confirmed 2026-11-13:**
- **swagger-ui-dist 5.34.1:** `queryConfigEnabled` defaults to false; `validatorUrl` defaults to validator.swagger.io; `supportedSubmitMethods` defaults to every method. The PR now pins all three, and uses BaseLayout outside local.
- **Express 5.3.0 `res.send`** skips ETag generation when an `ETag` header is preset, and still answers 304 via `req.fresh`. `app.set('etag fn', counter)` is the probe for per-request hashing.
- **json-schema-ref-parser 16.0.5** http resolver defaults to `safeUrlResolver: true`, so loopback/private refs are refused even WITHOUT `resolve.http:false`.
  - A "local server got 0 requests" test is therefore not discriminating.
  - Use an `.invalid` host: with `http:false` the error is "Unable to resolve $ref pointer"; with the option removed it is "Error downloading".
  - In safe mode it uses its own pinned node:http client, not global `fetch`.
- **openapi-typescript 7.13** follows external http(s) `$ref`s via Redocly: 2 requests per ref.
- **YAML quoted keys** `"$ref":` / `'$ref':` evade a text regex for `\$ref:`.
- **import-x `ignore`** patterns are tested against the RAW specifier, before resolution.
- **Windows host artefact:** `node:http` + `Connection: close` + a ≥1.5 MB body written async (e.g. `setImmediate`) is truncated by an RST. Plain-node controls reproduce it, so it is not a PR issue; use keep-alive or header-only checks.
- **gitleaks v8.30.1:** `generic-api-key` stopwords include `example`. The head `openapi.yaml` (blob-equal since R1) gives 0 hits without an allowlist.

**Why:** the follow-ups land in other tasks and only close if those reviews check them. Owned overlaps with open PRs: #20 (`eslint.config.mjs`, `negative-fixtures`), #23/#22/#15 (`package.json`).

**How to apply:**
- **Before merge:** the record is committed on top of `e046ea2`. Any further commit must stay inside `tools/openapi/**` plus `app.ts` comments, otherwise a delta round is needed. Do not merge main if it brings an owned path.
- **PR #20 (merges second, D-ORCH-024 (3)):** a merge-only/delta round. Check:
  - `requestContextMiddleware(options)` carries both `apiMode` and `requestId`;
  - the docs mount stays inside `routes` after `optionsResponder`;
  - context and body parser come before `routes`;
  - `routePrefix` is the first layer of `api`;
  - the single redaction list (07b).
- **devops:** remove the `.gitleaks.toml` PR1-SEC-11 OpenAPI block (R1 §5.1 option A), add a sec-static case, and confirm with the real image. This closes PR10-SEC-08.
- **TASK-020:**
  - 08: an `.invalid`-host message assertion, and a parsed-YAML `$ref` walk;
  - 09: the regex `(?!(?:.*/)?\.\.(?:/|$))` plus a traversal REPO_PROBE;
  - `x-permission === route.permission`;
  - assert the excluded `/api/docs` mount serves only GET/HEAD on allow-listed paths;
  - the step-0 limiter and CORS before `routes` (before `optionsResponder` and the docs).
- **TASK-048/111:** Helmet before `routes`, without clobbering the docs CSP that `send()` sets.
- **TASK-015:** anchor `**/*.generated.ts`.
- **G4-production:** docs in prod only from a cookieless origin, with try-it-out off.

Related: [[project-p5-pr10-ci-lane]], [[project-p5-pr20-logging]], [[project-p5-pr9-runtime-skeleton]], [[project-security-review-conventions]]
