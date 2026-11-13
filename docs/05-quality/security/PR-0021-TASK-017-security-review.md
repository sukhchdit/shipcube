# PR-0021 / TASK-017: contract-first OpenAPI pipeline, Swagger UI docs endpoint, contract response validation

| Field | Value |
|---|---|
| PR | #21 `feat(api): contract-first openapi pipeline with lint, types, drift and docs ui (TASK-017)`, https://github.com/sukhchdit/shipcube/pull/21, branch `feat/TASK-017-contract-first-openapi-pipeline-redocly`. Seven feature commits plus one merge of `main` @ `80ff2c2`; merge base `80ff2c2`. 43 files, of which one is the generated `packages/shared/src/api/types.gen.ts` (11,566 lines) |
| Head | b0ede35d82329dc1ff4108953d853da9fcedc16c |
| Lane A evidence | Run [43338335195](https://github.com/sukhchdit/shipcube/actions/runs/43338335195) on `b0ede35` (`pull_request`, base `80ff2c2`). **fast-lane `success`**: its "Unit tests" step ran `tools/openapi/drift.test.ts`, `types-drift.test.ts`, `lint.test.ts`, `tests/api/helpers/formats.test.ts`, `path-match.test.ts` and `deprecation.test.ts` (80 suites, 2157 tests). **scans:** Gitleaks and Semgrep `success`. Only "Security-owned paths need a review record" failed, because no `PR-0021-*` record existed; this record is that record. `ci-gate` failed as a consequence. The `*.api.test.ts` suites (`serve.api.test.ts`, `runtime-seams.api.test.ts`, `contract-validation.api.test.ts`, `contract-stubs.api.test.ts`) are not lane A suites (D-ORCH-001); the PR body reports them green locally, and I did not re-run them |
| Owned paths changed | 6, per lane A's checker: `eslint.config.mjs`, `jest.config.ts`, `package.json`, `tsconfig.json`, `tests/api/tsconfig.json`, `tests/contract-stubs/tsconfig.json` |
| Reviewer / date | security-analyst, 2026-11-13. Read-only. Every git command ran in the main checkout against commit SHAs; no git or other command ran in the PR worktree (`Shipqube-TASK-017`). One directory listing of that worktree's `node_modules` was taken from the main checkout, read-only. No install, build, Docker, real gitleaks or suite run. Scratch probes (§2) used the main checkout's `node_modules` through junctions and were removed afterwards |

## 1. Summary

PR #21 adds the contract tooling (Redocly lint, generated types with a freshness check, a route/document drift check, an Ajv-based response validator for tests, and run-time contract stubs). It also adds Swagger UI at `/api/docs` behind `DOCS_ENABLED`, the deprecation-header middleware, the `apiMode` request-context seam and a 204 + `Allow` OPTIONS answer. In `openapi.yaml` it replaces 17 token-like example values with `EXAMPLE_…` markers (PR10-SEC-08, contract side).

**The docs endpoint is gated and contained.**
- `DOCS_ENABLED` defaults to on only for `APP_ENV` local and test, and to off in staging and production (`packages/config/src/schema.ts:224`; the unit test `load-config.test.ts` pins production = false).
- The router serves a fixed allow-list of six `swagger-ui-dist` 5.34.1 files plus its own page, initializer and the contract. A raw-socket probe found no traversal, source map, OAuth redirect page or `index.html` reachable.
- The page CSP has `script-src 'self'` with no script `'unsafe-inline'` or `'unsafe-eval'`, `connect-src 'self'` and `frame-ancestors 'none'`. Swagger UI's `queryConfigEnabled` default is `false` in this version, so `?url=` / `?configUrl=` are ignored.

**The example values are no longer secret-shaped.** A best-effort emulation of the gitleaks v8.30.1 default rules (221 rules, no repository allowlist) reports 15 findings on the base contract and 0 on the head contract. Positive controls were caught. The PR1-SEC-11 OpenAPI allowlist block can therefore be **removed** (§5.1, exact change for devops).

**The owned-path changes open no security hole.** An effective-config probe of head against main, and of the clean merge with today's `main` against today's `main`, shows exactly three ESLint deltas: two `import-x` allowances scoped to test files, and the exact-file ignore of `types.gen.ts`. All `platform/*`, `boundaries`, `no-restricted-imports` and `no-console` rules are unchanged on every probed path. `jest.config.ts` keeps `SWC_JEST_OPTIONS.swcrc: false`. The new tsconfigs are `noEmit`. Ajv is test-only and absent from the runtime closure.

**Findings:** 1 LOW (PR21-SEC-01: per-request ETag hashing of the 0.8–1.6 MB docs bodies) and 6 INFO. Nothing is Critical, High or Medium. PR10-SEC-08 is closed on the contract side; its allowlist side stays open with devops.

## 2. Method

| Area | How |
|---|---|
| Diff | `git diff 80ff2c2 b0ede35` (without `types.gen.ts`, which was checked separately: its only top-level statements are `export interface` ×3 and `export type` ×2) |
| Added-line markers | `eslint-disable`, `nosemgrep`, `gitleaks:allow`, `@ts-ignore`, `@ts-expect-error`, `istanbul`/`c8`/`v8 ignore`, `prettier-ignore`, `stylelint-disable`, `eval(`, `new Function`, `innerHTML`: **0**. One `child_process` import (`tools/openapi/lint.mjs`): `spawn(process.execPath, [<resolved @redocly/cli bin>, 'lint', …])`, no shell |
| Docs router probe | `serve.ts` from `b0ede35`, types stripped (`stripTypeScriptTypes`, transform mode), mounted on a bare Express 5.3.0 app at `/api/docs` with a fallback handler; raw-socket requests (`socket.write`, `Connection: close`). Also measured Express's default ETag function over the served bodies |
| Swagger UI defaults | Read from the installed `swagger-ui-dist` 5.34.1 bundle: `queryConfigEnabled:!1`; `validatorUrl` default `https://validator.swagger.io/validator`, used by `OnlineValidatorBadge` for non-localhost spec URLs; `supportedSubmitMethods` default all methods |
| Gitleaks emulation | `scratchpad/.../gl-emul.mjs`: the v8.30.1 `config/gitleaks.toml` (downloaded), RE2 → JS conversion (all 221 rules compiled), per-line keyword prefilter, `secretGroup`, entropy, the generic-rule digit check, global and rule allowlists including stopwords. Inputs: base and head `openapi.yaml`, plus a control file with a random 40-character value under `api_token:`, a `ghp_`-prefixed 36-character value and a three-part JWT-shaped value, all generated at run time. Values are not reproduced here (PR13-SEC-11) |
| ESLint effective config | `git archive` of `eslint.config.mjs`, `tools/eslint-rules`, `tools/lint` and every `package.json`/`tsconfig*.json` for `80ff2c2` and `b0ede35`, then for `origin/main` `99ea21f` (main after PR #19) and the `git merge-tree` result `9c151bb`. `ESLint#calculateConfigForFile` / `isPathIgnored` on 18 probe paths, rule-by-rule diff |
| Advisories | npm bulk advisory endpoint for the locked `swagger-ui-dist` 5.34.1, `ajv` 6.15.0/8.20.0, `@redocly/cli` 2.75.0, `openapi-typescript` 7.13.0, `@apidevtools/swagger-parser` 13.1.0, `@apidevtools/json-schema-ref-parser` 16.0.5, `express` 5.3.0, `supertest` 7.3.1, `@scarf/scarf` 1.4.0: **none**. Positive control (`minimist` 1.2.0) returned its two advisories. The lockfile is unchanged by this PR |
| Generator safety | `openapi-typescript` 7.13.0 `addJSDocComment` escapes `*/` as `*\/` (`dist/lib/ts.mjs`), so contract text cannot leave a comment in `types.gen.ts`. Redocly CLI 2.75.0 honours `REDOCLY_TELEMETRY=off` and `REDOCLY_SUPPRESS_UPDATE_NOTICE=true` (both read in `lib/`) |

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner | Status |
|---|---|---|---|---|---|---|---|
| PR21-SEC-01 | Docs responses recompute Express's ETag over 0.8–1.6 MB bodies on every unauthenticated request | LOW | CWE-400, CWE-770 | A05 | `apps/api/src/platform/openapi/serve.ts:96-100, 111-114` | senior-developer (this PR or TASK-020/108) | Open |
| PR21-SEC-02 | Swagger UI initializer relies on library defaults (validator badge, try-it-out, query config, top bar); docs share the API origin | INFO | CWE-1188 | A05 | `serve.ts:73-82` | senior-developer; G4-production | Open |
| PR21-SEC-03 | `DOCS_ENABLED` default (local/test only) differs from REQ-API-003 / US-035 / api README ("on in staging"); production can opt in with no further condition | INFO | — | A05 | `packages/config/src/schema.ts:224`; REQUIREMENTS.md REQ-API-003 | product-manager + api-designer | Open |
| PR21-SEC-04 | Coverage exclusion `!**/*.gen.ts` is suffix-wide, while the ESLint ignore is one exact file | INFO | CWE-1127 | A04 | `jest.config.ts:63` | senior-developer / devops (TASK-015) | Open |
| PR21-SEC-05 | `types.gen.ts` is outside ESLint; its types-only property is not asserted by a test | INFO | CWE-693 | A08 | `eslint.config.mjs:416` | senior-developer | Open |
| PR21-SEC-06 | Drift check walks the health router and the module registry, not the composed app; `x-permission` equality is deferred. The OPTIONS answer runs before any future pipeline slot | INFO | CWE-862 (latent) | A01 | `tools/openapi/api-mounts.ts:37`; `apps/api/src/app.ts:57` | TASK-020, TASK-048 | Routed |
| PR21-SEC-07 | Test tooling: `$ref` resolution may fetch over HTTP; the failure-excerpt redaction list is narrower than the contract's sensitive fields | INFO | CWE-918 (latent), CWE-532 | A10 / A09 | `tools/openapi/contract.ts:66`; `tests/api/helpers/contract-validator.ts:19` | senior-developer; TASK-010 | Open |

## 4. Finding details

### PR21-SEC-01: per-request ETag hashing of the docs bodies (LOW)

**Description.** `send()` calls `res.type(type).send(body)` without an `ETag`. Express 5.3.0 `res.send` generates one when none is set (`lib/response.js:162-191`). For a string body of 1,000 characters or more it first converts the body to a Buffer. Then it SHA-1-hashes the whole body, synchronously, on every request. `swagger-ui-bundle.js` is 1,646 KiB and `openapi.yaml` is 804 KiB (a string).

**Measured:** 1.23 ms per response for the bundle and 1.47 ms for the spec, against roughly 0.05 ms for a small JSON body. The routes are unauthenticated by design and have no rate limit yet. Each response is also 0.8–1.6 MB of egress for a ~60-byte request. Conditional requests do get a 304 (probe), but an attacker does not send `If-None-Match`.

**Exploitability and impact.** Wherever the docs are enabled, one client sending a few hundred requests a second to `/api/docs/swagger-ui-bundle.js` keeps an API process's event loop busy and saturates egress. Health probes and API requests on that process slow down with it. The docs are off by default in staging and production (§1), so the exposure today is local/test on 127.0.0.1, or a deployment that sets `DOCS_ENABLED=true`. Impact M, likelihood L → **LOW**.

**Remediation (code-level).**
1. In `createDocsRouter`, build every body once as a Buffer (`Buffer.from(spec, 'utf8')`, `PAGE`, `INITIALIZER`, assets).
2. Precompute a strong validator per body, for example `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`.
3. In `send()`, `res.setHeader('ETag', etag)` before `res.send(body)`. Express then skips generation (`generateETag = !this.get('ETag') && …`) and still answers 304 through `req.fresh`.
4. Keep `Cache-Control: no-cache`, or use `public, max-age=300` for the versioned assets.
5. TASK-020/108: mount the step-0 per-IP limiter (ADR-0016 am. 1) **before** the docs router, so `/api/docs/*` is limited like every other public route.

**Verification.** A unit test sets `app.set('etag fn', fn)` with a counting `fn`, requests each docs path twice, and expects zero calls and an identical `ETag`. A second request with `If-None-Match` gets 304 with an empty body. TASK-020's pipeline-order test asserts the limiter layer precedes the `/api/docs` mount.

### PR21-SEC-02: Swagger UI initializer hardening; docs share the API origin (INFO)

The initializer passes only `url`, `dom_id`, `deepLinking`, `presets` and `layout`. Everything else is a library default:
- **`validatorUrl`** defaults to `https://validator.swagger.io/validator`. `OnlineValidatorBadge` (part of `StandaloneLayout`) renders an image from that host carrying the spec URL whenever the spec URL is not localhost. The CSP (`img-src 'self' data:`) blocks it today. A later CSP relaxation would turn it into a third-party request that discloses the docs URL. **Set `validatorUrl: null`.**
- **`queryConfigEnabled`** defaults to `false` in 5.34.1. It is the control against `?url=` / `?configUrl=` loading an attacker's spec. **Pin it explicitly** (`queryConfigEnabled: false`), so an upgrade that changes the default cannot re-open the historic Swagger UI DOM-XSS class.
- **Try-it-out.** `supportedSubmitMethods` defaults to every method. Against production it is effectively blocked today: the `/api/v1` servers are `http://localhost:3000` or the `https://api.{domain}` template, and `connect-src 'self'` limits calls to the docs origin. Defence in depth: when the process's `apiMode` is `live`, render with `supportedSubmitMethods: []` (pass `apiMode` into `createDocsRouter` and emit it into the initializer).
- **Top bar.** `StandaloneLayout`'s "Explore" box loads any URL the user types. It is self-inflicted, and `connect-src 'self'` blocks cross-origin specs. `layout: 'BaseLayout'` without the top-bar plugin removes it outside local.
- **CSP `style-src 'self' 'unsafe-inline'`: accepted, scoped to the docs responses.** It enables no script. Every exfiltration channel CSS could use (`img-src`, `font-src`, `connect-src`) is limited to `'self'`/`data:`. The page renders our own contract only, through Swagger UI's sanitised Markdown.
- **Same origin as the API.** `/api/docs` is served from the API origin, where the `__Host-rt_web` / `__Host-rt_admin` refresh cookies live. A script-execution bug in a third-party UI there could call `GET /auth/csrf` and `POST /auth/refresh` same-origin. Today three controls stop this: CSP without script `'unsafe-inline'`, `queryConfigEnabled` off, and our own spec. Keep all three. **G4-production condition:** if the docs are ever enabled in production (developer portal, M3), serve them from a cookieless origin (for example `docs.<domain>`), not from the API host.
- **Headers.** `X-Robots-Tag: noindex` and `Referrer-Policy` come from Helmet (ADR-0016 §11 and am. 6(b)) when TASK-048/111 adds it. That task must mount Helmet before the docs router, and must not overwrite the docs route's CSP afterwards.
- **OPTIONS on the docs mount** still gets Express's automatic `200 text/plain` with `Allow: GET, HEAD` (probe); `optionsResponder` covers only the `routes` router. This is a consistency gap of the PR #9 n9 kind, not a disclosure (the methods are public).

### PR21-SEC-03: `DOCS_ENABLED` default versus the requirement text (INFO)

REQ-API-003, the US-035 notes and api/README.md "Outside the prefix" say Swagger UI is "on in local, test and staging; off in production unless configured". The configuration (`localOnly` default, from TASK-005) turns it on only in local and test, and staging needs an explicit `DOCS_ENABLED=true`. This matches TEST-STRATEGY / D-QA-009 ("developer tools absent from non-local profiles", SEC-TC-34), which is the safer reading. **Recommendation:** product-manager and api-designer align REQ-API-003 and the README with the config ("on by default in local and test; staging and production opt in"), rather than changing the default. No guard refuses `DOCS_ENABLED=true` in production; REQ-API-003 allows it. The G4-production checklist should therefore carry the PR21-SEC-02 conditions (cookieless origin, try-it-out off) for any production opt-in.

**What the served contract contains.** The route serves `openapi.yaml` verbatim (823 KB). On the head contract, the gitleaks emulation finds 0 default-rule hits. The remaining credential-like examples are fake:
- the TOTP `provisioning_uri` uses the well-known RFC-style demo base32 value;
- the `next_cursor` examples are unsigned base64url JSON (`{k, id}`);
- the `test_token` values are the Mock gateway's outcome names.

The `x-*` metadata (permissions, rate-limit classes and values, re-auth scopes) becomes readable wherever the docs are on. That is acceptable: no control depends on its secrecy, and the contract is designed to be public (BRIEF: Swagger UI and developer portal).

### PR21-SEC-04: coverage exclusion is suffix-wide (INFO)

`'!**/*.gen.ts'` removes **any** file named `*.gen.ts` anywhere in the repository from coverage. The probe shows the ESLint side is exact: `packages/authz/src/x.gen.ts` and `packages/shared/src/api/other.gen.ts` are still linted. Once TASK-015 adds the 95 % per-path thresholds for `packages/{authz,audit,pricing}`, a hand-written `*.gen.ts` there would escape the gate the threat model leans on. The existing `!**/*.generated.ts` has the same shape.

**Fix:** `'!packages/shared/src/api/types.gen.ts'` (exact). TASK-015 should anchor `*.generated.ts` to its known generator outputs the same way. `tools/repo/coverage-scope.test.ts` can then assert that every exclusion is an exact path or a known generated folder.

### PR21-SEC-05: generated file outside ESLint (INFO)

`globalIgnores(['packages/shared/src/api/types.gen.ts'])` is exact-file (the probe found `Types.gen.ts` and `other.gen.ts` linted). These residual controls hold:
- Semgrep scans the file: `packages/*/src/` is in every server-scope rule, and `.semgrepignore` does not exclude it.
- `types-drift.test.ts` runs in lane A and pins the content to the generator's output.
- The generator escapes comment terminators, so contract text cannot become code.
- `packages/shared/src/index.ts` re-exports with `export type` only, so nothing loads the module at run time.

**The residual:** a PR that changes `tools/openapi/types.ts` and `types.gen.ts` together keeps the drift test green. GitHub collapses an 11.5k-line generated diff, and coverage excludes the file. **Hardening:** a unit test that parses `types.gen.ts` with the TypeScript compiler API and fails on any top-level statement other than `InterfaceDeclaration`, `TypeAliasDeclaration` or an `export {}`.

### PR21-SEC-06: drift-check scope and OPTIONS placement, routed to TASK-020 / TASK-048 (INFO)

- `loadApiMounts()` walks `createHealthRouter(...)` and `moduleRegistry`, not the composed `createApp(...)`. A route mounted directly in `app.ts`, outside those two, would not be compared with the contract. api/README.md §15 input 1 specifies the `app.router.stack` walk, with `/api/docs/*` and `/metrics` as the only listed exclusions.
- The check requires each documented operation to carry an `x-permission`. It does not yet compare `x-permission` with the mounted route's permission (§15 assertion 2). `tools/openapi/README.md` lists TASK-020's additions as "x-audit, x-idempotency, Joi parity" and omits it. **TASK-020 review check:** assertion 2 (`x-permission === route.permission`, catalogue membership) is implemented, and the walk runs over the composed app with explicit exclusions.
- `optionsResponder` answers `OPTIONS` for known path templates before any module router, so before authentication. It discloses only what a 405 `Allow` already discloses, at template level. It is not a per-resource oracle, because `{orgId}`-style parameters are matched as templates. **TASK-020 / TASK-048 check:** the step-0 limiter and the CORS preflight handler run before `optionsResponder`, and no route-level `router.options()` handler is expected to run (the responder pre-empts it).

### PR21-SEC-07: test-tooling hardening (INFO)

- **(a) External references.** `SwaggerParser.dereference(path)` uses json-schema-ref-parser 16 defaults, which resolve external `$ref`s, including `http(s)` ones. Today every `$ref` in the contract is internal (`#/…`). A future external reference would make unit tests and tools fetch from the network, and would import unreviewed schema content. **Fix:** pass `{ resolve: { http: false } }` (and `external: false` if file refs are never intended), or add a unit test that every `$ref` value starts with `#/`.
- **(b) Redaction list.** The failure excerpt redacts keys matching `/token|secret|password|authorization|cookie/i`. Contract fields that carry one-time or sensitive values but escape that list include `reauth_proof`, `code` (TOTP), `recovery_codes` and `provisioning_uri`. Non-JSON bodies are printed raw (truncated). Test data is synthetic, so this is INFO. **Fix:** when TASK-010 lands, reuse its Pino redaction key list (one source of truth), and add `proof|code|recovery|provisioning|signature|key` here.

## 5. Focus items

| Focus | Result |
|---|---|
| `DOCS_ENABLED` per `APP_ENV` | On by default only in local and test; off in staging and production unless set (`schema.ts:224`, `localOnly`). Unit-pinned for production (`load-config.test.ts`). Disabled → not mounted → 404 problem+json (`app.ts:54`; AT-US-035-02, local `test:api`). Spec unreadable while enabled → exit 78 at start-up (fail closed); only `error.name` is logged. See PR21-SEC-03 for the requirement-text gap |
| Served from `swagger-ui-dist`, pinned | `apps/api` `^5.34.1`, locked 5.34.1 (lockfile unchanged), Apache-2.0, no advisories. Six files allow-listed by exact route. Probe: `.js.map`, `oauth2-redirect.html`, `index.html`, `swagger-ui.js`, `package.json`, `../`, `%2e%2e/`, `..%2f` and `%00` all → fallback 404. Case-insensitive and trailing-slash variants of allow-listed files are served, which is harmless |
| CSP `style-src 'unsafe-inline'` | Accepted for the docs responses only (PR21-SEC-02 rationale). Script: `'self'` only |
| No try-it-out against production | Effectively blocked today by the servers list plus `connect-src 'self'`, and the docs are off in production. Explicit `supportedSubmitMethods: []` for `apiMode: live` recommended (PR21-SEC-02) |
| No secrets in the served contract | 0 default-rule hits on the head contract; remaining look-alikes are fake (PR21-SEC-03) |
| Example values non-secret-shaped; allowlist narrowing | 17 values replaced (diff: example values only; schemas, paths and extensions unchanged). Base 15 → head 0 emulated findings. Exact change in §5.1 |
| OPTIONS / `Allow` disclosure | Template-level only, identical to the 405 `Allow`; no resource oracle. Docs mount still answers with Express's automatic 200 (PR21-SEC-02). Placement conditions → PR21-SEC-06 |
| Ajv config | Test-only (`tests/api/helpers`); no `ajv` import under `apps/` or `packages/`. `new Ajv2020({ allErrors: true, strict: true })`. OpenAPI keywords and the contract's `x-*` keys are declared as an annotation vocabulary instead of disabling strict mode. Unknown formats fail set-up (`assertKnownFormats` and Ajv strict). Schemas come from the repository contract, never from responses, and are compiled in tests only. In-house format checks are length-capped with linear regexes |
| Lint `files:` allowances | Probe: only `import-x/no-extraneous-dependencies` (adds `apps/api` as a package dir) on `tools/openapi/drift.test.ts` and `tests/api/**/*.api.test.ts`, and `import-x/no-relative-packages: off` on the latter. No security rule changes on any probed path, head or merged |
| `*.gen.ts` exclusions | ESLint: exact file. Coverage: suffix-wide (PR21-SEC-04). The generated file is types-only (PR21-SEC-05) |
| `jest.config.ts` | `SWC_JEST_OPTIONS` unchanged: `swcrc: false` and inline options (PR17-SEC-01 property kept). The only change is the coverage glob. PR17-SEC-09 (`__mocks__`) is unchanged and still routed to the next devops PR; no `__mocks__` directory is added |
| `tsconfig.json` + `tests/*/tsconfig.json` | Two new `noEmit` projects referenced from the root solution; nothing new is emitted into `dist`; build info goes to `node_modules/.cache` |
| `package.json` | Two scripts: `openapi:lint` (`node tools/openapi/lint.mjs`: the resolved CLI entry via `process.execPath`, no `npx`, telemetry and update check off, 120 s timeout) and `openapi:types` (`tsx`). No dependency change |

### 5.1 Exact `.gitleaks.toml` change proposed to devops-engineer (PR10-SEC-08, allowlist side)

**Preferred, option A: delete the whole first block.** That is the `# PR1-SEC-11: example values in the OpenAPI contract…` comment and the `[[allowlists]]` table with `description = "PR1-SEC-11 OpenAPI example token values"`, its `paths = ['''^docs/03-architecture/api/openapi\.yaml$''']` and its three `regexes`. Keep the agent-docs block.

- **Evidence.** The emulated default rules report 0 findings on the head contract with no repository allowlist. On the base contract they report 15, all inside the block, which is the positive control. The three synthetic control lines were all reported, including by `github-pat` and `jwt`.
- **Why removal is safe.** The generic rule's stopword list contains `example`, so marker values never need an allowlist. Specific rules (`jwt`, `github-pat`, Stripe and so on) still fire on real-shaped values under any key.
- **Tests.** `sec-static.test.ts` AT-US-048-04 keeps passing, because one allowlist remains. Add a case asserting that no allowlist `paths` entry matches `docs/03-architecture/api/openapi.yaml`.

**Option B, only if devops wants a margin.** Keep the block and replace its `regexes` with marker-only forms:

```toml
regexes = [
  '''^\s+[a-z_]*(?:token|proof):\s+EXAMPLE_[A-Z0-9_]+\s*$''',
  '''^\s+share_path:\s+/q#token=EXAMPLE_[A-Z0-9_]+\s*$''',
  '''^\s+client_secret:\s+(?:pi|seti)_EXAMPLE_secret_EXAMPLE\s*$''',
]
```

Add the PR10-SEC-08 verification case: JWT-, GitHub-PAT- and `sk_live_`-shaped values under `access_token:` are admitted by none of these regexes.

**Either way:**
- Confirm with the real gitleaks image, in a Linux container, in git mode over a scratch commit that adds the head contract as a new file. The emulation is a strong hint, not proof.
- Land the change after PR #21 merges. Lane A reads `.gitleaks.toml` from the base ref, and the old values have been on `main` since before every open branch's merge base, so no branch range re-adds them.

## 6. Routed items and closures

| Item | Status after this PR |
|---|---|
| PR10-SEC-08 (LOW) | **Contract side closed** (17 marker values; 0 emulated hits). **Allowlist side open**, owned by devops-engineer, with the exact change in §5.1. The finding stays LOW open until `.gitleaks.toml` changes |
| PR #9 code review n9 (OPTIONS) | Closed for the `routes` router (204 + `Allow`); the docs mount keeps Express's automatic answer (PR21-SEC-02, consistency only) |
| PR17-SEC-01 (`.swcrc`) | Property preserved (`swcrc: false` unchanged) |
| PR17-SEC-09 (`__mocks__`) | Unchanged; still due in the next devops PR, before Wave 1 |
| PR2-SEC-09 (`TEST_FILES` anchoring) | Unchanged by this PR; the new folders are top-level `tests/*`, not `src/**/tests` |
| ASVS 14.2.2 / P3 ("Swagger and Mock off in production") | Met by default (PR21-SEC-03 for the opt-in) |

## 7. Merge conditions and overlap

- **Main moved after lane A ran.** PR #19 merged as `51178d4`. `origin/main` was `99ea21f` during the probes and is `da5821a` at hand-off; the commits after `51178d4` are docs-only. Main and this PR both changed two owned paths since the merge base: `eslint.config.mjs` and `package.json`.
  - `git merge-tree --write-tree` of `b0ede35` with `99ea21f` (tree `9c151bb`) and with `da5821a` is clean.
  - In the merged tree, the diff against `main` on those two files is exactly this PR's 26 changed lines.
  - The effective-config probe of the merged tree against `99ea21f` shows the same three deltas as head against base, and nothing else.
- **Do not merge `main` into the branch after this round.** A merge commit brings `main`'s side of `eslint.config.mjs` and `package.json` after `b0ede35`, which voids this record under checker rule (d) (§8, control D). If the branch must be updated, a merge-only delta round naming the pushed merge commit is needed:
  1. confirm the merge commit is the PR's head with `git ls-remote origin`;
  2. check that its paths equal the net change;
  3. check that every blob equals `b0ede35`'s except the two overlap files;
  4. check that those two equal `git merge-tree`'s result.
- **PR #4 (`05dfe7e`)** also changes `eslint.config.mjs`, `jest.config.ts` and `package.json` (and the unowned `tools/repo/root-scripts.test.ts`). Whichever of #4 and #21 merges second needs a delta round on its updated head.
- **PR #20 (TASK-010)** overlaps on `apps/api/src/app.ts`, `main.ts` and `platform/context/request-context.ts`. These are not owned, so the record is not voided. The resolution must keep:
  - the docs mount after the security basics and the body parser, and before `routes`;
  - `optionsResponder` first inside `routes`;
  - both `requestContextMiddleware` options (`apiMode` and TASK-010's).

  security-analyst re-checks that order in PR #20's or this PR's delta round, whichever merges second.

## 8. Record check (simulated)

**Setup.**
1. `git clone --shared --no-checkout <main checkout>` into scratch.
2. `checkout --detach b0ede35`.
3. Copy this file in and commit it as a docs-only commit on top.
4. Run main's `tools/ci/check-security-owned-paths.mjs`, extracted with `git archive da5821a tools/ci`, with `--root <clone> --pr 21 --json` and the base and head below.

The clone and extraction were removed afterwards.

| Case | Base | Head | Expected | Observed |
|---|---|---|---|---|
| A: record committed on top | `da5821a` (today's main) | record commit | pass | **pass** (exit 0), satisfied by this record at `b0ede35`; the same 6 owned paths as lane A |
| A2: same, original run base | `80ff2c2` | record commit | pass | **pass** (exit 0), satisfied at `b0ede35` |
| B: no record | `da5821a` | `b0ede35` | missing | **missing** (exit 1): "no record named …/PR-0021-*.md for PR #21" |
| C: wrong PR number (`--pr 20`) | `da5821a` | record commit | missing | **missing** (exit 1): "no record named …/PR-0020-*.md for PR #20" |
| D: `main` merged into the branch after the record | `da5821a` | merge of `da5821a` into the record commit | missing (rule (d)) | **missing** (exit 1): "names b0ede35, but eslint.config.mjs, package.json changed after it" |
| E: owned path edited after the record | `da5821a` | commit touching `jest.config.ts` | missing (rule (d)) | **missing** (exit 1): "names b0ede35, but jest.config.ts changed after it" |

`tools/ci/` is identical at `80ff2c2`, `99ea21f` and `da5821a`, so the checker matches the one lane A ran.

ASVS 4.0.3 delta:
- **V13.1.x (API contract):** contract-first tooling in place. Response validation exists in tests only, by design.
- **V14.3.x (unintended disclosure):** docs off in production by default.
- **V14.4.x (headers):** a route-specific CSP on the docs responses; the global header set comes with Helmet (TASK-048/111).
- **V14.2.x (dependencies / configuration integrity):** no dependency change; the owned-path deltas are minimal and proven.

| Field | Value |
|---|---|
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding is open at head `b0ede35`, so the merge rule is met for the security dimension. The docs endpoint is config-gated (off in staging and production by default), allow-listed, and under a script-tight CSP; the served contract and the 17 replaced examples carry no secret-shaped value (emulated gitleaks: base 15 → head 0, controls caught); the owned-path changes alter no security lint rule, keep `swcrc: false`, and emit nothing new; Ajv stays out of the runtime closure. Open: PR21-SEC-01 (LOW, precomputed ETag plus limiter placement) and PR21-SEC-02..07 (INFO, routed). PR10-SEC-08 is closed on the contract side; the allowlist removal in §5.1 is devops-engineer's. **This round authorises `b0ede35` for merge** once this record is committed on top of it as a docs-only commit and lane A is green on that commit, without a further merge of `main` (§7) |

## Round 2 (head b31483b)

| Field | Value |
|---|---|
| PR | #21, branch `feat/TASK-017-contract-first-openapi-pipeline-redocly`. Delta since round 1 (`b0ede35`), first-parent: `bf3d1f7` (merge of `origin/main` `d38500a`, bringing PR #19 `51178d4`, PR #4 `f38e6b9` and docs), then fix cycle 1: `97a21c8`, `58aa986`, `b1e2bb1`, `b31483b`. The merge base with `main` is `d38500a`. `git ls-remote origin` shows `b31483b` as both the branch head and `refs/pull/21/head` |
| Head | b31483b989827aeef29a97c17d5c0840f2b6163b |
| Round-1 record | Voided by checker rule (d), as lane A reports: the record "names b0ede35, but eslint.config.mjs, jest.config.ts, package.json, tools/lint/lint-fixtures.mjs, tools/lint/negative-fixtures.test.ts changed after it" |
| Lane A evidence | Run [43351989787](https://github.com/sukhchdit/shipcube/actions/runs/43351989787) on `b31483b` (`pull_request`, base `d38500a`). **fast-lane `success`**, every step (commitlint, lint, type-check, unit, base-ref negative fixtures, build). **scans:** Gitleaks and Semgrep `success`. Only "Security-owned paths need a review record" failed, listing the 8 owned paths below; `ci-gate` failed as a consequence. The `*.api.test.ts` suites and the integration suite are not lane A suites (D-ORCH-001). For those I rely on the developer's local gate table in the fix-cycle comment (`test:api` 5 suites / 80 passed, `test:integration` 18 suites, coverage 97.70 % lines); I did not re-run them |
| Owned paths changed | 8, per lane A: `eslint.config.mjs`, `jest.config.ts`, `package.json`, `tsconfig.json`, `tests/api/tsconfig.json`, `tests/contract-stubs/tsconfig.json`, `tools/lint/lint-fixtures.mjs`, `tools/lint/negative-fixtures.test.ts` |
| Reviewer / date | security-analyst, 2026-11-13. Read-only. Every git command ran in the main checkout against commit SHAs; no command of any kind ran in the PR worktree. Probes ran in scratch on `git archive` extracts, with junctions to the main checkout's `node_modules` (this PR does not change the lockfile), and were removed afterwards. No install, Docker, real gitleaks or suite run. One `$ref` probe variant (R2.2) made a single outbound HTTPS GET to the reserved documentation host `example.com` through json-schema-ref-parser's own HTTP client; it sent nothing but the request line |

### R2.1 Summary

**Fix cycle 1 closes the open items.** It closes PR21-SEC-01 (LOW), PR21-SEC-02, PR21-SEC-04 and PR21-SEC-05, and the code parts of PR21-SEC-06 and PR21-SEC-07.

**The merge of `main` is a clean union.** Every path the merge touched has one of three contents:
- the reviewed `b0ede35` blob;
- `git merge-tree`'s clean auto-merge;
- the conflict resolved as the union of both sides.

**The owned-path changes against today's `main` are additive.** The 6 changed owned files that exist on `main` have 0 deleted lines; the other 2 are new `noEmit` tsconfigs. The effective ESLint config differs only on the three expected path classes.

**Two new INFO findings:**
- PR21-SEC-08: the `$ref` regression tests do not hold the property they name;
- PR21-SEC-09: the narrowed `no-relative-packages` ignore is prefix-only.

Nothing is Critical, High or Medium, and no LOW finding of this PR stays open.

**Fix cycle 2 is in scope.** `e046ea2`, pushed during this round, is the D-ORCH-024 light cycle 2. It changes only the drift walker (unowned) and an `app.ts` comment. It closes code review R2-m1: a walker probe shows all five escaping mount shapes reported (R2.8). This record names `b31483b`, the last commit that changes an owned path, and the checker accepts it on top of `e046ea2` (R2.9 case G).

### R2.2 Method

| Area | How |
|---|---|
| Delta | `git diff bf3d1f7 b31483b` (the fix cycle, 25 files) and `git diff d38500a b31483b` (the net change, 46 files). `types.gen.ts`, `openapi.yaml`, `redocly.yaml`, `tools/openapi/lint.mjs` and `packages/shared/src/index.ts` are blob-equal to round 1 |
| Merge `bf3d1f7` | Three-way check. The paths of `diff d38500a bf3d1f7` equal the paths of `diff 80ff2c2 b0ede35` (43 = 43). Each blob compared with `b0ede35` and with `git merge-tree --write-tree b0ede35 d38500a`, which conflicts in `eslint.config.mjs` and `package.json` (R2.3) |
| Docs router and pipeline order | The head's `apps/api/src`, `packages/shared/src`, `packages/config/src` and `openapi.yaml` from `git archive b31483b`, run with plain Node 24 through a resolve/load hook (type stripping in transform mode; `@platform/*` mapped to the extracted sources). The real `createApp`, with the real health router and the docs options from `docsOptionsFrom` for each `APP_ENV`, served by `node:http`. Raw-socket requests. Express's ETag function was replaced with a counting function (`app.set('etag fn', …)`), with a positive control on `/health/live`. 77 of 77 checks passed |
| `$ref` handling | Scratch documents with an external `$ref` under a plain key, a double-quoted key and a single-quoted key, over `http` and `https`, against local counting servers. Each ran through the contract test's own regex, `SwaggerParser.dereference` with and without `DEREFERENCE_OPTIONS`, and `openapi-typescript` 7.13.0 called as `tools/openapi/types.ts` calls it. A variant with a never-resolving `.invalid` host shows which assertion tells the option's presence apart (PR21-SEC-08) |
| ESLint | Effective config of `d38500a` against `b31483b`: `calculateConfigForFile` / `isPathIgnored` on 21 probe paths, rule by rule. `lintText` probes of `tests/api/*.api.test.ts` imports against the head config, with the import targets present on disk |
| Gitleaks | The round-1 emulator (v8.30.1 default rules, 221 compiled) over every added line of `bf3d1f7..b31483b` plus the four commit messages: 0 findings. The round-1 control file: 5 findings. The emulator also ran over this round's text before hand-off: 0 findings |
| Overlap | `comm -12` of each open PR's net paths (against its own merge base) with this PR's net paths: #20, #22, #23, #15 (R2.7) |
| Probe artefact | On this Windows host, a `node:http` response of 1.5 MB or more is truncated when it is written asynchronously and the request carried `Connection: close`. A plain `node:http` server using `setImmediate` reproduces this without any PR code, so it is not a finding. The probe checks read status and headers only; the one length check needs only more than 100 kB |

### R2.3 The merge commit `bf3d1f7`

**Paths.** `bf3d1f7` changes exactly the 43 paths against `d38500a` that `b0ede35` changed against its base `80ff2c2`.

**Blobs.**
- 39 of the 43 equal `b0ede35`'s.
- `jest.config.ts` and `tools/repo/root-scripts.test.ts` equal `git merge-tree`'s clean auto-merge.
- `eslint.config.mjs` and `package.json` differ from the merge-tree's conflict-marked blobs only by the resolution:
  - `eslint.config.mjs` keeps both sides' new `files:` blocks: this PR's drift-test and API-test allowances, and `main`'s `routes.ts` allowance.
  - `package.json` keeps both `openapi:*` scripts and `main`'s `lint` line (typegen first, no `--allow-empty-input`). The PR's side of `lint` was the unchanged base line, so this is the correct resolution.

**Net effect against `main`.**

| File | Change |
|---|---|
| `package.json` | Adds exactly the two `openapi:*` scripts |
| `eslint.config.mjs` | +26/−0 |
| `jest.config.ts` | +2/−0 |
| `tools/lint/lint-fixtures.mjs` | +5/−0 |
| `tools/lint/negative-fixtures.test.ts` | +9/−0 (2 cases added, none removed) |
| `tsconfig.json` | +2/−0 |

Every control from PRs #17, #18, #19 and #4 therefore survives byte for byte:
- `SWC_JEST_OPTIONS` with `swcrc: false`, for every Jest project including `unit-dom`;
- all negative-fixtures cases, including the `TENANT_DB` cases;
- the `prisma-seed` boundaries category;
- the typegen-first `lint` and `typecheck`.

`tools/repo/root-scripts.test.ts` (unowned) only adds `tests/api` and `tests/contract-stubs` to the non-workspace projects that the typecheck solution must reach. That makes the test stricter.

### R2.4 Round-1 findings at `b31483b`

| ID | Round 1 | Status | Evidence |
|---|---|---|---|
| PR21-SEC-01 | LOW | **Closed** (code). The limiter placement (round-1 remediation step 5) stays with TASK-020/108 | `staticBody()` (`serve.ts:138`) builds every body once as a Buffer, with a quoted 27-character base64url SHA-256 prefix as its ETag. `send()` (`serve.ts:143`) sets the `ETag` header before `res.send`. Probe results:<br>- Express's ETag function was called **0 times** over 10 docs paths × 5 requests each (GET twice, exact conditional, `W/` conditional, HEAD). The `/health/live` control called it once.<br>- An exact `If-None-Match` gets 304 with an empty body. The `W/` form also gets 304 (weak comparison, RFC 9110).<br>- A mismatch gets 200 with the full body.<br>- HEAD gets 200 with the same ETag and no body |
| PR21-SEC-02 | INFO | **Closed** for the initializer and the docs OPTIONS answer. Still routed, unchanged: the G4-production cookieless-origin condition and the Helmet ordering (TASK-048/111) | Probe per `APP_ENV`:<br>- `validatorUrl: null` and `queryConfigEnabled: false` in all four.<br>- `supportedSubmitMethods: []` only in production (`apiMode` live).<br>- `StandaloneLayout` and its preset script only in `local`; elsewhere `BaseLayout` and no preset script.<br>- The config is emitted with `JSON.stringify` from typed options into an external script; the page has no inline script.<br>- OPTIONS on a docs path gets 204 + `Allow: GET, HEAD, OPTIONS`; POST gets 405 problem+json |
| PR21-SEC-03 | INFO | Open, routed: product-manager + api-designer (D-ORCH-023 (1)) | No code change expected |
| PR21-SEC-04 | INFO | **Closed** | `jest.config.ts:66` `'!packages/shared/src/api/types.gen.ts'`; no `*.gen.ts` glob remains. The older `'!**/*.generated.ts'` stays with TASK-015, as in round 1 |
| PR21-SEC-05 | INFO | **Closed** | The `types-drift.test.ts` case "[PR21-SEC-05]" is a lane A unit test. It parses the file with the TypeScript compiler API and allows only interface and type-alias declarations, or an empty `export {}`. `types.gen.ts` is blob-equal to round 1 |
| PR21-SEC-06 | INFO | Walk part **closed**: at `b31483b` except code review R2-m1, and fully at `e046ea2` (fix cycle 2, D-ORCH-024 (1); R2.8). Remainder routed to TASK-020 / TASK-048 (D-ORCH-023 (1)) | `api-mounts.ts` builds the composed `createApp(...)` and walks `app.router`:<br>- path-mounted routers resolve only against the literal `/api/v1` and `/api/docs`; a `/api/:version` or `/*rest` mount is reported;<br>- a handler mounted under a path is reported (R1-M1);<br>- only `/api/docs` is excluded.<br>Code review R2-m1 (2026-11-13) found three kinds of mount that still escape (five shapes): array mounts, optional-group mounts and a sub-app at the root. That is the same fail-open class; it is confined to `app.ts` and the root health router.<br>**Added TASK-020 check:** any router mounted at `/api/docs` is skipped by design, so assert that the excluded mount serves only GET/HEAD on the allow-listed docs paths (an `allowedMethods` assertion over the composed app) |
| PR21-SEC-07 | INFO | (a) code **closed**; the test residual becomes PR21-SEC-08. (b) **closed** for this PR; the single source shared with the Pino list stays routed to TASK-010 (D-ORCH-023) | (a) `loadContract` passes `DEREFERENCE_OPTIONS` (`contract.ts:66, 72`). Probe: `http` and `https` references are refused with no connection.<br>(b) `contract-validator.ts:23`: the excerpt redaction now also covers the key families passphrase, proof, recovery, provisioning, signature, OTP and key. `code` is redacted unless it is a catalogue code. This matches ADR-0017's fixed keys (`totp`, `recovery_code`, `api_key`) |

### R2.5 New findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner | Status |
|---|---|---|---|---|---|---|---|
| PR21-SEC-08 | The `$ref` regression tests do not hold the property they name; `openapi-typescript` follows external `$ref`s | INFO | CWE-918 (latent) | A10 | `tools/openapi/contract.test.ts:26, 59-63`; `tools/openapi/types.ts:34` | senior-developer; TASK-020, like the other TASK-017 follow-ups (D-ORCH-023 (1)) | Open |
| PR21-SEC-09 | The API-test `import-x/no-relative-packages` ignore is prefix-only, so `apps/api/src/../` escapes it | INFO | CWE-1127 | A04 | `eslint.config.mjs:543` | TASK-020 (D-ORCH-024 (2); the same item as code review R2-n1) | Open, routed |

#### PR21-SEC-08: `$ref` guard tests (INFO)

**Description.** Three gaps, all in test tooling:
1. **The http test passes without the option.** "refuses an http $ref without sending a request" stays green without `DEREFERENCE_OPTIONS`. The http resolver of json-schema-ref-parser 16.0.5 defaults to `safeUrlResolver: true`, so it never reads loopback or private addresses. Probe: with default options, the same `127.0.0.1` reference is also refused with 0 requests. A change that drops the options from `loadContract` keeps the test green.
2. **The text scan misses quoted keys.** "openapi.yaml references nothing outside itself" scans the raw text for `$ref:`. YAML also accepts the key quoted, as `"$ref":` or `'$ref':`, and every parser reads it as `$ref`. Probe: both quoted forms, with an `http` value, pass the regex.
3. **`openapi-typescript` fetches.** `openapi-typescript` 7.13.0 resolves external `http(s)` references through Redocly's resolver. It runs in `npm run openapi:types` and in `types-drift.test.ts`, which renders the committed contract in lane A. Probe: 2 requests per reference, including both quoted-key forms.

**Exploitability and impact.** A contract with an external reference cannot land green today: `loadContract` refuses it, and the contract, drift and validator suites load the real document. What remains:
- lane A and a developer's `openapi:types` fetch from the network before the suites fail;
- the guard test names a property it does not prove.

The PR author already runs code in lane A, so neither is an escalation. Impact L, likelihood L → INFO (hardening).

**Remediation (code-level).**
1. Make the http test discriminate. Point the `$ref` at the never-resolving host `http://schema.example.invalid/schema.yaml`, and assert that the rejection message contains `Unable to resolve $ref pointer`, not `Error downloading`. Probe: with `DEREFERENCE_OPTIONS` the message is the former; with the options removed it is the latter. Alternatively, spy on `SwaggerParser.dereference` and assert its options argument.
2. Collect the references from the parsed document, not the text. Parse `openapi.yaml` with the YAML parser the tools use, walk every object key equal to `$ref`, and assert that each value starts with `#/`.
3. Once (2) holds, `openapi-typescript` and Redocly need no further change. Otherwise, give them a resolver configuration without HTTP.

**Verification.** The mutant without `DEREFERENCE_OPTIONS` fails test 1. A seeded quoted-key `$ref` with an `http` value fails test 2.

#### PR21-SEC-09: prefix-only lint ignore (INFO)

**Description.** For `tests/api/**/*.api.test.ts` the rule stays on, with an `ignore` pattern anchored at `(../)+apps/api/src/`. import-x tests that pattern against the raw specifier, before resolving it. Probe (head config, real target files):
- the allowed relative import of `apps/api/src/app.js` is clean;
- `packages/shared/src/index.js` and `apps/worker/src/main.js` fail, as intended;
- `../../apps/api/src/../../../packages/authz/src/index.js` lints clean: no rule reports it.

**Exploitability and impact.** This is hygiene, not a security control. The files are tests and never part of a runtime closure, and they may import any `@platform/*` package through its entry point anyway. Against round 1 (rule off) the change is a strict improvement. Against `main` it is a narrow allowance for test files only. INFO.

**Remediation.**
1. Reject any `..` segment after the prefix. Use the code reviewer's verified form (R2-n1): `ignore: ['^(?:\\.\\./)+apps/api/src/(?!(?:.*/)?\\.\\.(?:/|$))']`.
2. Add the traversal form as a third `REPO_PROBES` case that expects `import-x/no-relative-packages`.

D-ORCH-024 (2) defers this to TASK-020, so that this PR does not change an owned path for an INFO item. I agree.

### R2.6 Focus items

| Focus | Result |
|---|---|
| 1. PR21-SEC-01 | Closed (R2.4). Each body is a Buffer with a strong ETag, computed once in `createDocsRouter`. 0 ETag-function calls per request. 304 is correct for exact and weak validators; HEAD is correct |
| 2. PR21-SEC-02 / N7a | Closed for all four `APP_ENV`s (R2.4) |
| 3. PR21-SEC-07, PR21-SEC-05 | `loadContract` resolves `$ref` without the network: http is off, so the loader has no SSRF path. The redaction additions are verified. The declarations-only test for `types.gen.ts` runs in lane A. Test residuals: PR21-SEC-08 |
| 4. Middleware order | **Order.** The `app.router.stack` order is: request context, then `x-powered-by` off, then the JSON body parser, then `routes`, then `routeFallback`, then `problemHandler`. Inside `routes`: `optionsResponder`, then `/api/docs` (when enabled), then health, then the `/api/v1` module routers.<br>**Probe evidence:**<br>- A docs 404 echoes the client's correlation ID, so the context runs first.<br>- Malformed JSON POSTed to a docs path gets the body parser's 400 before any route, so the parser runs first.<br>- The docs CSP is set per response by `send()`, so a Helmet mounted before `routes` cannot replace it.<br>**Not yet built:** no Helmet, CORS or limiter exists yet. With the docs now inside `routes`, the step-0 limiter and the CORS preflight need a single placement, before `routes`, which is before both `optionsResponder` and the docs. That is routed correctly: PR21-SEC-06 to TASK-020 / TASK-048 (D-ORCH-023), and the PR21-SEC-01 step-5 limiter to TASK-020/108 |
| 5. Lint narrowing, coverage exclusion | **Lint.** The effective-config diff from `main` to head over 21 probe paths shows only three changes:<br>- `tests/api/**/*.api.test.ts`: `no-relative-packages` gains the `apps/api/src` ignore, and `no-extraneous-dependencies` gains `apps/api` as a package dir;<br>- `tools/openapi/drift.test.ts`: the same package-dir allowance;<br>- `packages/shared/src/api/types.gen.ts` is ignored. The ignore is exact: `other.gen.ts`, `Types.gen.ts` and `packages/authz/src/x.gen.ts` are still linted.<br>No `platform/*`, `boundaries/*`, `no-restricted-imports` or `no-console` setting changes on any probe path. This is not a security weakening; the prefix-only ignore is PR21-SEC-09 (INFO).<br>**Coverage.** The exclusion is exactly `packages/shared/src/api/types.gen.ts` |
| 6. Merge union, levers, lockfile | **Merge union:** see R2.3.<br>**Levers.** The net change touches none of these: `.github/` (workflows, actions, CODEOWNERS), `.npmrc`, `.gitleaks.toml`, `.gitleaksignore`, `.semgrepignore`, `.semgrep/`, `tools/ci`, `tools/deps`, `tools/hooks`, `tools/isolated`, `tools/eslint-rules`, `tools/test-support`, `tools/test-dom`, `.swcrc`, `prisma.config.ts`, `apps/web`, `apps/admin`, `.gitattributes`, `.gitignore`, `commitlint.config.mjs`, `.node-version`, `CLAUDE.md`, `.claude/`. So no D-ORCH-021 lever condition applies.<br>**Lockfile:** unchanged, as in round 1.<br>**Dependencies:** none added. `typescript`, which the new AST test imports, is an existing root dev dependency |
| 7. PR4-SEC-13 (pre-lint execution) | No new pre-lint surface:<br>- `lint` and `typecheck` are `main`'s lines;<br>- no workspace manifest changes, so no new `typegen` script;<br>- neither `openapi:lint` nor `openapi:types` is called from `lint`, `typecheck`, `build` or the workflow;<br>- the new `tsconfig` projects are `noEmit`, and `tsc` runs no code;<br>- the two new lint probes are in-memory `lintText` calls.<br>`api-mounts.ts` imports `apps/api/src` at unit-test time only, the same class as any test |
| 8. PR10-SEC-08 | **Contract side: still closed.** `openapi.yaml` is blob-equal to round 1, so the round-1 emulation still holds (base 15 → head 0, controls caught).<br>**Allowlist side: still open.** `.gitleaks.toml` is unchanged on both sides and still carries the PR1-SEC-11 OpenAPI block.<br>**Removal path, unchanged:** after this PR merges, devops-engineer applies round-1 §5.1 option A (D-ORCH-023), with the sec-static case and a real-image confirmation. Lane A reads `.gitleaks.toml` from the base ref |

### R2.7 Merge conditions and overlaps

**State of `main`.** Lane A ran against `d38500a`. At hand-off, `origin/main` is `c91f3ed`. The five commits after `d38500a` (`b4885ae`, `6ac9836`, `1e49d36`, `87fcd9e`, `c91f3ed`) change only `docs/` and `.claude/agent-memory/`. They touch no owned path and none of this PR's paths, and `tools/ci` and `.github/` are identical, so this round holds against either base (R2.9 cases A, A2, G and G2).

**Do not merge `main` into the branch again** if the merge brings an owned path. Otherwise a merge-only round is needed (round-1 §7 procedure).

**Fix cycle 2 (D-ORCH-024 (1)).** The light cycle that fixes code review R2-m1, R2-n2 and R2-n3 was pushed during this review as `e046ea2` (parent `b31483b`). It may follow this record without voiding it, because the checker voids a record only for owned paths (R2.9 cases F and G). Its content is reviewed in R2.8. The security condition on any further commit before merge:
- It may change only `tools/openapi/**` (the drift walker, its tests, its README) and comment lines in `apps/api/src/app.ts`.
- Before merge, the orchestrator confirms the scope with `git diff --stat e046ea2 <new head>`.
- Any other change needs a security delta round first. That includes `app.ts` code, `serve.ts`, `fallback.ts`, `contract.ts`, `tests/api/helpers/**`, `tests/contract-stubs/**`, or any owned path.

**Open PRs that overlap this PR** (computed against each PR's own merge base):
- **PR #20** (`9647907`, TASK-010):
  - owned: `eslint.config.mjs` and `tools/lint/negative-fixtures.test.ts`;
  - unowned: `apps/api/src/app.ts`, `main.ts`, `platform/context/request-context.ts`, `problem-handler.api.test.ts` and `packages/shared/src/index.ts`.

  D-ORCH-024 (3) and D-ORCH-025 (4) set the order: #21 first, then #20. PR #20's union commit then needs a security delta round on its merge commit, because both PRs change owned paths. The union must keep:
  - `requestContextMiddleware(options)` with both `apiMode` and TASK-010's fields;
  - the R2.6 item 4 order: context and body parser before `routes`; the docs inside `routes` after `optionsResponder`; `problemHandler` last;
  - PR #20's `routePrefix` as the first layer of the `api` router, not as path-mounted middleware;
  - the PR21-SEC-07 (b) redaction list moving to the single TASK-010 source.
- **PR #23** (`f61e55d`, TASK-011): owned `package.json`; it also edits the unowned `tools/repo/root-scripts.test.ts`.
- **Dependabot #22** (`804733a`) and **#15** (`a9bacfd`): owned `package.json`.

Whichever of these lands first, each of the others needs a delta round after it merges `main`.

### R2.8 Fix cycle 2 (`e046ea2`)

`e046ea2` (one commit on top of `b31483b`; `git ls-remote` shows it as the branch head and `refs/pull/21/head`) changes four unowned files: `tools/openapi/drift.ts`, `drift.test.ts`, `README.md` and `apps/api/src/app.ts`. The `app.ts` change is comment-only: the header line is reflowed, and no non-comment line changes.

`resolveMountPath` now proves a literal mount from more probes than before:
- the layer must have exactly one matcher, so an array mount is reported;
- a probe segment substituted into any segment, or inserted before any non-root segment, must not match;
- an optional tail that consumes an appended probe segment is rejected.

A sub-app mounted at the root (`mounted_app`) is reported. Each change makes the drift check report more, never less. When Express internals lack `matchers`, the walker reports the layer, so the check fails closed. No runtime code changes. Root middleware that answers requests itself stays outside the walker by design; TASK-020's `defineRoute` metadata becomes the authoritative route inventory.

**Walker probe.** `listMountedRoutes` from each head ran on nine mount shapes over Express 5.3.0:

| Shape | `b31483b` | `e046ea2` |
|---|---|---|
| Array mount, optional groups (`/api/v1{/:x}`, `/api{/:v}/v1`, `/api/v1{*rest}`), root sub-app | not reported | **reported** |
| `/api/:version` and `/api` (controls) | reported | reported |
| Literal `/api/v1` (control) | resolved | resolved |
| `/api/docs` (control) | excluded | excluded |

The array mount, the three optional-group shapes and the root sub-app make five shapes, which matches code review R2-m1.

Lane A run [43355654201](https://github.com/sukhchdit/shipcube/actions/runs/43355654201) on `e046ea2`: fast-lane `success`; only the record step failed (the same 8 owned paths), so `ci-gate` failed too. Gitleaks emulation over the added lines and the commit message: 0 findings.

### R2.9 Record check (simulated)

**Setup.**
1. `git clone --shared --no-checkout <main checkout>` into scratch.
2. `checkout --detach b31483b` (cases A–F), or `e046ea2` (cases G–G3).
3. Copy this file in and commit it as a docs-only commit on top.
4. Run `main`'s `tools/ci/check-security-owned-paths.mjs` with `--root <clone> --pr 21 --json`. The checker was extracted from `origin/main` (`c91f3ed`) with `git archive`; `tools/ci` is identical at `d38500a`, `b4885ae`, `87fcd9e` and `c91f3ed`.

The clone and the extraction were removed afterwards.

| Case | Base | Branch tip checked | Expected | Observed |
|---|---|---|---|---|
| B: `b31483b` as pushed (round-1 record only) | `c91f3ed` | `b31483b` | missing | **missing** (exit 1): "names b0ede35, but eslint.config.mjs, jest.config.ts, package.json, tools/lint/lint-fixtures.mjs, tools/lint/negative-fixtures.test.ts changed after it", the same as lane A |
| A: this record committed on top of `b31483b` | `c91f3ed` | record commit | pass | **pass** (exit 0), satisfied at `b31483b`; the same 8 owned paths as lane A |
| A2: same, lane A's run base | `d38500a` | record commit | pass | **pass** (exit 0), satisfied at `b31483b` |
| C: wrong PR number (`--pr 20`) | `c91f3ed` | record commit | missing | **missing** (exit 1): the PR-0020 record names no commit of this PR |
| D: `main` changes `package.json`, then is merged after the record | synthetic `main` commit | merge commit | missing (rule (d)) | **missing** (exit 1): "names b31483b, but package.json changed after it" |
| E: owned path edited after the record | `c91f3ed` | commit touching `jest.config.ts` | missing (rule (d)) | **missing** (exit 1): "names b31483b, but jest.config.ts changed after it" |
| F: unowned paths edited after the record (`drift.ts`, `app.ts`, the fix-cycle-2 shape) | `c91f3ed` | commit touching both | pass | **pass** (exit 0), satisfied at `b31483b` |
| G: this record committed on top of the real fix-cycle-2 head `e046ea2` | `c91f3ed` | record commit | pass | **pass** (exit 0), satisfied at `b31483b` |
| G2: same, base `d38500a` | `d38500a` | record commit | pass | **pass** (exit 0), satisfied at `b31483b` |
| G3: `e046ea2` as pushed (round-1 record only) | `c91f3ed` | `e046ea2` | missing | **missing** (exit 1), the same message as case B |

Every passing case also notes that the round-1 head `b0ede35` is voided. That is expected: older head rows produce notes only (PR10-SEC-21 context).

**Pitfall noted for the next simulation.** The checker reads the record from the `--root` working tree, not from the `--head` commit. Each case therefore checks out the branch tip it names before running. A first G3 attempt that skipped this step read the round-2 file left in the working tree and passed.

| Field | Value |
|---|---|
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding is open at `b31483b` or at the fix-cycle-2 head `e046ea2`, and no LOW finding of this PR remains, so the merge rule is met for the security dimension.<br>**Closed:** PR21-SEC-01 (precomputed strong ETags; 0 per-request hashing; correct 304) and the PR21-SEC-02 initializer hardening, verified for every `APP_ENV`. PR21-SEC-04 and PR21-SEC-05 are closed, as are the code parts of PR21-SEC-06 and PR21-SEC-07.<br>**Merge:** the merge of `main` is a proven union that keeps every PR #17/#18/#19/#4 control. The owned-path changes against `main` are additive, and the effective ESLint delta is the expected one. No D-ORCH-021 lever and no lockfile entry changes.<br>**Open (INFO, routed):** PR21-SEC-03, the PR21-SEC-06 remainder, PR21-SEC-07 (b) single source, PR21-SEC-08 and PR21-SEC-09. The PR10-SEC-08 allowlist removal is devops-engineer's after merge.<br>**This round authorises the current head `e046ea2`** (= `b31483b` + fix cycle 2, R2.8) **for merge**, once this record is committed on top of it as a docs-only commit and lane A is green on that commit. It does not cover a further merge of `main` that brings an owned path, or any later commit outside the R2.7 fix-cycle scope |
